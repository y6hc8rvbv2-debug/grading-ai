// チャッピー先生：使えるか・同意・登録済みのキー（末尾4文字だけ）・今日の利用時間
import { canStoreKeys } from "@/lib/tutor/crypto";
import { inAppEnabled, json, requireStudent } from "@/lib/tutor/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await requireStudent(req);
  if (ctx instanceof Response) return ctx;
  const [{ data: status }, { data: consent }, { data: cred }, { data: sweeperOk }] = await Promise.all([
    ctx.db.rpc("tutor_status"),
    ctx.db.from("tutor_consents").select("payer, send_answer, send_comment, save_transcript, share_with_teacher, agreed_at, revoked_at").eq("student_id", ctx.studentId).maybeSingle(),
    // 暗号文は読まない（目印・モデル・状態だけ）
    ctx.db.from("tutor_credentials").select("payer, key_hint, model, status, updated_at").eq("student_id", ctx.studentId).maybeSingle(),
    ctx.db.rpc("tutor_sweeper_ok"),
  ]);
  return json({
    ...(status ?? {}),
    // アプリ内の会話（A方式）を使う設定か。false なら画面に出さない（キーの登録・モデル・料金も出さない）
    inapp: inAppEnabled(),
    consent: consent && !consent.revoked_at ? consent : null,
    credential: cred && cred.status === "active" ? cred : null,
    canStoreKeys: canStoreKeys(),
    // 会話を確実に終わらせる準備（暗号鍵と見回り）。そろっていなければ会話を始めない
    ready: canStoreKeys() && sweeperOk === true,
    prices: process.env.TUTOR_PRICES_JSON ? safePrices(process.env.TUTOR_PRICES_JSON) : null,
  });
}

/** 概算料金の単価（管理者が公式の料金表を見て設定する。1M トークンあたりの米ドル。設定が無ければ概算しない） */
function safePrices(raw: string) {
  try {
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? o : null;
  } catch {
    return null;
  }
}
