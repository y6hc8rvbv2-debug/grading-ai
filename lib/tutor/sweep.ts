// チャッピー先生の見回り（サーバー専用）：ブラウザが来なくても、終わらせるべき通話をサーバーが切る。
//   - 定期処理（Supabase の pg_cron → pg_net、または Vercel Cron）が /api/tutor/sweep を呼ぶ（docs/TUTOR-SWEEP.md）
//   - DB の tutor_sweep_due() が、上限時間・停止・同意の撤回・生存確認の途絶で会話を終わらせ、切れていない通話を返す
//   - 会話ごとの資格情報（本人のキーの暗号文。追加認証データは会話のID）を復号し、本人のキーで hangup を呼ぶ
//   - 結果は tutor_sweep_record() に記録（失敗は間隔を広げて再試行。保持の上限を過ぎたら資格情報を消して gave_up）
// ここで使う秘密：SUPABASE_SERVICE_ROLE_KEY（見回りの2つの関数を呼ぶためだけ）・CRON_SECRET・TUTOR_KEY_ENCRYPTION_KEY。
// 管理者・学校の OpenAI キーは使わない（読むのは会話ごとの本人のキーの暗号文だけ）。
import "server-only";
import { timingSafeEqual } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { decryptKey } from "@/lib/tutor/crypto";
import { hangupCallDetailed } from "@/lib/tutor/openai";

/** 定期処理からの呼び出しか（Authorization: Bearer <CRON_SECRET>）。秘密が未設定・短すぎるときは常に断る */
export function sweepAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 32) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

type Due = { session_id: string; call_id: string; ciphertext: string; attempts: number; end_reason: string };

export async function runSweep(o: { featureOff: boolean }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("見回りの設定（SUPABASE_SERVICE_ROLE_KEY）がありません");
  const db = createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const stale = Math.min(600, Math.max(30, Number(process.env.TUTOR_STALE_SECONDS) || 90));
  const { data, error } = await db.rpc("tutor_sweep_due", { p_feature_off: o.featureOff, p_stale_seconds: stale, p_limit: 50 });
  if (error) throw new Error(`見回りの読み取りに失敗しました（${error.message}）`);
  const rows = (data ?? []) as Due[];
  const results = await Promise.all(rows.map(async (r) => {
    let res: { ok: boolean; error: string };
    let k = "";
    try { k = decryptKey(r.ciphertext, r.session_id); } catch { /* 下で記録 */ }
    res = k ? await hangupCallDetailed(k, r.call_id) : { ok: false, error: "復号できない" };
    const { data: status } = await db.rpc("tutor_sweep_record", { p_id: r.session_id, p_ok: res.ok, p_error: res.error });
    return { status: String(status ?? ""), ok: res.ok };
  }));
  return {
    attempted: results.length,
    done: results.filter((x) => x.status === "done").length,
    failed: results.filter((x) => x.status === "failed").length,
    gaveUp: results.filter((x) => x.status === "gave_up").length,
  };
}
