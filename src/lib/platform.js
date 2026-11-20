// アプリ（iPhone）として動いているか、Web として動いているかの違いをここにまとめる。
// アプリでは画面一式をアプリの中に入れて動かし、AI・課金などのサーバー処理だけを本番のサーバーに問い合わせる。
import { Capacitor } from '@capacitor/core';

export const isNative = () => Capacitor.isNativePlatform();
export const isIOSApp = () => isNative() && Capacitor.getPlatform() === 'ios';

// サーバーの場所。Web では同じサイト、アプリではビルド時に指定した本番URL（VITE_API_BASE）
export const apiBase = () => (isNative() ? String(import.meta.env.VITE_API_BASE || '').replace(/\/$/, '') : '');
export const apiUrl = (path) => `${apiBase()}${path}`;

// 他の人に渡すURL（QRコード・共有リンク）。アプリの中の住所ではなく、公開されている Web のURLにする
export function publicUrl(hashPath) {
  const base = isNative() ? String(import.meta.env.VITE_PUBLIC_URL || import.meta.env.VITE_API_BASE || '').replace(/\/$/, '') : `${location.origin}${location.pathname.replace(/\/$/, '')}`;
  return `${base}/#${hashPath}`;
}

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('ファイルを準備できませんでした'));
  r.readAsDataURL(blob);
});

// アプリでのファイルの保存：端末に一時保存して、共有メニュー（「ファイルに保存」・AirDrop・メール・印刷など）を開く
export async function shareFile(blob, filename) {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const { uri } = await Filesystem.writeFile({ path: filename, data: await toBase64(blob), directory: Directory.Cache });
  try {
    await Share.share({ title: filename, files: [uri], dialogTitle: filename });
  } catch (e) {
    if (!/cancel/i.test(String(e?.message))) throw e; // 利用者が閉じただけなら何もしない
  }
}
