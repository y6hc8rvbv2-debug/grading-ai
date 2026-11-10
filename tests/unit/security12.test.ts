// セキュリティの12項目（2026-11-10。docs/SECURITY-12.md）で足した仕組みの単体テスト
import { test } from "node:test";
import assert from "node:assert/strict";
import { publicError, DAILY_LIMIT } from "../../lib/security";
import { securityNotices, EXPORT_ALERT_PER_DAY } from "../../lib/security-notices";
import { download, setExportHook } from "../../lib/util";

test("12：画面には、アプリが書いた日本語の案内だけを返す（内部のエラー文は返さない）", () => {
  assert.equal(publicError(new Error("この答案は見つかりません。"), "失敗しました"), "この答案は見つかりません。");
  assert.equal(publicError(new Error('relation "billing_usage" does not exist'), "失敗しました"), "失敗しました");
  assert.equal(publicError(Object.assign(new Error("カードが拒否されました"), { name: "StripeCardError" }), "失敗しました"), "失敗しました");
  assert.equal(publicError("x", "失敗しました"), "失敗しました");
});

test("8：AI 採点にも1日の上限がある", () => {
  assert.ok(DAILY_LIMIT.grade > 0 && DAILY_LIMIT.grade <= 5000);
});

test("9：役割の変更・二段階認証の解除・多すぎる書き出しを、管理者に知らせる", () => {
  const now = Date.parse("2026-11-10T00:00:00Z");
  const at = (h: number) => new Date(now - h * 3600_000).toISOString();
  const quiet = securityNotices([{ action: "data.export", created_at: at(1), detail: null }], now);
  assert.equal(quiet.warn.length, 0);
  assert.match(quiet.info.join(), /データの書き出し（CSV）：1 件/);
  const busy = securityNotices([
    ...Array.from({ length: EXPORT_ALERT_PER_DAY }, () => ({ action: "data.export", created_at: at(2), detail: null })),
    { action: "staff.mfa_removed", created_at: at(5), detail: null },
    { action: "staff.role_change", created_at: at(30), detail: { from: "teacher", to: "admin" } },
  ], now);
  assert.equal(busy.warn.length, 3);
  assert.ok(busy.warn.every((w) => !/@/.test(w)), "お知らせにメールアドレスを出さない");
});

test("9：CSV の書き出しは記録の受け口に、ファイル名と行数だけを渡す（中身は渡さない）", () => {
  const seen: { filename: string; rows: number }[] = [];
  setExportHook((i) => seen.push(i));
  (globalThis as unknown as { document?: unknown }).document = undefined;   // ブラウザが無い環境では、保存自体は失敗してよい
  download("saiten.csv", "a,b\n1,2\n3,4\n");
  download("memo.txt", "x");
  setExportHook(null);
  assert.deepEqual(seen, [{ filename: "saiten.csv", rows: 3 }]);
});
