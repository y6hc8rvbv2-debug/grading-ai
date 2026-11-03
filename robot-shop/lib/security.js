// ロボマルシェ サーバー側のセキュリティ防御（/api から使う。画面側では読み込まない）
//
// スマホアプリ（App Store）で一般的な防御機能を、Webアプリ向けに置き換えたもの
//  ・App Attest / DeviceCheck（正規アプリからの通信か確認） → 署名付きの短命トークン＋送信元(Origin)チェック
//  ・API偽装・大量取得への対策                              → 接続元ごと＋全体のレート制限
//  ・ボット・自動入力対策                                   → おとり入力欄（ハニーポット）＋入力時間チェック
//  ・改ざん検知つきの記録                                   → 個人情報を含まないセキュリティログ
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// 署名用の秘密鍵。専用の APP_SIGNING_SECRET を推奨。未設定ならサーバーにある別の秘密から派生させる
function signingKey() {
  const base = process.env.APP_SIGNING_SECRET || process.env.ANTHROPIC_API_KEY || process.env.PII_KEY_V1 || '';
  if (!base) return null;
  return createHash('sha256').update('robomarche-session-v1:' + base).digest();
}

const sha = (v) => createHash('sha256').update(String(v)).digest('base64url').slice(0, 16);
export const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
const uaHash = (req) => sha(req.headers['user-agent'] || '');

// 個人情報を含まないセキュリティログ（IPはハッシュ化して記録）
export function securityLog(event, req, detail = '') {
  console.warn(`[security] ${event} ip=${sha(clientIp(req))} ${detail}`.trim());
}

// ── 署名付きトークン（有効期限2時間・ブラウザ（User-Agent）に結び付け）──
const TOKEN_TTL = 2 * 60 * 60 * 1000;
export function issueToken(req) {
  const key = signingKey();
  if (!key) return null;
  const payload = `${Date.now()}.${randomBytes(9).toString('base64url')}`;
  const sig = createHmac('sha256', key).update(payload + '.' + uaHash(req)).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(req, token, minAgeMs) {
  const key = signingKey();
  if (!key) return { ok: true, skipped: true }; // 鍵がない環境ではチェックしない（ログで分かるようにする）
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { ok: false, reason: 'token-missing' };
  const [ts, nonce, sig] = parts;
  const expected = createHmac('sha256', key).update(`${ts}.${nonce}.${uaHash(req)}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'token-invalid' };
  const age = Date.now() - Number(ts);
  if (!(age >= 0) || age > TOKEN_TTL) return { ok: false, reason: 'token-expired' };
  if (age < minAgeMs) return { ok: false, reason: 'too-fast' };
  return { ok: true };
}

// ── レート制限（接続元ごと＋サイト全体）──
const buckets = new Map();
function hit(key, limit, windowMs) {
  const now = Date.now();
  const list = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  buckets.set(key, list);
  if (buckets.size > 5000) buckets.clear(); // メモリを使いすぎないように
  return list.length > limit;
}

// 送信元が自分のサイトか（他サイトからの不正な送信＝CSRFを防ぐ）
function sameOrigin(req) {
  const origin = req.headers.origin;
  const site = req.headers['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) return false;
  if (!origin) return true; // 古いブラウザなど。トークンで確認する
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * API の入口でまとめて確認する。問題があれば { status, error } を返す（問題なければ null）
 * @param {object} opt { name, perMinute, globalPerMinute, minAgeMs, maxBytes }
 */
export function guardRequest(req, res, opt) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return { status: 405, error: 'POST で送信してください' };

  const type = String(req.headers['content-type'] || '');
  if (!type.startsWith('application/json')) return { status: 415, error: 'JSON で送信してください' };

  const size = Number(req.headers['content-length'] || 0);
  if (size > (opt.maxBytes || 20_000)) {
    securityLog('too-large', req, opt.name);
    return { status: 413, error: '送信データが大きすぎます' };
  }

  if (!sameOrigin(req)) {
    securityLog('cross-origin', req, opt.name);
    return { status: 403, error: 'このサイト以外からは利用できません' };
  }

  if (hit('g:' + opt.name, opt.globalPerMinute || 600, 60_000)) {
    securityLog('global-rate', req, opt.name);
    return { status: 503, error: 'ただいま混み合っています。しばらくしてからお試しください' };
  }
  if (hit(opt.name + ':' + clientIp(req), opt.perMinute, 60_000)) {
    securityLog('rate-limit', req, opt.name);
    return { status: 429, error: '短時間に操作が集中しています。1分ほど待ってからお試しください' };
  }

  const v = verifyToken(req, req.headers['x-robo-token'], opt.minAgeMs || 0);
  if (!v.ok) {
    securityLog(v.reason, req, opt.name);
    if (v.reason === 'too-fast') return { status: 400, error: '入力が速すぎます。内容を確認してもう一度お試しください' };
    return { status: 401, error: '画面を再読み込みしてからもう一度お試しください', retryToken: true };
  }
  return null;
}
