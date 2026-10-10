"use client";
// 生徒の復習（返却した答案の間違えた問題）の、教職員側の画面部品。
//   - ReviewCopyCard：設定画面。「本人の ChatGPT で復習」（B方式）を学校・クラスで有効にする（先生・管理者。既定は無効）
//   - TutorAdminCard：設定画面。アプリ内の会話（A方式。チャッピー先生）の設定。サーバーで TUTOR_INAPP=on のときだけ表示
//   - TestTutorFields：テストの設問の問題文（生徒の復習用）と、正答・解説を返却時に生徒へ見せるか
//   - TutorReviewCard：答案詳細。返却の版・生徒の復習の状態（自己申告／先生の確認）。理解確認済みにする
// いまの方針は B方式だけ。アプリは AI を呼ばず、学校・管理者のキーも生徒のキーも使わない。
import React, { useEffect, useState } from "react";
import { FONT_UI } from "@/lib/ui/theme";
import { useUI } from "@/components/ui-context";
import { Badge, Btn, Card } from "@/components/ui";
import {
  loadReviewCopySettings, loadTestTutorFields, loadTutorReview, loadTutorSettings, saveReviewCopySettings, saveTestTutorFields, saveTutorSettings, setVerified,
  type ReviewCopySettings, type TutorReview, type TutorSettings,
} from "@/lib/db/tutor";
import type { Submission, Test } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

type SweeperStatus = { last_run_at: string | null; failed: number; gave_up: number; pending: number } | null;

/** 見回り（ブラウザが来なくても通話を切る定期処理）の状態。止まっていると生徒は会話を始められない */
function SweeperLine({ T }: { T: ReturnType<typeof useUI>["T"] }) {
  const [st, setSt] = useState<SweeperStatus | "missing">(null);
  useEffect(() => {
    createClient().rpc("tutor_sweeper_status").then(({ data, error }) => setSt(error ? "missing" : (data as SweeperStatus)));
  }, []);
  if (st === "missing") return <div style={{ fontSize: 12.5, color: T.warn }}>会話を確実に終わらせる見回りが使えません。管理者が 0013_tutor_sweep.sql と定期処理を設定してください（docs/TUTOR-SWEEP.md）。</div>;
  if (!st) return null;
  const age = st.last_run_at ? Math.round((Date.now() - new Date(st.last_run_at).getTime()) / 1000) : null;
  const ok = age !== null && age < 180;
  return (
    <div data-testid="sweeper-status" style={{ fontSize: 12.5, color: ok && !st.gave_up ? T.textSub : T.warn, lineHeight: 1.7 }}>
      会話を終わらせる見回り：{age === null ? "まだ一度も動いていません（生徒は会話を始められません）" : ok ? `動いています（${age}秒前）` : `止まっています（最後は${Math.round(age / 60)}分前。生徒は会話を始められません）`}
      {st.pending + st.failed > 0 && `／通話を切る処理の待ち・再試行中 ${st.pending + st.failed} 件`}
      {st.gave_up > 0 && `／期限までに切れなかった通話 ${st.gave_up} 件（OpenAI 側で残っている可能性があります。生徒・保護者に確認してください）`}
    </div>
  );
}

const STATE: Record<string, string> = {
  untouched: "未記録", reviewing: "復習中（自己申告）", self_understood: "理解できた（自己申告）", verified: "理解確認済み（先生）", ask_teacher: "先生に質問したい（自己申告）",
};

/** アプリ内の会話（A方式）を使う設定か（サーバーの TUTOR_INAPP=on）。分からないあいだ・失敗したときは使わない扱い */
function useInAppMode() {
  const [inapp, setInapp] = useState(false);
  useEffect(() => {
    fetch("/api/tutor/mode", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setInapp(j?.inapp === true)).catch(() => setInapp(false));
  }, []);
  return inapp;
}

