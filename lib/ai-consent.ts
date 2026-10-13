// 答案などを AI の提供元（Anthropic）に送る前の、明示の同意（App Store の審査ガイドライン 5.1.2(i) など）。
// 同意はこの端末に保存する（規約の版が変わったら、もう一度たずねる）。設定画面から取り消せる。
// 同意の画面は components/AiConsentDialog.tsx（AppShell の中に置く）。
import { POLICY_VERSION } from "@/lib/app-info";

const KEY = `ai-consent:${POLICY_VERSION}`;
const EVENT = "ai-consent-request";
export type ConsentRequest = (ok: boolean) => void;

export function hasAiConsent() {
  try { return localStorage.getItem(KEY) === "yes"; } catch { return false; }
}
export function setAiConsent(ok: boolean) {
  try { if (ok) localStorage.setItem(KEY, "yes"); else localStorage.removeItem(KEY); } catch { /* 保存できない端末では毎回たずねる */ }
}

/** 同意が無ければ同意の画面を出す。同意しなければ例外（AI には何も送らない） */
export function requireAiConsent(): Promise<void> {
  if (hasAiConsent()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let answered = false;
    const done: ConsentRequest = (ok) => {
      answered = true;
      if (ok) { setAiConsent(true); resolve(); }
      else reject(new Error("AI への送信に同意していないため、AI での採点・読み取りは行いませんでした。"));
    };
    window.dispatchEvent(new CustomEvent<ConsentRequest>(EVENT, { detail: done }));
    // 同意の画面が無い画面（ありえないはず）では、送らずに止める
    setTimeout(() => { if (!answered && !document.querySelector("[data-ai-consent]")) done(false); }, 500);
  });
}

export function onAiConsentRequest(handler: (done: ConsentRequest) => void) {
  const h = (e: Event) => handler((e as CustomEvent<ConsentRequest>).detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}
