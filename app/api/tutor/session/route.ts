// チャッピー先生：会話を始める。
//   1. 本人の返却済みの問題か・機能が有効か・同意があるか・利用の制限内かを DB で確かめ、会話の記録を作る
//   2. ブラウザの SDP（offer）を、本人のキーで OpenAI に送って通話を作る（POST /v1/realtime/calls）
//   3. 通話ID と、通話を切るためだけの資格情報（本人のキーを暗号化したもの。会話ごと）を DB に置く
//      （tutor_call_secrets。誰も読めない。切り終えたら消し、遅くとも「1回の上限時間＋30分」で消す）。
//      ブラウザが来なくなっても、見回り（/api/tutor/sweep）がこれで通話を切れる
//   4. ブラウザへは SDP（answer）だけを返す。本人のキーも短期の資格情報も渡さない
// どこで失敗しても、別のキー（管理者のキーなど）へ切り替えない。
import { TutorError, createCall, hangupCall, listModels, looksLikeKey } from "@/lib/tutor/openai";
import { buildContext, buildInstructions, type ReleasedItem } from "@/lib/tutor/prompt";
import { canStoreKeys, encryptKey } from "@/lib/tutor/crypto";
import { activeConsent, fail, json, releasedItem, requireStudent, secureTransport, sessionRefusal, studentKey } from "@/lib/tutor/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx = await requireStudent(req, { write: true });
  if (ctx instanceof Response) return ctx;
  const text = await req.text();
  if (text.length > 40000) return fail("要求が大きすぎます。", 400, "bad_request");
  let b: Record<string, unknown> = {};
  try { b = JSON.parse(text); } catch { return fail("要求の形が正しくありません。", 400, "bad_request"); }
  const releaseId = String(b.releaseId ?? ""), qno = Number(b.qno);
  const mode = b.mode === "text" ? "text" : "voice";
  const slow = b.slow === true;
  const sdp = typeof b.sdp === "string" ? b.sdp : "";
  if (!sdp) return fail("音声の接続の準備ができていません。ページを開き直してください。", 400, "bad_sdp");

  // 通話を確実に切れる準備ができていなければ、会話を始めない
  //   - 暗号鍵が無いと、通話を切るための資格情報を置けない
  //   - 見回り（定期処理）が止まっていると、ブラウザが来なくなったときに切れない
  if (!canStoreKeys()) return fail("学校の設定（暗号鍵）がまだのため、会話を始められません。先生に伝えてください。", 503, "tutor_not_ready");
  const { data: sweeperOk } = await ctx.db.rpc("tutor_sweeper_ok");
  if (sweeperOk !== true) return fail("会話を確実に終わらせる仕組み（見回り）が止まっているため、会話を始められません。先生に伝えてください。", 503, "tutor_no_sweeper");

  const { payload, item } = await releasedItem(ctx, releaseId, qno);
  if (!payload || !item) return fail("この問題は、あなたに返却された答案に見つかりません。", 404, "not_found");
  const consent = await activeConsent(ctx);
  if (!consent) return fail("先に「送る内容と同意」を確認して、同意してください。", 403, "tutor_no_consent");

  // 本人のキー：今回だけ渡されたもの、または保存した暗号文
  if (typeof b.apiKey === "string" && b.apiKey && !secureTransport(req)) return fail("キーは HTTPS の画面からだけ使えます。", 400, "insecure");
  const apiKey = await studentKey(ctx, b.apiKey);
  if (!apiKey || !looksLikeKey(apiKey)) {
    return fail("あなたの OpenAI API キーが登録されていません。「チャッピー先生の設定」で登録するか、外部の ChatGPT で復習してください。", 409, "no_key");
  }
  let model = typeof b.model === "string" ? b.model.trim() : "";
  if (!model) {
    const { data: cred } = await ctx.db.from("tutor_credentials").select("model").eq("student_id", ctx.studentId).maybeSingle();
    model = cred?.model ?? "";
  }
  if (!model) return fail("使うモデルを選んでください。", 400, "model");

  // キーの確認（失効・残高不足などをここで知らせる）と、音声の会話に対応したモデルかの確認
  let models;
  try { models = await listModels(apiKey); } catch (e) {
    const err = e instanceof TutorError ? e : new TutorError("provider_down", "OpenAI に接続できませんでした。", 502);
    return fail(err.message, err.status, err.code);
  }
  if (!models.voice.includes(model)) return fail("選んだモデルは、このキーでは音声の会話に使えません。モデルを選び直してください。", 400, "model_unavailable");

  const { data: started, error: refused } = await ctx.db.rpc("start_tutor_session", { p_release: releaseId, p_qno: qno, p_mode: mode, p_model: model });
  if (refused || !started) { const r = sessionRefusal(refused?.message ?? ""); return fail(r.text, r.status, r.code); }
  const sessionId = String((started as { id: string }).id);
  const maxSeconds = Number((started as { max_seconds: number }).max_seconds);

  const context = buildContext(item as ReleasedItem, payload, { sendAnswer: !!consent.send_answer, sendComment: !!consent.send_comment });
  try {
    const { answer, callId } = await createCall(apiKey, sdp, {
      model, mode, slow, instructions: buildInstructions(context, { slow }),
      transcribeModel: mode === "voice" ? models.transcribe : null,
    });
    if (!callId) {
      // 通話ID が無いと、サーバーから切れない。会話を続けさせない（ブラウザにも SDP を返さないので、接続は成り立たない）
      await ctx.db.rpc("end_tutor_session", { p_id: sessionId, p_reason: "no_call_id", p_seconds: 0, p_usage: {} });
      return fail("OpenAI から通話の番号を受け取れなかったため、会話を始めませんでした。時間をおいてお試しください。", 502, "no_call_id");
    }
    const { data: recorded, error: recErr } = await ctx.db.rpc("set_tutor_call", { p_id: sessionId, p_call: callId, p_secret: encryptKey(apiKey, sessionId) });
    if (recErr || recorded !== true) {
      // 記録できなければ、手元のキーでその場で切る（記録の無い通話を残さない）
      await hangupCall(apiKey, callId);
      await ctx.db.rpc("end_tutor_session", { p_id: sessionId, p_reason: "record_failed", p_seconds: 0, p_usage: {} });
      return fail("会話の記録に失敗したため、会話を始めませんでした。時間をおいてお試しください。", 500, "record_failed");
    }
    return json({ sessionId, maxSeconds, model, mode, answer, captions: mode === "voice" && !!models.transcribe });
  } catch (e) {
    await ctx.db.rpc("end_tutor_session", { p_id: sessionId, p_reason: "provider_error", p_seconds: 0, p_usage: {} });
    const err = e instanceof TutorError ? e : new TutorError("provider_down", "会話を始められませんでした。", 502);
    return fail(err.message, err.status, err.code);
  }
}
