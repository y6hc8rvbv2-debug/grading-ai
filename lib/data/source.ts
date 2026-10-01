// データソースの共通インターフェース。
// 画面はこのインターフェースだけを通して読み書きする。
//   - supabase: 本番。RLS 付きで Supabase に保存する（lib/data/supabase.ts）
//   - demo    : Supabase 未設定時。メモリ上のデモデータで動き、再読み込みで元に戻る（lib/data/demo.ts）
import type {
  AiGradeSummary, AiStatus, AuditRow, GradingInput, GradingLog, ImportResult, ItemPatch, NewTestInput, Profile, QuestionStat, RateRow,
  Retention, ReviewEntry, Rubric, School, Submission, Workspace,
} from "@/lib/types";
import type { GradingMode, GradingStage } from "@/lib/grading/cost";

/** AI採点の進み具合（3モデル併用で上の段階に回るたびに呼ばれる） */
export type AiGradeProgress = { stage: GradingStage; next?: GradingStage; reasons?: string[] };

export type SessionInfo = {
  userId: string;
  email: string;
  profile: Profile | null;   // null = 学校に未所属（管理者による紐づけ待ち）
  school: School | null;
};

export interface DataSource {
  mode: "demo" | "supabase";

  loadSession(): Promise<SessionInfo | null>;
  saveUiLang(lang: string): Promise<void>;
  signOut(): Promise<void>;

  loadWorkspace(): Promise<Workspace>;
  loadSubmissions(): Promise<Submission[]>;
  loadSubmission(id: string): Promise<Submission | null>;

  /** 採点結果を保存する。files があれば答案画像として Storage に置く。 */
  saveGrading(input: GradingInput, files?: File[]): Promise<string>;
  updateItem(submissionId: string, itemId: string, patch: ItemPatch): Promise<void>;
  markReviewed(submissionId: string): Promise<void>;

  createTest(input: NewTestInput): Promise<string>;
  loadRubric(): Promise<Rubric>;
  saveRubric(r: Rubric): Promise<void>;
  updateRetention(r: Retention): Promise<void>;

  unitMastery(testId: string, classId?: string): Promise<RateRow[]>;
  typeMastery(testId: string, classId?: string): Promise<RateRow[]>;
  questionStats(testId: string, classId?: string): Promise<QuestionStat[]>;
  mistakeReasons(testId: string, classId?: string): Promise<{ reason: string; count: number }[]>;
  needsReview(): Promise<ReviewEntry[]>;

  /** 採点AIが使えるか */
  aiStatus(): Promise<AiStatus>;
  /** 保存済みの答案を採点AIで採点して保存する（サーバーの /api/grade が行う）。
   *  mode: opus = Opus単独、cascade = 3モデル併用（Haiku → 必要なら Sonnet → Opus） */
  aiGrade(submissionId: string, opts: { mode: GradingMode; onProgress?: (p: AiGradeProgress) => void }): Promise<AiGradeSummary>;
  /** AI採点の記録（使ったモデル・確認に回した理由・トークン数・概算費用） */
  gradingLog(submissionId: string): Promise<GradingLog[]>;

  /** 模範解答からの自動入力：資料を保存する／AI で読み取る／不要な資料を消す／登録したテストと紐づける */
  uploadImportFile(requestId: string, index: number, file: File): Promise<string>;
  importTestKey(params: {
    requestId: string; files: { path: string; kind: "key" | "paper" | "student"; name: string }[]; force?: boolean;
  }): Promise<{ importId: string; result: ImportResult; cached: boolean }>;
  removeImportFiles(paths: string[]): Promise<void>;
  linkImport(importId: string, testId: string): Promise<void>;

  signedImageUrl(path: string): Promise<string>;
  loadAudit(): Promise<AuditRow[]>;
  verifyAudit(): Promise<{ total: number; broken: number }>;
}

/** Supabase の接続情報が設定されているか（未設定ならデモモード） */
export const isSupabaseConfigured = () =>
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
