// 原本に重ねる赤ペンの置き場所（lib/redpen/frames.ts・layout.ts）の単体テスト。採点AIは呼ばない。
//   実行: npm run test:unit
// 答案の画像は合成（罫線の表と、文字の代わりの点）。実際の答案での確認は、手元の画像を
// REDPEN_REAL_DIR に置いたときだけ行う（答案には生徒の氏名が写っているので、リポジトリには入れない）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import jpeg from "jpeg-js";
import { cellAt, columnOf, detectFrames, toGray, type Gray } from "../../lib/redpen/frames";
import { layoutMarks, resolveAnchors, type LayoutInput, type PageInput } from "../../lib/redpen/layout";

const W = 1200, H = 1600;

/** 合成の答案：背景（明るさのむらあり）＋右側に解答欄の表＋左側に文字の代わりの点 */
function sheet(tables: { x0: number; x1: number; label: number; top: number; rows: number; rowH: number }[], seed = 7): Gray {
  const data = new Uint8Array(W * H);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[y * W + x] = 215 + Math.round((x / W) * 25) + Math.round(rnd() * 6);
  const dark = (x: number, y: number) => { if (x >= 0 && y >= 0 && x < W && y < H) data[y * W + x] = 45; };
  const hline = (y: number, x0: number, x1: number) => { for (let x = x0; x <= x1; x++) { dark(x, y); dark(x, y + 1); } };
  const vline = (x: number, y0: number, y1: number) => { for (let y = y0; y <= y1; y++) { dark(x, y); dark(x + 1, y); } };
  for (const t of tables) {
    const bottom = t.top + t.rows * t.rowH;
    for (let r = 0; r <= t.rows; r++) hline(t.top + r * t.rowH, t.x0, t.x1);
    vline(t.x0, t.top, bottom); vline(t.label, t.top, bottom); vline(t.x1, t.top, bottom);
    // 解答欄の中の手書きの代わり（左寄り）
    for (let r = 0; r < t.rows; r++) for (let k = 0; k < 40; k++) dark(t.label + 15 + Math.round(rnd() * 60), t.top + r * t.rowH + 12 + Math.round(rnd() * 20));
  }
  // 問題文の代わり
  for (let k = 0; k < 6000; k++) {
    const x = 80 + Math.round(rnd() * 650), y = 100 + Math.round(rnd() * 1400);
    for (let d = 0; d < 6; d++) dark(x + d, y);
  }
  return { width: W, height: H, data };
}

const T1 = { x0: 860, x1: 1040, label: 905, top: 120, rows: 5, rowH: 45 };
const T2 = { x0: 860, x1: 1040, label: 905, top: 440, rows: 3, rowH: 45 };
const page1 = (): PageInput => ({ aspect: H / W, frames: detectFrames(sheet([T1, T2])) });
const rowCenter = (t: typeof T1, i: number) => (t.top + t.rowH * (i + 0.5)) / H;
/** AI の位置（手書きの範囲。1行下へずれる想定にもできる） */
const ai = (t: typeof T1, i: number, shift = 0) => ({ page: 1, x: (t.label + 10) / W, y: (t.top + t.rowH * (i + shift) + 8) / H, w: 90 / W, h: 28 / H });

test("罫線から解答欄の表（行の数）を見つける", () => {
  const f = page1().frames!;
  const c = cellAt(f, 950, 120 + 45 * 2 + 20);
  assert.ok(c, "マスが見つかること");
  assert.ok(Math.abs(c!.t - (120 + 90)) <= 3 && Math.abs(c!.b - (120 + 135)) <= 3, "上下の罫線");
  assert.ok(Math.abs(c!.l - 905) <= 3 && Math.abs(c!.r - 1040) <= 3, "左右の罫線（番号の欄の右から表の右端まで）");
  assert.equal(columnOf(f, c!).length, 5, "表の行は5つ");
  assert.equal(columnOf(f, cellAt(f, 950, 440 + 20)!).length, 3, "2つ目の表の行は3つ");
  assert.equal(cellAt(f, 300, 600), null, "問題文の上にはマスが無い");
});

