// Stripe からの通知（Webhook）を受け取り、契約状態をサーバーに記録する。
// 支払い成功・更新・支払い失敗・解約などが、利用者が画面を開いていなくても自動で反映される。
//   必要な設定: STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / 共有データの置き場（KV）
//   Stripe 側の送信先: https://（公開URL）/api/stripe-webhook
import { hasStore, kv, parse, hmacSha256, sameText, saveSubscription } from './_store.js';

export const config = { runtime: 'edge' };

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const TOLERANCE = 300; // 署名の有効期限（秒）。古い通知の使い回しを防ぐ

// Stripe-Signature ヘッダー（t=時刻,v1=署名）を検証する
async function verify(raw, header, secret) {
  const parts = Object.fromEntries((header || '').split(',').map((kvp) => kvp.split('=')).filter((x) => x.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
  const signatures = (header || '').split(',').filter((p) => p.trim().startsWith('v1=')).map((p) => p.trim().slice(3));
  const t = Number(parts.t);
  if (!t || !signatures.length || Math.abs(Date.now() / 1000 - t) > TOLERANCE) return false;
  const expected = await hmacSha256(secret, `${t}.${raw}`);
  return signatures.some((s) => sameText(s, expected));
}

async function stripeGet(path) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } });
  if (!r.ok) throw new Error(`stripe ${r.status}`);
  return r.json();
}

// 指導案の購入を記録する（同じ購入を二重に数えない）
async function recordPurchase(meta) {
  if (!meta.userId || !meta.itemId) return;
  const added = await kv('SADD', `js:buy:${meta.userId}`, meta.itemId);
  if (added !== 1) return;
  const item = parse(await kv('HGET', 'js:lib', meta.itemId));
  if (item) { item.sales = (item.sales || 0) + 1; await kv('HSET', 'js:lib', item.id, JSON.stringify(item)); }
}

export default async function handler(request) {
  if (request.method !== 'POST') return json(405, { error: 'POST only' });
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY || !hasStore) return json(503, { error: 'WEBHOOK_NOT_CONFIGURED' });

  const raw = await request.text();
  if (!(await verify(raw, request.headers.get('stripe-signature'), secret))) return json(400, { error: 'INVALID_SIGNATURE' });
  const event = parse(raw);
  if (!event?.id || !event.type) return json(400, { error: 'INVALID_EVENT' });

  // 同じ通知が再送されても1回だけ処理する
  const first = await kv('SET', `js:evt:${event.id}`, '1', 'NX', 'EX', 60 * 60 * 24 * 7);
  if (first !== 'OK') return json(200, { received: true, duplicate: true });

  try {
    const obj = event.data?.object || {};
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const meta = obj.metadata || {};
        if (obj.mode === 'subscription' && obj.subscription) {
          const sub = await stripeGet(`subscriptions/${encodeURIComponent(obj.subscription)}`);
          await saveSubscription(sub, { userId: meta.userId, planCode: meta.planCode });
        } else if (obj.mode === 'payment' && obj.payment_status === 'paid' && meta.type === 'purchase') {
          await recordPurchase(meta);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed':
        await saveSubscription(obj);
        break;
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        // 請求の結果で契約状態（有効／支払い待ち）が変わるので、最新の契約を取り直す
        const subId = obj.subscription || obj.parent?.subscription_details?.subscription;
        if (subId) await saveSubscription(await stripeGet(`subscriptions/${encodeURIComponent(subId)}`));
        break;
      }
      default:
        break;
    }
  } catch (err) {
    // 失敗した時は「未処理」に戻して Stripe に再送してもらう
    await kv('DEL', `js:evt:${event.id}`).catch(() => {});
    console.error('[stripe-webhook] failed', event.type, err?.message);
    return json(500, { error: 'PROCESSING_FAILED' });
  }
  return json(200, { received: true });
}
