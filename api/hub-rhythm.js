// 司令塔：秘密のリズムを発行する
// GET /api/hub-rhythm?sid=セッションID&dur=秒数
import { getSecret, rhythm, cleanId, send } from './_hub-lib.js';

export default function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'GETのみ使えます' });
  const { secret, demo } = getSecret();
  const sid = cleanId(req.query.sid) || 'demo';
  const dur = Math.min(Math.max(parseInt(req.query.dur, 10) || 120, 10), 600);
  const startMs = Date.now() + 1000;
  send(res, 200, { sid, startMs, dur, times: rhythm(secret, sid, startMs, dur), demo });
}
