"use client";
// 弱点分析。docs/prototype-v3.jsx の WeaknessView を移植。
// プロトタイプはブラウザで全答案をループして集計していたが、
// 本番では Postgres の分析ビュー（v_unit_mastery など）で集計した結果を読むだけにした。
import React, { useEffect, useState } from "react";
import { FONT_MONO } from "@/lib/ui/theme";
import { download, toCSV } from "@/lib/util";
import { friendlyError } from "@/lib/errors";
import { useUI } from "@/components/ui-context";
import { Badge, Bar, Btn, Card, Empty, Field, Select, Table, grid } from "@/components/ui";
import type { Analysis, QuestionStat } from "@/lib/types";

const EMPTY: Analysis = { units: [], types: [], questions: [], mistakes: [] };

export default function WeaknessView() {
  const { T, go, subs, toast, ws, testById, ds } = useUI();
  const [testId, setTestId] = useState(ws.tests[0]?.id ?? "");
  const [classId, setClassId] = useState("all");
  const [agg, setAgg] = useState<Analysis>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const test = testById(testId);
  const cls = classId === "all" ? undefined : classId;

  // 答案が修正されたら（subs が変わったら）読み直す
  const version = subs.map((s) => `${s.id}:${s.result.total}:${s.status}`).join("|");
  useEffect(() => {
    if (!testId) { setLoading(false); return; }
    let alive = true;
    setLoading(true); setError("");
    Promise.all([
      ds.unitMastery(testId, cls), ds.typeMastery(testId, cls),
      ds.questionStats(testId, cls), ds.mistakeReasons(testId, cls),
    ])
      .then(([units, types, questions, mistakes]) => { if (alive) setAgg({ units, types, questions, mistakes }); })
      .catch((e) => { if (alive) { setAgg(EMPTY); setError(friendlyError(e, "弱点分析の読み込み")); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [ds, testId, cls, version]);

  const target = subs.filter((s) => s.testId === testId && !["processing", "uploaded", "blank"].includes(s.status) && (!cls || s.classId === cls));

  if (!test) {
    return <Card><Empty icon="📊" title="テストがまだありません" hint="テスト管理でテストを登録し、答案を採点すると分析できます。"
      action={<Btn variant="primary" onClick={() => go("tests")}>テスト管理へ</Btn>} /></Card>;
  }

  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <div style={grid(180, 10)}>
          <Field label="テスト"><Select value={testId} onChange={setTestId}
            options={ws.tests.map((t) => ({ value: t.id, label: `${t.subject}／${t.name}` }))} /></Field>
          <Field label="クラス"><Select value={classId} onChange={setClassId}
            options={[{ value: "all", label: "全クラス" }, ...ws.classes.map((c) => ({ value: c.id, label: c.label }))]} /></Field>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Badge tone="accent">対象 {target.length} 枚</Badge>
          {loading && <span style={{ fontSize: 12, color: T.textFaint }}>集計しています…</span>}
          <Btn size="sm" disabled={!agg.questions.length} onClick={() => {
            download(`jakuten_${test.subject}.csv`, toCSV(agg.questions, [
              { label: "設問", key: "label" }, { label: "単元", key: "unit" },
              { label: "得点率", key: "rate" }, { label: "正答率", key: "correctRate" }, { label: "人数", key: "n" },
            ]), "text/csv;charset=utf-8");
            toast("設問別の分析を書き出しました");
          }}>CSVを書き出す</Btn>
        </div>
      </Card>

      {error ? (
        <Card><Empty icon="⚠️" title="分析を読み込めませんでした" hint={error} /></Card>
      ) : !loading && agg.units.length === 0 ? (
        <Card><Empty icon="📊" title="分析できる答案がありません" hint="条件を変えるか、新しく採点してください。白紙と採点待ちの答案は集計に含めません。"
          action={<Btn variant="primary" onClick={() => go("new")}>新規採点へ</Btn>} /></Card>
      ) : agg.units.length > 0 && (
        <>
          <div style={{ ...grid(300, 14), marginBottom: 14 }}>
            <Card title="単元別の定着度" sub="クラス全体・低い順">
              <div style={{ display: "grid", gap: 12 }}>
                {agg.units.map((u, i) => (
                  <div key={u.key}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                      <span style={{ color: T.text, fontWeight: 600 }}>
                        {i === 0 && <span style={{ color: T.shu, marginInlineEnd: 5 }}>最優先</span>}{u.key || "（単元なし）"}
                      </span>
                      <span style={{ font: `700 12.5px ${FONT_MONO}`, color: u.rate < 50 ? T.ng : u.rate < 75 ? T.warn : T.ok }}>{u.rate}%</span>
                    </div>
                    <Bar value={u.rate} tone={u.rate < 50 ? "ng" : u.rate < 75 ? "warn" : "ok"} height={9} />
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 13, padding: 11, background: T.warnSoft, borderRadius: 10, fontSize: 12, color: T.text, lineHeight: 1.8 }}>
                <b>指導提案：</b>{agg.units[0].key || "（単元なし）"} は得点率 {agg.units[0].rate}%。
                導入部分の言い換えと、途中式を書かせる演習を次回1時間分追加することを推奨します。
              </div>
            </Card>

            <Card title="設問形式別の得点率" sub="解答の型が身についているか">
              <div style={{ display: "grid", gap: 12 }}>
                {agg.types.map((ty) => (
                  <div key={ty.key}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                      <span style={{ color: T.text, fontWeight: 600 }}>{ty.key}</span>
                      <span style={{ font: `700 12.5px ${FONT_MONO}`, color: ty.rate < 50 ? T.ng : ty.rate < 75 ? T.warn : T.ok }}>{ty.rate}%</span>
                    </div>
                    <Bar value={ty.rate} tone={ty.rate < 50 ? "ng" : ty.rate < 75 ? "warn" : "ok"} height={9} />
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 13, fontSize: 11.5, color: T.textSub, lineHeight: 1.8 }}>
                記述式の得点率が選択式より20ポイント以上低い場合、知識ではなく「書き方」の指導が有効です。
              </div>
            </Card>
          </div>

          <Card title="設問別の正答率" sub="得点率が低い順。授業でどこを取り上げるか決める材料になります" style={{ marginBottom: 14 }}>
            <Table
              maxHeight={330}
              columns={[
                { key: "label", label: "設問" },
                { key: "unit", label: "単元" },
                { key: "correctRate", label: "正答率", align: "right", render: (r: QuestionStat) => (
                  <span style={{ font: `700 12.5px ${FONT_MONO}`, color: r.correctRate < 40 ? T.ng : r.correctRate < 70 ? T.warn : T.ok }}>{r.correctRate}%</span>
                ) },
                { key: "rate", label: "得点率", align: "right", render: (r: QuestionStat) => `${r.rate}%` },
                { key: "bar", label: "", render: (r: QuestionStat) => <div style={{ width: 110 }}><Bar value={r.correctRate} tone={r.correctRate < 40 ? "ng" : r.correctRate < 70 ? "warn" : "ok"} height={6} /></div> },
                { key: "n", label: "人数", align: "right" },
              ]}
              rows={agg.questions}
            />
          </Card>

          <Card title="クラス全体のミス傾向" sub="同じつまずきが何人に出ているか">
            {agg.mistakes.length === 0 ? <Empty icon="🎯" title="目立つ傾向はありません" /> : (
              <div style={grid(230, 10)}>
                {agg.mistakes.slice(0, 9).map((m) => (
                  <div key={m.reason} style={{ border: `1px solid ${T.line}`, borderRadius: 11, padding: 12, background: T.panelAlt }}>
                    <div style={{ font: `700 20px ${FONT_MONO}`, color: T.shu }}>{m.count}<span style={{ fontSize: 11, color: T.textSub, fontWeight: 400 }}> 件</span></div>
                    <div style={{ fontSize: 12.5, color: T.text, marginTop: 5, lineHeight: 1.6 }}>{m.reason}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
