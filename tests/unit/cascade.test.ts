// 3モデル併用の振り分け（lib/ai/cascade.ts）と料金の目安（lib/grading/cost.ts）の単体テスト。API は呼ばない。
//   実行: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeResult, type GradeTest } from "../../lib/ai/grade";
import {
  addChecks, answerMatches, escalationReasons, finalizeItems, markDisagreement, stageOptions, PLAN,
} from "../../lib/ai/cascade";
import { DEFAULT_RUBRIC } from "../../lib/grading/engine";
import { CASCADE_SHARE, costOfStage, estimatePerAnswer } from "../../lib/grading/cost";

const TEST: GradeTest = {
  subject: "数学", name: "確認", grade: 3, answerLang: "ja",
  questions: [
    { no: 1, label: "(1)", type: "calc", typeLabel: "計算", unit: "式", points: 4, correct: "-1", model: "", keywords: [] },
    { no: 2, label: "(2)", type: "calc", typeLabel: "計算", unit: "式", points: 4, correct: "x=4±√11", model: "", keywords: [] },
    { no: 3, label: "(3)", type: "long", typeLabel: "長文記述", unit: "説明", points: 6, correct: "", model: "要点", keywords: [] },
  ],
};
const RUBRIC = { ...DEFAULT_RUBRIC, reviewThreshold: 70, requireTeacher: true };
const it = (o: Record<string, unknown>) => ({
  detected: "", is_blank: false, mark: "○", earned: 0, confidence: 0.95, reason: "", comment: "",
  bbox: { page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.05 }, ...o,
});
const run = (items: Record<string, unknown>[]) => {
  const r = normalizeResult({ items, quality: { tilt: 90, brightness: 90, blur: 90, shadow: 90, coverage: 90, contrast: 90, issues: [] } }, TEST, RUBRIC);
  addChecks(r.items, TEST);
  return r.items;
};
const clean = () => [
  it({ qno: 1, detected: "−1", mark: "○", earned: 4 }),
  it({ qno: 2, detected: "4 ± √11", mark: "○", earned: 4 }),
  it({ qno: 3, detected: "比例するから", mark: "○", earned: 6 }),
];

test("Opus単独は Opus だけ、3モデル併用は Haiku → Sonnet → Opus", () => {
  assert.deepEqual(PLAN.opus, ["opus"]);
  assert.deepEqual(PLAN.cascade, ["haiku", "sonnet", "opus"]);
  // Haiku 4.5 は adaptive thinking・effort 非対応。Haiku・Sonnet は拒否されたら上の段階に回すので fallbacks なし
  assert.deepEqual(stageOptions("haiku", "cascade"), { model: "claude-haiku-4-5", thinking: false, fallbacks: false });
  assert.deepEqual(stageOptions("sonnet", "cascade"), { model: "claude-sonnet-5-5", thinking: true, effort: "high", fallbacks: false });
  assert.equal(stageOptions("opus", "opus").thinking, true);
});

test("表記ゆれは同じ解答とみなす", () => {
  assert.ok(answerMatches("−1", "-1"));
  assert.ok(answerMatches("4 ± √11", "x=4±√11"));
  assert.ok(answerMatches("3+3=6", "6"));
  assert.ok(answerMatches("２４０円", "240"));
  assert.ok(!answerMatches("145", "144"));
});

test("問題の無い答案は上のモデルに回さない（記述の教員確認は理由にしない）", () => {
  const items = run(clean());
  assert.deepEqual(escalationReasons(items), []);
  assert.equal(items[2].need_review, true, "記述問題は教員の確認に回る（採点基準）");
});

test("自信の高さだけでは見逃さない：正答と矛盾・欠落・判読不能を理由にする", () => {
  const items = run([
    it({ qno: 1, detected: "-1", mark: "×", earned: 0, confidence: 0.99 }),          // 正答と同じなのに ×
    it({ qno: 2, detected: "？？", mark: "×", earned: 0, confidence: 0.99 }),         // 判読不能
    // 3番は返さない（回答の欠落）
  ]);
  const codes = escalationReasons(items).map((r) => `${r.qno}:${r.code}`);
  assert.ok(codes.includes("1:key_contradiction"), codes.join(","));
  assert.ok(codes.includes("2:unreadable"), codes.join(","));
  assert.ok(codes.includes("3:missing"), codes.join(","));
  // 正答と一致しないのに ○
  const wrongOk = run([it({ qno: 1, detected: "1", mark: "○", earned: 4 }), ...clean().slice(1)]);
  assert.deepEqual(escalationReasons(wrongOk).map((r) => r.code), ["key_contradiction"]);
  // 無記入なのに文字がある
  const blank = run([it({ qno: 1, detected: "-1", is_blank: true, mark: "-", earned: 0 }), ...clean().slice(1)]);
  assert.deepEqual(escalationReasons(blank).map((r) => r.code), ["blank_mismatch"]);
});

test("自信が低いことも理由の1つになる", () => {
  const low = run([it({ qno: 1, detected: "-1", mark: "○", earned: 4, confidence: 0.3 }), ...clean().slice(1)]);
  assert.deepEqual(escalationReasons(low).map((r) => r.code), ["low_confidence"]);
});

test("最後の段階で前のモデルと判定が分かれた設問は要確認にし、理由を残す", () => {
  const sonnet = run(clean());
  const opus = run([it({ qno: 1, detected: "1", mark: "×", earned: 0 }), ...clean().slice(1)]);
  markDisagreement(opus, sonnet);
  const final = finalizeItems(opus, { mode: "cascade", stage: "opus", model: "claude-opus-5" });
  assert.equal(final[0].need_review, true);
  const why = (final[0].ai_raw as { grading: { review_reasons: string[] } }).grading.review_reasons;
  assert.ok(why.some((w) => w.includes("前のモデルと判定が分かれた")), why.join(","));
  assert.ok(why.some((w) => w.includes("○・4点")), why.join(","));
  assert.equal(final[1].need_review, false, "判定が同じ設問は要確認にしない");
});

test("料金の目安：3モデル併用は Haiku 全件 + Sonnet 20% + Opus 5%", () => {
  assert.equal(costOfStage("haiku", { input: 1_000_000, output: 0 }), 1);
  assert.equal(costOfStage("opus", { input: 0, output: 1_000_000 }), 25);
  const opus = estimatePerAnswer("opus", 1, 10);
  const cascade = estimatePerAnswer("cascade", 1, 10);
  assert.ok(cascade < opus * 0.5, `3モデル併用 ${cascade} は Opus単独 ${opus} より安い`);
  assert.deepEqual(CASCADE_SHARE, { sonnet: 0.2, opus: 0.05 });
  assert.ok(estimatePerAnswer("opus", 2, 10) > opus, "ページが多いほど高い");
});
