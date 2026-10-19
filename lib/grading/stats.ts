// 得点の統計（ver6 の便利機能）：平均・中央値・最高・最低・標準偏差・偏差値・度数分布。
// 白紙・採点待ち・未提出は呼び出し側で除いてから渡す。ブラウザだけで計算する（AI・サーバーは使わない）。

export type ScoreStats = { n: number; mean: number; median: number; max: number; min: number; sd: number; hist: number[] };

const r1 = (v: number) => Math.round(v * 10) / 10;

/** values は得点、maxScore は満点。hist は得点率 0〜9%, 10〜19%, …, 90〜100% の10区分の人数 */
export function scoreStats(values: number[], maxScore: number): ScoreStats | null {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return null;
  const sorted = [...v].sort((a, b) => a - b);
  const n = v.length;
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  // 母標準偏差（学校の成績処理で一般的な「全員の散らばり」）
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const hist = new Array(10).fill(0);
  for (const x of v) hist[Math.min(9, Math.max(0, Math.floor((maxScore > 0 ? x / maxScore : 0) * 10)))]++;
  return { n, mean: r1(mean), median: r1(median), max: sorted[n - 1], min: sorted[0], sd: r1(sd), hist };
}

/** 偏差値（散らばりが無いときは 50） */
export function deviation(value: number, s: Pick<ScoreStats, "mean" | "sd">) {
  return s.sd > 0 ? r1(50 + (10 * (value - s.mean)) / s.sd) : 50;
}
