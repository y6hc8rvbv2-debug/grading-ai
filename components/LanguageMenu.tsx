"use client";
// ヘッダー右上の言語切替アイコン（ver6）。🌐 を押すと言語の一覧（検索つき）が開き、選ぶとすぐ切り替わる。
// 一覧は lib/i18n.ts の LANGS（117言語・RTL 対応）。選んだ言語は端末と教職員の設定（profiles.ui_lang）に残る。
import React, { useEffect, useRef, useState } from "react";
import { LANGS } from "@/lib/i18n";
import { useUI } from "@/components/ui-context";
import { FONT_UI } from "@/lib/ui/theme";

export function LanguageMenu() {
  const { T, lang, setLang, toast } = useUI();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const current = LANGS.find((l) => l.c === lang) ?? LANGS[0];

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const list = LANGS.filter((l) => !q || `${l.n} ${l.e} ${l.c}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div ref={box} style={{ position: "relative" }}>
      <button type="button" onClick={() => { setOpen(!open); setQ(""); }} aria-haspopup="listbox" aria-expanded={open}
        aria-label={`表示言語を切り替える（いまは ${current.n}）`} title={`Language / 言語：${current.n}`}
        style={{
          display: "flex", alignItems: "center", gap: 5, height: 34, padding: "0 10px", borderRadius: 9, cursor: "pointer",
          border: `1px solid ${open ? T.accent : T.lineStrong}`, background: open ? T.accentSoft : T.panel, color: T.text, font: `600 12px ${FONT_UI}`,
        }}>
        <span aria-hidden style={{ fontSize: 16 }}>🌐</span>
        <span>{current.c.toUpperCase()}</span>
      </button>
      {open && (
        <div role="dialog" aria-label="表示言語" style={{
          position: "absolute", top: 40, insetInlineEnd: 0, zIndex: 300, width: 280, maxWidth: "calc(100vw - 24px)",
          background: T.panel, border: `1px solid ${T.line}`, borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,.18)", padding: 8,
        }}>
          <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="言語を検索 / Search language"
            aria-label="言語を検索"
            style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8, border: `1px solid ${T.line}`, background: T.panelAlt, color: T.text, font: `13px ${FONT_UI}`, marginBottom: 6 }} />
          <div role="listbox" aria-label="言語の一覧" style={{ maxHeight: 320, overflowY: "auto", display: "grid", gap: 2 }}>
            {list.map((l) => (
              <button key={l.c} type="button" role="option" aria-selected={l.c === lang}
                onClick={() => { setLang(l.c); setOpen(false); toast(`${l.n} に切り替えました`); }}
                style={{
                  display: "flex", gap: 8, alignItems: "center", padding: "7px 9px", borderRadius: 8, cursor: "pointer", textAlign: "start",
                  border: "none", background: l.c === lang ? T.accentSoft : "transparent", color: T.text, font: `13px ${FONT_UI}`,
                }}>
                <span aria-hidden style={{ fontSize: 15 }}>{l.f}</span>
                <span style={{ fontWeight: 700, flex: 1 }}>{l.n}</span>
                <span style={{ fontSize: 11, color: T.textFaint }}>{l.e}</span>
              </button>
            ))}
            {!list.length && <div style={{ padding: 12, textAlign: "center", fontSize: 12, color: T.textFaint }}>該当する言語がありません</div>}
          </div>
        </div>
      )}
    </div>
  );
}
