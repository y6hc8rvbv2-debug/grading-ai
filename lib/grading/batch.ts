// 夜間の Batch 採点（2026-11-02）。Message Batches API は通常の半額。結果は最長24時間以内（多くは1時間以内）に返る。
// 夜間コースの答案は、定期処理（app/api/billing/worker）がまとめて送り、結果が出たら同じ後処理で保存する
export const BATCH_DISCOUNT = 0.5;
/** 1回の Batch にまとめる答案の数（画像を含むので、1回の定期処理の時間と大きさに収まる数） */
export const BATCH_MAX_REQUESTS = 40;
/** Batch に送った答案は、結果が出るまで定期処理が取り直さない（最長24時間＋余裕） */
export const BATCH_LEASE_HOURS = 26;
/** 夜間の Batch を使うか（NIGHT_BATCH=off で従来の1件ずつの採点に戻せる） */
export const nightBatchEnabled = () => process.env.NIGHT_BATCH !== "off";
