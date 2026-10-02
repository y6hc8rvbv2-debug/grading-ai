"use client";
// 採点結果の詳細（赤ペン画像・修正・分析・フィードバック）。docs/prototype-v3.jsx から移植。
// 修正は1問ずつ保存し、合計点と状態は DB のトリガーが計算した値を読み直して表示する。
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FONT_UI, FONT_MONO, FONT_HAND } from "@/lib/ui/theme";
import { download, fmtDateTime, toCSV } from "@/lib/util";
import { SOURCES, analyze, buildFeedback, buildModelAnswers } from "@/lib/grading/engine";
import { useUI } from "@/components/ui-context";
import { Badge, Bar, Btn, Card, Empty, Tabs, grid, inputStyle } from "@/components/ui";
import { RedPenSheet } from "@/components/RedPenSheet";
import { RedPenOverlay } from "@/components/RedPenOverlay";
import { RedPenPanel } from "@/components/RedPenPanel";
import { layoutMarks, type PageLayout, type Placed } from "@/lib/redpen/layout";
import { analyzePage, displayableUrl, type AnalyzedPage } from "@/lib/redpen/analyze";
import { printImages, saveBlob, svgToPng, toDataUrl } from "@/lib/redpen/export";
import { friendlyError } from "@/lib/errors";
import { GradingLogCard } from "@/components/GradingLogCard";
import { GradingModeSelect } from "@/components/GradingModePicker";
import { MODE_LABEL, STAGE_LABEL } from "@/lib/grading/cost";
import type { Item, MarkPos, Submission } from "@/lib/types";

/** 得点の入力欄。入力中は保存せず、確定（フォーカスが外れる・Enter）したときに保存する。 */
function EarnedInput({ item, onCommit }: { item: Item; onCommit: (v: number) => void }) {
  const { T } = useUI();
  const [v, setV] = useState(String(item.earned));
  useEffect(() => setV(String(item.earned)), [item.earned]);
  const commit = () => {
    const n = Number(v);
    if (v === "" || Number.isNaN(n)) { setV(String(item.earned)); return; }
    if (n !== item.earned) onCommit(n);
  };
  return (
    <input type="number" min={0} max={item.points} value={v} aria-label={`${item.label} の得点`}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      style={{ ...inputStyle(T), width: 62, padding: "6px 8px", textAlign: "center", font: `700 13px ${FONT_MONO}` }} />
  );
}

