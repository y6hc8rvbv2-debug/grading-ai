// 小さな共通の道具
export const cx = (...a) => a.filter(Boolean).join(' ');
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const schoolLabel = (t) => ({ elementary: '小学校', middle: '中学校', high: '高等学校' }[t] || t || '');
export const gradeLabel = (p) => (p?.grade ? `${p.grade}年` : '');
export const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
export const clamp = (n, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// 写真は端末の中で縮小してから保存・送信する（通信量とAIの費用を抑え、送信上限にも収める）
export function shrinkImage(file, max = 1100, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
    img.src = url;
  });
}

// 児童生徒の名前を「生徒1」などの仮名に置き換えてからAIに渡し、結果を受け取った後で元の名前に戻す
export function makeAliases(names) {
  const unique = [...new Set(names.filter(Boolean))];
  const toAlias = new Map(unique.map((n, i) => [n, `生徒${i + 1}`]));
  const toName = new Map(unique.map((n, i) => [`生徒${i + 1}`, n]));
  const restore = (text) => {
    if (typeof text !== 'string') return text;
    // 番号の大きい仮名から戻す（「生徒1」が「生徒12」の一部に当たらないように）
    return [...toName.keys()].sort((a, b) => b.length - a.length || b.localeCompare(a)).reduce((t, k) => t.replace(new RegExp(`${k}(?!\\d)`, 'g'), toName.get(k)), text);
  };
  const restoreDeep = (v) => (typeof v === 'string' ? restore(v) : Array.isArray(v) ? v.map(restoreDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, restoreDeep(x)])) : v);
  const hide = (text) => (typeof text === 'string' ? unique.sort((a, b) => b.length - a.length).reduce((t, n) => t.split(n).join(toAlias.get(n)), text) : text);
  return { alias: (n) => toAlias.get(n) || n, restore, restoreDeep, hide };
}

// AIに渡す指導案から、指導者名・学校名を取り除く
export function planForAi(plan) {
  if (!plan) return plan;
  const { instructorName, schoolName, reactions, comments, bookmarked, tags, ...rest } = plan;
  return rest;
}

export const scoreTone = (n) => (n >= 80 ? 'good' : n >= 60 ? 'brand' : n >= 40 ? 'warn' : 'bad');

// ごく簡単な Markdown → HTML（教材の表示用。見出し・箇条書き・表・太字）
export function mdToHtml(md) {
  const lines = esc(md).split('\n');
  const out = []; let list = null; let table = [];
  const inline = (t) => t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const flushList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter((r) => !/^\|?\s*:?-{2,}/.test(r)).map((r) => r.replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim())));
    out.push(`<table><thead><tr>${rows[0].map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    table = [];
  };
  for (const line of lines) {
    if (/^\s*\|.*\|\s*$/.test(line)) { flushList(); table.push(line.trim()); continue; }
    flushTable();
    let m;
    if ((m = /^(#{1,3})\s+(.*)/.exec(line))) { flushList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
    else if ((m = /^\s*[-*・]\s+(.*)/.exec(line))) { if (list !== 'ul') { flushList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = /^\s*\d+[.)]\s+(.*)/.exec(line))) { if (list !== 'ol') { flushList(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if (/^-{3,}$/.test(line.trim())) { flushList(); out.push('<hr>'); }
    else if (line.trim() === '') { flushList(); }
    else { flushList(); out.push(`<p>${inline(line)}</p>`); }
  }
  flushList(); flushTable();
  return out.join('\n');
}
