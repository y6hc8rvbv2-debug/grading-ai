// ============================================================================
// 模範解答・配点表からテストの設問を読み取る（サーバー専用）
//
//   POST /api/test-import { requestId, files: [{ path, kind, name }], force? }
//     files は、画面が Storage の {school_id}/imports/{requestId}/ に保存した資料（模範解答・問題用紙・配点表・生徒の答案）
//     → { ok, importId, result, cached }
//
// 重複実行の防止（0007 の test_imports）
//   - 同じ requestId の再送（連打・通信の再送）は、同じ読み取りとして扱う（実行中なら 202、終わっていれば同じ結果）
//   - 同じ資料（内容の sha256 と種類が同じ）の読み取りは、実行中なら断り、終わっていれば結果を再利用する
//     （force: true のときだけ、もう一度 AI に読ませる）
// テスト・答案・成績には書き込まない（登録は画面の「登録する」で行う）。
// ANTHROPIC_API_KEY はサーバーの中だけで使い、応答・ログには出さない。
// ============================================================================
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { aiConfig, readGradingResponse, toGradingError, GradingError } from "@/lib/ai/grade";
import { heicToJpeg, looksLikeHeic } from "@/lib/ai/heic";
import {
  IMPORT_SCHEMA, IMPORT_SYSTEM, buildImportContent, normalizeImport, type ImportSource, type SourceKind,
} from "@/lib/ai/test-import";
import { costOfStage } from "@/lib/grading/cost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: SourceKind[] = ["key", "paper", "student"];
const MAX_FILES = 12;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;     // API の1リクエストの上限（32MB）に base64 で収まる大きさ
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const fail = (message: string, status: number, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error: message, ...extra }, { status });

