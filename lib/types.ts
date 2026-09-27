// アプリ全体で使う型。画面はこの形だけを見る。
// Supabase / デモのどちらのデータソースも、この形に変換して返す。

export type Mark = "○" | "△" | "×" | "-";

export type QType = "calc" | "choice" | "fill" | "short" | "long" | "graph";

export type SubmissionStatus =
  | "uploaded" | "processing" | "done" | "review" | "quality" | "blank";

export type Source = "camera" | "mobile" | "mfp" | "file" | "pdf";

export type ClassRoom = {
  id: string;
  grade: number;
  name: string;
  label: string;          // 2年A組
  teacher: string;        // 担任 T.K（イニシャル表記）
  size: number;           // 在籍数（名簿から数える）
};

// 生徒。氏名フィールドは意図的に存在しない。
export type Student = {
  id: string;
  classId: string;
  number: number;         // 出席番号
  examNo: string;         // 受験番号
  anonId: string;         // 匿名ID（生徒001）
  initials: string;       // T.K
  support: boolean;       // 特別支援の配慮対象
  note: string;           // 配慮事項（実名を書かない運用）
};

export type Question = {
  id: string;
  no: number;
  big: number;
  label: string;          // 大問1-(1)
  type: QType;
  typeLabel: string;
  unit: string;
  points: number;
  difficulty: string;
  correct: string;
  model: string;          // 模範解答・解説の要点
};

export type Test = {
  id: string;
  name: string;
  subject: string;
  grade: number;
  term: string;
  date: string;           // 実施日 YYYY-MM-DD
  testNo: string;
  units: string[];
  maxScore: number;
  bigCount: number;
  questions: Question[];
};

export type Item = {
  id: string;             // submission_items.id（デモでは仮ID）
  qno: number;
  label: string;
  unit: string;
  type: QType;
  typeLabel: string;
  points: number;
  detected: string;
  confidence: number;     // 0〜1
  blank: boolean;
  mark: Mark;
  earned: number;
  needReview: boolean;
  reason: string;         // 誤答傾向
  comment: string;        // 赤ペンコメント
};

export type Quality = {
  scores: Record<string, number>;
  issues: { k: string; msg: string }[];
  fixes: string[];
  ok: boolean;
  avg: number;
};

export type Submission = {
  id: string;
  testId: string;
  studentId: string;
  classId: string;
  source: Source;
  status: SubmissionStatus;
  pages: number;
  progress: number;
  quality: Quality;
  imagePaths: string[];
  edited: boolean;
  reviewedBy: string;     // 確認した教員の表示名。未確認なら ""
  uploadedAt: string;
  result: { items: Item[]; total: number; blank: boolean };
};

export type Rubric = {
  matchRate: number;
  partialStep: number;
  reviewThreshold: number;
  allowKana: boolean;
  allowSpell: boolean;
  unitPartial: boolean;
  workPartial: boolean;
  caseSensitive: boolean;
  outsideBox: boolean;
  requireTeacher: boolean;
  autoModel: boolean;
  strictQuality: boolean;
  praiseFull: boolean;
};

export type Retention = "30" | "180" | "year" | "manual";

export type School = {
  id: string;
  name: string;
  code: string;
  retention: Retention;
  plan: "free" | "school" | "board";
};

export type Role = "admin" | "teacher" | "board" | "viewer";

export type Profile = {
  id: string;
  schoolId: string;
  role: Role;
  displayName: string;
  uiLang: string;
};

export type Workspace = {
  classes: ClassRoom[];
  students: Student[];
  tests: Test[];
};

/** 採点結果の保存に渡す形（1枚分） */
export type GradingInput = {
  testId: string;
  studentId: string;
  classId: string;
  source: Source;
  pages: number;
  quality: Quality;
  isBlank: boolean;
  /** true なら画像だけ保存し、AI採点待ち（status = uploaded）にする */
  pending?: boolean;
  items: Array<{
    questionId: string; qno: number; detected: string; confidence: number;
    mark: Mark; earned: number; blank: boolean; needReview: boolean;
    reason: string; comment: string; bbox?: unknown; aiRaw?: unknown;
  }>;
};

export type ItemPatch = Partial<{
  mark: Mark; earned: number; comment: string; needReview: boolean;
}>;

/** 分析ビューの1行 */
export type RateRow = { key: string; earned: number; points: number; rate: number; n?: number };

export type QuestionStat = {
  id: string; qno: number; label: string; unit: string;
  n: number; correctRate: number; rate: number;
};

export type Analysis = {
  units: RateRow[];
  types: RateRow[];
  questions: QuestionStat[];
  mistakes: { reason: string; count: number }[];
};

export type ReviewEntry = { submissionId: string; item: Item };

export type NewTestInput = {
  name: string; subject: string; grade: number; term: string;
  date: string; testNo: string; units: string[];
  questions: Array<{
    type: QType; unit: string; points: number; correct: string; model: string; difficulty: string;
  }>;
};

export type AuditRow = {
  id: number; createdAt: string; action: string; targetTable: string;
  targetId: string | null; actor: string; detail: unknown;
};
