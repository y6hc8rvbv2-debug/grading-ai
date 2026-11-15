// クニゴエ：グラフ部品（外部ライブラリなし。色は style.css の変数で明暗テーマに対応）
(function () {
  const SVG = 'http://www.w3.org/2000/svg';
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const s = (tag, attrs) => { const e = document.createElementNS(SVG, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const pct = (v, total) => (total ? Math.round((v / total) * 1000) / 10 : 0);

  // 凡例（色だけに頼らず、必ず名前を添える）
  function legend(items) {
    const box = el('div', 'lg');
    items.forEach((it) => { const i = el('span', 'lg-i'); const sw = el('i', 'lg-sw'); sw.style.background = it.color; i.append(sw, it.name); box.append(i); });
    return box;
  }

  // 横棒グラフ：items = [{label, value, color?, note?}]
  function hbar(items, opts = {}) {
    const max = opts.max || Math.max(1, ...items.map((i) => i.value));
    const fmt = opts.fmt || ((v) => v.toLocaleString());
    const box = el('div', 'hb');
    items.forEach((it) => {
      const row = el('div', 'hb-row');
      row.title = `${it.label}：${fmt(it.value)}${it.note ? `（${it.note}）` : ''}`;
      const track = el('div', 'hb-track'), bar = el('div', 'hb-bar');
      bar.style.width = Math.max(0.5, (it.value / max) * 100) + '%';
      bar.style.background = it.color || 'var(--s1)';
      track.append(bar);
      const val = el('span', 'hb-val notranslate', fmt(it.value));
      if (it.note) val.append(el('small', '', ' ' + it.note));
      row.append(el('span', 'hb-label', it.label), track, val);
      box.append(row);
    });
    return box;
  }

  // 100%積み上げ横棒：rows = [{label, parts:[{name, value, color}]}]
  function stacked(rows, opts = {}) {
    const box = el('div', 'sb');
    if (rows[0] && !opts.noLegend) box.append(legend(rows[0].parts));
    rows.forEach((r) => {
      const total = r.parts.reduce((a, p) => a + p.value, 0);
      const row = el('div', 'sb-row');
      const bar = el('div', 'sb-bar');
      r.parts.forEach((p) => {
        if (!p.value) return;
        const seg = el('div', 'sb-seg');
        const share = pct(p.value, total);
        seg.style.flexGrow = p.value;
        seg.style.background = p.color;
        seg.title = `${r.label}｜${p.name}：${share}%（${p.value.toLocaleString()}人）`;
        if (share >= 12) seg.append(el('span', (p.dark ? 'on-dark' : 'on-light') + ' notranslate', Math.round(share) + '%'));
        bar.append(seg);
      });
      row.append(el('span', 'sb-label', r.label), bar, el('span', 'sb-n notranslate', 'n=' + total.toLocaleString()));
      box.append(row);
    });
    return box;
  }

  // 折れ線グラフ：points = [{d:'YYYY-MM-DD', n}]（カーソルを合わせると値を表示）
  function line(points) {
    const W = 640, H = 220, L = 40, R = 12, T = 12, B = 26;
    const wrap = el('div', 'ln');
    if (!points.length) { wrap.append(el('p', 'muted', 'データがありません。')); return wrap; }
    const max = Math.max(1, ...points.map((p) => p.n));
    const step = Math.pow(10, Math.floor(Math.log10(max)));
    const tick = [1, 2, 5, 10].map((m) => m * step).find((t) => max / t <= 4) || step * 10;
    const top = Math.ceil(max / tick) * tick;
    const x = (i) => L + (points.length === 1 ? (W - L - R) / 2 : (i / (points.length - 1)) * (W - L - R));
    const y = (v) => T + (1 - v / top) * (H - T - B);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '日ごとの投稿数の推移' });
    for (let v = 0; v <= top; v += tick) {
      svg.append(s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v ? 'ln-grid' : 'ln-axis' }));
      const t = s('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'ln-tick notranslate' }); t.textContent = v.toLocaleString(); svg.append(t);
    }
    const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
    [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])].forEach((i, n, arr) => {
      const t = s('text', { x: x(i), y: H - 8, 'text-anchor': n === 0 ? 'start' : n === arr.length - 1 ? 'end' : 'middle', class: 'ln-tick notranslate' });
      t.textContent = md(points[i].d); svg.append(t);
    });
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.n).toFixed(1)}`).join('');
    svg.append(s('path', { d: `${path}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z`, class: 'ln-area' }));
    svg.append(s('path', { d: path, class: 'ln-path' }));
    const cross = s('line', { y1: T, y2: H - B, class: 'ln-cross', visibility: 'hidden' });
    const dot = s('circle', { r: 5, class: 'ln-dot', visibility: 'hidden' });
    svg.append(cross, dot);
    const tip = el('div', 'tip notranslate'); tip.hidden = true;
    const move = (ev) => {
      const box = svg.getBoundingClientRect();
      const px = ((ev.clientX - box.left) / box.width) * W;
      const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - L) / (W - L - R)) * (points.length - 1))));
      const p = points[i];
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(p.n)); dot.setAttribute('visibility', 'visible');
      tip.hidden = false; tip.textContent = `${md(p.d)}　${p.n.toLocaleString()}件`;
      const left = (x(i) / W) * box.width;
      tip.style.left = Math.max(40, Math.min(box.width - 40, left)) + 'px';
      tip.style.top = (y(p.n) / H) * box.height - 34 + 'px';
    };
    const leave = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); };
    svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move); svg.addEventListener('pointerleave', leave);
    wrap.append(svg, tip);
    return wrap;
  }

  // 表（グラフと同じ数字を表でも確認できるようにする）
  function table(cols, rows) {
    const wrap = el('div', 'tbl-wrap'), t = el('table', 'tbl'), hr = el('tr');
    cols.forEach((c, i) => { const th = el('th', i ? 'num' : '', c); hr.append(th); });
    const thead = el('thead'); thead.append(hr);
    const tb = el('tbody');
    rows.forEach((r) => {
      const tr = el('tr');
      r.forEach((c, i) => { const td = el('td', i && typeof c !== 'object' ? 'num notranslate' : ''); if (c instanceof Node) td.append(c); else td.textContent = c == null ? '—' : typeof c === 'number' ? c.toLocaleString() : c; tr.append(td); });
      tb.append(tr);
    });
    t.append(thead, tb); wrap.append(t);
    return wrap;
  }

  window.KGChart = { hbar, stacked, line, table, legend, pct };
})();
