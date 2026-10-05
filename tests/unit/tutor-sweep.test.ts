// 見回り（/api/tutor/sweep）の認証：CRON_SECRET が無い・短い・違うときは断る
import { test } from "node:test";
import assert from "node:assert/strict";
import { sweepAuthorized } from "@/lib/tutor/sweep";

const req = (auth?: string) => new Request("http://localhost/api/tutor/sweep", { method: "POST", headers: auth ? { authorization: auth } : {} });

test("見回りは CRON_SECRET（32文字以上）と一致するときだけ受け付ける", () => {
  const good = "x".repeat(40);
  delete process.env.CRON_SECRET;
  assert.equal(sweepAuthorized(req(`Bearer ${good}`)), false, "未設定なら断る");
  process.env.CRON_SECRET = "short";
  assert.equal(sweepAuthorized(req("Bearer short")), false, "短すぎる秘密は使わない");
  process.env.CRON_SECRET = good;
  assert.equal(sweepAuthorized(req()), false, "認証なしは断る");
  assert.equal(sweepAuthorized(req(`Bearer ${good}x`)), false, "違う値は断る");
  assert.equal(sweepAuthorized(req(`Bearer ${good}`)), true);
  delete process.env.CRON_SECRET;
});
