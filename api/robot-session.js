// ロボマルシェ: 画面が API を使うための短命トークンを発行する（App Attest に相当する簡易版）
import { clientIp, issueToken, securityLog } from '../robot-shop/lib/security.js';

const recent = new Map();

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET で取得してください' });
  const site = req.headers['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) {
    securityLog('cross-origin', req, 'session');
    return res.status(403).json({ error: 'このサイト以外からは利用できません' });
  }
  const ip = clientIp(req);
  const now = Date.now();
  const list = (recent.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  recent.set(ip, list);
  if (recent.size > 5000) recent.clear();
  if (list.length > 20) {
    securityLog('rate-limit', req, 'session');
    return res.status(429).json({ error: '少し時間をおいてからお試しください' });
  }
  const token = issueToken(req);
  return res.status(200).json({ token, protected: Boolean(token) });
}
