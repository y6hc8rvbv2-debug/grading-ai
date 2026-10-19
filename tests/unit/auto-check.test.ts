// おまかせモードの自動確認（lib/workflow/auto-check.ts）の単体テスト
import test from "node:test";
import assert from "node:assert/strict";
import { autoCheck, bestClass, isBlocking, matchTest, normTitle } from "../../lib/workflow/auto-check";
import type { ClassRoom, Student } from "../../lib/types";

test("全員が受験番号で照合でき、問題が無ければ自動で確認済みにできる", () => {
  const r = autoCheck([
    { studentId: "a", assignedBy: "ai" }, { studentId: "a", assignedBy: "ai" }, { studentId: "b", assignedBy: "ai", warnings: ["画像が暗い可能性があります"] },
  ], 10);
  assert.equal(r.ok, true, "画質の注意だけなら止めない（AI採点で画質も確かめる）");
});

test("取り込み順の仮の割り当て・未割り当て・ページの問題・上限超えは先生に見せる", () => {
  const r = autoCheck([
    { studentId: "a", assignedBy: "order" },
    { studentId: "", assignedBy: "order" },
    { studentId: "b", assignedBy: "ai", warnings: ["同じページ番号が重複しています"] },
    { studentId: "c", assignedBy: "teacher" },
    { studentId: "d", assignedBy: "order", isPdf: true },
  ], 10);
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems.map((p) => p.index), [0, 1, 2, 4]);
  assert.ok(r.problems[3].reasons[0].includes("PDF"));
  const over = autoCheck(Array.from({ length: 3 }, () => ({ studentId: "a", assignedBy: "ai" as const })), 2);
  assert.equal(over.ok, false);
  assert.equal(autoCheck([], 10).ok, false, "答案が無いときは確認済みにしない");
  assert.ok(isBlocking("名簿と照合できません。生徒を選んでください"));
  assert.ok(!isBlocking("ぼけ・低コントラストの可能性があります"));
});

test("答案に印刷されたテスト名から、テストを1つに決める（決められなければ選ばない）", () => {
  const tests = [
    { id: "t1", name: "2学期期末テスト", subject: "数学", archivedAt: null },
    { id: "t2", name: "単元テスト 一次関数", subject: "数学", archivedAt: null },
    { id: "t3", name: "単元テスト 一次関数（旧）", subject: "数学", archivedAt: "2026-01-01" },
  ];
  assert.equal(matchTest(["２学期 期末テスト　数学"], tests), "t1");
  assert.equal(matchTest(["単元テスト「一次関数」"], tests), "t2");
  assert.equal(matchTest([""], tests), null);
  assert.equal(matchTest(["テスト"], tests), null, "どちらとも取れる名前では選ばない");
  assert.equal(normTitle("Ａ－Ｂ　テスト"), "abテスト");
  // 名前が完全に同じテストがあれば、似た名前（複製した「（コピー）」など）より優先する
  const withCopy = [...tests, { id: "t4", name: "2学期期末テスト（コピー）", subject: "数学", archivedAt: null }];
  assert.equal(matchTest(["2学期期末テスト"], withCopy), "t1");
  assert.equal(matchTest(["2学期期末テスト（コピー）"], withCopy), "t4");
});

test("読み取った番号に一番よく合うクラスを選ぶ（受験番号の一致を重く数える）", () => {
  const classes = [{ id: "A", label: "2年A組" }, { id: "B", label: "2年B組" }] as ClassRoom[];
  const students = [
    { id: "a1", classId: "A", number: 1, examNo: "2A01" }, { id: "a2", classId: "A", number: 2, examNo: "2A02" },
    { id: "b1", classId: "B", number: 1, examNo: "2B01" }, { id: "b2", classId: "B", number: 2, examNo: "2B02" },
  ] as Student[];
  const page = (examNo: string, number: number) => ({ examNo, number, page: 1, first: 1, last: 5, totalPages: 1, issues: [] });
  assert.equal(bestClass([page("2B01", 1), page("2B02", 2)], classes, students)?.classId, "B");
  assert.equal(bestClass([page("9Z99", 0)], classes, students), null);
});
