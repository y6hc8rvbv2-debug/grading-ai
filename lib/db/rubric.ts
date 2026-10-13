// 採点基準（rubrics テーブルの1行）を画面・採点AIが使う形にする。
// ブラウザ（lib/db/grading.ts）とサーバー（app/api/grade）の両方から使う。
import { DEFAULT_RUBRIC } from "@/lib/grading/engine";
import type { Rubric } from "@/lib/types";

export function rubricFromRow(row: any | null | undefined): Rubric {
  if (!row) return DEFAULT_RUBRIC;
  return {
    matchRate: row.match_rate, partialStep: row.partial_step,
    reviewThreshold: row.review_threshold,
    allowKana: row.allow_kana, allowSpell: row.allow_spell,
    unitPartial: row.unit_partial, workPartial: row.work_partial,
    caseSensitive: row.case_sensitive, outsideBox: row.outside_box,
    requireTeacher: row.require_teacher, autoModel: row.auto_model,
    strictQuality: row.strict_quality, praiseFull: row.praise_full,
  };
}
