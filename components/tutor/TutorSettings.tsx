"use client";
// チャッピー先生の設定（生徒の画面）：料金の支払者・送る内容と同意・本人の OpenAI API キーの登録と削除・学習データの削除。
//   - キーは password 欄で受け取り、送信後すぐに欄を空にする。ブラウザの保存領域（localStorage など）には置かない
//   - 「保存しない」を選ぶと、この画面を閉じるまでメモリにだけ置く
//   - 画面・応答・ログにキーを出さない（末尾4文字だけを目印に表示）
import React, { useState } from "react";
import type { EphemeralKey, TutorStatus } from "@/components/tutor/TutorPanel";

const box: React.CSSProperties = { border: "1px solid #c9ced6", borderRadius: 14, padding: 14, margin: "12px 0", background: "#fff" };
const btn: React.CSSProperties = { padding: "10px 14px", borderRadius: 10, border: "1px solid #9aa3ad", background: "#fff", fontSize: 15, minHeight: 44, cursor: "pointer" };
const primary: React.CSSProperties = { ...btn, background: "#1E3A5F", color: "#fff", border: "1px solid #1E3A5F" };

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? "うまくいきませんでした。時間をおいてお試しください。");
  return j;
}

export function TutorSettings({ status, reload, ephemeral, setEphemeral }: {
  status: TutorStatus | null; reload: () => Promise<void>; ephemeral: EphemeralKey; setEphemeral: (k: EphemeralKey) => void;
}) {
  const c = status?.consent;
  const [payer, setPayer] = useState<"self" | "guardian">((c?.payer as "self" | "guardian") ?? "self");
  const [terms, setTerms] = useState(false);
  const [sendAnswer, setSendAnswer] = useState(c?.send_answer ?? true);
  const [sendComment, setSendComment] = useState(c?.send_comment ?? true);
  const [saveTranscript, setSaveTranscript] = useState(c?.save_transcript ?? false);
  const [share, setShare] = useState(c?.share_with_teacher ?? false);
  const [key, setKey] = useState("");
  const [store, setStore] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState(status?.credential?.model ?? "");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void>) => { setBusy(true); setMsg(""); try { await f(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } };

  if (!status?.student) return null;
  return (
    <div data-testid="tutor-settings">
      {!status.enabled && <p style={{ ...box, background: "#fff7e6" }}>チャッピー先生は、あなたの学校またはクラスでまだ有効になっていません。使えるようになるまでは、先生の解説やコメントで復習してください。</p>}

      <section style={box}>
        <h3 style={{ marginTop: 0 }}>料金について（はじめに読んでください）</h3>
        <ul style={{ fontSize: 14, lineHeight: 1.8, paddingInlineStart: 20 }}>
          <li><b>アプリ内で話す</b>：AI の利用料は、<b>あなた本人、または保護者が OpenAI と直接契約して支払います</b>。学校・アプリの管理者は立て替えません。</li>
          <li>このアプリの生徒アカウントと、OpenAI の契約は別のものです。OpenAI の契約・支払い・年齢などの条件は、OpenAI の利用規約に従います。</li>
          <li>「管理者の負担なし」は、チャッピー先生の AI 利用料のことです。採点・保存・通信など、ほかの費用まで無料という意味ではありません。</li>
          <li><b>外部の ChatGPT で復習</b>：あなたの ChatGPT アカウントの条件・利用枠に従います（アプリの外の会話です）。</li>
        </ul>
      </section>

      <section style={box}>
        <h3 style={{ marginTop: 0 }}>送る内容と同意</h3>
        <p style={{ fontSize: 14, lineHeight: 1.8 }}>
          アプリ内で話すとき、選んだ1問について次の内容を OpenAI に送ります：問題番号・問題文（先生が入力した場合）・判定と点数・学年
          {"、"}そして下で選んだ項目。<b>氏名・学校名・出席番号・顔・答案の画像・ほかの生徒の情報は送りません。</b>
          音声の録音はこのアプリでは保存しません。各問題で「送る内容を見る」から、実際に送る文章を確かめられます。
        </p>
        <fieldset style={{ border: 0, padding: 0, fontSize: 14, lineHeight: 2 }}>
          <legend style={{ fontWeight: 700 }}>料金を支払う人</legend>
          <label><input type="radio" name="payer" checked={payer === "self"} onChange={() => setPayer("self")} /> 本人（私が OpenAI と契約している）</label><br />
          <label><input type="radio" name="payer" checked={payer === "guardian"} onChange={() => setPayer("guardian")} /> 保護者（保護者が OpenAI と契約している）</label>
        </fieldset>
        <div style={{ fontSize: 14, lineHeight: 2 }}>
          <label><input type="checkbox" checked={sendAnswer} onChange={(e) => setSendAnswer(e.target.checked)} /> 私の解答（読み取り結果）を送る</label><br />
          <label><input type="checkbox" checked={sendComment} onChange={(e) => setSendComment(e.target.checked)} /> 先生のコメントを送る</label><br />
          <label><input type="checkbox" checked={saveTranscript} onChange={(e) => setSaveTranscript(e.target.checked)} /> 会話の文字起こしをこのアプリに保存する（既定は保存しない）</label><br />
          <label><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> 保存した文字起こし・振り返りを先生と共有する</label><br />
          <label><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
            {payer === "self" ? " 私は OpenAI の利用条件（年齢など）を満たし、自分の契約で使います" : " 保護者が OpenAI の利用条件を確認し、保護者の契約で使うことに同意しています"}</label>
        </div>
        <p style={{ fontSize: 12.5, color: "#555" }}>保護者の契約でも、OpenAI の年齢などの条件を満たさない場合は使えません。分からないときは先生や保護者に相談してください。</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={primary} disabled={busy || !terms} onClick={() => run(async () => {
            await call("POST", "/api/tutor/consent", { payer, termsConfirmed: terms, sendAnswer, sendComment, saveTranscript, shareWithTeacher: share });
            await reload(); setMsg("同意を保存しました。");
          })}>{c ? "同意の内容を更新する" : "同意する"}</button>
          {c && <button style={btn} disabled={busy} onClick={() => run(async () => {
            if (!window.confirm("同意を撤回すると、アプリ内でチャッピー先生と話せなくなり、保存した会話の文字起こしも消えます。撤回しますか？")) return;
            // 進行中の会話があれば、サーバーが通話を切る（保存しないキーのときは、そのキーで切る）
            await call("DELETE", "/api/tutor/consent", ephemeral ? { apiKey: ephemeral.apiKey } : {}); await reload(); setMsg("同意を撤回しました。");
          })}>同意を撤回する</button>}
        </div>
        {c && <p style={{ fontSize: 13 }}>同意済み（支払う人：{c.payer === "self" ? "本人" : "保護者"}）</p>}
      </section>

      <section style={box}>
        <h3 style={{ marginTop: 0 }}>あなたの OpenAI API キー</h3>
        <ol style={{ fontSize: 13.5, lineHeight: 1.8, paddingInlineStart: 20 }}>
          <li>本人（または保護者）が OpenAI のサイトでアカウント・支払い方法を設定し、API キーを作ります（このアプリの外で行います）。</li>
          <li>使いすぎを防ぐため、OpenAI の管理画面で予算・通知を設定してください（予算の通知は、厳密な上限ではありません）。</li>
          <li>キーをこの欄に貼り付けます。キーは他の人に見せたり、チャットやメールで送ったりしないでください。</li>
        </ol>
        {status.credential ? (
          <p data-testid="key-registered" style={{ fontSize: 14 }}>保存済みのキー：…{status.credential.key_hint}（支払う人：{status.credential.payer === "self" ? "本人" : "保護者"}）</p>
        ) : ephemeral ? (
          <p style={{ fontSize: 14 }}>この画面を閉じるまで、入力したキーを使います（保存していません）。</p>
        ) : <p style={{ fontSize: 14 }}>キーは登録されていません。</p>}
        <form onSubmit={(e) => { e.preventDefault(); run(async () => {
          const k = key; setKey("");
          const r = await call("POST", "/api/tutor/key", { apiKey: k, payer, store });
          setModels(r.models);
          if (!store) setEphemeral({ apiKey: k, model: r.models[0] ?? "" });
          setModel(r.models[0] ?? "");
          if (store && r.models[0]) await call("PATCH", "/api/tutor/key", { model: r.models[0] });
          await reload();
          setMsg(`キー（…${r.hint}）を確かめました。${store ? "暗号化して保存しました。" : "保存はしていません。"}下でモデルを選んでください。`);
        }); }}>
          <input aria-label="OpenAI API キー" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)}
            placeholder="sk- で始まるキーを貼り付け" style={{ width: "100%", boxSizing: "border-box", padding: 10, fontSize: 15, borderRadius: 8, border: "1px solid #9aa3ad" }} />
          <div style={{ fontSize: 14, lineHeight: 2 }}>
            <label><input type="radio" name="store" checked={!store} onChange={() => setStore(false)} /> 保存しない（この画面を閉じるまで使う）</label><br />
            <label style={{ opacity: status.canStoreKeys ? 1 : 0.5 }}><input type="radio" name="store" disabled={!status.canStoreKeys} checked={store} onChange={() => setStore(true)} /> 暗号化して保存する（使うのはあなたの会話だけ。先生・管理者もアプリの画面では見られません）</label>
          </div>
          <div style={{ fontSize: 12.5, color: "#555", lineHeight: 1.7, marginBottom: 6 }}>
            ご注意：保存したキーは暗号化していますが、アプリのサーバーを管理する人（学校が契約するサーバーの運用者）は、技術的には元に戻せます。
            「保存しない」でも、会話のたびにキーはサーバーを通ります（記録はしません）。心配なときは、予算の上限を決めた専用のキーを作り、使い終わったら OpenAI の画面で無効にしてください。
          </div>
          <button style={primary} disabled={busy || !key || !c}>キーを確かめて登録</button>
          {!c && <span style={{ fontSize: 13, marginInlineStart: 8 }}>先に上で同意してください。</span>}
        </form>
        {(models.length > 0 || status.credential) && (
          <div style={{ marginTop: 8, fontSize: 14 }}>
            <label>使うモデル（音声の会話に対応し、あなたのキーで使えるもの）：{" "}
              <select value={model} onChange={(e) => run(async () => {
                setModel(e.target.value);
                if (ephemeral) setEphemeral({ ...ephemeral, model: e.target.value });
                else await call("PATCH", "/api/tutor/key", { model: e.target.value });
                await reload();
              })}>
                {[...new Set([...(models.length ? models : []), ...(status.credential?.model ? [status.credential.model] : [])])].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <p style={{ fontSize: 12.5, color: "#555" }}>料金はモデルによって違います。OpenAI の料金表で確かめてから選んでください。</p>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {status.credential && <button style={btn} disabled={busy} onClick={() => run(async () => {
            if (!window.confirm("保存したキーを削除します。OpenAI 側のキーは消えないので、不要なら OpenAI の管理画面でも無効にしてください。削除しますか？")) return;
            await call("DELETE", "/api/tutor/key"); await reload(); setMsg("保存したキーを削除しました。");
          })}>保存したキーを削除</button>}
          {ephemeral && <button style={btn} onClick={() => { setEphemeral(null); setMsg("入力したキーを、この画面から消しました。"); }}>入力したキーを使うのをやめる</button>}
        </div>
      </section>

      <section style={box}>
        <h3 style={{ marginTop: 0 }}>学習データ</h3>
        <p style={{ fontSize: 14, lineHeight: 1.8 }}>復習の状態（自己申告）・振り返り・保存した文字起こしを消します。API キーの削除とは別です。先生が「理解確認済み」にした記録と、利用時間の記録は残ります。</p>
        <button style={btn} disabled={busy} onClick={() => run(async () => {
          if (!window.confirm("復習の状態・振り返り・文字起こしを消します。よろしいですか？")) return;
          await call("DELETE", "/api/tutor/data"); setMsg("学習データを消しました。");
        })}>学習データを消す</button>
        <p style={{ fontSize: 13, color: "#555" }}>今日の利用時間：{Math.round((status.used_seconds_today ?? 0) / 60)}分／上限 {status.daily_minutes ?? "-"}分（1回 {status.session_minutes ?? "-"}分まで）</p>
      </section>
      {msg && <p role="alert" style={{ fontSize: 14, color: "#1E3A5F" }}>{msg}</p>}
    </div>
  );
}
