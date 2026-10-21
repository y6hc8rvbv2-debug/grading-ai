"use client";
// ============================================================================
// 生徒のタブレット・スマホから答案を出す画面（ver6）。先生が配ったリンク（QRコード）で開く。ログインは不要。
//   1. 自分の出席番号を選ぶ（生徒アカウントでログインしていれば、本人の番号だけ）
//   2. 答案をカメラで撮る（複数ページは順番に撮る）。撮り直し・順番の入れ替え・削除ができる
//   3. 「提出する」 → 先生の「採点中」の画面に AI採点待ちとして届く
// 写真はこの端末で縮小し（長辺2400px）、iPhone の HEIC は JPEG に変換してから送る。
// ============================================================================
import React, { use, useEffect, useRef, useState } from "react";
import { prepareImage } from "@/lib/image";

type Info = {
  test: string; subject: string; class: string; expires_at: string; pages_max: number; note: string; left: number;
  students: { id: string; number: number }[]; me: string | null;
};
type Shot = { id: string; file: File; url: string };

const C = { bg: "#f6f4ef", panel: "#ffffff", line: "#e3ded3", text: "#1d2430", sub: "#5b6472", accent: "#2f5bd3", shu: "#c8342b", ok: "#1f8a4c", warn: "#b5620e" };
const btn = (bg: string, fg = "#fff"): React.CSSProperties => ({
  background: bg, color: fg, border: "none", borderRadius: 14, padding: "14px 18px", fontSize: 17, fontWeight: 700, cursor: "pointer", width: "100%",
});

