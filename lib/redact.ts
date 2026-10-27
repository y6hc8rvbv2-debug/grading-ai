// 答案の写真の氏名欄の塗りつぶし（2026-10-27。docs/SECURITY-REVIEW.md）。ブラウザ専用
//   自動振り分け（/api/intake）が返す氏名欄の位置を、保存する前に塗りつぶす。写真に氏名を残さない（保存先にも採点AIにも届かない）。
//   位置が不自然（広すぎる・細長すぎる・無い）なときは塗りつぶさない（解答を消してしまわないため）。塗りつぶした写真は先生が確認できる
export type Box = { x: number; y: number; w: number; h: number };

/** 塗りつぶしてよい氏名欄か（ページの12%以下・高さ20%以下・幅80%以下・ページの中） */
export function usableNameBox(b: Box | null | undefined): b is Box {
  if (!b || !(b.w > 0) || !(b.h > 0)) return false;
  if (b.x < 0 || b.y < 0 || b.x + b.w > 1.001 || b.y + b.h > 1.001) return false;
  return b.w * b.h <= 0.12 && b.h <= 0.2 && b.w <= 0.8;
}

/** 少し広めに（上下左右に高さの25%）。ページの外には出さない */
export function paddedBox(b: Box): Box {
  const p = b.h * 0.25;
  const x = Math.max(0, b.x - p), y = Math.max(0, b.y - p);
  return { x, y, w: Math.min(1, b.x + b.w + p) - x, h: Math.min(1, b.y + b.h + p) - y };
}

/** 写真の氏名欄を塗りつぶした JPEG を返す */
export async function redactNameBox(file: File, box: Box): Promise<File> {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("この端末では写真を加工できません");
  ctx.drawImage(bmp, 0, 0);
  const b = paddedBox(box);
  ctx.fillStyle = "#3a3a3a";
  ctx.fillRect(Math.floor(b.x * bmp.width), Math.floor(b.y * bmp.height), Math.ceil(b.w * bmp.width), Math.ceil(b.h * bmp.height));
  bmp.close?.();
  const blob: Blob = await new Promise((ok, ng) => canvas.toBlob((x) => (x ? ok(x) : ng(new Error("写真を保存できませんでした"))), "image/jpeg", 0.92));
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}
