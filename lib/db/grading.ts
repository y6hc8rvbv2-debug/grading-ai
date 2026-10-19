// ============================================================================
// テスト採点ver.3 — データアクセス層（Supabase）
//
// DB の snake_case を、画面が使う lib/types.ts の形（camelCase）へ変換して返す。
// ブラウザの Supabase クライアント（anon キー + ログインセッション）で動くので、
// 読み書きできる範囲はすべて RLS が決める。service_role はここでは使わない。
//
// 合計点と status は DB のトリガーが計算する。ここで合計を計算し直さないこと。
// ============================================================================
import { createClient } from "@/lib/supabase/client";
import { typeLabelOf } from "@/lib/grading/engine";
import { rubricFromRow } from "@/lib/db/rubric";
import type {
  MarkPos,
  AuditRow, ClassRoom, GradingInput, GradingLog, ImportResult, Item, ItemPatch, Mark, NewTestInput, Profile,
  QType, Quality, QuestionStat, RateRow, Retention, ReviewEntry, Rubric, School,
  Student, Submission, Test, Workspace,
} from "@/lib/types";



const EMPTY_QUALITY: Quality = { scores: {}, issues: [], fixes: [], ok: true, avg: 0 };

/* ---------------------------------------------------------- ログイン情報 */

/** ログイン中の教職員と所属校。profiles が無い（学校に未所属）なら profile は null。 */
export async function loadSession(): Promise<{
  userId: string; email: string; profile: Profile | null; school: School | null;
} | null> {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const { data: p, error } = await sb
    .from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  if (!p) return { userId: user.id, email: user.email ?? "", profile: null, school: null };

  const { data: sc, error: e2 } = await sb
    .from("schools").select("*").eq("id", p.school_id).single();
  if (e2) throw e2;

  return {
    userId: user.id,
    email: user.email ?? "",
    profile: {
      id: p.id, schoolId: p.school_id, role: p.role,
      displayName: p.display_name, uiLang: p.ui_lang,
    },
    school: {
      id: sc.id, name: sc.name, code: sc.code,
      retention: sc.retention, plan: sc.plan,
    },
  };
}

/** 表示言語を保存する（本人が変えてよい列だけ更新できる） */
export async function saveUiLang(userId: string, lang: string) {
  const sb = createClient();
  const { error } = await sb.from("profiles").update({ ui_lang: lang }).eq("id", userId);
  if (error) throw error;
}

export async function signOut() {
  await createClient().auth.signOut();
}

/* ------------------------------------------------------- 読み込み */

function mapQuestion(q: any) {
  return {
    id: q.id, no: q.no, big: q.big, label: q.label, type: q.qtype as QType,
    typeLabel: typeLabelOf(q.qtype), unit: q.unit,
    points: q.points, difficulty: q.difficulty,
    correct: q.correct, model: q.model_answer,
    figure: q.figure ?? null,
  };
}

/** 設問の表示名：原本どおりの大問・小問（例: 大問1-(2)、小問が無ければ 大問3） */
export const questionLabel = (big: number, sub: string) => (sub ? `大問${big}-${sub}` : `大問${big}`);

