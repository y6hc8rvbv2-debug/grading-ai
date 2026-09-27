"use client";
// 共通UIコンポーネント。docs/prototype-v3.jsx から移植。
import React, { useEffect, useState, type ReactNode, type CSSProperties } from "react";
import { FONT_UI, FONT_MONO, type Theme } from "@/lib/ui/theme";
import { clamp, mulberry32 } from "@/lib/util";
import { useUI } from "@/components/ui-context";

type P = Record<string, any>;

export function Card({ children, style, pad = 16, title, sub, right, tone }: P) {
  const { T } = useUI();
  return (
    <section
      style={{
        background: tone === "alt" ? T.panelAlt : T.panel,
        border: `1px solid ${T.line}`,
        borderRadius: 14,
        boxShadow: T.shadow,
        overflow: "hidden",
        ...style,
      }}
    >
      {(title || right) && (
        <header
          style={{
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            padding: "12px 16px", borderBottom: `1px solid ${T.line}`,
            background: T.panelAlt,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, letterSpacing: ".02em" }}>{title}</div>
            {sub && <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 2 }}>{sub}</div>}
          </div>
          {right}
        </header>
      )}
      <div style={{ padding: pad }}>{children}</div>
    </section>
  );
}

export function Btn({ children, onClick, variant = "default", size = "md", disabled, style, title, full }: P) {
  const { T } = useUI();
  const [hover, setHover] = useState(false);
  const pads = { sm: "5px 10px", md: "8px 14px", lg: "11px 20px" };
  const fonts = { sm: 12, md: 13, lg: 14.5 };
  const map = {
    default: { bg: T.panel, fg: T.text, bd: T.lineStrong },
    primary: { bg: T.accent, fg: "#fff", bd: T.accent },
    shu: { bg: T.shu, fg: "#fff", bd: T.shu },
    ghost: { bg: "transparent", fg: T.textSub, bd: "transparent" },
    soft: { bg: T.accentSoft, fg: T.accent, bd: "transparent" },
    danger: { bg: T.ngSoft, fg: T.ng, bd: T.ng },
  };
  const c = map[variant] || map.default;
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{
        font: `600 ${fonts[size]}px/1.2 ${FONT_UI}`,
        padding: pads[size],
        borderRadius: 9,
        border: `1px solid ${c.bd}`,
        background: c.bg,
        color: c.fg,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : hover ? 0.88 : 1,
        transition: "opacity .15s, transform .1s",
        transform: hover && !disabled ? "translateY(-1px)" : "none",
        width: full ? "100%" : undefined,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = "info", style }: P) {
  const { T } = useUI();
  const map = {
    ok: [T.okSoft, T.ok], warn: [T.warnSoft, T.warn], ng: [T.ngSoft, T.ng],
    info: [T.infoSoft, T.info], accent: [T.accentSoft, T.accent], shu: [T.shuSoft, T.shu],
    mute: [T.bgAlt, T.textSub],
  };
  const [bg, fg] = map[tone] || map.info;
  return (
    <span style={{ background: bg, color: fg, borderRadius: 999, padding: "3px 9px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", ...style }}>
      {children}
    </span>
  );
}

export function Field({ label, children, hint }: P) {
  const { T } = useUI();
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: T.textSub, marginBottom: 5 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: T.textFaint, marginTop: 4 }}>{hint}</div>}
    </label>
  );
}

export function inputStyle(T: Theme): CSSProperties {
  return {
    width: "100%", boxSizing: "border-box", padding: "9px 11px",
    borderRadius: 9, border: `1px solid ${T.lineStrong}`,
    background: T.panel, color: T.text, font: `500 13px ${FONT_UI}`, outline: "none",
  };
}

export function Select({ value, onChange, options, style }: P) {
  const { T } = useUI();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle(T), ...style }}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Input({ value, onChange, placeholder, type = "text", style }: P) {
  const { T } = useUI();
  return (
    <input type={type} value={value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle(T), ...style }} />
  );
}

export function Bar({ value, max = 100, tone = "accent", height = 8, label }: P) {
  const { T } = useUI();
  const map = { accent: T.accent, ok: T.ok, warn: T.warn, ng: T.ng, shu: T.shu, info: T.info };
  const w = clamp((value / (max || 1)) * 100, 0, 100);
  return (
    <div>
      <div style={{ background: T.bgAlt, borderRadius: 999, height, overflow: "hidden" }}>
        <div style={{ width: `${w}%`, height: "100%", background: map[tone] || T.accent, borderRadius: 999, transition: "width .5s ease" }} />
      </div>
      {label && <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: 3 }}>{label}</div>}
    </div>
  );
}