test("AI の位置が1行ずれていても、小問の順番どおりに表の行へ割り当てる", () => {
  const items: LayoutInput[] = [0, 1, 2, 3, 4].map((i) => ({ qno: i + 1, big: 1, graph: false, bbox: ai(T1, i, 1) }));
  const [p] = layoutMarks(items, [page1()]);
  assert.equal(p.placed.length, 5);
  p.placed.forEach((m, i) => {
    assert.equal(m.source, "table");
    assert.ok(Math.abs(m.cy - rowCenter(T1, i)) < 0.003, `設問${i + 1}は${i + 1}行目の上下中央`);
    assert.ok(m.cx > T1.x1 / W, "解答欄の枠の右側");
    assert.deepEqual(m.issues, []);
  });
  // 同じ表のマークは横位置がそろう
  assert.equal(new Set(p.placed.map((m) => m.cx.toFixed(4))).size, 1);
});

test("マークの大きさはページ内でそろい、枠・隣の行・得点と重ならない", () => {
  const items: LayoutInput[] = [
    ...[0, 1, 2, 3, 4].map((i) => ({ qno: i + 1, big: 1, graph: false, bbox: ai(T1, i) })),
    ...[0, 1, 2].map((i) => ({ qno: 6 + i, big: 2, graph: false, bbox: ai(T2, i) })),
  ];
  const [p] = layoutMarks(items, [page1()]);
  const rowH = 45 / H;
  const rY = p.r / (H / W);
  assert.ok(rY * 2 < rowH, "マスの高さに収まる大きさ");
  for (const m of p.placed) assert.ok(m.cx - p.r > T1.x1 / W, "枠の右の罫線に重ならない");
  for (let i = 0; i + 1 < p.placed.length; i++) {
    const a = p.placed[i], b = p.placed[i + 1];
    if (Math.abs(a.cx - b.cx) < 2 * p.r) assert.ok(Math.abs(a.cy - b.cy) >= 2 * rY, "隣の設問のマークと重ならない");
  }
});

test("小問の数と表の行数が同じなら、AI が位置を返さなかった設問も行に割り当てる", () => {
  const items: LayoutInput[] = [0, 1, 2].map((i) => ({ qno: 6 + i, big: 2, graph: false, bbox: i === 1 ? null : ai(T2, i) }));
  const [p] = layoutMarks(items, [page1()]);
  const q7 = p.placed.find((m) => m.qno === 7)!;
  assert.equal(q7.source, "table");
  assert.ok(Math.abs(q7.cy - rowCenter(T2, 1)) < 0.003);
  assert.deepEqual(q7.issues, []);
});

test("作図は解答欄の枠ではなく、AI が返した作図の範囲を基準にする", () => {
  const items: LayoutInput[] = [{ qno: 11, big: 3, graph: true, bbox: { page: 1, x: 0.4, y: 0.6, w: 0.2, h: 0.1 } }];
  const [p] = layoutMarks(items, [page1()]);
  assert.equal(p.placed[0].source, "bbox");
  assert.ok(Math.abs(p.placed[0].cy - 0.65) < 1e-9, "作図の範囲の上下中央");
  assert.ok(p.placed[0].cx > 0.6, "作図の範囲の右側");
});

test("確かめられない位置は「位置の要確認」にする", () => {
  const noFrames: PageInput[] = [{ aspect: 1.4, frames: null }];
  const w = resolveAnchors([
    { qno: 1, big: 1, graph: false, bbox: { page: 1, x: 0.7, y: 0.2, w: 0.2, h: 0.04 } },
    { qno: 2, big: 1, graph: false, bbox: { page: 1, x: 0.7, y: 0.2, w: 0.2, h: 0.04 } },     // 同じ欄
    { qno: 3, big: 2, graph: false, bbox: { page: 1, x: 0.7, y: 0.5, w: 0.2, h: 0.04 } },
    { qno: 4, big: 2, graph: false, bbox: { page: 1, x: 0.7, y: 0.4, w: 0.2, h: 0.04 } },     // 順番が逆
    { qno: 5, big: 3, graph: false, bbox: { page: 3, x: 0.7, y: 0.4, w: 0.2, h: 0.04 } },     // ページが無い
    { qno: 6, big: 3, graph: false, bbox: null },                                              // 位置なし
    { qno: 7, big: 4, graph: false, bbox: { page: 1, x: 0.7, y: 0.8, w: 0.2, h: 0.04 } },     // 問題なし
  ], noFrames);
  const issues = (q: number) => w.find((x) => x.it.qno === q)!.issues.join("／");
  assert.match(issues(1), /同じ欄/);
  assert.match(issues(2), /同じ欄/);
  assert.match(issues(3), /順番/);
  assert.match(issues(4), /順番/);
  assert.match(issues(5), /3 ページ目/);
  assert.match(issues(6), /返しませんでした/);
  assert.equal(issues(7), "");
});

