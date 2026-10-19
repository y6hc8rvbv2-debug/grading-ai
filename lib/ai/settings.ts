// 学校ごとの AIエンジンの設定（サーバー専用）。0019 の ai_settings を読む。
// 表がまだ無い DB（0019 の適用前）でも、環境変数・既定値で動くようにする。
import "server-only";
import type { ModelOverrides } from "@/lib/grading/models";

export const DEFAULT_CONCURRENCY = 8;

type Db = {
  from: (t: string) => {
    select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => PromiseLike<{ data: Record<string, unknown> | null; error: unknown }> } };
  };
};

export type SchoolAi = { overrides: ModelOverrides; concurrency: number; saved: boolean };

export async function loadSchoolAi(db: unknown, schoolId: string | null | undefined): Promise<SchoolAi> {
  const none: SchoolAi = { overrides: {}, concurrency: DEFAULT_CONCURRENCY, saved: false };
  if (!schoolId) return none;
  try {
    const { data, error } = await (db as Db).from("ai_settings")
      .select("model_fast, model_standard, model_top, concurrency").eq("school_id", schoolId).maybeSingle();
    if (error || !data) return none;
    return {
      overrides: {
        fast: (data.model_fast as string | null) ?? null,
        standard: (data.model_standard as string | null) ?? null,
        top: (data.model_top as string | null) ?? null,
      },
      concurrency: Number(data.concurrency) || DEFAULT_CONCURRENCY,
      saved: true,
    };
  } catch {
    return none;
  }
}
