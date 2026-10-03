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
 * 1枚の答案を採点する。
 * PROD-API: 実運用では画像を Claude API (vision) に送り、
 *   ①手書き文字認識 ②配点に沿った採点 ③部分点判定 を実行して results を受け取る。
 *   例) POST https://api.anthropic.com/v1/messages
 *       model: "claude-sonnet-4-6", content: [{type:"image", source:{...}}, {type:"text", text: rubricPrompt}]
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

/** 画像品質チェック（PROD-API: 実運用では前処理サーバ or Vision でスコアリング） */
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

/** 生徒向けフィードバック / 教師向け指導提案（PROD-API: 生成AIで文面生成） */
export function buildFeedback(test: Test, result: { items: Item[]; total: number }, ana: ReturnType<typeof analyze>) {
  const rate = pct(result.total, test.maxScore);
  const weakest = ana.units[0];
  const strongest = ana.units[ana.units.length - 1];
  const student = [
    `今回の得点は ${result.total} / ${test.maxScore} 点（得点率 ${rate}%）でした。`,
    strongest ? `${strongest.unit} は ${strongest.rate}% と安定しています。この解き方は続けてください。` : "",
    weakest ? `いちばん伸びしろがあるのは ${weakest.unit}（${weakest.rate}%）です。まず教科書の例題を3問、途中式まで書き直してみましょう。` : "",
    ana.topMistakes[0] ? `ミスの傾向は「${ana.topMistakes[0].reason}」が ${ana.topMistakes[0].count} 回。見直しのときはここだけを重点的に確認します。` : "",
  ].filter(Boolean);
  const teacher = [
    weakest ? `${weakest.unit} の定着が不十分（クラス平均比で要確認）。導入の言い換えを1時間分追加することを推奨します。` : "",
    ana.types[0] ? `設問形式では「${ana.types[0].type}」の得点率が ${ana.types[0].rate}% と最も低く、解答手順の型を示す指導が有効です。` : "",
    ana.topMistakes.length ? `頻出ミス：${ana.topMistakes.slice(0, 3).map((m) => `${m.reason}(${m.count})`).join(" / ")}` : "",
    result.items.some((i) => i.needReview) ? `認識信頼度の低い設問があります。返却前に「要確認一覧」で目視確認してください。` : "",
  ].filter(Boolean);
  const nextStep = weakest
    ? [`${weakest.unit} の基礎問題 5 問`, `${weakest.unit} の応用問題 2 問`, "誤答ノートに「なぜ間違えたか」を1行で記録"]
    : ["現状維持で応用問題に挑戦"];
  return { student, teacher, nextStep, rate };
}

/** 全問白紙のときの模範解答生成（PROD-API: 生成AIで解説文を作成） */
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
