// ============================================================================
// 答案画像から、印刷された解答欄の枠（罫線で囲まれたマス）を見つける。
//
// 採点AIが返す位置（bbox）は「だいたいの場所」で、1行ずれることがある。
// 赤ペンは解答欄の枠を基準に置きたいので、画像の罫線を手元で調べて枠を求める。
//   - ブラウザの中だけで動く（画像を外部に送らない。採点AIも呼ばない）
//   - 純粋な計算だけなので、Node の単体テストでも同じ処理を検査できる
//
// 手順:
//   1. 縮小した濃淡画像を、周囲より暗い画素（インク・罫線）に2値化する（影・明るさのむらに強い）
//   2. 長くつながった横線・縦線を拾う（少しの傾きは 1画素のずれを許してつなぐ）
//   3. 指定した点を囲む「上下の横線＋左右の縦線」のマスを探す
//   4. そのマスと同じ列に縦に並ぶマス（解答欄の表の各行）を集める
// ============================================================================

export type Gray = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };
export type HSeg = { y: number; x0: number; x1: number };
export type VSeg = { x: number; y0: number; y1: number };
export type Cell = { l: number; t: number; r: number; b: number };
export type Frames = {
  width: number;
  height: number;
  /** 周囲より暗い画素（1 = インク・罫線）。空きの判定に使う */
  ink: Uint8Array;
  h: HSeg[];
  v: VSeg[];
};

/** RGBA（canvas の ImageData・jpeg-js の出力）を、幅 targetW 以下の濃淡画像にする */
export function toGray(rgba: { width: number; height: number; data: Uint8Array | Uint8ClampedArray }, targetW = 1200): Gray {
  const s = Math.max(1, rgba.width / targetW);
  const w = Math.max(1, Math.round(rgba.width / s));
  const h = Math.max(1, Math.round(rgba.height / s));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor(y * s), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * s));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x * s), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * s));
      let sum = 0, n = 0;
      for (let yy = sy0; yy < sy1 && yy < rgba.height; yy++) {
        for (let xx = sx0; xx < sx1 && xx < rgba.width; xx++) {
          const i = (yy * rgba.width + xx) * 4;
          sum += rgba.data[i] * 0.299 + rgba.data[i + 1] * 0.587 + rgba.data[i + 2] * 0.114;
          n++;
        }
      }
      out[y * w + x] = n ? Math.round(sum / n) : 255;
    }
  }
  return { width: w, height: h, data: out };
}

/** 周囲（半径 rad）の平均より c 以上暗い画素を 1 にする */
function binarize(g: Gray, rad: number, c: number) {
  const { width: w, height: h, data } = g;
  const ii = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x];
      ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row;
    }
  }
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - rad), y1 = Math.min(h, y + rad + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - rad), x1 = Math.min(w, x + rad + 1);
      const sum = ii[y1 * (w + 1) + x1] - ii[y0 * (w + 1) + x1] - ii[y1 * (w + 1) + x0] + ii[y0 * (w + 1) + x0];
      const mean = sum / ((y1 - y0) * (x1 - x0));
      if (data[y * w + x] < mean - c) ink[y * w + x] = 1;
    }
  }
  return ink;
}

/** 横線を拾う。1行ごとに、上下1画素を含めて暗い画素が続く区間（途中の切れ目 gap 画素まで許す）を探す */
function horizontal(ink: Uint8Array, w: number, h: number, minLen: number, gap: number): HSeg[] {
  const raw: HSeg[] = [];
  for (let y = 1; y < h - 1; y++) {
    let start = -1, last = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && (ink[y * w + x] || ink[(y - 1) * w + x] || ink[(y + 1) * w + x]);
      if (on) {
        if (start < 0) start = x;
        last = x;
      } else if (start >= 0 && x - last > gap) {
        if (last - start + 1 >= minLen) raw.push({ y, x0: start, x1: last });
        start = -1;
      }
    }
  }
  return mergeH(raw);
}

