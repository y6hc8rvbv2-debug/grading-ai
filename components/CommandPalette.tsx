"use client";
// すばやく移動（ver6 の便利機能）：Ctrl+K（Mac は ⌘+K）または「/」で開き、画面の名前・生徒（表示名・受験番号）・テスト名で探して移動する。
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useUI, type View } from "@/components/ui-context";
import { FONT_UI } from "@/lib/ui/theme";

type Hit = { key: string; icon: string; label: string; sub?: string; run: () => void };

export function CommandPalette({ nav }: { nav: { k: View; i: string; label: string }[] }) {
  const { T, go, subs, who, testById, studentById } = useUI();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) { e.preventDefault(); setOpen(true); setQ(""); setIdx(0); }
      else if (e.key === "Escape") setOpen(false);
    };
    // ヘッダーの 🔍 ボタンから開く
    const onOpen = () => { setOpen(true); setQ(""); setIdx(0); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("saiten:palette", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("saiten:palette", onOpen); };
  }, []);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 0); }, [open]);

  const hits = useMemo<Hit[]>(() => {
    const n = q.trim().normalize("NFKC").toLowerCase();
    const screens: Hit[] = nav.filter((x) => !n || x.label.toLowerCase().includes(n)).map((x) => ({ key: `v_${x.k}`, icon: x.i, label: x.label, sub: "画面", run: () => go(x.k) }));
    if (!n) return screens.slice(0, 12);
    const answers: Hit[] = [];
    for (const s of subs) {
      const t = testById(s.testId);
      const st = studentById(s.studentId);
      const text = `${who(s.studentId)} ${st?.examNo ?? ""} ${t?.name ?? ""} ${t?.subject ?? ""}`.normalize("NFKC").toLowerCase();
      if (text.includes(n)) answers.push({ key: `s_${s.id}`, icon: "📝", label: `${who(s.studentId)}　${t ? `${t.subject}／${t.name}` : ""}`, sub: s.status === "uploaded" ? "AI採点待ち" : `${s.result.total}点`, run: () => go("detail", s.id) });
      if (answers.length >= 20) break;
    }
    return [...screens, ...answers];
  }, [q, nav, subs, who, testById, studentById, go]);

  if (!open) return null;
  const choose = (h?: Hit) => { if (!h) return; setOpen(false); h.run(); };
  return (
    <div onMouseDown={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 900, display: "flex", justifyContent: "center", paddingTop: "12vh" }}>
      <div role="dialog" aria-label="すばやく移動" onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 560, maxWidth: "calc(100vw - 24px)", background: T.panel, borderRadius: 14, boxShadow: "0 20px 50px rgba(0,0,0,.3)", overflow: "hidden", alignSelf: "flex-start" }}>
        <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }} placeholder="画面・生徒（表示名・受験番号）・テスト名で探す"
          aria-label="探す"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(hits.length - 1, i + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
            if (e.key === "Enter") { e.preventDefault(); choose(hits[idx]); }
          }}
          style={{ width: "100%", boxSizing: "border-box", border: "none", borderBottom: `1px solid ${T.line}`, padding: "14px 16px", font: `15px ${FONT_UI}`, background: T.panel, color: T.text, outline: "none" }} />
        <div role="listbox" style={{ maxHeight: 380, overflowY: "auto", padding: 6 }}>
          {hits.map((h, i) => (
            <button key={h.key} role="option" aria-selected={i === idx} onMouseEnter={() => setIdx(i)} onClick={() => choose(h)}
              style={{ display: "flex", gap: 10, width: "100%", alignItems: "center", padding: "9px 10px", borderRadius: 9, border: "none", cursor: "pointer", textAlign: "start",
                background: i === idx ? T.accentSoft : "transparent", color: T.text, font: `13px ${FONT_UI}` }}>
              <span aria-hidden style={{ width: 20, textAlign: "center" }}>{h.icon}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.label}</span>
              {h.sub && <span style={{ fontSize: 11, color: T.textFaint }}>{h.sub}</span>}
            </button>
          ))}
          {!hits.length && <div style={{ padding: 16, textAlign: "center", fontSize: 12.5, color: T.textFaint }}>見つかりませんでした</div>}
        </div>
        <div style={{ borderTop: `1px solid ${T.line}`, padding: "7px 12px", fontSize: 11, color: T.textFaint }}>↑↓ で選ぶ・Enter で移動・Esc で閉じる（Ctrl+K / ⌘+K / 「/」でいつでも開けます）</div>
      </div>
    </div>
  );
}
