"use client";
// 新規採点（取り込み → 5ステップ処理）。docs/prototype-v3.jsx の NewGrading を移植。
//
// 採点の方法（mode）:
//   - ai     : Supabase 接続時・採点AIあり。答案画像を保存し、続けて /api/grade で AI 採点する
//              ver6：1人分ずつ「保存 → 採点」を流れ作業にして、同時に N 人分（設定画面の「AIエンジン」）ずつ進める
//
// おまかせモード（ver6・既定でオン）:
//   答案を入れると AI が受験番号・出席番号・テスト名を読んで生徒とテストを自動で決め（並列）、
//   割り当て・ページ順に問題がなければ確認のチェックを自動で付ける（lib/workflow/auto-check.ts）。
//   問題がある答案だけを先生に見せ、準備がそろえば数秒後に自動で採点を始める（取り消せる）。
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
import { Badge, Bar, Btn, Card, Empty, Field, Section, Select, Table, grid } from "@/components/ui";
import type { GradingInput, Quality, Source, Submission } from "@/lib/types";

import { assignPages, type PageInfo } from "@/lib/workflow/intake";
import { runPool, withBusyRetry } from "@/lib/workflow/pool";
import { autoCheck, bestClass, matchTest } from "@/lib/workflow/auto-check";
import NewTestForm from "./NewTestForm";
import FileThumbnail from "@/components/FileThumbnail";
import { StudentSubmitPanel } from "@/components/StudentSubmitPanel";
import { preflight } from "@/lib/workflow/preflight";
import { requireAiConsent } from "@/lib/ai-consent";
import { askNotifyPermission, notifyDone } from "@/lib/notify";

type Picked = {
  id: string; name: string; kb: number; src: Source; file?: File; studentId: string; warnings?: string[]; hash?: string;
  /** 生徒の決め方：AI が受験番号で照合 / 取り込み順の仮の割り当て / 先生が選んだ（ver6） */
  assignedBy?: "ai" | "order" | "teacher";
  /** 自動振り分けで読み取った内容（読み取り済みなら同じ写真を二度送らない） */
  scan?: PageInfo | null;
};

// ver6：100枚以上の答案を一度に取り込めるようにした（ver5 は80枚）
const MAX_FILES = 500;
// 自動振り分けを同時に送る数
const SCAN_CONCURRENCY = 6;