function vertical(ink: Uint8Array, w: number, h: number, minLen: number, gap: number): VSeg[] {
  const raw: VSeg[] = [];
  for (let x = 1; x < w - 1; x++) {
    let start = -1, last = -1;
    for (let y = 0; y <= h; y++) {
      const on = y < h && (ink[y * w + x] || ink[y * w + x - 1] || ink[y * w + x + 1]);
      if (on) {
        if (start < 0) start = y;
        last = y;
      } else if (start >= 0 && y - last > gap) {
        if (last - start + 1 >= minLen) raw.push({ x, y0: start, y1: last });
        start = -1;
      }
    }
  }
  return mergeV(raw);
}

// 太さのある線は隣り合う数行で同じ線として拾われるので、1本にまとめる（傾きで切れた続きもつなぐ）
function mergeH(segs: HSeg[]): HSeg[] {
  const out: (HSeg & { n: number; sy: number })[] = [];
  for (const s of segs) {
    const m = out.find((o) => Math.abs(o.y - s.y) <= 4 && s.x0 <= o.x1 + 8 && s.x1 >= o.x0 - 8);
    if (m) {
      m.x0 = Math.min(m.x0, s.x0); m.x1 = Math.max(m.x1, s.x1);
      m.sy += s.y; m.n++; m.y = m.sy / m.n;
    } else out.push({ ...s, n: 1, sy: s.y });
  }
  return out.map(({ y, x0, x1 }) => ({ y, x0, x1 }));
}
function mergeV(segs: VSeg[]): VSeg[] {
  const out: (VSeg & { n: number; sx: number })[] = [];
  for (const s of segs) {
    const m = out.find((o) => Math.abs(o.x - s.x) <= 4 && s.y0 <= o.y1 + 8 && s.y1 >= o.y0 - 8);
    if (m) {
      m.y0 = Math.min(m.y0, s.y0); m.y1 = Math.max(m.y1, s.y1);
      m.sx += s.x; m.n++; m.x = m.sx / m.n;
    } else out.push({ ...s, n: 1, sx: s.x });
  }
  return out.map(({ x, y0, y1 }) => ({ x, y0, y1 }));
}

/** 画像から罫線を拾う（重い処理なのでページごとに1回だけ呼ぶ） */
export function detectFrames(g: Gray): Frames {
  const { width: w, height: h } = g;
  const ink = binarize(g, Math.max(6, Math.round(w / 90)), 14);
  return {
    width: w,
    height: h,
    ink,
    h: horizontal(ink, w, h, Math.round(w * 0.05), 2),
    v: vertical(ink, w, h, Math.round(h * 0.016), 2),
  };
}

const TOL = 5;
const covers = (s: HSeg, a: number, b: number) => {
  const inter = Math.min(s.x1, b) - Math.max(s.x0, a);
  return inter >= (b - a) * 0.85;
};
const coversV = (s: VSeg, a: number, b: number) => {
  const inter = Math.min(s.y1, b) - Math.max(s.y0, a);
  return inter >= (b - a) * 0.7;
};

/** 点 (px, py) を囲むマス（上下の横線と左右の縦線）。見つからなければ null */
export function cellAt(f: Frames, px: number, py: number): Cell | null {
  const maxH = f.height * 0.14;
  const maxW = f.width * 0.9;
  const tops = f.h.filter((s) => s.y < py - 2 && py - s.y < maxH && s.x0 - TOL <= px && px <= s.x1 + TOL).sort((a, b) => b.y - a.y);
  const bots = f.h.filter((s) => s.y > py + 2 && s.y - py < maxH && s.x0 - TOL <= px && px <= s.x1 + TOL).sort((a, b) => a.y - b.y);
  // 一番近い上下の線から順に試し、左右の縦線がそろう最小のマスを選ぶ
  for (const top of tops.slice(0, 3)) {
    for (const bot of bots.slice(0, 3)) {
      const t = top.y, b = bot.y;
      if (b - t < f.height * 0.012) continue;
      const lefts = f.v.filter((s) => s.x < px - 2 && px - s.x < maxW && coversV(s, t, b)).sort((a, c) => c.x - a.x);
      const rights = f.v.filter((s) => s.x > px + 2 && s.x - px < maxW && coversV(s, t, b)).sort((a, c) => a.x - c.x);
      for (const L of lefts.slice(0, 2)) {
        for (const R of rights.slice(0, 2)) {
          if (R.x - L.x < f.width * 0.03) continue;
          if (covers(top, L.x, R.x) && covers(bot, L.x, R.x)) return { l: L.x, t, r: R.x, b };
        }
      }
    }
  }
  return null;
}

