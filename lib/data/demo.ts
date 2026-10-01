// デモモードのデータソース（Supabase 未設定時のみ使う）。
// メモリ上で動くので、ページを再読み込みすると初期状態に戻る。
// 合計点・状態・分析の計算は、本番では Postgres のトリガーとビューが行う。
// ここではそれと同じ規則を JavaScript で再現している（デモ専用）。
import { DEMO_CLASSES, DEMO_STUDENTS, DEMO_TESTS, buildDemoSubmissions } from "@/lib/demo/data";
import { DEFAULT_RUBRIC, typeLabelOf } from "@/lib/grading/engine";
import { pct } from "@/lib/util";
import type { DataSource, SessionInfo } from "@/lib/data/source";
import type {
  AuditRow, Item, QuestionStat, RateRow, Retention, Rubric, Submission, Test,
} from "@/lib/types";

const DEMO_SESSION: SessionInfo = {
  userId: "demo-user",
  email: "demo@example.jp",
  profile: { id: "demo-user", schoolId: "demo-school", role: "admin", displayName: "T.K", uiLang: "ja" },
  school: { id: "demo-school", name: "デモ中学校", code: "DEMO-001", retention: "year", plan: "school" },
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// 本番の recalc_submission_total トリガーと同じ規則
function recalc(s: Submission): Submission {
  const total = s.result.items.reduce((a, i) => a + i.earned, 0);
  const status: Submission["status"] =
    s.result.blank ? "blank"
    : (s.status === "processing" || s.status === "uploaded") && s.progress < 100 ? s.status
    : s.status === "quality" && !s.reviewedBy ? "quality"
    : s.result.items.some((i) => i.needReview) ? "review"
    : "done";
  return { ...s, status, result: { ...s.result, total } };
}

export function createDemoSource(): DataSource {
  let subs: Submission[] = buildDemoSubmissions();
  const tests: Test[] = clone(DEMO_TESTS);
  let rubric: Rubric = { ...DEFAULT_RUBRIC };
  let retention: Retention = "year";
  const audit: AuditRow[] = [];
  let seq = 0;

  const log = (action: string, targetTable: string, targetId: string | null, detail: unknown) => {
    audit.unshift({
      id: ++seq, createdAt: new Date().toISOString(), action, targetTable, targetId,
      actor: DEMO_SESSION.profile!.displayName, detail,
    });
  };

  const graded = (testId: string, classId?: string) =>
    subs.filter((s) => s.testId === testId
      && !["processing", "uploaded", "blank"].includes(s.status)
      && (!classId || s.classId === classId));

  const rateBy = (testId: string, classId: string | undefined, keyOf: (i: Item) => string): RateRow[] => {
    const m = new Map<string, RateRow>();
    graded(testId, classId).forEach((s) => s.result.items.forEach((it) => {
      const k = keyOf(it);
      const r = m.get(k) ?? { key: k, earned: 0, points: 0, rate: 0, n: 0 };
      r.earned += it.earned; r.points += it.points; r.n = (r.n ?? 0) + 1;
      m.set(k, r);
    }));
    return [...m.values()].map((r) => ({ ...r, rate: pct(r.earned, r.points) })).sort((a, b) => a.rate - b.rate);
  };

  return {
    mode: "demo",

    loadSession: async () => ({ ...DEMO_SESSION, school: { ...DEMO_SESSION.school!, retention } }),
    saveUiLang: async () => {},
    signOut: async () => {},

    loadWorkspace: async () => ({
      classes: clone(DEMO_CLASSES),
      students: clone(DEMO_STUDENTS),
      tests: clone(tests),
    }),
    loadSubmissions: async () => clone(subs),
    loadSubmission: async (id) => clone(subs.find((s) => s.id === id) ?? null),

    async saveGrading(input) {
      const test = tests.find((t) => t.id === input.testId)!;
      const id = `sub_new_${Date.now()}_${input.studentId}`;
      const items: Item[] = input.items.map((i) => {
        const q = test.questions.find((qq) => qq.id === i.questionId)!;
        return {
          id: `${id}_${i.qno}`, qno: i.qno, label: q.label, unit: q.unit, type: q.type,
          typeLabel: q.typeLabel, points: q.points, detected: i.detected, confidence: i.confidence,
          blank: i.blank, mark: i.mark, earned: i.earned, needReview: i.needReview,
          reason: i.reason, comment: i.comment,
        };
      });
      const sub: Submission = recalc({
        id, testId: input.testId, studentId: input.studentId, classId: input.classId,
        source: input.source,
        status: input.pending ? "uploaded" : input.isBlank ? "blank" : !input.quality.ok ? "quality" : "processing",
        pages: input.pages, progress: input.pending ? 0 : 100, quality: input.quality, imagePaths: [],
        edited: false, reviewedBy: "", uploadedAt: new Date().toISOString().slice(0, 19),
        result: { items, total: 0, blank: input.isBlank },
      });
      // 同じテスト×生徒の再提出は上書き（本番の unique 制約と同じ）
      subs = [sub, ...subs.filter((s) => !(s.testId === sub.testId && s.studentId === sub.studentId))];
      log("grading.create", "submissions", id, { items: items.length, blank: input.isBlank });
      return id;
    },

    async updateItem(submissionId, itemId, patch) {
      subs = subs.map((s) => s.id !== submissionId ? s : recalc({
        ...s, edited: true,
        result: { ...s.result, items: s.result.items.map((it) => it.id !== itemId ? it : { ...it, ...patch }) },
      }));
      log("grading.edit", "submission_items", itemId, patch);
    },

    async markReviewed(submissionId) {
      subs = subs.map((s) => s.id !== submissionId ? s : recalc({
        ...s, reviewedBy: DEMO_SESSION.profile!.displayName,
        result: { ...s.result, items: s.result.items.map((it) => ({ ...it, needReview: false })) },
      }));
      log("submission.review", "submissions", submissionId, {});
    },

    async createTest(input) {
      const id = `t_new_${Date.now()}`;
      const questions = input.questions.map((q, i) => ({
        id: `${id}_q${i + 1}`, no: i + 1, big: q.big,
        label: q.sub ? `大問${q.big}-${q.sub}` : `大問${q.big}`,
        type: q.type, typeLabel: typeLabelOf(q.type), unit: q.unit, points: q.points,
        difficulty: q.difficulty, correct: q.correct, model: q.model,
      }));
      tests.unshift({
        id, name: input.name, subject: input.subject, grade: input.grade, term: input.term,
        date: input.date, testNo: input.testNo, units: input.units,
        maxScore: questions.reduce((a, q) => a + q.points, 0),
        bigCount: questions.reduce((a, q) => Math.max(a, q.big), 0),
        questions,
      });
      log("test.create", "tests", id, { name: input.name, questions: questions.length });
      return id;
    },

    loadRubric: async () => ({ ...rubric }),
    async saveRubric(r) { rubric = { ...r }; log("rubric.update", "rubrics", null, r); },
    async updateRetention(r) { retention = r; log("school.retention", "schools", "demo-school", { retention: r }); },

    unitMastery: async (testId, classId) => rateBy(testId, classId, (i) => i.unit),
    typeMastery: async (testId, classId) => rateBy(testId, classId, (i) => i.typeLabel),
    async questionStats(testId, classId) {
      const m = new Map<number, QuestionStat & { earned: number; points: number; correct: number }>();
      graded(testId, classId).forEach((s) => s.result.items.forEach((it) => {
        const q = m.get(it.qno) ?? {
          id: `q${it.qno}`, qno: it.qno, label: it.label, unit: it.unit,
          n: 0, correctRate: 0, rate: 0, earned: 0, points: 0, correct: 0,
        };
        q.n++; q.earned += it.earned; q.points += it.points; if (it.mark === "○") q.correct++;
        m.set(it.qno, q);
      }));
      return [...m.values()]
        .map((q) => ({ id: q.id, qno: q.qno, label: q.label, unit: q.unit, n: q.n,
          rate: pct(q.earned, q.points), correctRate: pct(q.correct, q.n) }))
        .sort((a, b) => a.rate - b.rate);
    },
    async mistakeReasons(testId, classId) {
      const m = new Map<string, number>();
      graded(testId, classId).forEach((s) => s.result.items.forEach((it) => {
        if (it.reason && it.mark !== "○") m.set(it.reason, (m.get(it.reason) ?? 0) + 1);
      }));
      return [...m.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
    },
    async needsReview() {
      const out: { submissionId: string; item: Item }[] = [];
      subs.forEach((s) => {
        if (s.status === "processing") return;
        s.result.items.forEach((it) => { if (it.needReview) out.push({ submissionId: s.id, item: clone(it) }); });
      });
      return out.sort((a, b) => a.item.confidence - b.item.confidence);
    },

    aiStatus: async () => ({ enabled: false, model: null }),
    aiGrade: async () => {
      throw new Error("デモモードでは採点AIを使えません。Supabase と ANTHROPIC_API_KEY を設定すると使えます。");
    },
    gradingLog: async () => [],
    importTestKey: async () => {
      throw new Error("デモモードでは模範解答からの自動入力を使えません。Supabase と ANTHROPIC_API_KEY を設定すると使えます。");
    },
    uploadImportFile: async () => { throw new Error("デモモードでは資料を保存できません。"); },
    removeImportFiles: async () => {},
    linkImport: async () => {},

    signedImageUrl: async () => "",
    loadAudit: async () => clone(audit),
    verifyAudit: async () => ({ total: audit.length, broken: 0 }),
  };
}
