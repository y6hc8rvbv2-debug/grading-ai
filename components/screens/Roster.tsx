"use client";
// 生徒管理 / クラス管理 / 成績一覧。docs/prototype-v3.jsx から移植。
// 生徒の実名はデータベースに存在しない。表示は設定の「生徒の表示形式」に従う。
import React, { useState } from "react";
import { FONT_UI, FONT_MONO } from "@/lib/ui/theme";
import { clamp, download, pct, toCSV } from "@/lib/util";
import { useUI } from "@/components/ui-context";
import { Badge, Btn, Card, Empty, Field, Input, Select, Stat, Table, grid } from "@/components/ui";
import type { Student, Submission, Test } from "@/lib/types";

const counted = (s: Submission) => !["processing", "uploaded", "blank"].includes(s.status);

function studentStats(subs: Submission[], studentId: string, testById: (id: string) => Test | undefined) {
  const mine = subs.filter((s) => s.studentId === studentId && counted(s) && testById(s.testId));
  if (!mine.length) return { n: 0, avg: 0, last: null as Submission | null };
  const rates = mine.map((s) => pct(s.result.total, testById(s.testId)!.maxScore));
  return {
    n: mine.length,
    avg: Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10,
    last: mine.sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1))[0],
  };
}

export function StudentsView() {
  const { T, go, subs, toast, who, ws, classById, testById } = useUI();
  const [fClass, setFClass] = useState("all");
  const [q, setQ] = useState("");

  const rows = ws.students
    .filter((s) => (fClass === "all" || s.classId === fClass))
    .filter((s) => !q || `${s.anonId}${s.examNo}${s.initials}${s.number}`.toLowerCase().includes(q.toLowerCase()))
    .map((s) => ({ ...s, stats: studentStats(subs, s.id, testById) }));

  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ background: T.infoSoft, border: `1px solid ${T.info}`, borderRadius: 10, padding: 11, marginBottom: 13 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: T.info, marginBottom: 4 }}>個人情報保護の設計</div>
          <div style={{ fontSize: 12, color: T.text, lineHeight: 1.8 }}>
            生徒の実名は読み取れても保存しません。表示は「学年＋クラス＋出席番号」「受験番号」「イニシャル」「匿名ID」の4通りから選べます。
            匿名モードでは匿名IDだけを表示します。
          </div>
        </div>
        <div style={grid(170, 10)}>
          <Field label="クラス"><Select value={fClass} onChange={setFClass}
            options={[{ value: "all", label: "すべて" }, ...ws.classes.map((c) => ({ value: c.id, label: c.label }))]} /></Field>
          <Field label="検索"><Input value={q} onChange={setQ} placeholder="匿名ID・受験番号・イニシャル" /></Field>
        </div>
        <Btn size="sm" onClick={() => {
          download("students.csv", toCSV(rows, [
            { label: "クラス", get: (r) => classById(r.classId)?.label },
            { label: "出席番号", key: "number" }, { label: "受験番号", key: "examNo" },
            { label: "匿名ID", key: "anonId" }, { label: "イニシャル", key: "initials" },
            { label: "採点枚数", get: (r) => r.stats.n }, { label: "平均得点率", get: (r) => r.stats.avg },
            { label: "配慮事項", key: "note" },
          ]), "text/csv;charset=utf-8");
          toast("生徒一覧を書き出しました（実名は含まれません）");
        }}>CSVを書き出す</Btn>
      </Card>

      <Card pad={0}>
        <Table
          empty={ws.students.length ? "該当する生徒がいません" : "生徒がまだ登録されていません。名簿は学校の管理者が登録します（docs/SUPABASE-SETUP.md のステップ4）"}
          columns={[
            { key: "cl", label: "クラス", render: (r) => classById(r.classId)?.label },
            { key: "no", label: "表示名", render: (r: Student) => (
              <span style={{ fontWeight: 700 }}>{who(r.id)}</span>
            ) },
            { key: "ex", label: "受験番号", render: (r: Student) => <span style={{ font: `12px ${FONT_MONO}`, color: T.textSub }}>{r.examNo}</span> },
            { key: "ini", label: "イニシャル", render: (r: Student) => <span style={{ color: T.textSub }}>{r.initials}</span> },
            { key: "n", label: "採点枚数", align: "right", render: (r) => r.stats.n },
            { key: "avg", label: "平均得点率", align: "right", render: (r) => r.stats.n ? (
              <span style={{ font: `700 12.5px ${FONT_MONO}`, color: r.stats.avg < 50 ? T.ng : r.stats.avg < 75 ? T.warn : T.ok }}>{r.stats.avg}%</span>
            ) : "—" },
            { key: "sp", label: "配慮", render: (r) => r.support ? <Badge tone="info">特別支援</Badge> : r.note ? <Badge tone="mute">{r.note}</Badge> : "" },
            { key: "act", label: "", align: "right", render: (r) => r.stats.last ?
              <Btn size="sm" variant="soft" onClick={() => go("detail", r.stats.last.id)}>最新の答案</Btn> : "" },
          ]}
          rows={rows}
        />
      </Card>
    </div>
  );
}

