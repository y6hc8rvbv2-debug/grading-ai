// チャッピー先生：本人の OpenAI API キーの登録・モデルの選択・削除。
//   - キーは HTTPS でだけ受け取る。応答・ログ・監査ログにキーを出さない（末尾4文字だけを目印にする）
//   - 「保存する」を選んだときだけ、暗号化して保存する（暗号鍵は DB に置かない）
//   - 確認は本人のキーで GET /v1/models を呼ぶだけ（料金はかからない）。管理者のキーは使わない
import { canStoreKeys, encryptKey, keyHint } from "@/lib/tutor/crypto";
import { TutorError, listModels, looksLikeKey } from "@/lib/tutor/openai";
import { fail, hangupSessions, json, requireStudent, secureTransport, sessionRefusal } from "@/lib/tutor/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function body(req: Request) {
  const text = await req.text();
  if (text.length > 4096) return null;
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; }
}

export async function POST(req: Request) {
  const ctx = await requireStudent(req, { write: true });
  if (ctx instanceof Response) return ctx;
  if (!secureTransport(req)) return fail("キーは HTTPS の画面からだけ登録できます。", 400, "insecure");
  const b = await body(req);
  const apiKey = typeof b?.apiKey === "string" ? b.apiKey.trim() : "";
  const payer = b?.payer === "guardian" ? "guardian" : b?.payer === "self" ? "self" : null;
  const store = b?.store === true;
  if (!payer) return fail("料金を支払う人（本人／保護者）を選んでください。", 400, "payer");
  if (!looksLikeKey(apiKey)) return fail("API キーの形が正しくありません（sk- で始まるキーを貼り付けてください）。", 400, "invalid_key");
  if (store && !canStoreKeys()) return fail("この学校の設定では、キーを保存できません。「保存しない」を選んでください。", 400, "no_storage");

  const { error: limited } = await ctx.db.rpc("tutor_log", { p_action: "key_attempt" });
  if (limited) { const r = sessionRefusal(limited.message); return fail(r.text, r.status, r.code); }

  let models;
  try {
    models = await listModels(apiKey);
  } catch (e) {
    await ctx.db.rpc("tutor_log", { p_action: "key_failed" });
    const err = e instanceof TutorError ? e : new TutorError("provider_down", "キーを確かめられませんでした。", 502);
    return fail(err.message, err.status, err.code);
  }
  if (!models.voice.length) {
    return fail("このキーでは、音声の会話に対応したモデルが見つかりません。OpenAI の管理画面でプロジェクトの権限（モデルの利用）を確かめてください。", 400, "no_realtime");
  }
  if (store) {
    const { data: school } = await ctx.db.rpc("current_student_school");
    const { error } = await ctx.db.from("tutor_credentials").upsert({
      student_id: ctx.studentId, school_id: school, user_id: ctx.userId, provider: "openai", payer,
      ciphertext: encryptKey(apiKey, ctx.studentId), key_hint: keyHint(apiKey), model: "",
      status: "active", updated_at: new Date().toISOString(), revoked_at: null,
    }, { onConflict: "student_id" });
    if (error) return fail("キーを保存できませんでした。管理者が 0012_voice_tutor.sql を実行済みか確認してください。", 500, "save_failed");
    await ctx.db.rpc("tutor_log", { p_action: "key_saved" });
  }
  return json({ ok: true, stored: store, hint: keyHint(apiKey), models: models.voice });
}

/** 使うモデルを選ぶ（保存したキーのとき） */
export async function PATCH(req: Request) {
  const ctx = await requireStudent(req, { write: true });
  if (ctx instanceof Response) return ctx;
  const b = await body(req);
  const model = typeof b?.model === "string" ? b.model.trim().slice(0, 100) : "";
  if (!model) return fail("モデルを選んでください。", 400, "model");
  const { error, count } = await ctx.db.from("tutor_credentials").update({ model, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("student_id", ctx.studentId).eq("status", "active");
  if (error || !count) return fail("保存したキーがありません。先にキーを登録してください。", 404, "no_key");
  return json({ ok: true, model });
}

/** キーを削除する（進行中の会話の通話を、削除する前のキーで切る。暗号文ごと消す。学習データは消さない） */
export async function DELETE(req: Request) {
  const ctx = await requireStudent(req, { write: true, evenIfOff: true });
  if (ctx instanceof Response) return ctx;
  await hangupSessions(ctx, "key_deleted");
  const { error } = await ctx.db.from("tutor_credentials").delete().eq("student_id", ctx.studentId);
  if (error) return fail("キーを削除できませんでした。時間をおいてお試しください。", 500, "delete_failed");
  await ctx.db.rpc("tutor_log", { p_action: "key_deleted" });
  return json({ ok: true });
}
