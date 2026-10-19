// 答案などを AI の提供元（Anthropic）に送る前の、明示の同意（App Store の審査ガイドライン 5.1.2(i) など）。
// 同意はこの端末に保存する（規約の版が変わったら、もう一度たずねる）。設定画面から取り消せる。
// 同意の画面は components/AiConsentDialog.tsx（AppShell の中に置く。document.body に出し、ほかの画面より手前に重ねる）。
import { POLICY_VERSION } from "@/lib/app-info";

const KEY = `ai-consent:${POLICY_VERSION}`;
const EVENT = "ai-consent-request";
/** 同意の画面が受け取ったら shown を true にする（受け取る画面が無いときに、待ち続けないため） */
export type ConsentRequest = ((ok: boolean) => void) & { shown?: boolean };

export const CONSENT_DECLINED = "AI への送信に同意していないため、AI での採点・読み取りは行いませんでした。";
export const CONSENT_UNAVAILABLE = "AI への送信の同意を確認する画面を表示できませんでした。画面を再読み込みしてから、もう一度お試しください（AI には何も送っていません）。";

// 端末に保存できない環境（プライベートブラウズなど）でも、同じ画面を開いているあいだは同意を覚えておく（1回の操作で2度たずねない）
let sessionConsent = false;

export function hasAiConsent() {
  if (sessionConsent) return true;
  try { return localStorage.getItem(KEY) === "yes"; } catch { return false; }
}
export function setAiConsent(ok: boolean) {
  sessionConsent = ok;
  try { if (ok) localStorage.setItem(KEY, "yes"); else localStorage.removeItem(KEY); } catch { /* 保存できない端末では、画面を開き直すたびにたずねる */ }
}

/** 同意が無ければ同意の画面を出す。同意しなければ例外（AI には何も送らない）。
 *  同意の画面が受け取らなければ（画面が無い・表示できない）、待ち続けずに例外にする */
export function requireAiConsent(): Promise<void> {
  if (hasAiConsent()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let answered = false;
    const done: ConsentRequest = (ok) => {
      if (answered) return;
      answered = true;
      if (ok) { setAiConsent(true); resolve(); }
      else reject(new Error(CONSENT_DECLINED));
    };
    window.dispatchEvent(new CustomEvent<ConsentRequest>(EVENT, { detail: done }));
    setTimeout(() => {
      if (answered || done.shown) return;
      answered = true;
      reject(new Error(CONSENT_UNAVAILABLE));
    }, 1000);
  });
}

export function onAiConsentRequest(handler: (done: ConsentRequest) => void) {
  const h = (e: Event) => {
    const done = (e as CustomEvent<ConsentRequest>).detail;
    done.shown = true;
    handler(done);
  };
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}
