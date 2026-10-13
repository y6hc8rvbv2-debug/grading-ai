"use client";
// 採点基準管理。docs/prototype-v3.jsx から移植。学校の既定の採点基準として保存する。
import React, { useState } from "react";
import { FONT_MONO } from "@/lib/ui/theme";
import { DEFAULT_RUBRIC } from "@/lib/grading/engine";
import { friendlyError } from "@/lib/errors";
import { useUI } from "@/components/ui-context";
import { Btn, Card, grid } from "@/components/ui";
import type { Rubric } from "@/lib/types";

type RProps = { label: string; k: keyof Rubric; hint?: string; R: Rubric; set: (k: keyof Rubric, v: any) => void };

function RSlider({ label, k, min, max, step = 1, unit, hint, R, set }: RProps & { min: number; max: number; step?: number; unit: string }) {
  const { T } = useUI();
  return (
    <div style={{ marginBottom: 15 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{label}</span>
        <span style={{ font: `700 13px ${FONT_MONO}`, color: T.accent }}>{R[k]}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={R[k] as number}
        onChange={(e) => set(k, Number(e.target.value))}
        style={{ width: "100%", accentColor: T.accent }} />
      {hint && <div style={{ fontSize: 11, color: T.textFaint, marginTop: 4, lineHeight: 1.6 }}>{hint}</div>}
    </div>
  );
}

function RToggle({ label, k, hint, R, set }: RProps) {
  const { T } = useUI();
  return (
    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", borderBottom: `1px solid ${T.line}`, cursor: "pointer" }}>
      <input type="checkbox" checked={!!R[k]} onChange={(e) => set(k, e.target.checked)} style={{ marginTop: 3 }} />
      <span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: T.text, display: "block" }}>{label}</span>
        {hint && <span style={{ fontSize: 11.5, color: T.textSub, lineHeight: 1.7 }}>{hint}</span>}
      </span>
    </label>
  );
}

export default function RubricView() {
  const { T, rubric, setRubric, toast, ds } = useUI();
  const [R, setR] = useState<Rubric>(rubric);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(R) !== JSON.stringify(rubric);
  const set = (k: keyof Rubric, v: any) => setR({ ...R, [k]: v });

  const save = async (next: Rubric, msg: string) => {
    setSaving(true);
    try {
      await ds.saveRubric(next);
      setRubric(next);
      setR(next);
      toast(msg);
    } catch (e) {
      toast(friendlyError(e, "採点基準の保存"), "ng");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={grid(320, 14)}>
      <Card title="採点のきびしさ" sub="記述問題の判定に使うしきい値">
        <RSlider R={R} set={set} label="要点一致率のしきい値" k="matchRate" min={40} max={100} unit="%"
          hint="模範解答の要点をこの割合以上満たしたら正解にします。下げると部分点が出やすくなります。" />
        <RSlider R={R} set={set} label="部分点の刻み" k="partialStep" min={1} max={4} unit=" 段階"
          hint="1段階＝○×のみ。3段階＝○／△（半分）／×。" />
        <RSlider R={R} set={set} label="要確認に回す信頼度" k="reviewThreshold" min={50} max={95} unit="%"
          hint="認識信頼度がこの値を下回る設問は、自動で「要確認一覧」に送られます。" />
      </Card>

      <Card title="表記の扱い" sub="どこまでを正解として認めるか">
        <RToggle R={R} set={set} label="漢字・かなの表記ゆれを許容する" k="allowKana" hint="例：「保存される」と「ほぞんされる」を同じ扱いにします。" />
        <RToggle R={R} set={set} label="英語のスペルミスを部分点にする" k="allowSpell" hint="1文字違いまでは△として扱います。" />
        <RToggle R={R} set={set} label="単位の書き忘れを減点にとどめる" k="unitPartial" hint="数値が合っていれば配点の半分を与えます。" />
        <RToggle R={R} set={set} label="途中式が正しければ部分点を与える" k="workPartial" hint="最終解が誤りでも立式が正しい場合に加点します。" />
        <RToggle R={R} set={set} label="大文字・小文字を区別する" k="caseSensitive" />
        <RToggle R={R} set={set} label="解答欄外の記入も採点対象にする" k="outsideBox" hint="欄からはみ出した記述も認識して採点します。" />
      </Card>

      <Card title="運用ルール" sub="返却前のチェック体制">
        <RToggle R={R} set={set} label="記述問題は必ず教師確認を必須にする" k="requireTeacher" hint="確認するまで返却済みにできません。" />
        <RToggle R={R} set={set} label="全問白紙のとき模範解答を自動生成する" k="autoModel" />
        <RToggle R={R} set={set} label="画質不良の答案は採点せず再撮影を依頼する" k="strictQuality" />
        <RToggle R={R} set={set} label="満点の答案にも一言コメントを付ける" k="praiseFull" />
        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <Btn variant="primary" disabled={saving || !dirty} onClick={() => save(R, "採点基準を保存しました")}>
            {saving ? "保存しています…" : "基準を保存"}
          </Btn>
          <Btn disabled={saving} onClick={() => save(DEFAULT_RUBRIC, "採点基準を初期設定に戻しました")}>初期設定に戻す</Btn>
        </div>
        <div style={{ fontSize: 11.5, color: dirty ? T.warn : T.textFaint, marginTop: 8 }}>
          {dirty ? "変更はまだ保存されていません。" : "学校の既定の採点基準として保存されています。"}
        </div>
      </Card>
    </div>
  );
}
