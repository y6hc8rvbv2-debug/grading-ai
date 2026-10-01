"use client";
// 新規採点（取り込み → 5ステップ処理）。docs/prototype-v3.jsx の NewGrading を移植。
//
// 採点の方法（mode）:
//   - ai     : Supabase 接続時・採点AIあり。答案画像を保存し、続けて /api/grade で1枚ずつ AI 採点する
//   - upload : 採点AIが無い、または「保存だけ」を選んだとき。画像を保存して「AI採点待ち」にする
//   - local  : デモモード、または採点AIが無い環境で「動作確認用の仮採点」を選んだとき。
//              ルールベースの仮採点（点数は答案の内容と無関係）
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FONT_MONO } from "@/lib/ui/theme";
import { pct, uid } from "@/lib/util";
import { PIPELINE, SOURCES, checkQuality, gradeSubmission } from "@/lib/grading/engine";
import { isHeic, prepareImage } from "@/lib/image";
import { MODE_LABEL, STAGE_LABEL } from "@/lib/grading/cost";
import { GradingModePicker } from "@/components/GradingModePicker";
import { friendlyError } from "@/lib/errors";
import { useUI } from "@/components/ui-context";
import { Badge, Bar, Btn, Card, Empty, Field, Modal, PseudoQR, Section, Select, Table, grid } from "@/components/ui";
import type { GradingInput, Quality, Source, Submission } from "@/lib/types";

type Picked = { id: string; name: string; kb: number; src: Source; file?: File; studentId: string };

const MAX_FILES = 80;
// 1人分の答案のページ数の上限（app/api/grade/route.ts の MAX_PAGES と同じ）
const MAX_PAGES = 10;
const ACCEPT = "image/jpeg,image/png,image/heic,image/heif,.heic,.heif,application/pdf";
const EMPTY_QUALITY: Quality = { scores: {}, issues: [], fixes: [], ok: true, avg: 0 };

