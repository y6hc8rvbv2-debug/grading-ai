import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';
import { initStore, applyDisplay, getDisplay } from './lib/store.js';
import { loadConfig } from './lib/api.js';

applyDisplay();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => getDisplay().theme === 'system' && applyDisplay());
initStore();
loadConfig();

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
