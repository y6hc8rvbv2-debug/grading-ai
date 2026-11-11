// 共有機能の窓口（設定確認・ライブラリ・利用者の声・児童生徒からの提出の中継・問い合わせ・決済・管理者）。
// 何も設定しなくてもアプリ本体は「この端末だけ」で動く。ここは、設定されている機能だけを有効にする。
//   共有データ置き場 : KV_REST_API_URL / KV_REST_API_TOKEN（Vercel の Upstash for Redis 連携で自動設定）
//   決済            : STRIPE_SECRET_KEY
//   個人情報の暗号化 : PII_KEY_V1 / PII_INDEX_KEY（PII Shield）
//   管理者          : ADMIN_KEY
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const hasStore = Boolean(KV_URL && KV_TOKEN);
const hasStripe = Boolean(process.env.STRIPE_SECRET_KEY);
const hasPiiKeys = Boolean(process.env.PII_KEY_V1 && process.env.PII_INDEX_KEY);

// 月額プランの金額はサーバー側で固定する（画面から金額を書き換えられないようにするため）
const PLANS = {
  mini: { name: 'ミニコース', amount: 500 },
  individual: { name: '個人・塾コース', amount: 1980 },
  school: { name: '学校コース', amount: 4980 },
  government: { name: '行政コース', amount: 9980 },
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const need = (cond, status, message) => { if (!cond) throw new HttpError(status, message); };
const sha = (v) => createHash('sha256').update(String(v)).digest('hex');
const str = (v, max = 2000) => String(v ?? '').slice(0, max).trim();
const safeEqual = (a, b) => {
  const x = Buffer.from(sha(a)); const y = Buffer.from(sha(b));
  return timingSafeEqual(x, y);
};

async function kv(...cmd) {
  need(hasStore, 503, 'STORE_NOT_CONFIGURED');
  const r = await fetch(KV_URL, { method: 'POST', headers: { authorization: `Bearer ${KV_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
  const data = await r.json();
  if (!r.ok || data.error) throw new HttpError(502, '共有データの保存先でエラーが発生しました');
  return data.result;
}
const parse = (v) => { try { return JSON.parse(v); } catch { return null; } };
const hashAll = async (key) => {
  const flat = (await kv('HGETALL', key)) || [];
  const out = [];
  for (let i = 1; i < flat.length; i += 2) { const v = parse(flat[i]); if (v) out.push(v); }
  return out;
};
const listAll = async (key, n = 300) => ((await kv('LRANGE', key, 0, n - 1)) || []).map(parse).filter(Boolean);

// PII Shield は鍵がある時だけ読み込む（鍵なしで読み込むと起動時にエラーになるため）
let shieldPromise;
async function getShield() {
  need(hasPiiKeys, 503, 'PII_NOT_CONFIGURED');
  shieldPromise ||= import('../lib/pii-shield.js').then((m) => m.shield);
  return shieldPromise;
}

async function stripe(method, path, params) {
  need(hasStripe, 503, 'STRIPE_NOT_CONFIGURED');
  const body = new URLSearchParams();
  const walk = (prefix, value) => {
    if (value === undefined || value === null) return;
    if (typeof value === 'object') Object.entries(value).forEach(([k, v]) => walk(prefix ? `${prefix}[${k}]` : k, v));
    else body.append(prefix, String(value));
  };
  if (params) walk('', params);
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : body,
  });
  const data = await r.json();
  if (!r.ok) throw new HttpError(502, '決済サービスでエラーが発生しました');
  return data;
}

const publicItem = ({ ownerHash, ...rest }) => rest;
const isAdmin = (b) => Boolean(process.env.ADMIN_KEY) && typeof b.adminKey === 'string' && safeEqual(b.adminKey, process.env.ADMIN_KEY);

const actions = {
  // ── 設定状況 ──
  async config() {
    return {
      ai: Boolean(process.env.ANTHROPIC_API_KEY),
      model: process.env.CLAUDE_MODEL || 'claude-opus-5-5',
      accessCode: Boolean(process.env.APP_ACCESS_CODE),
      store: hasStore,
      stripe: hasStripe,
      pii: hasPiiKeys,
      admin: Boolean(process.env.ADMIN_KEY),
      googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    };
  },

  // ── 指導案ライブラリ ──
  async 'lib.list'() {
    const items = await hashAll('js:lib');
    return items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).map(({ plan, ...meta }) => {
      // 一覧では本文を返さない（有料の指導案は購入後に取得する）
      const { generatedContent, ...head } = plan || {};
      return publicItem({ ...meta, plan: head });
    });
  },
  async 'lib.get'(b) {
    const item = parse(await kv('HGET', 'js:lib', str(b.id, 80)));
    need(item, 404, '公開された指導案が見つかりません');
    const owner = item.ownerHash === sha(b.deviceKey);
    const bought = owner || item.price === 0 || (b.userId && (await kv('SISMEMBER', `js:buy:${str(b.userId, 80)}`, item.id)) === 1);
    need(bought, 402, 'PURCHASE_REQUIRED');
    return publicItem(item);
  },
  async 'lib.publish'(b) {
    need(b.plan && b.deviceKey && b.userId, 400, '公開に必要な情報が不足しています');
    const price = Math.round(Number(b.price) || 0);
    need(price >= 0 && price <= 100000, 400, '価格は0〜100,000円で設定してください');
    // 公開する指導案から、指導者名・学校名など個人や所属が分かる項目を取り除く
    const { instructorName, schoolName, schoolEnvironment, studentCharacteristics, specialNeedsInfo, ...plan } = b.plan;
    const item = {
      id: randomUUID(), ownerId: str(b.userId, 80), ownerHash: sha(b.deviceKey),
      publisherName: str(b.publisherName, 40) || '匿名の先生', summary: str(b.summary, 600), price,
      plan, evaluation: b.evaluation || null, createdAt: new Date().toISOString(), sales: 0,
    };
    need(JSON.stringify(item).length < 400_000, 413, '指導案のデータが大きすぎます');
    await kv('HSET', 'js:lib', item.id, JSON.stringify(item));
    return publicItem(item);
  },
  async 'lib.unpublish'(b) {
    const item = parse(await kv('HGET', 'js:lib', str(b.id, 80)));
    need(item, 404, '公開された指導案が見つかりません');
    need(item.ownerHash === sha(b.deviceKey) || isAdmin(b), 403, '公開した本人だけが取り消せます');
    await kv('HDEL', 'js:lib', item.id);
    return { ok: true };
  },
  async 'lib.claimFree'(b) {
    const item = parse(await kv('HGET', 'js:lib', str(b.id, 80)));
    need(item && item.price === 0, 400, '無料の指導案ではありません');
    await kv('SADD', `js:buy:${str(b.userId, 80)}`, item.id);
    return { ok: true };
  },
  async 'lib.earnings'(b) {
    const items = (await hashAll('js:lib')).filter((i) => i.ownerHash === sha(b.deviceKey));
    return { total: items.reduce((n, i) => n + (i.sales || 0) * i.price, 0), count: items.reduce((n, i) => n + (i.sales || 0), 0), items: items.length };
  },

  // ── 利用者の声 ──
  async 'testi.list'() {
    return (await hashAll('js:testi')).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicItem);
  },
  async 'testi.add'(b) {
    const content = str(b.content, 1000);
    need(content && b.userId && b.deviceKey, 400, '内容を入力してください');
    const t = { id: randomUUID(), userId: str(b.userId, 80), ownerHash: sha(b.deviceKey), userName: str(b.userName, 40) || '匿名ユーザー', content, likes: [], createdAt: new Date().toISOString() };
    await kv('HSET', 'js:testi', t.id, JSON.stringify(t));
    return publicItem(t);
  },
  async 'testi.delete'(b) {
    const t = parse(await kv('HGET', 'js:testi', str(b.id, 80)));
    need(t, 404, '投稿が見つかりません');
    need(t.ownerHash === sha(b.deviceKey) || isAdmin(b), 403, '投稿した本人だけが削除できます');
    await kv('HDEL', 'js:testi', t.id);
    return { ok: true };
  },
  async 'testi.like'(b) {
    const t = parse(await kv('HGET', 'js:testi', str(b.id, 80)));
    need(t && b.userId, 404, '投稿が見つかりません');
    const uid = str(b.userId, 80);
    t.likes = t.likes.includes(uid) ? t.likes.filter((x) => x !== uid) : [...t.likes, uid].slice(-5000);
    await kv('HSET', 'js:testi', t.id, JSON.stringify(t));
    return publicItem(t);
  },

  // ── 児童生徒からの提出（一時的な中継。先生の端末が受け取ったらサーバーから消す） ──
  async 'up.create'(b) {
    const code = str(b.code, 8).toUpperCase();
    need(/^[A-Z0-9]{6}$/.test(code) && b.deviceKey, 400, 'コードが正しくありません');
    const meta = { code, ownerHash: sha(b.deviceKey), subject: str(b.subject, 60), unit: str(b.unit, 120), grade: str(b.grade, 20), max: 50, expiresAt: new Date(Date.now() + 2 * 3600_000).toISOString() };
    await kv('SET', `js:up:${code}`, JSON.stringify(meta), 'EX', 7200);
    return publicItem(meta);
  },
  async 'up.info'(b) {
    const meta = parse(await kv('GET', `js:up:${str(b.code, 8).toUpperCase()}`));
    need(meta, 404, 'SESSION_NOT_FOUND');
    return publicItem(meta);
  },
  async 'up.submit'(b) {
    const code = str(b.code, 8).toUpperCase();
    const meta = parse(await kv('GET', `js:up:${code}`));
    need(meta, 404, 'SESSION_NOT_FOUND');
    // 氏名は受け取らず、出席番号だけを中継する（名簿との対応付けは先生の端末の中だけで行う）
    const number = str(b.number, 4);
    need(/^\d{1,3}$/.test(number), 400, '出席番号を数字で入力してください');
    need(typeof b.image === 'string' && b.image.startsWith('data:image/') && b.image.length < 900_000, 400, '写真を送信できませんでした（サイズが大きすぎます）');
    const count = await kv('LLEN', `js:ups:${code}`);
    need(count < meta.max, 429, '提出数の上限に達しました');
    await kv('RPUSH', `js:ups:${code}`, JSON.stringify({ number, image: b.image, speech: str(b.speech, 3000), at: new Date().toISOString() }));
    await kv('EXPIRE', `js:ups:${code}`, 7200);
    return { ok: true };
  },
  async 'up.pull'(b) {
    const code = str(b.code, 8).toUpperCase();
    const meta = parse(await kv('GET', `js:up:${code}`));
    need(meta, 404, 'SESSION_NOT_FOUND');
    need(meta.ownerHash === sha(b.deviceKey), 403, 'この受付を開始した端末だけが受け取れます');
    const items = [];
    for (let i = 0; i < 10; i++) {
      const v = parse(await kv('LPOP', `js:ups:${code}`));
      if (!v) break;
      items.push(v);
    }
    return { items };
  },
  async 'up.close'(b) {
    const code = str(b.code, 8).toUpperCase();
    const meta = parse(await kv('GET', `js:up:${code}`));
    if (meta) {
      need(meta.ownerHash === sha(b.deviceKey), 403, 'この受付を開始した端末だけが終了できます');
      await kv('DEL', `js:up:${code}`, `js:ups:${code}`);
    }
    return { ok: true };
  },

  // ── 問い合わせ（氏名・メール・電話は PII Shield で暗号化して保存） ──
  async 'inquiry.add'(b) {
    const shield = await getShield();
    need(str(b.organizationName) && str(b.contactName) && /^\S+@\S+\.\S+$/.test(str(b.contactEmail)), 400, '必須項目を入力してください');
    const record = shield.protect({
      id: randomUUID(), ownerId: 'admin', kind: 'institutional',
      organizationType: str(b.organizationType, 40), organizationName: str(b.organizationName, 120), department: str(b.department, 120),
      name: str(b.contactName, 80), email: str(b.contactEmail, 200), phone: str(b.contactPhone, 40) || undefined,
      estimatedUsers: Number(b.estimatedUsers) || null, interestedPlan: str(b.interestedPlan, 40), message: str(b.message, 3000),
      status: 'new', createdAt: new Date().toISOString(),
    });
    await kv('LPUSH', 'js:inq', JSON.stringify(record));
    return { ok: true };
  },
  async 'help.add'(b) {
    const shield = await getShield();
    need(str(b.name) && /^\S+@\S+\.\S+$/.test(str(b.email)) && str(b.subject) && str(b.message), 400, '必須項目を入力してください');
    const record = shield.protect({
      id: randomUUID(), ownerId: 'admin', kind: 'help',
      name: str(b.name, 80), email: str(b.email, 200), subject: str(b.subject, 200), message: str(b.message, 3000),
      status: 'new', createdAt: new Date().toISOString(),
    });
    await kv('LPUSH', 'js:inq', JSON.stringify(record));
    return { ok: true };
  },

  // ── 機能提案 ──
  async 'suggest.add'(b) {
    need(str(b.title) && str(b.description) && b.userId, 400, '必須項目を入力してください');
    const sug = { id: randomUUID(), userId: str(b.userId, 80), category: str(b.category, 40), title: str(b.title, 200), description: str(b.description, 3000), status: 'new', createdAt: new Date().toISOString() };
    await kv('LPUSH', 'js:sug', JSON.stringify(sug));
    return sug;
  },
  async 'suggest.mine'(b) {
    return (await listAll('js:sug')).filter((x) => x.userId === str(b.userId, 80));
  },

  // ── 決済（Stripe） ──
  async 'stripe.checkout'(b, origin) {
    const base = `${origin}/#`;
    if (b.kind === 'subscription') {
      const plan = PLANS[b.planCode];
      need(plan, 400, 'プランが正しくありません');
      const session = await stripe('POST', 'checkout/sessions', {
        mode: 'subscription', customer: b.customerId || undefined,
        line_items: { 0: { quantity: 1, price_data: { currency: 'jpy', unit_amount: plan.amount, recurring: { interval: 'month' }, product_data: { name: `授業スタジオ ${plan.name}` } } } },
        metadata: { type: 'subscription', planCode: b.planCode, userId: str(b.userId, 80) },
        success_url: `${base}/subscription?session={CHECKOUT_SESSION_ID}`, cancel_url: `${base}/subscription`,
      });
      return { url: session.url };
    }
    const item = parse(await kv('HGET', 'js:lib', str(b.id, 80)));
    need(item && item.price > 0, 400, '購入できる指導案が見つかりません');
    need(item.ownerHash !== sha(b.deviceKey), 400, '自分の指導案は購入できません');
    const session = await stripe('POST', 'checkout/sessions', {
      mode: 'payment',
      line_items: { 0: { quantity: 1, price_data: { currency: 'jpy', unit_amount: item.price, product_data: { name: `学習指導案: ${str(item.plan?.title, 80)}` } } } },
      metadata: { type: 'purchase', itemId: item.id, userId: str(b.userId, 80) },
      success_url: `${base}/library?session={CHECKOUT_SESSION_ID}`, cancel_url: `${base}/library`,
    });
    return { url: session.url };
  },
  async 'stripe.verify'(b) {
    const session = await stripe('GET', `checkout/sessions/${encodeURIComponent(str(b.sessionId, 120))}`);
    const paid = session.payment_status === 'paid';
    const meta = session.metadata || {};
    if (paid && meta.type === 'purchase' && hasStore) {
      const added = await kv('SADD', `js:buy:${meta.userId}`, meta.itemId);
      if (added === 1) {
        const item = parse(await kv('HGET', 'js:lib', meta.itemId));
        if (item) { item.sales = (item.sales || 0) + 1; await kv('HSET', 'js:lib', item.id, JSON.stringify(item)); }
      }
    }
    return { paid, type: meta.type, planCode: meta.planCode, itemId: meta.itemId, customerId: session.customer, subscriptionId: session.subscription, amount: session.amount_total };
  },
  async 'stripe.portal'(b, origin) {
    need(b.customerId, 400, '契約情報が見つかりません');
    const portal = await stripe('POST', 'billing_portal/sessions', { customer: str(b.customerId, 80), return_url: `${origin}/#/subscription` });
    return { url: portal.url };
  },
  async 'stripe.status'(b) {
    need(b.subscriptionId, 400, '契約情報が見つかりません');
    const sub = await stripe('GET', `subscriptions/${encodeURIComponent(str(b.subscriptionId, 80))}`);
    return { status: sub.status, cancelAtPeriodEnd: sub.cancel_at_period_end, currentPeriodEnd: sub.current_period_end };
  },
  async 'stripe.cancel'(b) {
    need(b.subscriptionId, 400, '契約情報が見つかりません');
    await stripe('POST', `subscriptions/${encodeURIComponent(str(b.subscriptionId, 80))}`, { cancel_at_period_end: true, metadata: { cancelReason: str(b.reason, 80), cancelComment: str(b.comment, 400) } });
    return { ok: true };
  },

  // ── 管理者 ──
  async 'admin.check'(b) { return { isAdmin: isAdmin(b) }; },
  async 'admin.overview'(b) {
    need(isAdmin(b), 403, '管理者キーが正しくありません');
    const out = { store: hasStore, stripe: hasStripe, library: [], testimonials: 0, suggestions: [], inquiries: [], revenue: null };
    if (hasStore) {
      const lib = await hashAll('js:lib');
      out.library = lib.map(({ plan, ownerHash, ...m }) => ({ ...m, title: plan?.title, subject: plan?.subject }));
      out.testimonials = await kv('HLEN', 'js:testi');
      out.suggestions = await listAll('js:sug');
      const raw = await listAll('js:inq');
      // 一覧はマスク済みの値だけを返す（平文は admin.reveal で1件ずつ・記録つきで開示）
      if (hasPiiKeys) { const shield = await getShield(); out.inquiries = raw.map((r) => shield.toPublic(r)); }
    }
    if (hasStripe) {
      const balance = await stripe('GET', 'balance');
      const subs = await stripe('GET', 'subscriptions?status=active&limit=100');
      out.revenue = {
        available: balance.available, pending: balance.pending, activeSubscriptions: subs.data.length,
        monthlyRecurring: subs.data.reduce((n, sub) => n + (sub.items?.data?.[0]?.price?.unit_amount || 0), 0),
      };
    }
    return out;
  },
  async 'admin.reveal'(b) {
    need(isAdmin(b), 403, '管理者キーが正しくありません');
    const shield = await getShield();
    const record = (await listAll('js:inq')).find((r) => r.id === b.id);
    need(record, 404, '問い合わせが見つかりません');
    return shield.reveal(record, { actor: 'admin', purpose: '問い合わせへの返信' });
  },
};

export default async function handler(req, res) {
  try {
    let body = req.body;
    if (typeof body === 'string') body = parse(body) || {};
    body ||= {};
    const action = req.method === 'GET' ? String(req.query?.action || 'config') : String(body.action || '');
    const fn = Object.hasOwn(actions, action) ? actions[action] : null;
    need(fn, 400, '未対応の操作です');
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${host}`;
    const result = await fn(body, origin);
    res.setHeader('cache-control', 'no-store');
    res.status(200).json(result);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error('[app] failed', err?.name);
    res.status(status).json({ error: err instanceof HttpError ? err.message : 'サーバーでエラーが発生しました' });
  }
}
