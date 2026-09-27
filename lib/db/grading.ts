// ============================================================================
// テスト採点ver.3 — データアクセス層
//
// アプリ側（単一ファイル JSX 版）の型に合わせて camelCase へ変換して返す。
// これにより、既存のビュー実装をほとんど書き換えずに永続化へ移行できる。
// ============================================================================
import { createClient } from "@/lib/supabase/client";

/* ---------------------------------------------------------------- 型 */
export type Mark = "○" | "△" | "×" | "-";

export type Item = {
  id: string;
  qno: number;
  label: string;
  unit: string;
  type: string;
  typeLabel: string;
  points: number;
  detected: string;
  confidence: number;
  blank: boolean;
  mark: Mark;
  earned: number;
  needReview: boolean;
  reason: string;
  comment: string;
};

export type Submission = {
  id: string;
  testId: string;
  studentId: string;
  classId: string;
  source: string;
  status: string;
  pages: number;
  progress: number;
  quality: any;
  imagePaths: string[];
  edited: boolean;
  reviewedBy: string | null;
  uploadedAt: string;
  result: { items: Item[]; total: number; blank: boolean };
};

const TYPE_LABEL: Record<string, string> = {
  calc: "計算", choice: "選択", fill: "穴埋め",
  short: "短文記述", long: "長文記述", graph: "作図・グラフ",
};

/* ------------------------------------------------------- 読み込み */

/** 画面初期化に必要なマスタと採点データをまとめて読む */
export async function loadWorkspace() {
  const sb = createClient();

  const [classes, students, tests, questions] = await Promise.all([
    sb.from("classes").select("*").order("grade").order("name"),
    sb.from("students").select("*").order("number"),
    sb.from("tests").select("*").order("exam_date", { ascending: false }),
    sb.from("questions").select("*").order("no"),
  ]);

  const err = [classes, students, tests, questions].find((r) => r.error);
  if (err?.error) throw err.error;

  const qByTest = new Map<string, any[]>();
  (questions.data ?? []).forEach((q) => {
    const list = qByTest.get(q.test_id) ?? [];
    list.push(q);
    qByTest.set(q.test_id, list);
  });

  return {
    classes: (classes.data ?? []).map((c) => ({
      id: c.id, grade: c.grade, name: c.name, label: c.label,
      teacher: c.teacher_label, size: 0,
    })),
    students: (students.data ?? []).map((s) => ({
      id: s.id, classId: s.class_id, number: s.number, examNo: s.exam_no,
      anonId: s.anon_id, initials: s.initials, support: s.support, note: s.note,
    })),
    tests: (tests.data ?? []).map((t) => ({
      id: t.id, name: t.name, subject: t.subject, grade: t.grade,
      term: t.term, date: t.exam_date, testNo: t.test_no,
      units: t.units ?? [], maxScore: t.max_score,
      questions: (qByTest.get(t.id) ?? []).map((q) => ({
        id: q.id, no: q.no, big: q.big, label: q.label, type: q.qtype,
        typeLabel: TYPE_LABEL[q.qtype] ?? q.qtype, unit: q.unit,
        points: q.points, difficulty: q.difficulty,
        correct: q.correct, model: q.model_answer,
      })),
    })),
  };
}

