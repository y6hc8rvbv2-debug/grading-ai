// 同じ解答のまとめ判定（ver6 の便利機能）。要確認の設問を「同じテスト・同じ設問・同じ読み取り結果」でまとめ、
// 先生が1回の判定で全員分を確定できるようにする（例：30人が「x=4」と書いた設問は1回で ○）。
// 読み取りの表記ゆれ（全角・半角、空白、x= の前置き）は同じ解答とみなす。無記入はまとめない（1人ずつ確かめる）。
import type { ReviewEntry } from "@/lib/types";

export const normDetected = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, "").replace(/[−－ー‐–—]/g, "-").replace(/^[a-z]=/, "");

export type ReviewGroup = { key: string; entries: ReviewEntry[]; detected: string; testId: string; qno: number };

/** testOf は答案ID → テストID（分からなければ null。まとめの対象から外す） */
export function groupSameAnswers(list: ReviewEntry[], testOf: (submissionId: string) => string | null): ReviewGroup[] {
  const m = new Map<string, ReviewGroup>();
  for (const e of list) {
    const testId = testOf(e.submissionId);
    const d = normDetected(e.item.detected || "");
    if (!testId || e.item.blank || !d) continue;
    const key = `${testId}|${e.item.qno}|${d}`;
    const g = m.get(key) ?? { key, entries: [], detected: e.item.detected, testId, qno: e.item.qno };
    g.entries.push(e);
    m.set(key, g);
  }
  return [...m.values()].filter((g) => g.entries.length >= 2).sort((a, b) => b.entries.length - a.entries.length);
}
