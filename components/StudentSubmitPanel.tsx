"use client";
// ============================================================================
// 生徒のタブレット・スマホから答案を集める（ver6・先生の画面）
//
//   1. テスト・クラス・受付時間を選んで「提出リンクを作る」
//   2. QRコードを黒板・プロジェクターに映す（または URL を配信する）。生徒は自分の端末で撮って提出する
//   3. 届いた答案が出席番号の一覧に ✓ で増えていく。「届いた答案を自動でAI採点する」なら、届いたそばから採点する
// 届いた答案は「採点中」の画面に AI採点待ちとして並ぶ（この画面を閉じても残る）。
// ============================================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { useUI } from "@/components/ui-context";
import { Badge, Btn, Field, Modal, Select, grid } from "@/components/ui";
import { friendlyError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/util";
import { runPool } from "@/lib/workflow/pool";
import type { LinkUpload, SubmitLink } from "@/lib/types";

export function StudentSubmitPanel({ open, onClose, testId: initialTest, classId: initialClass }: {
  open: boolean; onClose: () => void; testId?: string; classId?: string;
}) {
  const { T, ws, ds, toast, ai, aiGradeSub, refresh, who, testById, classById, subs } = useUI();
  const demo = ds.mode === "demo";
  const tests = useMemo(() => ws.tests.filter((t) => !t.archivedAt), [ws.tests]);
  const [testId, setTestId] = useState(initialTest || "");
  const [classId, setClassId] = useState(initialClass || ws.classes[0]?.id || "");
  const [hours, setHours] = useState(2);
  const [note, setNote] = useState("");
  const [link, setLink] = useState<SubmitLink | null>(null);
  const [uploads, setUploads] = useState<LinkUpload[]>([]);
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);
  const [big, setBig] = useState(false);
  const [autoGrade, setAutoGrade] = useState(true);
  const graded = useRef(new Set<string>());
  const [gradedCount, setGradedCount] = useState(0);

  useEffect(() => { if (open) { setTestId((v) => v || initialTest || ""); setClassId((v) => v || initialClass || ws.classes[0]?.id || ""); } }, [open, initialTest, initialClass, ws.classes]);

  const url = link && typeof window !== "undefined" ? `${window.location.origin}/submit/${link.token}` : "";
  useEffect(() => {
    if (!url) { setQr(""); return; }
    QRCode.toDataURL(url, { width: 560, margin: 1, errorCorrectionLevel: "M" }).then(setQr).catch(() => setQr(""));
  }, [url]);

  const test = testById(testId);
  const missing = test?.questions.filter((q) => (q.type === "graph" ? !q.model.trim() : !q.correct.trim())).length ?? 0;
  const roster = useMemo(() => ws.students.filter((s) => s.classId === (link?.classId ?? classId)).sort((a, b) => a.number - b.number), [ws.students, link, classId]);
  const latest = useMemo(() => {
    const m = new Map<string, LinkUpload>();
    uploads.forEach((u) => { if (!m.has(u.studentId)) m.set(u.studentId, u); });
    return m;
  }, [uploads]);

  const create = async () => {
    if (!testId || !classId) { toast("テストとクラスを選んでください", "warn"); return; }
    setBusy(true);
    try {
      const l = await ds.createSubmitLink({ testId, classId, hours, maxUploads: Math.max(60, roster.length * 3), note });
      setLink(l); setUploads([]); graded.current = new Set(); setGradedCount(0);
      toast("提出リンクを作りました。QRコードを生徒に見せてください");
    } catch (e) {
      toast(friendlyError(e, "提出リンクの作成"), "ng");
    } finally {
      setBusy(false);
    }
  };

  const poll = useCallback(async () => {
    if (!link) return;
    try {
      const r = await ds.submitLinkStatus(link.id);
      setLink(r.link); setUploads(r.uploads);
    } catch { /* 次の確認で取り直す */ }
  }, [ds, link]);
  useEffect(() => {
    if (!open || !link) return;
    poll();
    const t = setInterval(poll, 4000);
    return () => clearInterval(t);
    // link.id が変わったときだけ張り直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, link?.id]);

  // 届いた答案を、届いたそばから AI採点する（この画面を開いている間）
  useEffect(() => {
    if (!autoGrade || demo || !ai.enabled || missing || !link) return;
    const fresh = [...latest.values()].filter((u) => u.status === "done" && u.submissionId && !graded.current.has(u.id));
    if (!fresh.length) return;
    fresh.forEach((u) => graded.current.add(u.id));
    (async () => {
      await refresh();
      await runPool(fresh, Math.max(1, ai.concurrency ?? 8), async (u) => {
        const r = await aiGradeSub(u.submissionId, { silent: true });
        if (r.ok) setGradedCount((n) => n + 1);
      });
    })();
  }, [latest, autoGrade, demo, ai.enabled, ai.concurrency, missing, link, aiGradeSub, refresh]);

  const revoke = async () => {
    if (!link) return;
    try { await ds.revokeSubmitLink(link.id); await poll(); toast("受付を締め切りました。届いた答案は「採点中」の画面にあります"); }
    catch (e) { toast(friendlyError(e, "受付の締め切り"), "ng"); }
  };
  const closed = !!link && (!!link.revokedAt || Date.parse(link.expiresAt) <= Date.now());
  const submitted = roster.filter((s) => latest.get(s.id)?.status === "done").length;
  // 先生がすでに取り込んだ答案（リンク以外の方法）。生徒が出し直しても上書きされない
  const scanned = (studentId: string) => !!link && subs.some((x) => x.testId === link.testId && x.studentId === studentId && x.source !== "mobile");
  const scannedCount = roster.filter((s) => !latest.get(s.id) && scanned(s.id)).length;

  return (
    <Modal open={open} onClose={onClose} title="生徒のタブレット・スマホから答案を集める" width={big ? 1100 : 860}
      footer={<Btn onClick={onClose}>閉じる（届いた答案は「採点中」に残ります）</Btn>}>
      {!link ? (
        <div style={{ display: "grid", gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: T.textSub, lineHeight: 1.8 }}>
            QRコードを黒板やプロジェクターに映すと、生徒が自分のタブレット・スマホで答案を撮って提出できます。
            先生が答案を集めて撮る手間がなくなり、届いた答案はそのまま AI採点できます。
          </p>
          <div style={grid(220, 12)}>
            <Field label="テスト">
              <Select value={testId} onChange={setTestId} options={[{ value: "", label: "テストを選ぶ" }, ...tests.map((t) => ({ value: t.id, label: `${t.subject}／${t.name}` }))]} />
            </Field>
            <Field label="クラス">
              <Select value={classId} onChange={setClassId} options={ws.classes.map((c) => ({ value: c.id, label: `${c.label}（${c.size}名）` }))} />
            </Field>
            <Field label="受付時間">
              <Select value={String(hours)} onChange={(v: string) => setHours(Number(v))} options={[
                { value: "1", label: "1時間" }, { value: "2", label: "2時間（授業1コマ）" }, { value: "12", label: "今日中（12時間）" }, { value: "72", label: "3日間（宿題）" },
              ]} />
            </Field>
          </div>
          <Field label="生徒へのひとこと（任意・100字まで）">
            <input value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} placeholder="例：2ページとも撮ってから提出してください"
              style={{ width: "100%", padding: "9px 10px", borderRadius: 9, border: `1px solid ${T.line}`, background: T.panel, color: T.text, font: "inherit", boxSizing: "border-box" }} />
          </Field>
          {missing > 0 && <div style={{ fontSize: 12, color: T.warn }}>このテストには正答が未入力の設問が {missing} 問あります。提出は受け付けられますが、AI採点は正答を入れてから行います。</div>}
          <div><Btn variant="primary" disabled={busy || !testId || !classId} onClick={create}>{busy ? "作成しています…" : "提出リンクを作る"}</Btn></div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: big ? "1fr" : "minmax(260px, 340px) 1fr" }}>
          <div style={{ textAlign: "center" }}>
            {qr && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="提出用のQRコード" style={{ width: big ? "min(80vh, 100%)" : "100%", maxWidth: big ? 620 : 320, imageRendering: "pixelated", background: "#fff", borderRadius: 12, border: `1px solid ${T.line}` }} />
            )}
            {!qr && <div style={{ padding: 40, color: T.textFaint }}>QRコードを作っています…</div>}
            <div style={{ fontSize: big ? 22 : 13, fontWeight: 700, marginTop: 6 }}>{test?.name}・{classById(link.classId)?.label}</div>
            <div style={{ fontSize: 11.5, color: T.textSub, wordBreak: "break-all", marginTop: 4 }}>{url}</div>
            <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", marginTop: 8 }}>
              <Btn size="sm" onClick={() => { navigator.clipboard?.writeText(url).then(() => toast("URL をコピーしました"), () => toast("コピーできませんでした。URL を選んでコピーしてください", "warn")); }}>URL をコピー</Btn>
              <Btn size="sm" variant="soft" onClick={() => setBig(!big)}>{big ? "元の大きさ" : "大きく映す"}</Btn>
              {!closed && <Btn size="sm" variant="danger" onClick={revoke}>受付を締め切る</Btn>}
            </div>
            <div style={{ fontSize: 11.5, color: closed ? T.ng : T.textSub, marginTop: 6 }}>
              {closed ? "受付は終了しました" : `受付：${fmtDateTime(link.expiresAt)} まで`}
            </div>
          </div>
          {!big && (
            <div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                <b style={{ fontSize: 15 }}>提出 {submitted} / {roster.length} 人</b>
                {scannedCount > 0 && <Badge tone="mute">先生が取り込み済み {scannedCount} 人</Badge>}
                {ai.enabled && !demo && <Badge tone="info">AI採点済み {gradedCount} 人</Badge>}
                {demo && <Badge tone="mute">デモ：数秒ごとに1人ずつ提出したことにします</Badge>}
              </div>
              {ai.enabled && !demo && (
                <label style={{ display: "flex", gap: 7, alignItems: "flex-start", fontSize: 12.5, marginBottom: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={autoGrade} onChange={(e) => setAutoGrade(e.target.checked)} style={{ marginTop: 3 }} />
                  <span>届いた答案を、届いたそばから自動でAI採点する（この画面を開いている間）{missing ? "：正答が未入力のため止めています" : ""}</span>
                </label>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(78px, 1fr))", gap: 6 }}>
                {roster.map((s) => {
                  const u = latest.get(s.id);
                  const already = !u && scanned(s.id);
                  const tone = u?.status === "done" ? T.ok : u?.status === "failed" ? T.ng : u ? T.info : T.line;
                  return (
                    <div key={s.id} title={u ? `${fmtDateTime(u.createdAt)}・${u.pages}ページ${u.verified ? "・本人確認済み" : "・出席番号の自己申告"}` : "未提出"}
                      style={{ border: `2px solid ${tone}`, borderRadius: 10, padding: "6px 4px", textAlign: "center", background: u?.status === "done" ? T.okSoft : T.panel }}>
                      <div style={{ fontWeight: 700 }}>{s.number}</div>
                      <div style={{ fontSize: 10.5, color: T.textSub }}>{u?.status === "done" ? `✓ ${u.pages}枚` : u?.status === "failed" ? "失敗" : u ? "受信中" : already ? "先生が取込済" : "未提出"}</div>
                    </div>
                  );
                })}
              </div>
              {uploads.length > 0 && (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: "pointer", fontSize: 12.5 }}>届いた順の記録（{uploads.length} 件）</summary>
                  <ul style={{ fontSize: 12, lineHeight: 1.8, paddingInlineStart: 18 }}>
                    {uploads.map((u) => <li key={u.id}>{fmtDateTime(u.createdAt)}　{who(u.studentId)}　{u.pages}ページ　{u.verified ? "本人確認済み" : "自己申告"}{u.status === "failed" ? "（保存に失敗）" : ""}</li>)}
                  </ul>
                </details>
              )}
              <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 8, lineHeight: 1.7 }}>
                ログインしていない生徒は、出席番号を自分で選んで出します（一覧で「自己申告」）。番号の間違いは答案の詳細から直せます。
                先生がすでに取り込んだ答案・採点が始まった答案は、生徒が出し直しても上書きされません。
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
