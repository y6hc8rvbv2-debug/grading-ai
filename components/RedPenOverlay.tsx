"use client";
// 原本の答案画像の上に、赤ペン（丸・バツ・三角・得点・コメント）を重ねて描く。
// 位置は採点AIが返した bbox（ページに対する割合 0〜1）を使う。
// 座標は画像の幅を 1000 とした空間で描くので、画像の解像度に関係なく同じ太さの線になる。
import React, { useEffect, useState } from "react";
import { FONT_HAND } from "@/lib/ui/theme";
import { seedOf } from "@/lib/util";
import { MarkGlyph, wobblePath } from "@/components/RedPenSheet";
import type { Submission, Test } from "@/lib/types";

const SHU = "#D0342C";
const W = 1000;

export type ItemBox = { qno: number; page: number; x: number; y: number; w: number; h: number };

export function RedPenOverlay({ imageUrl, sub, test, boxes, page = 1, showComments = true, svgRef }: {
  imageUrl: string; sub: Submission; test: Test; boxes: ItemBox[]; page?: number;
  showComments?: boolean; svgRef?: React.Ref<SVGSVGElement>;
}) {
  const [ratio, setRatio] = useState<number | null>(null);

  // 画像の縦横比を調べてから描く（縦長の答案も横長の答案もそのままの比率で表示する）
  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.onload = () => { if (alive) setRatio(img.naturalHeight / Math.max(1, img.naturalWidth)); };
    img.onerror = () => { if (alive) setRatio(1.414); };
    img.src = imageUrl;
    return () => { alive = false; };
  }, [imageUrl]);

  if (ratio == null) {
    return <div style={{ padding: 40, textAlign: "center", color: "#8A93A0", fontSize: 13 }}>原本画像を読み込んでいます…</div>;
  }
  const H = Math.round(W * ratio);
  const seed = seedOf(sub.id);
  const onPage = boxes.filter((b) => b.page === page);

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="原本に赤ペンを重ねた採点画像"
      style={{ display: "block", background: "#fff", borderRadius: 8, maxHeight: "80vh" }}>
      <image href={imageUrl} x="0" y="0" width={W} height={H} preserveAspectRatio="none" />

      {/* 合計点（右上） */}
      {page === 1 && (
        <g>
          <path d={wobblePath(W - 95, 62, 70, 40, 77)} fill="rgba(255,255,255,.75)" stroke={SHU} strokeWidth="3" opacity="0.9" />
          <text x={W - 105} y={78} textAnchor="middle" style={{ font: `700 44px ${FONT_HAND}` }} fill={SHU}>
            {sub.status === "blank" ? "白紙" : sub.result.total}
          </text>
          {sub.status !== "blank" && (
            <text x={W - 62} y={80} style={{ font: `600 20px ${FONT_HAND}` }} fill={SHU}>/{test.maxScore}</text>
          )}
        </g>
      )}

      {onPage.map((b) => {
        const it = sub.result.items.find((i) => i.qno === b.qno);
        if (!it) return null;
        const x = b.x * W, y = b.y * H, w = b.w * W, h = b.h * H;
        const size = Math.max(14, Math.min(34, h * 0.45));
        // マークは解答欄の右端に置く。右端に余白がなければ左上に置く
        const right = x + w + size + 8 < W - 40;
        const cx = right ? x + w + size + 6 : x + size;
        const cy = right ? y + h / 2 : y + size;
        const comment = it.comment.length > 30 ? it.comment.slice(0, 30) + "…" : it.comment;
        return (
          <g key={b.qno}>
            <MarkGlyph mark={it.blank ? "-" : it.mark} cx={cx} cy={cy} seed={it.qno * 31 + seed} size={size} />
            <text x={cx + size + 6} y={cy + 8} style={{ font: `700 ${Math.round(size * 0.9)}px ${FONT_HAND}` }} fill={SHU}>
              {it.earned}
            </text>
            {showComments && comment && (
              <text x={x} y={Math.min(H - 6, y + h + 22)} style={{ font: `600 18px ${FONT_HAND}` }}
                fill={SHU} stroke="#fff" strokeWidth="4" paintOrder="stroke">{comment}</text>
            )}
            {it.needReview && (
              <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} fill="none" stroke="#B4761A" strokeWidth="2.5" strokeDasharray="8 6" />
            )}
          </g>
        );
      })}
    </svg>
  );
}
