// ============================================================================
// AIエンジンの設定（設定画面の「AIエンジン」）
//
//   GET  /api/ai/models
//        いま使っているモデル（段階ごと）・学校の設定・このキーで使えるモデル（Anthropic の Models API）・
//        各段階のより新しいモデルの候補・料金の目安を返す。キーの値は返さない
//   POST /api/ai/models { fast?, standard?, top?, concurrency? }（管理者だけ）
//        学校の設定を保存する。null は「環境変数・既定値に従う」。
//        モデルは Models API の一覧にあるもの（一覧が取れないときは登録表にあるもの）だけを受け付ける
// ============================================================================
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { aiConfig } from "@/lib/ai/grade";
import { loadSchoolAi } from "@/lib/ai/settings";
import {
  DEFAULT_MODELS, MODEL_CATALOG, TIERS, isModelId, labelOf, newerModels, priceOf, tierOfModel, type Tier,
} from "@/lib/grading/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (message: string, status: number) => NextResponse.json({ error: message }, { status });

type Available = { id: string; display_name: string; created_at: string };

async function listAvailable(): Promise<Available[] | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 15_000 });
    const out: Available[] = [];
    for await (const m of client.models.list({ limit: 100 })) {
      out.push({ id: m.id, display_name: m.display_name, created_at: String(m.created_at) });
      if (out.length >= 300) break;
    }
    return out;
  } catch {
    return null;
  }
}

async function actor() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: fail("ログインしていません。もう一度ログインしてください。", 401) } as const;
  const { data: prof } = await supabase.from("profiles").select("school_id, role").eq("id", user.id).maybeSingle();
  if (!prof?.school_id || !["admin", "teacher"].includes(prof.role)) return { error: fail("所属校が設定されていません。", 403) } as const;
  return { supabase, user, schoolId: prof.school_id as string, admin: prof.role === "admin" } as const;
}

export async function GET() {
  const a = await actor();
  if ("error" in a) return a.error;
  const school = await loadSchoolAi(a.supabase, a.schoolId);
  const cfg = aiConfig(school.overrides);
  const available = await listAvailable();
  const describe = (id: string) => ({ id, label: labelOf(id), tier: tierOfModel(id), ...priceOf(id) });
  return NextResponse.json({
    enabled: cfg.enabled,
    canManage: a.admin,
    current: Object.fromEntries(TIERS.map((t) => [t, describe(cfg.models[t])])),
    defaults: DEFAULT_MODELS,
    overrides: school.overrides,
    concurrency: school.concurrency,
    saved: school.saved,
    // 一覧が取れないとき（キーが無い・通信できない）は登録表だけを候補にする
    available: (available ?? MODEL_CATALOG.map((m) => ({ id: m.id, display_name: m.label, created_at: "" })))
      .map((m) => ({ ...describe(m.id), display: m.display_name || labelOf(m.id), createdAt: m.created_at })),
    availableFrom: available ? "models_api" : "catalog",
    newer: available ? newerModels(available, cfg.models) : {},
  });
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("操作元を確認できません。", 403);
  const a = await actor();
  if ("error" in a) return a.error;
  if (!a.admin) return fail("AIエンジンを変えられるのは管理者だけです。", 403);
  const body = await request.json().catch(() => null) as Partial<Record<Tier | "concurrency", unknown>> | null;
  if (!body) return fail("設定の内容を読み取れませんでした。", 400);

  const available = await listAvailable();
  const allowed = new Set((available ?? MODEL_CATALOG.map((m) => ({ id: m.id }))).flatMap((m) => [m.id, m.id.replace(/-\d{8}$/, "")]));
  const row: Record<string, unknown> = { school_id: a.schoolId, updated_by: a.user.id, updated_at: new Date().toISOString() };
  for (const tier of TIERS) {
    const v = body[tier];
    if (v === undefined) continue;
    if (v === null || v === "") { row[`model_${tier}`] = null; continue; }
    if (!isModelId(v) || !allowed.has(v)) return fail(`「${String(v)}」は、このAPIキーで使えるモデルとして確認できませんでした。一覧から選んでください。`, 400);
    row[`model_${tier}`] = v;
  }
  if (body.concurrency !== undefined) {
    const n = Number(body.concurrency);
    if (!Number.isInteger(n) || n < 1 || n > 16) return fail("同時に採点する枚数は1〜16で指定してください。", 400);
    row.concurrency = n;
  }
  const { error } = await a.supabase.from("ai_settings").upsert(row, { onConflict: "school_id" });
  if (error) return fail("設定を保存できませんでした。管理者が Supabase で 0019_ver6.sql を実行済みか確認してください。", 500);
  await a.supabase.from("audit_logs").insert({
    school_id: a.schoolId, actor_id: a.user.id, action: "ai.settings", target_table: "ai_settings", target_id: a.schoolId,
    detail: Object.fromEntries(Object.entries(row).filter(([k]) => k.startsWith("model_") || k === "concurrency")),
  });
  return NextResponse.json({ ok: true });
}
