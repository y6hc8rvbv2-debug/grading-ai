// ============================================================================
// AIエンジンの登録表（ブラウザ・サーバーの両方で使う。秘密は含まない）
//
// ver6 では、採点に使うモデルを「段階（tier）」で扱う。
//   fast     … 高速・低価格。全答案の1回目の採点、答案の振り分け（既定：Claude Haiku 5.5）
//   standard … 中位。1回目で確認が必要な設問の再採点、模範解答の下書き（既定：Claude Sonnet 5.5）
//   top      … 最上位。最後の確認・Opus単独の採点・模範解答の検算（既定：Claude Opus 5.5）
//
// 新しいモデルが出たら、次のどれかで切り替えられる（コードの変更は不要）:
//   1. 設定画面 →「AIエンジン」で管理者が選ぶ（学校ごと。0019 の ai_settings に保存）
//   2. 環境変数 ANTHROPIC_MODEL_FAST / ANTHROPIC_MODEL_STANDARD / ANTHROPIC_MODEL_TOP
//      （ver5 の ANTHROPIC_MODEL_HAIKU / ANTHROPIC_MODEL_SONNET / ANTHROPIC_MODEL も引き続き読む）
//   3. この表の DEFAULT_MODELS を書き換える
// 設定画面は Anthropic の Models API で「このキーで使えるモデル」を調べ、各段階の新しいモデルを候補に出す。
//
// DB の grading_stages.stage は ver5 と同じ "haiku" / "sonnet" / "opus" のまま（既存の記録と互換）。
// 画面には段階名（高速・標準・最上位）と実際のモデル名を出す。
// ============================================================================

export type Tier = "fast" | "standard" | "top";
export type StageKey = "haiku" | "sonnet" | "opus";

export const TIERS: Tier[] = ["fast", "standard", "top"];
export const STAGE_TIER: Record<StageKey, Tier> = { haiku: "fast", sonnet: "standard", opus: "top" };
export const TIER_STAGE: Record<Tier, StageKey> = { fast: "haiku", standard: "sonnet", top: "opus" };
export const TIER_LABEL: Record<Tier, string> = { fast: "高速", standard: "標準", top: "最上位" };
export const TIER_HINT: Record<Tier, string> = {
  fast: "全答案の1回目の採点・答案の振り分けに使います。速くて安いモデルを選びます。",
  standard: "1回目で確認が必要になった設問の再採点・模範解答の下書きに使います。",
  top: "最後の確認・Opus単独の採点・模範解答の検算に使います。いちばん賢いモデルを選びます。",
};

/** 既定のモデル（2026-10 時点の最新世代） */
export const DEFAULT_MODELS: Record<Tier, string> = {
  fast: "claude-haiku-5-5",
  standard: "claude-sonnet-5-5",
  top: "claude-opus-5-5",
};

export type ModelPrice = { input: number; output: number; cacheWrite5m: number; cacheRead: number };

/** 呼び出し方の違い（モデルの世代で変わる） */
export type ModelTraits = {
  /** adaptive thinking に対応（Haiku 4.5 以前は非対応） */
  adaptive: boolean;
  /** output_config.effort に対応 */
  effort: boolean;
  /** 拒否されたときの server-side fallbacks（"default"）に対応 */
  fallbacks: boolean;
};

export type CatalogModel = {
  id: string;
  label: string;
  family: "haiku" | "sonnet" | "opus" | "fable";
  /** 世代（数字が大きいほど新しい）。新しいモデルの判定に使う */
  generation: number;
  price: ModelPrice;
  traits: ModelTraits;
};

// 単価は公式の料金表（USD / 100万トークン、標準料金）。2026-10 時点
export const PRICING_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing（2026-10 取得）";
const p = (input: number, output: number, cacheRead: number): ModelPrice => ({ input, output, cacheWrite5m: input * 1.25, cacheRead });
const MODERN: ModelTraits = { adaptive: true, effort: true, fallbacks: false };

export const MODEL_CATALOG: CatalogModel[] = [
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", family: "haiku", generation: 5.5, price: p(0.10, 0.50, 0.01), traits: MODERN },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", family: "haiku", generation: 4.5, price: p(1, 5, 0.10), traits: { adaptive: false, effort: false, fallbacks: false } },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", family: "sonnet", generation: 5.5, price: p(2, 10, 0.20), traits: { ...MODERN, fallbacks: true } },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", family: "sonnet", generation: 5, price: p(2, 10, 0.20), traits: MODERN },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", family: "opus", generation: 5.5, price: p(4, 20, 0.20), traits: { ...MODERN, fallbacks: true } },
  { id: "claude-opus-5", label: "Claude Opus 5", family: "opus", generation: 5, price: p(5, 25, 0.50), traits: { ...MODERN, fallbacks: true } },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", family: "fable", generation: 5.1, price: p(10, 50, 0.25), traits: { ...MODERN, fallbacks: true } },
];

const FAMILY_TIER: Record<CatalogModel["family"], Tier> = { haiku: "fast", sonnet: "standard", opus: "top", fable: "top" };

