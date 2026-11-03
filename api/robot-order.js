// 日本製フィジカルAIロボット ショップ: 注文受付API（サーバー側）
// ・個人情報（氏名・メール・電話・郵便番号・住所）は PII Shield を通して扱う
// ・画面に返すのはマスク済みの値だけ（shield.toPublic）
// ・金額は画面から送られた値を使わず、カタログ（data.js）から計算し直す
// ・個人情報はログに出さない
import { randomBytes } from 'node:crypto';
import { calcTotals, findProduct } from '../robot-shop/data.js';

// 同じ接続元からの連続注文を簡易的に制限（1分に5件まで）
const recent = new Map();
function rateLimited(key) {
  const now = Date.now();
  const list = (recent.get(key) || []).filter((t) => now - t < 60_000);
  list.push(now);
  recent.set(key, list);
  return list.length > 5;
}

// PII Shield を読み込む。鍵が未設定などで読み込めない場合は null
let shieldPromise;
function loadShield() {
  shieldPromise ??= import('../robot-shop/lib/pii-shield.js')
    .then((m) => m.shield)
    .catch((e) => {
      console.warn('[robot-order] PII Shield の暗号化を利用できません:', e.code || e.name);
      return null;
    });
  return shieldPromise;
}

const PII_FIELDS = ['name', 'email', 'phone', 'postal', 'address'];
const MASK_KIND = { name: 'name', email: 'email', phone: 'phone', postal: 'full', address: 'address' };

function str(v, max = 200) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function validate(c) {
  const errors = {};
  if (!c.name) errors.name = 'お名前を入力してください';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) errors.email = 'メールアドレスの形式が正しくありません';
  if (!/^[0-9０-９\-－+ ]{10,15}$/.test(c.phone)) errors.phone = '電話番号を正しく入力してください';
  if (!/^\d{3}-?\d{4}$/.test(c.postal)) errors.postal = '郵便番号は 123-4567 の形式で入力してください';
  if (c.address.length < 5) errors.address = '住所を入力してください';
  return errors;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST で送信してください' });
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0] || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: '短時間に注文が集中しています。1分ほど待ってからお試しください' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: '注文データが読み取れません' });

  // ── 注文内容（個人情報ではない項目）──
  const rawItems = Array.isArray(body.items) ? body.items.slice(0, 30) : [];
  const items = rawItems
    .filter((i) => i && findProduct(String(i.id)))
    .map((i) => ({
      id: String(i.id),
      qty: Number(i.qty) || 1,
      plan: i.plan === 'rental' ? 'rental' : 'buy',
      options: Array.isArray(i.options) ? i.options.map(String).slice(0, 10) : [],
    }));
  if (items.length === 0) return res.status(400).json({ error: 'カートが空です' });
  const totals = calcTotals(items);

  const order = body.order || {};
  const details = {
    customerType: order.customerType === 'business' ? 'business' : 'personal',
    company: str(order.company, 100),
    department: str(order.department, 100),
    site: ['indoor', 'outdoor', 'factory', 'farm', 'hospital', 'other'].includes(order.site) ? order.site : 'other',
    deliveryDate: /^\d{4}-\d{2}-\d{2}$/.test(order.deliveryDate) ? order.deliveryDate : '',
    payment: ['invoice', 'bank', 'lease', 'card'].includes(order.payment) ? order.payment : 'invoice',
    subsidy: Boolean(order.subsidy),
    note: str(order.note, 500),
  };

  // ── 個人情報（ここから先は shield を通す）──
  const c = body.customer || {};
  const customer = {
    name: str(c.name, 60),
    email: str(c.email, 120).toLowerCase(),
    phone: str(c.phone, 20),
    postal: str(c.postal, 10),
    address: str(c.address, 200),
  };
  const errors = validate(customer);
  if (Object.keys(errors).length) return res.status(422).json({ error: '入力内容を確認してください', fields: errors });

  const now = new Date();
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
  const orderId = `RB-${ymd}-${randomBytes(3).toString('hex').toUpperCase()}`;

  const shield = await loadShield();
  let publicCustomer;
  let protection;
  if (shield) {
    // 暗号化（AES-256-GCM）＋検索用ハッシュ＋マスク値を作る。DB に保存するのはこの protected の形だけ
    const protectedRecord = shield.protect({ id: orderId, ...customer });
    // TODO: 本番では protectedRecord と details・totals を DB に保存し、メーカーへ発注連携する
    const pub = shield.toPublic(protectedRecord);
    publicCustomer = Object.fromEntries(PII_FIELDS.map((f) => [f, pub[f]]));
    protection = 'encrypted';
  } else {
    // 鍵が未設定の環境（プレビュー等）: 保存はせず、PII Shield のマスク機能だけ使って返す
    try {
      const { maskers } = await import('pii-shield');
      publicCustomer = Object.fromEntries(PII_FIELDS.map((f) => [f, maskers[MASK_KIND[f]](customer[f])]));
      protection = 'masked-only';
    } catch {
      return res.status(503).json({ error: '個人情報保護モジュールを読み込めないため、現在注文を受け付けできません' });
    }
  }

  const leadWeeks = Math.max(...items.map((i) => findProduct(i.id).leadWeeks || 4));
  return res.status(201).json({
    orderId,
    createdAt: now.toISOString(),
    status: totals.quoteCount > 0 ? 'quote' : 'accepted',
    protection,
    customer: publicCustomer, // マスク済み（例: 山***, t***@example.com）
    details: { ...details, company: details.company, note: details.note ? '（受付済み）' : '' },
    totals,
    estimatedLeadWeeks: leadWeeks,
  });
}
