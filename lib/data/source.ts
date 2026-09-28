// データソースの共通インターフェース。
// 画面はこのインターフェースだけを通して読み書きする。
//   - supabase: 本番。RLS 付きで Supabase に保存する（lib/data/supabase.ts）
//   - demo    : Supabase 未設定時。メモリ上のデモデータで動き、再読み込みで元に戻る（lib/data/demo.ts）
import type {
  AiGradeSummary, AiStatus, AuditRow, GradingInput, ItemPatch, NewTestInput, Profile, QuestionStat, RateRow,
  Retention, ReviewEntry, Rubric, School, Submission, Workspace,
} from "@/lib/types";

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
  /** 保存済みの答案を採点AIで採点して保存する（サーバーの /api/grade が行う） */
  aiGrade(submissionId: string): Promise<AiGradeSummary>;

  signedImageUrl(path: string): Promise<string>;
  loadAudit(): Promise<AuditRow[]>;
  verifyAudit(): Promise<{ total: number; broken: number }>;
}

/** Supabase の接続情報が設定されているか（未設定ならデモモード） */
export const isSupabaseConfigured = () =>
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
