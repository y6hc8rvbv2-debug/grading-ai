// アプリ全体で使う型。画面はこの形だけを見る。
// Supabase / デモのどちらのデータソースも、この形に変換して返す。
import type { GradingMode, GradingStage } from "@/lib/grading/cost";

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
  /** 作図の模範図の位置（模範解答の画像に対する割合。0007。無ければ null） */
  figure?: FigureRef | null;
};

/** 模範図の位置。path は Storage の模範解答の画像、page は PDF のページ（画像は1） */
export type FigureRef = { path: string; page: number; x: number; y: number; w: number; h: number };

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
  /** 登録時に保存した模範解答・問題用紙・配点表（0007） */
  answerKeyPaths?: string[];
  /** アーカイブした日時（0008）。答案・成績は残し、一覧と新規採点の選択肢から隠す */
  archivedAt?: string | null;
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
  /** 解答の位置（ページに対する割合 0〜1）。採点AIが返したときだけある */
  bbox?: { page: number; x: number; y: number; w: number; h: number } | null;
};

/** 先生が動かした赤ペン（○×△）の位置。マークの中心の、ページに対する割合（右の余白では x が 1 を超える）。0009 */
export type MarkPos = { qno: number; page: number; x: number; y: number };

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
  /** 最後にAI採点したときの方式と、結果を確定した段階（0006。AI採点前・仮採点は null） */
  gradingMode?: GradingMode | null;
  gradingStage?: GradingStage | null;
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
    /** 大問番号と、原本どおりの小問表記（例: "(1)"。小問が無ければ空） */
    big: number; sub: string;
    figure?: FigureRef | null;
  }>;
  /** 模範解答・問題用紙・配点表の Storage のパス（自動入力を使ったときだけ） */
  answerKeyPaths?: string[];
};

/** 模範解答からの自動入力の結果（lib/ai/test-import.ts の ImportResult と同じ形） */
export type ImportBox = { file: number; page: number; x: number; y: number; w: number; h: number } | null;
export type ImportedQuestion = {
  big: number; bigLabel: string; sub: string; type: QType; correct: string;
  points: number | null; pointsHint: number | null; pointsOrigin?: string; model: string;
  answerBox: ImportBox; figure: ImportBox; flags: string[];
};
export type ImportResult = { title: string; subject: string; maxScore: number | null; questions: ImportedQuestion[]; warnings: string[] };

/** 採点AIが使えるか（サーバーに ANTHROPIC_API_KEY があるか）と、各段階のモデルID */
export type AiStatus = {
  enabled: boolean; model: string | null;
  models?: Record<GradingStage, string> | null;
};

/** 採点AIの結果の要約（詳細は答案を読み直して得る） */
export type AiGradeSummary = {
  model: string; total: number; needReview: number; blank: boolean;
  mode?: GradingMode; finalStage?: GradingStage | null; stages?: GradingStage[]; costUsd?: number;
};

/** AI採点の記録（1回分）と、その各段階 */
export type GradingLog = {
  id: string; mode: GradingMode; status: "running" | "done" | "failed"; finalStage: GradingStage | null;
  needsReview: boolean | null; reviewReasons: string[]; costUsd: number; error: string | null;
  createdAt: string; finishedAt: string | null; by: string;
  stages: {
    stage: GradingStage; modelId: string; servedModel: string | null; status: "calling" | "done" | "error";
    escalate: boolean; reasons: string[]; inputTokens: number | null; outputTokens: number | null;
    costUsd: number | null; elapsedMs: number | null; error: string | null;
  }[];
};

export type AuditRow = {
  id: number; createdAt: string; action: string; targetTable: string;
  targetId: string | null; actor: string; detail: unknown;
};
