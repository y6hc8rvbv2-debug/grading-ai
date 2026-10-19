"use client";
// チャッピー先生：返却された答案の1問について、音声・文字で復習する（生徒の画面）。
//   A. アプリ内：本人の OpenAI 契約（API キー）で、音声または文字で話す。料金は本人（または保護者）が OpenAI に払う
//   B. 外部：本人の ChatGPT アカウントに貼り付けて、本人が音声モードを始める（アプリの外の会話。結果は自動では戻らない）
// 復習しても、テストの点数・赤ペン・先生のコメントは変わらない。
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { RealtimeTutor, STATE_LABEL, type Usage } from "@/lib/tutor/realtime-client";
import type { ReleasedItem } from "@/lib/tutor/prompt";

export type TutorStatus = {
  student?: boolean; enabled?: boolean; session_minutes?: number; daily_minutes?: number; used_seconds_today?: number;
  consent: null | { payer: string; send_answer: boolean; send_comment: boolean; save_transcript: boolean; share_with_teacher: boolean };
  credential: null | { payer: string; key_hint: string; model: string; status: string };
  canStoreKeys: boolean;
  /** アプリ内の会話（A方式）を使う設定か（サーバーの TUTOR_INAPP=on）。false なら画面に出さない */
  inapp?: boolean;
  /** 会話を確実に終わらせる準備（暗号鍵と見回り）がそろっているか */
  ready?: boolean;
  prices: Record<string, { text_in?: number; text_out?: number; audio_in?: number; audio_out?: number }> | null;
};
/** 保存しないキー（この画面を閉じるまでメモリにだけ置く） */
export type EphemeralKey = { apiKey: string; model: string } | null;

const STATES: Record<string, string> = {
  untouched: "未着手", reviewing: "復習中", self_understood: "理解できた（自己申告）", verified: "理解確認済み（先生が確認）", ask_teacher: "先生に質問",
};
/** サーバーが会話を終えた理由（通話もサーバーが切っている） */
const STOP_REASON: Record<string, string> = {
  time_limit: "1回の利用時間の上限になったので、会話を終えました。",
  disabled: "学校またはクラスでチャッピー先生が停止されたので、会話を終えました。",
  no_consent: "同意が撤回されたので、会話を終えました。",
  feature_off: "チャッピー先生が停止されたので、会話を終えました。",
  no_heartbeat: "通信が途切れたため、会話を終えました。もう一度始められます。",
  ended: "会話は終わっています。",
};
const MARK_TEXT: Record<string, string> = { "○": "正解", "△": "部分点", "×": "不正解", "-": "無記入" };
const btn: React.CSSProperties = { padding: "10px 14px", borderRadius: 10, border: "1px solid #9aa3ad", background: "#fff", fontSize: 15, minHeight: 44, cursor: "pointer" };
const primary: React.CSSProperties = { ...btn, background: "#1E3A5F", color: "#fff", border: "1px solid #1E3A5F" };
const danger: React.CSSProperties = { ...btn, background: "#B3261E", color: "#fff", border: "1px solid #B3261E" };

async function api(path: string, body?: unknown) {
  const res = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.error ?? "うまくいきませんでした。時間をおいてお試しください。"), { code: j.code });
  return j;
}

function estimate(u: Usage, model: string, prices: TutorStatus["prices"]) {
  const p = prices?.[model];
  if (!p) return null;
  const text_in = u.input_tokens - u.input_audio_tokens, text_out = u.output_tokens - u.output_audio_tokens;
  return ((p.text_in ?? 0) * text_in + (p.text_out ?? 0) * text_out + (p.audio_in ?? 0) * u.input_audio_tokens + (p.audio_out ?? 0) * u.output_audio_tokens) / 1_000_000;
}