/** 「本人の ChatGPT で復習」（B方式）の設定。先生・管理者が学校とクラスで有効・無効にする（既定は無効） */
export function ReviewCopyCard() {
  const { T, ds, ws, toast, session } = useUI();
  const [s, setS] = useState<ReviewCopySettings | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  // ChatGPT の利用条件は13歳以上。有効にするクラスの生徒が13歳以上であることを、保存の前に先生が確かめる
  const [age13, setAge13] = useState(false);
  useEffect(() => {
    if (ds.mode !== "supabase") return;
    loadReviewCopySettings().then((v) => { if (v) setS(v); else setMissing(true); });
  }, [ds.mode]);
  if (ds.mode !== "supabase") return null;
  const role = session?.profile?.role;
  const canEdit = role === "admin" || role === "teacher";
  return (
    <Card title="生徒の復習：本人の ChatGPT で復習" sub="返却した答案の間違えた問題を、生徒が自分の ChatGPT に貼り付けて復習します">
      <div style={{ fontSize: 12.5, color: T.textSub, lineHeight: 1.8, marginBottom: 10 }}>
        生徒は、本人に返却された答案から間違えた問題を選び、送る内容（問題文・本人の解答・判定・先生のコメントと、ヒントから順に教える家庭教師への指示）を確かめてからコピーし、
        自分の ChatGPT にログインして貼り付けます。正答と解説は、テストの設定で「返却時に生徒に見せる」にしたときだけ入ります。氏名・学校名・出席番号・答案画像は入りません。
        <b>このアプリは AI を呼ばず、会話の内容や理解度も受け取りません</b>（復習の状態は生徒の自己申告。「理解確認済み」は先生が付けます）。
        ChatGPT の利用条件（年齢・保護者の同意など）を確かめてから、使ってよいクラスだけ有効にしてください。
      </div>
      {missing && <div style={{ fontSize: 12.5, color: T.warn }}>まだ使えません。管理者が Supabase で 0015_review_copy.sql を実行してください。</div>}
      {s && (
        <div style={{ display: "grid", gap: 10, fontSize: 13 }} data-testid="review-copy-settings">
          <label><input type="checkbox" disabled={!canEdit} checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> 学校で有効にする</label>
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>使えるクラス</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {ws.classes.map((c) => (
                <label key={c.id}><input type="checkbox" disabled={!canEdit} checked={s.classIds.includes(c.id)}
                  onChange={(e) => setS({ ...s, classIds: e.target.checked ? [...s.classIds, c.id] : s.classIds.filter((x) => x !== c.id) })} /> {c.label}</label>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 12, color: T.textFaint }}>学校とクラスの両方で有効なときだけ、生徒の画面に「ChatGPT で復習」が出ます。アプリ内の AI との会話の設定とは別です。</div>
          {canEdit && s.enabled && s.classIds.length > 0 && (
            <label style={{ color: T.text }}>
              <input type="checkbox" checked={age13} onChange={(e) => setAge13(e.target.checked)} /> 使えるクラスの生徒は、全員13歳以上です（ChatGPT の利用条件。小学生のクラスは有効にしないでください）
            </label>
          )}
          {canEdit ? (
            <div><Btn variant="primary" disabled={busy || (s.enabled && s.classIds.length > 0 && !age13)} onClick={async () => {
              setBusy(true);
              try { await saveReviewCopySettings(s); toast("ChatGPT での復習の設定を保存しました"); } catch (e) { toast((e as Error).message, "ng"); }
              setBusy(false);
            }}>設定を保存</Btn></div>
          ) : <div style={{ fontSize: 12, color: T.textSub }}>変更できるのは、この学校の先生・管理者です。</div>}
        </div>
      )}
    </Card>
  );
}

export function TutorAdminCard() {
  const { T, ds, isAdmin, ws, toast } = useUI();
  const inapp = useInAppMode();
  const [s, setS] = useState<TutorSettings | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (ds.mode !== "supabase" || !inapp) return;
    loadTutorSettings().then((v) => { if (v) setS(v); else setMissing(true); });
  }, [ds.mode, inapp]);
  // アプリ内の会話（A方式）を使わない設定では、キー・モデル・料金・時間の設定を出さない
  if (ds.mode !== "supabase" || !inapp) return null;
  return (
    <Card title="チャッピー先生（生徒の音声復習）" sub="返却した答案の間違えた問題を、生徒が AI と復習します">
      <div style={{ fontSize: 12.5, color: T.textSub, lineHeight: 1.8, marginBottom: 10 }}>
        AI の利用料は、<b>生徒本人または保護者が OpenAI と直接契約して支払います</b>（生徒が自分の API キーを登録）。
        学校・管理者のキー（採点用の ANTHROPIC_API_KEY を含む）は使いません。アプリの画面・データベースの権限では、先生・管理者は生徒のキーを見られません（末尾4文字も生徒の画面だけ）。ただし、保存したキーは暗号文として Supabase に、復号の鍵はサーバーの環境変数にあるため、その両方を扱えるサーバーの運用者（Supabase と Vercel の管理権限を持つ人）は技術的には復号できます。運用者を最小限にし、生徒・保護者にもこのことを伝えてください。
        採点・保存・通信などの費用はこれまでどおりです。年齢・保護者の同意など、提供元の利用条件を確かめてから、使ってよいクラスだけ有効にしてください。
      </div>
      {missing && <div style={{ fontSize: 12.5, color: T.warn }}>まだ使えません。管理者が Supabase で 0012_voice_tutor.sql を実行してください。</div>}
      {s && <SweeperLine T={T} />}
      {s && (
        <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
          <label><input type="checkbox" disabled={!isAdmin} checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> 学校で有効にする</label>
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>使えるクラス</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {ws.classes.map((c) => (
                <label key={c.id}><input type="checkbox" disabled={!isAdmin} checked={s.classIds.includes(c.id)}
                  onChange={(e) => setS({ ...s, classIds: e.target.checked ? [...s.classIds, c.id] : s.classIds.filter((x) => x !== c.id) })} /> {c.label}</label>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <label>1回の上限 <input type="number" min={1} max={60} disabled={!isAdmin} value={s.sessionMinutes} onChange={(e) => setS({ ...s, sessionMinutes: Number(e.target.value) })} style={{ width: 60 }} /> 分</label>
            <label>1日の上限 <input type="number" min={1} max={240} disabled={!isAdmin} value={s.dailyMinutes} onChange={(e) => setS({ ...s, dailyMinutes: Number(e.target.value) })} style={{ width: 60 }} /> 分</label>
          </div>
          <div style={{ fontSize: 12, color: T.textFaint }}>同時に話せるのは1人1つ、開始は1時間に6回まで。アプリの時間制限は、生徒の API の利用全体の支払いを止めるものではありません。</div>
          {isAdmin ? (
            <div><Btn variant="primary" disabled={busy} onClick={async () => {
              setBusy(true);
              try { await saveTutorSettings(s); toast("チャッピー先生の設定を保存しました"); } catch (e) { toast((e as Error).message, "ng"); }
              setBusy(false);
            }}>設定を保存</Btn></div>
          ) : <div style={{ fontSize: 12, color: T.textSub }}>変更できるのは学校の管理者だけです。</div>}
        </div>
      )}
    </Card>
  );
}

export function TestTutorFields({ test }: { test: Test }) {
  const { T, ds, toast } = useUI();
  const [v, setV] = useState<{ releaseModelAnswer: boolean; prompts: Record<number, string> } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (ds.mode !== "supabase") return;
    loadTestTutorFields(test.id).then(setV);
  }, [ds.mode, test.id]);
  if (ds.mode !== "supabase" || !v) return null;
  return (
    <details style={{ marginTop: 12, border: `1px solid ${T.line}`, borderRadius: 10, padding: 10 }}>
      <summary style={{ font: `700 13px ${FONT_UI}`, color: T.text, cursor: "pointer" }}>生徒の復習（ChatGPT で復習）用の設定</summary>
      <div style={{ fontSize: 12, color: T.textSub, lineHeight: 1.7, margin: "6px 0" }}>
        ここで入力した問題文は、返却したときに生徒の画面に出て、生徒が確かめてコピーすれば、生徒本人の ChatGPT に貼り付けられます。氏名などの個人情報は書かないでください。
        変更は、次に返却（返し直し）したときから生徒に反映されます。
      </div>
      <label style={{ fontSize: 13 }}><input type="checkbox" checked={v.releaseModelAnswer} onChange={(e) => setV({ ...v, releaseModelAnswer: e.target.checked })} /> 返却時に、正答・解説（模範解答）を生徒に見せる</label>
      <div style={{ display: "grid", gap: 6, marginTop: 8, maxHeight: 300, overflow: "auto" }}>
        {test.questions.map((q) => (
          <label key={q.no} style={{ fontSize: 12.5 }}>
            {q.label} の問題文
            <textarea rows={2} maxLength={2000} value={v.prompts[q.no] ?? ""} onChange={(e) => setV({ ...v, prompts: { ...v.prompts, [q.no]: e.target.value } })}
              style={{ width: "100%", boxSizing: "border-box", fontSize: 13 }} />
          </label>
        ))}
      </div>
      <Btn size="sm" variant="primary" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await saveTestTutorFields(test.id, v.releaseModelAnswer, v.prompts); toast("生徒の復習用の設定を保存しました"); } catch (e) { toast((e as Error).message, "ng"); }
        setBusy(false);
      }}>保存</Btn>
    </details>
  );
}

