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

    async aiStatus() {
      try {
        const res = await fetch("/api/grade", { cache: "no-store" });
        if (!res.ok) return { enabled: false, model: null };
        return await res.json();
      } catch {
        return { enabled: false, model: null };
      }
    },
    // 1回の要求でサーバーが呼ぶモデルは1つ。3モデル併用で上の段階に回すときは、同じ requestId で続きを要求する。
    // 通信が切れて応答を受け取れなかったときも同じ requestId で送り直すので、同じモデルを二重に呼ばない（二重課金しない）。
    async aiGrade(submissionId, { mode, onProgress }) {
      const requestId = crypto.randomUUID();
      let opusConsent = false;
      if (mode === "opus") {
        const billing = await fetch("/api/billing").then(r => r.json());
        if (billing.enabled && billing.account?.personal !== false) {
          opusConsent = window.confirm("Opus単独は追加55円（税込）です。支払い画面へ進みますか？採点に失敗した場合は返金します。");
          if (!opusConsent) throw new Error("追加料金の支払いを取り消しました。");
        }
      }
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      let networkErrors = 0;
      for (let step = 0; step < 60; step++) {
        let res: Response;
        try {
          res = await fetch("/api/grade", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ submissionId, mode, requestId, opusConsent }),
          });
        } catch {
          if (++networkErrors > 3) {
            throw new Error("サーバーに接続できないためAI採点できませんでした。インターネット接続を確認して、もう一度お試しください。");
          }
          await wait(2000 * networkErrors);
          continue;
        }
        const json = await res.json().catch(() => null);
        if (res.status === 402 && json?.requiresPayment) {
          const payment = await fetch("/api/billing/opus", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: json.jobId }) });
          const info = await payment.json();
          if (!payment.ok || !info.url) throw new Error(info.error || "支払い画面を開けません。");
          window.location.assign(info.url);
          throw new Error("支払い画面に移動します。入金確認後に自動採点します。");
        }
        if (json?.queued) return { queued: true, dueAt: json.dueAt, model: "", total: 0, needReview: 0, blank: false, mode };
        if (res.status === 202 && json?.pending) { await wait(3000); continue; }   // 同じ採点がまだモデルを呼んでいる
        if (res.status === 504 || (res.status === 502 && !json)) {
          // 関数の時間切れ：サーバー側の記録が残っているので、同じ requestId で状況を確かめる
          if (++networkErrors > 3) throw new Error("AI採点に時間がかかりすぎて中断されました。もう一度お試しください。");
          await wait(3000);
          continue;
        }
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error ?? "AI採点に失敗しました。時間をおいて、もう一度お試しください。");
        }
        if (!json.done) { onProgress?.({ stage: json.stage, next: json.next, reasons: json.reasons }); continue; }
        return {
          model: json.model, total: json.total, needReview: json.needReview, blank: json.blank,
          mode: json.mode, finalStage: json.finalStage, stages: json.stages, costUsd: json.costUsd,
        };
      }
      throw new Error("AI採点が終わりませんでした。「採点中」の画面から、もう一度お試しください。");
    },
    gradingLog: (submissionId) => db.loadGradingLog(submissionId),

    uploadImportFile: (requestId, index, file) => db.uploadImportFile(schoolId(), requestId, index, file),
    // 同じ requestId で送り直しても、サーバーは同じ読み取りとして扱う（AI を二重に呼ばない）
    async importTestKey(params) {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      let networkErrors = 0;
      for (let step = 0; step < 120; step++) {
        let res: Response;
        try {
          res = await fetch("/api/test-import", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
          });
        } catch {
          if (++networkErrors > 3) throw new Error("サーバーに接続できないため読み取れませんでした。インターネット接続を確認して、もう一度お試しください。");
          await wait(2000 * networkErrors);
          continue;
        }
        const json = await res.json().catch(() => null);
        if (res.status === 202 || res.status === 504 || (res.status === 502 && !json)) { await wait(3000); continue; }
        if (!res.ok || !json?.ok) throw new Error(json?.error ?? "読み取りに失敗しました。時間をおいて、もう一度お試しください。");
        return { importId: json.importId, result: json.result, cached: !!json.cached };
      }
      throw new Error("読み取りが終わりませんでした。時間をおいて、もう一度お試しください。");
    },
    removeImportFiles: (paths) => db.removeImportFiles(paths),
    testUsage: (testId) => db.testUsage(testId),
    removeTest: (testId) => db.removeTest(testId),
    restoreTest: (testId) => db.restoreTest(testId),
    linkImport: (importId, testId) => db.linkImport(importId, testId),
    listOpenImports: () => db.listOpenImports(),
    downloadImportFile: (path) => db.downloadImportFile(path),

    loadMarkPositions: (id) => db.loadMarkPositions(id),
    saveMarkPosition: (id, pos) => db.saveMarkPosition(id, pos),
    resetMarkPosition: (id, qno) => db.resetMarkPosition(id, qno),

    signedImageUrl: (path) => db.signedImageUrl(path),
    loadAudit: () => db.loadAudit(),
    verifyAudit: () => db.verifyAuditChain(schoolId()),
  };
}
