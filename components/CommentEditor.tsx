"use client";
// 赤ペンコメントの入力（ver6 の便利機能）
//   - 定型文：よく使う一言をワンタップで入れる。自分の定型文を足せる（この端末に保存）
//   - 音声入力：🎤 を押して話すと文字になる（ブラウザの音声認識。対応しないブラウザではボタンを出さない）
import React, { useEffect, useRef, useState } from "react";
import { useUI } from "@/components/ui-context";
import { Btn, inputStyle } from "@/components/ui";

const KEY = "saiten.commentTemplates";
const DEFAULTS = ["よくできました！", "おしい！もう一歩", "途中式をていねいに書こう", "単位を忘れずに", "問題文をもう一度読もう", "計算ミスに注意", "考え方は合っています", "字をていねいに"];

type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };

function loadTemplates(): string[] {
  try { const v = JSON.parse(window.localStorage.getItem(KEY) || "null"); if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v; } catch { /* 既定 */ }
  return DEFAULTS;
}

export function CommentEditor({ initial, onSave, onCancel, id }: { initial: string; onSave: (text: string) => void; onCancel: () => void; id?: string }) {
  const { T, toast } = useUI();
  const [text, setText] = useState(initial);
  const [templates, setTemplates] = useState<string[]>(DEFAULTS);
  const [listening, setListening] = useState(false);
  const [speech, setSpeech] = useState(false);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => {
    setTemplates(loadTemplates());
    setSpeech(typeof window !== "undefined" && !!((window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition));
    return () => rec.current?.stop();
  }, []);

  const save = (list: string[]) => { setTemplates(list); try { window.localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* 保存できない環境 */ } };

  const listen = () => {
    if (listening) { rec.current?.stop(); return; }
    const W = window as unknown as Record<string, new () => Recognition>;
    const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "ja-JP"; r.interimResults = false; r.continuous = false;
    r.onresult = (e) => {
      const said = Array.from(e.results).map((x) => x[0]?.transcript ?? "").join("");
      if (said) setText((t) => (t ? `${t}${said}` : said).slice(0, 200));
    };
    r.onend = () => setListening(false);
    r.onerror = () => { setListening(false); toast("音声を聞き取れませんでした。マイクの許可を確かめて、もう一度お試しください", "warn"); };
    rec.current = r;
    setListening(true);
    r.start();
  };

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input id={id} value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder="赤ペンコメント" style={{ ...inputStyle(T), flex: 1 }}
          onKeyDown={(e) => { if (e.key === "Enter") onSave(text); if (e.key === "Escape") onCancel(); }} autoFocus />
        {speech && <Btn size="sm" variant={listening ? "shu" : "default"} onClick={listen} title="話してコメントを入れる">{listening ? "● 聞いています" : "🎤"}</Btn>}
        <Btn size="sm" variant="primary" onClick={() => onSave(text)}>保存</Btn>
        <Btn size="sm" variant="ghost" onClick={onCancel}>取消</Btn>
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        {templates.map((t) => (
          <button key={t} type="button" onClick={() => setText(t)} onContextMenu={(e) => { e.preventDefault(); save(templates.filter((x) => x !== t)); }}
            title="タップで入れる（右クリック・長押しで定型文から外す）"
            style={{ border: `1px solid ${T.line}`, background: T.panelAlt, color: T.shu, borderRadius: 999, padding: "2px 9px", fontSize: 11.5, cursor: "pointer" }}>{t}</button>
        ))}
        {text.trim() && !templates.includes(text.trim()) && (
          <button type="button" onClick={() => { save([...templates, text.trim()].slice(-30)); toast("定型文に追加しました"); }}
            style={{ border: `1px dashed ${T.accent}`, background: "transparent", color: T.accent, borderRadius: 999, padding: "2px 9px", fontSize: 11.5, cursor: "pointer" }}>＋ いまの文を定型文に</button>
        )}
      </div>
    </div>
  );
}