export function ClassesView() {
  const { T, go, subs, ws, testById } = useUI();
  if (!ws.classes.length) {
    return <Card><Empty icon="🏫" title="クラスがまだ登録されていません" hint="クラスと生徒の名簿は、学校の管理者が登録します（docs/SUPABASE-SETUP.md のステップ4）。" /></Card>;
  }
  return (
    <div style={grid(300, 13)}>
      {ws.classes.map((c) => {
        const mine = subs.filter((s) => s.classId === c.id && counted(s) && testById(s.testId));
        const rates = mine.map((s) => pct(s.result.total, testById(s.testId)!.maxScore));
        const avg = rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10 : 0;
        const top = rates.length ? Math.max(...rates) : 0;
        const low = rates.length ? Math.min(...rates) : 0;
        const dist = [0, 0, 0, 0, 0];
        rates.forEach((r) => dist[clamp(Math.floor(r / 20), 0, 4)]++);
        const maxD = Math.max(1, ...dist);
        return (
          <Card key={c.id} title={c.label} sub={`${c.size}名${c.teacher ? `・${c.teacher}` : ""}`}>
            <div style={{ ...grid(90, 8), marginBottom: 13 }}>
              <Stat label="平均" value={avg} unit="%" tone="accent" />
              <Stat label="最高" value={top} unit="%" tone="ok" />
              <Stat label="最低" value={low} unit="%" tone="ng" />
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: T.textSub, marginBottom: 7 }}>得点率の分布</div>
            <div style={{ display: "flex", gap: 5, alignItems: "flex-end", height: 74, marginBottom: 7 }}>
              {dist.map((d, i) => (
                <div key={i} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{
                    height: `${(d / maxD) * 58}px`, background: i < 2 ? T.ng : i < 3 ? T.warn : T.ok,
                    borderRadius: "5px 5px 0 0", minHeight: d ? 4 : 0, transition: "height .4s",
                  }} />
                  <div style={{ fontSize: 9.5, color: T.textFaint, marginTop: 4 }}>{i * 20}–{i * 20 + 19}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: T.textSub, marginBottom: 11 }}>採点済み {mine.length} 枚</div>
            <Btn size="sm" variant="soft" onClick={() => go("scores")}>成績一覧で見る</Btn>
          </Card>
        );
      })}
    </div>
  );
}

