// 答案の写真を表示する（2026-10-27）。GET /api/image?path=…
//   読めるかどうかは、本人のログインのまま Storage から読むことで、DB の規則（RLS）に決めさせる
//   （先生は自分の学校、生徒は自分に返却された答案だけ）。暗号化した写真は、ここで復号して返す（lib/crypto/envelope.ts）
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptImage } from "@/lib/crypto/envelope";
import { isImagePath, mimeOfPath } from "@/lib/image-paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const path = new URL(req.url).searchParams.get("path");
  if (!isImagePath(path)) return NextResponse.json({ error: "画像の指定が正しくありません。" }, { status: 400 });
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "ログインしてください。" }, { status: 401 });
  const { data: blob, error } = await db.storage.from("answer-sheets").download(path);
  if (error || !blob) return NextResponse.json({ error: "画像が見つからないか、見る権限がありません。" }, { status: 404 });
  try {
    const out = await decryptImage(Buffer.from(await blob.arrayBuffer()), path, mimeOfPath(path));
    return new NextResponse(new Uint8Array(out.data), {
      headers: {
        "content-type": out.mime === "application/octet-stream" ? mimeOfPath(path) : out.mime,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-disposition": "inline",
      },
    });
  } catch {
    return NextResponse.json({ error: "画像を復号できませんでした（鍵金庫の設定を確認してください）。" }, { status: 500 });
  }
}
