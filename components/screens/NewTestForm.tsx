"use client";
// テストの登録フォーム（テスト情報 + 設問ごとの形式・単元・配点・正答）。
// プロトタイプには無かった画面。Supabase では tests / questions に保存される。
import React, { useState } from "react";
import { FONT_MONO } from "@/lib/ui/theme";
import { QTYPES } from "@/lib/grading/engine";
import { friendlyError } from "@/lib/errors";
import { useUI } from "@/components/ui-context";
import { Btn, Field, Input, Modal, Select, grid, inputStyle } from "@/components/ui";
import type { NewTestInput, QType } from "@/lib/types";

type Row = NewTestInput["questions"][number] & { key: number };

const DIFFICULTIES = ["基本", "標準", "難"];
const defaultPoints = (t: QType) => (t === "long" ? 8 : t === "short" || t === "graph" ? 6 : 4);
let rowKey = 0;
const newRow = (unit = "", type: QType = "calc"): Row => ({
  key: ++rowKey, type, unit, points: defaultPoints(type), correct: "", model: "", difficulty: "標準",
});

export default function NewTestForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { T, ds, toast, refresh } = useUI();
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("数学");
  const [grade, setGrade] = useState("2");
  const [term, setTerm] = useState("1学期");
  const [date, setDate] = useState("");
  const [testNo, setTestNo] = useState("");
  const [unitsText, setUnitsText] = useState("");
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [bulk, setBulk] = useState("5");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const units = unitsText.split(/[,、，\n]/).map((u) => u.trim()).filter(Boolean);
  const total = rows.reduce((a, r) => a + (Number(r.points) || 0), 0);

  const update = (key: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const reset = () => {
    setName(""); setTestNo(""); setDate(""); setUnitsText(""); setRows([newRow()]); setError("");
  };

  const validate = (): string => {
    if (!name.trim()) return "テスト名を入力してください。";
    if (!subject.trim()) return "教科を入力してください。";
    const g = Number(grade);
    if (!Number.isInteger(g) || g < 1 || g > 12) return "学年は1〜12の数字で入力してください。";
    if (!rows.length) return "設問を1問以上追加してください。";
    const badPoints = rows.findIndex((r) => !Number.isInteger(Number(r.points)) || Number(r.points) < 1 || Number(r.points) > 100);
    if (badPoints >= 0) return `${badPoints + 1}問目の配点は1〜100の整数にしてください。`;
    if (units.length) {
      const badUnit = rows.findIndex((r) => r.unit && !units.includes(r.unit));
      if (badUnit >= 0) return `${badUnit + 1}問目の単元「${rows[badUnit].unit}」が単元の一覧にありません。`;
    }
    return "";
  };

  const save = async () => {
    const msg = validate();
    if (msg) { setError(msg); return; }
    setError(""); setSaving(true);
    try {
      await ds.createTest({
        name: name.trim(), subject: subject.trim(), grade: Number(grade), term: term.trim(),
        date, testNo: testNo.trim(), units,
        questions: rows.map((r) => ({
          type: r.type, unit: r.unit || units[0] || "", points: Number(r.points),
          correct: r.correct.trim(), model: r.model.trim(), difficulty: r.difficulty,
        })),
      });
      await refresh();
      toast(`「${name.trim()}」を登録しました。新規採点で選べます`);
      reset();
      onClose();
    } catch (e) {
      setError(friendlyError(e, "テストの登録"));
    } finally {
      setSaving(false);
    }
  };

  const cell: React.CSSProperties = { ...inputStyle(T), padding: "6px 8px", fontSize: 12.5 };

  return (
    <Modal open={open} onClose={() => { if (!saving) onClose(); }} title="テストを追加" width={980}
      footer={<>
        <span style={{ flex: 1, fontSize: 12.5, color: error ? T.ng : T.textSub, alignSelf: "center" }}>
          {error || `${rows.length} 問・満点 ${total} 点`}
        </span>
        <Btn onClick={onClose} disabled={saving}>キャンセル</Btn>
        <Btn variant="primary" onClick={save} disabled={saving}>{saving ? "登録しています…" : "登録する"}</Btn>
      </>}>
      <div style={grid(200, 12)}>
        <Field label="テスト名（必須）"><Input value={name} onChange={setName} placeholder="例：1学期期末テスト" /></Field>
        <Field label="教科（必須）"><Input value={subject} onChange={setSubject} placeholder="例：数学" /></Field>
        <Field label="学年"><Input value={grade} onChange={setGrade} type="number" /></Field>
        <Field label="学期"><Input value={term} onChange={setTerm} placeholder="例：1学期" /></Field>
        <Field label="実施日"><Input value={date} onChange={setDate} type="date" /></Field>
        <Field label="試験番号"><Input value={testNo} onChange={setTestNo} placeholder="例：M-2026-05" /></Field>
      </div>
      <Field label="単元（読点・カンマ区切り）" hint="弱点分析は単元ごとに集計します。例：式の計算、連立方程式、一次関数">
        <Input value={unitsText} onChange={setUnitsText} placeholder="式の計算、連立方程式、一次関数" />
      </Field>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "6px 0 10px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.text, flex: 1 }}>設問</div>
        <input type="number" min={1} max={40} value={bulk} onChange={(e) => setBulk(e.target.value)} aria-label="まとめて追加する問題数"
          style={{ ...cell, width: 64 }} />
        <Btn size="sm" onClick={() => {
          const n = Math.min(40, Math.max(1, Number(bulk) || 1));
          const last = rows[rows.length - 1];
          setRows((prev) => [...prev, ...Array.from({ length: n }, () => newRow(last?.unit ?? units[0] ?? "", last?.type ?? "calc"))]);
        }}>問まとめて追加</Btn>
        <Btn size="sm" variant="soft" onClick={() => setRows((prev) => [...prev, newRow(prev[prev.length - 1]?.unit ?? units[0] ?? "")])}>＋ 1問追加</Btn>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820, fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: T.textSub, fontSize: 11 }}>
              {["No.", "形式", "単元", "配点", "難易度", "正答", "模範解答・解説の要点", ""].map((h) => (
                <th key={h} style={{ textAlign: "start", padding: "6px 5px", borderBottom: `1px solid ${T.lineStrong}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td style={{ padding: 4, font: `700 12px ${FONT_MONO}`, color: T.textSub }}>{i + 1}</td>
                <td style={{ padding: 4, width: 120 }}>
                  <Select value={r.type} style={cell}
                    onChange={(v: string) => update(r.key, { type: v as QType, points: defaultPoints(v as QType) })}
                    options={QTYPES.map((q) => ({ value: q.k, label: q.label }))} />
                </td>
                <td style={{ padding: 4, width: 150 }}>
                  {units.length ? (
                    <Select value={r.unit} style={cell} onChange={(v: string) => update(r.key, { unit: v })}
                      options={[{ value: "", label: "（選ぶ）" }, ...units.map((u) => ({ value: u, label: u }))]} />
                  ) : (
                    <input value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })} placeholder="単元" style={cell} />
                  )}
                </td>
                <td style={{ padding: 4, width: 70 }}>
                  <input type="number" min={1} max={100} value={r.points} aria-label={`${i + 1}問目の配点`}
                    onChange={(e) => update(r.key, { points: Number(e.target.value) })} style={{ ...cell, textAlign: "center" }} />
                </td>
                <td style={{ padding: 4, width: 90 }}>
                  <Select value={r.difficulty} style={cell} onChange={(v: string) => update(r.key, { difficulty: v })}
                    options={DIFFICULTIES.map((d) => ({ value: d, label: d }))} />
                </td>
                <td style={{ padding: 4 }}>
                  <input value={r.correct} onChange={(e) => update(r.key, { correct: e.target.value })} aria-label={`${i + 1}問目の正答`}
                    placeholder={r.type === "choice" ? "ア" : r.type === "long" || r.type === "short" ? "（記述）" : "正答"} style={cell} />
                </td>
                <td style={{ padding: 4 }}>
                  <input value={r.model} onChange={(e) => update(r.key, { model: e.target.value })} aria-label={`${i + 1}問目の解説`}
                    placeholder="採点の要点・解き方" style={cell} />
                </td>
                <td style={{ padding: 4, width: 36 }}>
                  <Btn size="sm" variant="ghost" onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                    disabled={rows.length <= 1} title="この設問を削除">✕</Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 10, lineHeight: 1.7 }}>
        設問番号は「大問1-(1)」のように4問ずつ自動で振ります。正答と解説の要点は、採点AIが部分点を判定するときの基準になります。
      </div>
    </Modal>
  );
}