/** マス c と同じ列（左右の縦線が共通）に、上下に続けて並ぶマスを上から順に返す（c を含む） */
export function columnOf(f: Frames, c: Cell): Cell[] {
  const ch = c.b - c.t;
  const lines = f.h.filter((s) => covers(s, c.l, c.r)).map((s) => s.y).sort((a, b) => a - b);
  const sides = (t: number, b: number) =>
    f.v.some((s) => Math.abs(s.x - c.l) <= TOL + 2 && coversV(s, t, b)) &&
    f.v.some((s) => Math.abs(s.x - c.r) <= TOL + 2 && coversV(s, t, b));
  const rows: Cell[] = [c];
  // 上へ
  let t = c.t;
  for (;;) {
    const prev = lines.filter((y) => y < t - 2 && t - y >= ch * 0.5 && t - y <= ch * 2.2).pop();
    if (prev == null || !sides(prev, t)) break;
    rows.unshift({ l: c.l, t: prev, r: c.r, b: t });
    t = prev;
  }
  // 下へ
  let b = c.b;
  for (;;) {
    const next = lines.find((y) => y > b + 2 && y - b >= ch * 0.5 && y - b <= ch * 2.2);
    if (next == null || !sides(b, next)) break;
    rows.push({ l: c.l, t: b, r: c.r, b: next });
    b = next;
  }
  return rows;
}

/** 長方形の中のインクの割合（0〜1）。赤ペンを置く場所が空いているかを調べる */
export function inkRatio(f: Frames, x0: number, y0: number, x1: number, y1: number) {
  const a = Math.max(0, Math.floor(x0)), b = Math.min(f.width, Math.ceil(x1));
  const c = Math.max(0, Math.floor(y0)), d = Math.min(f.height, Math.ceil(y1));
  if (b <= a || d <= c) return 1;
  let n = 0;
  for (let y = c; y < d; y++) for (let x = a; x < b; x++) n += f.ink[y * f.width + x];
  return n / ((b - a) * (d - c));
}

/**
 * ページの中の、縦に並ぶマスの列（解答欄の表）をすべて集める。
 * AI の位置に頼らずに探すので、AI の位置が表の外（数行下など）にずれていても表を見つけられる。
 * 同じ行の並びで左右に分かれた列（設問番号の欄と解答の欄）は、幅の広いほう（解答の欄）だけを残す。
 */
export function allColumns(f: Frames): Cell[][] {
  const step = Math.max(8, Math.round(f.width / 120));
  const cols: Cell[][] = [];
  const seen = new Set<string>();
  for (let y = step; y < f.height; y += step) {
    for (let x = step; x < f.width; x += step) {
      const c = cellAt(f, x, y);
      if (!c) continue;
      const key = `${Math.round(c.l / 4)}|${Math.round(c.t / 4)}|${Math.round(c.r / 4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const rows = columnOf(f, c);
      const same = cols.findIndex((o) => Math.abs(o[0].l - rows[0].l) < 6 && Math.abs(o[0].r - rows[0].r) < 6 && Math.abs(o[0].t - rows[0].t) < 6);
      if (same < 0) cols.push(rows);
      else if (rows.length > cols[same].length) cols[same] = rows;
    }
  }
  // 同じ行の並び（上端・下端・行数が同じ）で左右に並ぶ列は、幅の広いほうだけ
  const wide = (c: Cell[]) => c[0].r - c[0].l;
  const out = cols.filter((c) => wide(c) >= f.width * 0.06).filter((c, _, all) => !all.some((o) => o !== c && o.length === c.length
    && Math.abs(o[0].t - c[0].t) < 8 && Math.abs(o[o.length - 1].b - c[c.length - 1].b) < 8
    && (wide(o) > wide(c) || (wide(o) === wide(c) && o[0].l < c[0].l))
    && Math.min(o[0].r, c[0].r) - Math.max(o[0].l, c[0].l) > -f.width * 0.02));
  return out.sort((a, b) => a[0].t - b[0].t || a[0].l - b[0].l);
}
