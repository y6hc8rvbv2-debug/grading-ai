"use client";
// テスト管理。docs/prototype-v3.jsx から移植し、テストの登録フォームを追加した。
import React, { useEffect, useState } from "react";
import { download, fmtDate, toCSV } from "@/lib/util";
import { useUI } from "@/components/ui-context";
import { Badge, Btn, Card, Empty, Modal, Stat, Table, grid } from "@/components/ui";
import NewTestForm from "@/components/screens/NewTestForm";
import type { FigureRef, Question } from "@/lib/types";

export default function TestsView() {
  const { T, subs, toast, ws, testById } = useUI();
  const [open, setOpen] = useState<string | null>(null);
  const [figure, setFigure] = useState<{ ref: FigureRef; title: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const test = open ? testById(open) : null;

  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220, fontSize: 12.5, color: T.textSub, lineHeight: 1.8 }}>
            テストごとに設問・配点・単元・正答を登録します。登録したテストは「新規採点」で選べるようになります。
          </div>
          <Btn variant="primary" onClick={() => setCreating(true)}>＋ テストを追加</Btn>
        </div>
      </Card>

      {ws.tests.length === 0 && (
        <Card><Empty icon="📝" title="テストがまだありません" hint="「テストを追加」から、最初のテストを登録してください。"
          action={<Btn variant="primary" onClick={() => setCreating(true)}>テストを追加</Btn>} /></Card>
      )}

      <NewTestForm open={creating} onClose={() => setCreating(false)} />

      <div style={grid(280, 13)}>
        {ws.tests.map((t) => {
          const mine = subs.filter((s) => s.testId === t.id && !["processing", "uploaded", "blank"].includes(s.status));
          const avg = mine.length ? Math.round(mine.reduce((a, s) => a + s.result.total, 0) / mine.length) : 0;
          return (
            <Card key={t.id} title={`${t.subject}／${t.name}`} sub={`${t.grade}年 ${t.term}${t.date ? `・実施 ${fmtDate(t.date)}` : ""}`}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 11 }}>
                {t.testNo && <Badge tone="accent">試験番号 {t.testNo}</Badge>}
                <Badge tone="mute">{t.questions.length}問</Badge>
                <Badge tone="mute">満点 {t.maxScore}</Badge>
                <Badge tone="mute">大問 {t.bigCount}</Badge>
              </div>
              <div style={{ fontSize: 11.5, color: T.textSub, marginBottom: 5, fontWeight: 700 }}>単元</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 12 }}>
                {t.units.map((u) => <Badge key={u} tone="info">{u}</Badge>)}
              </div>
              <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                <Stat label="採点済" value={mine.length} unit="枚" tone="accent" />
                <Stat label="平均点" value={avg} unit={`/${t.maxScore}`} tone="ok" />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn size="sm" variant="soft" onClick={() => setOpen(t.id)}>設問と配点を見る</Btn>
                <Btn size="sm" onClick={() => {
                  download(`test_${t.subject}_${t.name}.csv`, toCSV(t.questions, [
                    { label: "設問", key: "label" }, { label: "番号", key: "no" }, { label: "単元", key: "unit" },
                    { label: "形式", key: "typeLabel" }, { label: "難易度", key: "difficulty" },
                    { label: "配点", key: "points" }, { label: "正答", key: "correct" },
                  ]), "text/csv;charset=utf-8");
                  toast("設問一覧を書き出しました");
                }}>CSV</Btn>
              </div>
            </Card>
          );
        })}
      </div>

      <Modal open={!!test} onClose={() => setOpen(null)} width={860}
        title={test ? `${test.subject}／${test.name} の設問構成` : ""}>
        {test && (
          <>
            <div style={{ ...grid(120, 9), marginBottom: 14 }}>
              <Stat label="問題数" value={test.questions.length} unit="問" />
              <Stat label="満点" value={test.maxScore} unit="点" tone="shu" />
              <Stat label="大問数" value={test.bigCount} unit="問" tone="info" />
              <Stat label="単元数" value={test.units.length} unit="種" tone="ok" />
            </div>
            <Table
              columns={[
                { key: "label", label: "設問" },
                { key: "unit", label: "単元" },
                { key: "typeLabel", label: "形式" },
                { key: "difficulty", label: "難易度", render: (r: { difficulty: string }) => <Badge tone={r.difficulty === "難" ? "ng" : r.difficulty === "標準" ? "warn" : "ok"}>{r.difficulty}</Badge> },
                { key: "points", label: "配点", align: "right" },
                {
                  key: "correct", label: "正答・採点条件", wrap: true,
                  render: (q: Question) => q.type === "graph" ? (
                    <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                      <div style={{ whiteSpace: "pre-wrap" }}>{q.model || "（採点条件が未入力です）"}</div>
                      {q.figure && <Btn size="sm" variant="soft" onClick={() => setFigure({ ref: q.figure!, title: `${q.label} の模範図` })}>模範図を見る</Btn>}
                    </div>
                  ) : q.correct,
                },
              ]}
              rows={test.questions.map((q) => ({ ...q, id: `q${q.no}` }))}
              maxHeight={340}
            />
            {!!test.answerKeyPaths?.length && (
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 10, fontSize: 12, color: T.textSub }}>
                登録時の模範解答・配点表：
                {test.answerKeyPaths.map((p, i) => (
                  <Btn key={p} size="sm" onClick={() => setFigure({ ref: { path: p, page: 1, x: 0, y: 0, w: 0, h: 0 }, title: `資料${i + 1}` })}>資料{i + 1}</Btn>
                ))}
              </div>
            )}
          </>
        )}
      </Modal>
      <FigureModal figure={figure} onClose={() => setFigure(null)} />
    </div>
  );
}

/** 模範図（登録時の模範解答の画像の該当箇所）を表示する */
function FigureModal({ figure, onClose }: { figure: { ref: FigureRef; title: string } | null; onClose: () => void }) {
  const { T, ds } = useUI();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!figure) return;
    let alive = true;
    ds.signedImageUrl(figure.ref.path).then((u) => { if (alive) setUrl(u || null); }).catch(() => { if (alive) setUrl(null); });
    return () => { alive = false; };
  }, [ds, figure]);
  const r = figure?.ref;
  const pdf = r?.path.toLowerCase().endsWith(".pdf");
  return (
    <Modal open={!!figure} onClose={onClose} title={figure?.title ?? ""} width={720}>
      {!url ? <div style={{ fontSize: 12.5, color: T.textSub }}>読み込んでいます…</div>
        : pdf ? <a href={`${url}#page=${r!.page}`} target="_blank" rel="noreferrer">PDF の {r!.page} ページ目を開く</a>
        : (
          <div style={{ position: "relative" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={figure?.title ?? "模範図"} style={{ width: "100%", display: "block", borderRadius: 6 }} />
            {r!.w > 0 && r!.h > 0 && (
              <div aria-label="模範図の位置" style={{
                position: "absolute", left: `${r!.x * 100}%`, top: `${r!.y * 100}%`, width: `${r!.w * 100}%`, height: `${r!.h * 100}%`,
                border: `3px solid ${T.shu}`, borderRadius: 4,
              }} />
            )}
          </div>
        )}
    </Modal>
  );
}
