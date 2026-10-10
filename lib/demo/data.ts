// デモデータ（Supabase 未設定時のデモモード専用）。docs/prototype-v3.jsx から移植。
// 本番（Supabase 接続時）はこのファイルを一切使わない。
import { mulberry32, pick } from "@/lib/util";
import { QTYPES, gradeSubmission, checkQuality } from "@/lib/grading/engine";
import type { ClassRoom, Question, Source, Student, Submission, Test } from "@/lib/types";

export const DEMO_CLASSES: ClassRoom[] = [
  { id: "c1", grade: 2, name: "A", label: "2年A組", teacher: "担任 T.K", size: 9 },
  { id: "c2", grade: 2, name: "B", label: "2年B組", teacher: "担任 M.S", size: 8 },
  { id: "c3", grade: 3, name: "A", label: "3年A組", teacher: "担任 H.N", size: 8 },
];

const INITIALS = [
  "A.S","T.K","M.Y","K.H","R.I","S.N","Y.M","N.O","H.T","D.F",
  "E.W","J.A","C.U","F.K","G.S","I.M","L.T","O.N","P.R","Q.S",
  "U.K","V.M","W.T","X.Y","Z.A",
];

function buildStudents(): Student[] {
  const out: Student[] = [];
  let seq = 0;
  DEMO_CLASSES.forEach((c) => {
    for (let i = 1; i <= c.size; i++) {
      seq++;
      out.push({
        id: `s_${c.id}_${i}`,
        classId: c.id,
        number: i,                                   // 出席番号
        examNo: `${c.grade}${c.name}${String(i).padStart(2, "0")}`, // 受験番号
        anonId: `生徒${String(seq).padStart(3, "0")}`,
        initials: INITIALS[(seq - 1) % INITIALS.length],
        // 実名は取得しても保存しない設計（フィールド自体を持たない）
        support: seq % 11 === 0,   // 特別支援配慮対象
        note: seq % 7 === 0 ? "読字に配慮（拡大表示推奨）" : "",
      });
    }
  });
  return out;
}
export const DEMO_STUDENTS = buildStudents();

const TEST_DEFS = [
  {
    id: "t1",
    name: "1学期期末テスト",
    subject: "数学",
    grade: 2,
    term: "1学期",
    date: "2026-07-08",
    testNo: "M-2026-05",
    examNo: "07",
    units: ["式の計算", "連立方程式", "一次関数", "図形の性質"],
    seed: 11,
    qCount: 14,
  },
  {
    id: "t2",
    name: "第2回定期考査",
    subject: "英語",
    grade: 2,
    term: "1学期",
    date: "2026-07-09",
    testNo: "E-2026-05",
    examNo: "08",
    units: ["現在完了", "不定詞", "比較", "長文読解"],
    seed: 23,
    qCount: 13,
  },
  {
    id: "t3",
    name: "単元テスト（化学変化）",
    subject: "理科",
    grade: 2,
    term: "1学期",
    date: "2026-07-02",
    testNo: "S-2026-03",
    examNo: "05",
    units: ["化学変化と原子", "化学反応式", "質量保存", "実験の考察"],
    seed: 37,
    qCount: 12,
  },
  {
    id: "t4",
    name: "実力テスト",
    subject: "国語",
    grade: 3,
    term: "1学期",
    date: "2026-07-10",
    testNo: "J-2026-06",
    examNo: "09",
    units: ["漢字・語句", "説明的文章", "文学的文章", "古典"],
    seed: 53,
    qCount: 12,
  },
];

const MODEL_TEXT: Record<string, string[]> = {
  数学: [
    "移項して整理し、両辺を係数で割る。",
    "加減法で y を消去してから x を求める。",
    "傾き a を 2 点から求め、切片 b を代入して決定する。",
    "対頂角と錯角が等しいことを用いて示す。",
  ],
  英語: [
    "現在完了（have + 過去分詞）で継続を表す。",
    "to 不定詞の名詞的用法で目的語にする。",
    "比較級 + than を用いて 2 つを比べる。",
    "本文3段落目の指示語が指す内容をまとめる。",
  ],
  理科: [
    "原子の種類と数が反応の前後で変わらないことを示す。",
    "化学反応式は左右で原子数をそろえて書く。",
    "密閉容器では質量は保存される。",
    "対照実験の条件を1つだけ変えて比較する。",
  ],
  国語: [
    "文脈から漢字の訓読みを判断して書く。",
    "筆者の主張は最終段落に集約されている。",
    "情景描写が心情の変化を暗示している。",
    "係り結びの法則により文末が連体形になる。",
  ],
};

