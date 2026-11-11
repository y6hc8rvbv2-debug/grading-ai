// 画面の切り替え（URL の # 以降を使う小さなルーター。サーバー設定なしでどのページも直接開ける）
import { useSyncExternalStore } from 'react';

const read = () => {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, search = ''] = raw.split('?');
  return `${path.startsWith('/') ? path : `/${path}`}?${search}`;
};
const subscribe = (l) => { window.addEventListener('hashchange', l); return () => window.removeEventListener('hashchange', l); };

export function useRoute() {
  const raw = useSyncExternalStore(subscribe, read);
  const [path, search] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(search)) };
}
export const navigate = (to, { replace = false } = {}) => {
  if (replace) window.location.replace(`#${to}`); else window.location.hash = to;
  window.scrollTo(0, 0);
};
export const href = (to) => `#${to}`;

// '/plans/:id' のような型と実際のパスを照合し、合えば { id: '...' } を返す
export function match(pattern, path) {
  const a = pattern.split('/').filter(Boolean); const b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}