/** モデルID（日付つきのIDも可）から登録表の行を探す */
export function catalogEntry(id: string | null | undefined): CatalogModel | undefined {
  if (!id) return undefined;
  const base = id.replace(/-\d{8}$/, "");
  return MODEL_CATALOG.find((m) => m.id === base);
}

/** モデルIDの名前から系列・世代を読む（登録表に無い新しいモデル用）。例: claude-sonnet-6 → sonnet / 6 */
export function parseModelId(id: string): { family: CatalogModel["family"]; generation: number } | null {
  const m = /^claude-(haiku|sonnet|opus|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  if (!m) return null;
  return { family: m[1] as CatalogModel["family"], generation: Number(m[2]) + (m[3] ? Number(m[3]) / 10 : 0) };
}

/** 料金の目安。登録表に無いモデルは、同じ系列の最新の料金で概算する（estimated: true） */
export function priceOf(id: string): { price: ModelPrice; estimated: boolean } {
  const hit = catalogEntry(id);
  if (hit) return { price: hit.price, estimated: false };
  const parsed = parseModelId(id);
  const family = parsed?.family ?? "opus";
  const latest = MODEL_CATALOG.filter((m) => m.family === family).sort((a, b) => b.generation - a.generation)[0];
  return { price: latest.price, estimated: true };
}

/** 呼び出し方。登録表に無いモデルは新しい世代とみなす（adaptive thinking・effort に対応） */
export function traitsOf(id: string): ModelTraits {
  const hit = catalogEntry(id);
  if (hit) return hit.traits;
  const parsed = parseModelId(id);
  if (parsed && parsed.generation < 4.6) return { adaptive: false, effort: false, fallbacks: false };
  return { adaptive: true, effort: true, fallbacks: false };
}

export function labelOf(id: string) {
  const hit = catalogEntry(id);
  if (hit) return hit.label;
  const parsed = parseModelId(id);
  if (!parsed) return id;
  const name = parsed.family[0].toUpperCase() + parsed.family.slice(1);
  return `Claude ${name} ${parsed.generation}`;
}

export function tierOfModel(id: string): Tier | null {
  const hit = catalogEntry(id);
  if (hit) return FAMILY_TIER[hit.family];
  const parsed = parseModelId(id);
  return parsed ? FAMILY_TIER[parsed.family] : null;
}

/** 実際のトークン数から概算費用（USD） */
export type TokenUsage = { input: number; output: number; cacheWrite?: number; cacheRead?: number };
export function costOfModel(id: string, u: TokenUsage) {
  const { price } = priceOf(id);
  return (u.input * price.input + u.output * price.output + (u.cacheWrite ?? 0) * price.cacheWrite5m + (u.cacheRead ?? 0) * price.cacheRead) / 1_000_000;
}

export type ModelOverrides = Partial<Record<Tier, string | null>>;

const VALID_ID = /^claude-[a-z0-9-]{2,60}$/;
export const isModelId = (v: unknown): v is string => typeof v === "string" && VALID_ID.test(v);

/** 段階ごとのモデルを決める。優先順：学校の設定 → 環境変数 → 既定値 */
export function resolveModels(env: Record<string, string | undefined>, school: ModelOverrides = {}): Record<Tier, string> {
  const pick = (tier: Tier, ...envKeys: string[]) => {
    const fromSchool = school[tier];
    if (isModelId(fromSchool)) return fromSchool;
    for (const k of envKeys) if (isModelId(env[k])) return env[k] as string;
    return DEFAULT_MODELS[tier];
  };
  return {
    fast: pick("fast", "ANTHROPIC_MODEL_FAST", "ANTHROPIC_MODEL_HAIKU"),
    standard: pick("standard", "ANTHROPIC_MODEL_STANDARD", "ANTHROPIC_MODEL_SONNET"),
    top: pick("top", "ANTHROPIC_MODEL_TOP", "ANTHROPIC_MODEL"),
  };
}

/** Models API の一覧から、段階ごとに「いま選んでいるものより新しいモデル」を探す（設定画面の案内に使う） */
export function newerModels(available: { id: string; display_name?: string; created_at?: string }[], current: Record<Tier, string>) {
  const out: Partial<Record<Tier, { id: string; label: string }>> = {};
  for (const tier of TIERS) {
    const cur = parseModelId(current[tier]) ?? (catalogEntry(current[tier]) ? { family: catalogEntry(current[tier])!.family, generation: catalogEntry(current[tier])!.generation } : null);
    if (!cur) continue;
    let best: { id: string; generation: number; label: string } | null = null;
    for (const m of available) {
      const parsed = parseModelId(m.id);
      if (!parsed || parsed.family !== cur.family || parsed.generation <= cur.generation) continue;
      if (!best || parsed.generation > best.generation) best = { id: m.id.replace(/-\d{8}$/, ""), generation: parsed.generation, label: m.display_name || labelOf(m.id) };
    }
    if (best) out[tier] = { id: best.id, label: best.label };
  }
  return out;
}
