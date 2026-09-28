// 答案画像の前処理（ブラウザ側）。
// スマートフォンの写真は 5MB を超えることが多く、採点AIは1枚5MBまでしか受け付けない。
// 大きい画像・HEIC（ブラウザが読める場合）は、長辺 2400px の JPEG に縮小してから保存する。
// 手書き文字の読み取りには十分な解像度で、原本の見た目もほぼ変わらない。

const MAX_EDGE = 2400;
const MAX_BYTES = 3.5 * 1024 * 1024;
const QUALITY = 0.88;

const isHeic = (f: File) => /\.(heic|heif)$/i.test(f.name) || /image\/hei[cf]/i.test(f.type);
const isRaster = (f: File) => /^image\/(jpeg|png|webp)$/i.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name);

export async function prepareImage(file: File): Promise<File> {
  if (!isRaster(file) && !isHeic(file)) return file;          // PDF などはそのまま
  if (typeof createImageBitmap !== "function") return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;                                               // 読めない HEIC などはそのまま（採点時に案内する）
  }
  const long = Math.max(bitmap.width, bitmap.height);
  if (!isHeic(file) && file.size <= MAX_BYTES && long <= MAX_EDGE) {
    bitmap.close();
    return file;                                               // 小さい画像は手を加えない
  }

  const scale = Math.min(1, MAX_EDGE / long);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) { bitmap.close(); return file; }
  ctx.fillStyle = "#fff";                                      // 透過 PNG の背景を白にする
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
  if (!blob) return file;
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
}