/** 端末に覚える小さな設定（おまかせモードなど） */
function useLocalFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(initial);
  useEffect(() => {
    try { const raw = window.localStorage.getItem(`saiten.${key}`); if (raw != null) setV(raw === "1"); } catch { /* 既定値のまま */ }
  }, [key]);
  return [v, (next: boolean) => { setV(next); try { window.localStorage.setItem(`saiten.${key}`, next ? "1" : "0"); } catch { /* 無視 */ } }];
}
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
  // アーカイブしたテスト（0008）は採点の対象に出さない
  const activeTests = useMemo(() => ws.tests.filter((t) => !t.archivedAt), [ws.tests]);
  const [testId, setTestId] = useState("");
  const [testSetup, setTestSetup] = useState<{ files: File[]; key: string } | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [testChecked, setTestChecked] = useState(false);
  const [referenceStudent, setReferenceStudent] = useState("");
  const [classId, setClassId] = useState(ws.classes[0]?.id ?? "");
  const [drag, setDrag] = useState(false);
  const [demoBlank, setDemoBlank] = useState(false);
  const [demoIssue, setDemoIssue] = useState(false);
  const [trialGrade, setTrialGrade] = useState(false);
  const [uploadOnly, setUploadOnly] = useState(false);
  // 1人分の答案が何枚の写真か。2以上なら、取り込んだ順に p.1, p.2 … として同じ生徒にまとめる
  const [pagesPer, setPagesPer] = useState(1);
  // おまかせモード（自動振り分け・自動確認）と、準備がそろったら自動で採点を始めるか
  const [omakase, setOmakase] = useLocalFlag("omakase", true);
  const [autoStart, setAutoStart] = useLocalFlag("autoStart", true);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [autoStartOff, setAutoStartOff] = useState(false);
  const [printedTitles, setPrintedTitles] = useState<string[]>([]);
  const [testAuto, setTestAuto] = useState<"" | "matched" | "created">("");
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [aiProgress, setAiProgress] = useState<{ done: number; total: number } | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [saveErrors, setSaveErrors] = useState(0);
  const [gradeErrors, setGradeErrors] = useState(0);
  const [currentWork, setCurrentWork] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (stage !== "run" || startedAt === null) return;
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick(); const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [stage, startedAt]);
  const [preparing, setPreparing] = useState(false);
  const [checked, setChecked] = useState(false);
  const [autoAssign, setAutoAssign] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [step, setStep] = useState(-1);
  const [log, setLog] = useState<{ t: string; m: string }[]>([]);
  const [createdIds, setCreatedIds] = useState<string[]>([]);
  const [failed, setFailed] = useState(0);
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
  // （AI が受験番号で照合した答案・先生が選んだ答案はそのまま）
  useEffect(() => {
    setChecked(false);
    setFiles((prev) => prev.map((f, i) => (f.assignedBy === "ai" || f.assignedBy === "teacher" ? f
      : { ...f, studentId: roster[Math.floor(i / pagesPer)]?.id ?? "", assignedBy: "order" })));
  }, [roster, pagesPer]);

  const addPicked = (list: Omit<Picked, "studentId" | "id">[]) => {
    setFiles((prev) => {
      const next = [...prev, ...list.map((f, i) => ({
        ...f, id: uid("f"), studentId: roster[Math.floor((prev.length + i) / pagesPer)]?.id ?? "", assignedBy: "order" as const,
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

  // 自動振り分け（ver6：並列で読み取り、読み取り済みの写真は送り直さない。合うクラス・テストも自動で選ぶ）
  const canScan = !demo && ai.enabled;
  const scanning = useRef(false);
  const scanPages = async (opts: { auto?: boolean } = {}) => {
    if (scanning.current) return;
    scanning.current = true;
    setScanBusy(true); setChecked(false);
    try {
      await requireAiConsent();   // 答案の写真を AI に送る前に、明示の同意
      const current = files;
      const targets = current.map((f, i) => ({ f, i })).filter(({ f }) => f.file && (f.scan === undefined || (!opts.auto && f.scan === null)) && /^image\/(jpeg|png)$/.test(f.file.type));
      const scans = new Map<string, PageInfo | null>(current.filter((f) => f.scan !== undefined).map((f) => [f.id, f.scan ?? null]));
      let failedCount = 0;
      await runPool(targets, SCAN_CONCURRENCY, async ({ f }) => {
        const body = new FormData(); body.set("file", f.file!);
        const res = await fetch("/api/intake", { method: "POST", body }); const value = await res.json().catch(() => ({}));
        if (!res.ok) { failedCount++; scans.set(f.id, null); throw new Error(value.error || "読み取りに失敗しました"); }
        scans.set(f.id, value as PageInfo);
      });
      // 読み取れた写真で、いちばんよく合うクラスを選ぶ
      const read = current.map((f) => scans.get(f.id) ?? null);
      const pages = read.map((pg) => pg ?? { examNo: "", number: 0, page: 0, first: 0, last: 0, totalPages: 0, issues: [] });
      const best = bestClass(read.filter(Boolean) as PageInfo[], ws.classes, ws.students);
      const useClass = best && best.classId !== classId ? best.classId : classId;
      const rosterOf = ws.students.filter((st) => st.classId === useClass).sort((x, y) => x.number - y.number);
      const assigned = assignPages(pages, rosterOf);
      const counts = new Map<string, number>();
      assigned.forEach((x) => { if (x.studentId) counts.set(x.studentId, (counts.get(x.studentId) || 0) + 1); });
      setFiles((prev) => prev.map((f) => {
        const i = current.findIndex((c) => c.id === f.id);
        if (i < 0) return f;   // 読み取り中に追加された写真は次の回に読む
        const pg = read[i];
        if (!pg) return { ...f, scan: scans.has(f.id) ? null : f.scan };   // PDF・読めなかった写真は取り込み順のまま
        const extra = pg.totalPages > 0 && assigned[i].studentId && counts.get(assigned[i].studentId) !== pg.totalPages ? ["ページ数が印刷の総枚数と一致しません"] : [];
        const keepTeacher = f.assignedBy === "teacher";
        return {
          ...f, scan: pg,
          studentId: keepTeacher ? f.studentId : assigned[i].studentId,
          assignedBy: keepTeacher ? "teacher" : assigned[i].studentId ? "ai" : "order",
          warnings: [...(f.warnings || []).filter((w) => !/名簿と照合|一致しません|重複|順序|続きと推定|生徒を選んで/.test(w)), ...assigned[i].issues, ...extra],
        };
      }));
      setAutoAssign(true);
      if (useClass !== classId) { setClassId(useClass); toast(`答案の受験番号から、クラスを「${classById(useClass)?.label ?? ""}」にしました`); }
      // 答案に印刷されたテスト名から、テストを選ぶ（先生が選んでいなければ）
      const titles = read.map((pg) => pg?.title ?? "").filter(Boolean);
      setPrintedTitles(titles);
      const hit = matchTest(titles, ws.tests);
      if (hit && !testId) { setTestId(hit); setTestAuto("matched"); }
      if (failedCount) toast(`${failedCount} 枚は自動で読み取れませんでした。一覧で生徒を確かめてください`, "warn");
      else if (!opts.auto) toast("振り分けが終わりました。確認が必要な答案だけを一覧の上に表示します");
    } catch (e) { toast(e instanceof Error ? e.message : "読み取り失敗", "ng"); }
    finally { setScanBusy(false); scanning.current = false; }
  };
  // おまかせモード：答案を入れたら、自動で振り分ける
  useEffect(() => {
    if (!omakase || !canScan || scanning.current || preparing || stage !== "select") return;
    if (files.some((f) => f.file && f.scan === undefined && /^image\/(jpeg|png)$/.test(f.file.type))) scanPages({ auto: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, omakase, canScan, preparing, stage]);

  const onPickFiles = async (fileList: FileList | null, src: Source = "file") => {
    const picked = Array.from(fileList || []);
    if (!picked.length) return;
    // 大きな写真は、採点AIが受け付ける大きさ（1枚5MBまで）に縮小してから保存する
    // HEIC（iPhone の写真）は JPEG に変換する。メモリを使うので1枚ずつ順に処理する
    // ver6：4枚ずつ並べて準備する（100枚以上でも待ち時間を短く）
    setPreparing(true);
    const arr: File[] = (await runPool(picked, 4, (f) => prepareImage(f))).map((r, i) => (r.ok ? r.value : picked[i]));
    setPreparing(false);
    const heicLeft = arr.filter(isHeic).length;
    if (heicLeft) toast(`${heicLeft} 件の HEIC 写真をこのブラウザで変換できませんでした。保存と採点はできますが、画面に原本を表示できない場合があります`, "warn");
    const tooBig = arr.filter((f) => f.size > 20 * 1024 * 1024);
    const ok = arr.filter((f) => f.size <= 20 * 1024 * 1024);
    if (tooBig.length) toast(`${tooBig.length} 件は20MBを超えているため外しました。解像度を下げて撮り直してください`, "warn");
    if (!ok.length) return;
    setSource(src);
    const checkedList = await runPool(ok, 4, async (f) => ({
      f,
      hash: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await f.arrayBuffer()))).map(x=>x.toString(16).padStart(2,"0")).join(""),
      warnings: await preflight(f).catch(()=>["画質を確認してください"]),
    }));
    const prepared: Omit<Picked,"studentId"|"id">[] = [];
    for (const r of checkedList) {
      if (!r.ok) continue;
      const { f, hash, warnings } = r.value;
      if(files.some(x=>x.hash===hash) || prepared.some(x=>x.hash===hash)) {toast(`${f.name} は同じ画像のため追加しません`,"warn");continue;}
      prepared.push({name:f.name,kb:Math.max(1,Math.round(f.size/1024)),src,file:f,hash,warnings});
    }
    setChecked(false);addPicked(prepared);
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

  const missingAnswers = test?.questions.filter(q => q.type === "graph" ? !q.model.trim() : !q.correct.trim()) ?? [];

  /* ------------------------------------------------ おまかせモード：自動確認 */
  const omakaseOn = omakase && !demo;
  const check = useMemo(() => autoCheck(files.map((f) => ({
    studentId: f.studentId, warnings: f.warnings, assignedBy: f.assignedBy, isPdf: f.file?.type === "application/pdf" || f.src === "pdf",
  })), MAX_PAGES), [files]);
  const problemIdx = useMemo(() => new Set(check.problems.map((x) => x.index)), [check]);
  // 割り当て・ページ順に問題がなければ、確認のチェックを自動で付ける（問題が出たら外す）
  useEffect(() => {
    if (!omakaseOn || scanBusy || preparing) return;
    if (check.ok && !checked) setChecked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [omakaseOn, check, scanBusy, preparing]);
  // テストが答案に印刷されたテスト名と一致する（または、この画面で今作ったテスト）なら、正答・配点の確認も自動で付ける
  const titleMatches = !!test && matchTest(printedTitles, ws.tests) === test.id;
  useEffect(() => {
    if (!omakaseOn || !test || missingAnswers.length) return;
    if ((titleMatches || testAuto === "created") && !testChecked) setTestChecked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [omakaseOn, test?.id, titleMatches, testAuto, missingAnswers.length]);
  const nextStep = !files.length ? 1 : !checked ? 2 : !test || missingAnswers.length ? 3 : 4;
  const readyToRun = stage === "select" && files.length > 0 && !preparing && !scanBusy && !!test && !!klass && testChecked
    && !missingAnswers.length && !files.some((f) => !f.studentId) && (demo || checked) && !tooManyPages;
  // 準備がそろったら、5秒数えてから自動で採点を始める（「取り消す」で止められる。答案を足したらまた数える）
  useEffect(() => { setAutoStartOff(false); setCountdown(null); }, [files.length, testId]);
  useEffect(() => {
    if (!omakaseOn || !autoStart || autoStartOff || !readyToRun || mode === "local") { if (countdown !== null) setCountdown(null); return; }
    if (countdown === null) { setCountdown(5); return; }
    if (countdown <= 0) { setCountdown(null); setAutoStartOff(true); run(); return; }
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [omakaseOn, autoStart, autoStartOff, readyToRun, countdown, mode]);
  const jumpTo = (n: number) => document.getElementById(`grading-step-${n}`)?.scrollIntoView({behavior:"smooth",block:"start"});

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
    if (missingAnswers.length) { toast("正答・採点条件が未入力です。手順3で準備してください", "warn"); return; }
    if (!testChecked) { toast("今回の答案とテストの正答・配点が一致することを確認してください", "warn"); return; }
    if (!files.length) { toast("答案画像を追加してください", "warn"); return; }
    if (files.some((f) => !f.studentId)) { toast("生徒が割り当てられていない答案があります。一覧で生徒を選んでください", "warn"); return; }
    if (!demo && !checked) {toast("生徒・ページ順・画質を確認し、確認済みにチェックしてください", "warn");return;}
    if (tooManyPages) { toast(`1人分の答案は${MAX_PAGES}枚までです。一覧で生徒の割り当てを直してください`, "warn"); return; }

    if (mode === "ai") askNotifyPermission();
    setSavedCount(0); setSaveErrors(0); setGradeErrors(0); setAiProgress(null);
    setStartedAt(Date.now()); setElapsed(0); setCurrentWork("答案を保存しています");
    setStage("run"); setStep(0); setLog([]); setCreatedIds([]); setFailed(0);
    timers.current.forEach(clearTimeout); timers.current = [];
    const addLog = (t: string, m: string) => setLog((prev) => [...prev, { t, m }]);

    // 見た目の進行（各ステップの説明）。保存処理と並行して進める。
    const animation = new Promise<void>((resolve) => {
      if (!grading) { resolve(); return; }
      const lines: [string, string][] = [
        ["quality", `${files.length} 枚（${groups.length} 名分）の画質を確認`],
        ["quality", demoIssue ? "1 枚でぼやけと影を検出。再撮影の候補として記録しました" : "全ページが採点可能な品質です"],
        ["test", `${test.subject}「${test.name}」${test.grade}年 ${test.term} / 試験番号 ${test.testNo} を抽出`],
        ["test", `問題数 ${test.questions.length} 問・満点 ${test.maxScore} 点・単元 ${test.units.length} 種を確定`],
        ["student", `${klass.label} の出席番号を割り当て、匿名IDで管理します（実名は保存しません）`],
        ["answer", demo ? "手書き文字・計算式・選択肢・記述を認識（デモ）" : "仮採点：解答は読み取っていません（点数は答案と無関係です）"],
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

    // ver6：1人分ずつ「保存 → AI採点」を流れ作業にし、同時に N 人分ずつ進める（ver5 は全員を保存してから1人ずつ採点）
    const concurrency = mode === "ai" ? Math.max(1, ai.concurrency ?? 8) : 4;
    const ids: (string | null)[] = new Array(groups.length).fill(null);
    let ng = 0, aiNg = 0, aiDone = 0;
    if (mode === "ai") { setAiProgress({ done: 0, total: groups.length }); addLog("AI採点", `採点方式：${MODE_LABEL[gradingMode]}・${concurrency} 人分ずつ同時に処理します`); }
    const pipeline = runPool(groups, concurrency, async (group, i) => {
      const f = group[0];
      const name = who(f.studentId);
      let id: string;
      try {
        setCurrentWork(`${name}：答案画像を保存中`);
        id = await ds.saveGrading(buildInput(group, i), group.flatMap((g) => (g.file ? [g.file] : [])));
        ids[i] = id; setSavedCount((c) => c + 1);
        const what = group.length > 1 ? `${group.length} 枚（${group.map((g) => g.name).join("・")}）` : f.name;
        if (!grading) addLog("保存", `${name}：${what} を保存しました`);
      } catch (e) {
        ng++; setSaveErrors(ng);
        addLog("エラー", `${name}：${friendlyError(e, "保存")}`);
        if (mode === "ai") setAiProgress((p) => (p ? { ...p, total: p.total - 1 } : p));
        return;
      }
      if (mode !== "ai") return;
      setCurrentWork(`${name}：${gradingMode === "cascade" ? "Haiku" : "Opus"}で採点中`);
      // 混み合い（API の利用上限）のときは、少し待ってから同じ答案をやり直す
      const r = await withBusyRetry(async () => {
        const x = await aiGradeSub(id, {
          silent: true,
          onProgress: (p) => { addLog("AI採点", `${name}：${STAGE_LABEL[p.stage]}の結果に確認が必要な点があるため、${p.next ? STAGE_LABEL[p.next] : "次のモデル"}で採点し直します（${(p.reasons ?? []).slice(0, 3).join("／")}${(p.reasons?.length ?? 0) > 3 ? " ほか" : ""}）`); },
        });
        if (!x.ok && /混み合って/.test(x.error)) throw new Error(x.error);
        return x;
      }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
      if (r.ok) {
        const where = r.summary.mode === "cascade" && r.summary.finalStage ? `・${STAGE_LABEL[r.summary.finalStage]}で確定` : "";
        addLog("AI採点", r.summary.queued ? `${name}：採点予約を受け付けました。結果は採点履歴で確認してください` : r.summary.blank
          ? `${name}：全問白紙でした`
          : `${name}：${r.summary.total}点${where}${r.summary.needReview ? `（要確認 ${r.summary.needReview} 問）` : ""}`);
      } else {
        aiNg++; setGradeErrors(aiNg);
        addLog("エラー", `${name}：${r.error}（画像は保存済みです。「採点中」の画面から採点し直せます）`);
      }
      aiDone++;
      setAiProgress((p) => (p ? { ...p, done: aiDone } : p));
    });
    await Promise.all([animation, pipeline]);
    await refresh();
    setCreatedIds(ids.filter((x): x is string => !!x));
    notifyDone(mode === "ai" ? `${aiDone - aiNg} 人分のAI採点が終わりました${aiNg ? `（${aiNg} 人分は失敗）` : ""}` : `${groups.length - ng} 人分の答案を保存しました`);

    setCurrentWork(ng || aiNg ? "処理終了：失敗した答案は処理ログを確認してください" : "処理が完了しました");
    setFailed(ng);
    setStep(PIPELINE.length);
    setStage("done");
    if (ng) toast(`${ng} 名分を保存できませんでした。処理ログを確認して、もう一度取り込んでください`, "ng");
    else if (aiNg) toast(`${aiNg} 名分をAI採点できませんでした。処理ログを確認してください（画像は保存済みです）`, "ng");
    else if (mode === "ai") toast(`${aiDone} 人分のAI採点が終わりました。返却前に結果を確認してください`);
    else toast(grading ? `${groups.length} 人分の採点が完了しました` : `${groups.length} 人分の答案を保存しました。あとで「採点中」の画面からAI採点できます`);
  };

  const reset = () => {
    timers.current.forEach(clearTimeout);
    setTestId(""); setTestChecked(false); setTestAuto(""); setPrintedTitles([]); setCountdown(null); setAutoStartOff(false); setTestSetup(null); setSetupOpen(false); setStage("select"); setFiles([]); setStep(-1); setLog([]); setCreatedIds([]); setFailed(0); setAiProgress(null);
  };

  /* ------------------------------------------------ 前提（テスト・クラス） */
  if (!ws.classes.length) return <Card><Empty icon="📝" title="クラスがまだ登録されていません" hint="管理者にクラスと生徒の登録を依頼してください。" /></Card>;

  /* ------------------------------------------------------------- 実行中・完了 */
  if (stage === "run" || stage === "done") {
    const created = createdIds.map((id) => subs.find((s) => s.id === id)).filter(Boolean) as Submission[];
    return (
      <div>
        <Section title={stage === "done"
            ? (saveErrors || gradeErrors ? "処理終了（一部失敗）" : mode === "upload" ? "答案を保存しました" : "採点が完了しました")
            : mode === "ai" ? (aiProgress ? "AIが採点しています" : "答案を保存しています")
            : grading ? "AIエージェントが処理中です" : "答案を保存しています"}
          right={stage === "done" ? <Btn size="sm" onClick={reset}>続けて取り込む</Btn> : null}>
          {!grading && <Card title="採点の進捗" style={{ marginBottom: 16 }}>
            <p role="status">{currentWork}</p>
            <p>経過時間 {Math.floor(elapsed / 60)}分{elapsed % 60}秒 ／ 全{groups.length}人分・{files.length}ページ</p>
            <div>① 答案保存：{savedCount} / {groups.length}人　失敗 {saveErrors}人</div>
            <div role="progressbar" aria-label="答案保存の進捗" aria-valuemin={0} aria-valuemax={groups.length} aria-valuenow={savedCount + saveErrors}>
              <Bar value={savedCount + saveErrors} max={groups.length} tone="accent" />
            </div>
            {mode === "ai" && <>
              <p>② AI採点：成功 {(aiProgress?.done ?? 0) - gradeErrors}人 ／ 失敗 {gradeErrors}人 ／ 保存済み {savedCount}人</p>
              <div role="progressbar" aria-label="AI採点の処理済み割合" aria-valuemin={0} aria-valuemax={savedCount || groups.length} aria-valuenow={aiProgress?.done ?? 0}
                style={{display:"flex",height:22,background:T.bgAlt,borderRadius:8,overflow:"hidden"}}>
                <div style={{width:`${((aiProgress?.done ?? 0)-gradeErrors)/Math.max(1,savedCount)*100}%`,background:T.ok}} />
                <div style={{width:`${gradeErrors/Math.max(1,savedCount)*100}%`,background:T.ng}} />
              </div>
              <p>緑：採点成功　赤：失敗　空白：処理中・待機中</p>
              {(() => {
                const done = aiProgress?.done ?? 0, total = aiProgress?.total ?? groups.length;
                if (!done || done >= total || stage === "done") return <small>{Math.max(1, ai.concurrency ?? 8)} 人分ずつ同時に採点しています。</small>;
                const left = Math.ceil(((elapsed / done) * (total - done)) / 60);
                return <small>{Math.max(1, ai.concurrency ?? 8)} 人分ずつ同時に採点しています。これまでの速さから、残りは約 {left} 分の見込みです（目安）。</small>;
              })()}
            </>}
          </Card>}
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
                    答案画像を学校専用の保管場所（非公開）に保存しながら、{Math.max(1, ai.concurrency ?? 8)} 人分ずつ同時に AI が採点しています。
                    ほかの画面に移っても採点は続きます（終わると通知します）。ブラウザのタブを閉じると、残りの答案は「AI採点待ち」のまま残り、「採点中」の画面から再開できます。
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

        <p><a href="/batch-review" target="_blank" rel="noopener noreferrer">採点が終わった答案を別タブで確認する（この採点画面は開いたままにしてください）</a></p>
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
  // 取り込み方法：カメラ・ファイル・PDF（複合機のスキャンは PDF に保存してから「PDF一括」で取り込む）
  // ver6：生徒のタブレット・スマホから（QRコードで生徒が自分で提出する）
  const options: { k: Source; icon: string; t: string; d: string }[] = [
    { k: "camera", icon: "📷", t: "カメラで撮影", d: demo ? "撮影ガイド枠つき（教師用）" : "スマートフォン・タブレットのカメラで撮る" },
    { k: "file", icon: "💻", t: "PCから選択", d: "JPEG / PNG / HEIC / PDF" },
    { k: "pdf", icon: "📄", t: "PDF一括", d: demo ? "1ファイルに複数枚を格納" : "PDFファイルを選ぶ（1ファイル＝1人分。複合機のスキャンもここから）" },
    { k: "mobile", icon: "📱", t: "生徒のタブレット・スマホから", d: "QRコードを映すと、生徒が自分の端末で撮って提出します。届いた答案はそのままAI採点できます" },
  ];
  const pick = (k: Source) => {
    if (k === "mobile") { setMobileOpen(true); return; }
    if (demo && k !== "file") { addDemoFiles(k === "camera" ? 5 : 10, k); return; }
    setSource(k);
    if (k === "camera") cameraRef.current?.click();
    else inputRef.current?.click();
  };

  return (
    <div>
      <Card style={{border:`2px solid ${T.accent}`, marginBottom:16}}>
        <h2 style={{marginTop:0}}>● 採点はまだ始まっていません</h2>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {["答案を入れる", "生徒・ページを確認", "正答・配点を準備", "確認して採点開始"].map((label,i) => <button key={label} onClick={() => jumpTo(i+1)}
            aria-current={nextStep === i+1 ? "step" : undefined}
            style={{padding:12,borderRadius:10,cursor:"pointer",border:`2px solid ${nextStep === i+1 ? T.accent : T.line}`,background:nextStep === i+1 ? T.accentSoft : T.panel,color:nextStep === i+1 ? T.accent : T.text}}>
            {nextStep === i+1 ? "● 今ここ " : ""}{i+1}. {label}
          </button>)}
        </div>
        <p style={{fontWeight:700,color:T.accent}}>次にすること：{nextStep === 1 ? "答案写真を選んでください" : nextStep === 2 ? "同じ生徒の全ページと順番を確認し、チェックしてください" : nextStep === 3 ? "新しいテストを作成するか、正答・配点がそろった既存テストを選んでください" : "正答・配点を確認し、採点開始ボタンを押してください"}</p>
        <Btn variant="shu" onClick={() => jumpTo(nextStep)}>➜ 手順{nextStep}へ移動する</Btn>
      </Card>
      {!demo && (
        <Card style={{ marginBottom: 16, border: `1px solid ${omakaseOn ? T.ok : T.line}` }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", flex: "1 1 280px", cursor: "pointer" }}>
              <input type="checkbox" checked={omakase} onChange={(e) => setOmakase(e.target.checked)} style={{ marginTop: 4 }} />
              <span>
                <b style={{ color: T.text }}>おまかせモード</b>
                <span style={{ display: "block", fontSize: 12, color: T.textSub, lineHeight: 1.7 }}>
                  答案を入れると、AI が受験番号・テスト名を読んで生徒・クラス・テストを自動で決め、問題がなければ確認のチェックも自動で付けます。
                  {ai.enabled ? "" : "（採点AIが設定されていないため、自動振り分けは使えません）"}
                </span>
              </span>
            </label>
            {omakase && (
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", flex: "1 1 220px", cursor: "pointer" }}>
                <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} style={{ marginTop: 4 }} />
                <span style={{ fontSize: 12.5, color: T.text }}>準備がそろったら、5秒後に自動で採点を始める</span>
              </label>
            )}
          </div>
          {omakaseOn && files.length > 0 && (
            <div role="status" style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.8 }}>
              {scanBusy ? <span style={{ color: T.info }}>● AI が答案の受験番号・テスト名を読み取っています…</span>
                : check.ok ? <span style={{ color: T.ok, fontWeight: 700 }}>✓ 自動確認：{groups.length} 人分の生徒の割り当て・ページ順に問題はありません</span>
                : <span style={{ color: T.warn, fontWeight: 700 }}>● 確認が必要な答案が {check.problems.length} 枚あります（一覧の上に表示しています）</span>}
              {test && testAuto === "matched" && <div style={{ color: T.ok }}>✓ 答案に印刷されたテスト名から「{test.name}」を選びました</div>}
            </div>
          )}
          {countdown !== null && (
            <div role="alert" style={{ marginTop: 10, padding: 10, borderRadius: 10, background: T.accentSoft, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <b style={{ color: T.accent }}>準備がそろいました。{countdown} 秒後に採点を始めます</b>
              <Btn size="sm" onClick={() => { setAutoStartOff(true); setCountdown(null); }}>取り消す</Btn>
              <Btn size="sm" variant="shu" onClick={() => { setAutoStartOff(true); setCountdown(null); run(); }}>今すぐ始める</Btn>
            </div>
          )}
        </Card>
      )}
      <div id="grading-step-1" style={{scrollMarginTop:110}} />
      <Section title="1. 答案の取り込み方法を選ぶ">
        <div style={grid(180)}>
          {options.map((o) => (
            <button key={o.k} onClick={() => pick(o.k)}
              style={{
                textAlign: "start", background: source === o.k ? T.accentSoft : T.panel,
                border: `1px solid ${source === o.k ? T.accent : T.line}`, borderRadius: 13, padding: 14,
                cursor: "pointer", font: "inherit", position: "relative",
              }}>
              <div style={{ fontSize: 21, marginBottom: 6 }}>{o.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{o.t}</div>
              <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 4, lineHeight: 1.6 }}>{o.d}</div>
            </button>
          ))}
        </div>
        <input ref={inputRef} type="file" multiple accept={source === "pdf" ? "application/pdf" : ACCEPT}
          style={{ display: "none" }} onChange={(e) => { onPickFiles(e.target.files, source === "pdf" ? "pdf" : "file"); e.target.value = ""; }} />
        <StudentSubmitPanel open={mobileOpen} onClose={() => { setMobileOpen(false); refresh(); }} testId={testId} classId={classId} />
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
          JPEG / PNG / HEIC（iPhone の写真）/ PDF に対応。HEIC は自動で JPEG に変換します。1ファイル20MBまで、一度に最大{MAX_FILES}枚まで（100枚以上もまとめて入れられます）。
        </div>
        <div style={{ marginTop: 11, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <Btn size="sm" onClick={() => { setSource("file"); inputRef.current?.click(); }}>ファイルを選ぶ</Btn>
          {demo && <Btn size="sm" variant="soft" onClick={() => addDemoFiles(9, "camera")}>デモ答案を9枚入れる</Btn>}
        </div>
      </div>

      <div id="grading-step-2" style={{scrollMarginTop:110}} />
      <Section title={`2. 取り込んだ答案（${files.length} / ${MAX_FILES} 枚）`}
        right={files.length ? <Btn size="sm" variant="ghost" onClick={() => setFiles([])}>すべて外す</Btn> : null}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          {!demo && <Btn disabled={scanBusy || preparing || !files.length} onClick={() => scanPages()}>{scanBusy ? "読み取り中…" : "問題番号・受験番号から自動振り分け（AI使用）"}</Btn>}
          {check.problems.length > 0 && files.length > 1 && (
            <label style={{ fontSize: 12, color: T.textSub, display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> 確認が必要な答案だけ表示（{check.problems.length} 枚）
            </label>
          )}
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
              {files.map((f, idx) => ({ f, idx })).filter(({ idx }) => !onlyProblems || problemIdx.has(idx))
                .sort((x, y) => Number(problemIdx.has(y.idx)) - Number(problemIdx.has(x.idx)) || x.idx - y.idx).map(({ f, idx }) => (
                <div key={f.id} style={{ border: `${problemIdx.has(idx) ? 2 : 1}px solid ${problemIdx.has(idx) ? T.warn : T.line}`, borderRadius: 10, padding: 9, background: T.panelAlt, position: "relative" }}>
                  <div style={{ height: 114, borderRadius: 7, background: T.bgAlt, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, marginBottom: 7 }}>
                    <FileThumbnail file={f.file} />
                  </div>
                  <div style={{ fontSize: 11, color: T.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                  <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: 2, marginBottom: 6, display: "flex", gap: 6, alignItems: "center" }}>
                    {f.kb.toLocaleString()} KB
                    {pageOf(f) && <Badge tone="info">{pageOf(f)!.n} / {pageOf(f)!.of} ページ</Badge>}
                  </div>
                  {f.assignedBy === "ai" && !problemIdx.has(idx) && <div style={{ color: T.ok, fontSize: 11.5 }}>✓ 受験番号で照合</div>}
                  {check.problems.find((x) => x.index === idx)?.reasons.filter((r) => !(f.warnings ?? []).includes(r)).map((r, i) => <div key={`p${i}`} style={{ color: T.warn, fontSize: 12 }}>{r}</div>)}
                  {f.warnings?.map((w,i)=><div key={i} style={{color:T.warn,fontSize:12}}>{w}</div>)}
                  <div><Btn size="sm" disabled={files.indexOf(f)===0} onClick={()=>{setChecked(false);setFiles(p=>{const a=[...p],i=a.findIndex(x=>x.id===f.id);[a[i-1],a[i]]=[a[i],a[i-1]];return a})}}>前へ</Btn><Btn size="sm" disabled={files.indexOf(f)===files.length-1} onClick={()=>{setChecked(false);setFiles(p=>{const a=[...p],i=a.findIndex(x=>x.id===f.id);[a[i+1],a[i]]=[a[i],a[i+1]];return a})}}>後へ</Btn></div>
                  <Select value={f.studentId} style={{ padding: "5px 7px", fontSize: 11.5 }}
                    onChange={(v: string) => {setChecked(false);setFiles((p) => p.map((x) => (x.id === f.id ? { ...x, studentId: v, assignedBy: v ? "teacher" : "order", warnings: (x.warnings ?? []).filter((w) => !/名簿と照合|生徒を選んで|続きと推定/.test(w)) } : x)));}}
                    options={[{ value: "", label: "生徒を選ぶ" }, ...roster.map((s) => ({ value: s.id, label: who(s.id) }))]} />
                  <button onClick={() => {setChecked(false);setFiles((p) => p.filter((x) => x.id !== f.id));}} aria-label="この答案を外す"
                    style={{ position: "absolute", top: 5, insetInlineEnd: 5, border: "none", background: "transparent", color: T.textFaint, cursor: "pointer", fontSize: 13 }}>✕</button>
                </div>
              ))}
            </div>
          </Card>
        )}
      </Section>

      {files.length>0 && <Card>
        <p>名簿照合：未割当 {files.filter(f=>!f.studentId).length}枚 ／ 今回の取り込みにない生徒 {roster.filter(s=>!files.some(f=>f.studentId===s.id)).map(s=>s.number+"番").join("・") || "なし"}</p>
        <p>{autoAssign ? "自動振り分けは候補です。" : ""}画像の四隅・解答欄・薄い作図線、生徒の割り当てとページ順を確認してください。</p>
        <label><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)} /> 生徒・ページ順・不足や見切れがないことを確認しました</label>
      </Card>}
      <div id="grading-step-3" style={{scrollMarginTop:110}} />
      <Section title="3. 模範解答・配点を準備する">
        <Card>
          {missingAnswers.length > 0 && <p role="alert" style={{color:T.ng,fontWeight:700}}>● 正答・採点条件が未入力の設問が{missingAnswers.length}問あります。このテストでは採点を開始できません。下のボタンから問題が読める資料や模範解答を使って作成してください。</p>}
          <p>新しいテストはここで作成できます。答案の取り込み直しや、テスト管理への移動は不要です。</p>
          <Field label="模範解答・配点の作成に使う1人分の答案（全ページ）">
            <Select value={(groups.some(g => g[0].studentId === referenceStudent) ? referenceStudent : groups[0]?.[0].studentId) || ""} onChange={setReferenceStudent}
              options={groups.map(g => ({ value: g[0].studentId, label: `${who(g[0].studentId)}（${g.length}ページ）` }))} />
          </Field>
          <Btn variant="primary" disabled={preparing || scanBusy || !groups.length || (!demo && !checked)} onClick={() => {
            if (testSetup) { setSetupOpen(true); return; }
            const group = groups.find(g => g[0].studentId === (groups.some(g => g[0].studentId === referenceStudent) ? referenceStudent : groups[0]?.[0].studentId));
            const picked = group?.flatMap(f => f.file ? [f.file] : []) ?? [];
            if (!picked.length) { toast("実際の答案画像を選んでください", "warn"); return; }
            setTestSetup({ files: picked, key: "new-grading-test" }); setSetupOpen(true);
          }}>{testSetup ? "作成中の模範解答・配点を開く" : "この答案から、模範解答を作る"}</Btn>
          {!checked && <p>先に上の「生徒・ページ順・不足や見切れがないことを確認しました」にチェックしてください。</p>}
        </Card>
        {testSetup && <NewTestForm open={setupOpen} initialFiles={testSetup.files} draftKey={testSetup.key}
          onClose={() => setSetupOpen(false)} onCreated={id => { setTestId(id); setTestChecked(false); setTestAuto("created"); setTestSetup(null); }} />}
      </Section>
      <div id="grading-step-4" style={{scrollMarginTop:110}} />
      <Section title="4. テストを確認して採点する">
        <Card>
          <div style={grid(220, 14)}>
            <Field label="対象のテスト">
              <Select value={testId} onChange={id => { setTestId(id); setTestChecked(false); setTestAuto(""); }}
                options={[{ value: "", label: "今回のテストを選択（自動選択しません）" }, ...activeTests.map((t) => ({ value: t.id, label: `${t.subject}／${t.name}（${t.questions.length}問・${t.maxScore}点）` }))]} />
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

          {test && <div style={{margin: "12px 0"}}>
            <details><summary>「{test.name}」の正答・配点を確認（{test.questions.length}問・満点{test.maxScore}点）</summary>
              {test.questions.map(q => <p key={q.id}>{q.label || `問${q.no}`}：{q.correct || q.model || "【未入力：採点できません】"} ／ {q.points}点</p>)}
            </details>
            <label><input type="checkbox" disabled={missingAnswers.length > 0} checked={testChecked} onChange={e => setTestChecked(e.target.checked)} /> 今回の答案と、テスト名・設問・正答・配点が一致しています</label>
            {omakaseOn && testChecked && (titleMatches || testAuto === "created") && <div style={{ fontSize: 11.5, color: T.ok }}>{testAuto === "created" ? "✓ この画面で作成したテストのため、自動で確認済みにしました" : "✓ 答案に印刷されたテスト名と一致したため、自動で確認済みにしました"}</div>}
          </div>}
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
                複数の答案を同時に採点するので、40人分でも数分で終わります。結果は下書きなので、返却前に「要確認一覧」を確認してください。
              </div>
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 6 }}>採点方式</div>
                <GradingModePicker pages={Math.max(1, ...groups.map(g => g.length))} questions={test?.questions.length ?? 10} answers={Math.max(1, groups.length)} />
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

          <p role="status" style={{color:T.accent,fontWeight:700}}>{!files.length ? "● 手順1：答案写真を追加してください" : !checked ? "● 手順2：生徒・ページの確認がまだです" : !test || missingAnswers.length ? "● 手順3：正答・配点の準備がまだです" : !testChecked ? "● 手順4：正答・配点の確認にチェックしてください" : "● 準備完了：下の赤いボタンを押すと採点が始まります"}</p>
          {(nextStep < 4 || !testChecked) && <Btn variant="shu" onClick={() => jumpTo(nextStep)}>➜ 未完了の手順{nextStep}へ移動</Btn>}
          <div style={{ marginTop: 16, display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center" }}>
            <Btn variant="shu" size="lg" onClick={run} disabled={!files.length || preparing || !test || !testChecked || missingAnswers.length > 0 || (!demo && !checked)}>
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
