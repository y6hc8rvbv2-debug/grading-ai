// チャッピー先生：会話を始める。
//   1. 本人の返却済みの問題か・機能が有効か・同意があるか・利用の制限内かを DB で確かめ、会話の記録を作る
//   2. 本人のキー（保存した暗号文を復号、または今回だけ渡されたもの）で、短期の資格情報を発行する
//   3. ブラウザへは短期の資格情報だけを返す（本人の長期キーは返さない）
// どこで失敗しても、別のキー（管理者のキーなど）へ切り替えない。
import { decryptKey } from "@/lib/tutor/crypto";
import { TutorError, callsUrl, listModels, looksLikeKey, mintClientSecret } from "@/lib/tutor/openai";
import { buildContext, buildInstructions, type ReleasedItem } from "@/lib/tutor/prompt";
import { activeConsent, fail, json, releasedItem, requireStudent, secureTransport, sessionRefusal } from "@/lib/tutor/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx = await requireStudent(req, { write: true });
  if (ctx instanceof Response) return ctx;
  const text = await req.text();
  if (text.length > 4096) return fail("要求が大きすぎます。", 400, "bad_request");
  let b: Record<string, unknown> = {};
  try { b = JSON.parse(text); } catch { return fail("要求の形が正しくありません。", 400, "bad_request"); }
  const releaseId = String(b.releaseId ?? ""), qno = Number(b.qno);
  const mode = b.mode === "text" ? "text" : "voice";
  const slow = b.slow === true;

  const { payload, item } = await releasedItem(ctx, releaseId, qno);
  if (!payload || !item) return fail("この問題は、あなたに返却された答案に見つかりません。", 404, "not_found");
  const consent = await activeConsent(ctx);
  if (!consent) return fail("先に「送る内容と同意」を確認して、同意してください。", 403, "tutor_no_consent");

  // 本人のキー：今回だけ渡されたもの、または保存した暗号文
  let apiKey = typeof b.apiKey === "string" ? b.apiKey.trim() : "";
  if (apiKey && !secureTransport(req)) return fail("キーは HTTPS の画面からだけ使えます。", 400, "insecure");
  let model = typeof b.model === "string" ? b.model.trim() : "";
  if (!apiKey) {
    const { data: cred } = await ctx.db.from("tutor_credentials").select("ciphertext, model, status").eq("student_id", ctx.studentId).maybeSingle();
    if (!cred || cred.status !== "active" || !cred.ciphertext) {
      return fail("あなたの OpenAI API キーが登録されていません。「キーの登録」から登録するか、外部の ChatGPT で復習してください。", 409, "no_key");
    }
    try { apiKey = decryptKey(cred.ciphertext, ctx.studentId); } catch {
      return fail("保存したキーを読み出せませんでした。キーを登録し直してください。", 409, "bad_key_storage");
    }
    model = model || cred.model;
  }
  if (!looksLikeKey(apiKey)) return fail("API キーの形が正しくありません。キーを登録し直してください。", 400, "invalid_key");
  if (!model) return fail("使うモデルを選んでください。", 400, "model");

  // キーの確認（失効・残高不足などをここで知らせる）と、モデルの確認
  let models;
  try { models = await listModels(apiKey); } catch (e) {
    const err = e instanceof TutorError ? e : new TutorError("provider_down", "OpenAI に接続できませんでした。", 502);
    return fail(err.message, err.status, err.code);
  }
  if (!models.realtime.includes(model)) return fail("選んだモデルをこのキーでは使えません。モデルを選び直してください。", 400, "model_unavailable");

  const { data: started, error: refused } = await ctx.db.rpc("start_tutor_session", { p_release: releaseId, p_qno: qno, p_mode: mode, p_model: model });
  if (refused || !started) { const r = sessionRefusal(refused?.message ?? ""); return fail(r.text, r.status, r.code); }
  const sessionId = String((started as { id: string }).id);
  const maxSeconds = Number((started as { max_seconds: number }).max_seconds);

  const context = buildContext(item as ReleasedItem, payload, { sendAnswer: !!consent.send_answer, sendComment: !!consent.send_comment });
  try {
    const secret = await mintClientSecret(apiKey, {
      model, mode, slow, instructions: buildInstructions(context, { slow }),
      transcribeModel: mode === "voice" ? models.transcribe[0] ?? null : null,
    });
    return json({ sessionId, maxSeconds, model, mode, clientSecret: secret.value, expiresAt: secret.expiresAt, callsUrl: callsUrl(), captions: mode === "voice" && models.transcribe.length > 0 });
  } catch (e) {
    await ctx.db.rpc("end_tutor_session", { p_id: sessionId, p_reason: "provider_error", p_seconds: 0, p_usage: {} });
    const err = e instanceof TutorError ? e : new TutorError("provider_down", "会話を始められませんでした。", 502);
    return fail(err.message, err.status, err.code);
  }
}
