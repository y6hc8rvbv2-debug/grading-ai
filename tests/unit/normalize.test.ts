// 採点AIの出力を整える normalizeResult() の単体テスト。
//   実行: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeResult, type GradeTest } from "../../lib/ai/grade";
import { DEFAULT_RUBRIC } from "../../lib/grading/engine";

const TEST: GradeTest = {
  subject: "数学", name: "確認", grade: 2, answerLang: "ja",
  questions: [
    { no: 1, label: "大問1-(1)", type: "calc", typeLabel: "計算", unit: "式", points: 4, correct: "5", model: "", keywords: [] },
    { no: 2, label: "大問1-(2)", type: "calc", typeLabel: "計算", unit: "式", points: 4, correct: "7", model: "", keywords: [] },
    { no: 3, label: "大問1-(3)", type: "long", typeLabel: "長文記述", unit: "式", points: 8, correct: "", model: "要点", keywords: [] },
    { no: 4, label: "大問1-(4)", type: "calc", typeLabel: "計算", unit: "式", points: 4, correct: "1", model: "", keywords: [] },
  ],
};
const item = (o: Record<string, unknown>) => ({
  detected: "", is_blank: false, mark: "○", earned: 0, confidence: 0.9, reason: "", comment: "",
  bbox: { page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.05 }, ...o,
});

test("得点は判定に合わせて 0〜配点 に決め直す", () => {
  const { items } = normalizeResult({ items: [
    item({ qno: 1, mark: "○", earned: 99 }),
    item({ qno: 2, mark: "×", earned: 3 }),
    item({ qno: 3, mark: "△", earned: 8 }),      // 満点の △ → ○
    item({ qno: 4, mark: "△", earned: 0 }),      // 0点の △ → ×
  ] }, TEST, DEFAULT_RUBRIC);
  assert.deepEqual(items.map((i) => [i.mark, i.earned]), [["○", 4], ["×", 0], ["○", 8], ["×", 0]]);
  // 判定と得点が食い違った設問（3・4）は教員の確認に回す（3 は記述問題なので元から要確認）
  assert.equal(items[3].need_review, true);
  assert.equal(items[1].need_review, false);
});

test("部分点は 1〜配点-1 に収める", () => {
  const { items } = normalizeResult({ items: [item({ qno: 3, mark: "△", earned: 5 })] }, TEST, DEFAULT_RUBRIC);
  assert.equal(items.find((i) => i.qno === 3)!.earned, 5);
});

test("AI が返さなかった設問は要確認・0点で補う", () => {
  const { items } = normalizeResult({ items: [item({ qno: 1 })] }, TEST, DEFAULT_RUBRIC);
  assert.equal(items.length, 4);
  const missing = items.find((i) => i.qno === 2)!;
  assert.equal(missing.need_review, true);
  assert.equal(missing.earned, 0);
});

test("信頼度がしきい値未満・記述問題（教師確認必須）は要確認", () => {
  const { items } = normalizeResult({ items: [
    item({ qno: 1, confidence: 0.5 }), item({ qno: 2, confidence: 0.99 }),
    item({ qno: 3, confidence: 0.99 }), item({ qno: 4, confidence: 0.72 }),
  ] }, TEST, DEFAULT_RUBRIC);
  assert.deepEqual(items.map((i) => i.need_review), [true, false, true, false]);
  const relaxed = normalizeResult({ items: [item({ qno: 3, confidence: 0.99 })] }, TEST,
    { ...DEFAULT_RUBRIC, requireTeacher: false }).items.find((i) => i.qno === 3)!;
  assert.equal(relaxed.need_review, false);
});

test("無記入は 0点・「-」、座標が無ければ bbox は null", () => {
  const { items } = normalizeResult({ items: [
    item({ qno: 1, is_blank: true, mark: "○", earned: 4, bbox: { page: 1, x: 0, y: 0, w: 0, h: 0 } }),
  ] }, TEST, DEFAULT_RUBRIC);
  const b = items[0];
  assert.deepEqual([b.mark, b.earned, b.reason, b.bbox], ["-", 0, "無記入", null]);
});

test("画質の問題があれば ok=false。厳格な採点基準では全設問を要確認にする", () => {
  const raw = { quality: { tilt: 90, brightness: 90, blur: 30, shadow: 90, coverage: 90, contrast: 90,
    issues: [{ k: "ぼやけ", msg: "撮り直してください" }] }, items: [item({ qno: 1 })] };
  const loose = normalizeResult(raw, TEST, DEFAULT_RUBRIC);
  assert.equal(loose.quality.ok, false);
  assert.equal(loose.items[0].need_review, false);
  const strict = normalizeResult(raw, TEST, { ...DEFAULT_RUBRIC, strictQuality: true });
  assert.ok(strict.items.every((i) => i.need_review));
});

test("壊れた出力でも落ちずに全設問を要確認で返す", () => {
  const { items, quality } = normalizeResult("broken", TEST, DEFAULT_RUBRIC);
  assert.equal(items.length, 4);
  assert.ok(items.every((i) => i.need_review));
  assert.equal(quality.ok, true);
});