// Next.js 15 から params は Promise で届く
export default function SubmitPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [student, setStudent] = useState("");
  const [shots, setShots] = useState<Shot[]>([]);
  const [busy, setBusy] = useState<"" | "prep" | "send">("");
  const [done, setDone] = useState<{ pages: number } | null>(null);
  const [progress, setProgress] = useState(0);
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/submit/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setInfo(j); if (j.me) setStudent(j.me); })
      .catch((e) => setError(e instanceof Error ? e.message : "提出リンクを開けませんでした。"));
  }, [token]);
  useEffect(() => () => shots.forEach((s) => URL.revokeObjectURL(s.url)), [shots]);

  const add = async (list: FileList | null) => {
    if (!list?.length || !info) return;
    setBusy("prep"); setError("");
    const next: Shot[] = [];
    for (const f of Array.from(list)) {
      if (shots.length + next.length >= info.pages_max) { setError(`1人分の答案は${info.pages_max}枚までです。`); break; }
      const prepared = await prepareImage(f).catch(() => f);
      if (!/^image\/(jpeg|png|webp)$/.test(prepared.type)) { setError("この写真の形式は送れません。カメラで撮り直してください。"); continue; }
      next.push({ id: Math.random().toString(36).slice(2), file: prepared, url: URL.createObjectURL(prepared) });
    }
    setShots((p) => [...p, ...next]);
    setBusy("");
  };
  const move = (i: number, d: -1 | 1) => setShots((p) => { const a = [...p]; [a[i], a[i + d]] = [a[i + d], a[i]]; return a; });

  const send = async () => {
    if (!student) { setError("出席番号を選んでください。"); return; }
    if (!shots.length) { setError("答案の写真を撮ってください。"); return; }
    setBusy("send"); setError(""); setProgress(0);
    const body = new FormData();
    body.set("studentId", student);
    shots.forEach((s, i) => body.append("files", s.file, `${i + 1}.jpg`));
    // 送信の進み具合を出すため XMLHttpRequest を使う（fetch では送信量が分からない）
    const res = await new Promise<{ ok: boolean; json: { error?: string; pages?: number } }>((resolve) => {
      const x = new XMLHttpRequest();
      x.open("POST", `/api/submit/${encodeURIComponent(token)}`);
      x.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100)); };
      x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch { /* 空 */ } resolve({ ok: x.status >= 200 && x.status < 300, json: j }); };
      x.onerror = () => resolve({ ok: false, json: { error: "通信できませんでした。電波のよい場所で、もう一度送ってください。" } });
      x.send(body);
    });
    setBusy("");
    if (!res.ok) { setError(res.json.error || "提出できませんでした。もう一度お試しください。"); return; }
    setDone({ pages: res.json.pages ?? shots.length });
  };

  const wrap = (children: React.ReactNode) => (
    <main style={{ minHeight: "100vh", background: C.bg, color: C.text, font: "16px/1.6 -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Noto Sans JP', sans-serif", padding: "16px 16px 40px" }}>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: C.shu, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>朱</div>
          <b style={{ fontSize: 17 }}>答案の提出</b>
        </div>
        {children}
      </div>
    </main>
  );
  const card: React.CSSProperties = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16, marginBottom: 14 };

  if (done) return wrap(
    <section style={{ ...card, textAlign: "center" }} role="status">
      <div style={{ fontSize: 44 }}>✅</div>
      <h1 style={{ fontSize: 20, margin: "6px 0" }}>提出しました</h1>
      <p style={{ color: C.sub }}>{done.pages} ページを先生に送りました。この画面は閉じてかまいません。</p>
      <p style={{ color: C.sub, fontSize: 14 }}>出し直したいときは、先生が採点を始める前なら、もう一度このリンクから送れます。</p>
    </section>
  );
  if (!info) return wrap(
    <section style={card} role={error ? "alert" : "status"}>{error || "読み込んでいます…"}</section>
  );

  const mine = info.me ? info.students.filter((s) => s.id === info.me) : info.students;
  return wrap(<>
    <section style={card}>
      <div style={{ fontSize: 13, color: C.sub }}>{info.class}・{info.subject}</div>
      <h1 style={{ fontSize: 20, margin: "2px 0 6px" }}>{info.test}</h1>
      <div style={{ fontSize: 13, color: C.sub }}>締め切り：{new Date(info.expires_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
      {info.note && <p style={{ margin: "8px 0 0", fontSize: 14 }}>{info.note}</p>}
    </section>

    <section style={card}>
      <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>① 自分の出席番号をえらぶ</h2>
      {info.me && <p style={{ fontSize: 13, color: C.ok, margin: "0 0 8px" }}>ログインしているので、あなたの番号だけを表示しています。</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: 8 }}>
        {mine.map((s) => (
          <button key={s.id} type="button" onClick={() => setStudent(s.id)} aria-pressed={student === s.id}
            style={{ padding: "12px 0", borderRadius: 12, fontSize: 18, fontWeight: 700, cursor: "pointer",
              border: `2px solid ${student === s.id ? C.accent : C.line}`, background: student === s.id ? "#e7eeff" : "#fff", color: C.text }}>
            {s.number}
          </button>
        ))}
      </div>
    </section>

    <section style={card}>
      <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>② 答案を撮る（{shots.length} / {info.pages_max} 枚）</h2>
      <p style={{ fontSize: 13, color: C.sub, margin: "0 0 10px" }}>明るい場所で、答案の四すみが全部入るように、真上から撮ってください。2枚以上あるときは1ページ目から順番に撮ります。</p>
      <div style={{ display: "grid", gap: 8 }}>
        <button type="button" style={btn(C.accent)} disabled={!!busy || shots.length >= info.pages_max} onClick={() => camera.current?.click()}>
          📷 {shots.length ? "次のページを撮る" : "カメラで撮る"}
        </button>
        <button type="button" style={btn("#fff", C.accent)} disabled={!!busy || shots.length >= info.pages_max} onClick={() => picker.current?.click()}>
          🖼 撮った写真から選ぶ
        </button>
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      <input ref={picker} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      {busy === "prep" && <p role="status" style={{ color: C.sub }}>写真を準備しています…</p>}
      {shots.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, marginTop: 12 }}>
          {shots.map((s, i) => (
            <figure key={s.id} style={{ margin: 0, border: `1px solid ${C.line}`, borderRadius: 12, padding: 6, background: "#faf9f6" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.url} alt={`${i + 1}ページ目`} style={{ width: "100%", height: 150, objectFit: "contain", borderRadius: 8, background: "#eee" }} />
              <figcaption style={{ fontSize: 13, textAlign: "center", fontWeight: 700 }}>{i + 1}ページ目</figcaption>
              <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label="前へ">◀</button>
                <button type="button" onClick={() => setShots((p) => p.filter((x) => x.id !== s.id))} aria-label={`${i + 1}ページ目を消す`}>消す</button>
                <button type="button" disabled={i === shots.length - 1} onClick={() => move(i, 1)} aria-label="後へ">▶</button>
              </div>
            </figure>
          ))}
        </div>
      )}
    </section>

    {error && <div role="alert" style={{ ...card, borderColor: C.shu, color: C.shu, fontWeight: 700 }}>{error}</div>}
    <button type="button" style={{ ...btn(C.shu), opacity: !student || !shots.length || !!busy ? 0.55 : 1 }} disabled={!student || !shots.length || !!busy} onClick={send}>
      {busy === "send" ? `送信中… ${progress}%` : "③ 提出する"}
    </button>
    <p style={{ fontSize: 12, color: C.sub, marginTop: 14, lineHeight: 1.7 }}>
      答案の写真は学校専用の保管場所（非公開）に保存され、先生だけが見られます。名前は保存しません。
      出席番号をまちがえたときは、先生に伝えてください。
    </p>
  </>);
}
