// 答案の写真・自動入力の資料を保存する（2026-10-27）。POST /api/image/upload（multipart：path・file）
//   鍵金庫の設定があれば暗号化してから保存する（lib/crypto/envelope.ts）。保存は本人のログインのまま行い、
//   DB の規則（RLS。自分の学校のフォルダ・教職員だけ）に決めさせる
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptImage } from "@/lib/crypto/envelope";
import { isImagePath } from "@/lib/image-paths";
import { crossSite } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request) {
  if (crossSite(req)) return NextResponse.json({ error: "別のサイトからの操作を拒否しました。ページを開き直してください。" }, { status: 403 });
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "ログインしてください。" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const path = form?.get("path"), file = form?.get("file");
  if (!isImagePath(path) || !(file instanceof File)) return NextResponse.json({ error: "保存先かファイルの指定が正しくありません。" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "ファイルが大きすぎます（25MBまで）。" }, { status: 400 });
  try {
    const enc = await encryptImage(Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream", path);
    const { error } = await db.storage.from("answer-sheets").upload(path, enc.data, {
      upsert: true, contentType: enc.encrypted ? "application/octet-stream" : file.type || undefined,
    });
    if (error) return NextResponse.json({ error: "保存できませんでした（自分の学校の答案か、権限を確認してください）。" }, { status: 403 });
    return NextResponse.json({ ok: true, path, encrypted: enc.encrypted });
  } catch {
    return NextResponse.json({ error: "暗号化できませんでした（鍵金庫の設定を確認してください）。" }, { status: 500 });
  }
}
