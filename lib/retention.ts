// 保存期間を過ぎた答案の削除（サーバー専用。app/api/retention/purge から1日1回）。
//   1. 学校ごとの保存期間（30日・180日・学年度末から1年＝15か月・手動）を過ぎた答案の画像を、Storage から消す
//   2. purge_submissions(ids)（0016）で、画像を消し終えた答案だけを「削除済み」にして画像の参照を空にする
// 画像を先に消すので、途中で失敗しても次の回にやり直せる（消えている画像を消しても失敗しない）。
// 1回に学校ごと最大 limitPerSchool 件。残りは次の回に消す。
// 点数などの成績の記録は、学校の成績管理のために残る（プライバシーポリシーの 4.）。

export type RetentionDb = {
  schools(): Promise<{ id: string; retention: string }[]>;
  /** 期限より前に取り込まれ、まだ削除済みでない答案（画像のパス付き） */
  expired(schoolId: string, before: string, limit: number): Promise<{ id: string; image_paths: string[] | null }[]>;
  removeImages(paths: string[]): Promise<void>;
  purge(ids: string[]): Promise<number>;
};

const DAYS: Record<string, number> = { "30": 30, "180": 180 };

/** その学校の答案を消す基準の日時（manual は消さない＝null）。0001 の purge_expired_submissions と同じ規則 */
export function cutoff(retention: string, now = new Date()): Date | null {
  if (retention === "manual") return null;
  const d = new Date(now);
  if (DAYS[retention]) d.setUTCDate(d.getUTCDate() - DAYS[retention]);
  else d.setUTCMonth(d.getUTCMonth() - 15);
  return d;
}

export async function purgeExpired(db: RetentionDb, now = new Date(), limitPerSchool = 500) {
  let images = 0, submissions = 0;
  for (const school of await db.schools()) {
    const before = cutoff(school.retention, now);
    if (!before) continue;
    const rows = await db.expired(school.id, before.toISOString(), limitPerSchool);
    if (!rows.length) continue;
    const paths = [...new Set(rows.flatMap((r) => r.image_paths ?? []).filter(Boolean))];
    for (let i = 0; i < paths.length; i += 100) await db.removeImages(paths.slice(i, i + 100));
    images += paths.length;
    submissions += await db.purge(rows.map((r) => r.id));
  }
  return { images, submissions };
}
