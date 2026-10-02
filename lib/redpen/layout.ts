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
import { cellAt, columnOf, inkRatio, type Cell, type Frames } from "@/lib/redpen/frames";

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
  const pagesWithCells = new Set<number>();
  for (const [, g0] of groups) {
    const g = [...g0].sort((a, b) => a.it.qno - b.it.qno);
    // 大問のページ＝AI の位置が多いページ
    const count = new Map<number, number>();
    g.filter((w) => w.anchor).forEach((w) => count.set(w.page, (count.get(w.page) ?? 0) + 1));
    const page = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
    const f = page ? pages[page - 1]?.frames : null;
    if (!page || !f) continue;

    const cells = new Map<Work, Cell>();
    for (const w of g) {
      if (!w.anchor || w.page !== page) continue;
      const c = center(w.anchor);
      const cell = cellAt(f, c.x * f.width, c.y * f.height);
      if (cell) cells.set(w, cell);
    }
    if (cells.size) pagesWithCells.add(page);

    // 同じ列（表）に入っている数を数え、小問の数と表の行数が同じ表を探す
    const columns: { rows: Cell[]; members: number }[] = [];
    for (const cell of cells.values()) {
      const rows = columnOf(f, cell);
      const same = columns.find((c) => Math.abs(c.rows[0].l - rows[0].l) < 6 && Math.abs(c.rows[0].r - rows[0].r) < 6 && Math.abs(c.rows[0].t - rows[0].t) < 6);
      if (same) same.members++;
      else columns.push({ rows, members: 1 });
    }
    const best = columns.sort((a, b) => b.members - a.members)[0];
    if (best && best.rows.length === g.length && best.members >= Math.ceil(g.length / 2)) {
      g.forEach((w, i) => {
        w.page = page;
        w.anchor = cellToBox(f, best.rows[i]);
        w.source = "table";
        // 表に割り当てられたので、位置が分からなかった・ページが合わなかった理由は解消する
        w.issues = [];
      });
      continue;
    }
    for (const [w, cell] of cells) {
      w.anchor = cellToBox(f, cell);
      w.source = "cell";
    }
  }

  // 枠のあるページで枠が見つからなかった設問（作図を除く）
  for (const w of work) {
    if (w.source === "bbox" && !w.it.graph && pagesWithCells.has(w.page)) w.issues.push("AI の位置に解答欄の枠が見つかりません");
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
