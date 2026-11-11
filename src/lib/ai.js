// AI（Claude）の呼び出し。サーバーに鍵が設定されていない時は、画面確認用の「見本」を返す。
import { getConfig } from './api.js';
import { getDisplay } from './store.js';
import { demo } from './demo.js';

const TEXT_TASKS = new Set(['material', 'assistant']);

// AIの返答から JSON を取り出す（前後に余計な文字やコードフェンスが付いても読めるようにする）
export function parseJson(text) {
  const t = String(text || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch { /* 下で範囲を絞って再挑戦 */ }
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* 失敗 */ } }
  throw new Error('AIの返答をうまく読み取れませんでした。もう一度お試しください。');
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function runDemo(task, payload, onText) {
  const out = demo(task, payload);
  const text = typeof out === 'string' ? out : JSON.stringify(out, null, 1);
  // 生成中の様子が分かるよう、少しずつ表示する
  for (let i = 0; i < 8; i++) { await wait(140); onText?.(text.slice(0, Math.round((text.length * (i + 1)) / 8))); }
  return { result: out, demo: true };
}

export async function runAi(task, payload, { onText, signal } = {}) {
  if (getConfig().loaded && !getConfig().ai) return runDemo(task, payload, onText);
  let r;
  try {
    r = await fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, signal, body: JSON.stringify({ task, payload, accessCode: getDisplay().accessCode }) });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('サーバーに接続できませんでした。通信環境をご確認ください。');
  }
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    if (d.error === 'AI_NOT_CONFIGURED') return runDemo(task, payload, onText);
    if (d.error === 'ACCESS_CODE_REQUIRED') throw new Error('アクセスコードが必要です。「設定 → AI接続」で入力してください。');
    throw new Error(d.error || `AIの呼び出しに失敗しました（${r.status}）`);
  }
  const reader = r.body.getReader(); const dec = new TextDecoder();
  let buf = ''; let text = ''; let finished = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (!line.startsWith('data: ')) continue;
      const ev = JSON.parse(line.slice(6));
      if (ev.t) { text += ev.t; onText?.(text); }
      if (ev.error) throw new Error(ev.error);
      if (ev.done) { finished = true; if (ev.stop === 'max_tokens' && !TEXT_TASKS.has(task)) throw new Error('AIの返答が長すぎて途中で切れました。入力を少し短くしてお試しください。'); }
    }
  }
  if (!finished && !text) throw new Error('AIからの返答が途中で切れました。もう一度お試しください。');
  return { result: TEXT_TASKS.has(task) ? text : parseJson(text), demo: false };
}
