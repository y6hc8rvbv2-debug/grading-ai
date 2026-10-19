// ============================================================================
// おまかせモード（ver6）：取り込んだ答案を、先生の代わりに自動で確かめる
//
// ver5 では「生徒・ページ順・不足や見切れがないことを確認しました」「今回の答案と正答・配点が一致しています」の
// 2つのチェックを毎回先生が付けていた。ver6 では次を自動で確かめ、問題がなければチェックを自動で付ける。
// 問題がある答案だけを先生に見せる（全員分を目で確かめる必要はない）。
//
//   - 生徒の割り当て：全ページが名簿の生徒に割り当たっている
//   - 割り当ての根拠：AI が読んだ受験番号・出席番号で名簿と一致した（取り込み順の仮の割り当てではない）
//   - ページ：同じページの重複・順序の逆・印刷の総ページ数との不一致がない、1人分が上限以内
//   - テスト：答案に印刷されたテスト名が、選んだテストの名前と一致する
// 画質の注意（暗い・ぼやけ）は止めない（AI採点でも画質を確かめ、悪ければ要確認に回すため）。
// AI採点の結果は下書きで、返却前の先生の確認（要確認一覧）は ver5 と同じく必要。
// ============================================================================
import type { ClassRoom, Student, Test } from "@/lib/types";
import { assignPages, type PageInfo } from "@/lib/workflow/intake";

/** 先生の確認が必要な問題（割り当て・ページ順に関わるもの）。画質の注意はここに含めない */
const BLOCKING = [
  /名簿と照合できません/, /受験番号と出席番号が一致しません/, /同じページ番号が重複/, /前のページがないか順序が逆/,
  /問題番号の順序が逆/, /ページ数が印刷の総枚数と一致しません/, /前の生徒の続きと推定/, /生徒を選んでください/,
];
export const isBlocking = (warning: string) => BLOCKING.some((r) => r.test(warning));

export type CheckFile = { studentId: string; warnings?: string[]; assignedBy?: "ai" | "order" | "teacher"; isPdf?: boolean };

export type AutoCheck = {
  ok: boolean;
  /** 先生に見てほしい答案（取り込み一覧での位置）と理由 */
  problems: { index: number; reasons: string[] }[];
};

export function autoCheck(files: CheckFile[], maxPages: number): AutoCheck {
  const problems: AutoCheck["problems"] = [];
  const per = new Map<string, number>();
  files.forEach((f) => { if (f.studentId) per.set(f.studentId, (per.get(f.studentId) ?? 0) + 1); });
  files.forEach((f, index) => {
    const reasons: string[] = [];
    if (!f.studentId) reasons.push("生徒が割り当てられていません");
    else if (f.assignedBy === "order") reasons.push(f.isPdf ? "PDF は受験番号を自動で読めないため、取り込み順で割り当てています" : "受験番号を読み取れなかったため、取り込み順で割り当てています");
    for (const w of f.warnings ?? []) if (isBlocking(w) && !reasons.includes(w)) reasons.push(w);
    if (f.studentId && (per.get(f.studentId) ?? 0) > maxPages) reasons.push(`1人分の答案が${maxPages}ページを超えています`);
    if (reasons.length) problems.push({ index, reasons });
  });
  return { ok: files.length > 0 && problems.length === 0, problems };
}

/** 比べるためにテスト名をそろえる（全角・半角、空白、記号の違いを無視） */
export function normTitle(s: string) {
  return s.normalize("NFKC").toLowerCase().replace(/[\s　・･\-－ー_「」『』()（）［］\[\]【】:：.,、。]/g, "");
}

/** 答案に印刷されたテスト名（複数ページ分）から、登録済みのテストを1つに決める。決められなければ null */
export function matchTest(printedTitles: string[], tests: Pick<Test, "id" | "name" | "subject" | "archivedAt">[]): string | null {
  const titles = [...new Set(printedTitles.map(normTitle).filter((t) => t.length >= 2))];
  if (!titles.length) return null;
  const active = tests.filter((t) => !t.archivedAt);
  // 名前が完全に同じテストが1つだけなら、それを選ぶ（「〇〇（コピー）」などの似た名前があっても迷わない）
  const exact = new Set(active.filter((t) => titles.includes(normTitle(t.name))).map((t) => t.id));
  if (exact.size === 1) return [...exact][0];
  const hits = new Set<string>();
  for (const title of titles) {
    for (const t of active) {
      const name = normTitle(t.name);
      if (name.length >= 2 && (title.includes(name) || name.includes(title))) hits.add(t.id);
    }
  }
  return hits.size === 1 ? [...hits][0] : null;
}

/** 読み取った受験番号・出席番号に一番よく合うクラス（どのクラスにも合わなければ null） */
export function bestClass(pages: PageInfo[], classes: ClassRoom[], students: Student[]): { classId: string; matched: number } | null {
  let best: { classId: string; matched: number } | null = null;
  for (const c of classes) {
    const roster = students.filter((s) => s.classId === c.id);
    const assigned = assignPages(pages, roster);
    // 受験番号で一致したページを重く数える（出席番号だけの一致はクラスをまたいで重なるため）
    const matched = assigned.reduce((n, a, i) => n + (a.studentId ? (pages[i].examNo ? 3 : 1) : 0), 0);
    if (matched > 0 && (!best || matched > best.matched)) best = { classId: c.id, matched };
  }
  return best;
}
