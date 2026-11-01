// ローカル採点エンジン（デモ用ルールベース）と、1枚単位の分析・文面生成。
// docs/prototype-v3.jsx から移植。
//
// 本番接続の予定: 採点そのもの（gradeSubmission / checkQuality）は、
//   次の段階で app/api/grade/route.ts 経由の Claude API（Vision）に置き換える。
//   それまでは、このルールベース採点が「AIの下書き」の代わりに動く。
import { mulberry32, pick, clamp, pct } from "@/lib/util";
import type { Item, Mark, QType, Quality, Rubric, Test } from "@/lib/types";

export const QTYPES: { k: QType; label: string }[] = [
  { k: "calc", label: "計算" },
  { k: "choice", label: "選択" },
  { k: "fill", label: "穴埋め" },
  { k: "short", label: "短文記述" },
  { k: "long", label: "長文記述" },
  { k: "graph", label: "作図・グラフ" },
];

export const typeLabelOf = (k: string) => (QTYPES.find((q) => q.k === k) || { label: k }).label;

export const WRONG_POOL: Record<string, string[]> = {
  calc: ["符号ミス", "移項の誤り", "分母の処理", "途中式で計算違い", "単位の書き忘れ"],
  choice: ["ひっかけ選択肢を選択", "設問条件の読み落とし", "消去法の途中で誤り"],
  fill: ["語尾の活用ミス", "スペルミス", "漢字の誤り", "用語の混同"],
  short: ["理由の説明が不足", "設問の要求語数に未達", "根拠の引用がない"],
  long: ["論の展開が途中で終了", "結論が主張とずれる", "本文根拠の提示がない"],
  graph: ["目盛りの取り方が不正確", "軸ラベルの記入漏れ"],
};

export const PRAISE = [
  "式の立て方が正確です。",
  "途中式がていねいで読みやすい。",
  "根拠の示し方がよい。",
  "設問の条件をよく読めています。",
  "前回より記述量が増えました。",
];

/**
 * デモモードと「仮採点」（採点AIが無い環境で、明示して選んだときだけ）の採点。答案は読まない（乱数）。
 * 本物の採点は採点AI（lib/ai/grade.ts・app/api/grade）が行う。
 */
export type GradeOptions = { forceBlank?: boolean; reviewThreshold?: number };

