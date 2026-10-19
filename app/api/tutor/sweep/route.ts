// チャッピー先生の見回り：定期処理（pg_cron → pg_net の POST、Vercel Cron の GET）から呼ぶ。
// ブラウザが来なくても（強制終了・通信断・生存確認の停止・サーバーの再起動のあと）、終わらせるべき通話を切る。
// 認証は Authorization: Bearer <CRON_SECRET>（未設定なら常に断る）。応答に秘密・キー・会話の中身は含めない。
import { NextResponse } from "next/server";
import { featureOff } from "@/lib/tutor/server";
import { runSweep, sweepAuthorized } from "@/lib/tutor/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request) {
  const headers = { "cache-control": "no-store" };
  if (!sweepAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  try {
    return NextResponse.json({ ok: true, ...(await runSweep({ featureOff: featureOff() })) }, { headers });
  } catch (e) {
    console.error("[tutor-sweep]", e instanceof Error ? e.message : "失敗");
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "失敗" }, { status: 500, headers });
  }
}
export const GET = handle;
export const POST = handle;