export default function GradingDetail({ subId }: { subId: string }) {
  const { T, go, subs, toast, who, ds, testById, studentById, classById, editItem, reviewSub, refreshSub, ai, aiGradeSub } = useUI();
  const sub = subs.find((s) => s.id === subId);
  const [tab, setTab] = useState("sheet");
  const [lookup, setLookup] = useState<"idle" | "loading" | "missing">("idle");
  // 原本画像（ページごと）と、表示中の原本のページ（0 始まり）
  const [imageUrls, setImageUrls] = useState<(string | null)[]>([]);
  const [origPage, setOrigPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [sheetMode, setSheetMode] = useState<"overlay" | "clean">("overlay");
  const [page, setPage] = useState(0);
  const [showMarks, setShowMarks] = useState(true);
  const [showComments, setShowComments] = useState(true);
  const [editing, setEditing] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // 原本の赤ペン：各ページの縦横比と罫線、先生が動かした位置、選んでいる設問
  const [pagesInfo, setPagesInfo] = useState<{ key: string; pages: AnalyzedPage[] } | null>(null);
  const [saved, setSaved] = useState<MarkPos[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [wide, setWide] = useState(true);
  const sheetRef = useRef<HTMLDivElement>(null);
  const saveTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  // 画像の保存・印刷：画面と同じ部品で、原本を埋め込んだ SVG を画面の外に描いてから画像にする
  const [exportJob, setExportJob] = useState<{ kind: "png" | "print"; pages: number[]; hrefs: string[] } | null>(null);
  const exportRefs = useRef<(SVGSVGElement | null)[]>([]);

  const test = sub ? testById(sub.testId) : undefined;
  const st = sub ? studentById(sub.studentId) : undefined;
  const kl = sub ? classById(sub.classId) : undefined;
  const ana = useMemo(() => (sub && test ? analyze(test, sub.result) : null), [test, sub]);
  const fb = useMemo(() => (sub && test && ana ? buildFeedback(test, sub.result, ana) : null), [test, sub, ana]);
  const modelAns = useMemo(() => (test ? buildModelAnswers(test) : []), [test]);

  // 直近200件に入っていない古い答案は、個別に読み込む
  useEffect(() => {
    if (sub || lookup !== "idle") return;
    setLookup("loading");
    // 見つかれば subs に入り、この画面は答案を表示する。見つからなければ「見つかりません」を出す。
    refreshSub(subId).finally(() => setLookup("missing"));
  }, [sub, subId, lookup, refreshSub]);

  // 原本画像（非公開の保管場所から、10分だけ有効な署名付きURLで表示する）
  // 複数ページの答案（1人分を複数枚で撮った場合）は、すべてのページの URL を用意する
  const pathKey = (sub?.imagePaths ?? []).join("|");
  useEffect(() => {
    const paths = pathKey ? pathKey.split("|") : [];
    if (!paths.length) { setImageUrls([]); return; }
    let alive = true;
    // HEIC のまま保存された以前の答案は、ブラウザで表示できる JPEG にしてから使う
    Promise.all(paths.map((p) => ds.signedImageUrl(p).then((u) => (u ? displayableUrl(p, u) : null)).catch(() => null)))
      .then((urls) => { if (alive) setImageUrls(urls.map((u) => u || null)); });
    return () => { alive = false; };
  }, [ds, pathKey]);
  const imageUrl = imageUrls[origPage] ?? null;
  const origPages = imageUrls.length;

  // 各ページの原本を調べる（縦横比・解答欄の罫線）。手元の計算だけで、採点AIは呼ばない
  const urlKey = imageUrls.map((u) => u ?? "").join("|");
  useEffect(() => {
    const urls = urlKey ? urlKey.split("|") : [];
    if (!urls.length) { setPagesInfo(null); return; }
    let alive = true;
    Promise.all(urls.map((u) => (u ? analyzePage(u) : Promise.resolve({ aspect: 1.414, frames: null, analyzed: false }))))
      .then((pages) => { if (alive) setPagesInfo({ key: urlKey, pages }); });
    return () => { alive = false; };
  }, [urlKey]);

  // 先生が動かした赤ペンの位置
  useEffect(() => {
    let alive = true;
    ds.loadMarkPositions(subId).then((p) => { if (alive) setSaved(p); }).catch(() => {});
    return () => { alive = false; };
  }, [ds, subId]);

  // 広い画面は原本の右にコメント欄、狭い画面は下に並べる
  useEffect(() => {
    const el = sheetRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => setWide((entries[0]?.contentRect.width ?? 0) >= 860));
    ro.observe(el);
    return () => ro.disconnect();
  });

  // 赤ペンの置き場所（全ページ）。画面・画像の保存・印刷で同じものを使う
  const layouts: PageLayout[] | null = useMemo(() => {
    if (!sub || !test || !pagesInfo || pagesInfo.key !== urlKey) return null;
    const qByNo = new Map(test.questions.map((q) => [q.no, q]));
    return layoutMarks(sub.result.items.map((i) => ({
      qno: i.qno, big: qByNo.get(i.qno)?.big ?? i.qno, graph: i.type === "graph", bbox: i.bbox ?? null,
    })), pagesInfo.pages, saved);
  }, [sub, test, pagesInfo, urlKey, saved]);

  // 画面の外に描いた SVG を画像にして、保存または印刷する
  useEffect(() => {
    if (!exportJob) return;
    let alive = true;
    const run = async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      try {
        const blobs: Blob[] = [];
        for (let i = 0; i < exportJob.pages.length; i++) {
          const node = exportRefs.current[i];
          if (!node) throw new Error("赤ペン画像を作れませんでした");
          blobs.push(await svgToPng(node));
        }
        if (!alive) return;
        const name = `redpen_${test?.subject ?? ""}_${sub ? who(sub.studentId) : ""}`.replace(/[\\/:*?"<>|\s]+/g, "_");
        if (exportJob.kind === "png") {
          saveBlob(`${name}_p${exportJob.pages[0]}.png`, blobs[0]);
          toast("赤ペンを重ねた原本を画像で保存しました");
        } else {
          await printImages(blobs, name);
        }
      } catch (e) {
        toast(friendlyError(e, "赤ペン画像の作成"), "ng");
      } finally {
        if (alive) setExportJob(null);
      }
    };
    run();
    return () => { alive = false; };
  }, [exportJob, sub, test, who, toast]);

  if (!sub || !test || !st || !kl || !ana || !fb) {
    if (!sub && lookup !== "missing") {
      return <Card><Empty icon="⏳" title="答案を読み込んでいます…" /></Card>;
    }
    return <Card><Empty icon="🔎" title="答案が見つかりません" hint="削除されたか、保存期間を過ぎて自動削除された可能性があります。" action={<Btn onClick={() => go("history")}>採点履歴に戻る</Btn>} /></Card>;
  }

  const reviewCount = sub.result.items.filter((i) => i.needReview).length;
  const pages = Math.ceil(sub.result.items.length / 7);
  const whoName = who(sub.studentId);
  const pending = sub.status === "uploaded" || sub.status === "processing";
  // 原本に赤ペンを重ねられるのは、採点AIが位置を返した答案（または先生が位置を決めた答案）
  const canOverlay = !!imageUrl && (sub.result.items.some((i) => i.bbox) || saved.length > 0);
  const overlayOn = canOverlay && sheetMode === "overlay" && showMarks;
  const pageLayout = layouts?.[origPage] ?? null;
  const aspect = pagesInfo?.key === urlKey ? pagesInfo.pages[origPage]?.aspect ?? 1.414 : 1.414;
  const analyzed = !!pagesInfo?.pages.every((p) => p.analyzed);

  // 赤ペンを動かす：画面はすぐ動かし、保存は少し待ってから（矢印キーで続けて動かしても1回にまとめる）
  const moveMark = (qno: number, page: number, x: number, y: number) => {
    const pos: MarkPos = { qno, page, x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 };
    setSaved((prev) => [...prev.filter((p) => p.qno !== qno), pos]);
    clearTimeout(saveTimers.current.get(qno));
    saveTimers.current.set(qno, setTimeout(() => {
      ds.saveMarkPosition(sub.id, pos).catch((e) => {
        toast(friendlyError(e, "赤ペンの位置の保存"), "ng");
        ds.loadMarkPositions(sub.id).then(setSaved).catch(() => {});
      });
    }, 350));
  };
  const confirmMark = (p: Placed) => { moveMark(p.qno, p.page, p.cx, p.cy); toast("この位置で確定しました"); };
  const resetMark = async (qno: number) => {
    clearTimeout(saveTimers.current.get(qno));
    try {
      await ds.resetMarkPosition(sub.id, qno);
      setSaved((prev) => prev.filter((p) => p.qno !== qno));
      toast("赤ペンの位置を元に戻しました");
    } catch (e) {
      toast(friendlyError(e, "赤ペンの位置を元に戻す処理"), "ng");
    }
  };
  const selectMark = (qno: number, page: number) => { setSelected(qno); setOrigPage(page - 1); };

  const startExport = async (kind: "png" | "print") => {
    if (!layouts) { toast("原本を調べています。少し待ってからもう一度押してください", "warn"); return; }
    const pages = kind === "png" ? [origPage + 1] : imageUrls.map((_, i) => i + 1);
    try {
      const hrefs = await Promise.all(pages.map((p) => toDataUrl(imageUrls[p - 1] ?? "")));
      setExportJob({ kind, pages, hrefs });
    } catch (e) {
      toast(friendlyError(e, "原本の読み込み"), "ng");
    }
  };
  const canAi = ai.enabled && sub.imagePaths.length > 0;

  const runAi = async (regrade: boolean) => {
    if (regrade && !window.confirm("AIで採点し直すと、先生が修正した判定・得点・コメントと「確認済み」の記録は上書きされます。採点し直しますか？")) return;
    setAiBusy(true);
    await aiGradeSub(sub.id);
    setAiBusy(false);
  };

  const applyEdit = (it: Item, patch: Parameters<typeof editItem>[2]) => editItem(sub.id, it, patch);

  const exportSVG = () => {
    if (overlayOn) { startExport("png"); return; }
    const node = svgRef.current;
    if (!node) { toast("赤ペン画像タブを開いてから書き出してください", "warn"); return; }
    const xml = new XMLSerializer().serializeToString(node);
    download(`redpen_${test.subject}_${st.anonId}_p${page + 1}.svg`, xml, "image/svg+xml;charset=utf-8");
    toast("赤ペン採点画像を書き出しました");
  };

  const exportRow = () => {
    const csv = toCSV(sub.result.items, [
      { label: "設問", get: (r) => r.label }, { label: "単元", key: "unit" }, { label: "形式", key: "typeLabel" },
      { label: "配点", key: "points" }, { label: "得点", key: "earned" }, { label: "判定", key: "mark" },
      { label: "認識信頼度", get: (r) => `${Math.round(r.confidence * 100)}%` },
      { label: "誤答傾向", key: "reason" }, { label: "コメント", key: "comment" },
    ]);
    download(`saiten_${test.subject}_${st.anonId}.csv`, csv, "text/csv;charset=utf-8");
    toast("設問別の採点結果をCSVで書き出しました");
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <Btn size="sm" variant="ghost" onClick={() => go("history")}>← 採点履歴</Btn>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ font: `700 17px ${FONT_UI}`, color: T.text }}>{test.subject}／{test.name}</div>
          <div style={{ fontSize: 12, color: T.textSub, marginTop: 3 }}>
            {whoName}・受験番号 {st.examNo}・{fmtDateTime(sub.uploadedAt)} 取り込み（{SOURCES[sub.source]?.label ?? sub.source}）
          </div>
        </div>
        <div style={{ textAlign: "end" }}>
          <div style={{ font: `700 26px ${FONT_MONO}`, color: sub.status === "blank" ? T.warn : pending ? T.info : T.shu }}>
            {sub.status === "blank" ? "白紙" : pending ? "採点待ち" : `${sub.result.total}`}
            {sub.status !== "blank" && !pending && <span style={{ fontSize: 14, color: T.textSub }}>/{test.maxScore}</span>}
          </div>
          {sub.status !== "blank" && !pending && <div style={{ fontSize: 11.5, color: T.textSub }}>得点率 {fb.rate}%</div>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
        {sub.edited && <Badge tone="accent">教師修正あり</Badge>}
        {sub.reviewedBy && <Badge tone="ok">確認済 {sub.reviewedBy}</Badge>}
        {reviewCount > 0 && <Badge tone="warn">要確認 {reviewCount} 問</Badge>}
        {!sub.quality.ok && <Badge tone="ng">画質に注意</Badge>}
        {pending && <Badge tone="info">AI採点待ち</Badge>}
        {sub.status === "blank" && <Badge tone="warn">全問白紙 → 模範解答を生成</Badge>}
        {sub.gradingMode && (
          <Badge tone="mute">採点方式：{MODE_LABEL[sub.gradingMode]}{sub.gradingMode === "cascade" && sub.gradingStage ? `（${STAGE_LABEL[sub.gradingStage]}で確定）` : ""}</Badge>
        )}
        <span style={{ flex: 1 }} />
        {canAi && <GradingModeSelect />}
        {canAi && !pending && (
          <Btn size="sm" disabled={aiBusy} onClick={() => runAi(true)}>{aiBusy ? "AIが採点しています…" : "AIで採点し直す"}</Btn>
        )}
        <Btn size="sm" onClick={exportRow}>CSV</Btn>
        <Btn size="sm" variant="soft" onClick={exportSVG} disabled={!!exportJob}>{exportJob?.kind === "png" ? "画像を作っています…" : "赤ペン画像を保存"}</Btn>
        {canOverlay && tab === "sheet" && overlayOn && (
          <Btn size="sm" onClick={() => startExport("print")} disabled={!!exportJob}>{exportJob?.kind === "print" ? "印刷の準備をしています…" : "印刷"}</Btn>
        )}
      </div>

      {pending ? (
        <Card title={aiBusy || sub.status === "processing" ? "AIが採点しています" : "この答案はまだ採点されていません"}
          sub={ai.enabled ? "答案画像・正答・配点・採点基準をもとに AI が採点します（数十秒かかります）" : "採点AIが設定されると、ここから採点できます"}
          right={canAi ? (
            <Btn variant="primary" disabled={aiBusy} onClick={() => runAi(false)}>
              {aiBusy ? "採点しています…" : sub.status === "processing" ? "AIで採点し直す" : "AIで採点する"}
            </Btn>
          ) : null}>
          {origPages > 1 && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <Btn size="sm" disabled={origPage === 0} onClick={() => setOrigPage((p) => Math.max(0, p - 1))}>◀</Btn>
              <span style={{ fontSize: 12, color: T.textSub, fontWeight: 700 }}>原本 {origPage + 1} / {origPages} ページ</span>
              <Btn size="sm" disabled={origPage >= origPages - 1} onClick={() => setOrigPage((p) => Math.min(origPages - 1, p + 1))}>▶</Btn>
            </div>
          )}
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt={`${whoName} の答案（原本）`} style={{ width: "100%", maxHeight: "72vh", objectFit: "contain", borderRadius: 8, background: T.bgAlt }} />
          ) : (
            <Empty icon="🖼" title={sub.imagePaths.length ? "原本画像を読み込んでいます…" : "原本画像がありません"}
              hint={sub.imagePaths.length ? "" : "デモ答案など、画像を伴わない取り込みです。"} />
          )}
        </Card>
      ) : (<>
      <Tabs value={tab} onChange={setTab} tabs={[
        { k: "sheet", label: "赤ペン採点画像" },
        { k: "items", label: "設問別採点", badge: reviewCount || null },
        { k: "quality", label: "画像品質" },
        { k: "analysis", label: "弱点分析" },
        { k: "feedback", label: "フィードバック" },
        ...(sub.status === "blank" ? [{ k: "model", label: "模範解答" }] : []),
        ...(ds.mode === "supabase" ? [{ k: "log", label: "AI採点の記録" }] : []),
      ]} />

      {tab === "sheet" && (
        <Card pad={0}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${T.line}`, flexWrap: "wrap", background: T.panelAlt }}>
            {(canOverlay && sheetMode === "overlay") || !showMarks ? (origPages > 1 && <>
              <Btn size="sm" disabled={origPage === 0} onClick={() => setOrigPage((p) => Math.max(0, p - 1))}>◀</Btn>
              <span style={{ fontSize: 12, color: T.textSub, fontWeight: 700 }}>原本 {origPage + 1} / {origPages} ページ</span>
              <Btn size="sm" disabled={origPage >= origPages - 1} onClick={() => setOrigPage((p) => Math.min(origPages - 1, p + 1))}>▶</Btn>
            </>) : <>
              <Btn size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>◀</Btn>
              <span style={{ fontSize: 12, color: T.textSub, fontWeight: 700 }}>ページ {page + 1} / {pages}</span>
              <Btn size="sm" disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}>▶</Btn>
            </>}
            <span style={{ flex: 1 }} />
            {canOverlay && showMarks && (
              <div role="group" aria-label="表示の種類" style={{ display: "flex", gap: 4 }}>
                <Btn size="sm" variant={sheetMode === "overlay" ? "primary" : "default"} onClick={() => setSheetMode("overlay")}>原本に赤ペン</Btn>
                <Btn size="sm" variant={sheetMode === "clean" ? "primary" : "default"} onClick={() => setSheetMode("clean")}>清書版</Btn>
              </div>
            )}
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: T.textSub, cursor: "pointer" }}>
              <input type="checkbox" checked={showMarks} onChange={(e) => setShowMarks(e.target.checked)} />赤ペンを重ねる
            </label>
            {!overlayOn && (
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: T.textSub, cursor: "pointer" }}>
                <input type="checkbox" checked={showComments} onChange={(e) => setShowComments(e.target.checked)} />コメントを表示
              </label>
            )}
          </div>
          <div ref={sheetRef} data-layout={overlayOn ? (wide ? "side" : "stack") : "full"} style={{
            padding: 14, background: T.bgAlt, display: "grid", gap: 14, alignItems: "start",
            gridTemplateColumns: overlayOn && wide ? "minmax(0, 1fr) minmax(260px, 340px)" : "minmax(0, 1fr)",
          }}>
            <div style={{ minWidth: 0 }}>
              {!showMarks && imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt={`${whoName} の答案（原本）`} style={{ width: "100%", maxHeight: "72vh", objectFit: "contain", borderRadius: 8 }} />
              ) : overlayOn ? (
                pageLayout ? (
                  <RedPenOverlay imageUrl={imageUrl!} sub={sub} test={test} page={origPage + 1} aspect={aspect} layout={pageLayout}
                    editable selected={selected} onSelect={(q) => setSelected(q)}
                    onMove={(q, x, y) => moveMark(q, origPage + 1, x, y)} svgRef={svgRef} />
                ) : (
                  <div style={{ padding: 40, textAlign: "center", color: T.textSub, fontSize: 13 }}>原本を読み込んで、解答欄の位置を調べています…</div>
                )
              ) : (
                <RedPenSheet test={test} sub={sub} page={page} showMarks={showMarks} showComments={showComments} svgRef={svgRef} />
              )}
            </div>
            {overlayOn && layouts && (
              <div style={wide ? { maxHeight: "80vh", overflow: "auto", paddingInlineEnd: 2 } : undefined}>
                <RedPenPanel sub={sub} layouts={layouts} selected={selected} onSelect={selectMark}
                  onConfirm={confirmMark} onReset={resetMark} analyzed={analyzed} currentPage={origPage + 1}
                  onMoveTo={(q, pg) => { moveMark(q, pg, 0.5, 0.5); setSelected(q); setOrigPage(pg - 1); toast(`${pg} ページ目の中央へ移しました。ドラッグで解答欄の右へ動かしてください`); }} />
              </div>
            )}
          </div>
          <div style={{ padding: "10px 14px", borderTop: `1px solid ${T.line}`, fontSize: 11.5, color: T.textFaint, lineHeight: 1.7 }}>
            {overlayOn
              ? "赤ペンは、原本の解答欄の枠（見つからないときは AI が読み取った位置）の右側に置いています。位置を動かしても採点AIは呼びません。"
              : "チェックを外すと元の答案（原本）だけを表示します。"}
            原本画像は保存期間のあいだ削除されません。
          </div>
          {/* 画像の保存・印刷用（画面の外に描く。原本を埋め込み、操作用の印は描かない） */}
          {exportJob && layouts && (
            <div aria-hidden style={{ position: "fixed", left: -20000, top: 0, width: 1000, pointerEvents: "none" }}>
              {exportJob.pages.map((pg, i) => layouts[pg - 1] && (
                <RedPenOverlay key={pg} imageUrl={exportJob.hrefs[i]} sub={sub} test={test} page={pg}
                  aspect={pagesInfo?.pages[pg - 1]?.aspect ?? 1.414} layout={layouts[pg - 1]} forExport
                  svgRef={(el) => { exportRefs.current[i] = el; }} />
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === "items" && (
        <Card title="設問別の採点結果" sub="判定・得点・コメントはその場で修正できます。修正は合計点と赤ペン画像に即時反映されます。">
          <div style={{ display: "grid", gap: 9 }}>
            {sub.result.items.map((it) => (
              <div key={it.qno} style={{
                border: `1px solid ${it.needReview ? T.warn : T.line}`, borderRadius: 12, padding: 12,
                background: it.needReview ? T.warnSoft : T.panelAlt,
              }}>
                <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ font: `700 13px ${FONT_UI}`, color: T.text }}>{it.label}</span>
                  <Badge tone="mute">{it.unit}</Badge>
                  <Badge tone="mute">{it.typeLabel}</Badge>
                  <Badge tone="mute">配点 {it.points}</Badge>
                  {it.needReview && <Badge tone="warn">要確認（信頼度 {Math.round(it.confidence * 100)}%）</Badge>}
                  <span style={{ flex: 1 }} />
                  <div style={{ display: "flex", gap: 4 }}>
                    {["○", "△", "×"].map((m) => (
                      <button key={m} onClick={() => applyEdit(it, { mark: m as Item["mark"] })} aria-label={`${it.label} を ${m} にする`} style={{
                        width: 34, height: 30, borderRadius: 8, cursor: "pointer",
                        border: `1px solid ${it.mark === m ? T.shu : T.lineStrong}`,
                        background: it.mark === m ? T.shu : T.panel,
                        color: it.mark === m ? "#fff" : T.textSub, font: `700 14px ${FONT_UI}`,
                      }}>{m}</button>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <EarnedInput item={it} onCommit={(v) => applyEdit(it, { earned: v })} />
                    <span style={{ fontSize: 12, color: T.textSub }}>点</span>
                  </div>
                </div>
                <div style={{ marginTop: 9, display: "grid", gap: 6, gridTemplateColumns: "minmax(0,1fr)" }}>
                  <div style={{ fontSize: 12.5, color: T.text, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 10px" }}>
                    <span style={{ color: T.textFaint, fontSize: 11, marginInlineEnd: 6 }}>認識した解答</span>
                    <span style={{ font: `14px ${FONT_HAND}` }}>{it.blank ? "（無記入）" : it.detected}</span>
                  </div>
                  {editing === it.qno ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <input defaultValue={it.comment} id={`cm_${it.qno}`} style={{ ...inputStyle(T), flex: 1 }} placeholder="赤ペンコメント" />
                      <Btn size="sm" variant="primary" onClick={async () => {
                        const el = document.getElementById(`cm_${it.qno}`) as HTMLInputElement | null;
                        const ok = await applyEdit(it, { comment: el ? el.value : it.comment });
                        setEditing(null);
                        if (ok) toast("コメントを更新しました");
                      }}>保存</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => setEditing(null)}>取消</Btn>
                    </div>
                  ) : (
                    <div onClick={() => setEditing(it.qno)} style={{
                      fontSize: 12.5, color: it.comment ? T.shu : T.textFaint, cursor: "pointer",
                      border: `1px dashed ${T.lineStrong}`, borderRadius: 8, padding: "8px 10px", font: `12.5px ${FONT_HAND}`,
                    }}>
                      {it.comment || "コメントを追加する（クリック）"}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ font: `700 15px ${FONT_MONO}`, color: T.text }}>合計 {sub.result.total} / {test.maxScore} 点</div>
            <span style={{ flex: 1 }} />
            <Btn variant="primary" disabled={busy} onClick={async () => {
              setBusy(true);
              const ok = await reviewSub(sub.id);
              setBusy(false);
              if (ok) toast("確認済みにしました。返却できます");
            }}>
              {busy ? "記録しています…" : "確認済みにする"}
            </Btn>
          </div>
        </Card>
      )}

      {tab === "log" && <GradingLogCard submissionId={sub.id} refreshKey={`${sub.gradingStage}|${sub.result.total}|${sub.status}`} />}

      {tab === "quality" && !Object.keys(sub.quality.scores).length && (
        <Card><Empty icon="🖼" title="画像品質の検査結果はありません" hint="画像品質の検査は、採点AIと一緒に行います。" /></Card>
      )}
      {tab === "quality" && !!Object.keys(sub.quality.scores).length && (
        <div style={grid(300, 14)}>
          <Card title="画像品質スコア" sub={`総合 ${sub.quality.avg} / 100`}>
            <div style={{ display: "grid", gap: 11 }}>
              {[
                ["tilt", "傾き・向き"], ["brightness", "明るさ"], ["blur", "ぼやけ"],
                ["shadow", "影・反射"], ["coverage", "見切れ（全体が写っているか）"], ["contrast", "コントラスト"],
              ].map(([k, label]) => {
                const v = sub.quality.scores[k];
                return (
                  <div key={k}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: T.textSub }}>{label}</span>
                      <span style={{ font: `700 12px ${FONT_MONO}`, color: v < 60 ? T.ng : v < 75 ? T.warn : T.ok }}>{v}</span>
                    </div>
                    <Bar value={v} tone={v < 60 ? "ng" : v < 75 ? "warn" : "ok"} height={7} />
                  </div>
                );
              })}
            </div>
          </Card>
          <Card title={sub.quality.ok ? "採点可能な品質です" : "再撮影・再スキャンの案内"} sub={sub.quality.ok ? "補正のみで処理しました" : "以下の点を直して取り込み直してください"}>
            {sub.quality.ok ? (
              <Empty icon="✅" title="問題は見つかりませんでした" hint="そのまま採点に進みました。" />
            ) : (
              <div style={{ display: "grid", gap: 9, marginBottom: 12 }}>
                {sub.quality.issues.map((is) => (
                  <div key={is.k} style={{ border: `1px solid ${T.ng}`, background: T.ngSoft, borderRadius: 10, padding: 11 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: T.ng, marginBottom: 3 }}>{is.k}</div>
                    <div style={{ fontSize: 12, color: T.text, lineHeight: 1.7 }}>{is.msg}</div>
                  </div>
                ))}
              </div>
            )}
            {sub.quality.fixes.length > 0 && <>
              <div style={{ fontSize: 11.5, color: T.textSub, marginBottom: 8, fontWeight: 700 }}>適用した自動補正</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {sub.quality.fixes.map((f) => <Badge key={f} tone="info">{f}</Badge>)}
              </div>
            </>}
            {!sub.quality.ok && (
              <div style={{ marginTop: 13 }}>
                <div style={{ fontSize: 11.5, color: T.textSub, lineHeight: 1.7, marginBottom: 8 }}>
                  撮り直した答案を「新規採点」で同じテスト・同じ生徒として取り込むと、この答案が置き換わります。
                </div>
                <Btn variant="shu" onClick={() => go("new")}>撮り直した答案を取り込む</Btn>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "analysis" && (
        <div>
          <div style={{ ...grid(300, 14), marginBottom: 14 }}>
            <Card title="単元別の定着度" sub="低い順に表示（優先して復習する単元）">
              <div style={{ display: "grid", gap: 11 }}>
                {ana.units.map((u) => (
                  <div key={u.unit}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: T.text, fontWeight: 600 }}>{u.unit}</span>
                      <span style={{ font: `700 12px ${FONT_MONO}`, color: u.rate < 50 ? T.ng : u.rate < 75 ? T.warn : T.ok }}>
                        {u.rate}% <span style={{ color: T.textFaint, fontWeight: 400 }}>({u.earned}/{u.points})</span>
                      </span>
                    </div>
                    <Bar value={u.rate} tone={u.rate < 50 ? "ng" : u.rate < 75 ? "warn" : "ok"} />
                  </div>
                ))}
              </div>
            </Card>
            <Card title="設問形式別の得点率" sub="解答の型が身についているかを見ます">
              <div style={{ display: "grid", gap: 11 }}>
                {ana.types.map((ty) => (
                  <div key={ty.type}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: T.text, fontWeight: 600 }}>{ty.type}（{ty.n}問）</span>
                      <span style={{ font: `700 12px ${FONT_MONO}`, color: ty.rate < 50 ? T.ng : ty.rate < 75 ? T.warn : T.ok }}>{ty.rate}%</span>
                    </div>
                    <Bar value={ty.rate} tone={ty.rate < 50 ? "ng" : ty.rate < 75 ? "warn" : "ok"} />
                  </div>
                ))}
              </div>
            </Card>
          </div>
          <Card title="ミスの傾向" sub="同じ種類のミスが繰り返されていないかを確認します">
            {ana.topMistakes.length === 0 ? (
              <Empty icon="🎯" title="目立つミスの傾向はありません" hint="全問正解、または誤答が散発的です。" />
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {ana.topMistakes.map((m) => (
                  <div key={m.reason} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div style={{ width: 34, textAlign: "center", font: `700 14px ${FONT_MONO}`, color: T.shu }}>{m.count}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, color: T.text, marginBottom: 3 }}>{m.reason}</div>
                      <Bar value={m.count} max={Math.max(...ana.topMistakes.map((x) => x.count))} tone="shu" height={6} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "feedback" && (
        <div style={grid(300, 14)}>
          <Card title="生徒向けフィードバック" sub="そのまま返却プリントに貼り付けられます"
            right={<Btn size="sm" onClick={() => { navigator.clipboard && navigator.clipboard.writeText(fb.student.join("\n")); toast("フィードバックをコピーしました"); }}>コピー</Btn>}>
            <div style={{ fontSize: 13, color: T.text, lineHeight: 2 }}>
              {fb.student.map((s, i) => <p key={i} style={{ margin: "0 0 9px" }}>{s}</p>)}
            </div>
            <div style={{ marginTop: 10, borderTop: `1px solid ${T.line}`, paddingTop: 11 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: T.textSub, marginBottom: 7 }}>次にやること</div>
              <ol style={{ margin: 0, paddingInlineStart: 20, fontSize: 12.5, color: T.text, lineHeight: 1.9 }}>
                {fb.nextStep.map((n, i) => <li key={i}>{n}</li>)}
              </ol>
            </div>
          </Card>
          <Card title="教師向け指導提案" sub="次の授業設計に使える観点"
            right={<Btn size="sm" onClick={() => { download(`shido_${st.anonId}.txt`, fb.teacher.join("\n")); toast("指導提案を書き出しました"); }}>保存</Btn>}>
            <div style={{ fontSize: 13, color: T.text, lineHeight: 2 }}>
              {fb.teacher.map((s, i) => <p key={i} style={{ margin: "0 0 9px" }}>{s}</p>)}
            </div>
            <div style={{ marginTop: 10, borderTop: `1px solid ${T.line}`, paddingTop: 11, fontSize: 11.5, color: T.textFaint, lineHeight: 1.7 }}>
              {/* PROD-API: 文面は生成AIで学級・単元の文脈に合わせて再生成する */}
              文面はテンプレートとAI生成の組み合わせです。返却前に内容をご確認ください。
            </div>
          </Card>
        </div>
      )}

      {tab === "model" && (
        <Card title="模範解答（自動生成）" sub="全問白紙と判定されたため、採点をスキップして模範解答と解説を生成しました"
          right={<Btn size="sm" onClick={() => {
            const csv = toCSV(modelAns, [
              { label: "設問", key: "label" }, { label: "単元", key: "unit" }, { label: "配点", key: "points" },
              { label: "解答", key: "answer" }, { label: "解説", key: "solution" }, { label: "キーワード", get: (r) => r.keywords.join(" / ") },
            ]);
            download(`mohan_${test.subject}_${test.name}.csv`, csv, "text/csv;charset=utf-8");
            toast("模範解答を書き出しました");
          }}>CSVで保存</Btn>}>
          <div style={{ display: "grid", gap: 9 }}>
            {modelAns.map((m) => (
              <div key={m.qno} style={{ border: `1px solid ${T.line}`, borderRadius: 11, padding: 12, background: T.panelAlt }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 7 }}>
                  <span style={{ font: `700 13px ${FONT_UI}`, color: T.text }}>{m.label}</span>
                  <Badge tone="mute">{m.unit}</Badge>
                  <Badge tone="accent">{m.points}点</Badge>
                </div>
                <div style={{ fontSize: 13, color: T.shu, font: `14px ${FONT_HAND}`, marginBottom: 6 }}>解答：{m.answer}</div>
                <div style={{ fontSize: 12.5, color: T.textSub, lineHeight: 1.8 }}>{m.solution}</div>
                <div style={{ display: "flex", gap: 5, marginTop: 7, flexWrap: "wrap" }}>
                  {m.keywords.map((k) => <Badge key={k} tone="info">{k}</Badge>)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      </>)}
    </div>
  );
}
