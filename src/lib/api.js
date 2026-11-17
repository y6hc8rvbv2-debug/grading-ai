// サーバー（/api/app）との通信。設定されていない機能は、呼び出し側が「この端末だけ」の動作に切り替える。
import { useSyncExternalStore } from 'react';
import { getState } from './store.js';

let config = { loaded: false, ai: false, store: false, stripe: false, webhook: false, pii: false, admin: false, accessCode: false, googleClientId: '', model: '' };
const listeners = new Set();

export async function loadConfig() {
  try {
    const r = await fetch('/api/app?action=config');
    if (r.ok) config = { ...config, ...(await r.json()) };
  } catch { /* サーバーに届かない時は、すべて未設定として端末内だけで動かす */ }
  config = { ...config, loaded: true };
  listeners.forEach((l) => l());
}
export const getConfig = () => config;
export function useConfig() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => config);
}

export async function api(action, body = {}) {
  const profile = getState().profile || {};
  const r = await fetch('/api/app', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, userId: profile.id, deviceKey: profile.deviceKey, ...body }),
  });
  let data = {};
  try { data = await r.json(); } catch { /* 本文なし */ }
  if (!r.ok) { const e = new Error(friendly(data.error) || '通信に失敗しました'); e.code = data.error; e.status = r.status; throw e; }
  return data;
}

// サーバーからのエラーの合図を、利用者に分かる文に置き換える
const MESSAGES = {
  USER_REQUIRED: '利用者情報を確認できませんでした。ページを再読み込みしてください。',
  USER_MISMATCH: 'この端末の利用者情報が、サーバーの記録と一致しません。最初に使った端末のバックアップから復元してください。',
  QUOTA_EXCEEDED: '今月のAI作成数の上限に達しました。「プラン」画面でプランを変更すると続けて作成できます。',
  TRIAL_EXPIRED: '無料期間（3か月）が終了しました。「プラン」画面で有料プランをお選びください。',
  ALREADY_SUBSCRIBED: 'すでに有料プランをご契約中です。プランの変更・解約は「お支払い情報の管理」から行えます。',
  STRIPE_NOT_CONFIGURED: '決済（Stripe）が未設定です。',
};
export const friendly = (code) => MESSAGES[code] || code;
