// 保存期間を過ぎた答案の削除（lib/retention.ts）の単体テスト
import { test } from "node:test";
import assert from "node:assert/strict";
import { cutoff, purgeExpired, type RetentionDb } from "@/lib/retention";

const NOW = new Date("2026-10-10T00:00:00Z");

test("保存期間の基準日：30日・180日・学年度末から1年（15か月）・手動は消さない", () => {
  assert.equal(cutoff("30", NOW)!.toISOString(), "2026-09-10T00:00:00.000Z");
  assert.equal(cutoff("180", NOW)!.toISOString(), "2026-04-13T00:00:00.000Z");
  assert.equal(cutoff("year", NOW)!.toISOString(), "2025-07-10T00:00:00.000Z");
  assert.equal(cutoff("manual", NOW), null);
});

test("画像を先に消し、消し終えた答案だけを削除済みにする（手動の学校は触らない）", async () => {
  const calls: string[] = [];
  const db: RetentionDb = {
    async schools() { return [{ id: "s1", retention: "30" }, { id: "s2", retention: "manual" }]; },
    async expired(schoolId, before) {
      calls.push(`expired ${schoolId} ${before}`);
      return Array.from({ length: 150 }, (_, i) => ({ id: `sub${i}`, image_paths: [`s1/t/sub${i}/1.jpg`, i === 0 ? `s1/t/sub0/1.jpg` : `s1/t/sub${i}/2.jpg`] }));
    },
    async removeImages(paths) { calls.push(`remove ${paths.length}`); },
    async purge(ids) { calls.push(`purge ${ids.length}`); return ids.length; },
  };
  const r = await purgeExpired(db, NOW);
  assert.deepEqual(calls, ["expired s1 2026-09-10T00:00:00.000Z", "remove 100", "remove 100", "remove 99", "purge 150"]);
  assert.deepEqual(r, { images: 299, submissions: 150 });
});

test("画像の削除に失敗したら、削除済みにしない（次の回にやり直す）", async () => {
  let purged = false;
  const db: RetentionDb = {
    async schools() { return [{ id: "s1", retention: "30" }]; },
    async expired() { return [{ id: "a", image_paths: ["x.jpg"] }]; },
    async removeImages() { throw new Error("storage down"); },
    async purge() { purged = true; return 1; },
  };
  await assert.rejects(purgeExpired(db, NOW), /storage down/);
  assert.equal(purged, false);
});
