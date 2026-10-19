// 採点が終わったことを知らせる（ver6 の便利機能）。
// 画面を見ていないとき（別のタブ・別のアプリ）は、ブラウザの通知と短い音で知らせる。
// 通知の許可は、先生が「採点する」を押したときに一度だけたずねる（断られたら音だけ）。

export async function askNotifyPermission() {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") await Notification.requestPermission();
  } catch { /* 通知に対応しないブラウザ */ }
}

export function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [660, 880].forEach((hz, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = hz; o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.15, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.start(t); o.stop(t + 0.17);
    });
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch { /* 音を出せない環境 */ }
}

export function notifyDone(message: string) {
  if (typeof document === "undefined") return;
  if (!document.hidden) return;   // 画面を見ているときは画面の表示だけ
  chime();
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("テスト採点", { body: message, tag: "saiten-done" });
  } catch { /* 通知に対応しないブラウザ */ }
}
