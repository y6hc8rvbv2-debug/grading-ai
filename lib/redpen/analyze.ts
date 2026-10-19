// 原本画像を読み込み、縦横比と解答欄の罫線を調べる（ブラウザ専用。画像を外部に送らない・採点AIを呼ばない）。
import { detectFrames, toGray } from "@/lib/redpen/frames";
import type { PageInput } from "@/lib/redpen/layout";

const loadImage = (url: string, cors: boolean) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  if (cors) img.crossOrigin = "anonymous";
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("image"));
  img.src = url;
});

export type AnalyzedPage = PageInput & {
  /** 罫線を調べられたか（調べられなければ AI の位置をそのまま使う） */
  analyzed: boolean;
};

/**
 * 1ページ分の原本を調べる。縦横比はブラウザが表示する向き（EXIF の回転を反映した向き）で測る。
 * 署名付きURLが別オリジンで画素を読めないときは、縦横比だけを返す。
 */
export async function analyzePage(url: string): Promise<AnalyzedPage> {
  let img: HTMLImageElement;
  try {
    img = await loadImage(url, true);
  } catch {
    try {
      const plain = await loadImage(url, false);
      return { aspect: plain.naturalHeight / Math.max(1, plain.naturalWidth), frames: null, analyzed: false };
    } catch {
      return { aspect: 1.414, frames: null, analyzed: false };
    }
  }
  const aspect = img.naturalHeight / Math.max(1, img.naturalWidth);
  try {
    const w = Math.min(1200, img.naturalWidth);
    const h = Math.max(1, Math.round(w * aspect));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { aspect, frames: null, analyzed: false };
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    // 重い計算の前に画面の描画を先に進める
    await new Promise((r) => setTimeout(r, 0));
    return { aspect, frames: detectFrames(toGray(data, 1200)), analyzed: true };
  } catch {
    return { aspect, frames: null, analyzed: false };
  }
}

/** HEIC のまま保存された以前の答案は、ブラウザ（Chrome など）が表示できないので JPEG にして表示する */
export async function displayableUrl(path: string, signedUrl: string): Promise<string> {
  if (!/\.(heic|heif)$/i.test(path)) return signedUrl;
  try {
    const blob = await (await fetch(signedUrl)).blob();
    const { heicTo } = await import("heic-to");
    const jpeg = await heicTo({ blob, type: "image/jpeg", quality: 0.92 });
    return URL.createObjectURL(jpeg);
  } catch {
    return signedUrl;
  }
}
