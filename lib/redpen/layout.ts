// ============================================================================
// 原本に重ねる赤ペン（○×△・得点）の置き場所を決める。画面・画像の保存・印刷で同じ結果を使う。
//
// 基準にするもの（上ほど優先）:
//   1. 先生が動かした位置（mark_positions に保存。0009）
//   2. 解答欄の表：大問ごとに、AI の位置が多く入っている表を探し、表の行数と小問の数が同じなら
//      小問の順番どおりに上の行から割り当てる（AI の位置が1行ずれていても、行の取り違えが起きない）
//   3. AI の位置を囲む解答欄の枠
//   4. AI の位置（bbox）そのもの。作図は枠が無いので、AI が返した作図の範囲を使う
// マークは基準の枠の右側・上下中央に、ページ内で同じ大きさで置く。
// 右側が空いていなければ、画像の外に足した余白に置き、枠の右端から細い線で結ぶ。
//
// 座標はすべてページの幅・高さに対する割合（0〜1）。画像の拡大・縮小・ページ切替でずれない。
// 次のときは「位置の要確認」にして、先生が直せるようにする:
//   位置が分からない / ページ番号が答案の枚数と合わない / ほかの設問と同じ欄を指している /
//   設問の順番と欄の並びが合わない / 枠が見つからない / 位置の大きさが不自然
// ============================================================================
import { allColumns, cellAt, inkRatio, type Cell, type Frames } from "@/lib/redpen/frames";

// 表の検出は重いので、同じページの結果を使い回す（先生が位置を動かすたびに数え直さない）
const columnCache = new WeakMap<Frames, Cell[][]>();
const columnsOf = (f: Frames) => {
  let c = columnCache.get(f);
  if (!c) { c = allColumns(f); columnCache.set(f, c); }
  return c;
};

export type Box = { x: number; y: number; w: number; h: number };
export type LayoutInput = {
  qno: number;
  /** 大問の番号（同じ大問の小問をまとめて表に割り当てる） */
  big: number;
  /** 作図・グラフ（解答欄の枠ではなく、描いた範囲を基準にする） */
  graph: boolean;
  bbox?: { page: number; x: number; y: number; w: number; h: number } | null;
};
export type PageInput = {
  /** 高さ ÷ 幅 */
  aspect: number;
  /** 罫線の検出結果。画像を調べられなかったときは null（AI の位置をそのまま使う） */
  frames: Frames | null;
};
/** 先生が動かした位置（マークの中心。ページに対する割合。右の余白に置いたときは x が 1 を超える） */
export type SavedPos = { qno: number; page: number; x: number; y: number };

export type Source = "saved" | "table" | "cell" | "bbox" | "none";
export type Placed = {
  qno: number;
  page: number;
  /** マークの中心（割合） */
  cx: number;
  cy: number;
  /** 基準にした枠（割合）。位置が分からないときは null */
  anchor: Box | null;
  /** 右の余白に置いたとき、枠の右端（線で結ぶ） */
  leader: { x: number; y: number } | null;
  source: Source;
  /** 位置の要確認の理由（空なら確認不要） */
  issues: string[];
};
export type PageLayout = {
  page: number;
  /** マークの半径（ページの幅に対する割合。ページ内で同じ大きさ） */
  r: number;
  /** 画像の右に足す余白（ページの幅に対する割合） */
  margin: number;
  placed: Placed[];
};

export const SOURCE_LABEL: Record<Source, string> = {
  saved: "先生が調整した位置",
  table: "解答欄の表（小問の順番で割り当て）",
  cell: "AI の位置を囲む解答欄の枠",
  bbox: "AI が返した位置",
  none: "位置が分からない",
};

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const iou = (a: Box, b: Box) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
};

/** 枠の検出結果（画素）を、ページに対する割合にする */
const cellToBox = (f: Frames, c: Cell): Box => ({ x: c.l / f.width, y: c.t / f.height, w: (c.r - c.l) / f.width, h: (c.b - c.t) / f.height });

type Work = { it: LayoutInput; page: number; anchor: Box | null; source: Source; issues: string[] };

