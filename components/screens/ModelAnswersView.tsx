"use client";
// 模範解答管理。docs/prototype-v3.jsx から移植。
import React, { useMemo, useState } from "react";
import { FONT_UI, FONT_HAND } from "@/lib/ui/theme";
import { download, toCSV } from "@/lib/util";
import { buildModelAnswers } from "@/lib/grading/engine";
import { useUI } from "@/components/ui-context";
import { Badge, Btn, Card, Empty, Field, Select, grid } from "@/components/ui";

export default function ModelAnswersView() {
  const { T, toast, ws, testById, go } = useUI();
  const [testId, setTestId] = useState(ws.tests[0]?.id ?? "");
  const test = testById(testId);
  const list = useMemo(() => (test ? buildModelAnswers(test) : []), [test]);

  if (!test) {
    return <Card><Empty icon="📘" title="テストがまだありません" hint="テスト管理でテストと設問を登録すると、模範解答を作成できます。"
      action={<Btn variant="primary" onClick={() => go("tests")}>テスト管理へ</Btn>} /></Card>;
  }

  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Field label="テストを選ぶ">
              <Select value={testId} onChange={setTestId}
                options={ws.tests.map((t) => ({ value: t.id, label: `${t.subject}／${t.name}（${t.grade}年 ${t.term}）` }))} />
            </Field>
          </div>
          <Btn variant="primary" onClick={() => go("tests")}>設問・正答を編集する</Btn>
          <Btn onClick={() => {
            download(`mohan_${test.subject}.csv`, toCSV(list, [
              { label: "設問", key: "label" }, { label: "単元", key: "unit" }, { label: "配点", key: "points" },
              { label: "解答", key: "answer" }, { label: "解説", key: "solution" },
            ]), "text/csv;charset=utf-8");
            toast("模範解答を書き出しました");
          }}>CSVで保存</Btn>
        </div>
        <div style={{ fontSize: 11.5, color: T.textFaint, lineHeight: 1.7 }}>
          {/* PROD-API: 模範解答と解説の生成をClaude APIに委譲 */}
          テスト管理で登録した正答と解説の要点から作成しています。白紙答案を検出したときは、この模範解答が生徒への配布資料として使えます。
        </div>
      </Card>
      <div style={grid(300, 12)}>
        {list.map((m) => (
          <Card key={m.qno} pad={13}>
            <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
              <span style={{ font: `700 13px ${FONT_UI}`, color: T.text }}>{m.label}</span>
              <Badge tone="mute">{m.unit}</Badge>
              <Badge tone="accent">{m.points}点</Badge>
            </div>
            <div style={{ font: `15px ${FONT_HAND}`, color: T.shu, marginBottom: 7 }}>{m.answer}</div>
            <div style={{ fontSize: 12, color: T.textSub, lineHeight: 1.8 }}>{m.solution}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
