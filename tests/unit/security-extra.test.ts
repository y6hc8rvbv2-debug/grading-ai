// 2026-11-13 に足したセキュリティの仕組み（13 AI の脆弱性の点検・15 海外からのアクセスの遮断）の単体テスト
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { geoDecision, geoEnabled, clientIp } from "../../lib/geo";
import { extractFindings, cleanFinding, toSarif } from "../../scripts/security/ai-sarif.mjs";

const VERCEL = { VERCEL: "1" };
const req = (over: Partial<{ path: string; country: string | null; ip: string | null; bypass: string | null }> = {}) =>
  ({ path: "/", country: "JP", ip: "203.0.113.1", bypass: null, ...over });

test("15：Vercel の上では、日本からは通し、海外からは断る", () => {
  assert.equal(geoDecision(req(), VERCEL).allow, true);
  const d = geoDecision(req({ country: "US" }), VERCEL);
  assert.equal(d.allow, false);
  assert.equal(geoDecision(req({ country: "us", path: "/api/grade" }), VERCEL).allow, false);
  assert.equal(geoDecision(req({ country: "CN", path: "/login" }), VERCEL).allow, false);
  assert.equal(geoDecision(req({ country: "KR", path: "/submit/abc" }), VERCEL).allow, false);
});

test("15：通す国を変えられる・止められる・Vercel の外では断らない", () => {
  assert.equal(geoDecision(req({ country: "US" }), { ...VERCEL, GEO_ALLOW_COUNTRIES: "JP, US" }).allow, true);
  assert.equal(geoDecision(req({ country: "US" }), { ...VERCEL, GEO_BLOCK: "off" }).allow, true);
  assert.equal(geoEnabled({}), false);
  assert.equal(geoDecision(req({ country: "US" }), {}).allow, true); // 手元（国の情報が信用できない）
  assert.equal(geoEnabled({ GEO_BLOCK: "on" }), true);
});

test("15：決済・定期処理の通知と公開ページは海外からでも通す（ほかは通さない）", () => {
  for (const p of ["/api/billing/webhook", "/api/billing/crypto/webhook", "/api/billing/worker", "/api/retention/purge", "/api/tutor/sweep", "/privacy", "/terms", "/start", "/tokushoho"]) {
    assert.equal(geoDecision(req({ country: "US", path: p }), VERCEL).allow, true, p);
  }
  for (const p of ["/api/billing", "/api/billing/prepaid", "/api/tutor/session", "/privacyx", "/student", "/api/image"]) {
    assert.equal(geoDecision(req({ country: "US", path: p }), VERCEL).allow, false, p);
  }
});

test("15：Vercel の自動確認の秘密が一致するとき・許可した IP だけ例外", () => {
  const env = { ...VERCEL, VERCEL_AUTOMATION_BYPASS_SECRET: "s3cret-value" };
  assert.equal(geoDecision(req({ country: "US", bypass: "s3cret-value" }), env).allow, true);
  assert.equal(geoDecision(req({ country: "US", bypass: "s3cret-valuX" }), env).allow, false);
  assert.equal(geoDecision(req({ country: "US", bypass: "" }), { ...VERCEL, VERCEL_AUTOMATION_BYPASS_SECRET: "" }).allow, false);
  assert.equal(geoDecision(req({ country: "US", ip: "198.51.100.7" }), { ...VERCEL, GEO_ALLOW_IPS: "198.51.100.7" }).allow, true);
  assert.equal(geoDecision(req({ country: "US", ip: "198.51.100.8" }), { ...VERCEL, GEO_ALLOW_IPS: "198.51.100.7" }).allow, false);
  const h = new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" });
  assert.equal(clientIp(h), "198.51.100.7");
});

test("15：proxy.ts は、ログインの確認より前に海外を断る", () => {
  const src = readFileSync("proxy.ts", "utf8");
  assert.ok(src.indexOf("geoDecision(") > 0 && src.indexOf("geoDecision(") < src.indexOf("createServerClient("));
});

test("13：AI の点検結果は、形を確かめてから Code scanning の形（SARIF）にする", () => {
  const exec = [{ type: "assistant" }, { type: "result", structured_output: { findings: [
    { file: "proxy.ts", line: 10, severity: "high", category: "Auth Bypass", title: "例", description: "説明", recommendation: "直し方" },
    { file: "../etc/passwd", line: 1, severity: "high", category: "x", title: "外のファイル" },
    { file: "no/such/file.ts", line: 1, severity: "high", category: "x", title: "無いファイル" },
    { file: "proxy.ts", line: 1, severity: "urgent", category: "x", title: "知らない重さ" },
  ] } }];
  const found = extractFindings(exec);
  assert.equal(found.length, 4);
  const clean = found.map((f: unknown) => cleanFinding(f)).filter(Boolean);
  assert.equal(clean.length, 1);
  assert.equal(clean[0].category, "auth-bypass");
  const sarif = toSarif(clean);
  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs[0].results[0].level, "error");
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, "proxy.ts");
  assert.equal(extractFindings([{ type: "assistant" }]), null);
  assert.deepEqual(toSarif([]).runs[0].results, []);
});

test("13：AI の点検の workflow は、結果をログに出さず、鍵が無ければ飛ばす", () => {
  const y = readFileSync(".github/workflows/security-ai.yml", "utf8");
  assert.match(y, /show_full_output: "false"/);
  assert.match(y, /display_report: "false"/);
  assert.match(y, /upload-sarif/);
  assert.match(y, /HAS_KEY == 'true'/);
  assert.doesNotMatch(y, /pull_request_target/);
  assert.doesNotMatch(y, /structured_output \}\}/); // 結果を env・ログに展開しない
});
