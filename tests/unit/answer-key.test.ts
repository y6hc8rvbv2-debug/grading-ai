// 模範解答の自動作成の検算（lib/ai/answer-key.ts）の単体テスト
import test from "node:test";
import assert from "node:assert/strict";
import { BLANKET_FLAG, GENERATED_FLAG, mergeVerification, needsAdjudication, qKey } from "../../lib/ai/answer-key";
import type { ImportResult, ImportedQuestion } from "../../lib/types";

const q = (o: Partial<ImportedQuestion>): ImportedQuestion => ({
  big: 1, bigLabel: "1", sub: "(1)", type: "calc", correct: "6", points: 5, pointsHint: null, model: "",
  answerBox: null, figure: null, flags: [GENERATED_FLAG, BLANKET_FLAG], ...o,
});
const base = (): ImportResult => ({
  title: "", subject: "", maxScore: null, warnings: [],
  questions: [
    q({ sub: "(1)", correct: "6" }),
    q({ sub: "(2)", correct: "18" }),
    q({ sub: "(3)", correct: "x=4" }),
    q({ big: 2, bigLabel: "2", sub: "", type: "long", correct: "光合成でデンプンができるから" }),
    q({ big: 3, bigLabel: "3", sub: "", type: "graph", correct: "" }),
    q({ big: 4, bigLabel: "4", sub: "①", correct: "" }),
  ],
});

test("大問・小問の表記ゆれを同じ設問とみなす", () => {
  assert.equal(qKey(1, "(1)"), qKey(1, "（１）"));
  assert.equal(qKey(1, "①"), qKey(1, "1"));
  assert.equal(qKey(1, "問1"), qKey(1, "(1)"));
  assert.notEqual(qKey(1, "(1)"), qKey(2, "(1)"));
});

const verify = [
  { big: 1, sub: "（１）", answer: "6", solvable: true },
  { big: 1, sub: "(2)", answer: "16", solvable: true },
  { big: 1, sub: "(3)", answer: "4", solvable: true },
  { big: 2, sub: "", answer: "葉で光合成をしてデンプンをつくるため", solvable: true },
  { big: 4, sub: "1", answer: "12cm", solvable: true },
];

test("食い違った計算問題と記述問題だけを判定に回す（一致・作図・空欄は回さない）", () => {
  const p = needsAdjudication(base(), verify);
  assert.deepEqual(p.map((x) => `${x.q.big}${x.q.sub}`), ["1(2)", "2"]);
  assert.deepEqual(needsAdjudication(base(), null), []);
});

test("2つのAIが一致した問題は、個別の確認を省ける（要確認の理由を外す）", () => {
  const r = mergeVerification(base(), verify, []);
  const [a, b, c, long, graph, blank] = r.questions;
  assert.equal(a.check?.status, "agree");
  assert.deepEqual(a.flags, []);
  assert.equal(c.check?.status, "agree", "x=4 と 4 は同じ答え");
  assert.equal(b.check?.status, "disagree", "判定がなければ食い違いを要確認に");
  assert.ok(b.flags.some((f) => f.includes("下書き：18／検算：16")));
  assert.ok(long.flags.length > 0, "記述問題は先生の確認を残す");
  assert.equal(graph.check, undefined, "作図は比べない");
  assert.equal(blank.correct, "12cm", "下書きが空欄で検算だけ解けたら候補として入れる");
  assert.ok(blank.flags.some((f) => f.includes("必ず確認")));
  assert.ok(r.warnings.some((w) => w.includes("2 問は、2つのAI")));
});

test("判定の結果を反映する：下書きが正しい／答えを直す／決められない", () => {
  const r = mergeVerification(base(), verify, [
    { big: 1, sub: "(2)", final: "16", verdict: "second", explanation: "4×4=16" },
    { big: 2, sub: "", final: "光合成でデンプンができるから", verdict: "first", explanation: "要点：光合成・デンプン" },
  ]);
  const b = r.questions[1];
  assert.equal(b.correct, "16");
  assert.equal(b.check?.status, "adjudicated");
  assert.ok(b.flags.some((f) => f.includes("直しました")));
  assert.ok(b.model.includes("検算：4×4=16"));
  const long = r.questions[3];
  assert.equal(long.correct, "光合成でデンプンができるから");
  assert.ok(long.flags.includes(BLANKET_FLAG), "記述は判定が下書きを支持しても先生の確認を残す");
  const u = mergeVerification(base(), verify, [{ big: 1, sub: "(2)", final: "", verdict: "uncertain", explanation: "" }]);
  assert.equal(u.questions[1].check?.status, "disagree");
  assert.equal(u.questions[1].correct, "18", "決められなければ答えを変えない");
});

test("判定で下書きの計算問題が正しいと確かめられたら、確認を省ける", () => {
  const v = [{ big: 1, sub: "(1)", answer: "7", solvable: true }];
  const r = mergeVerification({ ...base(), questions: [q({})] }, v, [{ big: 1, sub: "(1)", final: "6", verdict: "first", explanation: "2×3" }]);
  assert.deepEqual(r.questions[0].flags, []);
});

test("検算が失敗・時間切れでも、ver5 と同じく要確認で返す", () => {
  const r = mergeVerification(base(), null, null, { verifyError: "時間内に終わりませんでした" });
  assert.ok(r.questions[0].flags.includes(GENERATED_FLAG));
  assert.ok(r.questions[0].flags.some((f) => f.includes("時間内に終わりませんでした")));
  assert.equal(r.questions[0].check?.status, "unverified");
});