function buildQuestions(def: (typeof TEST_DEFS)[number]): Question[] {
  const rnd = mulberry32(def.seed);
  const qs: Question[] = [];
  let big = 0;
  for (let i = 1; i <= def.qCount; i++) {
    if (i === 1 || i % 4 === 1) big++;
    const type = i <= 4 ? "calc" : i <= 7 ? "choice" : i <= 9 ? "fill" : i <= 12 ? "short" : "long";
    const t = def.subject === "国語" && type === "calc" ? "fill" : type;
    const points = t === "long" ? 8 : t === "short" ? 6 : 4;
    const unit = def.units[Math.min(def.units.length - 1, Math.floor((i - 1) / Math.ceil(def.qCount / def.units.length)))];
    qs.push({
      id: `${def.id}_q${i}`,
      no: i,
      big,
      label: `大問${big}-(${((i - 1) % 4) + 1})`,
      type: t as Question["type"],
      typeLabel: (QTYPES.find((q) => q.k === t) || {}).label || t,
      unit,
      points,
      model: pick(rnd, MODEL_TEXT[def.subject] || MODEL_TEXT["数学"]),
      correct:
        t === "choice"
          ? pick(rnd, ["ア", "イ", "ウ", "エ"])
          : t === "calc"
          ? String(Math.floor(rnd() * 40) - 10)
          : t === "fill"
          ? pick(rnd, ["等しい", "increase", "保存", "連体形", "3x-2", "比較級"])
          : "（記述解答）",
      difficulty: rnd() < 0.25 ? "難" : rnd() < 0.6 ? "標準" : "基本",
    });
  }
  return qs;
}

export const DEMO_TESTS: Test[] = TEST_DEFS.map((d) => {
  const questions = buildQuestions(d);
  return {
    ...d,
    questions,
    maxScore: questions.reduce((a, q) => a + q.points, 0),
    bigCount: questions[questions.length - 1].big,
  };
});
const testById = (id: string) => DEMO_TESTS.find((t) => t.id === id);

export function buildDemoSubmissions(): Submission[] {
  const plan = [
    { testId: "t1", classId: "c1", base: 100 },
    { testId: "t1", classId: "c2", base: 200 },
    { testId: "t2", classId: "c1", base: 300 },
    { testId: "t3", classId: "c2", base: 400 },
    { testId: "t4", classId: "c3", base: 500 },
  ];
  const out: Submission[] = [];
  plan.forEach((p) => {
    const test = testById(p.testId)!;
    const roster = DEMO_STUDENTS.filter((s) => s.classId === p.classId);
    roster.forEach((st, i) => {
      const seed = p.base + i * 7;
      const rnd = mulberry32(seed + 3);
      const forceBlank = p.testId === "t3" && i === 2;             // 白紙答案のデモ
      const forceIssue = (p.testId === "t3" && i === 5) || (p.testId === "t4" && i === 1);
      const processing = p.testId === "t4" && i >= 6;              // 採点中のデモ
      const quality = checkQuality(seed, forceIssue);
      const result = gradeSubmission(test, st, seed, { forceBlank });
      const src = pick(rnd, ["mobile", "camera", "mfp", "file", "pdf"]) as Source;
      const needReview = result.items.some((it) => it.needReview);
      const status = processing ? "processing" : forceBlank ? "blank" : forceIssue ? "quality" : needReview ? "review" : "done";
      const day = test.date;
      const hh = String(9 + (i % 8)).padStart(2, "0");
      const mm = String((i * 13) % 60).padStart(2, "0");
      out.push({
        id: `sub_${p.testId}_${st.id}`,
        testId: p.testId,
        studentId: st.id,
        classId: p.classId,
        source: src,
        pages: 1 + (i % 3 === 0 ? 1 : 0),
        uploadedAt: `${day}T${hh}:${mm}:00`,
        quality,
        result,
        status: status as Submission["status"],
        imagePaths: [],
        edited: false,
        progress: processing ? [35, 62, 78, 91][i % 4] : 100,
        reviewedBy: status === "done" && i % 5 === 0 ? "T.K" : "",
      });
    });
  });
  return out;
}
