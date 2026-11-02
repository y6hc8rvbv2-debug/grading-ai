// 夜間の Batch 採点（2026-11-02）：要求の中身は「すぐの採点」と同じで、Batch では fallbacks を付けない（Batch API が断るため）
import { test } from "node:test";
import assert from "node:assert/strict";
import { gradingRequestBody } from "../../lib/ai/grade";
import { BATCH_DISCOUNT, nightBatchEnabled } from "../../lib/grading/batch";
import { OVERAGE_PERSONAL_YEN, OVERAGE_SCHOOL_YEN, SCHOOL_OPUS_SURCHARGE, OVERAGE_TEXT } from "../../lib/subscription-plans";
import type { Rubric } from "../../lib/types";

const params = {
  pages: [{ kind: "image" as const, mediaType: "image/png" as const, data: "iVBORw0KGgo=" }],
  test: { subject: "数学", name: "小テスト", grade: 1, answerLang: "ja", questions: [{ no: 1, label: "1", type: "calc" as const, typeLabel: "計算", unit: "", points: 5, correct: "12", model: "", keywords: [] }] },
  rubric: {} as Rubric,
};

test("Batch の要求は、すぐの採点と同じ指示・設定で、fallbacks だけを外す", () => {
  const now = gradingRequestBody(params, { model: "claude-opus-5-5", effort: "high", fallbacks: true });
  const batch = gradingRequestBody(params, { model: "claude-opus-5-5", effort: "high", fallbacks: true }, { batch: true });
  assert.equal((now as { fallbacks?: string }).fallbacks, "default");
  assert.ok(!("fallbacks" in batch) && !("betas" in batch), "Batch に fallbacks・betas を付けない");
  const { fallbacks: _f, betas: _b, ...rest } = now as Record<string, unknown>;
  assert.deepEqual(rest, batch, "それ以外（モデル・考え方・出力の形・指示・答案）は同じ");
  assert.equal(batch.output_config.effort, "high");
  assert.equal(batch.output_config.format.type, "json_schema");
});

test("Batch は半額・既定で使う（NIGHT_BATCH=off で従来の1件ずつ）", () => {
  assert.equal(BATCH_DISCOUNT, 0.5);
  const old = process.env.NIGHT_BATCH;
  delete process.env.NIGHT_BATCH; assert.equal(nightBatchEnabled(), true);
  process.env.NIGHT_BATCH = "off"; assert.equal(nightBatchEnabled(), false);
  if (old === undefined) delete process.env.NIGHT_BATCH; else process.env.NIGHT_BATCH = old;
});

test("従量課金・学校の Opus単独の料金（0026 の billing_config の既定と同じ）と説明", () => {
  assert.equal(OVERAGE_PERSONAL_YEN, 22);
  assert.equal(OVERAGE_SCHOOL_YEN, 20);
  assert.equal(SCHOOL_OPUS_SURCHARGE, 50);
  assert.match(OVERAGE_TEXT, /22円（税込）/);
  assert.match(OVERAGE_TEXT, /20円（税別）/);
  assert.match(OVERAGE_TEXT, /上限額を超えて請求することはありません/);
});
