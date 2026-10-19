"use client";
// レポート。docs/prototype-v3.jsx から移植。
import React, { useEffect, useState } from "react";
import { FONT_MONO } from "@/lib/ui/theme";
import { download, fmtDate, pct, toCSV } from "@/lib/util";
import { analyze, buildFeedback } from "@/lib/grading/engine";
import type { RateRow } from "@/lib/types";
import { useUI } from "@/components/ui-context";
import { Btn, Card, Empty, Field, Select, Stat, grid } from "@/components/ui";

export default function ReportsView() {
  const { T, subs, toast, who, ws, testById, classById, go, ds } = useUI();
  const [kind, setKind] = useState("class");
  const [testId, setTestId] = useState(ws.tests[0]?.id ?? "");
  const [classId, setClassId] = useState(ws.classes[0]?.id ?? "");
  const [units, setUnits] = useState<RateRow[]>([]);

  // 単元別到達度は Postgres の分析ビューで集計した値を使う
  useEffect(() => {
    if (kind !== "unit" || !testId || !classId) return;
    let alive = true;
    ds.unitMastery(testId, classId).then((u) => { if (alive) setUnits(u); }).catch(() => { if (alive) setUnits([]); });
    return () => { alive = false; };
  }, [ds, kind, testId, classId, subs]);
  const test = testById(testId);
  const kl = classById(classId);
  if (!test || !kl) {
    return <Card><Empty icon="📄" title={!test ? "テストがまだありません" : "クラスがまだ登録されていません"}
      hint="テストとクラスが揃い、答案を採点するとレポートを作れます。"
      action={!test ? <Btn variant="primary" onClick={() => go("tests")}>テスト管理へ</Btn> : null} /></Card>;
  }
  const target = subs.filter((s) => s.testId === testId && s.classId === classId && !["processing", "uploaded", "blank"].includes(s.status));
  const rates = target.map((s) => pct(s.result.total, test.maxScore));
  const avg = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length * 10) / 10 : 0;
  const median = rates.length ? [...rates].sort((a, b) => a - b)[Math.floor(rates.length / 2)] : 0;
  const sd = rates.length
    ? Math.round(Math.sqrt(rates.reduce((a, r) => a + (r - avg) ** 2, 0) / rates.length) * 10) / 10 : 0;

  const buildText = () => {
    const head = [
      `${test.subject}／${test.name}　${kl.label}　${kind === "student" ? "個人成績票" : kind === "unit" ? "単元別到達度レポート" : "成績レポート"}`,
      `実施日：${test.date ? fmtDate(test.date) : "—"}／試験番号：${test.testNo || "—"}／満点：${test.maxScore}点`,
      `対象：${target.length}名`,
      ``,
    ];
    const foot = [``, `※本レポートに生徒の実名は含まれません。`];

    if (kind === "student") {
      const sheets = target.flatMap((s) => {
        const a = analyze(test, s.result);
        const fb = buildFeedback(test, s.result, a);
        return [
          `────────────────────────`,
          `${who(s.studentId)}　${s.result.total}/${test.maxScore}点（${fb.rate}%）`,
          ...a.units.map((u) => `　${u.unit}：${u.rate}%（${u.earned}/${u.points}）`),
          ...fb.student.map((x) => `　${x}`),
          `　次にやること：${fb.nextStep.join(" ／ ")}`,
        ];
      });
      return [...head, ...sheets, ...foot].join("\n");
    }
    if (kind === "unit") {
      const body = units.length
        ? units.map((u, i) => `${i === 0 ? "★" : "　"}${u.key || "（単元なし）"}：${u.rate}%（${u.earned}/${u.points}点）${u.rate < 50 ? "　要復習" : u.rate < 75 ? "　要確認" : "　定着"}`)
        : ["集計できる答案がありません。"];
      return [...head, `【単元別の到達度（低い順）】`, ...body,
        ``, units[0] ? `指導の重点：${units[0].key || "（単元なし）"}（${units[0].rate}%）` : "", ...foot].join("\n");
    }

    const lines = [
      `${test.subject}／${test.name}　${kl.label}　成績レポート`,
      `実施日：${test.date ? fmtDate(test.date) : "—"}／試験番号：${test.testNo || "—"}／満点：${test.maxScore}点`,
      `対象：${target.length}名`,
      ``,
      `平均得点率：${avg}%　中央値：${median}%　標準偏差：${sd}`,
      `最高：${rates.length ? Math.max(...rates) : 0}%　最低：${rates.length ? Math.min(...rates) : 0}%`,
      ``,
      `【個票】`,
      ...target.map((s) => {
        const a = analyze(test, s.result);
        return `${who(s.studentId)}　${s.result.total}/${test.maxScore}点（${pct(s.result.total, test.maxScore)}%）　弱点：${a.units[0] ? a.units[0].unit : "—"}`;
      }),
      ``,
      `※本レポートに生徒の実名は含まれません。`,
    ];
    return lines.join("\n");
  };

  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <div style={grid(170, 10)}>
          <Field label="レポートの種類"><Select value={kind} onChange={setKind}
            options={[
              { value: "class", label: "クラス成績レポート" },
              { value: "student", label: "個人成績票（一括）" },
              { value: "unit", label: "単元別到達度レポート" },
            ]} /></Field>
          <Field label="テスト"><Select value={testId} onChange={setTestId}
            options={ws.tests.map((t) => ({ value: t.id, label: `${t.subject}／${t.name}` }))} /></Field>
          <Field label="クラス"><Select value={classId} onChange={setClassId}
            options={ws.classes.map((c) => ({ value: c.id, label: c.label }))} /></Field>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn variant="primary" onClick={() => { download(`report_${kl.label}_${test.subject}.txt`, buildText()); toast("レポートを書き出しました"); }}>テキストで保存</Btn>
          <Btn onClick={() => {
            download(`report_${kl.label}_${test.subject}.csv`, toCSV(target, [
              { label: "表示名", get: (r) => who(r.studentId) },
              { label: "得点", get: (r) => r.result.total }, { label: "満点", get: () => test.maxScore },
              { label: "得点率", get: (r) => pct(r.result.total, test.maxScore) },
              { label: "最弱単元", get: (r) => { const a = analyze(test, r.result); return a.units[0] ? a.units[0].unit : ""; } },
            ]), "text/csv;charset=utf-8");
            toast("CSVを書き出しました");
          }}>CSVで保存</Btn>
          <Btn variant="soft" onClick={() => { window.print(); }}>印刷する</Btn>
        </div>
      </Card>

      <Card title={`${kl.label}／${test.subject} ${test.name}`} sub={`${test.date ? `実施 ${fmtDate(test.date)}・` : ""}対象 ${target.length}名・満点 ${test.maxScore}点`}>
        <div style={{ ...grid(120, 9), marginBottom: 16 }}>
          <Stat label="平均得点率" value={avg} unit="%" tone="accent" />
          <Stat label="中央値" value={median} unit="%" tone="info" />
          <Stat label="標準偏差" value={sd} tone="warn" />
          <Stat label="最高" value={rates.length ? Math.max(...rates) : 0} unit="%" tone="ok" />
          <Stat label="最低" value={rates.length ? Math.min(...rates) : 0} unit="%" tone="ng" />
        </div>
        <div style={{
          background: T.panelAlt, border: `1px solid ${T.line}`, borderRadius: 11, padding: 14,
          font: `12.5px/1.9 ${FONT_MONO}`, color: T.text, whiteSpace: "pre-wrap", maxHeight: 400, overflowY: "auto",
        }}>{buildText()}</div>
      </Card>
    </div>
  );
}
