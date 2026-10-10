"use client";
// 原本の答案画像の上に、赤ペン（○×△・得点）を重ねて描く。
// 置き場所は lib/redpen/layout.ts の layoutMarks() が決めたもの（画面・画像の保存・印刷で同じ）。
//   - 座標は画像の幅を 1000 とした空間で描く。画像とマークが同じ座標なので、拡大・縮小・ページ切替でずれない
//   - 右側に置けないマークは、画像の右に足した余白に置き、解答欄の右端から細い線で結ぶ
//   - コメントは画像に書かず、画面の「設問ごとのコメント」に出す（答案の文字と重ならないように）
//   - editable のとき、○×△ をドラッグ（またはフォーカスして矢印キー）で動かせる。
//     動かしても判定・得点・コメント・要確認は変わらない（位置だけを保存する）
import React, { useRef, useState } from "react";
import { FONT_HAND, FONT_UI } from "@/lib/ui/theme";
import { seedOf } from "@/lib/util";
import { MarkGlyph, wobblePath } from "@/components/RedPenSheet";
import type { PageLayout } from "@/lib/redpen/layout";
import type { Submission, Test } from "@/lib/types";

const SHU = "#D0342C";
const AMBER = "#B4761A";
const BLUE = "#2F6FDE";
const W = 1000;

