import type { GradeTest, NormalizedItem } from "@/lib/ai/grade";
import { escalationReasons } from "@/lib/ai/cascade";
/** 正常な設問は保持し、要再確認の設問だけ再採点。図・共通条件を欠かさないよう全ページは維持する。 */
export function targetedTest(
  test: GradeTest,
  previous: NormalizedItem[] | null,
  qualityOk: boolean,
) {
  if (!previous || !qualityOk) return test;
  const qnos = new Set(escalationReasons(previous).map((x) => x.qno));
  const questions = test.questions.filter((q) => qnos.has(q.no));
  return questions.length ? { ...test, questions } : test;
}
export function mergeTargeted(
  test: GradeTest,
  current: NormalizedItem[],
  previous: NormalizedItem[] | null,
) {
  const byNo = new Map((previous || []).map((x) => [x.qno, x]));
  current.forEach((x) => byNo.set(x.qno, x));
  if (test.questions.some((q) => !byNo.has(q.no)))
    throw new Error("採点結果の設問が不足しています");
  return test.questions.map((q) => byNo.get(q.no)!);
}
