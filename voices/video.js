// クニゴエ：集計結果から YouTube 用の動画・サムネイル・説明文を作る（半自動の発信）
// 動画は利用者のブラウザの中で作る（サーバーの費用がかからない）。作った動画は運営者が確認してから手で投稿する。
// 個人の投稿本文や名前は使わず、集計した数字だけを載せる。
(function () {
  'use strict';
  const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic","Meiryo",sans-serif';
  const COL = {
    ink: '#14233b', ink2: '#4d5560', muted: '#6b7480', line: '#e3e6eb', track: '#f0f2f5',
    support: '#2a78d6', neutral: '#c9c8c1', oppose: '#e34948',
    s: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'],
    sat: ['#c93a3a', '#f0a3a2', '#d9d8d2', '#9ec5f4', '#256abf'],
  };
  const SLIDE = 4; // 1枚あたりの秒数
  const FPS = 30;
  const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
  const pct = (v, total) => (total ? Math.round((v / total) * 100) : 0);

  // ロゴのアイコン（SVG）を画像として読み込む。大きさの指定がないと描けないブラウザがあるので付け足す
  let icon = null;
  async function loadIcon() {
    if (icon) return icon;
    try {
      const svg = (await (await fetch('/voices/icon.svg')).text()).replace('<svg ', '<svg width="512" height="512" ');
      icon = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
    } catch { icon = null; }
    return icon;
  }

  // ---------- 描画の小道具 ----------
  function txt(ctx, str, x, y, size, color, o = {}) {
    ctx.font = `${o.weight || 700} ${size}px ${FONT}`;
    ctx.fillStyle = color; ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'alphabetic';
    if (o.maxW) { // 入りきらないときは文字を少し縮める
      let s = size;
      while (s > size * 0.6 && ctx.measureText(str).width > o.maxW) { s -= 1; ctx.font = `${o.weight || 700} ${s}px ${FONT}`; }
    }
    ctx.fillText(str, x, y);
  }
  function wrap(ctx, str, maxW) {
    const lines = []; let cur = '';
    for (const ch of [...str]) {
      if (ch === '\n') { lines.push(cur); cur = ''; continue; }
      if (ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; } else cur += ch;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function rrect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function bg(ctx, W, H) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#2b93f5'); g.addColorStop(1, '#3a49d6');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  // ---------- グラフ ----------
  function hbars(ctx, box, items, p, u, o = {}) {
    const max = o.max || Math.max(1, ...items.map((i) => i.value));
    const rowH = Math.min(box.h / items.length, 118 * u);
    box = { ...box, y: box.y + Math.max(0, (box.h - rowH * items.length) / 2 - 40 * u) };
    const labelW = box.w * (o.labelRatio || 0.34), valW = 190 * u, barW = box.w - labelW - valW - 24 * u;
    items.forEach((it, i) => {
      const y = box.y + i * rowH + rowH / 2;
      const grow = ease(p * 3 - i * 0.12);
      txt(ctx, it.label, box.x, y, 40 * u, COL.ink2, { base: 'middle', weight: 600, maxW: labelW - 16 * u });
      const bh = Math.min(44 * u, rowH * 0.55);
      ctx.fillStyle = COL.track; rrect(ctx, box.x + labelW, y - bh / 2, barW, bh, 8 * u); ctx.fill();
      ctx.fillStyle = it.color || COL.s[0]; rrect(ctx, box.x + labelW, y - bh / 2, Math.max(6 * u, (barW * it.value / max) * grow), bh, 8 * u); ctx.fill();
      txt(ctx, it.text || String(it.value), box.x + box.w, y, 42 * u, COL.ink, { align: 'right', base: 'middle', weight: 800 });
    });
  }
  function legend(ctx, x, y, parts, u) {
    let cx = x;
    parts.forEach((pt) => {
      ctx.fillStyle = pt.color; rrect(ctx, cx, y - 14 * u, 28 * u, 28 * u, 6 * u); ctx.fill();
      txt(ctx, pt.name, cx + 40 * u, y, 34 * u, COL.ink2, { base: 'middle', weight: 600 });
      ctx.font = `600 ${34 * u}px ${FONT}`; cx += 40 * u + ctx.measureText(pt.name).width + 40 * u;
    });
  }
  function stacked(ctx, box, rows, p, u, o = {}) {
    if (!o.noLegend) legend(ctx, box.x, box.y + 20 * u, rows[0].parts, u);
    const rowH = Math.min((box.h - 80 * u) / rows.length, 118 * u);
    const top = box.y + (o.noLegend ? 0 : 80 * u) + (o.noLegend ? 0 : Math.max(0, (box.h - 80 * u - rowH * rows.length) / 2 - 40 * u));
    const labelW = box.w * 0.3;
    rows.forEach((r, i) => {
      const y = top + i * rowH + rowH / 2, total = r.parts.reduce((a, x) => a + x.value, 0);
      const grow = ease(p * 3 - i * 0.12), w = (box.w - labelW) * grow, bh = Math.min(60 * u, rowH * 0.66);
      txt(ctx, r.label, box.x, y, 38 * u, COL.ink2, { base: 'middle', weight: 600, maxW: labelW - 16 * u });
      let x = box.x + labelW;
      r.parts.forEach((pt) => {
        if (!pt.value) return;
        const sw = (w * pt.value) / total;
        ctx.fillStyle = pt.color; ctx.fillRect(x, y - bh / 2, Math.max(0, sw - 3 * u), bh);
        const share = pct(pt.value, total);
        if (share >= 12 && grow > 0.9) txt(ctx, share + '%', x + sw / 2, y, Math.min(32 * u, bh * 0.62), pt.dark ? '#ffffff' : COL.ink, { align: 'center', base: 'middle', weight: 800 });
        x += sw;
      });
    });
  }

  // ---------- スライド ----------
  function buildSlides(s, meta) {
    const K = window.KG, slides = [];
    const sn = s.topicStance.reduce((a, r) => a + r.n, 0);
    const sup = s.topicStance.reduce((a, r) => a + r.support, 0), opp = s.topicStance.reduce((a, r) => a + r.oppose, 0);
    const stanceOk = sn >= s.minCell, satOk = s.sat.n >= s.minCell;
    const stanceParts = (r) => K.STANCES.map((x) => ({ name: x.name, value: r[x.k], color: COL[x.k], dark: x.k !== 'neutral' }));

    slides.push({ title: null, draw(ctx, b, p, u) { // 表紙
      const cy = b.y + b.h / 2;
      txt(ctx, 'クニゴエ週報', b.x + b.w / 2, cy - 150 * u, 104 * u, COL.ink, { align: 'center', weight: 900, maxW: b.w });
      txt(ctx, meta.where, b.x + b.w / 2, cy - 10 * u, 64 * u, COL.s[0], { align: 'center', weight: 800, maxW: b.w });
      txt(ctx, meta.period, b.x + b.w / 2, cy + 80 * u, 48 * u, COL.ink2, { align: 'center', weight: 700, maxW: b.w });
      if (meta.sub) txt(ctx, meta.sub, b.x + b.w / 2, cy + 160 * u, 40 * u, COL.muted, { align: 'center', weight: 600, maxW: b.w });
      txt(ctx, '市民の声を、数字で見る。', b.x + b.w / 2, cy + 280 * u * (meta.vertical ? 1.4 : 1), 44 * u, COL.ink, { align: 'center', weight: 700, maxW: b.w });
    } });

    const tiles = [
      ['投稿数', s.totals.posts.toLocaleString(), '件'], ['投稿した人', s.totals.users.toLocaleString(), '人'],
      ['政策を支持', stanceOk ? pct(sup, sn) + '%' : '—', stanceOk ? `不支持 ${pct(opp, sn)}%` : 'データ不足'],
      ['暮らし向き', satOk ? s.sat.avg.toFixed(2) : '—', satOk ? '5点満点の平均' : 'データ不足'],
    ];
    slides.push({ title: '全体の数字', draw(ctx, b, p, u) {
      const cols = meta.vertical ? 2 : 4, rows = Math.ceil(tiles.length / cols), gap = 32 * u;
      const tw = (b.w - gap * (cols - 1)) / cols, th = Math.min((b.h - gap * (rows - 1)) / rows, 420 * u);
      const y0 = b.y + (b.h - (th * rows + gap * (rows - 1))) / 2;
      tiles.forEach((t, i) => {
        const x = b.x + (i % cols) * (tw + gap), y = y0 + Math.floor(i / cols) * (th + gap), a = ease(p * 3 - i * 0.15);
        ctx.globalAlpha = a;
        ctx.fillStyle = '#f4f7fc'; rrect(ctx, x, y, tw, th, 28 * u); ctx.fill();
        txt(ctx, t[0], x + tw / 2, y + th * 0.26, 40 * u, COL.ink2, { align: 'center', maxW: tw - 30 * u });
        txt(ctx, t[1], x + tw / 2, y + th * 0.62, 104 * u, COL.ink, { align: 'center', weight: 900, maxW: tw - 30 * u });
        txt(ctx, t[2], x + tw / 2, y + th * 0.84, 34 * u, COL.muted, { align: 'center', weight: 600, maxW: tw - 30 * u });
        ctx.globalAlpha = 1;
      });
    } });

    if (stanceOk) {
      const rows = s.topicStance.slice().sort((a, b) => b.n - a.n).slice(0, meta.vertical ? 9 : 6)
        .map((r) => ({ label: K.nameOf(K.TOPICS, r.k), parts: stanceParts(r) }));
      slides.push({ title: '政策への評価（分野別）', note: '1人1票換算', draw: (ctx, b, p, u) => stacked(ctx, b, rows, p, u) });
    }
    const topics = s.topicCount.slice().sort((a, b) => b.n - a.n).slice(0, meta.vertical ? 8 : 6);
    const tTotal = s.topicCount.reduce((a, x) => a + x.n, 0);
    if (topics.length) slides.push({ title: '関心の高い政策分野', note: '投稿数の多い順', draw: (ctx, b, p, u) =>
      hbars(ctx, b, topics.map((x, i) => ({ label: K.nameOf(K.TOPICS, x.k), value: x.n, text: pct(x.n, tTotal) + '%', color: i === 0 ? COL.s[1] : COL.s[0] })), p, u) });
    const emos = K.EMOTIONS.map((e) => ({ k: e.k, name: e.name, n: (s.emotions.find((x) => x.k === e.k) || { n: 0 }).n }));
    const eTotal = emos.reduce((a, x) => a + x.n, 0);
    if (eTotal >= s.minCell) slides.push({ title: 'いまの気持ち', note: '気持ちを選んだ投稿の内訳', draw: (ctx, b, p, u) =>
      hbars(ctx, b, emos.map((x, i) => ({ label: x.name, value: x.n, text: pct(x.n, eTotal) + '%', color: COL.s[i] })), p, u) });
    if (satOk) slides.push({ title: '暮らし向き', note: `回答者 ${s.sat.n.toLocaleString()}人・1人1回`, draw(ctx, b, p, u) {
      const v = meta.vertical, k = v ? 1 : 0.72;
      txt(ctx, s.sat.avg.toFixed(2), b.x + b.w / 2, b.y + 170 * u * k, 160 * u * k, COL.ink, { align: 'center', weight: 900 });
      txt(ctx, '5点満点の平均（1＝とても苦しい／5＝とてもゆとりがある）', b.x + b.w / 2, b.y + 250 * u * k, 34 * u, COL.muted, { align: 'center', weight: 600, maxW: b.w });
      const parts = K.SAT_LABELS.map((name, i) => ({ name, value: s.sat.dist[i], color: COL.sat[i], dark: i === 0 || i === 4 }));
      const rest = { x: b.x, y: b.y + (v ? 320 : 230) * u, w: b.w, h: b.h - (v ? 320 : 230) * u };
      if (meta.vertical) { // 縦長は凡例が1行に入りきらないので2段に分ける
        legend(ctx, rest.x, rest.y + 20 * u, parts.slice(0, 3), u); legend(ctx, rest.x, rest.y + 76 * u, parts.slice(3), u);
        stacked(ctx, { x: rest.x, y: rest.y + 130 * u, w: rest.w, h: 118 * u }, [{ label: '全体', parts }], p, u, { noLegend: true });
        if (s.sat.byAge.length) hbars(ctx, { x: rest.x, y: rest.y + 330 * u, w: rest.w, h: rest.h - 330 * u },
          s.sat.byAge.map((x) => ({ label: K.nameOf(K.AGES, x.k), value: x.avg, text: x.avg.toFixed(2), color: COL.s[0] })), p, u, { max: 5 });
      } else stacked(ctx, { x: rest.x, y: rest.y, w: rest.w, h: Math.min(rest.h, 200 * u) }, [{ label: '全体', parts }], p, u);
    } });
    if (s.tags.length) slides.push({ title: '話題のタグ', note: '投稿数の多い順', draw(ctx, b, p, u) {
      const list = s.tags.slice(0, meta.vertical ? 8 : 5), rowH = Math.min(b.h / list.length, 130 * u);
      b = { ...b, y: b.y + Math.max(0, (b.h - rowH * list.length) / 2 - 40 * u) };
      list.forEach((t, i) => {
        const y = b.y + i * rowH + rowH / 2; ctx.globalAlpha = ease(p * 3 - i * 0.15);
        txt(ctx, `${i + 1}`, b.x + 30 * u, y, 54 * u, COL.s[1], { align: 'center', base: 'middle', weight: 900 });
        txt(ctx, '#' + t.tag, b.x + 90 * u, y, 54 * u, COL.s[0], { base: 'middle', weight: 800, maxW: b.w - 330 * u });
        txt(ctx, t.n.toLocaleString() + '件', b.x + b.w, y, 44 * u, COL.ink2, { align: 'right', base: 'middle' });
        ctx.globalAlpha = 1;
      });
    } });
    slides.push({ title: null, draw(ctx, b, p, u) { // 締め
      const cy = b.y + b.h / 2;
      txt(ctx, 'あなたの声も、届けよう。', b.x + b.w / 2, cy - 200 * u, 76 * u, COL.ink, { align: 'center', weight: 900, maxW: b.w });
      txt(ctx, meta.url.replace(/^https?:\/\//, ''), b.x + b.w / 2, cy - 90 * u, 40 * u, COL.s[0], { align: 'center', weight: 700, maxW: b.w });
      ctx.font = `600 ${36 * u}px ${FONT}`;
      wrap(ctx, '※この集計は、自分から投稿した人の声をまとめたものです。無作為抽出の世論調査とは異なり、社会全体の割合を示すものではありません。', b.w * 0.92)
        .forEach((line, i) => txt(ctx, line, b.x + b.w / 2, cy + 40 * u + i * 56 * u, 36 * u, COL.ink2, { align: 'center', weight: 600 }));
    } });
    return slides;
  }

  // 1コマを描く（背景・見出し・白い板・中身）
  function frame(ctx, W, H, slides, t, meta) {
    const u = Math.min(W, H) / 1080, idx = Math.min(slides.length - 1, Math.floor(t / SLIDE)), p = (t - idx * SLIDE) / SLIDE, sl = slides[idx];
    bg(ctx, W, H);
    const m = 56 * u;
    if (icon) ctx.drawImage(icon, m, m, 110 * u, 110 * u);
    txt(ctx, 'KuniGoe', m + 136 * u, m + 52 * u, 56 * u, '#ffffff', { weight: 900 });
    txt(ctx, `${meta.where}｜${meta.period}`, m + 136 * u, m + 100 * u, 34 * u, 'rgba(255,255,255,.85)', { weight: 600, maxW: W - m * 2 - 136 * u - (meta.demo ? 300 * u : 0) });
    if (meta.demo) {
      ctx.fillStyle = '#c23030'; rrect(ctx, W - m - 280 * u, m + 20 * u, 280 * u, 70 * u, 35 * u); ctx.fill();
      txt(ctx, 'デモ・架空データ', W - m - 140 * u, m + 55 * u, 32 * u, '#ffffff', { align: 'center', base: 'middle', weight: 800 });
    }
    const panel = { x: m, y: m + 150 * u, w: W - m * 2, h: H - m * 2 - 150 * u - 70 * u };
    ctx.globalAlpha = idx === 0 ? 1 : ease(p * 5); // 最初の場面はフェードさせない（ショートの表紙になるため）
    ctx.fillStyle = '#ffffff'; rrect(ctx, panel.x, panel.y, panel.w, panel.h, 40 * u); ctx.fill();
    const pad = 64 * u;
    let body = { x: panel.x + pad, y: panel.y + pad, w: panel.w - pad * 2, h: panel.h - pad * 2 };
    const uc = meta.vertical ? u * 1.18 : u; // 縦長はスマホで見るので中身を大きめに
    if (sl.title) {
      txt(ctx, sl.title, body.x, body.y + 60 * uc, 64 * uc, COL.ink, { weight: 900, maxW: body.w });
      if (sl.note) txt(ctx, sl.note, body.x, body.y + 120 * uc, 34 * uc, COL.muted, { weight: 600, maxW: body.w });
      body = { x: body.x, y: body.y + 180 * uc, w: body.w, h: body.h - 180 * uc };
    }
    sl.draw(ctx, body, p, uc);
    ctx.globalAlpha = 1;
    // 下の帯：進み具合と注意書き
    const by = H - m - 30 * u;
    txt(ctx, '自主投稿の集計です（世論調査ではありません）', m, by + 12 * u, 30 * u, 'rgba(255,255,255,.85)', { weight: 600, maxW: W * 0.6 });
    slides.forEach((_, i) => { ctx.fillStyle = i <= idx ? '#ffffff' : 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(W - m - (slides.length - 1 - i) * 36 * u - 8 * u, by, 9 * u, 0, Math.PI * 2); ctx.fill(); });
  }

  async function record(canvas, s, meta, onProgress) {
    await loadIcon();
    const slides = buildSlides(s, meta), total = slides.length * SLIDE;
    const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
    if (!mime || !canvas.captureStream) throw new Error('このブラウザは動画の作成に対応していません。パソコンの Chrome・Edge でお試しください。');
    const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    frame(ctx, W, H, slides, 0, meta);
    const stream = canvas.captureStream(FPS);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6e6 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((r) => { rec.onstop = r; });
    rec.start(1000);
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        if (t >= total) { frame(ctx, W, H, slides, total - 0.001, meta); resolve(); return; }
        frame(ctx, W, H, slides, t, meta);
        if (onProgress) onProgress(t / total);
        setTimeout(tick, 1000 / FPS);
      };
      tick();
    });
    await new Promise((r) => setTimeout(r, 300)); // 最後のコマを確実に入れる
    rec.stop(); await stopped;
    stream.getTracks().forEach((tr) => tr.stop());
    if (onProgress) onProgress(1);
    return { blob: new Blob(chunks, { type: mime.split(';')[0] }), ext: mime.startsWith('video/mp4') ? 'mp4' : 'webm', seconds: total, slides: slides.length };
  }

  // サムネイル（1280×720）
  async function thumbnail(s, meta) {
    await loadIcon();
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const ctx = c.getContext('2d'), u = 720 / 1080;
    bg(ctx, 1280, 720);
    if (icon) ctx.drawImage(icon, 60, 60, 110, 110);
    txt(ctx, 'KuniGoe', 196, 128, 60, '#ffffff', { weight: 900 });
    const sn = s.topicStance.reduce((a, r) => a + r.n, 0), sup = s.topicStance.reduce((a, r) => a + r.support, 0);
    const big = sn >= s.minCell ? `政策支持 ${pct(sup, sn)}%` : `投稿 ${s.totals.posts.toLocaleString()}件`;
    ctx.fillStyle = '#ffffff'; rrect(ctx, 60, 220, 1160, 440, 40); ctx.fill();
    txt(ctx, 'クニゴエ週報', 640, 330, 70, COL.ink, { align: 'center', weight: 900 });
    txt(ctx, big, 640, 480, 130, COL.s[1], { align: 'center', weight: 900, maxW: 1100 });
    txt(ctx, `${meta.where}｜${meta.period}`, 640, 590, 46, COL.ink2, { align: 'center', weight: 700, maxW: 1100 });
    if (meta.demo) { ctx.fillStyle = '#c23030'; rrect(ctx, 1220 - 300 * u * 1.5, 80, 300 * u * 1.5, 70, 35); ctx.fill(); txt(ctx, 'デモ・架空データ', 1220 - 150 * u * 1.5, 115, 32, '#ffffff', { align: 'center', base: 'middle', weight: 800 }); }
    return c.toDataURL('image/png');
  }

  // YouTube のタイトルと説明文
  function metadata(s, meta) {
    const K = window.KG;
    const sn = s.topicStance.reduce((a, r) => a + r.n, 0);
    const sup = s.topicStance.reduce((a, r) => a + r.support, 0), opp = s.topicStance.reduce((a, r) => a + r.oppose, 0);
    const topics = s.topicCount.slice().sort((a, b) => b.n - a.n).slice(0, 3).map((t) => K.nameOf(K.TOPICS, t.k));
    const title = `【クニゴエ週報】${meta.where} ${meta.period}｜市民の声を数字で見る`.slice(0, 100);
    const lines = [
      `${meta.where}（${meta.period}）に「クニゴエ」に集まった市民の声の集計です。${meta.sub ? `（${meta.sub}）` : ''}`, '',
      `・投稿数：${s.totals.posts.toLocaleString()}件（${s.totals.users.toLocaleString()}人）`,
      sn >= s.minCell && `・政策への評価：支持 ${pct(sup, sn)}%／不支持 ${pct(opp, sn)}%（1人1票換算・${sn}人）`,
      topics.length && `・関心の高い分野：${topics.join('、')}`,
      s.sat.n >= s.minCell && `・暮らし向きの平均：${s.sat.avg.toFixed(2)}／5（${s.sat.n}人）`,
      s.tags.length && `・話題のタグ：${s.tags.slice(0, 3).map((t) => '#' + t.tag).join(' ')}`, '',
      '※この集計は、自分から投稿した人の声をまとめたものです。無作為抽出の世論調査とは異なり、社会全体の割合を示すものではありません。', '',
      '▼あなたの声も届けよう', meta.url, '',
      ['#クニゴエ', '#KuniGoe', '#市民の声', '#政治', meta.vertical && '#Shorts'].filter(Boolean).join(' '),
    ].filter((x) => x !== false && x !== 0 && x != null);
    return { title, description: lines.join('\n') };
  }

  window.KGVideo = { record, thumbnail, metadata, SLIDE };
})();
