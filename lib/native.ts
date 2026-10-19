// ストア用のアプリ（Capacitor。capacitor.config.ts）の中で開かれているか。
// アプリの中では、料金の申し込み・支払いの操作と、外部の決済へのリンクを出さない（App Store 3.1.1・3.1.3、Google Play の決済ポリシー）。
// 契約は Web ブラウザで行い、アプリでは契約の状況（プランと今期の採点回数）だけを表示する。
export const NATIVE_UA_MARK = "TestSaitenApp/";

/** サーバー側：要求の User-Agent がアプリのものか */
export function isNativeUserAgent(ua: string | null | undefined): boolean {
  return !!ua && ua.includes(NATIVE_UA_MARK);
}

/** ブラウザ側：アプリの中で動いているか（Capacitor の橋渡し、または User-Agent の印） */
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform?.()) return true;
  return isNativeUserAgent(navigator.userAgent);
}
