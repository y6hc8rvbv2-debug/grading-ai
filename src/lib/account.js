// サーバーに記録された契約状態と今月の利用数を、この端末の表示に取り込む。
// （共有データの置き場がある時だけ。支払い・解約・支払い失敗は Stripe の通知でサーバーに記録される）
import { db, getState, monthKey } from './store.js';
import { api, getConfig } from './api.js';

let running = null;
export function syncAccount() {
  const profile = getState().profile;
  if (!profile || !getConfig().store) return Promise.resolve(null);
  running ||= api('account.sync').then((r) => {
    const p = getState().profile;
    if (!p) return r;
    const sub = r.subscription;
    db.set('profile', {
      ...p, plan: r.plan, serverCreatedAt: r.createdAt,
      stripe: sub ? { customerId: sub.customerId, subscriptionId: sub.subscriptionId } : p.stripe,
      subscription: sub ? { status: sub.status, planCode: sub.planCode, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, currentPeriodEnd: sub.currentPeriodEnd } : null,
      syncedAt: new Date().toISOString(),
    });
    db.set('usage', { ...(getState().usage || {}), [monthKey()]: r.used });
    return r;
  }).catch((e) => { console.warn('[account] sync failed', e.message); return null; }).finally(() => { running = null; });
  return running;
}