export function ScoresView() {
  const { T, go, subs, toast, who, ws, classById, testById } = useUI();
  const [classId, setClassId] = useState(ws.classes[0]?.id ?? "");
  const roster = ws.students.filter((s) => s.classId === classId);
  const tests = ws.tests.filter((t) => subs.some((s) => s.classId === classId && s.testId === t.id));
  const klass = classById(classId);
  if (!klass) {
    return <Card><Empty icon="🏫" title="クラスがまだ登録されていません" hint="クラスと生徒の名簿は、学校の管理者が登録します（docs/SUPABASE-SETUP.md のステップ4）。" /></Card>;
  }

  const cell = (studentId: string, testId: string) =>
    subs.find((s) => s.studentId === studentId && s.testId === testId);

  const rows = roster.map((st) => {
    const row: any = { id: st.id, st };
    tests.forEach((t) => { row[t.id] = cell(st.id, t.id); });
    const vals = tests.map((t) => row[t.id]).filter((s) => s && counted(s));
    row.avg = vals.length ? Math.round(vals.reduce((a, s) => a + pct(s.result.total, testById(s.testId)!.maxScore), 0) / vals.length * 10) / 10 : null;
    return row;
  });

  const classAvg = (t: Test) => {
    const vals = roster.map((st) => cell(st.id, t.id)).filter((s): s is Submission => !!s && counted(s));
    return vals.length ? Math.round(vals.reduce((a, s) => a + s.result.total, 0) / vals.length * 10) / 10 : null;
  };

  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ minWidth: 190, flex: 1 }}>
            <Field label="クラス"><Select value={classId} onChange={setClassId}
              options={ws.classes.map((c) => ({ value: c.id, label: `${c.label}（${c.size}名）` }))} /></Field>
          </div>
          <Btn onClick={() => {
            const headers = [
              { label: "表示名", get: (r) => who(r.st.id) },
              { label: "受験番号", get: (r) => r.st.examNo },
              ...tests.map((t) => ({ label: `${t.subject}${t.name}`, get: (r) => (r[t.id] && r[t.id].status !== "blank" ? r[t.id].result.total : "") })),
              { label: "平均得点率", get: (r) => (r.avg == null ? "" : r.avg) },
            ];
            download(`seiseki_${klass.label}.csv`, toCSV(rows, headers), "text/csv;charset=utf-8");
            toast("成績一覧を書き出しました");
          }}>CSVを書き出す</Btn>
        </div>
      </Card>

      <Card pad={0} title={`${klass.label} の成績一覧`} sub="セルをタップすると答案を開きます">
        {tests.length === 0 ? (
          <Empty icon="📋" title="このクラスの採点結果がありません" hint="新規採点から答案を取り込んでください。"
            action={<Btn variant="primary" onClick={() => go("new")}>新規採点へ</Btn>} />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", font: `13px ${FONT_UI}`, minWidth: 420 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "start", padding: "9px 10px", fontSize: 11, color: T.textSub, borderBottom: `1px solid ${T.lineStrong}`, position: "sticky", insetInlineStart: 0, background: T.panel }}>受験者</th>
                  {tests.map((t) => (
                    <th key={t.id} style={{ padding: "9px 10px", fontSize: 11, color: T.textSub, borderBottom: `1px solid ${T.lineStrong}`, whiteSpace: "nowrap" }}>
                      {t.subject}<br /><span style={{ fontWeight: 400, fontSize: 10 }}>満点{t.maxScore}</span>
                    </th>
                  ))}
                  <th style={{ padding: "9px 10px", fontSize: 11, color: T.textSub, borderBottom: `1px solid ${T.lineStrong}` }}>平均</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} style={{ background: i % 2 ? T.panelAlt : "transparent" }}>
                    <td style={{ padding: "9px 10px", borderBottom: `1px solid ${T.line}`, fontWeight: 700, color: T.text, whiteSpace: "nowrap", position: "sticky", insetInlineStart: 0, background: i % 2 ? T.panelAlt : T.panel }}>
                      {who(r.st.id)}
                    </td>
                    {tests.map((t) => {
                      const s = r[t.id];
                      const rate = s && counted(s) ? pct(s.result.total, t.maxScore) : null;
                      return (
                        <td key={t.id} onClick={() => s && go("detail", s.id)}
                          style={{
                            padding: "9px 10px", borderBottom: `1px solid ${T.line}`, textAlign: "center",
                            cursor: s ? "pointer" : "default",
                            color: rate == null ? T.textFaint : rate < 50 ? T.ng : rate < 75 ? T.warn : T.ok,
                            font: `700 13px ${FONT_MONO}`,
                          }}>
                          {!s ? "—" : s.status === "blank" ? "白紙" : s.status === "processing" || s.status === "uploaded" ? "採点待ち" : s.result.total}
                        </td>
                      );
                    })}
                    <td style={{ padding: "9px 10px", borderBottom: `1px solid ${T.line}`, textAlign: "center", font: `700 13px ${FONT_MONO}`, color: T.accent }}>
                      {r.avg == null ? "—" : `${r.avg}%`}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td style={{ padding: "10px", fontWeight: 700, color: T.textSub, background: T.panelAlt, position: "sticky", insetInlineStart: 0 }}>クラス平均</td>
                  {tests.map((t) => (
                    <td key={t.id} style={{ padding: "10px", textAlign: "center", font: `700 13px ${FONT_MONO}`, color: T.accent, background: T.panelAlt }}>
                      {classAvg(t) == null ? "—" : classAvg(t)}
                    </td>
                  ))}
                  <td style={{ background: T.panelAlt }} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
