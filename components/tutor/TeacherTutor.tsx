"use client";
// チャッピー先生（生徒の音声復習）の教職員側の画面部品。
//   - TutorAdminCard：設定画面。学校・クラスで有効にする、1回・1日の利用時間（管理者だけが変更）
//   - TestTutorFields：テストの設問の問題文（生徒の復習用）と、正答・解説を返却時に生徒へ見せるか
//   - TutorReviewCard：答案詳細。返却の版・生徒の復習の状態・利用時間。共有に同意した振り返り・文字起こし。理解確認済みにする
// AI の利用料は生徒本人（または保護者）が AI 提供元に払う。学校・管理者のキーは使わない。
import React, { useEffect, useState } from "react";
import { FONT_UI } from "@/lib/ui/theme";
import { useUI } from "@/components/ui-context";
import { Badge, Btn, Card } from "@/components/ui";
import {
  loadTestTutorFields, loadTutorReview, loadTutorSettings, saveTestTutorFields, saveTutorSettings, setVerified,
  type TutorReview, type TutorSettings,
} from "@/lib/db/tutor";
import type { Submission, Test } from "@/lib/types";

const STATE: Record<string, string> = {
  untouched: "未着手", reviewing: "復習中", self_understood: "理解できた（自己申告）", verified: "理解確認済み（先生）", ask_teacher: "先生に質問",
};

export function TutorAdminCard() {
  const { T, ds, isAdmin, ws, toast } = useUI();
  const [s, setS] = useState<TutorSettings | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (ds.mode !== "supabase") return;
    loadTutorSettings().then((v) => { if (v) setS(v); else setMissing(true); });
  }, [ds.mode]);
  if (ds.mode !== "supabase") return null;
  return (
    <Card title="チャッピー先生（生徒の音声復習）" sub="返却した答案の間違えた問題を、生徒が AI と復習します">
      <div style={{ fontSize: 12.5, color: T.textSub, lineHeight: 1.8, marginBottom: 10 }}>
        AI の利用料は、<b>生徒本人または保護者が OpenAI と直接契約して支払います</b>（生徒が自分の API キーを登録）。
        学校・管理者のキー（採点用の ANTHROPIC_API_KEY を含む）は使いません。アプリの画面・データベースの権限では、先生・管理者は生徒のキーを見られません（末尾4文字も生徒の画面だけ）。ただし、保存したキーは暗号文として Supabase に、復号の鍵はサーバーの環境変数にあるため、その両方を扱えるサーバーの運用者（Supabase と Vercel の管理権限を持つ人）は技術的には復号できます。運用者を最小限にし、生徒・保護者にもこのことを伝えてください。
        採点・保存・通信などの費用はこれまでどおりです。年齢・保護者の同意など、提供元の利用条件を確かめてから、使ってよいクラスだけ有効にしてください。
      </div>
      {missing && <div style={{ fontSize: 12.5, color: T.warn }}>まだ使えません。管理者が Supabase で 0012_voice_tutor.sql を実行してください。</div>}
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
      <summary style={{ font: `700 13px ${FONT_UI}`, color: T.text, cursor: "pointer" }}>チャッピー先生（生徒の復習）用の設定</summary>
      <div style={{ fontSize: 12, color: T.textSub, lineHeight: 1.7, margin: "6px 0" }}>
        ここで入力した問題文は、返却したときに生徒の画面に出て、生徒が同意すれば生徒本人の契約の AI に送られます。氏名などの個人情報は書かないでください。
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
        try { await saveTestTutorFields(test.id, v.releaseModelAnswer, v.prompts); toast("チャッピー先生用の設定を保存しました"); } catch (e) { toast((e as Error).message, "ng"); }
        setBusy(false);
      }}>保存</Btn>
    </details>
  );
}

export function TutorReviewCard({ sub }: { sub: Submission }) {
  const { T, ds, toast, session } = useUI();
  const [r, setR] = useState<TutorReview | null>(null);
  const [done, setDone] = useState(false);
  const reload = () => loadTutorReview(sub.id).then((v) => { setR(v); setDone(true); });
  useEffect(() => {
    if (ds.mode !== "supabase") return;
    loadTutorReview(sub.id).then((v) => { setR(v); setDone(true); });
  }, [ds.mode, sub.id]);
  if (ds.mode !== "supabase" || !done) return null;
  if (!r) return <Card title="生徒への返却と復習"><div style={{ fontSize: 12.5, color: T.textSub }}>まだ生徒に返却していません。確認後に「返却」すると、生徒の受信箱に届きます（チャッピー先生で復習できます）。</div></Card>;
  const by = new Map(r.progress.map((p) => [p.qno, p]));
  return (
    <Card title="生徒への返却と復習" sub={`返却 第${r.version}版・チャッピー先生 ${r.sessions.count} 回・${Math.round(r.sessions.seconds / 60)} 分`}>
      <div style={{ fontSize: 12, color: T.textSub, marginBottom: 8 }}>復習しても、点数・赤ペン・コメントは変わりません。「理解確認済み」は先生だけが付けられます（生徒は自己申告まで）。</div>
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
