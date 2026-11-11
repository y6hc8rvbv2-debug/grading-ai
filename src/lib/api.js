// サーバー（/api/app）との通信。設定されていない機能は、呼び出し側が「この端末だけ」の動作に切り替える。
import { useSyncExternalStore } from 'react';
import { getState } from './store.js';

let config = { loaded: false, ai: false, store: false, stripe: false, pii: false, admin: false, accessCode: false, googleClientId: '', model: '' };
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
  if (!r.ok) { const e = new Error(data.error || '通信に失敗しました'); e.status = r.status; throw e; }
  return data;
}