export function TutorPanel({ releaseId, item, showModelAnswer, status, ephemeral, onOpenSettings }: {
  releaseId: string; item: ReleasedItem; showModelAnswer: boolean; status: TutorStatus | null;
  ephemeral: EphemeralKey; onOpenSettings: () => void;
}) {
  const [, force] = useState(0);
  const tutor = useRef<RealtimeTutor | null>(null);
  const session = useRef<{ id: string; started: number; max: number; model: string; mode: "voice" | "text"; lastBeat?: number } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<{ context: string; external: string } | null>(null);
  const [progress, setProgress] = useState<{ state: string; source: string } | null>(null);
  const [note, setNote] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const t = tutor.current;

  // 復習の状態
  useEffect(() => {
    createClient().from("tutor_progress").select("state, source").eq("release_id", releaseId).eq("qno", item.qno).maybeSingle()
      .then(({ data }) => setProgress(data ?? null));
  }, [releaseId, item.qno]);
  const saveProgress = async (state: string, source: "self" | "external_self" = "self") => {
    const db = createClient();
    const { data: student } = await db.rpc("current_student_id");
    const { data: school } = await db.rpc("current_student_school");
    const { error } = await db.from("tutor_progress").upsert({ school_id: school, student_id: student, release_id: releaseId, qno: item.qno, state, source, updated_at: new Date().toISOString() }, { onConflict: "release_id,qno" });
    if (error) setMessage("復習の状態を保存できませんでした。先生が「理解確認済み」にした問題は変えられません。");
    else setProgress({ state, source });
  };

  // 会話を終える：接続・マイクを止め、サーバーの記録を終える（画面を閉じたときは sendBeacon）
  const end = useCallback(async (reason: string, beacon = false) => {
    const s = session.current, tt = tutor.current;
    if (!s) { tt?.stop(); return; }
    session.current = null;
    tt?.stop();
    // 保存しないキーのときは、サーバーが通話を切るのに本人のキーが要るので、終了の要求にだけ添える（HTTPS・保存しない）
    const body = JSON.stringify({ sessionId: s.id, reason, seconds: Math.round((Date.now() - s.started) / 1000), usage: tt?.usage ?? {}, transcript: status?.consent?.save_transcript ? tt?.transcript() ?? "" : ""});
    if (beacon && navigator.sendBeacon) navigator.sendBeacon("/api/tutor/session/end", new Blob([body], { type: "text/plain" }));
    else await fetch("/api/tutor/session/end", { method: "POST", headers: { "content-type": "text/plain" }, body, keepalive: true }).catch(() => {});
    force((n) => n + 1);
  }, [status?.consent?.save_transcript]);

  // 画面を閉じた・別のアプリに切り替えた（バックグラウンド）ときは会話を止める
  useEffect(() => {
    const hide = () => { if (document.visibilityState === "hidden" && session.current) { end("background", true); setMessage("画面を離れたので会話を終えました。もう一度始められます。"); } };
    const leave = () => { if (session.current) end("closed", true); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    return () => { document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", leave); if (session.current) end("closed", true); };
  }, [end]);

  // 経過時間・上限・サーバーへの生存確認（20秒ごと）
  useEffect(() => {
    const id = setInterval(async () => {
      const s = session.current;
      if (!s) return;
      const sec = Math.round((Date.now() - s.started) / 1000);
      setElapsed(sec);
      if (sec >= s.max) { setMessage("1回の利用時間の上限になったので終えました。"); await end("time_limit"); return; }
      // 1秒ごとの処理は遅れて秒を飛ばすことがあるので、「前回から20秒以上たったか」で判定する
      if (sec - (s.lastBeat ?? 0) >= 20) {
        s.lastBeat = sec;
        const r = await api("/api/tutor/session/heartbeat", { sessionId: s.id, seconds: sec }).catch(() => ({ continue: true }));
        if (!r.continue) {
          setMessage(STOP_REASON[String(r.reason)] ?? "会話を終えました。");
          await end(String(r.reason ?? "ended"));
        }
      }
    }, 1000);
    return () => clearInterval(id);
  }, [end]);

  const start = async (mode: "voice" | "text") => {
    setMessage("");
    if (!status) { setMessage("チャッピー先生の状態を読み込んでいます。少し待ってから、もう一度押してください。"); return; }
    if (!status.enabled) { setMessage("チャッピー先生は、学校またはクラスで有効になっていません。先生に確認してください。"); return; }
    if (!status.consent) { setMessage("先に「チャッピー先生の設定」で、送る内容を確認して同意してください。"); onOpenSettings(); return; }
    if (status.ready === false) { setMessage("会話を確実に終わらせる仕組みの準備ができていないため、いまは会話を始められません。先生に伝えてください。外部の ChatGPT での復習は使えます。"); return; }
    if (!status.credential && !ephemeral) { setMessage("あなたの OpenAI API キーが登録されていません。「チャッピー先生の設定」で登録するか、下の「外部の ChatGPT で復習」を使ってください。"); return; }
    setBusy(true);
    let mic: MediaStream | null = null;
    try {
      if (mode === "voice") {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("この端末・ブラウザでは音声を使えません。文字で質問してください。"), { code: "no_mic" });
        try {
          mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        } catch {
          throw Object.assign(new Error("マイクを使えませんでした（許可されていないか、ほかのアプリが使っています）。文字で質問できます。"), { code: "no_mic" });
        }
      }
      const tt = new RealtimeTutor(() => force((n) => n + 1));
      tutor.current = tt;
      let captions = true;
      // 接続の申し込み（SDP）をサーバーへ送る。通話はサーバーが本人のキーで作る
      await tt.start({
        mode,
        exchange: async (sdp) => {
          const r = await api("/api/tutor/session", { releaseId, qno: item.qno, mode, slow, sdp, ...(ephemeral ? { apiKey: ephemeral.apiKey, model: ephemeral.model } : {}) });
          session.current = { id: r.sessionId, started: Date.now(), max: r.maxSeconds, model: r.model, mode };
          captions = !!r.captions;
          setElapsed(0);
          return r.answer;
        },
      }, mic);
      if (progress?.state !== "verified") saveProgress("reviewing");
      if (mode === "voice" && !captions) setMessage("このキーでは文字起こしのモデルが見つからないため、あなたの発言の字幕は出ません。");
    } catch (e) {
      mic?.getTracks().forEach((x) => x.stop());
      if (session.current) await end("error");
      const err = e as Error & { code?: string };
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };

  const say = (text: string) => {
    if (!text.trim() || !tutor.current?.send(text.trim())) { setMessage("会話が始まっていません。「文字で質問する」を押してから送ってください。"); return; }
    setInput("");
  };
  const loadPreview = async () => {
    try { setPreview(await api("/api/tutor/context", { releaseId, qno: item.qno })); } catch (e) { setMessage((e as Error).message); }
  };
  const copyExternal = async () => {
    try {
      const p = preview ?? await api("/api/tutor/context", { releaseId, qno: item.qno });
      setPreview(p);
      await navigator.clipboard.writeText(p.external);
      setMessage("復習内容をコピーしました。ChatGPT を開いて貼り付けてください。");
    } catch (e) { setMessage((e as Error).message || "コピーできませんでした。下の内容を選んでコピーしてください。"); }
  };
  const saveReflection = async (state: "self_understood" | "ask_teacher") => {
    const db = createClient();
    const { data: student } = await db.rpc("current_student_id");
    const { data: school } = await db.rpc("current_student_school");
    if (note.trim()) {
      const { error } = await db.from("tutor_reflections").insert({ school_id: school, student_id: student, release_id: releaseId, qno: item.qno, source: "external_chatgpt", note: note.trim().slice(0, 1000) });
      if (error) { setMessage("振り返りを保存できませんでした。"); return; }
    }
    await saveProgress(state, "external_self");
    setNote("");
    setMessage("振り返りを記録しました（あなたの自己申告として残ります）。");
  };

  const lastMe = [...(t?.lines ?? [])].reverse().find((l) => l.who === "me" && l.final);
  const est = t && session.current ? estimate(t.usage, session.current.model, status?.prices ?? null) : null;

  return (
    <section data-testid="tutor-panel" style={{ border: "1px solid #c9ced6", borderRadius: 14, padding: 14, marginTop: 10, background: "#fbfaf7" }}>
      <h3 style={{ margin: "0 0 6px" }}>{item.label}：チャッピー先生に聞く</h3>
      <div style={{ fontSize: 14, lineHeight: 1.8 }}>
        {item.prompt && <p style={{ margin: "4px 0" }}><b>問題文：</b>{item.prompt}</p>}
        <p style={{ margin: "4px 0" }}><b>あなたの解答：</b>{item.detected || "（無記入または読み取りなし）"}</p>
        <p style={{ margin: "4px 0" }}><b>判定：</b>{MARK_TEXT[item.mark] ?? item.mark}（{item.earned}／{item.points}点）</p>
        {item.comment && <p style={{ margin: "4px 0", color: "#B3261E" }}><b>先生のコメント：</b>{item.comment}</p>}
        {showModelAnswer && item.correct && <p style={{ margin: "4px 0" }}><b>正答：</b>{item.correct}</p>}
        {showModelAnswer && item.model && <p style={{ margin: "4px 0" }}><b>解説：</b>{item.model}</p>}
        <p style={{ margin: "4px 0", fontSize: 12.5, color: "#555" }}>図はここには出ません。上の答案の写真で確かめてください。チャッピー先生と復習しても、テストの点数・赤ペン・先生のコメントは変わりません。</p>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "8px 0" }} aria-label="復習の状態">
        <span style={{ fontSize: 13 }}>復習の状態：<b data-testid="progress-state">{STATES[progress?.state ?? "untouched"]}</b></span>
        {progress?.state !== "verified" && (["reviewing", "self_understood", "ask_teacher"] as const).map((s) => (
          <button key={s} style={{ ...btn, padding: "6px 10px", minHeight: 36, fontSize: 13 }} onClick={() => saveProgress(s)}>{STATES[s]}</button>
        ))}
      </div>

      <h4 style={{ margin: "12px 0 4px" }}>アプリ内で話す（あなたの OpenAI の契約を使います）</h4>
      <p style={{ fontSize: 12.5, color: "#555", margin: "0 0 6px" }}>
        料金は、あなた（または保護者）が OpenAI に直接支払います。学校やアプリの管理者は払いません。
        {status?.credential ? ` 登録したキー：…${status.credential.key_hint}・モデル：${status.credential.model || "未選択"}` : ephemeral ? " この画面を閉じるまで、入力したキーを使います（アカウントには保存していません。会話中だけ、通話を切るために暗号化してサーバーに一時保管します）。" : " キーが未登録です。"}
      </p>
      {!session.current && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button style={primary} disabled={busy} onClick={() => start("voice")}>🎤 音声で質問する</button>
          <button style={btn} disabled={busy} onClick={() => start("text")}>⌨ 文字で質問する</button>
          <label style={{ fontSize: 14 }}><input type="checkbox" checked={slow} onChange={(e) => setSlow(e.target.checked)} /> ゆっくり話す</label>
          <button style={{ ...btn, fontSize: 13 }} onClick={loadPreview}>送る内容を見る</button>
        </div>
      )}
      {busy && <p role="status">接続中…</p>}

      {t && (session.current || t.lines.length > 0) && (
        <div style={{ marginTop: 8 }}>
          <p role="status" aria-live="polite" data-testid="tutor-state" style={{ fontWeight: 700, margin: "4px 0" }}>
            状態：{STATE_LABEL[t.state]}{session.current ? `（${Math.floor(elapsed / 60)}分${elapsed % 60}秒／上限 ${Math.round((session.current.max) / 60)}分）` : ""}
          </p>
          {session.current && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", position: "sticky", top: 0, background: "#fbfaf7", padding: "6px 0", zIndex: 1 }}>
              {session.current.mode === "voice" && <button style={btn} onClick={() => t.setMic(!t.micOn)}>{t.micOn ? "マイクを止める" : "マイクを再開"}</button>}
              <button style={danger} onClick={() => end("user")}>会話を終える</button>
            </div>
          )}
          <div aria-label="字幕" style={{ maxHeight: 260, overflow: "auto", border: "1px solid #e1e4e8", borderRadius: 10, padding: 8, background: "#fff", fontSize: 15, lineHeight: 1.7 }}>
            {t.lines.length === 0 && <p style={{ color: "#777", margin: 0 }}>{session.current?.mode === "voice" ? "話しかけてください。チャッピー先生の言葉は字幕でも出ます。" : "下の欄に質問を書いて送ってください。"}</p>}
            {t.lines.map((l, i) => <p key={i} style={{ margin: "4px 0" }}><b>{l.who === "ai" ? "チャッピー先生" : "わたし"}：</b>{l.text}</p>)}
          </div>
          {lastMe && session.current?.mode === "voice" && (
            <button style={{ ...btn, fontSize: 13, marginTop: 6 }} onClick={() => setInput(`（さっきの私の発言の訂正）${lastMe.text}`)}>聞き取りを直して送る</button>
          )}
          {session.current && (
            <>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                <button style={btn} onClick={() => say("もう一度、別の言い方で、短く説明してください。")}>もう一度説明</button>
                <button style={btn} onClick={() => say("答えは言わずに、ヒントを1つだけください。")}>ヒント</button>
                <button style={btn} onClick={() => say("自分で解いてみます。解き終わったら答えを言うので、確かめてください。")}>自分で解く</button>
                <button style={btn} onClick={() => say("今日の復習を終わります。学んだ点と次の一歩を短くまとめてください。")}>復習を終了（まとめ）</button>
              </div>
              <form style={{ display: "flex", gap: 6, marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); say(input); }}>
                <input aria-label="質問を書く" value={input} onChange={(e) => setInput(e.target.value)} placeholder="質問を書く（例：どうして符号が変わるの？）" style={{ flex: 1, minWidth: 0, padding: 10, fontSize: 15, borderRadius: 8, border: "1px solid #9aa3ad" }} />
                <button style={primary}>送る</button>
              </form>
            </>
          )}
          <p style={{ fontSize: 12, color: "#555" }}>
            使用量（OpenAI の応答から）：入力 {t.usage.input_tokens}・出力 {t.usage.output_tokens} トークン。
            {est != null ? ` 概算 約 $${est.toFixed(3)}（目安）。` : " 単価が設定されていないため概算料金は出していません。"}
            請求額は OpenAI が決めます。OpenAI の管理画面（Usage・Billing）で確認してください。この画面の時間制限だけで、あなたの API の利用全体の支払いを止められるわけではありません。
          </p>
        </div>
      )}
      {message && <p role="alert" style={{ color: "#8a4b00", fontSize: 14 }}>{message}</p>}
      {preview && (
        <details open style={{ marginTop: 6 }}>
          <summary>外部の AI へ送る内容（この問題の分だけ・氏名や学校名は含みません）</summary>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12.5, background: "#fff", border: "1px solid #e1e4e8", borderRadius: 8, padding: 8 }}>{preview.context}</pre>
        </details>
      )}

      <h4 style={{ margin: "14px 0 4px" }}>外部の ChatGPT で復習（あなたの ChatGPT アカウント）</h4>
      <ol style={{ fontSize: 13.5, lineHeight: 1.8, margin: "0 0 6px", paddingInlineStart: 20 }}>
        <li>「復習内容をコピー」を押す（問題・あなたの解答・先生のコメントなど。氏名・学校名は入りません）</li>
        <li>「ChatGPT を開く」を押し、あなたのアカウントでログインして貼り付ける</li>
        <li>音声で話したいときは、ChatGPT の音声モードをあなたが開始する</li>
      </ol>
      <p style={{ fontSize: 12.5, color: "#555", margin: "0 0 6px" }}>
        これはアプリの外での会話です。ChatGPT の利用条件・利用枠・契約に従います。このアプリはログイン・貼り付け・音声の開始・会話の取得を代わりに行わず、
        会話の内容も自動では戻りません。終わったら、下に振り返りを書いて記録してください（自己申告として残ります）。
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={btn} onClick={copyExternal}>📋 復習内容をコピー</button>
        <a style={{ ...btn, textDecoration: "none", color: "#1E3A5F", display: "inline-flex", alignItems: "center" }} href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">ChatGPT を開く ↗</a>
      </div>
      {preview && !session.current && (
        <details style={{ marginTop: 6 }}>
          <summary>コピーする文章を見る（自分で選んでコピーすることもできます）</summary>
          <pre data-testid="external-prompt" style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#fff", border: "1px solid #e1e4e8", borderRadius: 8, padding: 8 }}>{preview.external}</pre>
        </details>
      )}
      <div style={{ marginTop: 8 }}>
        <textarea aria-label="振り返り" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2}
          placeholder="振り返り（例：移項するときは符号を変える）" style={{ width: "100%", boxSizing: "border-box", padding: 8, fontSize: 14, borderRadius: 8, border: "1px solid #9aa3ad" }} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button style={btn} onClick={() => saveReflection("self_understood")}>理解できた（自己申告）として記録</button>
          <button style={btn} onClick={() => saveReflection("ask_teacher")}>先生に質問したいとして記録</button>
        </div>
      </div>
    </section>
  );
}
