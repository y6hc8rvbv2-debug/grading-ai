"use client";
// 赤ペン採点画像（signature element）。docs/prototype-v3.jsx から移植。
// 答案の上に丸・バツ・三角・得点・コメントを手描き風に重ねて描画する。
import React from "react";
import { FONT_UI, FONT_HAND } from "@/lib/ui/theme";
import { fmtDate, mulberry32, seedOf } from "@/lib/util";
import { useUI } from "@/components/ui-context";
import type { Mark, Submission, Test } from "@/lib/types";

/* ---------------------------------------------------------------------------
 * 8. 赤ペン採点画像（清書版・固定レイアウト）
 *    丸・バツ・三角・得点・コメントを手描き風に描く。原本の写真に重ねる版は RedPenOverlay（lib/redpen/layout.ts）。
 * -------------------------------------------------------------------------*/
export function wobblePath(cx: number, cy: number, rx: number, ry: number, seed: number) {
  const rnd = mulberry32(seed);
  const pts: [number, number][] = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2 - 0.5;
    const jitter = 1 + (rnd() - 0.5) * 0.13;
    pts.push([cx + Math.cos(a) * rx * jitter, cy + Math.sin(a) * ry * jitter]);
  }
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i];
    const [px, py] = pts[i - 1];
    d += ` Q ${(px + (x - px) * 0.5 + (rnd() - 0.5) * 4).toFixed(1)} ${(py + (y - py) * 0.5 + (rnd() - 0.5) * 4).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d + " Z";
}
function strokeLine(x1: number, y1: number, x2: number, y2: number, seed: number) {
  const rnd = mulberry32(seed);
  const mx = (x1 + x2) / 2 + (rnd() - 0.5) * 6;
  const my = (y1 + y2) / 2 + (rnd() - 0.5) * 6;
  return `M ${x1} ${y1} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${x2} ${y2}`;
}

export function MarkGlyph({ mark, cx, cy, seed, size = 17 }: { mark: Mark; cx: number; cy: number; seed: number; size?: number }) {
  const SHU = "#D0342C";
  const common = { fill: "none", stroke: SHU, strokeWidth: 2.6, strokeLinecap: "round" as const, opacity: 0.92 };
  if (mark === "○") return <path d={wobblePath(cx, cy, size, size * 0.92, seed)} {...common} />;
  if (mark === "×")
    return (
      <g {...common}>
        <path d={strokeLine(cx - size, cy - size, cx + size, cy + size, seed)} fill="none" stroke={SHU} strokeWidth={2.8} strokeLinecap="round" />
        <path d={strokeLine(cx + size, cy - size, cx - size, cy + size, seed + 9)} fill="none" stroke={SHU} strokeWidth={2.8} strokeLinecap="round" />
      </g>
    );
  if (mark === "△") {
    const rnd = mulberry32(seed);
    const j = () => (rnd() - 0.5) * 3;
    const p = `M ${cx + j()} ${cy - size + j()} L ${cx + size + j()} ${cy + size * 0.8 + j()} L ${cx - size + j()} ${cy + size * 0.8 + j()} Z`;
    return <path d={p} {...common} />;
  }
  return (
    <text x={cx} y={cy + 6} textAnchor="middle" fill={SHU} style={{ font: `700 17px ${FONT_HAND}` }} opacity={0.8}>—</text>
  );
}

export function RedPenSheet({ test, sub, page = 0, showMarks = true, showComments = true, svgRef }: {
  test: Test; sub: Submission; page?: number; showMarks?: boolean; showComments?: boolean;
  svgRef?: React.Ref<SVGSVGElement>;
}) {
  const { T, studentById, classById } = useUI();
  const st = studentById(sub.studentId);
  const kl = classById(sub.classId);
  if (!st || !kl) return null;
  const perPage = 7;
  const items = sub.result.items.slice(page * perPage, page * perPage + perPage);
  const W = 760, H = 1075;
  const SHU = "#D0342C";
  const rowH = 108;
  const top = 190;

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", background: T.sheet, borderRadius: 8, maxHeight: "72vh" }} role="img"
      aria-label="赤ペン採点画像">
      <defs>
        <pattern id="fiber" width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill="#FFFDF7" />
          <circle cx="1.6" cy="2.4" r="0.35" fill="#EFE9DA" />
          <circle cx="4.4" cy="5.1" r="0.3" fill="#F1ECDE" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#fiber)" />
      <rect x="0.5" y="0.5" width={W - 1} height={H - 1} fill="none" stroke="#CFC7B4" />

      {/* ヘッダー */}
      <text x="34" y="52" style={{ font: `700 21px ${FONT_UI}` }} fill="#1D2733">
        {test.subject}　{test.name}
      </text>
      <text x="34" y="76" style={{ font: `13px ${FONT_UI}` }} fill="#5C6675">
        {test.grade}年 ／ {test.term} ／ 実施日 {fmtDate(test.date)} ／ 試験番号 {test.testNo}
      </text>
      <line x1="34" y1="92" x2={W - 34} y2="92" stroke="#C9C0AC" />

      {/* 受験者欄（匿名表示） */}
      <rect x="34" y="106" width={W - 260} height="56" fill="none" stroke="#C9C0AC" />
      <text x="46" y="126" style={{ font: `11px ${FONT_UI}` }} fill="#8A93A0">受験者（匿名表示）</text>
      <text x="46" y="150" style={{ font: `700 16px ${FONT_UI}` }} fill="#1D2733">
        {kl.label} {st.number}番 ／ 受験番号 {st.examNo} ／ {st.anonId}
      </text>

      {/* 得点欄（赤） */}
      <rect x={W - 214} y="106" width="180" height="56" fill="none" stroke="#C9C0AC" />
      <text x={W - 202} y="126" style={{ font: `11px ${FONT_UI}` }} fill="#8A93A0">得点</text>
      {showMarks && (
        <>
          <text x={W - 118} y="154" textAnchor="middle" style={{ font: `700 30px ${FONT_HAND}` }} fill={SHU}>
            {sub.result.total}
          </text>
          <text x={W - 62} y="154" style={{ font: `600 15px ${FONT_HAND}` }} fill={SHU}>/{test.maxScore}</text>
          <path d={wobblePath(W - 118, 144, 40, 22, 77)} fill="none" stroke={SHU} strokeWidth="2.2" opacity="0.85" />
        </>
      )}

      {/* 設問行 */}
      {items.map((it, i) => {
        const y = top + i * rowH;
        const q = test.questions.find((qq) => qq.no === it.qno);
        return (
          <g key={it.qno}>
            <line x1="34" y1={y - 14} x2={W - 34} y2={y - 14} stroke="#E2DACA" />
            <text x="40" y={y + 6} style={{ font: `700 13px ${FONT_UI}` }} fill="#1D2733">{it.label}</text>
            <text x="40" y={y + 26} style={{ font: `10.5px ${FONT_UI}` }} fill="#8A93A0">{it.unit}・{it.typeLabel}・{it.points}点</text>

            {/* 解答欄 */}
            <rect x="132" y={y - 8} width={W - 260} height="72" fill="#FFFFFF" stroke="#DDD5C4" />
            {it.blank ? (
              <text x="146" y={y + 34} style={{ font: `13px ${FONT_UI}` }} fill="#B7BDC6">（無記入）</text>
            ) : (
              <text x="146" y={y + 34} style={{ font: `17px ${FONT_HAND}` }} fill="#28323E">{it.detected}</text>
            )}
            {q && !it.blank && (
              <text x="146" y={y + 56} style={{ font: `10.5px ${FONT_UI}` }} fill="#A6AEB9">
                認識信頼度 {(it.confidence * 100).toFixed(0)}%
              </text>
            )}

            {/* 赤ペンマーク */}
            {showMarks && (
              <g>
                <MarkGlyph mark={it.blank ? "-" : it.mark} cx={W - 96} cy={y + 18} seed={it.qno * 31 + seedOf(sub.id)} />
                <text x={W - 60} y={y + 24} style={{ font: `700 15px ${FONT_HAND}` }} fill={SHU}>
                  {it.earned}
                </text>
              </g>
            )}
            {/* 赤ペンコメント */}
            {showMarks && showComments && it.comment && (
              <text x="146" y={y + 74} style={{ font: `12px ${FONT_HAND}` }} fill={SHU}>
                {it.comment.length > 42 ? it.comment.slice(0, 42) + "…" : it.comment}
              </text>
            )}
            {it.needReview && (
              <g>
                <rect x="128" y={y - 12} width={W - 252} height="80" fill="none" stroke="#B4761A" strokeDasharray="5 4" />
                <text x={W - 246} y={y - 18} textAnchor="end" style={{ font: `700 10px ${FONT_UI}` }} fill="#B4761A">要確認</text>
              </g>
            )}
          </g>
        );
      })}

      <line x1="34" y1={H - 46} x2={W - 34} y2={H - 46} stroke="#C9C0AC" />
      <text x="34" y={H - 26} style={{ font: `10.5px ${FONT_UI}` }} fill="#9AA2AD">
        テスト採点 ／ 生徒実名は保存されません ／ ページ {page + 1} / {Math.ceil(sub.result.items.length / perPage)}
      </text>
      {showMarks && (
        <text x={W - 34} y={H - 26} textAnchor="end" style={{ font: `600 10.5px ${FONT_UI}` }} fill={SHU}>
          AI採点 ＋ 教師確認欄 {sub.reviewedBy ? `確認済 ${sub.reviewedBy}` : "未確認"}
        </text>
      )}
    </svg>
  );
}