/** 設問ごとの基準の枠を決める（表への割り当て・枠への吸着・要確認の判定） */
export function resolveAnchors(items: LayoutInput[], pages: PageInput[]): Work[] {
  const n = pages.length;
  const work: Work[] = items.map((it) => {
    const issues: string[] = [];
    let b = it.bbox && it.bbox.w > 0 && it.bbox.h > 0 ? it.bbox : null;
    if (b && (b.page < 1 || b.page > n)) {
      issues.push(`AI の位置が ${b.page} ページ目を指していますが、答案は ${n} ページです`);
      b = null;
    }
    if (!b) {
      if (!issues.length) issues.push("AI が解答欄の位置を返しませんでした");
      return { it, page: 1, anchor: null, source: "none", issues };
    }
    if (b.h < 0.004 || b.h > 0.35 || b.w > 0.95) issues.push("AI が返した位置の大きさが不自然です");
    return { it, page: b.page, anchor: { x: b.x, y: b.y, w: b.w, h: b.h }, source: "bbox", issues };
  });

  // 大問ごとに、解答欄の表へ割り当てる（作図は除く）
  const groups = new Map<number, Work[]>();
  for (const w of work) {
    if (w.it.graph) continue;
    const g = groups.get(w.it.big) ?? [];
    g.push(w);
    groups.set(w.it.big, g);
  }
  // ページごとの解答欄の表（AI の位置に頼らずに全部集める）
  type Col = { page: number; f: Frames; rows: Cell[]; cx: number; cy: number };
  const cols: Col[] = [];
  pages.forEach((p, i) => {
    if (!p.frames) return;
    for (const rows of columnsOf(p.frames)) {
      const f = p.frames;
      cols.push({ page: i + 1, f, rows, cx: (rows[0].l + rows[0].r) / 2 / f.width, cy: (rows[0].t + rows[rows.length - 1].b) / 2 / f.height });
    }
  });
  const pagesWithCells = new Set(cols.map((c) => c.page));

  // 大問ごとに、小問の数と行数が同じ表を探す。AI の位置（大問の中心）に近い表を選ぶ。
  // AI の位置が表の外（数行下など）にずれていても、行数が同じで一番近い表なら割り当てられる
  const order = [...groups.keys()].sort((a, b) => a - b);
  const info = order.map((big) => {
    const g = [...groups.get(big)!].sort((a, b) => a.it.qno - b.it.qno);
    const anchored = g.filter((w) => w.anchor);
    const count = new Map<number, number>();
    anchored.forEach((w) => count.set(w.page, (count.get(w.page) ?? 0) + 1));
    const page = [...count.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0]?.[0] ?? null;
    const on = anchored.filter((w) => w.page === page);
    const mid = on.length ? {
      x: on.reduce((t, w) => t + center(w.anchor!).x, 0) / on.length,
      y: on.reduce((t, w) => t + center(w.anchor!).y, 0) / on.length,
    } : null;
    return { big, g, page, mid, col: null as Col | null };
  });
  const score = (gi: (typeof info)[number], c: Col) =>
    gi.page == null || !gi.mid ? Infinity : (c.page !== gi.page ? 1 : 0) + Math.abs(c.cy - gi.mid.y) + 0.5 * Math.abs(c.cx - gi.mid.x);
  const MAX_SCORE = 0.3;     // 同じページで、ページの高さの3割より遠い表には割り当てない
  const used = new Set<Col>();
  // 近い組から順に決める（取り合いになっても、より近い大問が先に取る）
  const pairs: { gi: (typeof info)[number]; c: Col; s: number }[] = [];
  for (const gi of info) for (const c of cols) if (c.rows.length === gi.g.length) {
    const sc = score(gi, c);
    if (sc <= MAX_SCORE) pairs.push({ gi, c, s: sc });
  }
  pairs.sort((x, y) => x.s - y.s);
  for (const { gi, c } of pairs) if (!gi.col && !used.has(c)) { gi.col = c; used.add(c); }

  // 表の並び（ページ→上から下）と大問の順番が逆になったものは、取り違えの恐れがあるので外す
  const pos = (c: Col) => c.page * 10 + c.cy;
  const done = info.filter((gi) => gi.col);
  for (let i = 0; i + 1 < done.length; i++) {
    if (pos(done[i].col!) > pos(done[i + 1].col!)) {
      used.delete(done[i].col!); used.delete(done[i + 1].col!);
      done[i].col = null; done[i + 1].col = null;
    }
  }
  // AI の位置が1つも無い大問：前後の大問の表のあいだに、行数が同じ表が1つだけなら、並び順から推定する（要確認）
  info.forEach((gi, i) => {
    if (gi.col || gi.mid) return;
    const prev = info.slice(0, i).reverse().find((x) => x.col)?.col;
    const next = info.slice(i + 1).find((x) => x.col)?.col;
    // 前後の大問の表と縦に並ぶ（左右が重なる）欄だけを候補にする（問題文の中の表・枠を除く）
    const span = (c: Col) => [c.rows[0].l / c.f.width, c.rows[0].r / c.f.width];
    const inLine = (c: Col) => [prev, next].some((o) => {
      if (!o) return false;
      const [a0, a1] = span(o), [b0, b1] = span(c);
      return Math.min(a1, b1) - Math.max(a0, b0) > 0.5 * Math.min(a1 - a0, b1 - b0);
    });
    const cand = cols.filter((c) => !used.has(c) && c.rows.length === gi.g.length && inLine(c)
      && (!prev || pos(c) > pos(prev)) && (!next || pos(c) < pos(next)));
    if (cand.length === 1) { gi.col = cand[0]; used.add(cand[0]); (gi as { guessed?: boolean }).guessed = true; }
  });

  for (const gi of info) {
    const c = gi.col;
    if (c) {
      const guessed = (gi as { guessed?: boolean }).guessed;
      gi.g.forEach((w, i) => {
        w.page = c.page;
        w.anchor = cellToBox(c.f, c.rows[i]);
        w.source = "table";
        // 表に割り当てられたので、位置が分からなかった・ページが合わなかった理由は解消する
        w.issues = guessed ? ["AI が位置を返さなかったため、解答欄の並び順から推定しました"] : [];
      });
      continue;
    }
    // 表に割り当てられない大問：AI の位置を囲む枠があればそれを使う
    for (const w of gi.g) {
      const f = w.anchor ? pages[w.page - 1]?.frames : null;
      if (!f || !w.anchor) continue;
      const m = center(w.anchor);
      const cell = cellAt(f, m.x * f.width, m.y * f.height);
      if (cell) { w.anchor = cellToBox(f, cell); w.source = "cell"; }
    }
  }

  // 枠のあるページで枠が見つからなかった設問（作図を除く）
  for (const w of work) {
    if (w.source === "bbox" && !w.it.graph && pagesWithCells.has(w.page)) w.issues.push("解答欄の枠と対応づけられません（AI の位置をそのまま使っています）");
    if (w.source === "cell" && !w.it.graph) w.issues.push("大問の小問の数と解答欄の表の行数が合いません");
  }

  // ほかの設問と同じ欄を指している
  for (let i = 0; i < work.length; i++) {
    for (let j = i + 1; j < work.length; j++) {
      const a = work[i], b = work[j];
      if (!a.anchor || !b.anchor || a.page !== b.page) continue;
      if (a.source === "table" && b.source === "table") continue;
      if (iou(a.anchor, b.anchor) > 0.5) {
        const msg = "ほかの設問と同じ欄を指しています";
        if (!a.issues.includes(msg)) a.issues.push(msg);
        if (!b.issues.includes(msg)) b.issues.push(msg);
      }
    }
  }

  // 同じ大問の中で、設問の順番と欄の並び（上から下）が合わない
  for (const [, g0] of groups) {
    const g = g0.filter((w) => w.anchor && w.source !== "table").sort((a, b) => a.it.qno - b.it.qno);
    for (let i = 0; i + 1 < g.length; i++) {
      const a = g[i], b = g[i + 1];
      if (a.page !== b.page) continue;
      const ca = center(a.anchor!), cb = center(b.anchor!);
      const newColumn = cb.x > a.anchor!.x + a.anchor!.w * 0.8;
      if (!newColumn && cb.y < ca.y - a.anchor!.h * 0.5) {
        const msg = "設問の順番と解答欄の並びが合いません";
        if (!a.issues.includes(msg)) a.issues.push(msg);
        if (!b.issues.includes(msg)) b.issues.push(msg);
      }
    }
  }
  return work;
}