/** 採点済みの答案を読む。件数が多いので既定は直近200件。 */
export async function loadSubmissions(opts: {
  testId?: string; classId?: string; limit?: number;
} = {}): Promise<Submission[]> {
  const sb = createClient();
  let q = sb
    .from("submissions")
    .select(`
      id, test_id, student_id, class_id, source, status, pages, total_score,
      progress, quality, image_paths, is_blank, edited, uploaded_at,
      reviewed_by, profiles:reviewed_by ( display_name ),
      submission_items (
        id, qno, detected, confidence, mark, earned, is_blank,
        need_review, reason, comment,
        questions ( label, unit, qtype, points )
      )
    `)
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false })
    .limit(opts.limit ?? 200);

  if (opts.testId) q = q.eq("test_id", opts.testId);
  if (opts.classId) q = q.eq("class_id", opts.classId);

  const { data, error } = await q;
  if (error) throw error;

  return (data ?? []).map((s: any) => {
    const items: Item[] = (s.submission_items ?? [])
      .sort((a: any, b: any) => a.qno - b.qno)
      .map((i: any) => ({
        id: i.id,
        qno: i.qno,
        label: i.questions?.label ?? `問${i.qno}`,
        unit: i.questions?.unit ?? "",
        type: i.questions?.qtype ?? "short",
        typeLabel: TYPE_LABEL[i.questions?.qtype] ?? "",
        points: i.questions?.points ?? 0,
        detected: i.detected,
        confidence: Number(i.confidence),
        blank: i.is_blank,
        mark: i.mark as Mark,
        earned: i.earned,
        needReview: i.need_review,
        reason: i.reason,
        comment: i.comment,
      }));

    return {
      id: s.id, testId: s.test_id, studentId: s.student_id, classId: s.class_id,
      source: s.source, status: s.status, pages: s.pages, progress: s.progress,
      quality: s.quality ?? {}, imagePaths: s.image_paths ?? [],
      edited: s.edited, reviewedBy: s.profiles?.display_name ?? null,
      uploadedAt: s.uploaded_at,
      result: { items, total: s.total_score, blank: s.is_blank },
    };
  });
}

/* --------------------------------------------------------- 書き込み */

/** 採点結果を1枚保存する。合計点は DB のトリガーが再計算する。 */
export async function saveGrading(input: {
  schoolId: string;
  testId: string;
  studentId: string;
  classId: string;
  source: string;
  pages: number;
  quality: any;
  imagePaths: string[];
  isBlank: boolean;
  items: Array<{
    questionId: string; qno: number; detected: string; confidence: number;
    mark: Mark; earned: number; blank: boolean; needReview: boolean;
    reason: string; comment: string; bbox?: any; aiRaw?: any;
  }>;
}) {
  const sb = createClient();

  // 同じテスト×生徒の再提出は上書きする（unique 制約に合わせる）
  const { data: sub, error } = await sb
    .from("submissions")
    .upsert(
      {
        school_id: input.schoolId,
        test_id: input.testId,
        student_id: input.studentId,
        class_id: input.classId,
        source: input.source,
        pages: input.pages,
        quality: input.quality,
        image_paths: input.imagePaths,
        is_blank: input.isBlank,
        status: input.isBlank ? "blank" : "processing",
        progress: 100,
      },
      { onConflict: "test_id,student_id" }
    )
    .select("id")
    .single();
  if (error) throw error;

  if (input.items.length) {
    const { error: e2 } = await sb.from("submission_items").upsert(
      input.items.map((i) => ({
        school_id: input.schoolId,
        submission_id: sub.id,
        question_id: i.questionId,
        qno: i.qno,
        detected: i.detected,
        confidence: i.confidence,
        mark: i.mark,
        earned: i.earned,
        is_blank: i.blank,
        need_review: i.needReview,
        reason: i.reason,
        comment: i.comment,
        bbox: i.bbox ?? null,
        ai_raw: i.aiRaw ?? null,
      })),
      { onConflict: "submission_id,qno" }
    );
    if (e2) throw e2;
  }

  await writeAudit({
    schoolId: input.schoolId,
    action: "grading.create",
    targetTable: "submissions",
    targetId: sub.id,
    detail: { items: input.items.length, blank: input.isBlank },
  });

  return sub.id as string;
}