/** 画面初期化に必要なマスタ（クラス・生徒・テスト・設問）をまとめて読む */
export async function loadWorkspace(): Promise<Workspace> {
  const sb = createClient();

  const [classes, students, tests, questions] = await Promise.all([
    sb.from("classes").select("*").order("grade").order("name"),
    sb.from("students").select("*").order("number"),
    sb.from("tests").select("*").order("exam_date", { ascending: false, nullsFirst: false }),
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

  const studentRows: Student[] = (students.data ?? []).map((s) => ({
    id: s.id, classId: s.class_id, number: s.number, examNo: s.exam_no,
    anonId: s.anon_id, initials: s.initials, support: s.support, note: s.note,
  }));

  const classRows: ClassRoom[] = (classes.data ?? []).map((c) => ({
    id: c.id, grade: c.grade, name: c.name, label: c.label,
    teacher: c.teacher_label,
    size: studentRows.filter((s) => s.classId === c.id).length,
  }));

  const testRows: Test[] = (tests.data ?? []).map((t) => {
    const qs = (qByTest.get(t.id) ?? []).map(mapQuestion);
    const sum = qs.reduce((a, q) => a + q.points, 0);
    return {
      id: t.id, name: t.name, subject: t.subject, grade: t.grade,
      term: t.term, date: t.exam_date ?? "", testNo: t.test_no,
      units: t.units ?? [],
      maxScore: t.max_score || sum,
      bigCount: qs.reduce((a, q) => Math.max(a, q.big), 0),
      questions: qs,
      answerKeyPaths: t.answer_key_paths ?? [],
      archivedAt: t.archived_at ?? null,
    };
  });

  return { classes: classRows, students: studentRows, tests: testRows };
}

// 採点方式（0006）の列。0006 を実行する前の DB でも画面が動くよう、列が無ければ外して読み直す
let gradingCols = true;
const submissionSelect = () => `
  id, test_id, student_id, class_id, source, status, pages, total_score,
  progress, quality, image_paths, is_blank, edited, uploaded_at,${gradingCols ? " grading_mode, grading_stage," : ""}
  reviewed_at, reviewer:profiles!submissions_reviewed_by_fkey ( display_name ),
  submission_items (
    id, qno, detected, confidence, mark, earned, is_blank,
    need_review, reason, comment, bbox,
    questions ( label, unit, qtype, points )
  )
`;

function mapItem(i: any): Item {
  const qtype = (i.questions?.qtype ?? "short") as QType;
  return {
    id: i.id,
    qno: i.qno,
    label: i.questions?.label ?? `問${i.qno}`,
    unit: i.questions?.unit ?? "",
    type: qtype,
    typeLabel: typeLabelOf(qtype),
    points: i.questions?.points ?? 0,
    detected: i.detected,
    confidence: Number(i.confidence),
    blank: i.is_blank,
    mark: i.mark as Mark,
    earned: i.earned,
    needReview: i.need_review,
    reason: i.reason,
    comment: i.comment,
    bbox: i.bbox ?? null,
  };
}

function mapSubmission(s: any): Submission {
  const items: Item[] = (s.submission_items ?? [])
    .map(mapItem)
    .sort((a: Item, b: Item) => a.qno - b.qno);
  const q = s.quality && Object.keys(s.quality).length ? s.quality : EMPTY_QUALITY;
  return {
    id: s.id, testId: s.test_id, studentId: s.student_id, classId: s.class_id,
    source: s.source, status: s.status, pages: s.pages, progress: s.progress,
    quality: { ...EMPTY_QUALITY, ...q },
    imagePaths: s.image_paths ?? [],
    edited: s.edited,
    // 確認済みなら確認した教員の表示名（表示名が未設定でも「教員」と出す）
    reviewedBy: s.reviewed_at ? (s.reviewer?.display_name || "教員") : "",
    uploadedAt: s.uploaded_at,
    gradingMode: s.grading_mode ?? null,
    gradingStage: s.grading_stage ?? null,
    result: { items, total: s.total_score, blank: s.is_blank },
  };
}

/** 答案を読む。件数が多いので既定は直近200件。 */
export async function loadSubmissions(opts: {
  testId?: string; classId?: string; limit?: number;
} = {}): Promise<Submission[]> {
  const sb = createClient();
  const run = () => {
    let q = sb
      .from("submissions")
      .select(submissionSelect())
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: false })
      .limit(opts.limit ?? 200);
    if (opts.testId) q = q.eq("test_id", opts.testId);
    if (opts.classId) q = q.eq("class_id", opts.classId);
    return q;
  };
  let { data, error } = await run();
  if (error && missingGradingCols(error)) ({ data, error } = await run());
  if (error) throw error;
  return (data ?? []).map(mapSubmission);
}

/** 0006 を実行する前の DB（採点方式の列が無い）なら、次からその列を読まない */
function missingGradingCols(error: { code?: string; message?: string }) {
  if (gradingCols && (error.code === "42703" || /grading_(mode|stage)/.test(error.message ?? ""))) {
    gradingCols = false;
    return true;
  }
  return false;
}

/** 答案1枚を読み直す（修正後にトリガーが計算した合計点・状態を取り込むため） */
export async function loadSubmission(id: string): Promise<Submission | null> {
  const sb = createClient();
  const run = () => sb.from("submissions").select(submissionSelect()).eq("id", id).maybeSingle();
  let { data, error } = await run();
  if (error && missingGradingCols(error)) ({ data, error } = await run());
  if (error) throw error;
  return data ? mapSubmission(data) : null;
}

