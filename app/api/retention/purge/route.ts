// 保存期間を過ぎた答案の画像と記録を消す（Vercel Cron が1日1回呼ぶ。vercel.json）。
// 認証：Vercel Cron が送る Authorization: Bearer <CRON_SECRET>。service_role はサーバーの中だけで使う。
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { purgeExpired } from "@/lib/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "CRON_SECRET・SUPABASE_SERVICE_ROLE_KEY が設定されていません" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "認証できません" }, { status: 401 });
  const sb = createAdminClient();
  const fail = (what: string, e: { message: string } | null) => { if (e) throw new Error(`${what}：${e.message}`); };
  try {
    const result = await purgeExpired({
      async schools() {
        const { data, error } = await sb.from("schools").select("id, retention"); fail("学校", error); return data ?? [];
      },
      async expired(schoolId, before, limit) {
        const { data, error } = await sb.from("submissions").select("id, image_paths")
          .eq("school_id", schoolId).is("deleted_at", null).lt("uploaded_at", before).limit(limit);
        fail("答案", error); return data ?? [];
      },
      async removeImages(paths) {
        const { error } = await sb.storage.from("answer-sheets").remove(paths); fail("画像", error);
      },
      async purge(ids) {
        const { data, error } = await sb.rpc("purge_submissions", { p_ids: ids }); fail("削除済みにする", error); return Number(data ?? 0);
      },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
