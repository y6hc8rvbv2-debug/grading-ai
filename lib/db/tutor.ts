// チャッピー先生（生徒の音声復習）の、教職員側の読み書き（ブラウザ・教職員のセッション＝RLS）。
// 生徒の API キーは読まない（教職員が読めるポリシーも無い）。
import { createClient } from "@/lib/supabase/client";

export type TutorSettings = { enabled: boolean; sessionMinutes: number; dailyMinutes: number; classIds: string[] };

export async function loadTutorSettings(): Promise<TutorSettings | null> {
  const sb = createClient();
  const [{ data: school, error }, { data: classes }] = await Promise.all([
    sb.from("schools").select("tutor_enabled, tutor_session_minutes, tutor_daily_minutes").maybeSingle(),
    sb.from("classes").select("id, tutor_enabled"),
  ]);
  if (error || !school) return null;   // 0012 を実行する前の DB
  return {
    enabled: !!school.tutor_enabled, sessionMinutes: school.tutor_session_minutes, dailyMinutes: school.tutor_daily_minutes,
    classIds: (classes ?? []).filter((c) => c.tutor_enabled).map((c) => c.id),
  };
}

export async function saveTutorSettings(s: TutorSettings) {
  const { error } = await createClient().rpc("set_tutor_settings", {
    p_enabled: s.enabled, p_session_minutes: s.sessionMinutes, p_daily_minutes: s.dailyMinutes, p_class_ids: s.classIds,
  });
  if (error) {
    if (/set_tutor_settings/.test(error.message) || error.code === "PGRST202") {
      throw new Error("チャッピー先生の設定がまだ使えません。管理者が Supabase で 0012_voice_tutor.sql を実行してください。");
    }
    throw new Error(error.message);
  }
}

/** テストごとの「正答・解説を返却時に生徒へ見せる」と、設問の問題文（生徒の復習用） */
export async function loadTestTutorFields(testId: string) {
  const sb = createClient();
  const [{ data: t, error }, { data: qs }] = await Promise.all([
    sb.from("tests").select("release_model_answer").eq("id", testId).maybeSingle(),
    sb.from("questions").select("no, prompt_text").eq("test_id", testId).order("no"),
  ]);
  if (error || !t) return null;
  return { releaseModelAnswer: !!t.release_model_answer, prompts: Object.fromEntries((qs ?? []).map((q) => [q.no, q.prompt_text ?? ""])) as Record<number, string> };
}

export async function saveTestTutorFields(testId: string, releaseModelAnswer: boolean, prompts: Record<number, string>) {
  const sb = createClient();
  const { error } = await sb.from("tests").update({ release_model_answer: releaseModelAnswer }).eq("id", testId);
  if (error) throw new Error("保存できませんでした。管理者が 0012_voice_tutor.sql を実行済みか確認してください。");
  for (const [no, text] of Object.entries(prompts)) {
    const { error: e } = await sb.from("questions").update({ prompt_text: text.slice(0, 2000) }).eq("test_id", testId).eq("no", Number(no));
    if (e) throw new Error("問題文を保存できませんでした。");
  }
}

export type TutorProgressRow = { qno: number; state: string; source: string; updated_at: string };
export type TutorReview = {
  releaseId: string; version: number;
  progress: TutorProgressRow[];
  sessions: { count: number; seconds: number };
  reflections: { qno: number; note: string; source: string; created_at: string }[];
  transcripts: { body: string; created_at: string }[];
};

/** 答案の返却と、生徒の復習の様子（状態・利用時間。振り返り・文字起こしは生徒が共有に同意したときだけ見える） */
export async function loadTutorReview(submissionId: string): Promise<TutorReview | null> {
  const sb = createClient();
  const { data: rel, error } = await sb.from("result_releases").select("id, version").eq("submission_id", submissionId).maybeSingle();
  if (error || !rel) return null;
  const [p, s, r, tr] = await Promise.all([
    sb.from("tutor_progress").select("qno, state, source, updated_at").eq("release_id", rel.id),
    sb.from("tutor_sessions").select("id, seconds").eq("release_id", rel.id),
    sb.from("tutor_reflections").select("qno, note, source, created_at").eq("release_id", rel.id).order("created_at"),
    sb.from("tutor_transcripts").select("body, created_at, tutor_sessions!inner(release_id)").eq("tutor_sessions.release_id", rel.id),
  ]);
  return {
    releaseId: rel.id, version: rel.version ?? 1,
    progress: (p.data ?? []) as TutorProgressRow[],
    sessions: { count: s.data?.length ?? 0, seconds: (s.data ?? []).reduce((a, x) => a + (x.seconds ?? 0), 0) },
    reflections: (r.data ?? []) as TutorReview["reflections"],
    transcripts: ((tr.data ?? []) as { body: string; created_at: string }[]).map((x) => ({ body: x.body, created_at: x.created_at })),
  };
}

/** 先生が「理解確認済み」にする（または取り消す） */
export async function setVerified(review: TutorReview, studentSchool: { schoolId: string; studentId: string }, qno: number, verified: boolean) {
  const sb = createClient();
  const { error } = verified
    ? await sb.from("tutor_progress").upsert({
        school_id: studentSchool.schoolId, student_id: studentSchool.studentId, release_id: review.releaseId, qno,
        state: "verified", source: "teacher", updated_at: new Date().toISOString(),
      }, { onConflict: "release_id,qno" })
    : await sb.from("tutor_progress").update({ state: "reviewing", source: "self", updated_at: new Date().toISOString() })
        .eq("release_id", review.releaseId).eq("qno", qno);
  if (error) throw new Error("復習の状態を保存できませんでした。");
}
