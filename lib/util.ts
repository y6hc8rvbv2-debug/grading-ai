// 汎用ユーティリティ。docs/prototype-v3.jsx から移植。
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const pct = (a, b) => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10);
export const fmtDate = (iso) => (iso || "").slice(0, 10).replace(/-/g, "/");
export const fmtDateTime = (iso) =>
  !iso ? "" : `${iso.slice(0, 10).replace(/-/g, "/")} ${iso.slice(11, 16)}`;
export const uid = (() => {
  let n = 1000;
  return (p = "id") => `${p}_${++n}`;
})();

export function download(filename, text, mime = "text/plain;charset=utf-8") {
  try {
    const blob = new Blob(["\uFEFF" + text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch (e) {
    console.warn("download failed", e);
    return false;
  }
}
export function toCSV(rows, headers) {
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = headers.map((h) => esc(h.label)).join(",");
  const body = rows
    .map((r) => headers.map((h) => esc(typeof h.get === "function" ? h.get(r) : r[h.key])).join(","))
    .join("\n");
  return head + "\n" + body;
}

/** 文字列（UUID など）から描画用の安定したシード値を作る */
export function seedOf(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 100000;
}