type FileIn = { path: string; kind: SourceKind; name: string };

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { requestId?: unknown; files?: unknown; force?: unknown } | null;
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  const force = body?.force === true;
  const files: FileIn[] = Array.isArray(body?.files)
    ? (body!.files as Record<string, unknown>[]).map((f) => ({
        path: String(f?.path ?? ""), kind: String(f?.kind ?? "") as SourceKind, name: String(f?.name ?? "").slice(0, 120),
      }))
    : [];
  if (!UUID.test(requestId)) return fail("画面の情報が古くなっています。画面を再読み込みしてください。", 400);
  if (!files.length || files.length > MAX_FILES) return fail(`資料は1〜${MAX_FILES}ファイルにしてください。`, 400);
  if (files.some((f) => !KINDS.includes(f.kind))) return fail("資料の種類を選び直してください。", 400);
  if (!files.some((f) => f.kind === "key")) return fail("模範解答の画像またはPDFを1つ以上選んでください。", 400);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("ログインしていません。もう一度ログインしてください。", 401);
  const cfg = aiConfig();
  if (!cfg.enabled) return fail("採点AIが設定されていません。管理者に、サーバーの環境変数 ANTHROPIC_API_KEY の設定を依頼してください。", 503);
  const { data: prof } = await supabase.from("profiles").select("school_id").eq("id", user.id).maybeSingle();
  if (!prof?.school_id) return fail("所属校が設定されていません。管理者に確認してください。", 403);
  const schoolId = prof.school_id as string;
  const prefix = `${schoolId}/imports/${requestId}/`;
  if (files.some((f) => !f.path.startsWith(prefix) || f.path.includes(".."))) return fail("資料の保存先が正しくありません。もう一度選び直してください。", 400);

  /* ------------------------------------------------ 同じ操作の再送 */
  const { data: same } = await supabase.from("test_imports").select("id, status, result, error").eq("request_id", requestId).maybeSingle();
  if (same?.status === "done") return NextResponse.json({ ok: true, importId: same.id, result: same.result, cached: true });
  if (same?.status === "running") return NextResponse.json({ ok: true, pending: true }, { status: 202 });
  if (same?.status === "failed") return fail(same.error || "読み取りに失敗しました。もう一度お試しください。", 409, { code: "failed" });

  /* ------------------------------------------------ 資料を読む */
  const sources: ImportSource[] = [];
  const hashes: string[] = [];
  let total = 0;
  for (const f of files) {
    const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
    const { data: blob, error } = await supabase.storage.from("answer-sheets").download(f.path);
    if (error || !blob) return fail("資料を読み込めませんでした。もう一度選び直してください。", 400);
    let buf: Buffer = Buffer.from(await blob.arrayBuffer());
    hashes.push(`${f.kind}:${createHash("sha256").update(buf).digest("hex")}`);
    let mediaType: ImportSource["mediaType"] | null =
      ext === "pdf" ? "pdf" : ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : null;
    if (ext === "heic" || ext === "heif" || looksLikeHeic(buf)) {
      try { buf = await heicToJpeg(buf); mediaType = "image/jpeg"; } catch {
        return fail(`「${f.name}」（HEIC）を変換できませんでした。JPEG で保存し直して選んでください。`, 400);
      }
    }
    if (!mediaType) return fail(`「${f.name}」は使えない形式です。JPEG / PNG / HEIC / PDF を選んでください。`, 400);
    if (mediaType !== "pdf" && buf.length > MAX_IMAGE_BYTES) return fail(`「${f.name}」が大きすぎます（画像は1枚5MBまで）。`, 400);
    total += buf.length;
    sources.push({ kind: f.kind, name: f.name || `資料${sources.length + 1}`, mediaType, data: buf.toString("base64") });
  }
  if (total > MAX_TOTAL_BYTES) return fail("資料が大きすぎます（合計20MBまで）。PDF はページを分けて選んでください。", 400);
  const inputSha = createHash("sha256").update(hashes.join("|")).digest("hex");

  /* ------------------------------------------------ 同じ資料の読み取り */
  if (!force) {
    const { data: prev } = await supabase.from("test_imports").select("id, result")
      .eq("input_sha", inputSha).eq("status", "done").order("created_at", { ascending: false }).limit(1);
    if (prev?.length) return NextResponse.json({ ok: true, importId: prev[0].id, result: prev[0].result, cached: true });
  }
  const { data: job, error: e1 } = await supabase.from("test_imports").insert({
    school_id: schoolId, created_by: user.id, request_id: requestId, input_sha: inputSha,
    files: files.map((f) => ({ path: f.path, kind: f.kind, name: f.name })), model: cfg.model,
  }).select("id").single();
  if (e1?.code === "23505") {
    const { data: again } = await supabase.from("test_imports").select("id").eq("request_id", requestId).maybeSingle();
    if (again) return NextResponse.json({ ok: true, pending: true }, { status: 202 });
    return fail("同じ資料をいま読み取っています。終わるまでお待ちください。", 409, { code: "running" });
  }
  if (e1 || !job) return fail("読み取りを始められませんでした。管理者が Supabase で 0007_test_import.sql を実行済みか確認してください。", 500);

  /* ------------------------------------------------ AI で読み取る（1回だけ） */
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2 });
    // 設問が多いと出力が長くなるので、時間切れを避けるため stream で受け取る
    const message = await client.beta.messages.stream({
      model: cfg.model,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: IMPORT_SCHEMA as unknown as Record<string, unknown> } },
      system: IMPORT_SYSTEM,
      messages: [{ role: "user", content: buildImportContent(sources) }],
      ...(cfg.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    }).finalMessage();
    const { parsed, model, usage } = readGradingResponse(message);
    const result = normalizeImport(parsed, files.map((f) => f.kind));
    const tokens = { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0, cacheWrite: usage.cache_creation_input_tokens ?? 0, cacheRead: usage.cache_read_input_tokens ?? 0 };
    await supabase.from("test_imports").update({
      status: "done", result, model, usage: tokens, cost_usd: costOfStage("opus", tokens), finished_at: new Date().toISOString(),
    }).eq("id", job.id);
    return NextResponse.json({ ok: true, importId: job.id, result, cached: false });
  } catch (e) {
    const err = e instanceof GradingError ? e : toGradingError(e);
    await supabase.from("test_imports").update({ status: "failed", error: err.message.slice(0, 500), finished_at: new Date().toISOString() }).eq("id", job.id);
    return fail(err.message.replace("採点", "読み取り"), err.status);
  }
}
