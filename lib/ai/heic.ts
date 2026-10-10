// HEIC（iPhone の写真）を JPEG に変換する（サーバー専用）。
//
// 新しく取り込む答案は、ブラウザ側（lib/image.ts）で JPEG に変換してから保存する。
// ここは、以前に HEIC のまま保存された答案を AI 採点するときの予備の変換。
// 採点AI（Claude）は HEIC を受け付けないため、長辺 2400px の JPEG にして渡す。
import "server-only";
import decode from "heic-decode";
import jpeg from "jpeg-js";

const MAX_EDGE = 2400;

/** 画像の先頭を見て HEIC / HEIF かを判定する（拡張子に頼らない） */
export function looksLikeHeic(buf: Uint8Array) {
  if (buf.length < 12) return false;
  const box = String.fromCharCode(...buf.slice(4, 8));
  const brand = String.fromCharCode(...buf.slice(8, 12));
  return box === "ftyp" && ["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "heis"].includes(brand);
}

/** RGBA を面積平均で縮小する（文字がつぶれにくい） */
function downscale(src: Uint8Array | Uint8ClampedArray, w: number, h: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  if (scale === 1) return { data: src, width: w, height: h };
  const W = Math.max(1, Math.round(w * scale));
  const H = Math.max(1, Math.round(h * scale));
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor((y * h) / H);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / H));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor((x * w) / W);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / W));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        let i = (sy * w + x0) * 4;
        for (let sx = x0; sx < x1; sx++, i += 4) { r += src[i]; g += src[i + 1]; b += src[i + 2]; n++; }
      }
      const o = (y * W + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { data: out, width: W, height: H };
}

/** HEIC を長辺 2400px 以下の JPEG に変換する */
export async function heicToJpeg(buf: Uint8Array, maxEdge = MAX_EDGE): Promise<Buffer> {
  const img = await decode({ buffer: buf });
  const small = downscale(img.data, img.width, img.height, maxEdge);
  const encoded = jpeg.encode({ data: small.data, width: small.width, height: small.height }, 88);
  return Buffer.from(encoded.data);
}
