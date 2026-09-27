"use client";
// テスト管理。docs/prototype-v3.jsx から移植し、テストの登録フォームを追加した。
import React, { useState } from "react";
import { download, fmtDate, toCSV } from "@/lib/util";
import { useUI } from "@/components/ui-context";
import { Badge, Btn, Card, Empty, Modal, Stat, Table, grid } from "@/components/ui";
import NewTestForm from "@/components/screens/NewTestForm";

export default function TestsView() {
  const { T, subs, toast, ws, testById } = useUI();
  const [open, setOpen] = useState<string | null>(null);
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
                { key: "correct", label: "正答", wrap: true },
              ]}
              rows={test.questions.map((q) => ({ ...q, id: `q${q.no}` }))}
              maxHeight={340}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