export function Stat({ label, value, unit, tone = "accent", sub }: P) {
  const { T } = useUI();
  const map = { accent: T.accent, ok: T.ok, warn: T.warn, ng: T.ng, shu: T.shu, info: T.info, text: T.text };
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 12, padding: 14, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: T.textSub, fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span style={{ font: `700 26px/1 ${FONT_MONO}`, color: map[tone] }}>{value}</span>
        {unit && <span style={{ fontSize: 12, color: T.textSub, fontWeight: 600 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11, color: T.textFaint, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

export function Table({ columns, rows, onRow, empty = "データがありません", maxHeight }: P) {
  const { T } = useUI();
  return (
    <div style={{ overflowX: "auto", maxHeight, overflowY: maxHeight ? "auto" : undefined }}>
      <table style={{ width: "100%", borderCollapse: "collapse", font: `13px ${FONT_UI}`, minWidth: columns.length * 92 }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{
                textAlign: c.align || "left", padding: "9px 10px", fontSize: 11, fontWeight: 700,
                color: T.textSub, borderBottom: `1px solid ${T.lineStrong}`, whiteSpace: "nowrap",
                position: maxHeight ? "sticky" : undefined, top: 0, background: T.panel, zIndex: 1,
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} style={{ padding: 26, textAlign: "center", color: T.textFaint, fontSize: 12.5 }}>{empty}</td></tr>
          )}
          {rows.map((r, i) => (
            <tr key={r.id || i}
              onClick={onRow ? () => onRow(r) : undefined}
              style={{ cursor: onRow ? "pointer" : "default", background: i % 2 ? T.panelAlt : "transparent" }}>
              {columns.map((c) => (
                <td key={c.key} style={{
                  padding: "9px 10px", borderBottom: `1px solid ${T.line}`, color: T.text,
                  textAlign: c.align || "left", whiteSpace: c.wrap ? "normal" : "nowrap",
                }}>{c.render ? c.render(r) : r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ open, onClose, title, children, width = 720, footer }: P) {
  const { T } = useUI();
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(12,16,22,.55)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 14, backdropFilter: "blur(2px)" }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: T.panel, borderRadius: 16, border: `1px solid ${T.lineStrong}`, width: "100%", maxWidth: width, maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(0,0,0,.35)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderBottom: `1px solid ${T.line}` }}>
          <div style={{ flex: 1, fontSize: 14.5, fontWeight: 700, color: T.text }}>{title}</div>
          <Btn variant="ghost" size="sm" onClick={onClose}>✕</Btn>
        </div>
        <div style={{ padding: 16, overflowY: "auto" }}>{children}</div>
        {footer && <div style={{ padding: "12px 16px", borderTop: `1px solid ${T.line}`, display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>{footer}</div>}
      </div>
    </div>
  );
}

export function Toast({ toasts }: P) {
  const { T } = useUI();
  return (
    <div style={{ position: "fixed", right: 14, bottom: 14, zIndex: 300, display: "flex", flexDirection: "column", gap: 8, maxWidth: 320 }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          background: t.tone === "ng" ? T.ngSoft : t.tone === "warn" ? T.warnSoft : T.okSoft,
          color: t.tone === "ng" ? T.ng : t.tone === "warn" ? T.warn : T.ok,
          border: `1px solid ${t.tone === "ng" ? T.ng : t.tone === "warn" ? T.warn : T.ok}`,
          borderRadius: 11, padding: "10px 13px", font: `600 12.5px ${FONT_UI}`, boxShadow: T.shadow,
        }}>{t.msg}</div>
      ))}
    </div>
  );
}

export function Empty({ icon = "🗂", title, hint, action }: P) {
  const { T } = useUI();
  return (
    <div style={{ textAlign: "center", padding: "34px 16px" }}>
      <div style={{ fontSize: 30, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 5 }}>{title}</div>
      {hint && <div style={{ fontSize: 12.5, color: T.textSub, marginBottom: 12, lineHeight: 1.6 }}>{hint}</div>}
      {action}
    </div>
  );
}

export function Section({ title, children, right, id }: P) {
  const { T } = useUI();
  return (
    <div id={id} style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <h2 style={{ margin: 0, font: `700 15px ${FONT_UI}`, color: T.text, letterSpacing: ".02em" }}>{title}</h2>
        <div style={{ flex: 1, height: 1, background: T.line }} />
        {right}
      </div>
      {children}
    </div>
  );
}

export const grid = (min: number, gap = 12): CSSProperties => ({
  display: "grid", gap, gridTemplateColumns: `repeat(auto-fill,minmax(${min}px,1fr))`,
});

export function Tabs({ tabs, value, onChange }: P) {
  const { T } = useUI();
  return (
    <div style={{ display: "flex", gap: 4, overflowX: "auto", borderBottom: `1px solid ${T.line}`, marginBottom: 16, paddingBottom: 1 }}>
      {tabs.map((tb) => (
        <button key={tb.k} onClick={() => onChange(tb.k)} style={{
          border: "none", background: "transparent", cursor: "pointer",
          padding: "9px 13px", font: `700 12.5px ${FONT_UI}`, whiteSpace: "nowrap",
          color: value === tb.k ? T.accent : T.textSub,
          borderBottom: `2px solid ${value === tb.k ? T.accent : "transparent"}`, marginBottom: -1,
        }}>
          {tb.label}{tb.badge != null && <span style={{ marginInlineStart: 6, fontSize: 10.5, color: T.shu, fontWeight: 700 }}>{tb.badge}</span>}
        </button>
      ))}
    </div>
  );
}

export function PseudoQR({ seed = 7, size = 112 }: P) {
  const { T } = useUI();
  const cells = 21;
  const rnd = mulberry32(seed);
  const grid2: ReactNode[] = [];
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    const finder =
      (x < 7 && y < 7) || (x > cells - 8 && y < 7) || (x < 7 && y > cells - 8);
    const on = finder
      ? (x % 6 === 0 || y % 6 === 0 || (x > 1 && x < 5 && y > 1 && y < 5) ||
         (x > cells - 6 && x < cells - 2 && y > 1 && y < 5) ||
         (x > 1 && x < 5 && y > cells - 6 && y < cells - 2))
      : rnd() > 0.55;
    if (on) grid2.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={T.text} />);
  }
  return (
    <svg viewBox={`0 0 ${cells} ${cells}`} width={size} height={size} style={{ background: "#fff", borderRadius: 6, padding: 4, border: `1px solid ${T.line}` }}>
      {grid2}
    </svg>
  );
}