export function RedPenOverlay({
  imageUrl, sub, test, page, aspect, layout, editable = false, selected = null, onSelect, onMove, svgRef, forExport = false,
}: {
  imageUrl: string; sub: Submission; test: Test; page: number; aspect: number; layout: PageLayout;
  editable?: boolean; selected?: number | null;
  onSelect?: (qno: number) => void;
  /** マークを動かした（x・y はページに対する割合） */
  onMove?: (qno: number, x: number, y: number) => void;
  svgRef?: React.Ref<SVGSVGElement>;
  /** 画像の保存・印刷用（選択枠・要確認の印・操作用の当たり判定を描かない） */
  forExport?: boolean;
}) {
  const inner = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<{ qno: number; x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);

  const H = Math.round(W * aspect);
  const M = Math.round(layout.margin * W);
  const R = layout.r * W;
  const band = page === 1 ? 64 : 0;          // 1ページ目の上に合計点の帯を足す（答案に重ねない）
  const seed = seedOf(sub.id);
  const setRef = (el: SVGSVGElement | null) => {
    inner.current = el;
    if (typeof svgRef === "function") svgRef(el);
    else if (svgRef) (svgRef as React.MutableRefObject<SVGSVGElement | null>).current = el;
  };
  // 画面上の位置 → 描画の座標（拡大・縮小・余白があっても正しく変換する）
  const toSvg = (e: React.PointerEvent) => {
    const svg = inner.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  // 動かせる範囲は画像と右の余白の中（表示の大きさは動かしている間も変えない）
  const viewW = W + M;
  const clampPos = (x: number, y: number) => ({
    x: Math.max(R, Math.min(viewW - R * 2.6, x)),
    y: Math.max(R * 0.5, Math.min(H - R * 0.5, y)),
  });

  return (
    <svg ref={setRef} viewBox={`0 ${-band} ${viewW} ${H + band}`} width="100%" role="img"
      aria-label={`原本 ${page} ページ目に赤ペンを重ねた採点画像`} data-testid={forExport ? "redpen-export" : "redpen-overlay"} data-page={page}
      style={{ display: "block", background: "#fff", borderRadius: forExport ? 0 : 8, maxHeight: forExport ? undefined : "80vh", userSelect: "none" }}>
      <rect x={0} y={-band} width={viewW} height={H + band} fill="#fff" />
      <image href={imageUrl} x="0" y="0" width={W} height={H} preserveAspectRatio="none" />
      {M > 0 && <line x1={W} y1={0} x2={W} y2={H} stroke="#D9DDE3" strokeWidth={1} strokeDasharray="6 5" />}

      {/* 合計点（1ページ目の上の帯。答案の文字・得点欄に重ねない） */}
      {page === 1 && (
        <g>
          <text x={14} y={-band / 2 + 8} style={{ font: `600 20px ${FONT_UI}` }} fill="#6B7380">{test.subject}／{test.name}</text>
          <path d={wobblePath(viewW - 92, -band / 2, 74, 26, 77)} fill="none" stroke={SHU} strokeWidth="3" opacity="0.9" />
          <text x={viewW - 104} y={-band / 2 + 13} textAnchor="middle" style={{ font: `700 36px ${FONT_HAND}` }} fill={SHU}>
            {sub.status === "blank" ? "白紙" : sub.result.total}
          </text>
          {sub.status !== "blank" && (
            <text x={viewW - 64} y={-band / 2 + 13} style={{ font: `600 18px ${FONT_HAND}` }} fill={SHU}>/{test.maxScore}</text>
          )}
        </g>
      )}

      {layout.placed.map((p) => {
        const it = sub.result.items.find((i) => i.qno === p.qno);
        if (!it) return null;
        const live = drag?.qno === p.qno ? drag : null;
        const cx = live ? live.x : p.cx * W;
        const cy = live ? live.y : p.cy * H;
        const isSel = selected === p.qno;
        const needPos = p.issues.length > 0 && !live;
        const mark = it.blank ? "-" : it.mark;
        const moveBy = (dx: number, dy: number) => {
          const c = clampPos(cx + dx, cy + dy);
          onMove?.(p.qno, c.x / W, c.y / H);
        };
        return (
          <g key={p.qno} data-qno={p.qno} data-source={p.source} data-cx={cx.toFixed(1)} data-cy={cy.toFixed(1)}>
            {!forExport && isSel && p.anchor && (
              <rect x={p.anchor.x * W - 3} y={p.anchor.y * H - 3} width={p.anchor.w * W + 6} height={p.anchor.h * H + 6}
                fill="rgba(47,111,222,.07)" stroke={BLUE} strokeWidth={2} strokeDasharray="7 5" />
            )}
            {p.leader && !live && (
              <path d={`M ${p.leader.x * W + 2} ${p.leader.y * H} L ${cx - R * 1.15} ${cy}`} stroke={SHU} strokeWidth={1.3}
                strokeDasharray="5 4" opacity={0.55} fill="none" />
            )}
            <MarkGlyph mark={mark} cx={cx} cy={cy} seed={it.qno * 31 + seed} size={R} />
            <text x={cx + R * 1.2} y={cy + R * 0.45} style={{ font: `700 ${Math.round(R * 1.15)}px ${FONT_HAND}` }} fill={SHU}>
              {it.earned}
            </text>
            {!forExport && needPos && (
              <g data-testid="pos-review">
                <circle cx={cx} cy={cy} r={R * 1.55} fill="none" stroke={AMBER} strokeWidth={2.2} strokeDasharray="5 4" />
                <text x={cx - R * 1.55} y={cy - R * 1.2} textAnchor="middle" style={{ font: `800 ${Math.round(R * 0.95)}px ${FONT_UI}` }}
                  fill={AMBER} stroke="#fff" strokeWidth={3} paintOrder="stroke">?</text>
              </g>
            )}
            {!forExport && editable && (
              // 当たり判定（指でもつかめるように、マークより少し大きくする）
              <circle cx={cx} cy={cy} r={R * 1.7} fill="transparent" tabIndex={0} role="button" data-testid="mark-handle"
                aria-label={`${it.label} の赤ペン（${mark}）。ドラッグまたは矢印キーで位置を動かせます`}
                style={{ cursor: live ? "grabbing" : "grab", touchAction: "none", outline: "none" }}
                stroke={isSel ? BLUE : "none"} strokeWidth={isSel ? 1.5 : 0}
                onPointerDown={(e) => {
                  const pt = toSvg(e);
                  if (!pt) return;
                  e.preventDefault();
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  setDrag({ qno: p.qno, x: cx, y: cy, ox: pt.x - cx, oy: pt.y - cy, moved: false });
                }}
                onPointerMove={(e) => {
                  if (!drag || drag.qno !== p.qno) return;
                  const pt = toSvg(e);
                  if (!pt) return;
                  const c = clampPos(pt.x - drag.ox, pt.y - drag.oy);
                  const moved = drag.moved || Math.hypot(c.x - cx, c.y - cy) > 2;
                  setDrag({ ...drag, x: c.x, y: c.y, moved });
                }}
                onPointerUp={() => {
                  if (!drag || drag.qno !== p.qno) return;
                  if (drag.moved) onMove?.(p.qno, drag.x / W, drag.y / H);
                  else onSelect?.(p.qno);
                  setDrag(null);
                }}
                onPointerCancel={() => setDrag(null)}
                onFocus={() => onSelect?.(p.qno)}
                onKeyDown={(e) => {
                  const step = e.shiftKey ? 10 : 2;
                  const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
                  const v = d[e.key];
                  if (!v) return;
                  e.preventDefault();
                  moveBy(v[0], v[1]);
                }} />
            )}
          </g>
        );
      })}
    </svg>
  );
}
