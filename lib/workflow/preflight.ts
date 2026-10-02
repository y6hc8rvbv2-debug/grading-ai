/** 無料の端末内チェック。見切れ・ページ不足は一覧で教師が確認する。 */
export async function preflight(file: File): Promise<string[]> {
  if (!file.type.startsWith("image/") || /hei[cf]/i.test(file.type))
    return ["この形式の画質はプレビューで確認してください"];
  const bitmap = await createImageBitmap(file);
  try {
    const warnings: string[] = [];
    if (Math.min(bitmap.width, bitmap.height) < 900)
      warnings.push("解像度が低い可能性があります");
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = Math.round((256 * bitmap.height) / bitmap.width);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0,
      sum2 = 0,
      edge = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
      sum += v;
      sum2 += v * v;
      if (i >= 4) edge += Math.abs(v - (d[i - 4] + d[i - 3] + d[i - 2]) / 3);
    }
    const n = d.length / 4,
      mean = sum / n;
    if (mean < 80) warnings.push("画像が暗い可能性があります");
    if (sum2 / n - mean * mean < 150 || edge / n < 2)
      warnings.push("ぼけ・低コントラストの可能性があります");
    return warnings;
  } finally {
    bitmap.close();
  }
}