/** AI採点の記録（新しい順）。0006 を実行する前の DB では空 */
export async function loadGradingLog(submissionId: string): Promise<GradingLog[]> {
  const sb = createClient();
  const { data, error } = await sb
    .from("grading_jobs")
    .select("id, mode, status, final_stage, needs_review, decision, total_cost_usd, error, created_at, finished_at, creator:profiles!grading_jobs_created_by_fkey ( display_name ), grading_stages ( stage, position, model_id, status, escalate, reasons, usage, cost_usd, elapsed_ms, error, served_model )")
    .eq("submission_id", submissionId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) return [];
  return (data ?? []).map((j: any) => ({
    id: j.id, mode: j.mode, status: j.status, finalStage: j.final_stage, needsReview: j.needs_review,
    reviewReasons: (j.decision?.review_reasons ?? []) as string[],
    costUsd: Number(j.total_cost_usd ?? 0), error: j.error, createdAt: j.created_at, finishedAt: j.finished_at,
    by: j.creator?.display_name ?? "",
    stages: (j.grading_stages ?? []).sort((a: any, b: any) => a.position - b.position).map((st: any) => ({
      stage: st.stage, modelId: st.model_id, servedModel: st.served_model, status: st.status, escalate: st.escalate,
      reasons: (st.reasons ?? []).map((r: any) => r.msg as string),
      inputTokens: st.usage?.input ?? null, outputTokens: st.usage?.output ?? null,
      costUsd: st.cost_usd == null ? null : Number(st.cost_usd), elapsedMs: st.elapsed_ms, error: st.error,
    })),
  }));
}

/* --------------------------------------------------------- 書き込み */

