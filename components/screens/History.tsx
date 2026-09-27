"use client";
// 採点履歴。docs/prototype-v3.jsx から移植。
import React, { useState } from "react";
import { FONT_MONO } from "@/lib/ui/theme";
import { download, fmtDateTime, pct, toCSV } from "@/lib/util";
import { SOURCES, STATUS_META } from "@/lib/grading/engine";
import { useUI } from "@/components/ui-context";
import { Badge, Btn, Card, Field, Input, Select, Table, grid } from "@/components/ui";
import type { Submission } from "@/lib/types";

export default function History() {
  const { T, go, subs, toast, who, ws, testById, classById, studentById } = useUI();
  const [fTest, setFTest] = useState("all");
  const [fClass, setFClass] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [q, setQ] = useState("");

  const rows = subs.filter((s) => {
    if (s.status === "processing" || s.status === "uploaded") return false;
    if (!testById(s.testId) || !studentById(s.studentId)) return false;
    if (fTest !== "all" && s.testId !== fTest) return false;
    if (fClass !== "all" && s.classId !== fClass) return false;
    if (fStatus !== "all" && s.status !== fStatus) return false;
    if (q) {
      const st = studentById(s.studentId)!;
      const hay = `${st.anonId} ${st.examNo} ${st.number} ${st.initials} ${classById(s.classId)?.label ?? ""} ${testById(s.testId)!.name}`;
      if (!hay.toLowerCase().includes(q.toLowerCase())) return false;
    }
    return true;
  }).sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));

  const exportAll = (kind) => {
    if (kind === "json") {
      download("saiten_history.json", JSON.stringify(rows.map((r) => ({
        test: testById(r.testId)!.name, subject: testById(r.testId)!.subject,
        class: classById(r.classId)?.label, student: studentById(r.studentId)!.anonId,
        examNo: studentById(r.studentId)!.examNo,
        total: r.result.total, max: testById(r.testId)!.maxScore,
        status: r.status, uploadedAt: r.uploadedAt,
        items: r.result.items.map((i) => ({ q: i.label, mark: i.mark, earned: i.earned, points: i.points, unit: i.unit })),
      })), null, 2), "application/json");
    } else {
      download("saiten_history.csv", toCSV(rows, [
        { label: "取込日時", get: (r) => fmtDateTime(r.uploadedAt) },
        { label: "教科", get: (r) => testById(r.testId)!.subject },
        { label: "テスト", get: (r) => testById(r.testId)!.name },
        { label: "クラス", get: (r) => classById(r.classId)?.label },
        { label: "出席番号", get: (r) => studentById(r.studentId)!.number },
        { label: "受験番号", get: (r) => studentById(r.studentId)!.examNo },
        { label: "匿名ID", get: (r) => studentById(r.studentId)!.anonId },
        { label: "得点", get: (r) => r.result.total },
        { label: "満点", get: (r) => testById(r.testId)!.maxScore },
        { label: "得点率", get: (r) => pct(r.result.total, testById(r.testId)!.maxScore) },
        { label: "状態", get: (r) => STATUS_META[r.status].label },
        { label: "取込方法", get: (r) => SOURCES[r.source]?.label ?? r.source },
      ]), "text/csv;charset=utf-8");
    }
    toast(`${rows.length} 件を書き出しました`);
  };

  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <div style={grid(150, 10)}>
          <Field label="テスト"><Select value={fTest} onChange={setFTest}
            options={[{ value: "all", label: "すべて" }, ...ws.tests.map((t) => ({ value: t.id, label: `${t.subject}／${t.name}` }))]} /></Field>
          <Field label="クラス"><Select value={fClass} onChange={setFClass}
            options={[{ value: "all", label: "すべて" }, ...ws.classes.map((c) => ({ value: c.id, label: c.label }))]} /></Field>
          <Field label="状態"><Select value={fStatus} onChange={setFStatus}
            options={[{ value: "all", label: "すべて" }, ...Object.entries(STATUS_META).filter(([k]) => k !== "processing" && k !== "uploaded").map(([k, v]) => ({ value: k, label: v.label }))]} /></Field>
          <Field label="検索"><Input value={q} onChange={setQ} placeholder="匿名ID・受験番号など" /></Field>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn size="sm" onClick={() => exportAll("csv")}>CSVを書き出す</Btn>
          <Btn size="sm" onClick={() => exportAll("json")}>JSONを書き出す</Btn>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: T.textSub, alignSelf: "center" }}>{rows.length} 件</span>
        </div>
      </Card>

      <Card pad={0}>
        <Table
          onRow={(r) => go("detail", r.id)}
          empty={subs.length ? "条件に合う答案がありません" : "まだ採点した答案がありません。「新規採点」から答案を取り込んでください"}
          columns={[
            { key: "d", label: "取込", render: (r) => <span style={{ fontSize: 12, color: T.textSub }}>{fmtDateTime(r.uploadedAt)}</span> },
            { key: "t", label: "テスト", render: (r) => <span>{testById(r.testId)!.subject}／{testById(r.testId)!.name}</span> },
            { key: "s", label: "受験者", render: (r: Submission) => who(r.studentId) },
            { key: "sc", label: "得点", align: "right", render: (r) => r.status === "blank" ? "—" :
              <span style={{ font: `700 13px ${FONT_MONO}` }}>{r.result.total}<span style={{ color: T.textFaint, fontWeight: 400 }}>/{testById(r.testId)!.maxScore}</span></span> },
            { key: "rt", label: "得点率", align: "right", render: (r) => r.status === "blank" ? "—" : `${pct(r.result.total, testById(r.testId)!.maxScore)}%` },
            { key: "st", label: "状態", align: "center", render: (r) => <Badge tone={STATUS_META[r.status].tone}>{STATUS_META[r.status].label}</Badge> },
            { key: "src", label: "取込方法", render: (r) => <span style={{ fontSize: 12, color: T.textSub }}>{SOURCES[r.source]?.icon} {SOURCES[r.source]?.label ?? r.source}</span> },
            { key: "act", label: "", align: "right", render: (r) => <Btn size="sm" variant="soft" onClick={() => go("detail", r.id)}>開く</Btn> },
          ]}
          rows={rows}
        />
      </Card>
    </div>
  );
}
