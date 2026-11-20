// iPhoneアプリ内課金（Apple）。アプリとして開いている時だけ使う。Web では Stripe を使う。
// 購入・復元した取引は、Apple の署名付きデータのままサーバーへ送り、サーバーで本物か確かめてからプランに反映する。
import { api, getConfig } from './api.js';
import { getState } from './store.js';
import { syncAccount } from './account.js';

export { isIOSApp } from './platform.js';

const plugin = async () => (await import('@capgo/native-purchases'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 商品ID ⇔ プランの対応はサーバーの設定から受け取る（例: jugyo_mini_monthly → mini）
export const productFor = (planCode) => Object.entries(getConfig().appleProducts || {}).find(([, p]) => p === planCode)?.[0];

// App Store に登録した価格（端末の国・通貨で表示される）を読み込む
export async function loadProducts() {
  const { NativePurchases, PURCHASE_TYPE } = await plugin();
  const ids = Object.keys(getConfig().appleProducts || {});
  if (!ids.length) return {};
  const { products } = await NativePurchases.getProducts({ productIdentifiers: ids, productType: PURCHASE_TYPE.SUBS });
  return Object.fromEntries(products.map((p) => [p.identifier, p]));
}

async function verify(transactions, restore = false) {
  const jws = transactions.map((t) => t?.jwsRepresentation).filter(Boolean);
  if (!jws.length) throw new Error(restore ? '復元できる購入が見つかりませんでした。' : '購入情報を確認できませんでした。');
  const r = await api('apple.verify', { transactions: jws, restore });
  await syncAccount();
  return r;
}

export async function buy(planCode) {
  const productId = productFor(planCode);
  if (!productId) throw new Error('このプランはアプリ内ではまだ購入できません。');
  const { NativePurchases, PURCHASE_TYPE } = await plugin();
  const userId = getState().profile?.id;
  try {
    const tx = await NativePurchases.purchaseProduct({
      productIdentifier: productId,
      productType: PURCHASE_TYPE.SUBS,
      // 利用者IDを Apple の購入に付ける（Apple からの通知で、どの利用者の契約か分かるように。UUID 形式のみ）
      appAccountToken: UUID.test(userId || '') ? userId : undefined,
    });
    return await verify([tx]);
  } catch (e) {
    if (/cancel/i.test(String(e?.message || e?.code))) return null; // 利用者が購入をやめた
    throw e;
  }
}

// 購入の復元（機種変更・再インストールの時に必要。App Store の審査でも求められる）
export async function restore() {
  const { NativePurchases, PURCHASE_TYPE } = await plugin();
  await NativePurchases.restorePurchases();
  const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.SUBS, onlyCurrentEntitlements: true });
  return verify(purchases, true);
}

// Apple の「サブスクリプション」管理画面（プランの変更・解約は利用者がここで行う）
export async function manage() {
  const { NativePurchases } = await plugin();
  await NativePurchases.manageSubscriptions();
}