/**
 * 全ページの赤ペンの置き場所を決める。
 * saved（先生が動かした位置）があればその位置に置き、要確認は消す（先生が確かめたため）。
 */
export function layoutMarks(items: LayoutInput[], pages: PageInput[], saved: SavedPos[] = []): PageLayout[] {
  const work = resolveAnchors(items, pages);
  const savedBy = new Map(saved.filter((s) => s.page >= 1 && s.page <= pages.length).map((s) => [s.qno, s]));

  return pages.map((p, pi) => {
    const page = pi + 1;
    const aspect = p.aspect > 0 ? p.aspect : 1.414;
    const f = p.frames;
    const onPage = work.filter((w) => (savedBy.get(w.it.qno)?.page ?? w.page) === page);

    // マークの大きさ：解答欄の高さに合わせ、ページ内でそろえる（ページの幅に対する割合）
    const hs = onPage.filter((w) => w.anchor && (w.source === "table" || w.source === "cell")).map((w) => w.anchor!.h * aspect);
    const r = Math.max(0.011, Math.min(0.022, hs.length ? median(hs) * 0.36 : 0.016));
    const gap = r * 0.6;
    const scoreW = r * 1.9;         // 得点（2桁）を書く幅
    const rY = r / aspect;          // 縦方向の半径（高さに対する割合）

    const placed: Placed[] = [];
    const taken: Box[] = [];        // 置いたマークと得点の範囲（重なりを避ける）
    const hits = (b: Box) => taken.some((t) => b.x < t.x + t.w && t.x < b.x + b.w && b.y < t.y + t.h && t.y < b.y + b.h);
    const lane: Placed[] = [];

    // 先生が動かした位置
    for (const w of onPage) {
      const s = savedBy.get(w.it.qno);
      if (!s) continue;
      placed.push({ qno: w.it.qno, page, cx: s.x, cy: s.y, anchor: w.anchor, leader: null, source: "saved", issues: [] });
      taken.push({ x: s.x - r, y: s.y - rY, w: 2 * r + scoreW, h: 2 * rY });
    }

    // 枠の右側へ。同じ表の行は、全部が右側に収まるときだけ右側に置き、1つでも収まらなければ全部を余白に置く
    // （同じ表のマークの横位置をそろえ、どの行のマークかを見分けやすくする）
    const rest = onPage.filter((w) => !savedBy.has(w.it.qno)).sort((a, b) => (a.anchor?.y ?? 2) - (b.anchor?.y ?? 2) || a.it.qno - b.it.qno);
    const areaOf = (a: Box): Box => {
      const cy = a.y + a.h / 2;
      return { x: a.x + a.w + gap * 0.5, y: cy - rY, w: gap * 0.5 + 2 * r + scoreW, h: 2 * rY };
    };
    const fits = (a: Box) => {
      const area = areaOf(a);
      if (area.x + area.w > 0.995) return false;
      return !f || inkRatio(f, area.x * f.width, area.y * f.height, (area.x + area.w) * f.width, (area.y + area.h) * f.height) < 0.025;
    };
    const colKey = (w: Work) => (w.source === "table" && w.anchor ? `${w.it.big}` : `q${w.it.qno}`);
    const colFits = new Map<string, boolean>();
    for (const w of rest) {
      if (!w.anchor) continue;
      const k = colKey(w);
      colFits.set(k, (colFits.get(k) ?? true) && fits(w.anchor));
    }
    for (const w of rest) {
      if (!w.anchor) {
        lane.push({ qno: w.it.qno, page, cx: 0, cy: 0, anchor: null, leader: null, source: "none", issues: w.issues });
        continue;
      }
      const a = w.anchor;
      const area = areaOf(a);
      const cy = a.y + a.h / 2;
      if (colFits.get(colKey(w)) && !hits(area)) {
        placed.push({ qno: w.it.qno, page, cx: a.x + a.w + gap + r, cy, anchor: a, leader: null, source: w.source, issues: w.issues });
        taken.push(area);
      } else {
        lane.push({ qno: w.it.qno, page, cx: 0, cy, anchor: a, leader: { x: a.x + a.w, y: cy }, source: w.source, issues: w.issues });
      }
    }

    // 右の余白：枠の高さにそろえて縦に並べ、重なれば下へずらす。位置が分からない設問は上から順に並べる
    let margin = 0;
    const savedRight = placed.filter((pl) => pl.source === "saved").map((pl) => pl.cx + r + scoreW - 1);
    if (lane.length) {
      margin = gap * 2 + 2 * r + scoreW;
      const x = 1 + gap + r;
      let last = -Infinity;
      let top = 0.04;
      for (const l of lane.sort((a, b) => (a.anchor ? a.cy : -1) - (b.anchor ? b.cy : -1) || a.qno - b.qno)) {
        let cy = l.anchor ? l.cy : top;
        if (!l.anchor) top += rY * 2.6;
        cy = Math.max(cy, last + rY * 2.3);
        last = cy;
        placed.push({ ...l, cx: x, cy: Math.min(cy, 1 - rY) });
      }
    }
    if (savedRight.length) margin = Math.max(margin, ...savedRight.map((v) => v + gap));
    placed.sort((a, b) => a.qno - b.qno);
    return { page, r, margin: Math.max(0, Math.min(0.3, margin)), placed };
  });
}
