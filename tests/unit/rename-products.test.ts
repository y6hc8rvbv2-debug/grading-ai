// Stripe の商品名の変更（scripts/billing/rename-products.mjs）：代役の Stripe で確かめる。本物の Stripe には接続しない
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { COURSES } from "../../lib/subscription-plans";

const run = promisify(execFile);

async function fake() {
  // 料金はすべて2つの商品に属する。片方だけ ver5 の名前
  const products: Record<string, { id: string; name: string }> = { prod_a: { id: "prod_a", name: "テスト採点ver5 個人・塾 ミニ" }, prod_b: { id: "prod_b", name: "学校 スタンダード" } };
  const updates: string[] = [];
  const server = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
      const u = new URL(req.url ?? "/", "http://x");
      const send = (o: unknown, s = 200) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      let m;
      if ((m = u.pathname.match(/^\/v1\/prices\/(.+)$/))) return send({ id: m[1], object: "price", livemode: false, product: COURSES.findIndex((c) => c.testPriceId === m[1]) % 2 ? "prod_b" : "prod_a" });
      if ((m = u.pathname.match(/^\/v1\/products\/(.+)$/))) {
        const p = products[m[1]];
        if (req.method === "POST") { p.name = new URLSearchParams(body).get("name") ?? p.name; updates.push(p.id); }
        return send({ ...p, object: "product" });
      }
      send({ error: { message: "not found" } }, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  return { server, products, updates, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}
const exec = (url: string, key: string, apply = false) =>
  run(process.execPath, ["--import", "tsx", "scripts/billing/rename-products.mjs", ...(apply ? ["--apply"] : [])],
    { env: { ...process.env, STRIPE_SECRET_KEY: key, STRIPE_API_BASE_URL: url } }).then((r) => r.stdout, (e) => String(e.stdout));

test("読み取りだけでは変えない・--apply で ver5 の商品だけ ver6 にする・2回目は変更なし", async () => {
  const f = await fake();
  try {
    const dry = await exec(f.url, "sk_test_dummy");
    assert.match(dry, /変更予定：テスト採点ver5 個人・塾 ミニ → テスト採点ver6 個人・塾 ミニ/);
    assert.equal(f.updates.length, 0);
    const out = await exec(f.url, "sk_test_dummy", true);
    assert.match(out, /変更 1 件・変更不要 1 件/);
    assert.equal(f.products.prod_a.name, "テスト採点ver6 個人・塾 ミニ");
    assert.equal(f.products.prod_b.name, "学校 スタンダード");
    assert.match(await exec(f.url, "sk_test_dummy", true), /変更 0 件・変更不要 2 件/);
  } finally { f.server.close(); }
});

test("本番のキー・キーなしでは何もしない", async () => {
  const f = await fake();
  try {
    for (const k of ["sk_live_dummy", "rk_live_dummy", ""]) assert.match(await exec(f.url, k, true), /停止/);
    assert.equal(f.updates.length, 0);
  } finally { f.server.close(); }
});
