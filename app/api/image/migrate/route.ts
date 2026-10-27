// 以前に保存した答案の写真を、あとから暗号化する（管理者。2026-10-27）。POST /api/image/migrate { offset }
//   画面（設定 → 答案の写真の暗号化）が、10人分ずつ繰り返し呼ぶ。暗号化済みの写真は飛ばす（何度呼んでも同じ結果）
//   読み書きは管理者本人のログインのまま行い、DB の規則（RLS）で自分の学校のものだけに限る
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptImage, encryptionProvider, isEncrypted } from "@/lib/crypto/envelope";
import { isImagePath, mimeOfPath } from "@/lib/image-paths";
import { crossSite } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const BATCH = 10;

export async function POST(req: Request) {
  if (crossSite(req)) return NextResponse.json({ error: "別のサイトからの操作を拒否しました。" }, { status: 403 });
  if (!encryptionProvider()) return NextResponse.json({ error: "鍵金庫（IMAGE_ENC_PROVIDER）が設定されていないため、暗号化できません。" }, { status: 400 });
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "ログインしてください。" }, { status: 401 });
  const { data: prof } = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return NextResponse.json({ error: "管理者だけが実行できます。" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const offset = Math.max(0, Math.trunc(Number(body?.offset) || 0));

  const { data: subs, error } = await db.from("submissions").select("id, image_paths").order("id").range(offset, offset + BATCH - 1);
  if (error) return NextResponse.json({ error: "答案の一覧を読めませんでした。" }, { status: 500 });
  const paths = (subs ?? []).flatMap((s) => (s.image_paths ?? []) as string[]);
  const last = (subs ?? []).length < BATCH;
  if (last) {
    // 最後に、テストに残した模範解答・問題用紙も暗号化する
    const { data: tests } = await db.from("tests").select("answer_key_paths");
    for (const t of tests ?? []) paths.push(...(((t as { answer_key_paths?: string[] }).answer_key_paths) ?? []));
  }
  let converted = 0, already = 0, missing = 0;
  for (const path of paths.filter(isImagePath)) {
    const { data: blob } = await db.storage.from("answer-sheets").download(path);
    if (!blob) { missing++; continue; }
    const buf = Buffer.from(await blob.arrayBuffer());
    if (isEncrypted(buf)) { already++; continue; }
    const enc = await encryptImage(buf, blob.type && blob.type !== "application/octet-stream" ? blob.type : mimeOfPath(path), path);
    const { error: e } = await db.storage.from("answer-sheets").upload(path, enc.data, { upsert: true, contentType: "application/octet-stream" });
    if (e) return NextResponse.json({ error: "暗号化した写真を保存できませんでした。時間をおいて続きから再開してください。", next: offset }, { status: 500 });
    converted++;
  }
  return NextResponse.json({ ok: true, next: last ? null : offset + BATCH, converted, already, missing });
}
