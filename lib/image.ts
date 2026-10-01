// 答案画像の前処理（ブラウザ側）。
// スマートフォンの写真は 5MB を超えることが多く、採点AIは1枚5MBまでしか受け付けない。
// 大きい画像・HEIC は、長辺 2400px の JPEG に縮小してから保存する。
// 手書き文字の読み取りには十分な解像度で、原本の見た目もほぼ変わらない。
//
// HEIC（iPhone の写真）: Safari はそのまま読めるが、Windows / Android の Chrome などは読めない。
// その場合は heic-to（libheif の WebAssembly 版）で JPEG に変換する。heic-to は大きいので、
// HEIC を選んだときにだけ読み込む。変換はブラウザの中で行い、写真を外部に送らない。

const MAX_EDGE = 2400;
const MAX_BYTES = 3.5 * 1024 * 1024;
const QUALITY = 0.88;

export const isHeic = (f: File) => /\.(heic|heif)$/i.test(f.name) || /image\/hei[cf]/i.test(f.type);
const isRaster = (f: File) => /^image\/(jpeg|png|webp)$/i.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name);
const toJpegName = (name: string) => name.replace(/\.[^.]+$/, "") + ".jpg";

/** ブラウザが読めない HEIC を JPEG に変換する。変換できなければ null */
async function heicToJpeg(file: File): Promise<File | null> {
  try {
    const { heicTo } = await import("heic-to");
    const blob = await heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
    return new File([blob], toJpegName(file.name), { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return null;
  }
}

/** 答案画像を、採点AIに送れる大きさ・形式にする。
 *  HEIC を変換できなかったときは元のファイルを返す（呼び出し側で isHeic() を見て案内する） */
export async function prepareImage(file: File): Promise<File> {
  if (!isRaster(file) && !isHeic(file)) return file;          // PDF などはそのまま
  if (typeof createImageBitmap !== "function") return file;

  let src = file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(src);
  } catch {
    if (!isHeic(file)) return file;                           // 壊れた画像などはそのまま
    const converted = await heicToJpeg(file);
    if (!converted) return file;
    src = converted;
    try {
      bitmap = await createImageBitmap(src);
    } catch {
      return src;
    }
  }
  const long = Math.max(bitmap.width, bitmap.height);
  if (!isHeic(src) && src.size <= MAX_BYTES && long <= MAX_EDGE) {
    bitmap.close();
    return src;                                                // 小さい画像は手を加えない
  }

  const scale = Math.min(1, MAX_EDGE / long);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) { bitmap.close(); return src; }
  ctx.fillStyle = "#fff";                                      // 透過 PNG の背景を白にする
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
  if (!blob) return src;
  return new File([blob], toJpegName(file.name), { type: "image/jpeg", lastModified: Date.now() });
}