/** 採点結果を1枚保存する。合計点と status は DB のトリガーが決める。 */
export async function saveGrading(schoolId: string, input: GradingInput) {
  const sb = createClient();

  // 保存時点の状態。白紙と画質不良は入力された事実なのでここで決める。
  // それ以外は processing（progress=100）で保存し、設問の追加でトリガーが done / review を判定する。
  // 画像だけ保存する場合は uploaded（AI採点待ち・progress 0）。
  const status = input.pending ? "uploaded"
    : input.isBlank ? "blank" : !input.quality.ok ? "quality" : "processing";

  // 同じテスト×生徒の再提出は上書きする（unique 制約に合わせる）
  const { data: sub, error } = await sb
    .from("submissions")
    .upsert(
      {
        school_id: schoolId,
        test_id: input.testId,
        student_id: input.studentId,
        class_id: input.classId,
        source: input.source,
        pages: input.pages,
        quality: input.quality,
        is_blank: input.isBlank,
        status,
        progress: input.pending ? 0 : 100,
        edited: false,
        reviewed_by: null,
        reviewed_at: null,
        uploaded_at: new Date().toISOString(),
      },
      { onConflict: "test_id,student_id" }
    )
    .select("id")
    .single();
  if (error) throw error;

  if (input.items.length) {
    const { error: e2 } = await sb.from("submission_items").upsert(
      input.items.map((i) => ({
        school_id: schoolId,
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
    schoolId,
    action: "grading.create",
    targetTable: "submissions",
    targetId: sub.id,
    detail: { items: input.items.length, blank: input.isBlank, pending: !!input.pending },
  });

  return sub.id as string;
}

/** 答案画像のパスを答案に記録する */
export async function attachImages(submissionId: string, paths: string[]) {
  const sb = createClient();
  const { error } = await sb
    .from("submissions").update({ image_paths: paths, pages: Math.max(1, paths.length) })
    .eq("id", submissionId);
  if (error) throw error;
}

/** 教師が1問だけ修正する。合計点と状態はトリガーが追従する。 */
export async function updateItem(params: {
  schoolId: string;
  submissionId: string;
  itemId: string;
  patch: ItemPatch;
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

  const { error: e2 } = await sb
    .from("submissions").update({ edited: true }).eq("id", params.submissionId);
  if (e2) throw e2;

  await writeAudit({
    schoolId: params.schoolId,
    action: "grading.edit",
    targetTable: "submission_items",
    targetId: params.itemId,
    detail: patch,
  });
}

/** 返却前の「確認済み」を記録する。要確認の印も外れ、status はトリガーが判定し直す。 */
export async function markReviewed(schoolId: string, submissionId: string) {
  const sb = createClient();
  const { error } = await sb.rpc("mark_submission_reviewed", { p_submission_id: submissionId });
  if (error) throw error;

  await writeAudit({
    schoolId, action: "submission.review",
    targetTable: "submissions", targetId: submissionId, detail: {},
  });
}

/* ------------------------------------------------ テスト・採点基準・学校 */

/** テストと設問をまとめて登録する */
export async function createTest(schoolId: string, userId: string, input: NewTestInput) {
  const sb = createClient();
  const maxScore = input.questions.reduce((a, q) => a + q.points, 0);
  const { data: t, error } = await sb
    .from("tests")
    .insert({
      school_id: schoolId,
      name: input.name,
      subject: input.subject,
      grade: input.grade,
      term: input.term,
      exam_date: input.date || null,
      test_no: input.testNo,
      units: input.units,
      max_score: maxScore,
      created_by: userId,
      // 自動入力を使ったときだけ（0007 の列。手入力のときは送らないので、0007 を実行する前でも登録できる）
      ...(input.answerKeyPaths?.length ? { answer_key_paths: input.answerKeyPaths } : {}),
    })
    .select("id")
    .single();
  if (error) throw error;

  const { error: e2 } = await sb.from("questions").insert(
    input.questions.map((q, i) => ({
      school_id: schoolId,
      test_id: t.id,
      no: i + 1,
      // 大問・小問は原本どおり（以前の「4問ずつ大問を振る」方式はやめた）
      big: q.big,
      label: questionLabel(q.big, q.sub),
      ...(q.figure ? { figure: q.figure } : {}),
      qtype: q.type,
      unit: q.unit,
      points: q.points,
      difficulty: q.difficulty,
      correct: q.correct,
      model_answer: q.model,
    }))
  );
  if (e2) {
    // 設問の登録に失敗したら、中身の無いテストを残さない
    await sb.from("tests").delete().eq("id", t.id);
    throw e2;
  }

  await writeAudit({
    schoolId, action: "test.create", targetTable: "tests", targetId: t.id,
    detail: { name: input.name, questions: input.questions.length, imported: !!input.answerKeyPaths?.length },
  });
  return t.id as string;
}

/* --------------------------------------------------------- 模範解答からの自動入力 */

/** 自動入力の資料を Storage に置く（{school_id}/imports/{requestId}/{n}.{ext}） */
export async function uploadImportFile(schoolId: string, requestId: string, index: number, file: File) {
  const sb = createClient();
  const ext = (file.name.split(".").pop()?.toLowerCase() || "jpg").replace(/[^a-z0-9]/g, "");
  const path = `${schoolId}/imports/${requestId}/${index + 1}.${ext}`;
  const { error } = await sb.storage.from("answer-sheets")
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) throw error;
  return path;
}

/** 生徒の答案など、テストに残さない資料を消す */
export async function removeImportFiles(paths: string[]) {
  if (!paths.length) return;
  await createClient().storage.from("answer-sheets").remove(paths);
}

/* --------------------------------------------------------- テストの削除・アーカイブ（0008） */

/** 削除の確認に出す、テストに関係する答案の数（論理削除済みも含む） */
export async function testUsage(testId: string) {
  const { count, error } = await createClient().from("submissions")
    .select("id", { count: "exact", head: true }).eq("test_id", testId);
  if (error) throw error;
  return { submissions: count ?? 0 };
}

/** 答案が無ければ削除、あればアーカイブ（DB の remove_test が決める） */
export async function removeTest(testId: string): Promise<"deleted" | "archived"> {
  const { data, error } = await createClient().rpc("remove_test", { p_test_id: testId });
  if (error) {
    if (error.code === "PGRST202" || /remove_test/.test(error.message)) {
      throw new Error("テストの削除機能がまだ使えません。管理者が Supabase で 0008_test_archive.sql を実行してください。");
    }
    throw error;
  }
  return data as "deleted" | "archived";
}

export async function restoreTest(testId: string) {
  const { error } = await createClient().rpc("restore_test", { p_test_id: testId });
  if (error) throw error;
}

/* ---------------------------------------------------------------- 赤ペンの位置（0009） */

const MARK_POS_MISSING = "赤ペンの位置を保存する準備ができていません。管理者が Supabase で 0009_mark_positions.sql を実行してください。";
const markPosMissing = (e: { code?: string; message?: string }) =>
  e.code === "42P01" || e.code === "PGRST205" || /mark_positions/.test(e.message ?? "");

/** 先生が動かした赤ペンの位置。0009 を実行する前の DB では空にする（自動で決めた位置で表示する） */
export async function loadMarkPositions(submissionId: string): Promise<MarkPos[]> {
  const { data, error } = await createClient().from("mark_positions").select("qno, page, x, y").eq("submission_id", submissionId);
  if (error) return [];
  return (data ?? []).map((r) => ({ qno: r.qno, page: r.page, x: Number(r.x), y: Number(r.y) }));
}

export async function saveMarkPosition(submissionId: string, p: MarkPos) {
  const { error } = await createClient().from("mark_positions")
    .upsert({ submission_id: submissionId, qno: p.qno, page: p.page, x: p.x, y: p.y }, { onConflict: "submission_id,qno" });
  if (error) throw markPosMissing(error) ? new Error(MARK_POS_MISSING) : error;
}

export async function resetMarkPosition(submissionId: string, qno: number) {
  const { error } = await createClient().from("mark_positions").delete().eq("submission_id", submissionId).eq("qno", qno);
  if (error) throw markPosMissing(error) ? new Error(MARK_POS_MISSING) : error;
}

/** まだテストに登録していない、自分の AI 読み取りの結果（新しい順）。別の URL・端末で作業を再開するのに使う */
export async function listOpenImports() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data, error } = await sb.from("test_imports")
    .select("id, request_id, created_at, files, result")
    .eq("status", "done").is("test_id", null).eq("created_by", user?.id ?? "")
    .order("created_at", { ascending: false }).limit(5);
  if (error) return [];
  return (data ?? []).map((r: any) => ({
    id: r.id as string, requestId: r.request_id as string, createdAt: r.created_at as string,
    files: (r.files ?? []) as { path: string; kind: "key" | "paper" | "student"; name: string }[],
    result: r.result as ImportResult,
  }));
}

/** 保存済みの資料を読み込む（読み取り結果から再開するとき） */
export async function downloadImportFile(path: string) {
  const { data, error } = await createClient().storage.from("answer-sheets").download(path);
  if (error || !data) throw error ?? new Error("資料を読み込めませんでした。");
  return data;
}

/** 読み取りの記録に、登録したテストを紐づける */
export async function linkImport(importId: string, testId: string) {
  await createClient().from("test_imports").update({ test_id: testId }).eq("id", importId);
}

/** 学校の既定の採点基準（test_id が null の行）。未登録なら初期値。 */
export async function loadRubric(): Promise<Rubric> {
  const sb = createClient();
  const { data, error } = await sb
    .from("rubrics").select("*").is("test_id", null).maybeSingle();
  if (error) throw error;
  return rubricFromRow(data);
}

export async function saveRubric(schoolId: string, r: Rubric) {
  const sb = createClient();
  const row = {
    school_id: schoolId,
    test_id: null,
    match_rate: r.matchRate, partial_step: r.partialStep,
    review_threshold: r.reviewThreshold,
    allow_kana: r.allowKana, allow_spell: r.allowSpell,
    unit_partial: r.unitPartial, work_partial: r.workPartial,
    case_sensitive: r.caseSensitive, outside_box: r.outsideBox,
    require_teacher: r.requireTeacher, auto_model: r.autoModel,
    strict_quality: r.strictQuality, praise_full: r.praiseFull,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("rubrics").upsert(row, { onConflict: "school_id,test_id" });
  if (error) throw error;
  await writeAudit({
    schoolId, action: "rubric.update", targetTable: "rubrics", targetId: null, detail: r,
  });
}

/** 答案画像の保存期間を変える（管理者のみ。RLS で他の役割は0行更新になる） */
export async function updateRetention(schoolId: string, retention: Retention) {
  const sb = createClient();
  const { data, error } = await sb
    .from("schools").update({ retention }).eq("id", schoolId).select("id");
  if (error) throw error;
  if (!data?.length) {
    const e: any = new Error("保存期間を変更できるのは学校の管理者だけです。管理者に依頼してください。");
    e.code = "42501";
    throw e;
  }
  await writeAudit({
    schoolId, action: "school.retention", targetTable: "schools", targetId: schoolId,
    detail: { retention },
  });
}

/* --------------------------------------------------------- 分析 */
// 集計は Postgres のビューで行う。ここでは行の形を整えるだけ。
// クラスを指定しないときは、クラス別の集計行を単元ごとに足し合わせる。

function mergeRates(rows: any[], keyOf: (r: any) => string): RateRow[] {
  const m = new Map<string, RateRow>();
  rows.forEach((r) => {
    const k = keyOf(r);
    const cur = m.get(k) ?? { key: k, earned: 0, points: 0, rate: 0, n: 0 };
    cur.earned += Number(r.earned);
    cur.points += Number(r.points);
    cur.n = (cur.n ?? 0) + Number(r.item_count ?? 0);
    m.set(k, cur);
  });
  return [...m.values()]
    .map((r) => ({ ...r, rate: r.points ? Math.round((1000 * r.earned) / r.points) / 10 : 0 }))
    .sort((a, b) => a.rate - b.rate);
}

/** 単元別の定着度 */
export async function unitMastery(testId: string, classId?: string): Promise<RateRow[]> {
  const sb = createClient();
  let q = sb.from("v_unit_mastery").select("*").eq("test_id", testId);
  if (classId) q = q.eq("class_id", classId);
  const { data, error } = await q;
  if (error) throw error;
  return mergeRates(data ?? [], (r) => r.unit);
}

/** 設問形式別の得点率 */
export async function typeMastery(testId: string, classId?: string): Promise<RateRow[]> {
  const sb = createClient();
  let q = sb.from("v_qtype_mastery").select("*").eq("test_id", testId);
  if (classId) q = q.eq("class_id", classId);
  const { data, error } = await q;
  if (error) throw error;
  return mergeRates(data ?? [], (r) => typeLabelOf(r.qtype));
}

/** 設問別の正答率 */
export async function questionStats(testId: string, classId?: string): Promise<QuestionStat[]> {
  const sb = createClient();
  const { data, error } = classId
    ? await sb.from("v_question_stats_by_class").select("*").eq("test_id", testId).eq("class_id", classId)
    : await sb.from("v_question_stats").select("*").eq("test_id", testId);
  if (error) throw error;
  return (data ?? [])
    .map((r: any) => ({
      id: r.question_id, qno: r.qno, label: r.label, unit: r.unit, n: Number(r.n),
      correctRate: Number(r.correct_rate), rate: Number(r.score_rate),
    }))
    .sort((a, b) => a.rate - b.rate);
}

/** ミスの傾向（誤答理由ごとの件数） */
export async function mistakeReasons(testId: string, classId?: string) {
  const sb = createClient();
  let q = sb.from("v_mistake_reasons").select("*").eq("test_id", testId);
  if (classId) q = q.eq("class_id", classId);
  const { data, error } = await q;
  if (error) throw error;
  const m = new Map<string, number>();
  (data ?? []).forEach((r: any) => m.set(r.reason, (m.get(r.reason) ?? 0) + Number(r.n)));
  return [...m.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

/** 要確認一覧（信頼度の低い順） */
export async function needsReview(limit = 100): Promise<ReviewEntry[]> {
  const sb = createClient();
  const { data, error } = await sb
    .from("submission_items")
    .select(`
      id, submission_id, qno, detected, confidence, mark, earned, is_blank,
      need_review, reason, comment,
      questions ( label, unit, qtype, points ),
      submissions!inner ( status, deleted_at )
    `)
    .eq("need_review", true)
    .is("submissions.deleted_at", null)
    .neq("submissions.status", "processing")
    .order("confidence", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ submissionId: r.submission_id, item: mapItem(r) }));
}

/* --------------------------------------------------------- 画像 */

/** 答案画像を保存する。パスは {school_id}/{test_id}/{submission_id}/{page}.{ext} */
export async function uploadAnswerImage(params: {
  schoolId: string; testId: string; submissionId: string; page: number; file: File;
}) {
  const sb = createClient();
  const ext = params.file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${params.schoolId}/${params.testId}/${params.submissionId}/${params.page}.${ext}`;
  const { error } = await sb.storage
    .from("answer-sheets")
    .upload(path, params.file, { upsert: true, contentType: params.file.type || undefined });
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
  if (error) console.warn("監査ログを書き込めませんでした", error.message);
}

/** 監査ログを新しい順に読む（書き出し用） */
export async function loadAudit(limit = 1000): Promise<AuditRow[]> {
  const sb = createClient();
  const { data, error } = await sb
    .from("audit_logs")
    .select("id, created_at, action, target_table, target_id, detail, actor:profiles ( display_name )")
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id, createdAt: r.created_at, action: r.action, targetTable: r.target_table,
    targetId: r.target_id, actor: r.actor?.display_name ?? "", detail: r.detail,
  }));
}

/** ハッシュ連鎖が途切れていないか確認する */
export async function verifyAuditChain(schoolId: string) {
  const sb = createClient();
  const { data, error } = await sb.rpc("verify_audit_chain", { p_school_id: schoolId });
  if (error) throw error;
  const broken = (data ?? []).filter((r: any) => r.ok === false);
  return { total: data?.length ?? 0, broken: broken.length };
}
