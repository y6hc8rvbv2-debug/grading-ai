// アプリのデータはすべて「この端末のブラウザ」に保存する（IndexedDB）。
// サーバーに置かないので、児童生徒の情報が外に出にくい。端末を変える時は設定画面のバックアップを使う。
import { useSyncExternalStore } from 'react';

export const COLLECTIONS = ['plans', 'notes', 'observations', 'behaviors', 'specialNeeds', 'evaluations', 'reflections', 'versions', 'materials', 'chats', 'roster', 'templates', 'library', 'testimonials', 'suggestions', 'purchases', 'papers', 'sessions', 'recordings'];
const SINGLES = { profile: null, usage: {} };

let state = { ready: false, ...SINGLES, ...Object.fromEntries(COLLECTIONS.map((c) => [c, []])) };
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

let idb = null;
const openDb = () => new Promise((resolve) => {
  try {
    const req = indexedDB.open('jugyo-studio', 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs'); // 録音・録画などの大きなファイル
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  } catch { resolve(null); }
});
const idbGetAll = (db) => new Promise((resolve) => {
  const out = {};
  const cur = db.transaction('kv').objectStore('kv').openCursor();
  cur.onsuccess = () => { const c = cur.result; if (c) { out[c.key] = c.value; c.continue(); } else resolve(out); };
  cur.onerror = () => resolve(out);
});
const pending = new Map();
function persist(key) {
  if (!idb) return;
  clearTimeout(pending.get(key));
  pending.set(key, setTimeout(() => {
    try { idb.transaction('kv', 'readwrite').objectStore('kv').put(state[key], key); } catch { /* 保存できない環境では画面を開いている間だけ保持 */ }
  }, 150));
}

export async function initStore() {
  idb = await openDb();
  if (idb) {
    const saved = await idbGetAll(idb);
    state = { ...state, ...saved };
  }
  state = { ...state, ready: true };
  emit();
}

export const getState = () => state;
export function useStore(selector = (s) => s) {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => selector(state));
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const now = () => new Date().toISOString();

export const db = {
  set(key, value) { state = { ...state, [key]: value }; persist(key); emit(); },
  add(coll, item) {
    const row = { id: uid(), createdAt: now(), ...item };
    state = { ...state, [coll]: [row, ...state[coll]] };
    persist(coll); emit();
    return row;
  },
  update(coll, id, patch) {
    state = { ...state, [coll]: state[coll].map((r) => (r.id === id ? { ...r, ...(typeof patch === 'function' ? patch(r) : patch), updatedAt: now() } : r)) };
    persist(coll); emit();
  },
  remove(coll, id) { state = { ...state, [coll]: state[coll].filter((r) => r.id !== id) }; persist(coll); emit(); },
  removeWhere(coll, pred) { state = { ...state, [coll]: state[coll].filter((r) => !pred(r)) }; persist(coll); emit(); },
  // 指導案を消す時は、ひも付く記録もまとめて消す
  removePlan(id) {
    state.recordings.filter((r) => r.planId === id).forEach((r) => blobs.del(r.id));
    ['notes', 'observations', 'behaviors', 'specialNeeds', 'evaluations', 'reflections', 'versions', 'materials', 'chats', 'sessions', 'recordings'].forEach((c) => {
      state = { ...state, [c]: state[c].filter((r) => r.planId !== id) }; persist(c);
    });
    db.remove('plans', id);
  },
  exportAll() {
    const { ready, ...data } = state;
    return { app: 'jugyo-studio', version: 1, exportedAt: now(), data };
  },
  importAll(file) {
    if (file?.app !== 'jugyo-studio' || !file.data) throw new Error('このアプリのバックアップファイルではありません');
    for (const key of [...COLLECTIONS, ...Object.keys(SINGLES)]) {
      if (file.data[key] !== undefined) { state = { ...state, [key]: file.data[key] }; persist(key); }
    }
    emit();
  },
  async wipe() {
    state = { ready: true, ...SINGLES, ...Object.fromEntries(COLLECTIONS.map((c) => [c, []])) };
    if (idb) await new Promise((r) => { const t = idb.transaction(['kv', 'blobs'], 'readwrite'); t.objectStore('kv').clear(); t.objectStore('blobs').clear(); t.oncomplete = r; t.onerror = r; });
    emit();
  },
};

// 録音・録画の本体（大きいので一覧とは別の場所に保存する。バックアップには含まれない）
export const blobs = {
  put: (id, blob) => new Promise((resolve, reject) => {
    if (!idb) return reject(new Error('この端末では録音・録画を保存できません'));
    const t = idb.transaction('blobs', 'readwrite'); t.objectStore('blobs').put(blob, id);
    t.oncomplete = () => resolve(); t.onerror = () => reject(new Error('保存に失敗しました（端末の空き容量をご確認ください）'));
  }),
  get: (id) => new Promise((resolve) => {
    if (!idb) return resolve(null);
    const r = idb.transaction('blobs').objectStore('blobs').get(id);
    r.onsuccess = () => resolve(r.result || null); r.onerror = () => resolve(null);
  }),
  del: (id) => { try { idb?.transaction('blobs', 'readwrite').objectStore('blobs').delete(id); } catch { /* 無視 */ } },
};

// ── 表示設定（すぐ反映したいので localStorage） ──
const DISPLAY_KEY = 'js-display';
let display = { theme: 'system', accent: 'teal', size: 'md', language: 'ja', currency: 'JPY', accessCode: '', ...safeParse(localStorage.getItem(DISPLAY_KEY)) };
function safeParse(v) { try { return JSON.parse(v) || {}; } catch { return {}; } }
const displayListeners = new Set();
export function applyDisplay() {
  const el = document.documentElement;
  const dark = display.theme === 'dark' || (display.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  el.classList.toggle('dark', dark);
  el.dataset.accent = display.accent;
  el.dataset.size = display.size;
  el.lang = display.language;
}
export function setDisplay(patch) {
  display = { ...display, ...patch };
  try { localStorage.setItem(DISPLAY_KEY, JSON.stringify(display)); } catch { /* 保存できなくても動作は続ける */ }
  applyDisplay();
  displayListeners.forEach((l) => l());
}
export const getDisplay = () => display;
export function useDisplay() {
  return useSyncExternalStore((l) => { displayListeners.add(l); return () => displayListeners.delete(l); }, () => display);
}

// ── 無料プランの試用期間（登録から3か月） ──
export function trialInfo(profile) {
  if (!profile || (profile.plan || 'free') !== 'free') return { isFree: false, expired: false, daysRemaining: 90 };
  const expires = new Date(profile.createdAt || Date.now());
  expires.setMonth(expires.getMonth() + 3);
  const daysRemaining = Math.ceil((expires - Date.now()) / 86400000);
  return { isFree: true, expired: daysRemaining <= 0, daysRemaining, expiresAt: expires };
}
export const monthKey = () => new Date().toISOString().slice(0, 7);
