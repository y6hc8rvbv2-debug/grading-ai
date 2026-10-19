// AIエンジンの登録表（lib/grading/models.ts）の単体テスト
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MODELS, catalogEntry, costOfModel, labelOf, newerModels, parseModelId, priceOf, resolveModels, tierOfModel, traitsOf,
} from "../../lib/grading/models";

test("既定は最新世代（Haiku 5.5 / Sonnet 5.5 / Opus 5.5）", () => {
  assert.deepEqual(DEFAULT_MODELS, { fast: "claude-haiku-5-5", standard: "claude-sonnet-5-5", top: "claude-opus-5-5" });
  assert.deepEqual(resolveModels({}), DEFAULT_MODELS);
});

test("優先順：学校の設定 → 新しい環境変数 → ver5 の環境変数 → 既定値", () => {
  assert.equal(resolveModels({ ANTHROPIC_MODEL_HAIKU: "claude-haiku-4-5" }).fast, "claude-haiku-4-5");
  assert.equal(resolveModels({ ANTHROPIC_MODEL_HAIKU: "claude-haiku-4-5", ANTHROPIC_MODEL_FAST: "claude-haiku-5-5" }).fast, "claude-haiku-5-5");
  assert.equal(resolveModels({ ANTHROPIC_MODEL: "claude-opus-5" }).top, "claude-opus-5");
  assert.equal(resolveModels({ ANTHROPIC_MODEL: "claude-opus-5" }, { top: "claude-opus-6" }).top, "claude-opus-6");
  // 形の正しくない値は使わない（既定値に戻る）
  assert.equal(resolveModels({ ANTHROPIC_MODEL: "gpt-5" }, { top: "DROP TABLE" }).top, "claude-opus-5-5");
  assert.equal(resolveModels({}, { fast: null }).fast, "claude-haiku-5-5");
});

test("登録表に無い将来のモデルも、名前から系列・世代・料金の目安・呼び出し方を決める", () => {
  assert.deepEqual(parseModelId("claude-sonnet-6"), { family: "sonnet", generation: 6 });
  assert.deepEqual(parseModelId("claude-haiku-5-5"), { family: "haiku", generation: 5.5 });
  assert.deepEqual(parseModelId("claude-haiku-4-5-20251001"), { family: "haiku", generation: 4.5 });
  assert.equal(parseModelId("gpt-5"), null);
  assert.equal(tierOfModel("claude-sonnet-6"), "standard");
  assert.equal(labelOf("claude-opus-6-1"), "Claude Opus 6.1");
  const est = priceOf("claude-opus-6");
  assert.equal(est.estimated, true);
  assert.equal(est.price.input, 4, "同じ系列の最新（Opus 5.5）の単価で概算する");
  assert.deepEqual(traitsOf("claude-opus-6"), { adaptive: true, effort: true, fallbacks: false });
  assert.equal(traitsOf("claude-haiku-4-5").adaptive, false);
  assert.equal(catalogEntry("claude-haiku-4-5-20251001")?.id, "claude-haiku-4-5");
});

test("費用：Haiku 5.5 は Haiku 4.5 の1/10", () => {
  const u = { input: 100_000, output: 10_000 };
  assert.ok(Math.abs(costOfModel("claude-haiku-4-5", u) / costOfModel("claude-haiku-5-5", u) - 10) < 1e-9);
  assert.equal(costOfModel("claude-opus-5-5", { input: 0, output: 0, cacheRead: 1_000_000 }), 0.2);
});

test("Models API の一覧から、段階ごとのより新しいモデルを見つける", () => {
  const available = [
    { id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5" },
    { id: "claude-sonnet-6", display_name: "Claude Sonnet 6" },
    { id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" },
    { id: "claude-opus-5", display_name: "Claude Opus 5" },
  ];
  const n = newerModels(available, DEFAULT_MODELS);
  assert.deepEqual(n, { standard: { id: "claude-sonnet-6", label: "Claude Sonnet 6" } });
});
