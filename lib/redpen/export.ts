// 赤ペンを重ねた原本を、画像（PNG）にする・印刷する（ブラウザ専用）。
// 画面と同じ部品（RedPenOverlay）・同じ置き場所（layoutMarks）で描いた SVG を、そのまま画像にする。

/** 画像を data URL にする（保存した画像に原本を埋め込むため。署名付きURLは10分で切れる） */
export async function toDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

/** 描いた SVG を PNG にする。pxWidth は原本の画像の部分の幅（画素） */
export async function svgToPng(svg: SVGSVGElement, pxWidth = 1600): Promise<Blob> {
  const vb = svg.viewBox.baseVal;
  const scale = pxWidth / 1000;
  const w = Math.round(vb.width * scale);
  const h = Math.round(vb.height * scale);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.removeAttribute("style");
  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("赤ペン画像を作れませんでした"));
      i.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("赤ペン画像を作れませんでした");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error("赤ペン画像を作れませんでした");
    return png;
  } finally {
    URL.revokeObjectURL(url);
  }
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
