import { test } from "node:test";
import assert from "node:assert/strict";
import { proposePoints, normalizeImport } from "../../lib/ai/test-import";
import { assignPages } from "../../lib/workflow/intake";
import { targetedTest, mergeTargeted } from "../../lib/ai/targeted";
import type { ImportResult, Student } from "../../lib/types";
import type { GradeTest, NormalizedItem } from "../../lib/ai/grade";
test("配点なしは整数で100点、全設問に教師確認を要求", () => {
  const r = {
    questions: Array.from({ length: 6 }, () => ({
      points: null,
      pointsOrigin: "absent",
      flags: [],
    })),
    warnings: [],
  } as unknown as ImportResult;
  const n = proposePoints(r);
  assert.deepEqual(
    n.questions.map((q) => q.points),
    [17, 17, 17, 17, 16, 16],
  );
  assert.equal(
    n.questions.reduce((s, q) => s + q.points!, 0),
    100,
  );
  assert.ok(n.questions.every((q) => q.flags.length));
});
test("一部印刷配点があるときは勝手に100点にしない", () => {
  const r = {
    questions: [
      { points: 4, flags: [] },
      { points: null, flags: [] },
    ],
    warnings: [],
  } as unknown as ImportResult;
  assert.equal(proposePoints(r), r);
});
test("生徒の回答の転記は拒否、生成案は明示モードでのみ教師確認付き", () => {
  const raw = {
    questions: [
      {
        big: 1,
        sub: "(1)",
        type: "calc",
        correct: "6",
        correct_status: "read",
        correct_file: 1,
        points: 4,
        points_status: "printed",
        points_file: 1,
      },
    ],
  };
  assert.equal(
    normalizeImport(raw, ["student"], true).questions[0].correct,
    "",
  );
  raw.questions[0].correct_status = "generated";
  assert.equal(normalizeImport(raw, ["student"]).questions[0].correct, "");
  const q = normalizeImport(raw, ["student"], true).questions[0];
  assert.equal(q.correct, "6");
  assert.ok(q.flags.some((f) => f.includes("模範解答案")));
});
const page = {
  examNo: "A01",
  number: 0,
  page: 1,
  first: 1,
  last: 4,
  totalPages: 2,
  issues: [],
};
const roster = [{ id: "a", examNo: "A01", number: 1 }] as Student[];
test("問題番号だけでは知らない生徒に割り当てない", () => {
  assert.equal(
    assignPages([{ ...page, examNo: "", page: 0 }], roster)[0].studentId,
    "",
  );
});
test("ページ連続と番号連続がある後続ページは要確認付きで候補にする", () => {
  const out = assignPages(
    [page, { ...page, examNo: "", page: 2, first: 5, last: 7 }],
    roster,
  );
  assert.equal(out[1].studentId, "a");
  assert.ok(out[1].issues.length);
});
test("明示された別人番号は前の人へ吸収しない", () => {
  assert.equal(
    assignPages(
      [page, { ...page, examNo: "unknown", page: 2, first: 5, last: 7 }],
      roster,
    )[1].studentId,
    "",
  );
});
test("上位モデルは不確かな問題だけ、正常な得点を維持", () => {
  const t = { questions: [{ no: 1 }, { no: 2 }] } as GradeTest;
  const prev = [
    { qno: 1, earned: 4, flags: [] },
    { qno: 2, earned: 0, flags: ["unreadable"] },
  ] as NormalizedItem[];
  assert.deepEqual(targetedTest(t, prev, true).questions, [{ no: 2 }]);
  assert.equal(targetedTest(t, prev, false), t);
  assert.equal(
    mergeTargeted(t, [{ ...prev[1], earned: 6 }], prev)[0].earned,
    4,
  );
  assert.throws(() => mergeTargeted(t, [], null));
});