export function gradeSubmission(test: Test, _student: unknown, seed: number, opts: GradeOptions = {}) {
  const rnd = mulberry32(seed);
  const ability = 0.45 + rnd() * 0.5;                 // 生徒ごとの実力
  const weakUnit = test.units[Math.floor(rnd() * test.units.length)];
  const blank = !!opts.forceBlank;
  // 認識信頼度がこの値を下回る設問は要確認へ回す（採点基準管理の「要確認に回す信頼度」）
  const threshold = (opts.reviewThreshold ?? 72) / 100;

  const items: (Item & { questionId: string })[] = test.questions.map((q) => {
    if (blank) {
      return {
        id: `${q.id}_item`, questionId: q.id,
        qno: q.no, label: q.label, unit: q.unit, type: q.type, typeLabel: q.typeLabel,
        points: q.points, detected: "", confidence: 0.99, blank: true,
        mark: "-", earned: 0, needReview: false, reason: "無記入", comment: "",
      };
    }
    const unitPenalty = q.unit === weakUnit ? 0.28 : 0;
    const diffPenalty = q.difficulty === "難" ? 0.18 : q.difficulty === "標準" ? 0.06 : 0;
    const p = clamp(ability - unitPenalty - diffPenalty + (rnd() - 0.5) * 0.18, 0.02, 0.98);
    const roll = rnd();
    let mark: Mark, earned: number, reason = "", comment = "";
    const partialCapable = q.type === "short" || q.type === "long" || q.type === "calc" || q.type === "graph";

    if (roll < p) {
      mark = "○"; earned = q.points; comment = rnd() < 0.35 ? pick(rnd, PRAISE) : "";
    } else if (partialCapable && roll < p + 0.22) {
      mark = "△";
      earned = Math.max(1, Math.round(q.points * (rnd() < 0.5 ? 0.5 : 0.75)));
      reason = pick(rnd, WRONG_POOL[q.type] || WRONG_POOL.short);
      comment = `${reason}。あと一歩で満点です。`;
    } else {
      mark = "×"; earned = 0;
      reason = pick(rnd, WRONG_POOL[q.type] || WRONG_POOL.short);
      comment = `${reason}。${q.model}`;
    }

    // 認識信頼度（低いものは要確認へ回す）
    let confidence = clamp(0.84 + rnd() * 0.15, 0, 0.99);
    if (q.type === "long" || q.type === "short") confidence -= rnd() * 0.09;
    if (rnd() < 0.022) confidence = 0.44 + rnd() * 0.22;  // 判読困難
    confidence = clamp(confidence, 0.35, 0.99);
    const needReview = confidence < threshold;

    const detected =
      q.type === "choice" ? (mark === "○" ? q.correct : pick(rnd, ["ア", "イ", "ウ", "エ"]))
      : q.type === "calc" ? (mark === "○" ? q.correct : String(Number(q.correct) + (Math.floor(rnd() * 8) - 4)))
      : q.type === "fill" ? (mark === "○" ? q.correct : q.correct + (rnd() < 0.5 ? "い" : "s"))
      : mark === "○" ? "（記述：要点を満たす解答）"
      : mark === "△" ? "（記述：一部の要点が不足）"
      : "（記述：要点を満たさない解答）";

    return {
      id: `${q.id}_item`, questionId: q.id,
      qno: q.no, label: q.label, unit: q.unit, type: q.type, typeLabel: q.typeLabel,
      points: q.points, detected, confidence: Math.round(confidence * 100) / 100,
      blank: false, mark, earned, needReview,
      reason, comment,
    };
  });

  const total = items.reduce((a, i) => a + i.earned, 0);
  return { items, total, blank, weakUnit };
}

/** 画像品質の値（デモ・仮採点用の乱数。AI採点では採点AIが画質を判定する） */
export function checkQuality(seed: number, forceIssue = false): Quality {
  const rnd = mulberry32(seed);
  const v = (base) => Math.round(clamp(base + rnd() * 0.25, 0, 1) * 100);
  const q = {
    tilt: v(0.78), brightness: v(0.8), blur: v(0.82),
    shadow: v(0.79), coverage: v(0.86), contrast: v(0.8),
  };
  if (forceIssue) { q.blur = 41; q.shadow = 48; }
  const issues: { k: string; msg: string }[] = [];
  if (q.tilt < 60) issues.push({ k: "傾き", msg: "用紙が傾いています。枠に合わせて撮り直してください。" });
  if (q.brightness < 60) issues.push({ k: "明るさ", msg: "暗すぎます。明るい場所で撮影してください。" });
  if (q.blur < 60) issues.push({ k: "ぼやけ", msg: "ピントが合っていません。手ぶれに注意して再撮影してください。" });
  if (q.shadow < 60) issues.push({ k: "影・反射", msg: "影が写り込んでいます。光源の位置を変えてください。" });
  if (q.coverage < 60) issues.push({ k: "見切れ", msg: "答案の端が写っていません。全体が入るように撮影してください。" });
  const fixes = ["自動トリミング", "台形補正", "傾き補正", "コントラスト補正", "ノイズ除去"];
  return { scores: q, issues, fixes, ok: issues.length === 0, avg: Math.round(Object.values(q).reduce((a, b) => a + b, 0) / 6) };
}

/** 弱点分析（単元別・設問形式別・ミス傾向） */
/** 1枚の答案の弱点分析（単元別・設問形式別・ミス傾向）。
 *  クラス全体の集計はここでは行わない（Postgres の分析ビューで集計する）。 */
