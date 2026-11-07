// 司令塔：見張り役から届いた「宛先ごとの通信量」と秘密のリズムを比べて判定する
// POST /api/hub-analyze
// { sid, startMs, dur, binMs, allowed: ["許可した宛先"], flows: [{ dst, values: [0.1秒ごとの量] }] }
import { getSecret, rhythm, echoScore, readBody, send, cleanId, hmac } from './_hub-lib.js';

const THRESHOLD = 0.3;

export default function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POSTのみ使えます' });
  const { secret, demo } = getSecret();
  const b = readBody(req);
  const sid = cleanId(b.sid);
  const startMs = Number(b.startMs);
  const dur = Number(b.dur);
  const binMs = Number(b.binMs) || 100;
  if (!sid || !Number.isFinite(startMs) || !Number.isFinite(dur)) return send(res, 400, { error: 'sid・startMs・dur が必要です' });
  if (!Array.isArray(b.flows) || b.flows.length === 0 || b.flows.length > 200) return send(res, 400, { error: 'flows（1〜200件）が必要です' });

  const allowed = new Set((Array.isArray(b.allowed) ? b.allowed : []).map(String));
  const times = rhythm(secret, sid, startMs, dur);
  const results = b.flows.map(f => {
    const dst = String(f.dst ?? '').slice(0, 100);
    const values = (Array.isArray(f.values) ? f.values : []).slice(0, 10000).map(v => Number(v) || 0);
    const { score, lagMs } = echoScore(times, startMs, binMs, values);
    let verdict = 'none';
    if (score >= THRESHOLD) verdict = allowed.has(dst) ? 'allowed-share' : 'block';
    return { dst, score: Math.round(score * 1000) / 1000, lagMs, verdict };
  }).sort((x, y) => y.score - x.score);

  const blocked = results.filter(r => r.verdict === 'block').map(r => r.dst);
  // サーバーの部品・見張り役が「本当に司令塔からの指示か」を確かめるための署名
  const issuedAt = Date.now();
  const order = blocked.length
    ? { action: 'block', sid, destinations: blocked, issuedAt, sig: hmac(secret, 'order', sid, blocked.join(','), issuedAt).toString('hex') }
    : { action: 'none', sid, issuedAt };

  send(res, 200, { threshold: THRESHOLD, results, order, demo });
}
