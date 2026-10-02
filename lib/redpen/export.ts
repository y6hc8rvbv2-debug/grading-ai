// 赤ペンを重ねた原本を、画像（PNG）にする・印刷する（ブラウザ専用）。
// 画面と同じ部品（RedPenOverlay）・同じ置き場所（layoutMarks）で描いた SVG を、そのまま画像にする。

/**
 * 原本の写真を読み込む。応答がエラー（署名付きURLの期限切れなど）や画像でないときは、例外にする。
 * （以前は応答をそのまま埋め込んでいたため、期限切れのエラー文が埋め込まれ、白地に赤ペンだけの画像になっていた）
 */
export async function loadPhoto(url: string): Promise<ImageBitmap> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch {
    throw new Error("原本の写真を取得できませんでした。通信状態を確かめて、もう一度お試しください。");
  }
  if (!res.ok) throw new Error(`原本の写真を取得できませんでした（HTTP ${res.status}）。画面を再読み込みしてから、もう一度お試しください。`);
  const blob = await res.blob();
  if (!/^image\//.test(blob.type) && blob.type !== "") {
    throw new Error("原本の写真を取得できませんでした（画像ではない応答でした）。画面を再読み込みしてから、もう一度お試しください。");
  }
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new Error("原本の写真を読み込めませんでした。画面を再読み込みしてから、もう一度お試しください。");
  }
}

/**
 * 原本の写真と赤ペンを1枚の PNG にする。pxWidth は原本の部分の幅（画素）。
 * 写真は canvas に直接描き（SVG の中の画像の読み込み待ちに頼らない）、その上に赤ペン（SVG）を重ねる。
 * 写真の部分が真っ白・単色なら、合成に失敗したとみなして例外にする（原本の無い PNG を保存しない）。
 */
export async function composePng(svg: SVGSVGElement, photo: ImageBitmap, pxWidth = 1600): Promise<Blob> {
  const vb = svg.viewBox.baseVal;
  const scale = pxWidth / 1000;
  const w = Math.round(vb.width * scale);
  const h = Math.round(vb.height * scale);
  const imgEl = svg.querySelector("image");
  if (!imgEl) throw new Error("赤ペン画像を作れませんでした");
  const ix = (Number(imgEl.getAttribute("x")) - vb.x) * scale;
  const iy = (Number(imgEl.getAttribute("y")) - vb.y) * scale;
  const iw = Number(imgEl.getAttribute("width")) * scale;
  const ih = Number(imgEl.getAttribute("height")) * scale;
  // 画面に表示している原本と縦横比が違えば、別の画像を取得したとみなす
  if (Math.abs(photo.height / photo.width - ih / iw) > 0.03) throw new Error("原本の写真の縦横比が画面と合いません。画面を再読み込みしてから、もう一度お試しください。");

  // 赤ペンだけの SVG（原本の <image> と背景を外す）
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll("image").forEach((n) => n.remove());
  clone.querySelector("rect")?.setAttribute("fill", "none");
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.removeAttribute("style");
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const marks = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("赤ペン画像を作れませんでした"));
      i.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("赤ペン画像を作れませんでした");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(photo, ix, iy, iw, ih);
    if (!hasPicture(ctx, ix, iy, iw, ih)) throw new Error("原本の写真を合成できませんでした。画面を再読み込みしてから、もう一度お試しください。");
    ctx.drawImage(marks, 0, 0, w, h);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error("赤ペン画像を作れませんでした");
    return png;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 写真の部分に濃淡があるか（真っ白・単色なら false） */
function hasPicture(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const d = ctx.getImageData(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))).data;
  let n = 0, sum = 0, sq = 0;
  const step = Math.max(4, Math.floor(d.length / 4 / 20000)) * 4;
  for (let i = 0; i < d.length; i += step) {
    const v = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    sum += v; sq += v * v; n++;
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sq / n - mean * mean)) > 4;
}

export function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** 画像（ページごと）を、1ページ1枚で印刷する。見えない iframe に並べて、その中で印刷する */
export async function printImages(blobs: Blob[], title: string) {
  document.querySelectorAll("iframe[data-redpen-print]").forEach((f) => f.remove());
  const urls = blobs.map((b) => URL.createObjectURL(b));
  const frame = document.createElement("iframe");
  frame.setAttribute("data-redpen-print", "1");
  frame.setAttribute("data-testid", "print-frame");
  frame.title = "印刷用";
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/[<&>]/g, "")}</title>
<style>@page{margin:8mm}html,body{margin:0}img{display:block;width:100%;height:auto;max-height:100vh;object-fit:contain;page-break-after:always;break-after:page}img:last-child{page-break-after:auto;break-after:auto}</style>
</head><body>${urls.map((u, i) => `<img src="${u}" alt="${i + 1}ページ目" data-page="${i + 1}">`).join("")}</body></html>`);
  doc.close();
  await Promise.all([...doc.images].map((im) => (im.complete ? Promise.resolve() : new Promise((r) => { im.onload = r; im.onerror = r; }))));
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  // 印刷の画面を閉じたあとで片付ける（すぐ消すと印刷が空になるブラウザがある）
  setTimeout(() => { frame.remove(); urls.forEach((u) => URL.revokeObjectURL(u)); }, 60000);
}
