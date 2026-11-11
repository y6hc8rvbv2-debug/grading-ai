// Google カレンダー・Google ドライブとの連携（ブラウザから直接。サーバーには何も保存しない）
// 管理者が GOOGLE_CLIENT_ID を設定している時だけ使える。未設定でも .ics とカレンダー登録リンクは使える。
import { getConfig } from './api.js';

const SCOPES = { calendar: 'https://www.googleapis.com/auth/calendar.events', drive: 'https://www.googleapis.com/auth/drive.file' };
let scriptPromise; const tokens = {};

function loadGis() {
  scriptPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = resolve; s.onerror = () => reject(new Error('Googleの認証画面を読み込めませんでした'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

async function token(kind) {
  const clientId = getConfig().googleClientId;
  if (!clientId) throw new Error('Google連携は管理者の設定（GOOGLE_CLIENT_ID）が必要です');
  if (tokens[kind] && tokens[kind].exp > Date.now()) return tokens[kind].value;
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPES[kind],
      callback: (r) => {
        if (r.error) return reject(new Error('Googleへの接続が許可されませんでした'));
        tokens[kind] = { value: r.access_token, exp: Date.now() + (Number(r.expires_in) - 60) * 1000 };
        resolve(r.access_token);
      },
      error_callback: () => reject(new Error('Googleへの接続を中止しました')),
    });
    client.requestAccessToken();
  });
}

export async function addToGoogleCalendar(plan, { start, minutes = 45 }) {
  const t = await token('calendar');
  const s = new Date(start); const e = new Date(s.getTime() + minutes * 60000);
  const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
    body: JSON.stringify({ summary: `【授業】${plan.title}`, description: `${plan.subject || ''} ${plan.unit || ''}\n本時のねらい：${plan.currentLessonObjective || ''}`, start: { dateTime: s.toISOString() }, end: { dateTime: e.toISOString() } }),
  });
  if (!r.ok) throw new Error('Googleカレンダーへの登録に失敗しました');
  return r.json();
}

export async function uploadToDrive(blob, name) {
  const t = await token('drive');
  const meta = { name };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file', blob);
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: form });
  if (!r.ok) throw new Error('Googleドライブへの保存に失敗しました');
  return r.json();
}
