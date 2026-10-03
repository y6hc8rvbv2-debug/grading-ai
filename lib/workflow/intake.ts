import type { Student } from "@/lib/types";
export type PageInfo = {
  examNo: string;
  number: number;
  page: number;
  first: number;
  last: number;
  totalPages: number;
  issues: string[];
};
/** 番号だけでは生徒を推測しない。後続ページの継続は確認対象とする。 */
export function assignPages(pages: PageInfo[], roster: Student[]) {
  let previous = "";
  let last = 0;
  let pageNo = 0;
  const seenPages = new Map<string, Set<number>>();
  return pages.map((p) => {
    const matches = roster.filter((s) =>
      p.examNo
        ? s.examNo === p.examNo.trim()
        : p.number > 0 && s.number === p.number,
    );
    let studentId = matches.length === 1 ? matches[0].id : "";
    const issues = [...p.issues];
    if (
      studentId &&
      p.examNo &&
      p.number > 0 &&
      matches[0].number !== p.number
    ) {
      studentId = "";
      issues.push("受験番号と出席番号が一致しません");
    }
    if (studentId && p.page > 0) {
      const seen = seenPages.get(studentId) || new Set<number>();
      if (seen.has(p.page)) issues.push("同じページ番号が重複しています");
      if (p.page > 1 && !seen.has(p.page - 1))
        issues.push("前のページがないか順序が逆です");
      seen.add(p.page);
      seenPages.set(studentId, seen);
    }
    if (
      !studentId &&
      !p.examNo &&
      !p.number &&
      previous &&
      p.page === pageNo + 1 &&
      p.first >= last &&
      p.first > 0
    ) {
      studentId = previous;
      issues.push(
        "問題番号・ページ番号から前の生徒の続きと推定。確認してください",
      );
    }
    if (!studentId) issues.push("名簿と照合できません。生徒を選んでください");
    if (studentId === previous && p.first < last)
      issues.push("問題番号の順序が逆です。重複・ページ順を確認してください");
    previous = studentId;
    last = p.last;
    pageNo = p.page;
    return { studentId, issues };
  });
}