export function TutorReviewCard({ sub }: { sub: Submission }) {
  const { T, ds, toast, session } = useUI();
  const inapp = useInAppMode();
  const [r, setR] = useState<TutorReview | null>(null);
  const [done, setDone] = useState(false);
  const reload = () => loadTutorReview(sub.id).then((v) => { setR(v); setDone(true); });
  useEffect(() => {
    if (ds.mode !== "supabase") return;
    loadTutorReview(sub.id).then((v) => { setR(v); setDone(true); });
  }, [ds.mode, sub.id]);
  if (ds.mode !== "supabase" || !done) return null;
  if (!r) return <Card title="生徒への返却と復習"><div style={{ fontSize: 12.5, color: T.textSub }}>まだ生徒に返却していません。確認後に「返却」すると、生徒の受信箱に届きます（「ChatGPT で復習」を有効にしていれば、生徒が間違えた問題を復習できます）。</div></Card>;
  const by = new Map(r.progress.map((p) => [p.qno, p]));
  return (
    <Card title="生徒への返却と復習" sub={inapp || r.sessions.count > 0 ? `返却 第${r.version}版・アプリ内の会話 ${r.sessions.count} 回・${Math.round(r.sessions.seconds / 60)} 分` : `返却 第${r.version}版`}>
      <div style={{ fontSize: 12, color: T.textSub, marginBottom: 8 }}>復習の状態は生徒の自己申告です（ChatGPT での会話の内容や理解度は、アプリには届きません）。復習しても、点数・赤ペン・コメントは変わりません。「理解確認済み」は先生だけが付けられます。</div>
      <div style={{ display: "grid", gap: 6 }}>
        {sub.result.items.filter((i) => i.mark !== "○").map((i) => {
          const p = by.get(i.qno);
          return (
            <div key={i.qno} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
              <b style={{ minWidth: 90 }}>{i.label}</b>
              <Badge tone={p?.state === "verified" ? "ok" : p?.state === "ask_teacher" ? "warn" : "mute"}>{STATE[p?.state ?? "untouched"]}</Badge>
              <Btn size="sm" onClick={async () => {
                try {
                  await setVerified(r, { schoolId: session?.school?.id ?? "", studentId: sub.studentId }, i.qno, p?.state !== "verified");
                  await reload();
                } catch (e) { toast((e as Error).message, "ng"); }
              }}>{p?.state === "verified" ? "確認済みを取り消す" : "理解確認済みにする"}</Btn>
            </div>
          );
        })}
      </div>
      {r.reflections.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5 }}>生徒の振り返り（共有に同意したもの）</div>
          {r.reflections.map((x, k) => <div key={k} style={{ fontSize: 12.5 }}>問{x.qno}：{x.note}{x.source === "external_chatgpt" ? "（外部の ChatGPT での復習・自己申告）" : ""}</div>)}
        </div>
      )}
      {r.transcripts.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 12.5 }}>会話の文字起こし（生徒が保存と共有に同意したもの）</summary>
          {r.transcripts.map((x, k) => <pre key={k} style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{x.body}</pre>)}
        </details>
      )}
    </Card>
  );
}
