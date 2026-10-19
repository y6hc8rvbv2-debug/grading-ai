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
// 無期限に「実行中」にしない
//   - AI の呼び出しは AI_DEADLINE_MS で打ち切り、記録を failed にして理由を返す（Vercel の上限 maxDuration より前に終える）
//   - それでも関数が強制終了されて running のまま残った記録は、STALE_RUNNING_MS を過ぎたら failed にする
//     （同じ requestId の確認・同じ資料の新しい読み取りのときに片付ける。片付けた読み取りの AI は、もう動いていない）
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
  GENERATE_KEY_SYSTEM, proposePoints, IMPORT_SCHEMA, IMPORT_SYSTEM, buildImportContent, normalizeImport, type ImportSource, type SourceKind,
} from "@/lib/ai/test-import";
import { costOfModel, traitsOf, type TokenUsage } from "@/lib/grading/models";
import { loadSchoolAi } from "@/lib/ai/settings";
import {
  ADJUDICATE_SCHEMA, ADJUDICATE_SYSTEM, VERIFY_SCHEMA, VERIFY_SYSTEM, mergeVerification, needsAdjudication,
  type Decision, type VerifyAnswer,
} from "@/lib/ai/answer-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const AI_DEADLINE_MS = 270_000;                  // 要求の受付から。残りの30秒で記録を保存して応答する
const STALE_RUNNING_MS = (maxDuration + 60) * 1000;
const STALE_MESSAGE = "前回の読み取りが時間内に終わりませんでした（サーバーの処理が途中で止まりました）。もう一度「AIで読み取って入力する」を押してください。";
const TIMEOUT_MESSAGE = "AI の読み取りが時間内（約4分半）に終わりませんでした。資料の枚数を減らすか、時間をおいて、もう一度お試しください。";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: SourceKind[] = ["key", "paper", "student"];
const MAX_FILES = 12;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;     // API の1リクエストの上限（32MB）に base64 で収まる大きさ
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const fail = (message: string, status: number, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error: message, ...extra }, { status });

type FileIn = { path: string; kind: SourceKind; name: string };