test("位置が分からない設問は右の余白に並べ、要確認にする", () => {
  const [p] = layoutMarks([{ qno: 1, big: 1, graph: false, bbox: null }, { qno: 2, big: 1, graph: false, bbox: null }], [{ aspect: 1.4, frames: null }]);
  assert.ok(p.margin > 0, "右に余白を足す");
  assert.ok(p.placed.every((m) => m.cx > 1 && m.issues.length > 0));
  assert.ok(Math.abs(p.placed[0].cy - p.placed[1].cy) > 2 * p.r / 1.4, "重ならない");
});

test("右側に余白が無い表は、画像の外の余白に置いて線で結ぶ", () => {
  const T = { x0: 1000, x1: 1190, label: 1040, top: 200, rows: 3, rowH: 45 };
  const pg: PageInput = { aspect: H / W, frames: detectFrames(sheet([T])) };
  const [p] = layoutMarks([0, 1, 2].map((i) => ({ qno: i + 1, big: 1, graph: false, bbox: ai(T, i) })), [pg]);
  assert.ok(p.margin > 0);
  p.placed.forEach((m, i) => {
    assert.equal(m.source, "table");
    assert.ok(m.cx > 1, "画像の外の余白");
    assert.ok(m.leader && Math.abs(m.leader.x - T.x1 / W) < 0.003, "解答欄の右端から線で結ぶ");
    assert.ok(Math.abs(m.cy - rowCenter(T, i)) < 0.003, "行の上下中央にそろえる");
  });
});

test("先生が動かした位置を優先し、位置の要確認を外す。判定・得点の情報は使わない", () => {
  const items: LayoutInput[] = [{ qno: 1, big: 1, graph: false, bbox: null }, { qno: 2, big: 1, graph: false, bbox: { page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.04 } }];
  const pages: PageInput[] = [{ aspect: 1.4, frames: null }, { aspect: 1.3, frames: null }];
  const out = layoutMarks(items, pages, [{ qno: 1, page: 2, x: 1.05, y: 0.5 }]);
  const m = out[1].placed.find((x) => x.qno === 1)!;
  assert.equal(m.source, "saved");
  assert.deepEqual(m.issues, []);
  assert.equal(m.cx, 1.05);
  assert.ok(out[1].margin > 0.05, "余白に置いた位置が見えるよう余白を広げる");
  assert.ok(!out[0].placed.some((x) => x.qno === 1), "元のページからは消える");
});

test("toGray は大きい画像を縮小して濃淡にする", () => {
  const rgba = { width: 2400, height: 3200, data: new Uint8Array(2400 * 3200 * 4).fill(255) };
  const g = toGray(rgba, 1200);
  assert.equal(g.width, 1200);
  assert.equal(g.height, 1600);
  assert.equal(g.data[0], 255);
});

// 手元の実際の答案（2ページ・20問・小問 5,5,1,3,1,3,2）で、表の行数を確かめる
const REAL = process.env.REDPEN_REAL_DIR;
test("実際の答案の表（REDPEN_REAL_DIR があるときだけ）", { skip: !REAL || !existsSync(`${REAL}/p1.jpg`) }, () => {
  const load = (f: string) => { const img = jpeg.decode(readFileSync(`${REAL}/${f}`), { useTArray: true }); return { aspect: img.height / img.width, frames: detectFrames(toGray(img, 1200)) }; };
  const pages = [load("p1.jpg"), load("p2.jpg")];
  const counts = (pg: PageInput, pts: [number, number][]) => pts.map(([x, y]) => {
    const f = pg.frames!;
    const c = cellAt(f, x * f.width, y * f.height);
    return c ? columnOf(f, c).length : 0;
  });
  assert.deepEqual(counts(pages[0], [[0.82, 0.12], [0.82, 0.3], [0.85, 0.53], [0.85, 0.69]]), [5, 5, 1, 3]);
  assert.deepEqual(counts(pages[1], [[0.8, 0.03], [0.8, 0.31], [0.8, 0.63]]), [1, 3, 2]);
});