export function analyze(_test: Test, result: { items: Item[] }) {
  const byUnit: Record<string, { unit: string; earned: number; points: number; wrong: number; n: number }> = {};
  const byType: Record<string, { type: string; earned: number; points: number; n: number }> = {};
  const mistakes: Record<string, number> = {};
  result.items.forEach((it) => {
    const u = (byUnit[it.unit] = byUnit[it.unit] || { unit: it.unit, earned: 0, points: 0, wrong: 0, n: 0 });
    u.earned += it.earned; u.points += it.points; u.n++;
    if (it.mark !== "○") u.wrong++;
    const ty = (byType[it.typeLabel] = byType[it.typeLabel] || { type: it.typeLabel, earned: 0, points: 0, n: 0 });
    ty.earned += it.earned; ty.points += it.points; ty.n++;
    if (it.reason) mistakes[it.reason] = (mistakes[it.reason] || 0) + 1;
  });
  const units = Object.values(byUnit).map((u) => ({ ...u, rate: pct(u.earned, u.points) })).sort((a, b) => a.rate - b.rate);
  const types = Object.values(byType).map((t) => ({ ...t, rate: pct(t.earned, t.points) })).sort((a, b) => a.rate - b.rate);
  const topMistakes = Object.entries(mistakes).map(([k, v]) => ({ reason: k, count: v })).sort((a, b) => b.count - a.count);
  return { units, types, topMistakes };
}

/** 生徒向けフィードバック / 教師向け指導提案（採点結果と単元から、定型文で作る） */
export function buildFeedback(test: Test, result: { items: Item[]; total: number }, ana: ReturnType<typeof analyze>) {
  const rate = pct(result.total, test.maxScore);
  // この答案だけで確認できる事実を使い、クラス全体や授業の良否は推測しない。
  const units = ana.units.filter((u) => u.unit?.trim() && u.points > 0);
  const weakest = units.find((u) => u.rate < 100);
  const strongest = [...units].reverse().find((u) => u.rate >= 80);
  const weakType = ana.types.find((t) => t.points > 0 && t.rate < 100);
  const scored = result.items.filter((i) => i.points > 0);
  const fullMarks = scored.length > 0 && scored.every((i) => i.earned >= i.points);
  const pending = result.items.some((i) => i.needReview);
  const student = [
    `今回の得点は ${result.total} / ${test.maxScore} 点（得点率 ${rate}%）でした。`,
    fullMarks
      ? "今回の答案は全問満点でした。解答の根拠や手順も、自分の言葉で説明できるか確かめてみましょう。"
      : strongest ? `${strongest.unit}の得点率は${strongest.rate}%でした。正解した問題の考え方を振り返りましょう。` : "",
    !fullMarks && weakest ? `${weakest.unit}の得点率は${weakest.rate}%でした。満点でなかった問題を選び、模範解答と比べて、どの手順や説明を直せばよいか確認しましょう。`
      : !fullMarks && scored.length ? "満点でなかった問題について、答案と模範解答を比べて復習しましょう。" : "",
    !scored.length ? "採点対象の設問がないため、学習内容への助言はまだ作成できません。" : "",
    pending ? "先生の確認が必要な設問があります。確認後の得点・コメントをもとに復習してください。" : "",
  ].filter(Boolean);
  const teacher = [
    "この提案は、この生徒の今回の答案に基づく参考です。クラス全体の理解度や授業の効果は、この答案だけでは判断できません。",
    fullMarks ? "今回の答案は全問満点です。この結果から補習が必要とは判断できません。発展学習の案として、解法の理由を説明させる、別解を比較する、条件を変えた問題を考えさせる活動が考えられます。"
      : weakest ? `この答案では「${weakest.unit}」の得点率が${weakest.rate}%でした。満点でなかった設問の解答を確認し、理解の不足・計算や記述の誤り・設問の読み違いのどれに当たるか、生徒の説明と照らして確かめてください。`
      : scored.length ? "満点でなかった設問の答案と採点基準を確認し、生徒に解き方を説明してもらって、つまずいた箇所を確かめてください。" : "採点対象の設問がないため、指導提案を作成する材料がありません。",
    !fullMarks && weakType ? `「${weakType.type}」形式の得点率は${weakType.rate}%（${weakType.n}問）でした。個別の誤答を確認したうえで、必要な手順を一緒に整理する指導を検討してください。` : "",
    units.length < ana.units.length ? "単元が未登録の設問があります。単元別に分析する場合は、テストの設問に単元を登録してください。" : "",
    "授業改善を検討するときは、クラス全体の設問別結果と授業中の様子を確認し、共通するつまずきがあれば説明や練習方法を見直してください。",
    pending ? "未確認の設問が残っています。返却前に「要確認一覧」で答案を目視確認してください。" : "",
  ].filter(Boolean);
  const nextStep = !scored.length ? ["設問と採点結果を確認する"]
    : fullMarks ? ["正解した問題を1問選び、解法の理由を説明する", "別の解き方や、条件を変えた問題に挑戦する"]
    : [weakest ? `${weakest.unit}で満点でなかった問題を1問選び、解き直す` : "満点でなかった問題を1問選び、解き直す", "模範解答と比べ、直した箇所とその理由を記録する"];
  return { student, teacher, nextStep, rate };
}

