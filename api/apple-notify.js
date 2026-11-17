// Apple からの通知（App Store Server Notifications V2）を受け取り、iPhoneアプリ内課金の契約状態を記録する。
// 更新・解約・返金・支払い失敗などが、アプリを開いていなくても自動で反映される。
//   App Store Connect の送信先: https://（本番URL）/api/apple-notify（バージョン2）
import { hasStore, kv } from './_store.js';
import { hasApple, verifyNotification, verifyTransaction, verifyRenewal, saveAppleTransaction } from './_apple.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function handler(request) {
  if (request.method !== 'POST') return json(405, { error: 'POST only' });
  if (!hasApple || !hasStore) return json(503, { error: 'APPLE_NOT_CONFIGURED' });
  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'INVALID_BODY' }); }
  if (typeof body?.signedPayload !== 'string') return json(400, { error: 'INVALID_BODY' });

  let note;
  try { note = await verifyNotification(body.signedPayload); } catch (err) {
    console.error('[apple-notify] verification failed', err?.status ?? err?.message);
    return json(400, { error: 'INVALID_SIGNATURE' });
  }
  if (note.notificationType === 'TEST') return json(200, { received: true, test: true });

  // 同じ通知の再送は1回だけ処理する
  const id = note.notificationUUID;
  if (id && (await kv('SET', `js:anote:${id}`, '1', 'NX', 'EX', 60 * 60 * 24 * 7)) !== 'OK') return json(200, { received: true, duplicate: true });

  try {
    const data = note.data || {};
    if (data.signedTransactionInfo) {
      const tx = await verifyTransaction(data.signedTransactionInfo);
      const renewal = data.signedRenewalInfo ? await verifyRenewal(data.signedRenewalInfo) : null;
      await saveAppleTransaction(tx, renewal);
    }
  } catch (err) {
    if (id) await kv('DEL', `js:anote:${id}`).catch(() => {});
    console.error('[apple-notify] failed', note.notificationType, err?.message);
    return json(500, { error: 'PROCESSING_FAILED' }); // Apple が時間をおいて再送する
  }
  return json(200, { received: true });
}

export default { fetch: handler };