export default function NewGrading() {
  const { T, go, toast, ws, testById, classById, who, rubric, ds, subs, refresh, ai, aiGradeSub, gradingMode } = useUI();
  const demo = ds.mode === "demo";

  const [stage, setStage] = useState<"select" | "run" | "done">("select");
  const [files, setFiles] = useState<Picked[]>([]);
  const [source, setSource] = useState<Source>("camera");
  const [testId, setTestId] = useState(ws.tests[0]?.id ?? "");
  const [classId, setClassId] = useState(ws.classes[0]?.id ?? "");
  const [drag, setDrag] = useState(false);
  const [demoBlank, setDemoBlank] = useState(false);
  const [demoIssue, setDemoIssue] = useState(false);
  const [trialGrade, setTrialGrade] = useState(false);
  const [uploadOnly, setUploadOnly] = useState(false);
  // 1人分の答案が何枚の写真か。2以上なら、取り込んだ順に p.1, p.2 … として同じ生徒にまとめる
  const [pagesPer, setPagesPer] = useState(1);
  const [aiProgress, setAiProgress] = useState<{ done: number; total: number } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [step, setStep] = useState(-1);
  const [log, setLog] = useState<{ t: string; m: string }[]>([]);
  const [createdIds, setCreatedIds] = useState<string[]>([]);
  const [failed, setFailed] = useState(0);
  const [modal, setModal] = useState<"" | "mobile" | "mfp">("");
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const test = testById(testId);
  const klass = classById(classId);
  const roster = useMemo(
    () => ws.students.filter((s) => s.classId === classId).sort((a, b) => a.number - b.number),
    [ws.students, classId]
  );
  const mode: "ai" | "upload" | "local" =
    demo ? "local"
    : ai.enabled ? (uploadOnly ? "upload" : "ai")
    : trialGrade ? "local" : "upload";
  // ルールベースの仮採点を使うか（デモ、または採点AIが無い環境で明示的に選んだとき）
  const grading = mode === "local";

  // クラスを変えたら、取り込んだ答案を出席番号順に割り当て直す
  // （1人分が複数枚なら、pagesPer 枚ずつ同じ生徒にする）
  useEffect(() => {
    setFiles((prev) => prev.map((f, i) => ({ ...f, studentId: roster[Math.floor(i / pagesPer)]?.id ?? "" })));
  }, [roster, pagesPer]);

  const addPicked = (list: Omit<Picked, "studentId" | "id">[]) => {
    setFiles((prev) => {
      const next = [...prev, ...list.map((f, i) => ({
        ...f, id: uid("f"), studentId: roster[Math.floor((prev.length + i) / pagesPer)]?.id ?? "",
      }))];
      if (next.length > MAX_FILES) toast(`一度にアップロードできるのは${MAX_FILES}枚までです。残りは次の回に分けてください`, "warn");
      return next.slice(0, MAX_FILES);
    });
  };

  const addDemoFiles = (n: number, src: Source) => {
    setSource(src);
    addPicked(Array.from({ length: n }, (_, i) => ({
      name: `answer_${String(files.length + i + 1).padStart(3, "0")}.${src === "pdf" ? "pdf" : src === "mobile" ? "heic" : "jpg"}`,
      kb: 800 + Math.floor(Math.random() * 2600),
      src,
    })));
  };

  const onPickFiles = async (fileList: FileList | null, src: Source = "file") => {
    const picked = Array.from(fileList || []);
    if (!picked.length) return;
    // 大きな写真は、採点AIが受け付ける大きさ（1枚5MBまで）に縮小してから保存する
    // HEIC（iPhone の写真）は JPEG に変換する。メモリを使うので1枚ずつ順に処理する
    setPreparing(true);
    const arr: File[] = [];
    for (const f of picked) arr.push(await prepareImage(f));
    setPreparing(false);
    const heicLeft = arr.filter(isHeic).length;
    if (heicLeft) toast(`${heicLeft} 件の HEIC 写真をこのブラウザで変換できませんでした。保存と採点はできますが、画面に原本を表示できない場合があります`, "warn");
    const tooBig = arr.filter((f) => f.size > 20 * 1024 * 1024);
    const ok = arr.filter((f) => f.size <= 20 * 1024 * 1024);
    if (tooBig.length) toast(`${tooBig.length} 件は20MBを超えているため外しました。解像度を下げて撮り直してください`, "warn");
    if (!ok.length) return;
    setSource(src);
    addPicked(ok.map((f) => ({ name: f.name, kb: Math.max(1, Math.round(f.size / 1024)), src, file: f })));
    toast(`${ok.length} 件のファイルを追加しました`);
  };

  // 同じ生徒に割り当てた写真は、取り込んだ順に1人分の答案（複数ページ）にまとめる
  const groups = useMemo(() => {
    const m = new Map<string, Picked[]>();
    files.forEach((f) => { if (f.studentId) m.set(f.studentId, [...(m.get(f.studentId) ?? []), f]); });
    return [...m.values()];
  }, [files]);
  const pageOf = (f: Picked) => {
    const g = groups.find((x) => x[0].studentId === f.studentId);
    return g && g.length > 1 ? { n: g.indexOf(f) + 1, of: g.length } : null;
  };
  const tooManyPages = groups.some((g) => g.length > MAX_PAGES);

  /* ------------------------------------------------------------- 実行 */
  const buildInput = (group: Picked[], i: number): GradingInput => {
    const f = group[0];
    const pages = group.length;
    const st = ws.students.find((s) => s.id === f.studentId)!;
    const seed = 9000 + Math.floor(Math.random() * 9000) + i * 13;
    if (!grading) {
      return {
        testId, studentId: st.id, classId, source: f.src, pages,
        quality: EMPTY_QUALITY, isBlank: false, pending: true, items: [],
      };
    }
    const forceBlank = demoBlank && i === 0;
    const quality = checkQuality(seed, demoIssue && i === 1);
    const result = gradeSubmission(test!, st, seed, { forceBlank, reviewThreshold: rubric.reviewThreshold });
    return {
      testId, studentId: st.id, classId, source: f.src, pages, quality, isBlank: forceBlank,
      items: result.items.map((it) => ({
        questionId: it.questionId, qno: it.qno, detected: it.detected, confidence: it.confidence,
        mark: it.mark, earned: it.earned, blank: it.blank, needReview: it.needReview,
        reason: it.reason, comment: it.comment,
      })),
    };
  };

  const run = async () => {
    if (!test || !klass) { toast("先にテストとクラスを選んでください", "warn"); return; }
    if (!files.length) { toast("答案画像を追加してください", "warn"); return; }
    if (files.some((f) => !f.studentId)) { toast("生徒が割り当てられていない答案があります。一覧で生徒を選んでください", "warn"); return; }
    if (tooManyPages) { toast(`1人分の答案は${MAX_PAGES}枚までです。一覧で生徒の割り当てを直してください`, "warn"); return; }

    setStage("run"); setStep(0); setLog([]); setCreatedIds([]); setFailed(0);
    timers.current.forEach(clearTimeout); timers.current = [];
    const addLog = (t: string, m: string) => setLog((prev) => [...prev, { t, m }]);

    // 見た目の進行（各ステップの説明）。保存処理と並行して進める。
    const animation = new Promise<void>((resolve) => {
      if (!grading) { resolve(); return; }
      const lines: [string, string][] = [
        ["quality", `${files.length} 枚（${groups.length} 名分）を検査 → 自動トリミング / 傾き補正 / コントラスト補正を適用`],
        ["quality", demoIssue ? "1 枚でぼやけと影を検出。再撮影の候補として記録しました" : "全ページが採点可能な品質です"],
        ["test", `${test.subject}「${test.name}」${test.grade}年 ${test.term} / 試験番号 ${test.testNo} を抽出`],
        ["test", `問題数 ${test.questions.length} 問・満点 ${test.maxScore} 点・単元 ${test.units.length} 種を確定`],
        ["student", `${klass.label} の出席番号を割り当て、匿名IDで管理します（実名は保存しません）`],
        ["answer", demo ? "手書き文字・計算式・選択肢・記述を認識（デモ）" : "仮採点：解答の読み取りは行っていません（AI採点は準備中）"],
        ["answer", demoBlank ? "1 枚が全問白紙と判定 → 採点をスキップし模範解答生成へ" : "全ページで解答を検出"],
        ["grade", `${groups.length} 名分 × ${test.questions.length} 問の採点と部分点判定が完了`],
        ["grade", "赤ペン採点画像・弱点分析・フィードバックを生成しました"],
      ];
      PIPELINE.forEach((p, i) => {
        timers.current.push(setTimeout(() => {
          setStep(i);
          lines.filter((l) => l[0] === p.k).forEach((l, j) => {
            timers.current.push(setTimeout(() => addLog(p.title, l[1]), 340 + j * 320));
          });
        }, i * 1050));
      });
      timers.current.push(setTimeout(resolve, PIPELINE.length * 1050 + 900));
    });

    const saving = (async () => {
      const ids: string[] = [];
      const names: string[] = [];
      let ng = 0;
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const f = group[0];
        try {
          const id = await ds.saveGrading(buildInput(group, i), group.flatMap((g) => (g.file ? [g.file] : [])));
          ids.push(id);
          names.push(who(f.studentId));
          const what = group.length > 1 ? `${group.length} 枚（${group.map((g) => g.name).join("・")}）` : f.name;
          if (!grading) addLog("保存", `${who(f.studentId)}：${what} を保存しました（${i + 1}/${groups.length}）`);
        } catch (e) {
          ng++;
          addLog("エラー", `${who(f.studentId)}：${friendlyError(e, "保存")}`);
        }
      }
      return { ids, names, ng };
    })();

    const [, { ids, names, ng }] = await Promise.all([animation, saving]);
    await refresh();
    setCreatedIds(ids);

    // 保存できた答案を、1枚ずつ AI で採点する
    let aiNg = 0;
    if (mode === "ai" && ids.length) {
      setAiProgress({ done: 0, total: ids.length });
      addLog("AI採点", `採点方式：${MODE_LABEL[gradingMode]}`);
      for (let i = 0; i < ids.length; i++) {
        const name = names[i];
        addLog("AI採点", `${name}：採点しています…（${i + 1}/${ids.length}）`);
        const r = await aiGradeSub(ids[i], {
          silent: true,
          onProgress: (p) => addLog("AI採点", `${name}：${STAGE_LABEL[p.stage]}の結果に確認が必要な点があるため、${p.next ? STAGE_LABEL[p.next] : "次のモデル"}で採点し直します（${(p.reasons ?? []).slice(0, 3).join("／")}${(p.reasons?.length ?? 0) > 3 ? " ほか" : ""}）`),
        });
        if (r.ok) {
          const where = r.summary.mode === "cascade" && r.summary.finalStage ? `・${STAGE_LABEL[r.summary.finalStage]}で確定` : "";
          addLog("AI採点", r.summary.blank
            ? `${name}：全問白紙でした`
            : `${name}：${r.summary.total}点${where}${r.summary.needReview ? `（要確認 ${r.summary.needReview} 問）` : ""}`);
        } else {
          aiNg++;
          addLog("エラー", `${name}：${r.error}（画像は保存済みです。「採点中」の画面から採点し直せます）`);
        }
        setAiProgress({ done: i + 1, total: ids.length });
      }
    }

    setFailed(ng);
    setStep(PIPELINE.length);
    setStage("done");
    if (ng) toast(`${ng} 名分を保存できませんでした。処理ログを確認して、もう一度取り込んでください`, "ng");
    else if (aiNg) toast(`${aiNg} 名分をAI採点できませんでした。処理ログを確認してください（画像は保存済みです）`, "ng");
    else if (mode === "ai") toast(`${ids.length} 枚のAI採点が終わりました。返却前に結果を確認してください`);
    else toast(grading ? `${ids.length} 枚の採点が完了しました` : `${ids.length} 枚の答案を保存しました。あとで「採点中」の画面からAI採点できます`);
  };

  const reset = () => {
    timers.current.forEach(clearTimeout);
    setStage("select"); setFiles([]); setStep(-1); setLog([]); setCreatedIds([]); setFailed(0); setAiProgress(null);
  };

  /* ------------------------------------------------ 前提（テスト・クラス） */
  if (!ws.tests.length || !ws.classes.length) {
    return (
      <Card>
        <Empty icon="📝"
          title={!ws.tests.length ? "採点するテストがまだありません" : "クラスがまだ登録されていません"}
          hint={!ws.tests.length
            ? "テスト管理でテストと設問（配点・単元・正答）を登録すると、答案を取り込めるようになります。"
            : "クラスと生徒の名簿は、学校の管理者が登録します（docs/SUPABASE-SETUP.md のステップ4）。"}
          action={!ws.tests.length ? <Btn variant="primary" onClick={() => go("tests")}>テスト管理へ</Btn> : null} />
      </Card>
    );
  }

  /* ------------------------------------------------------------- 実行中・完了 */
  if (stage === "run" || stage === "done") {
    const created = createdIds.map((id) => subs.find((s) => s.id === id)).filter(Boolean) as Submission[];
    return (
      <div>
        <Section title={stage === "done"
            ? (mode === "upload" ? "答案を保存しました" : "採点が完了しました")
            : mode === "ai" ? (aiProgress ? "AIが採点しています" : "答案を保存しています")
            : grading ? "AIエージェントが処理中です" : "答案を保存しています"}
          right={stage === "done" ? <Btn size="sm" onClick={reset}>続けて取り込む</Btn> : null}>
          {grading ? (
            <div style={{ display: "grid", gap: 9 }}>
              {PIPELINE.map((p, i) => {
                const state = i < step ? "done" : i === step ? "run" : "wait";
                return (
                  <div key={p.k} style={{
                    display: "flex", gap: 12, alignItems: "flex-start", padding: 13,
                    border: `1px solid ${state === "run" ? T.accent : T.line}`, borderRadius: 12,
                    background: state === "run" ? T.accentSoft : T.panel,
                    opacity: state === "wait" ? 0.5 : 1, transition: "all .3s",
                  }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: 9, flexShrink: 0,
                      background: state === "done" ? T.ok : state === "run" ? T.accent : T.bgAlt,
                      color: state === "wait" ? T.textFaint : "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      font: `700 13px ${FONT_MONO}`,
                    }}>{state === "done" ? "✓" : p.n}</div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>
                        ステップ{p.n}：{p.title}
                        {state === "run" && <span style={{ marginInlineStart: 8, fontSize: 11, color: T.accent }}>処理中…</span>}
                      </div>
                      <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 4, lineHeight: 1.7 }}>{p.detail}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <Card>
              {mode === "ai" ? (
                <>
                  <div style={{ fontSize: 12.5, color: T.textSub, lineHeight: 1.8, marginBottom: 10 }}>
                    答案画像を学校専用の保管場所（非公開）に保存し、1枚ずつ AI が採点しています。1枚あたり数十秒かかります。
                    この画面を閉じると、残りの答案は「AI採点待ち」のまま残ります（「採点中」の画面から採点し直せます）。
                  </div>
                  <Bar value={aiProgress?.done ?? 0} max={aiProgress?.total || groups.length} tone="accent" />
                  <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 5 }}>
                    {aiProgress ? `AI採点 ${aiProgress.done} / ${aiProgress.total} 枚` : "答案を保存しています…"}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12.5, color: T.textSub, lineHeight: 1.8 }}>
                  答案画像を学校専用の保管場所（非公開）に保存しています。
                  保存した答案は「採点中」の一覧で <b>AI採点待ち</b> として表示され、そこから採点できます。
                </div>
              )}
            </Card>
          )}
        </Section>

        <Card title="処理ログ" style={{ marginBottom: 16 }}>
          <div style={{ font: `12px ${FONT_MONO}`, color: T.textSub, lineHeight: 1.9, maxHeight: 220, overflowY: "auto" }}>
            {log.length === 0 && <div style={{ color: T.textFaint }}>ログを待機しています…</div>}
            {log.map((l, i) => (
              <div key={i} style={{ color: l.t === "エラー" ? T.ng : undefined }}>
                <span style={{ color: l.t === "エラー" ? T.ng : T.accent }}>[{l.t}]</span> {l.m}
              </div>
            ))}
          </div>
        </Card>

        {stage === "done" && (
          <Card title={`${grading ? "採点結果" : "保存した答案"} ${created.length} 件${failed ? `（失敗 ${failed} 件）` : ""}`}
            sub="行をタップすると答案の詳細を確認できます">
            <Table
              columns={[
                { key: "st", label: "受験者", render: (r: Submission) => who(r.studentId) },
                { key: "score", label: "得点", align: "right", render: (r: Submission) =>
                  r.status === "blank" ? <Badge tone="warn">白紙</Badge>
                  : r.status === "uploaded" ? <Badge tone="info">AI採点待ち</Badge>
                  : <span style={{ font: `700 13px ${FONT_MONO}` }}>{r.result.total}/{test?.maxScore}</span> },
                { key: "rate", label: "得点率", align: "right", render: (r: Submission) =>
                  r.status === "blank" || r.status === "uploaded" ? "—" : `${pct(r.result.total, test?.maxScore ?? 0)}%` },
                { key: "rv", label: "要確認", align: "center", render: (r: Submission) => {
                  const n = r.result.items.filter((i) => i.needReview).length;
                  return r.status === "uploaded" ? "—" : n ? <Badge tone="warn">{n} 問</Badge> : <Badge tone="ok">なし</Badge>;
                } },
                { key: "act", label: "", align: "right", render: (r: Submission) => <Btn size="sm" variant="soft" onClick={() => go("detail", r.id)}>開く</Btn> },
              ]}
              rows={created}
              onRow={(r: Submission) => go("detail", r.id)}
            />
          </Card>
        )}
      </div>
    );
  }

  /* ------------------------------------------------------------- 取り込み */
  const options: { k: Source; icon: string; t: string; d: string; soon?: boolean }[] = [
    { k: "camera", icon: "📷", t: "カメラで撮影", d: demo ? "撮影ガイド枠つき（教師用）" : "スマートフォン・タブレットのカメラで撮る" },
    { k: "mobile", icon: "📱", t: "生徒モバイル提出", d: "リンク／QRを配って回収", soon: !demo },
    { k: "mfp", icon: "🖨", t: "印刷機・コピー機", d: "複合機スキャンから自動取り込み", soon: !demo },
    { k: "file", icon: "💻", t: "PCから選択", d: "JPEG / PNG / HEIC / PDF" },
    { k: "pdf", icon: "📄", t: "PDF一括", d: demo ? "1ファイルに複数枚を格納" : "PDFファイルを選ぶ（1ファイル＝1人分）" },
  ];
  const pick = (k: Source) => {
    if (k === "mobile" || k === "mfp") { setSource(k); setModal(k); return; }
    if (demo && k !== "file") { addDemoFiles(k === "camera" ? 5 : 10, k); return; }
    setSource(k);
    if (k === "camera") cameraRef.current?.click();
    else inputRef.current?.click();
  };

  return (
    <div>
      <Section title="1. 答案の取り込み方法を選ぶ">
        <div style={grid(180)}>
          {options.map((o) => (
            <button key={o.k} onClick={() => pick(o.k)}
              style={{
                textAlign: "start", background: source === o.k ? T.accentSoft : T.panel,
                border: `1px solid ${source === o.k ? T.accent : T.line}`, borderRadius: 13, padding: 14,
                cursor: "pointer", font: "inherit", position: "relative",
              }}>
              {o.soon && <span style={{ position: "absolute", top: 10, insetInlineEnd: 10 }}><Badge tone="mute">準備中</Badge></span>}
              <div style={{ fontSize: 21, marginBottom: 6 }}>{o.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{o.t}</div>
              <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 4, lineHeight: 1.6 }}>{o.d}</div>
            </button>
          ))}
        </div>
        <input ref={inputRef} type="file" multiple accept={source === "pdf" ? "application/pdf" : ACCEPT}
          style={{ display: "none" }} onChange={(e) => { onPickFiles(e.target.files, source === "pdf" ? "pdf" : "file"); e.target.value = ""; }} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment"
          style={{ display: "none" }} onChange={(e) => { onPickFiles(e.target.files, "camera"); e.target.value = ""; }} />
      </Section>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); onPickFiles(e.dataTransfer.files); }}
        style={{
          border: `2px dashed ${drag ? T.accent : T.lineStrong}`, borderRadius: 14, padding: "26px 16px",
          textAlign: "center", background: drag ? T.accentSoft : T.panelAlt, marginBottom: 18, transition: "all .2s",
        }}>
        <div style={{ fontSize: 26, marginBottom: 7 }}>{drag ? "📥" : "🗂"}</div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>ここに答案画像をドラッグ＆ドロップ</div>
        <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 5, lineHeight: 1.7 }}>
          JPEG / PNG / HEIC（iPhone の写真）/ PDF に対応。HEIC は自動で JPEG に変換します。1ファイル20MBまで、一度に最大{MAX_FILES}枚まで。
        </div>
        <div style={{ marginTop: 11, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <Btn size="sm" onClick={() => { setSource("file"); inputRef.current?.click(); }}>ファイルを選ぶ</Btn>
          {demo && <Btn size="sm" variant="soft" onClick={() => addDemoFiles(9, "camera")}>デモ答案を9枚入れる</Btn>}
        </div>
      </div>

      <Modal open={modal === "mobile"} onClose={() => setModal("")} title="生徒モバイル提出リンク" width={520}
        footer={demo ? <>
          <Btn onClick={() => { navigator.clipboard?.writeText("https://grade.example.jp/s/8F3K-92"); toast("リンクをコピーしました"); }}>リンクをコピー</Btn>
          <Btn variant="primary" onClick={() => { addDemoFiles(8, "mobile"); setModal(""); toast("生徒から8枚の提出がありました"); }}>提出を受け取る（デモ）</Btn>
        </> : <Btn variant="primary" onClick={() => setModal("")}>閉じる</Btn>}>
        {demo ? (
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <PseudoQR seed={testId.length * 31 + 5} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ font: `700 13px ${FONT_MONO}`, color: T.text, marginBottom: 6 }}>https://grade.example.jp/s/8F3K-92</div>
              <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12, color: T.textSub, lineHeight: 1.85 }}>
                <li>アプリのインストールは不要です。</li>
                <li>撮影ガイド枠に用紙を合わせると自動でシャッターが切れます。</li>
                <li>提出時に名前は入力させず、出席番号だけで受け付けます。</li>
                <li>リンクは実施日から72時間で失効します。</li>
              </ul>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: T.textSub, lineHeight: 1.85 }}>
            生徒が自分のスマートフォンから提出する機能は準備中です（提出リンクの発行と受け付けの仕組みを作成しています）。
            それまでは、先生のスマートフォンの「カメラで撮影」か、「PCから選択」で取り込んでください。
          </div>
        )}
      </Modal>

      <Modal open={modal === "mfp"} onClose={() => setModal("")} title="印刷機・コピー機からの取り込み" width={520}
        footer={demo
          ? <Btn variant="primary" onClick={() => { addDemoFiles(12, "mfp"); setModal(""); toast("複合機から12枚のスキャンを受け取りました"); }}>スキャンを受け取る（デモ）</Btn>
          : <Btn variant="primary" onClick={() => setModal("")}>閉じる</Btn>}>
        <div style={{ fontSize: 12.5, color: T.textSub, lineHeight: 1.85 }}>
          {demo
            ? "複合機のスキャン送信先に本アプリの取り込みアドレスを登録すると、スキャンした答案がそのまま採点キューに入ります（設定画面の「複合機・印刷機との連携」）。"
            : "複合機のスキャンを直接受け取る機能は準備中です。それまでは、複合機で PDF にスキャンして PC に保存し、「PDF一括」または「PCから選択」で取り込んでください。"}
        </div>
      </Modal>

      <Section title={`2. 取り込んだ答案（${files.length} / ${MAX_FILES} 枚）`}
        right={files.length ? <Btn size="sm" variant="ghost" onClick={() => setFiles([])}>すべて外す</Btn> : null}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <label htmlFor="pages-per" style={{ fontSize: 12, fontWeight: 700, color: T.textSub }}>1人分の答案の枚数</label>
          <select id="pages-per" value={pagesPer} onChange={(e) => setPagesPer(Number(e.target.value))}
            style={{ padding: "5px 8px", borderRadius: 8, border: `1px solid ${T.line}`, background: T.panel, color: T.text, font: "inherit", fontSize: 12.5 }}>
            {Array.from({ length: MAX_PAGES }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} 枚</option>)}
          </select>
          <span style={{ fontSize: 11.5, color: T.textFaint, lineHeight: 1.6 }}>
            2枚以上のときは、取り込んだ順に {pagesPer} 枚ずつ同じ生徒の答案（1ページ目・2ページ目…）にまとめます。
            同じ生徒を選んだ写真も、1人分の答案としてまとめます。
          </span>
        </div>
        {files.length === 0 ? (
          <Card><Empty icon="📄" title="まだ答案がありません"
            hint={demo ? "上の取り込み方法を選ぶか、デモ答案を入れて動作を試してください。" : "上の取り込み方法を選ぶか、ここに画像をドラッグしてください。"} /></Card>
        ) : (
          <Card pad={12}>
            {tooManyPages && (
              <div style={{ background: T.warnSoft, color: T.warn, border: `1px solid ${T.warn}`, borderRadius: 9, padding: "8px 11px", fontSize: 12, marginBottom: 10 }}>
                1人分の答案は{MAX_PAGES}枚までです。生徒の選択を直してください。
              </div>
            )}
            <div style={grid(170, 9)}>
              {files.map((f) => (
                <div key={f.id} style={{ border: `1px solid ${f.studentId ? T.line : T.warn}`, borderRadius: 10, padding: 9, background: T.panelAlt, position: "relative" }}>
                  <div style={{ height: 52, borderRadius: 7, background: T.bgAlt, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, marginBottom: 7 }}>
                    {SOURCES[f.src] ? SOURCES[f.src].icon : "🖼"}
                  </div>
                  <div style={{ fontSize: 11, color: T.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                  <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: 2, marginBottom: 6, display: "flex", gap: 6, alignItems: "center" }}>
                    {f.kb.toLocaleString()} KB
                    {pageOf(f) && <Badge tone="info">{pageOf(f)!.n} / {pageOf(f)!.of} ページ</Badge>}
                  </div>
                  <Select value={f.studentId} style={{ padding: "5px 7px", fontSize: 11.5 }}
                    onChange={(v: string) => setFiles((p) => p.map((x) => (x.id === f.id ? { ...x, studentId: v } : x)))}
                    options={[{ value: "", label: "生徒を選ぶ" }, ...roster.map((s) => ({ value: s.id, label: who(s.id) }))]} />
                  <button onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))} aria-label="この答案を外す"
                    style={{ position: "absolute", top: 5, insetInlineEnd: 5, border: "none", background: "transparent", color: T.textFaint, cursor: "pointer", fontSize: 13 }}>✕</button>
                </div>
              ))}
            </div>
          </Card>
        )}
      </Section>

      <Section title="3. 採点の対象と条件">
        <Card>
          <div style={grid(220, 14)}>
            <Field label="対象のテスト">
              <Select value={testId} onChange={setTestId}
                options={ws.tests.map((t) => ({ value: t.id, label: `${t.subject}／${t.name}（${t.grade}年）` }))} />
            </Field>
            <Field label="対象クラス" hint="答案は出席番号の順に割り当てます。違う場合は上の一覧で直せます。">
              <Select value={classId} onChange={setClassId}
                options={ws.classes.map((c) => ({ value: c.id, label: `${c.label}（${c.size}名）` }))} />
            </Field>
            <Field label="採点基準" hint="採点基準管理で変更できます。">
              <div style={{ fontSize: 12.5, color: T.text, padding: "9px 0", lineHeight: 1.6 }}>
                部分点 {rubric.partialStep} 段階・要点一致 {rubric.matchRate}%・信頼度 {rubric.reviewThreshold}% 未満は要確認
              </div>
            </Field>
          </div>

          {demo ? (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 4 }}>
              <label style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 12.5, color: T.textSub, cursor: "pointer" }}>
                <input type="checkbox" checked={demoBlank} onChange={(e) => setDemoBlank(e.target.checked)} />
                白紙答案を1枚混ぜる（模範解答の自動生成を試す）
              </label>
              <label style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 12.5, color: T.textSub, cursor: "pointer" }}>
                <input type="checkbox" checked={demoIssue} onChange={(e) => setDemoIssue(e.target.checked)} />
                画質不良を1枚混ぜる（再撮影案内を試す）
              </label>
            </div>
          ) : ai.enabled ? (
            <div style={{ background: T.infoSoft, border: `1px solid ${T.info}`, borderRadius: 10, padding: 12, marginTop: 4 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: T.info, marginBottom: 4 }}>AI（Claude）が答案を読み取って採点します</div>
              <div style={{ fontSize: 12, color: T.text, lineHeight: 1.8 }}>
                答案画像・正答・配点・採点基準をもとに、設問ごとに判定・得点・赤ペンコメントを付けます。
                1枚あたり数十秒かかります。結果は下書きなので、返却前に「要確認一覧」を確認してください。
              </div>
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 6 }}>採点方式</div>
                <GradingModePicker pages={pagesPer} questions={test?.questions.length ?? 10} answers={Math.max(1, groups.length)} />
              </div>
              <label style={{ display: "flex", gap: 7, alignItems: "flex-start", fontSize: 12, color: T.textSub, cursor: "pointer", marginTop: 8 }}>
                <input type="checkbox" checked={uploadOnly} onChange={(e) => setUploadOnly(e.target.checked)} style={{ marginTop: 3 }} />
                <span>画像の保存だけ行い、あとで採点する（「採点中」の画面からまとめてAI採点できます）</span>
              </label>
            </div>
          ) : (
            <div style={{ background: T.infoSoft, border: `1px solid ${T.info}`, borderRadius: 10, padding: 12, marginTop: 4 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: T.info, marginBottom: 4 }}>採点AIが設定されていません</div>
              <div style={{ fontSize: 12, color: T.text, lineHeight: 1.8 }}>
                いまは答案画像を保存し「AI採点待ち」にします。点数は付きません。
                サーバーに ANTHROPIC_API_KEY を設定すると、保存した答案をAIで採点できるようになります（管理者向け：docs/SUPABASE-SETUP.md）。
              </div>
              <label style={{ display: "flex", gap: 7, alignItems: "flex-start", fontSize: 12, color: T.textSub, cursor: "pointer", marginTop: 8 }}>
                <input type="checkbox" checked={trialGrade} onChange={(e) => setTrialGrade(e.target.checked)} style={{ marginTop: 3 }} />
                <span>動作確認用の仮採点を使う（<b style={{ color: T.ng }}>点数は実際の答案の内容と無関係です</b>。画面の動きを試すためだけに使い、生徒に返却しないでください）</span>
              </label>
            </div>
          )}

          <div style={{ marginTop: 16, display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center" }}>
            <Btn variant="shu" size="lg" onClick={run} disabled={!files.length || preparing}>
              {preparing ? "画像を準備しています…"
                : mode === "ai" ? `保存してAI採点する（${MODE_LABEL[gradingMode]}）`
                : mode === "local" ? (demo ? "AI採点をはじめる" : "仮採点をはじめる")
                : "答案を保存する"}
            </Btn>
            <span style={{ fontSize: 11.5, color: T.textFaint }}>
              {files.length && test ? `${groups.length} 名分（${files.length} 枚）・${test.questions.length} 問 × 満点 ${test.maxScore} 点` : "答案を追加すると開始できます"}
            </span>
          </div>
        </Card>
      </Section>
    </div>
  );
}
