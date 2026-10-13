// Stripe の代役（tests/e2e-lite/billing.mjs 用）。本物の Stripe には接続しない。
// アプリ（lib/billing/server.ts）はテスト用のキー（sk_test_…）のときだけ STRIPE_API_BASE_URL でここに向く。
// 料金（Price）は lib/subscription-plans.ts の確定表と同じ値で返す（税区分・毎月・円・テスト環境）。
//   GET  /v1/prices/:id            料金（表に無い ID は 404）
//   GET  /v1/tax_rates/:id         税率（txr_test_jp10 だけ：10%・税別に加算）
//   POST /v1/customers             支払者
//   POST /v1/checkout/sessions     決済画面（送られた内容を記録する）
//   GET  /v1/checkout/sessions/:id / POST …/:id/expire
//   GET  /v1/subscriptions/:id     契約（latest_invoice を含む）
//   POST /v1/billing_portal/sessions
//   GET  /pay/:id                  決済画面の代わりのページ
// テスト用の操作：POST /__complete/:cs（支払い完了→契約を作る）・POST /__cancel/:sub（解約）・GET /__log（受けた要求）
import http from "node:http";
import { COURSES } from "../../lib/subscription-plans.ts";

const PORT = Number(process.env.STRIPE_MOCK_PORT || 54396);
const BASE = `http://127.0.0.1:${PORT}`;
const log = [];
const sessions = new Map(), subs = new Map();
let n = 0;
const now = () => Math.floor(Date.now() / 1000);

const price = (c) => ({
  id: c.testPriceId, object: "price", active: true, livemode: false, currency: "jpy", unit_amount: c.monthlyYen,
  tax_behavior: c.tax, type: "recurring", recurring: { interval: "month", interval_count: 1 }, product: `prod_${c.key}`,
});
// application/x-www-form-urlencoded（a[b][0][c]=x）を平らな表のまま返す
const form = (body) => Object.fromEntries(new URLSearchParams(body));

http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  let body = "";
  for await (const ch of req) body += ch;
  const send = (code, obj, type = "application/json") => { res.writeHead(code, { "content-type": type }); res.end(type === "application/json" ? JSON.stringify(obj) : obj); };
  if (url.pathname === "/__log") return send(200, log);
  log.push({ method: req.method, path: url.pathname, form: req.method === "POST" ? form(body) : undefined });
  let m;
  if ((m = url.pathname.match(/^\/v1\/prices\/([^/]+)$/))) {
    const c = COURSES.find((x) => x.testPriceId === m[1]);
    return c ? send(200, price(c)) : send(404, { error: { type: "invalid_request_error", message: "No such price" } });
  }
  if ((m = url.pathname.match(/^\/v1\/tax_rates\/([^/]+)$/))) {
    return m[1] === "txr_test_jp10"
      ? send(200, { id: "txr_test_jp10", object: "tax_rate", active: true, inclusive: false, percentage: 10, country: "JP", livemode: false, display_name: "消費税" })
      : send(404, { error: { type: "invalid_request_error", message: "No such tax rate" } });
  }
  if (url.pathname === "/v1/customers" && req.method === "POST") return send(200, { id: `cus_test_${++n}`, object: "customer" });
  if (url.pathname === "/v1/billing_portal/sessions" && req.method === "POST") return send(200, { id: `bps_${++n}`, object: "billing_portal.session", url: `${BASE}/portal` });
  if (url.pathname === "/v1/checkout/sessions" && req.method === "POST") {
    const f = form(body);
    const id = `cs_test_${++n}`;
    const s = { id, object: "checkout.session", mode: f.mode, customer: f.customer, status: "open", payment_status: "unpaid", url: `${BASE}/pay/${id}`,
      subscription: null, price: f["line_items[0][price]"], tax_rate: f["line_items[0][tax_rates][0]"] ?? null, amount_total: null, currency: "jpy" };
    sessions.set(id, s);
    return send(200, s);
  }
  if ((m = url.pathname.match(/^\/v1\/checkout\/sessions\/([^/]+)(\/expire)?$/))) {
    const s = sessions.get(m[1]);
    if (!s) return send(404, { error: { type: "invalid_request_error", message: "No such checkout session" } });
    if (m[2]) s.status = "expired";
    return send(200, s);
  }
  if ((m = url.pathname.match(/^\/v1\/subscriptions\/([^/]+)$/))) {
    const s = subs.get(m[1]);
    return s ? send(200, s) : send(404, { error: { type: "invalid_request_error", message: "No such subscription" } });
  }
  if ((m = url.pathname.match(/^\/pay\/([^/]+)$/))) return send(200, `<!doctype html><meta charset="utf-8"><title>決済の代役</title><p>決済の代役 ${m[1]}</p>`, "text/html; charset=utf-8");
  if ((m = url.pathname.match(/^\/__complete\/([^/]+)$/))) {
    const s = sessions.get(m[1]);
    const c = COURSES.find((x) => x.testPriceId === s?.price);
    if (!s || !c) return send(404, {});
    const id = `sub_test_${++n}`;
    subs.set(id, { id, object: "subscription", status: "active", customer: s.customer, livemode: false,
      latest_invoice: { id: `in_${n}`, object: "invoice", status: "paid" },
      items: { object: "list", data: [{ id: `si_${n}`, object: "subscription_item", quantity: 1, price: price(c), current_period_start: now() - 60, current_period_end: now() + 30 * 86400 }] } });
    Object.assign(s, { status: "complete", payment_status: "paid", subscription: id });
    return send(200, { session: s.id, subscription: id });
  }
  if ((m = url.pathname.match(/^\/__cancel\/([^/]+)$/))) {
    const s = subs.get(m[1]);
    if (!s) return send(404, {});
    s.status = "canceled";
    return send(200, s);
  }
  return send(404, { error: { type: "invalid_request_error", message: `代役に無い要求：${req.method} ${url.pathname}` } });
}).listen(PORT, "127.0.0.1", () => console.log(`stripe-mock :${PORT}`));
