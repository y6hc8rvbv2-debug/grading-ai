// Shield Hub（司令塔）の共通部品
// 状態を保存しない設計：秘密の鍵（HUB_SECRET）から、リズムや呼び名をその場で計算し直す。
// ファイル名が「_」で始まるので、Vercel では API として公開されない。
import crypto from 'node:crypto';

const DEMO_SECRET = 'shield-hub-demo-secret-change-me';

export function getSecret() {
  const s = process.env.HUB_SECRET;
  return s && s.length >= 16 ? { secret: s, demo: false } : { secret: DEMO_SECRET, demo: true };
}

export function hmac(secret, ...parts) {
  return crypto.createHmac('sha256', secret).update(parts.join('|')).digest();
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

export function send(res, status, obj) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(obj));
}

export function cleanId(v, max = 64) {
  return String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, max);
}

// ===== こだま探知：秘密のリズム =====
// 変化の間隔は 0.3〜2.0 秒。セッションIDと開始時刻から毎回同じ列を計算できる。
export function rhythm(secret, sid, startMs, durSec) {
  const times = [];
  let t = startMs;
  const end = startMs + Math.min(Math.max(durSec, 10), 600) * 1000;
  for (let k = 0; t < end && k < 5000; k++) {
    const h = hmac(secret, 'rhythm', sid, startMs, k);
    t += 300 + (h.readUInt32BE(0) % 1700);
    if (t < end) times.push(t);
  }
  return times;
}

function corr(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    sab += da * db; saa += da * da; sbb += db * db;
  }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
}

// 秘密のリズムと宛先ごとの通信量の相関（0〜0.5秒の遅れまで調べて最大値）
export function echoScore(times, startMs, binMs, values) {
  const n = values.length;
  const r = new Array(n).fill(0);
  for (const t of times) {
    const k = Math.floor((t - startMs) / binMs);
    if (k >= 0 && k < n) r[k] = 1;
  }
  const maxLag = Math.round(500 / binMs);
  let best = 0, bestLag = 0;
  for (let lag = 0; lag <= maxLag; lag++) {
    const c = corr(r.slice(0, n - lag), values.slice(lag));
    if (c > best) { best = c; bestLag = lag; }
  }
  return { score: best, lagMs: bestLag * binMs };
}

// ===== パラレル世界：呼び名 =====
// 呼び名 = 署名(3バイト) + 暗号化した「世界の印(2バイト)＋データ番号(2バイト)」 → 12文字
const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function b32encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const byte of buf) {
    val = (val << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

function b32decode(str) {
  let bits = 0, val = 0;
  const out = [];
  for (const ch of str.toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) return null;
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function worldTag(secret, world) {
  return hmac(secret, 'world', world).subarray(0, 2);
}

export function makeAlias(secret, world, recordId) {
  const payload = Buffer.alloc(4);
  worldTag(secret, world).copy(payload, 0);
  payload.writeUInt16BE(recordId & 0xffff, 2);
  const mac = hmac(secret, 'alias-mac', payload.toString('hex')).subarray(0, 3);
  const ks = hmac(secret, 'alias-key', mac.toString('hex')).subarray(0, 4);
  const ct = Buffer.from(payload.map((b, i) => b ^ ks[i]));
  return b32encode(Buffer.concat([mac, ct]));
}

// 呼び名を読み解き、どの世界のどのデータかを返す（読めなければ null）
export function readAlias(secret, alias, worlds) {
  const buf = b32decode(String(alias).trim());
  if (!buf || buf.length !== 7) return null;
  const mac = buf.subarray(0, 3), ct = buf.subarray(3, 7);
  const ks = hmac(secret, 'alias-key', mac.toString('hex')).subarray(0, 4);
  const payload = Buffer.from(ct.map((b, i) => b ^ ks[i]));
  const expect = hmac(secret, 'alias-mac', payload.toString('hex')).subarray(0, 3);
  if (!crypto.timingSafeEqual(mac, expect)) return null;
  const tag = payload.subarray(0, 2);
  const world = worlds.find(w => worldTag(secret, w).equals(tag)) || null;
  return { world, recordId: payload.readUInt16BE(2) };
}

export function shareToken(secret, from, to, recordId, expMs) {
  return hmac(secret, 'share', from, to, recordId, expMs).toString('hex').slice(0, 32);
}
