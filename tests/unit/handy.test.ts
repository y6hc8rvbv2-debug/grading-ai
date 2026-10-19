// ver6 の便利機能（得点の統計・同じ解答のまとめ判定）の単体テスト
import test from "node:test";
import assert from "node:assert/strict";
import { deviation, scoreStats } from "../../lib/grading/stats";
import { groupSameAnswers, normDetected } from "../../lib/workflow/review-groups";
import type { Item, ReviewEntry } from "../../lib/types";

test("得点の統計：平均・中央値・最高・最低・標準偏差・度数分布", () => {
  const s = scoreStats([100, 80, 60, 40, 20], 100)!;
  assert.deepEqual({ n: s.n, mean: s.mean, median: s.median, max: s.max, min: s.min }, { n: 5, mean: 60, median: 60, max: 100, min: 20 });
  assert.equal(s.sd, 28.3);
  assert.deepEqual(s.hist, [0, 0, 1, 0, 1, 0, 1, 0, 1, 1]);
  assert.equal(scoreStats([], 100), null);
  assert.equal(scoreStats([10, 20], 50)!.median, 15);
});

test("偏差値：平均で50、1標準偏差上で60。散らばりが無ければ50", () => {
  const s = scoreStats([100, 80, 60, 40, 20], 100)!;
  assert.equal(deviation(60, s), 50);
  assert.equal(deviation(60 + s.sd, s), 60);
  assert.equal(deviation(70, { mean: 70, sd: 0 }), 50);
});

const entry = (sub: string, qno: number, detected: string, blank = false): ReviewEntry =>
  ({ submissionId: sub, item: { id: `${sub}-${qno}`, qno, detected, blank } as Item });

test("同じテスト・同じ設問・同じ解答をまとめる（表記ゆれは同じ、無記入・1件だけはまとめない）", () => {
  const list = [
    entry("s1", 1, "x=4"), entry("s2", 1, "４"), entry("s3", 1, " 4 "), entry("s4", 1, "5"),
    entry("s5", 2, "4"), entry("s6", 1, "", true), entry("s7", 1, "", true), entry("t1", 1, "4"),
  ];
  const testOf = (id: string) => (id.startsWith("t") ? "testB" : "testA");
  const g = groupSameAnswers(list, testOf);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].entries.map((e) => e.submissionId), ["s1", "s2", "s3"]);
  assert.equal(normDetected("Ｘ＝４"), "4");
});
