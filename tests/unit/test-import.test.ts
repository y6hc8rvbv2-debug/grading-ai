// 模範解答からの自動入力の後処理（lib/ai/test-import.ts の normalizeImport）の単体テスト。API は呼ばない。
//   tests/fixtures/import-raw.json は、今回のテスト（20問・100点、大問ごとの小問数 5・5・1・3・1・3・2）を
//   AI が読み取ったときの出力を模したもの。資料1・2 = 模範解答、資料3 = 生徒の答案。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeImport, buildImportContent, IMPORT_SYSTEM } from "../../lib/ai/test-import";

const raw = JSON.parse(readFileSync(new URL("../fixtures/import-raw.json", import.meta.url), "utf8"));
const kinds = ["key", "key", "student"] as const;
const r = normalizeImport(raw, [...kinds]);
const q = (big: number, sub: string) => r.questions.find((x) => x.big === big && x.sub === sub)!;

test("大問と小問を原本どおりに保つ（20問、5・5・1・3・1・3・2）", () => {
  assert.equal(r.questions.length, 20);
  const counts = [1, 2, 3, 4, 5, 6, 7].map((b) => r.questions.filter((x) => x.big === b).length);
  assert.deepEqual(counts, [5, 5, 1, 3, 1, 3, 2]);
  assert.deepEqual(r.questions.filter((x) => x.big === 1).map((x) => x.sub), ["(1)", "(2)", "(3)", "(4)", "(5)"]);
  assert.equal(q(3, "").sub, "", "小問の無い大問3は小問を空のまま");
  assert.equal(q(5, "").type, "choice");
  assert.equal(r.maxScore, 100);
});

test("読めない配点は推測で確定しない（空欄＋要確認、候補だけ添える）", () => {
  const p = q(2, "(5)");
  assert.equal(p.points, null);
  assert.equal(p.pointsHint, 5);
  assert.ok(p.flags.some((f) => f.includes("配点")));
  assert.ok(p.flags.some((f) => f.includes("かすれ")), "AI の注意も教員に見せる");
  const known = r.questions.reduce((a, x) => a + (x.points ?? 0), 0);
  assert.equal(known, 95, "確定した配点の合計は 95（原本の満点 100 と一致しないので画面で知らせる）");
});

test("読めない正答は空欄＋要確認", () => {
  const p = q(6, "(3)");
  assert.equal(p.correct, "");
  assert.ok(p.flags.some((f) => f.includes("正答を読み取れません")));
});

test("生徒の答案の手書きは正答として取り込まない", () => {
  const p = q(4, "(1)");
  assert.equal(p.correct, "");
  assert.ok(p.flags.some((f) => f.includes("生徒の答案")));
  assert.equal(p.points, 5, "印刷された配点は使う");
});

test("作図は「右図」で登録せず、模範図の位置と採点条件を教員が確認する", () => {
  const p = q(3, "");
  assert.equal(p.type, "graph");
  assert.equal(p.correct, "");
  assert.ok(p.model.includes("採点条件") && p.model.includes("二等分線"));
  assert.deepEqual(p.figure, { file: 1, page: 1, x: 0.55, y: 0.48, w: 0.35, h: 0.15 });
  assert.ok(p.flags.includes("作図の採点条件を確認してください"));
});

test("問題の無い設問は要確認にしない", () => {
  const p = q(1, "(1)");
  assert.deepEqual(p.flags, []);
  assert.equal(p.correct, "-1");
  assert.equal(p.points, 4);
  assert.ok(p.answerBox && p.answerBox.file === 1);
  assert.equal(r.questions.filter((x) => x.flags.length).length, 4, "要確認は 2(5)・3・4(1)・6(3) の4問");
});

test("生徒の答案の位置は模範図として使わない／重複した番号は要確認", () => {
  const bad = normalizeImport({ questions: [
    { ...raw.questions[10], figure_box: { file: 3, page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    raw.questions[0], raw.questions[0],
  ] }, [...kinds]);
  assert.equal(bad.questions[0].figure, null);
  assert.ok(bad.questions[2].flags.some((f) => f.includes("同じ大問・小問番号")));
});

test("AI への指示：資料の種類を示し、手書きの答えを正答にしない・推測しない", () => {
  const c = buildImportContent([
    { kind: "key", name: "模範解答.jpg", mediaType: "image/jpeg", data: "AAAA" },
    { kind: "student", name: "答案.jpg", mediaType: "image/jpeg", data: "BBBB" },
  ]);
  const text = c.filter((x) => x.type === "text").map((x) => (x as { text: string }).text).join("\n");
  assert.ok(text.includes("資料1：模範解答") && text.includes("資料2：生徒の答案"));
  assert.ok(IMPORT_SYSTEM.includes("手書きで書いた答えは、正答として絶対に使いません"));
  assert.ok(IMPORT_SYSTEM.includes("推測しないでください"));
});