export async function POST(request: Request) {
  const startedAt = Date.now();
  const body = await request.json().catch(() => null) as { requestId?: unknown; files?: unknown; force?: unknown; generate?: unknown } | null;
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  const force = body?.force === true;
  const generate = body?.generate === true;
  const files: FileIn[] = Array.isArray(body?.files)
    ? (body!.files as Record<string, unknown>[]).map((f) => ({
        path: String(f?.path ?? ""), kind: String(f?.kind ?? "") as SourceKind, name: String(f?.name ?? "").slice(0, 120),
      }))
    : [];
  if (!UUID.test(requestId)) return fail("画面の情報が古くなっています。画面を再読み込みしてください。", 400);
  if (!files.length || files.length > MAX_FILES) return fail(`資料は1〜${MAX_FILES}ファイルにしてください。`, 400);
  if (files.some((f) => !KINDS.includes(f.kind))) return fail("資料の種類を選び直してください。", 400);
  if (!generate && !files.some((f) => f.kind === "key")) return fail("模範解答の画像またはPDFを1つ以上選んでください。", 400);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("ログインしていません。もう一度ログインしてください。", 401);
  const cfg = aiConfig();
  if (!cfg.enabled) return fail("採点AIが設定されていません。管理者に、サーバーの環境変数 ANTHROPIC_API_KEY の設定を依頼してください。", 503);
  const { data: prof } = await supabase.from("profiles").select("school_id, role").eq("id", user.id).maybeSingle();
  if (!prof?.school_id || !["admin", "teacher"].includes(prof.role)) return fail("所属校が設定されていません。管理者に確認してください。", 403);
  const schoolId = prof.school_id as string;
  const models = aiConfig((await loadSchoolAi(supabase, schoolId)).overrides).models;
  const prefix = `${schoolId}/imports/${requestId}/`;
  if (files.some((f) => !f.path.startsWith(prefix) || f.path.includes(".."))) return fail("資料の保存先が正しくありません。もう一度選び直してください。", 400);

  /* ------------------------------------------------ 同じ操作の再送 */
  const staleBefore = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
  const { data: same } = await supabase.from("test_imports").select("id, status, result, error, created_at").eq("request_id", requestId).maybeSingle();
  if (same?.status === "done") return NextResponse.json({ ok: true, importId: same.id, result: same.result, cached: true });
  if (same?.status === "running" && new Date(same.created_at).getTime() < Date.now() - STALE_RUNNING_MS) {
    await supabase.from("test_imports").update({ status: "failed", error: STALE_MESSAGE, finished_at: new Date().toISOString() })
      .eq("id", same.id).eq("status", "running");
    return fail(STALE_MESSAGE, 409, { code: "failed" });
  }
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
  const inputSha = createHash("sha256").update(`${generate ? "generate-v2" : "read"}|${hashes.join("|")}`).digest("hex");

  /* ------------------------------------------------ 同じ資料の読み取り */
  if (!force) {
    const { data: prev } = await supabase.from("test_imports").select("id, result")
      .eq("input_sha", inputSha).eq("status", "done").order("created_at", { ascending: false }).limit(1);
    if (prev?.length) return NextResponse.json({ ok: true, importId: prev[0].id, result: prev[0].result, cached: true });
  }
  // 強制終了で running のまま残った同じ資料の読み取りを片付ける（残っていると、同じ資料を二度と読み取れない）
  await supabase.from("test_imports").update({ status: "failed", error: STALE_MESSAGE, finished_at: new Date().toISOString() })
    .eq("school_id", schoolId).eq("input_sha", inputSha).eq("status", "running").lt("created_at", staleBefore);
  const { data: job, error: e1 } = await supabase.from("test_imports").insert({
    school_id: schoolId, created_by: user.id, request_id: requestId, input_sha: inputSha,
    files: files.map((f) => ({ path: f.path, kind: f.kind, name: f.name })), model: generate ? `${models.standard}+${models.top}` : models.top,
  }).select("id").single();
  if (e1?.code === "23505") {
    const { data: again } = await supabase.from("test_imports").select("id").eq("request_id", requestId).maybeSingle();
    if (again) return NextResponse.json({ ok: true, pending: true }, { status: 202 });
    return fail("同じ資料をいま読み取っています。終わるまでお待ちください。", 409, { code: "running" });
  }
  if (e1 || !job) return fail("読み取りを始められませんでした。管理者が Supabase で 0007_test_import.sql を実行済みか確認してください。", 500);

  /* ------------------------------------------------ AI で読み取る（1回だけ） */
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), Math.max(1000, AI_DEADLINE_MS - (Date.now() - startedAt)));
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2 });
    const spent: TokenUsage & { usd: number } = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, usd: 0 };
    // 1回の呼び出し（設問が多いと出力が長くなるので、時間切れを避けるため stream で受け取る）
    const ask = async (o: { model: string; system: string; schema: unknown; effort: "low" | "medium" | "high"; content: ReturnType<typeof buildImportContent>; signal: AbortSignal; maxTokens?: number }) => {
      const traits = traitsOf(o.model);
      const message = await client.beta.messages.stream({
        model: o.model,
        max_tokens: o.maxTokens ?? 32000,
        ...(traits.adaptive ? { thinking: { type: "adaptive" as const } } : {}),
        output_config: { ...(traits.effort ? { effort: o.effort } : {}), format: { type: "json_schema", schema: o.schema as Record<string, unknown> } },
        system: o.system,
        messages: [{ role: "user", content: o.content }],
        ...(cfg.fallbacks && traits.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      }, { signal: o.signal }).finalMessage();
      const r = readGradingResponse(message);
      const u = { input: r.usage.input_tokens ?? 0, output: r.usage.output_tokens ?? 0, cacheWrite: r.usage.cache_creation_input_tokens ?? 0, cacheRead: r.usage.cache_read_input_tokens ?? 0 };
      spent.input += u.input; spent.output += u.output; spent.cacheWrite! += u.cacheWrite; spent.cacheRead! += u.cacheRead;
      spent.usd += costOfModel(r.model || o.model, u);
      return r;
    };
    const content = buildImportContent(sources);
    let result: ReturnType<typeof normalizeImport>;
    let served = models.top;
    if (!generate) {
      // 模範解答がある：最上位モデルで読み取る（ver5 と同じ）
      const r = await ask({ model: models.top, system: IMPORT_SYSTEM, schema: IMPORT_SCHEMA, effort: "high", content, signal: deadline.signal });
      served = r.model;
      result = proposePoints(normalizeImport(r.parsed, files.map((f) => f.kind), false));
    } else {
      // 模範解答がない（ver6）：下書き（標準モデル）と独立検算（最上位モデル）を同時に動かす → 食い違いだけを判定
      const verifyContent = [...content.slice(0, -1), { type: "text" as const, text: "上の資料の問題を、すべて自分で解いてください。" }];
      const [draft, check] = await Promise.allSettled([
        ask({ model: models.standard, system: GENERATE_KEY_SYSTEM, schema: IMPORT_SCHEMA, effort: "medium", content, signal: deadline.signal }),
        ask({ model: models.top, system: VERIFY_SYSTEM, schema: VERIFY_SCHEMA, effort: "medium", content: verifyContent, signal: deadline.signal, maxTokens: 16000 }),
      ]);
      if (draft.status === "rejected") throw draft.reason;
      served = draft.value.model;
      result = proposePoints(normalizeImport(draft.value.parsed, files.map((f) => f.kind), true));
      const verify = check.status === "fulfilled"
        ? (((check.value.parsed as { answers?: VerifyAnswer[] })?.answers) ?? []).filter((v) => v && typeof v.big === "number" && typeof v.sub === "string")
        : null;
      const verifyError = check.status === "rejected"
        ? (deadline.signal.aborted ? "時間内に終わりませんでした" : (check.reason instanceof Error ? check.reason.message : "失敗しました")).slice(0, 120)
        : undefined;
      // 判定（食い違った設問・記述問題だけ。大問ごとに並列）。残り時間が少なければ行わない（要確認のまま返す）
      const pending = needsAdjudication(result, verify);
      let decisions: Decision[] | null = null;
      const left = AI_DEADLINE_MS - (Date.now() - startedAt);
      if (pending.length && left > 45_000) {
        const judge = new AbortController();
        const stop = setTimeout(() => judge.abort(), left - 15_000);
        const onDeadline = () => judge.abort();
        deadline.signal.addEventListener("abort", onDeadline, { once: true });
        try {
          const bigs = [...new Set(pending.map((x) => x.q.big))];
          const groups = bigs.length <= 6 ? bigs.map((b) => [b]) : Array.from({ length: 6 }, (_, i) => bigs.filter((_, j) => j % 6 === i));
          const parts = await Promise.allSettled(groups.map((g) => {
            const items = pending.filter((x) => g.includes(x.q.big)).map((x) => ({
              big: x.q.big, sub: x.q.sub, label: `大問${x.q.bigLabel}${x.q.sub ? `-${x.q.sub}` : ""}`, type: x.q.type, A: x.q.correct, B: x.other,
            }));
            return ask({
              model: models.top, system: ADJUDICATE_SYSTEM, schema: ADJUDICATE_SCHEMA, effort: "high", signal: judge.signal, maxTokens: 16000,
              content: [...content.slice(0, -1), { type: "text" as const, text: `次の設問について、答えAと答えBのどちらが正しいかを判定してください。\n${JSON.stringify(items, null, 2)}` }],
            });
          }));
          decisions = parts.flatMap((p) => (p.status === "fulfilled" ? (((p.value.parsed as { decisions?: Decision[] })?.decisions) ?? []) : []));
        } finally {
          clearTimeout(stop);
          deadline.signal.removeEventListener("abort", onDeadline);
        }
      }
      result = mergeVerification(result, verify, decisions, { verifyError });
    }
    const tokens = { input: spent.input, output: spent.output, cacheWrite: spent.cacheWrite, cacheRead: spent.cacheRead };
    await supabase.from("test_imports").update({
      status: "done", result, model: served, usage: tokens, cost_usd: spent.usd, finished_at: new Date().toISOString(),
    }).eq("id", job.id);
    return NextResponse.json({ ok: true, importId: job.id, result, cached: false });
  } catch (e) {
    const err = deadline.signal.aborted ? new GradingError(TIMEOUT_MESSAGE, 500) : e instanceof GradingError ? e : toGradingError(e);
    await supabase.from("test_imports").update({ status: "failed", error: err.message.slice(0, 500), finished_at: new Date().toISOString() }).eq("id", job.id);
    return fail(err.message.replace("採点", "読み取り"), err.status);
  } finally {
    clearTimeout(timer);
  }
}
