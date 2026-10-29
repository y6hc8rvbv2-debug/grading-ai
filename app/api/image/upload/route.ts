// 答案の写真・自動入力の資料を保存する（2026-10-27）。POST /api/image/upload（multipart：path・file）
//   鍵金庫の設定があれば暗号化してから保存する（lib/crypto/envelope.ts）。保存は本人のログインのまま行い、
//   DB の規則（RLS。自分の学校のフォルダ・教職員だけ）に決めさせる
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptImage } from "@/lib/crypto/envelope";
import { isImagePath, sniffMime } from "@/lib/image-paths";
import { crossSite } from "@/lib/security";
import { classifyStorageError, storageLogLine } from "@/lib/storage-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Storage の answer-sheets は1ファイル20MBまで。暗号化で少し増える分を引いておく
const MAX_BYTES = 20 * 1024 * 1024 - 4096;

export async function POST(req: Request) {
  if (crossSite(req)) return NextResponse.json({ error: "別のサイトからの操作を拒否しました。ページを開き直してください。" }, { status: 403 });
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "ログインしてください。" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const path = form?.get("path"), file = form?.get("file");
  if (!isImagePath(path) || !(file instanceof File)) return NextResponse.json({ error: "保存先かファイルの指定が正しくありません。" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "ファイルが大きすぎます（20MBまで）。", code: "too_large" }, { status: 413 });
  const buf = Buffer.from(await file.arrayBuffer());
  // 種類はブラウザの申告ではなく中身で決める（写真・PDF 以外は保存しない）
  const mime = sniffMime(buf);
  if (!mime) return NextResponse.json({ error: "写真（JPEG・PNG・HEIC など）か PDF を選んでください。この形式は保存できません。", code: "type_not_allowed" }, { status: 415 });
  let enc: Awaited<ReturnType<typeof encryptImage>>;
  try {
    enc = await encryptImage(buf, mime, path);
  } catch (e) {
    console.error(`[image/upload] encrypt_failed ${(e as Error)?.name ?? "Error"} user=${user.id.slice(0, 8)}`);
    return NextResponse.json({ error: "暗号化できませんでした（鍵金庫の設定を確認してください）。", code: "encrypt_failed" }, { status: 500 });
  }
  const { error } = await db.storage.from("answer-sheets").upload(path, enc.data, {
    upsert: true, contentType: enc.encrypted ? "application/octet-stream" : mime,
  });
  if (error) {
    const f = classifyStorageError(error);
    console.error(storageLogLine("image/upload", f, error, user.id));
    return NextResponse.json({ error: f.message, code: f.code }, { status: f.status });
  }
  return NextResponse.json({ ok: true, path, encrypted: enc.encrypted });
}
