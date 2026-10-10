"use client";
// 採点モデルの比較試験（管理者専用）。
// 1枚の答案画像を Haiku / Sonnet / Opus に1回ずつ採点させ、読み取り・判定・得点・時間・費用を比べる。
// API を呼ぶのはサーバー（app/api/compare）。この画面は APIキーに触れない。
// 結果は比較試験の記録（model_compare_*）にだけ保存し、答案・成績には保存しない。
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FONT_MONO } from "@/lib/ui/theme";
import { prepareImage } from "@/lib/image";
import { useUI } from "@/components/ui-context";
import { Badge, Btn, Card, Empty, Table } from "@/components/ui";
import { requireAiConsent } from "@/lib/ai-consent";

type Usage = { input: number; output: number; cacheWrite: number; cacheRead: number };
type JudgeQ = { qno: number; detected: string; mark: string; earned: number; readOk: boolean; verdictOk: boolean; scoreOk: boolean; all: boolean };
type Result = {
  id: string; position: number; display_name: string; model_id: string | null;
  status: "pending" | "calling" | "done" | "error" | "unavailable";
  elapsed_ms: number | null; served_model: string | null; stop_reason: string | null;
  usage: Usage | null; cost_usd: number | string | null;
  items: { qno: number; detected: string; mark: string; earned: number; confidence: number; reason: string }[] | null;
  judge: { perQ: JudgeQ[]; total: number; totalOk: boolean; allOk: boolean } | null;
  error: string | null; input_fingerprint: string | null;
};
type Run = {
  id: string; status: "running" | "done" | "failed"; image_name: string; image_sha256: string; image_bytes: number;
  settings: Record<string, unknown>; note: string; created_at: string; finished_at: string | null; results: Result[];
};
type Expected = {
  questions: { qno: number; problem: string; studentAnswer: string; correctAnswer: string; correct: boolean; earned: number }[];
  total: number; maxScore: number;
};
type Info = {
  enabled: boolean; reason: string; runs: Run[];
  conditions: {
    candidates: string[]; answerKey: string[]; rubric: string; thinking: string; pricingSource: string;
    prices: Record<string, { input: number; output: number }>; expected: Expected; maxImageBytes: number;
  };
};

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩";
const STATUS: Record<Result["status"], [string, "ok" | "warn" | "ng" | "info" | "mute"]> = {
  pending: ["未実行", "mute"], calling: ["採点中…", "info"], done: ["完了", "ok"],
  error: ["失敗（再試行なし）", "ng"], unavailable: ["利用不可（未実行）", "warn"],
};
const RUN_STATUS: Record<Run["status"], [string, "ok" | "ng" | "info"]> = {
  running: ["実行中", "info"], done: ["完了", "ok"], failed: ["中止・時間切れ", "ng"],
};
const sortRes = (r: Result[]) => [...r].sort((a, b) => a.position - b.position);
const usd = (v: number | string | null) => (v == null ? "—" : `$${Number(v).toFixed(4)}`);
const sec = (ms: number | null) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)}秒`);
const fmtDate = (s: string) => new Date(s).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "medium" });

async function sha256Hex(file: Blob) {
  const d = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

export default function ModelCompareView() {
  const { T, ds, isAdmin, toast } = useUI();
  const [info, setInfo] = useState<Info | null>(null);
  const [loadError, setLoadError] = useState("");
  const [picked, setPicked] = useState<{ file: File; sha: string; url: string; requestId: string } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [rerun, setRerun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "warn" | "ng" | "ok"; text: string } | null>(null);
  const [current, setCurrent] = useState<Run | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const lock = useRef(false);   // ボタンの連打で2回始めない

  const load = useCallback(async () => {
    const r = await api("/api/compare");
    if (!r.ok) { setLoadError(r.body.error || "比較試験の情報を読み込めませんでした。画面を再読み込みしてください。"); return; }
    setLoadError("");
    setInfo(r.body as Info);
  }, []);

  useEffect(() => {
    if (ds.mode === "supabase" && isAdmin) load();
  }, [ds.mode, isAdmin, load]);
  useEffect(() => () => { if (picked) URL.revokeObjectURL(picked.url); }, [picked]);

  const onPick = async (f: File | undefined) => {
    setNotice(null); setRerun(false);
    if (!f) return;
    setPreparing(true);
    try {
      const file = await prepareImage(f);
      if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
        setNotice({ tone: "ng", text: "JPEG か PNG の画像を選んでください（HEIC・PDF はこの試験では使えません。iPhone の写真は「互換性優先」で撮るか、スクリーンショットにしてください）。" });
        setPicked(null);
        return;
      }
      if (info && file.size > info.conditions.maxImageBytes) {
        setNotice({ tone: "ng", text: "画像が大きすぎます（4MBまで）。解像度を下げて保存し直してください。" });
        setPicked(null);
        return;
      }
      setPicked({ file, sha: await sha256Hex(file), url: URL.createObjectURL(file), requestId: crypto.randomUUID() });
    } finally {
      setPreparing(false);
    }
  };

  const run = async () => {
    if (!picked || lock.current) return;
    // 答案の写真を AI に送る前に、明示の同意（同意しなければ何も送らない）
    try { await requireAiConsent(); } catch (e) { setNotice({ tone: "ng", text: (e as Error).message }); return; }
    lock.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const s = await api("/api/compare", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "start", requestId: picked.requestId, imageSha256: picked.sha,
          imageName: picked.file.name, imageBytes: picked.file.size, rerun,
        }),
      });
      if (!s.ok) {
        setNotice({ tone: s.body.code === "already_done" ? "warn" : "ng", text: s.body.error || "比較試験を始められませんでした。" });
        if (s.body.runId) setSelectedId(s.body.runId);
        await load();
        return;
      }
      let r: Run = s.body.run;
      setCurrent(r);
      setSelectedId(r.id);
      // 1モデルずつ順番に呼ぶ（各モデル1回。失敗しても再試行しない）
      for (const res of sortRes(r.results)) {
        if (res.status !== "pending") continue;
        r = { ...r, results: r.results.map((x) => (x.id === res.id ? { ...x, status: "calling" } : x)) };
        setCurrent(r);
        const fd = new FormData();
        fd.set("runId", r.id);
        fd.set("displayName", res.display_name);
        fd.set("image", picked.file, picked.file.name);
        const c = await api("/api/compare/call", { method: "POST", body: fd });
        const next: Result = c.ok
          ? c.body.result
          : { ...res, status: "error", error: c.body.error || `呼び出しに失敗しました（HTTP ${c.status}）。再試行はしません。` };
        r = { ...r, results: r.results.map((x) => (x.id === res.id ? next : x)) };
        setCurrent(r);
      }
      toast("比較が終わりました");
      // 同じ画像を続けて実行しないよう、選んだ画像はそのまま・再実行のチェックは外す
      setRerun(false);
      setPicked((p) => (p ? { ...p, requestId: crypto.randomUUID() } : p));
    } finally {
      await load();
      setCurrent(null);
      setBusy(false);
      lock.current = false;
    }
  };

  const post = async (action: "abort" | "delete", runId: string, done: string) => {
    const r = await api("/api/compare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, runId }) });
    if (!r.ok) { toast(r.body.error || "操作に失敗しました", "ng"); return; }
    toast(done);
    if (action === "delete" && selectedId === runId) setSelectedId(null);
    await load();
  };

  const shown: Run | null = useMemo(() => {
    if (current) return current;
    if (!info) return null;
    return info.runs.find((r) => r.id === selectedId) ?? info.runs[0] ?? null;
  }, [current, info, selectedId]);

  /* -------------------------------------------------------------- 使えない場合 */
  if (ds.mode !== "supabase") {
    return <Card><Empty icon="🧪" title="モデル比較試験は Supabase に接続した環境でだけ使えます"
      hint="デモモードでは採点AIを呼び出しません。Vercel の Preview など、Supabase と ANTHROPIC_API_KEY を設定した環境で開いてください。" /></Card>;
  }
  if (!isAdmin) {
    return <Card><Empty icon="🔒" title="管理者だけが使える画面です" hint="比較試験は API の費用がかかるため、学校の管理者だけが実行できます。" /></Card>;
  }
  if (loadError) {
    return <Card><Empty icon="⚠️" title="比較試験の情報を読み込めませんでした" hint={loadError}
      action={<Btn onClick={load}>もう一度読み込む</Btn>} /></Card>;
  }
  if (!info) return <Card><div style={{ color: T.textSub, fontSize: 13 }}>読み込み中…</div></Card>;

  const c = info.conditions;
  const runningRun = info.runs.find((r) => r.status === "running");
  const exp = c.expected;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card title="試験の条件" sub="3モデルに同じ画像・同じ採点指示・同じ採点基準を1回ずつ送ります。答案・成績には保存しません。">
        <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 13, lineHeight: 1.9, color: T.text }}>
          <li>モデル: {c.candidates.join(" / ")}（正式なモデルID は実行時に Models API で確認。見つからないモデルは代わりを使わず「利用不可」と記録）</li>
          <li>採点基準: {c.rubric}</li>
          <li>模範解答（全モデル共通でモデルに渡す）: {c.answerKey.map((a, i) => `${CIRCLED[i]}${a}`).join("、")}</li>
          <li>自動再試行なし・別モデルへの自動切り替えなし・thinking は{c.thinking}</li>
          <li>答案画像はサーバーに保存しません（記録に残すのはファイル名と sha256 だけ）</li>
        </ul>
        <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: T.panelAlt, border: `1px solid ${T.line}`, fontSize: 12.5, color: T.textSub, lineHeight: 1.8 }}>
          <b style={{ color: T.text }}>期待結果（照合専用・モデルには送りません）</b><br />
          {exp.questions.map((q) => `${CIRCLED[q.qno - 1]} ${q.problem}=${q.studentAnswer} → ${q.correct ? `正答 ${q.earned}点` : `誤答（正解${q.correctAnswer}）${q.earned}点`}`).join("／")}
          ／合計 {exp.total}点／{exp.maxScore}点
        </div>
      </Card>

      <Card title="答案画像を選んで実行する">
        {!info.enabled && (
          <div role="alert" style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 10, background: T.warnSoft, color: T.warn, fontSize: 13 }}>
            {info.reason}
          </div>
        )}
        {runningRun && !busy && (
          <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 10, background: T.infoSoft, color: T.info, fontSize: 13, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ flex: 1 }}>実行中の比較試験があります（{fmtDate(runningRun.created_at)}）。別の画面や端末で実行中でなければ、中止してから始めてください。</span>
            <Btn size="sm" onClick={() => post("abort", runningRun.id, "比較試験を中止しました")}>中止する</Btn>
          </div>
        )}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 280px", minWidth: 0 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: T.textSub, marginBottom: 6 }} htmlFor="compare-file">
              答案画像（JPEG / PNG）
            </label>
            <input id="compare-file" type="file" accept="image/jpeg,image/png,image/webp,.heic,.heif" disabled={busy}
              onChange={(e) => onPick(e.target.files?.[0])} />
            {preparing && <div style={{ fontSize: 12, color: T.textSub, marginTop: 6 }}>画像を準備しています…</div>}
            {picked && (
              <div style={{ fontSize: 12, color: T.textSub, marginTop: 8, lineHeight: 1.7 }}>
                {picked.file.name}（{(picked.file.size / 1024).toFixed(0)}KB）<br />
                <span style={{ fontFamily: FONT_MONO }}>sha256 {picked.sha.slice(0, 16)}…</span>
              </div>
            )}
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, color: T.text, marginTop: 12 }}>
              <input type="checkbox" checked={rerun} disabled={busy} onChange={(e) => setRerun(e.target.checked)} />
              同じ画像でもう一度実行する（APIを再度呼び、費用がかかります）
            </label>
            <div style={{ marginTop: 12 }}>
              <Btn variant="primary" disabled={!picked || busy || preparing || !info.enabled || !!runningRun} onClick={run}>
                {busy ? "比較しています…（画面を閉じないでください）" : "3モデルで比較する（APIを最大3回呼びます）"}
              </Btn>
            </div>
            {notice && (
              <div role="status" style={{
                marginTop: 12, padding: "10px 12px", borderRadius: 10, fontSize: 13,
                background: notice.tone === "ng" ? T.ngSoft : notice.tone === "warn" ? T.warnSoft : T.okSoft,
                color: notice.tone === "ng" ? T.ng : notice.tone === "warn" ? T.warn : T.ok,
              }}>{notice.text}</div>
            )}
          </div>
          {picked && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={picked.url} alt="選んだ答案画像" style={{ maxWidth: 260, maxHeight: 340, borderRadius: 8, border: `1px solid ${T.line}` }} />
          )}
        </div>
      </Card>

      {shown ? <RunResult run={shown} expected={exp} busy={busy}
        onDelete={() => post("delete", shown.id, "比較試験の記録を削除しました")} /> : (
        <Card><Empty icon="🧪" title="まだ比較試験をしていません" hint="答案画像を選んで「3モデルで比較する」を押してください。" /></Card>
      )}

      {info.runs.length > 0 && (
        <Card title="これまでの比較試験" sub="あなたが実行した試験だけが表示されます（新しい順に10件）">
          <Table
            columns={[
              { key: "created_at", label: "日時", render: (r: Run) => fmtDate(r.created_at) },
              { key: "image_name", label: "画像", render: (r: Run) => r.image_name || "—" },
              { key: "status", label: "状態", render: (r: Run) => <Badge tone={RUN_STATUS[r.status][1]}>{RUN_STATUS[r.status][0]}</Badge> },
              {
                key: "totals", label: "合計点", wrap: true,
                render: (r: Run) => sortRes(r.results).map((x) => `${x.display_name.replace("Claude ", "")}: ${x.judge ? x.judge.total : "—"}`).join("／"),
              },
            ]}
            rows={info.runs}
            onRow={(r: Run) => setSelectedId(r.id)}
          />
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ 1回分の結果 */
function RunResult({ run, expected, busy, onDelete }: { run: Run; expected: Expected; busy: boolean; onDelete: () => void }) {
  const { T } = useUI();
  const results = sortRes(run.results);
  const prints = Array.from(new Set(results.filter((r) => r.input_fingerprint).map((r) => r.input_fingerprint)));
  const mark = (b: boolean) => <span style={{ color: b ? T.ok : T.ng, fontWeight: 700 }}>{b ? "✓" : "✗"}</span>;

  const download = () => {
    const blob = new Blob([JSON.stringify({ run, expected }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `model-compare-${run.created_at.slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card title={`比較結果（${fmtDate(run.created_at)}）`}
      sub={`画像: ${run.image_name || "—"}（sha256 ${run.image_sha256.slice(0, 16)}…）${prints.length === 1 ? "・3モデルとも同じ入力（指紋 " + prints[0]!.slice(0, 12) + "…）" : prints.length > 1 ? "・⚠ モデルごとに入力が違います" : ""}`}
      right={!busy && run.status !== "running" && (
        <div style={{ display: "flex", gap: 8 }}>
          <Btn size="sm" onClick={download}>記録を書き出す（JSON）</Btn>
          <Btn size="sm" variant="ghost" onClick={onDelete}>削除</Btn>
        </div>
      )}>
      <Table
        columns={[
          { key: "display_name", label: "モデル" },
          { key: "model_id", label: "正式なモデルID", render: (r: Result) => <span style={{ fontFamily: FONT_MONO, fontSize: 12 }}>{r.model_id ?? "—"}</span> },
          { key: "status", label: "状態", render: (r: Result) => <Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge> },
          { key: "total", label: "合計点", align: "right", render: (r: Result) => (r.judge ? `${r.judge.total} / ${expected.maxScore}` : "—") },
          { key: "match", label: `期待（${expected.total}点）と一致`, render: (r: Result) => (r.judge
            ? (r.judge.allOk ? <Badge tone="ok">全問一致</Badge> : <Badge tone="ng">{`${r.judge.perQ.filter((q) => q.all).length}/${r.judge.perQ.length}問一致${r.judge.totalOk ? "・合計は一致" : ""}`}</Badge>)
            : "—") },
          { key: "elapsed_ms", label: "処理時間", align: "right", render: (r: Result) => sec(r.elapsed_ms) },
          { key: "in", label: "入力トークン", align: "right", render: (r: Result) => r.usage?.input ?? "—" },
          { key: "out", label: "出力トークン", align: "right", render: (r: Result) => r.usage?.output ?? "—" },
          { key: "cost", label: "概算費用（USD）", align: "right", render: (r: Result) => usd(r.cost_usd) },
        ]}
        rows={results}
      />
      {results.some((r) => r.error) && (
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          {results.filter((r) => r.error).map((r) => (
            <div key={r.id} style={{ fontSize: 12.5, color: r.status === "unavailable" ? T.warn : T.ng }}>
              {r.display_name}: {r.error}
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 12, fontWeight: 700, color: T.textSub, margin: "16px 0 6px" }}>設問ごと（読み取り・判定・得点 と 期待結果との照合）</div>
      <Table
        columns={[
          { key: "q", label: "問" },
          { key: "exp", label: "期待（生徒の答え／正誤／得点）", render: (q: Expected["questions"][number]) =>
            `${q.studentAnswer}／${q.correct ? "正答" : `誤答（正解${q.correctAnswer}）`}／${q.earned}点` },
          ...results.map((r) => ({
            key: r.id, label: r.display_name.replace("Claude ", ""),
            render: (q: Expected["questions"][number]) => {
              const j = r.judge?.perQ.find((x) => x.qno === q.qno);
              if (!j) return "—";
              return <span>{j.detected || "（空）"}・{j.mark}・{j.earned}点 {mark(j.readOk)}{mark(j.verdictOk)}{mark(j.scoreOk)}</span>;
            },
          })),
        ]}
        rows={expected.questions.map((q) => ({ ...q, id: String(q.qno), q: CIRCLED[q.qno - 1] }))}
      />
      <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 8, lineHeight: 1.7 }}>
        ✓✗ は左から「読み取り・判定・得点」が期待結果と合っているか。得点はアプリの後処理（判定に合わせて 0〜配点に決め直す）を通した値。
        費用は公式単価 × 実際のトークン数の概算（出力トークンには思考のトークンも含む）。
      </div>
    </Card>
  );
}