/** 全問白紙のときの模範解答（テストに登録した正答・解説から、定型文で作る） */
export function buildModelAnswers(test: Test) {
  return test.questions.map((q) => ({
    qno: q.no, label: q.label, unit: q.unit, points: q.points,
    answer: q.correct === "（記述解答）" ? q.model : q.correct,
    solution: `${q.model} 配点 ${q.points} 点。${q.type === "long" ? "結論→根拠→まとめの順で書くと要点を落としません。" : q.type === "calc" ? "途中式を残すと部分点の対象になります。" : "設問の条件語（すべて／ひとつ）に線を引いて確認します。"}`,
    keywords:
      q.type === "long" || q.type === "short"
        ? ["結論", "根拠", "本文引用"]
        : q.type === "calc" ? ["立式", "計算", "単位"] : ["用語", "表記"],
  }));
}

export const SOURCES: Record<string, { label: string; icon: string }> = {
  mobile: { label: "生徒モバイル提出", icon: "📱" },
  camera: { label: "教師カメラ撮影", icon: "📷" },
  mfp: { label: "印刷機・コピー機スキャン", icon: "🖨" },
  file: { label: "PCからファイル選択", icon: "💻" },
  pdf: { label: "PDF一括", icon: "📄" },
};

export const STATUS_META: Record<string, { label: string; tone: string }> = {
  done: { label: "採点済", tone: "ok" },
  review: { label: "要確認", tone: "warn" },
  quality: { label: "画質注意", tone: "ng" },
  blank: { label: "白紙", tone: "mute" },
  processing: { label: "採点中", tone: "info" },
  uploaded: { label: "取込済", tone: "info" },
};

export const PIPELINE = [
  { k: "quality", n: 1, title: "画像品質確認", detail: "傾き・向き・明るさ・影・ぼやけ・見切れを検査し、自動トリミング／台形補正／傾き補正／コントラスト補正／ノイズ除去を適用します。" },
  { k: "test", n: 2, title: "テスト情報の抽出", detail: "教科・テスト名・学年・学期・実施日・試験番号・問題数・各設問の配点・満点・単元・記述欄の位置を読み取ります。" },
  { k: "student", n: 3, title: "生徒情報の認識", detail: "出席番号・学籍番号・クラス・受験番号を読み取り、匿名IDに置き換えます。実名は保存しません。同一生徒の複数ページを自動で束ねます。" },
  { k: "answer", n: 4, title: "解答内容の認識", detail: "数字・計算式・日本語・英語・選択肢・記号・図形・化学式・手書き文字・複数行回答を認識します。消しゴム跡や書き直しも可能な範囲で判定します。" },
  { k: "grade", n: 5, title: "全問の自動採点", detail: "採点基準に沿って正誤と部分点を判定し、赤ペン採点画像・弱点分析・フィードバックを生成します。" },
];

/** 採点基準の初期値（学校の既定値が未登録のときに使う） */
export const DEFAULT_RUBRIC: Rubric = {
  matchRate: 70, partialStep: 3, reviewThreshold: 72,
  allowKana: true, allowSpell: true, unitPartial: true, workPartial: true,
  caseSensitive: false, outsideBox: true,
  requireTeacher: true, autoModel: true, strictQuality: false, praiseFull: true,
};
