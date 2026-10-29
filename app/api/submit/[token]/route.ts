// ============================================================================
// 生徒のタブレット・スマホからの答案の提出（ver6）
//
//   GET  /api/submit/{token}   提出リンクの案内（テスト名・クラス・出席番号の一覧・期限）。ログインは不要
//   POST /api/submit/{token}   multipart：studentId と files（答案の写真。1人分・ページ順）
//
// 生徒はログインしなくても、先生が配ったリンク（QRコード）から出せる。
// 生徒アカウントでログインしているときは、本人の出席番号だけを選べ、記録に「本人確認済み」と残る。
// 書き込みは service_role（SUPABASE_SERVICE_ROLE_KEY）で、0019 の関数だけを使う（期限・回数・クラス・上書きの可否は DB が確かめる）。
// 先生がすでに取り込んだ答案・採点が始まった答案は上書きしない。画像は学校専用の保管場所（非公開）に置く。
// ============================================================================
import { NextResponse } from "next/server";
import { classifyStorageError, storageLogLine } from "@/lib/storage-errors";
import { encryptImage } from "@/lib/crypto/envelope";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_PAGES = 10;
const MAX_BYTES = 8 * 1024 * 1024;
const TOKEN = /^[A-Za-z0-9_-]{24,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status, headers: { "cache-control": "no-store" } });

// 同じ端末からの連続送信を抑える（関数のインスタンスごとの簡易な制限。回数の上限は DB が確かめる）
const recent = new Map<string, number[]>();
function tooMany(key: string, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const list = (recent.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  recent.set(key, list);
  if (recent.size > 5000) recent.clear();
  return list.length > limit;
}

function configured() {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/** ログイン中の生徒アカウント（いなければ null） */
async function signedInStudent() {
  try {
    const db = await createClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return null;
    const { data } = await db.from("student_accounts").select("student_id").eq("user_id", user.id).maybeSingle();
    return (data?.student_id as string | undefined) ?? null;
  } catch {
    return null;
  }
}

/** 画像の中身（先頭のバイト）で形式を確かめる。拡張子・申告の形式は信じない */
function sniff(buf: Buffer): "jpg" | "png" | "webp" | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length > 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const params = await ctx.params;   // Next.js 15：params は Promise
  if (!configured()) return fail("この学校では、まだタブレット・スマホからの提出を使えません。先生に伝えてください。", 503);
  if (!TOKEN.test(params.token)) return fail("この提出リンクは使えません。先生に新しいリンクをもらってください。", 404);
  const { data, error } = await createAdminClient().rpc("submit_link_info", { p_token: params.token });
  if (error) return fail("提出リンクを確認できませんでした。時間をおいて、もう一度開いてください。", 500);
  if (!data) return fail("この提出リンクは期限切れか、取り消されています。先生に新しいリンクをもらってください。", 404);
  const me = await signedInStudent();
  const info = data as { students: { id: string; number: number }[] } & Record<string, unknown>;
  return NextResponse.json({ ...info, me: me && info.students.some((s) => s.id === me) ? me : null }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const params = await ctx.params;   // Next.js 15：params は Promise
  if (!configured()) return fail("この学校では、まだタブレット・スマホからの提出を使えません。先生に伝えてください。", 503);
  if (!TOKEN.test(params.token)) return fail("この提出リンクは使えません。先生に新しいリンクをもらってください。", 404);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (tooMany(`${ip}|${params.token}`)) return fail("短い時間に何度も送られました。1分ほど待ってから、もう一度お試しください。", 429);

  const form = await req.formData().catch(() => null);
  if (!form) return fail("送られた内容を読み取れませんでした。もう一度お試しください。", 400);
  const studentId = String(form.get("studentId") ?? "");
  if (!UUID.test(studentId)) return fail("出席番号を選んでください。", 400);
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return fail("答案の写真を1枚以上えらんでください。", 400);
  if (files.length > MAX_PAGES) return fail(`1人分の答案は${MAX_PAGES}枚までです。`, 400);

  const pages: { buf: Buffer; ext: "jpg" | "png" | "webp" }[] = [];
  for (const f of files) {
    if (f.size > MAX_BYTES) return fail("写真が大きすぎます（1枚8MBまで）。もう一度撮り直してください。", 400);
    const buf = Buffer.from(await f.arrayBuffer());
    const ext = sniff(buf);
    if (!ext) return fail("写真の形式が読み取れません。カメラで撮った写真（JPEG / PNG）を選んでください。", 400);
    pages.push({ buf, ext });
  }

  // ログインした生徒は、本人の答案だけを出せる
  const me = await signedInStudent();
  if (me && me !== studentId) return fail("ログインしている本人の出席番号を選んでください。", 403);

  const admin = createAdminClient();
  const { data: claim, error } = await admin.rpc("submit_link_claim", {
    p_token: params.token, p_student: studentId, p_pages: pages.length, p_verified: !!me,
  });
  if (error || !claim) {
    // DB が返す理由（期限切れ・上限・出席番号・上書きできない）は生徒向けの日本語
    const msg = error?.message && /[ぁ-んァ-ン一-龥]/.test(error.message) ? error.message : "提出を受け付けられませんでした。時間をおいて、もう一度お試しください。";
    return fail(msg, error?.code === "P0001" ? 409 : 500);
  }
  const c = claim as { upload_id: string; submission_id: string; school_id: string; test_id: string };
  const paths: string[] = [];
  try {
    for (let i = 0; i < pages.length; i++) {
      const path = `${c.school_id}/${c.test_id}/${c.submission_id}/${i + 1}.${pages[i].ext}`;
      const type = pages[i].ext === "jpg" ? "image/jpeg" : `image/${pages[i].ext}`;
      // 写真は暗号化して保存する（鍵金庫の設定があるとき。lib/crypto/envelope.ts）
      const enc = await encryptImage(pages[i].buf, type, path);
      const { error: e } = await admin.storage.from("answer-sheets").upload(path, enc.data, { upsert: true, contentType: enc.encrypted ? "application/octet-stream" : type });
      if (e) throw e;
      paths.push(path);
    }
    const { error: e2 } = await admin.rpc("submit_link_finish", { p_upload: c.upload_id, p_paths: paths });
    if (e2) throw e2;
  } catch (e) {
    console.error(storageLogLine("submit", classifyStorageError(e), e));
    await admin.rpc("submit_link_finish", { p_upload: c.upload_id, p_paths: [] });
    return fail("写真を保存できませんでした。通信のよい場所で、もう一度送ってください。", 500);
  }
  return NextResponse.json({ ok: true, pages: paths.length }, { headers: { "cache-control": "no-store" } });
}
