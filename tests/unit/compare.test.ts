// モデル比較試験（lib/ai/compare.ts）の単体テスト。API は呼ばない。
//   実行: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCompareInput, compareAvailability, costOf, judgeCompare, COMPARE_EXPECTED,
} from "../../lib/ai/compare";
import type { NormalizedItem } from "../../lib/ai/grade";

const page = (data: string) => ({ kind: "image" as const, mediaType: "image/png" as const, data });
const textOf = (input: ReturnType<typeof buildCompareInput>) =>
  input.system + "\n" + input.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");

test("本番（Production）とキーの無い環境では使えない", () => {
  assert.equal(compareAvailability({}).enabled, false);
  assert.equal(compareAvailability({ ANTHROPIC_API_KEY: "k", VERCEL_ENV: "production" }).enabled, false);
  assert.equal(compareAvailability({ ANTHROPIC_API_KEY: "k", VERCEL_ENV: "preview" }).enabled, true);
  assert.equal(compareAvailability({ ANTHROPIC_API_KEY: "k" }).enabled, true);
  assert.equal(compareAvailability({ ANTHROPIC_API_KEY: "k", VERCEL_ENV: "production", MODEL_COMPARE_IN_PRODUCTION: "1" }).enabled, true);
  // 理由の文にキーの値は入らない
  assert.ok(!compareAvailability({ ANTHROPIC_API_KEY: "sk-secret", VERCEL_ENV: "production" }).reason.includes("sk-secret"));
});

test("模範解答（①6 ②18 ③36 ④72 ⑤144）を渡し、期待結果は入力に入れない", () => {
  const input = buildCompareInput(page("AAAA"));
  const qs = input.test.questions;
  assert.deepEqual(qs.map((q) => q.correct), ["6", "18", "36", "72", "144"]);
  assert.deepEqual(qs.map((q) => q.points), [20, 20, 20, 20, 20]);
  const text = textOf(input);
  assert.ok(text.includes('"correct": "144"'), "正答を送っている");
  // 期待結果にだけある情報（生徒の答え 9 / 145、合計60点、期待という語）は送らない
  assert.ok(!text.includes("145"), "生徒の答え（期待結果）を送っていない");
  assert.ok(!/"9"|60点|期待|studentAnswer/.test(text), "期待結果を送っていない");
  assert.ok(text.includes("部分点を付けない") || text.includes("部分点"), "部分点なしの採点基準を送っている");
});

test("同じ画像なら入力の指紋は同じ、違う画像なら違う", () => {
  assert.equal(buildCompareInput(page("AAAA")).fingerprint, buildCompareInput(page("AAAA")).fingerprint);
  assert.notEqual(buildCompareInput(page("AAAA")).fingerprint, buildCompareInput(page("BBBB")).fingerprint);
});

const item = (qno: number, detected: string, mark: "○" | "×", earned: number): NormalizedItem => ({
  qno, detected, mark, earned, confidence: 0.9, is_blank: false, need_review: false, reason: "", comment: "", bbox: null, ai_raw: null, flags: [],
});

test("期待結果との照合（全問一致・不一致）", () => {
  const good = [item(1, "9", "×", 0), item(2, "18", "○", 20), item(3, "36", "○", 20), item(4, "72", "○", 20), item(5, "145", "×", 0)];
  const j = judgeCompare(good);
  assert.equal(j.total, COMPARE_EXPECTED.total);
  assert.equal(j.allOk, true);

  // ⑤を 144 と読み違えて正解にした
  const bad = [...good.slice(0, 4), item(5, "72+72=144", "○", 20)];
  const k = judgeCompare(bad);
  assert.equal(k.total, 80);
  assert.equal(k.totalOk, false);
  assert.equal(k.allOk, false);
  const q5 = k.perQ.find((q) => q.qno === 5)!;
  assert.deepEqual([q5.readOk, q5.verdictOk, q5.scoreOk], [false, false, false]);
  // 式ごと書き起こしても、生徒の答えの数が含まれていれば読み取りは合っている
  assert.equal(judgeCompare([item(1, "3+3=9", "×", 0)]).perQ[0].readOk, true);
});

test("概算費用は公式単価 × トークン数", () => {
  assert.equal(costOf("Claude Haiku 4.5", { input: 1000, output: 500, cacheWrite: 0, cacheRead: 0 }), 0.0035);
  assert.equal(costOf("Claude Opus 5", { input: 1000, output: 500, cacheWrite: 0, cacheRead: 0 }), 0.0175);
  assert.equal(costOf("不明なモデル", { input: 1, output: 1, cacheWrite: 0, cacheRead: 0 }), null);
});
