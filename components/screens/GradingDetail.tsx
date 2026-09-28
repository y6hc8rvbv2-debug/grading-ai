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
import { RedPenOverlay, type ItemBox } from "@/components/RedPenOverlay";
import type { Item, Submission } from "@/lib/types";

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
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [sheetMode, setSheetMode] = useState<"overlay" | "clean">("overlay");
  const [page, setPage] = useState(0);
  const [showMarks, setShowMarks] = useState(true);
  const [showComments, setShowComments] = useState(true);
  const [editing, setEditing] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

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
  const firstPath = sub?.imagePaths?.[0];
  useEffect(() => {
    if (!firstPath) { setImageUrl(null); return; }
    let alive = true;
    ds.signedImageUrl(firstPath)
      .then((u) => { if (alive) setImageUrl(u || null); })
      .catch(() => { if (alive) setImageUrl(null); });
    return () => { alive = false; };
  }, [ds, firstPath]);

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
  // 採点AIが返した解答の位置（1ページ目の原本に赤ペンを重ねるのに使う）
  const boxes: ItemBox[] = sub.result.items
    .filter((i) => i.bbox)
    .map((i) => ({ qno: i.qno, ...i.bbox! }));
  const canOverlay = !!imageUrl && boxes.length > 0;
  const canAi = ai.enabled && sub.imagePaths.length > 0;

  const runAi = async (regrade: boolean) => {
    if (regrade && !window.confirm("AIで採点し直すと、先生が修正した判定・得点・コメントと「確認済み」の記録は上書きされます。採点し直しますか？")) return;
    setAiBusy(true);
    await aiGradeSub(sub.id);
    setAiBusy(false);
  };

  const applyEdit = (it: Item, patch: Parameters<typeof editItem>[2]) => editItem(sub.id, it, patch);

  const exportSVG = () => {
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
        <span style={{ flex: 1 }} />
        {canAi && !pending && (
          <Btn size="sm" disabled={aiBusy} onClick={() => runAi(true)}>{aiBusy ? "AIが採点しています…" : "AIで採点し直す"}</Btn>
        )}
        <Btn size="sm" onClick={exportRow}>CSV</Btn>
        <Btn size="sm" variant="soft" onClick={exportSVG}>赤ペン画像を保存</Btn>
      </div>

      {pending ? (
        <Card title={aiBusy || sub.status === "processing" ? "AIが採点しています" : "この答案はまだ採点されていません"}
          sub={ai.enabled ? "答案画像・正答・配点・採点基準をもとに AI が採点します（数十秒かかります）" : "採点AIが設定されると、ここから採点できます"}
          right={canAi ? (
            <Btn variant="primary" disabled={aiBusy} onClick={() => runAi(false)}>
              {aiBusy ? "採点しています…" : sub.status === "processing" ? "AIで採点し直す" : "AIで採点する"}
            </Btn>
          ) : null}>
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
      ]} />

      {tab === "sheet" && (
        <Card pad={0}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${T.line}`, flexWrap: "wrap", background: T.panelAlt }}>
            {!(canOverlay && sheetMode === "overlay" && showMarks) && <>
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
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: T.textSub, cursor: "pointer" }}>
              <input type="checkbox" checked={showComments} onChange={(e) => setShowComments(e.target.checked)} />コメントを表示
            </label>
          </div>
          <div style={{ padding: 14, background: T.bgAlt }}>
            {!showMarks && imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt={`${whoName} の答案（原本）`} style={{ width: "100%", maxHeight: "72vh", objectFit: "contain", borderRadius: 8 }} />
            ) : canOverlay && sheetMode === "overlay" ? (
              <RedPenOverlay imageUrl={imageUrl!} sub={sub} test={test} boxes={boxes} showComments={showComments} svgRef={svgRef} />
            ) : (
              <RedPenSheet test={test} sub={sub} page={page} showMarks={showMarks} showComments={showComments} svgRef={svgRef} />
            )}
          </div>
          <div style={{ padding: "10px 14px", borderTop: `1px solid ${T.line}`, fontSize: 11.5, color: T.textFaint, lineHeight: 1.7 }}>
            {canOverlay && sheetMode === "overlay"
              ? "赤ペンの位置は AI が読み取った解答欄の位置です。ずれている場合は「清書版」で確認してください。"
              : "チェックを外すと元の答案（原本）だけを表示します。"}
            原本画像は保存期間のあいだ削除されません。
          </div>
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