/** 教師が1問だけ修正する。合計点と状態はトリガーが追従する。 */
export async function updateItem(params: {
  schoolId: string;
  submissionId: string;
  itemId: string;
  patch: Partial<{ mark: Mark; earned: number; comment: string; needReview: boolean }>;
}) {
  const sb = createClient();
  const { patch } = params;

  const { error } = await sb
    .from("submission_items")
    .update({
      ...(patch.mark !== undefined ? { mark: patch.mark } : {}),
      ...(patch.earned !== undefined ? { earned: patch.earned } : {}),
      ...(patch.comment !== undefined ? { comment: patch.comment } : {}),
      ...(patch.needReview !== undefined ? { need_review: patch.needReview } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.itemId);
  if (error) throw error;

  await sb.from("submissions").update({ edited: true }).eq("id", params.submissionId);

  await writeAudit({
    schoolId: params.schoolId,
    action: "grading.edit",
    targetTable: "submission_items",
    targetId: params.itemId,
    detail: patch,
  });
}

/** 返却前の「確認済み」を記録する */
export async function markReviewed(schoolId: string, submissionId: string, actorId: string) {
  const sb = createClient();
  const { error } = await sb
    .from("submissions")
    .update({ reviewed_by: actorId, reviewed_at: new Date().toISOString() })
    .eq("id", submissionId);
  if (error) throw error;

  await writeAudit({
    schoolId, action: "submission.review",
    targetTable: "submissions", targetId: submissionId, detail: {},
  });
}

/* --------------------------------------------------------- 分析 */

/** 単元別の定着度。集計はビュー側（Postgres）で行う。 */
export async function unitMastery(testId: string, classId?: string) {
  const sb = createClient();
  let q = sb.from("v_unit_mastery").select("*").eq("test_id", testId);
  if (classId) q = q.eq("class_id", classId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? [])
    .map((r: any) => ({
      unit: r.unit, earned: r.earned, points: r.points, rate: Number(r.rate),
    }))
    .sort((a, b) => a.rate - b.rate);
}

/** 設問別の正答率 */
export async function questionStats(testId: string) {
  const sb = createClient();
  const { data, error } = await sb
    .from("v_question_stats").select("*").eq("test_id", testId);
  if (error) throw error;
  return (data ?? [])
    .map((r: any) => ({
      questionId: r.question_id, label: r.label, unit: r.unit, n: r.n,
      correctRate: Number(r.correct_rate), scoreRate: Number(r.score_rate),
    }))
    .sort((a, b) => a.correctRate - b.correctRate);
}

/** 要確認一覧 */
export async function needsReview(limit = 100) {
  const sb = createClient();
  const { data, error } = await sb
    .from("submission_items")
    .select(`
      id, qno, detected, confidence, mark, earned, reason,
      questions ( label, unit, qtype, points ),
      submissions ( id, test_id, class_id, student_id )
    `)
    .eq("need_review", true)
    .order("confidence", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/* --------------------------------------------------------- 画像 */

/** 答案画像を保存する。パスは {school_id}/{test_id}/{submission_id}/{page}.jpg */
export async function uploadAnswerImage(params: {
  schoolId: string; testId: string; submissionId: string; page: number; file: File;
}) {
  const sb = createClient();
  const ext = params.file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${params.schoolId}/${params.testId}/${params.submissionId}/${params.page}.${ext}`;
  const { error } = await sb.storage
    .from("answer-sheets")
    .upload(path, params.file, { upsert: true, contentType: params.file.type });
  if (error) throw error;
  return path;
}

/** 原本画像を表示するための署名付きURL（既定10分） */
export async function signedImageUrl(path: string, seconds = 600) {
  const sb = createClient();
  const { data, error } = await sb.storage
    .from("answer-sheets").createSignedUrl(path, seconds);
  if (error) throw error;
  return data.signedUrl;
}

/* --------------------------------------------------------- 監査ログ */

export async function writeAudit(params: {
  schoolId: string; action: string; targetTable: string;
  targetId: string | null; detail: any;
}) {
  const sb = createClient();
  const { data: session } = await sb.auth.getUser();
  const { error } = await sb.from("audit_logs").insert({
    school_id: params.schoolId,
    actor_id: session.user?.id ?? null,
    action: params.action,
    target_table: params.targetTable,
    target_id: params.targetId,
    detail: params.detail,
  });
  // 監査ログの失敗で業務処理を止めないが、握りつぶさずに記録する
  if (error) console.error("audit log failed", error);
}

/** ハッシュ連鎖が途切れていないか確認する */
export async function verifyAuditChain(schoolId: string) {
  const sb = createClient();
  const { data, error } = await sb.rpc("verify_audit_chain", { p_school_id: schoolId });
  if (error) throw error;
  const broken = (data ?? []).filter((r: any) => r.ok === false);
  return { total: data?.length ?? 0, broken };
}
