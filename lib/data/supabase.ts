// 本番のデータソース。lib/db/grading.ts を呼び、所属校の ID を補って渡す。
import * as db from "@/lib/db/grading";
import type { DataSource, SessionInfo } from "@/lib/data/source";

export function createSupabaseSource(): DataSource {
  let session: SessionInfo | null = null;

  const schoolId = () => {
    const id = session?.profile?.schoolId;
    if (!id) throw new Error("学校に紐づいていないアカウントです。管理者に所属校の設定を依頼してください。");
    return id;
  };
  const userId = () => {
    if (!session) throw new Error("ログインしていません。もう一度ログインしてください。");
    return session.userId;
  };

  return {
    mode: "supabase",

    async loadSession() {
      session = await db.loadSession();
      return session;
    },
    saveUiLang: (lang) => db.saveUiLang(userId(), lang),
    signOut: () => db.signOut(),

    loadWorkspace: () => db.loadWorkspace(),
    loadSubmissions: () => db.loadSubmissions(),
    loadSubmission: (id) => db.loadSubmission(id),

    async saveGrading(input, files = []) {
      const sid = schoolId();
      const id = await db.saveGrading(sid, input);
      if (files.length) {
        const paths: string[] = [];
        for (let i = 0; i < files.length; i++) {
          paths.push(await db.uploadAnswerImage({
            schoolId: sid, testId: input.testId, submissionId: id, page: i + 1, file: files[i],
          }));
        }
        await db.attachImages(id, paths);
      }
      return id;
    },
    updateItem: (submissionId, itemId, patch) =>
      db.updateItem({ schoolId: schoolId(), submissionId, itemId, patch }),
    markReviewed: (submissionId) => db.markReviewed(schoolId(), submissionId),

    createTest: (input) => db.createTest(schoolId(), userId(), input),
    loadRubric: () => db.loadRubric(),
    saveRubric: (r) => db.saveRubric(schoolId(), r),
    updateRetention: (r) => db.updateRetention(schoolId(), r),

    unitMastery: db.unitMastery,
    typeMastery: db.typeMastery,
    questionStats: db.questionStats,
    mistakeReasons: db.mistakeReasons,
    needsReview: () => db.needsReview(),

    signedImageUrl: (path) => db.signedImageUrl(path),
    loadAudit: () => db.loadAudit(),
    verifyAudit: () => db.verifyAuditChain(schoolId()),
  };
}
