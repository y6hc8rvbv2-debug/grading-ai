import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';
import { initStore, applyDisplay, getDisplay } from './lib/store.js';
import { loadConfig } from './lib/api.js';
import { syncAccount } from './lib/account.js';

applyDisplay();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => getDisplay().theme === 'system' && applyDisplay());
// 保存データと設定を読み込んだ後、サーバーの契約状態を取り込む（画面に戻った時にも更新）
Promise.all([initStore(), loadConfig()]).then(syncAccount);
let lastSync = Date.now();
window.addEventListener('focus', () => { if (Date.now() - lastSync > 60_000) { lastSync = Date.now(); syncAccount(); } });

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
