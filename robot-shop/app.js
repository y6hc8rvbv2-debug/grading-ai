// ロボマルシェ 画面側のコード
// ⚠ 個人情報（氏名・メール・電話・住所）はブラウザに保存しない。送信はサーバー（/api/robot-order）だけ。
import { CATEGORIES, PRODUCTS, OPTIONS, calcTotals, findProduct, optionPrice, FREE_SHIPPING_LINE } from './data.js';

// ───────── 共通ユーティリティ ─────────
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const yen = (n) => '¥' + Math.round(n).toLocaleString('ja-JP');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const AVAIL = { buy: ['buy', 'すぐ購入'], quote: ['quote', '見積・発注'], rental: ['rental', 'レンタル/月額'] };

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('robomarche:' + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('robomarche:' + key, JSON.stringify(value)); } catch { /* 保存できない環境では何もしない */ }
  },
};

const state = {
  cat: 'all', avail: 'all', budget: 0, sort: 'rec', q: '',
  favs: new Set(store.get('favs', [])),
  cart: store.get('cart', []),
  compare: [],
  recent: store.get('recent', []),
  orders: store.get('orders', []), // マスク済みの値のみ
  lastRecs: [],
};
const save = () => {
  store.set('favs', [...state.favs]);
  store.set('cart', state.cart);
  store.set('recent', state.recent);
  store.set('orders', state.orders);
};

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

// 価格表示
function priceLabel(p) {
  if (p.price) return `${yen(p.price)}<small>〜（目安）</small>`;
  if (p.monthly) return `月額 ${yen(p.monthly)}<small>〜</small>`;
  return '要見積';
}
// 「約250万円」などの目安から概算金額を取り出す（ROI計算用）
function estimatePrice(p) {
  if (p.price) return p.price;
  const m = String(p.priceHint).match(/約?([\d,]+)万円/);
  return m ? Number(m[1].replace(/,/g, '')) * 10000 : 0;
}

// ───────── 製品イラスト（SVG） ─────────
function robotSVG(p) {
  const c = p.color || '#888';
  const d = '#2b3245';
  const shapes = {
    arm: `<rect x="50" y="92" width="44" height="12" rx="3" fill="${d}"/><rect x="62" y="80" width="20" height="14" rx="4" fill="${c}"/>
      <path d="M72 82 L58 46 L100 30" stroke="${c}" stroke-width="12" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="72" cy="82" r="7" fill="${d}"/><circle cx="58" cy="46" r="7" fill="${d}"/><circle cx="100" cy="30" r="6" fill="${d}"/>
      <path d="M104 28 l12 4 M104 34 l12 8" stroke="${d}" stroke-width="4" stroke-linecap="round"/>`,
    cobot: `<rect x="52" y="94" width="40" height="10" rx="3" fill="${d}"/><rect x="64" y="70" width="16" height="26" rx="8" fill="${c}"/>
      <path d="M72 70 L72 44 L106 36 L112 54" stroke="${c}" stroke-width="14" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="72" cy="44" r="8" fill="#fff" stroke="${d}" stroke-width="3"/><circle cx="106" cy="36" r="7" fill="#fff" stroke="${d}" stroke-width="3"/>
      <rect x="106" y="56" width="12" height="10" rx="2" fill="${d}"/>`,
    scara: `<rect x="40" y="94" width="40" height="10" rx="3" fill="${d}"/><rect x="52" y="34" width="16" height="62" rx="4" fill="${c}"/>
      <rect x="52" y="30" width="56" height="14" rx="7" fill="${c}"/><rect x="96" y="32" width="36" height="10" rx="5" fill="${d}"/>
      <rect x="124" y="40" width="5" height="34" fill="${d}"/><circle cx="60" cy="37" r="5" fill="#fff"/>`,
    dualarm: `<rect x="56" y="64" width="48" height="40" rx="8" fill="${c}"/><rect x="60" y="102" width="40" height="8" fill="${d}"/>
      <path d="M60 70 L36 56 L30 76 M100 70 L124 56 L130 76" stroke="${d}" stroke-width="8" fill="none" stroke-linecap="round"/>
      <circle cx="80" cy="50" r="12" fill="${c}"/><rect x="72" y="46" width="16" height="6" rx="3" fill="${d}"/>`,
    humanoid: `<rect x="64" y="18" width="32" height="26" rx="10" fill="${c}"/><rect x="69" y="26" width="22" height="9" rx="4" fill="${d}"/>
      <circle cx="75" cy="30" r="2.5" fill="#7cf"/><circle cx="85" cy="30" r="2.5" fill="#7cf"/>
      <rect x="62" y="46" width="36" height="34" rx="8" fill="${c}"/><circle cx="80" cy="60" r="5" fill="${d}"/>
      <path d="M62 52 L48 72 M98 52 L112 72" stroke="${c}" stroke-width="8" stroke-linecap="round"/>
      <path d="M72 80 L70 104 M88 80 L90 104" stroke="${d}" stroke-width="9" stroke-linecap="round"/>`,
    pet: `<ellipse cx="78" cy="70" rx="34" ry="20" fill="${c}" stroke="${d}" stroke-width="2"/><circle cx="114" cy="50" r="16" fill="${c}" stroke="${d}" stroke-width="2"/>
      <ellipse cx="110" cy="38" rx="5" ry="10" fill="${d}" transform="rotate(-20 110 38)"/><circle cx="118" cy="50" r="3" fill="${d}"/><circle cx="108" cy="51" r="3" fill="${d}"/>
      <path d="M56 86 v16 M70 88 v16 M90 88 v16 M102 86 v16" stroke="${d}" stroke-width="6" stroke-linecap="round"/><path d="M44 64 q-10 -8 -6 -18" stroke="${d}" stroke-width="4" fill="none"/>`,
    amr: `<rect x="34" y="62" width="92" height="30" rx="8" fill="${c}"/><rect x="40" y="56" width="80" height="8" rx="4" fill="${d}"/>
      <circle cx="50" cy="94" r="8" fill="${d}"/><circle cx="110" cy="94" r="8" fill="${d}"/><rect x="72" y="44" width="16" height="12" rx="3" fill="${d}"/>
      <circle cx="80" cy="50" r="3" fill="#7cf"/><rect x="44" y="70" width="20" height="6" rx="3" fill="#fff" opacity=".7"/>`,
    cart: `<rect x="36" y="64" width="80" height="18" rx="4" fill="${c}"/><path d="M116 66 L128 30" stroke="${d}" stroke-width="6" stroke-linecap="round"/>
      <rect x="44" y="44" width="40" height="20" rx="3" fill="#fff" stroke="${d}" stroke-width="2"/><circle cx="50" cy="92" r="9" fill="${d}"/><circle cx="104" cy="92" r="9" fill="${d}"/>
      <circle cx="128" cy="28" r="5" fill="${c}"/>`,
    tractor: `<rect x="40" y="58" width="70" height="26" rx="5" fill="${c}"/><rect x="82" y="30" width="34" height="32" rx="4" fill="${c}" stroke="${d}" stroke-width="3"/>
      <rect x="88" y="36" width="22" height="16" fill="#bfe3ff"/><circle cx="104" cy="88" r="18" fill="${d}"/><circle cx="104" cy="88" r="7" fill="#999"/>
      <circle cx="52" cy="94" r="12" fill="${d}"/><circle cx="52" cy="94" r="4" fill="#999"/><rect x="98" y="22" width="12" height="6" rx="3" fill="${d}"/>`,
    drone: `<rect x="62" y="56" width="36" height="16" rx="6" fill="${c}"/><path d="M62 60 L36 44 M98 60 L124 44 M62 68 L36 84 M98 68 L124 84" stroke="${d}" stroke-width="5"/>
      <ellipse cx="36" cy="42" rx="18" ry="4" fill="${d}" opacity=".6"/><ellipse cx="124" cy="42" rx="18" ry="4" fill="${d}" opacity=".6"/>
      <ellipse cx="36" cy="86" rx="18" ry="4" fill="${d}" opacity=".6"/><ellipse cx="124" cy="86" rx="18" ry="4" fill="${d}" opacity=".6"/><circle cx="80" cy="78" r="6" fill="${d}"/>`,
    exo: `<circle cx="80" cy="22" r="10" fill="#f1c9a5"/><rect x="66" y="34" width="28" height="40" rx="8" fill="#9fb3c8"/>
      <path d="M70 74 L68 106 M90 74 L92 106" stroke="#9fb3c8" stroke-width="10" stroke-linecap="round"/>
      <path d="M62 38 L62 84 L72 92 M98 38 L98 84 L88 92" stroke="${c}" stroke-width="7" fill="none" stroke-linecap="round"/><rect x="60" y="64" width="40" height="10" rx="4" fill="${c}"/>`,
    vacuum: `<ellipse cx="80" cy="84" rx="46" ry="14" fill="${d}" opacity=".35"/><path d="M80 44 L124 80 L36 80 Z" fill="${c}" stroke="${d}" stroke-width="3" stroke-linejoin="round"/>
      <circle cx="80" cy="66" r="7" fill="#fff" opacity=".8"/>`,
    kiosk: `<rect x="56" y="22" width="48" height="76" rx="22" fill="${c}"/><rect x="64" y="34" width="32" height="20" rx="8" fill="${d}"/>
      <circle cx="74" cy="44" r="3" fill="#7cf"/><circle cx="86" cy="44" r="3" fill="#7cf"/><rect x="66" y="62" width="28" height="12" rx="3" fill="#fff" opacity=".7"/>
      <rect x="50" y="96" width="60" height="10" rx="5" fill="${d}"/>`,
    avatar: `<rect x="62" y="20" width="36" height="28" rx="4" fill="${d}"/><rect x="66" y="24" width="28" height="20" rx="2" fill="#bfe3ff"/>
      <circle cx="80" cy="32" r="5" fill="#f1c9a5"/><rect x="77" y="48" width="6" height="44" fill="${c}"/><ellipse cx="80" cy="98" rx="26" ry="8" fill="${c}"/>`,
    kitchen: `<rect x="26" y="74" width="108" height="30" rx="4" fill="#cfd8dc" stroke="${d}" stroke-width="2"/><rect x="40" y="58" width="30" height="16" rx="3" fill="${d}"/>
      <path d="M110 74 L110 40 L84 30 L76 44" stroke="${c}" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M40 54 q6 -10 0 -18 M52 54 q6 -10 0 -18 M64 54 q6 -10 0 -18" stroke="#9aa" stroke-width="2" fill="none"/>`,
    small: `<rect x="56" y="46" width="48" height="40" rx="14" fill="${c}" stroke="${d}" stroke-width="3"/><circle cx="72" cy="64" r="5" fill="${d}"/><circle cx="88" cy="64" r="5" fill="${d}"/>
      <path d="M72 76 q8 6 16 0" stroke="${d}" stroke-width="3" fill="none" stroke-linecap="round"/><rect x="60" y="86" width="40" height="10" rx="4" fill="${d}"/>
      <path d="M80 46 v-12" stroke="${d}" stroke-width="3"/><circle cx="80" cy="32" r="4" fill="${d}"/>`,
  };
  return `<svg viewBox="0 0 160 120" role="img" aria-label="${esc(p.name)}のイメージ"><defs><linearGradient id="g-${p.id}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${c}" stop-opacity=".18"/><stop offset="1" stop-color="${c}" stop-opacity=".04"/></linearGradient></defs>
    <rect width="160" height="120" fill="url(#g-${p.id})"/><ellipse cx="80" cy="108" rx="50" ry="5" fill="#000" opacity=".08"/>${shapes[p.shape] || shapes.small}</svg>`;
}

// ───────── 一覧 ─────────
function filtered() {
  const q = state.q.trim().toLowerCase();
  let list = PRODUCTS.filter((p) => {
    if (state.cat !== 'all' && p.category !== state.cat) return false;
    if (state.avail !== 'all' && p.availability !== state.avail) return false;
    if (state.budget) {
      const v = p.price || estimatePrice(p) || (p.monthly ? p.monthly * 12 : 0);
      if (!v || v > state.budget) return false;
    }
    if (q) {
      const cat = CATEGORIES.find((c) => c.id === p.category);
      const hay = [p.name, p.maker, p.summary, cat?.name, ...p.tags, ...p.ai].join(' ').toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const val = (p) => p.price || estimatePrice(p) || (p.monthly ? p.monthly * 12 : Infinity);
  if (state.sort === 'price-asc') list.sort((a, b) => val(a) - val(b));
  if (state.sort === 'price-desc') list.sort((a, b) => (val(b) === Infinity ? -1 : val(b)) - (val(a) === Infinity ? -1 : val(a)));
  if (state.sort === 'lead') list.sort((a, b) => a.leadWeeks - b.leadWeeks);
  if (state.sort === 'maker') list.sort((a, b) => a.maker.localeCompare(b.maker, 'ja'));
  return list;
}

function renderCats() {
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, PRODUCTS.filter((p) => p.category === c.id).length]));
  $('#cats').innerHTML =
    `<button class="cat" data-cat="all" aria-pressed="${state.cat === 'all'}"><span class="ic">✨</span><span><span class="nm">すべての製品</span><br><span class="ct">${PRODUCTS.length}製品</span></span></button>` +
    CATEGORIES.map((c) => `<button class="cat" data-cat="${c.id}" aria-pressed="${state.cat === c.id}" title="${esc(c.desc)}"><span class="ic">${c.icon}</span><span><span class="nm">${esc(c.name)}</span><br><span class="ct">${counts[c.id]}製品</span></span></button>`).join('');
}

function cardHTML(p) {
  const [cls, label] = AVAIL[p.availability];
  return `<article class="card">
    <button class="img" data-open="${p.id}" aria-label="${esc(p.name)}の詳細を見る">${robotSVG(p)}</button>
    <button class="fav" data-fav="${p.id}" aria-label="お気に入り">${state.favs.has(p.id) ? '❤️' : '🤍'}</button>
    <div class="body">
      <span class="maker">${esc(p.maker)}</span>
      <h3>${esc(p.name)}</h3>
      <p class="sum">${esc(p.summary)}</p>
      <div><span class="tag ${cls}">${label}</span> <span class="tag">納期 約${p.leadWeeks}週</span></div>
      <div class="row"><span class="price">${priceLabel(p)}</span>
        <label class="cmp"><input type="checkbox" data-cmp="${p.id}" ${state.compare.includes(p.id) ? 'checked' : ''}/>比較</label></div>
    </div></article>`;
}

function renderGrid() {
  const list = filtered();
  $('#count').textContent = `${list.length}件`;
  $('#grid').innerHTML = list.length ? list.map(cardHTML).join('') : '<p class="empty">条件に合う製品がありません。条件をゆるめるか、AIコンシェルジュに相談してください。</p>';
}

function renderStats() {
  const makers = new Set(PRODUCTS.map((p) => p.maker)).size;
  $('#stats').innerHTML = `<div class="stat"><b>${PRODUCTS.length}</b><span>製品</span></div><div class="stat"><b>${makers}</b><span>国内メーカー</span></div><div class="stat"><b>${CATEGORIES.length}</b><span>分類</span></div>`;
}

function renderRecent() {
  const items = state.recent.map(findProduct).filter(Boolean);
  $('#recent').hidden = items.length === 0;
  $('#recent-row').innerHTML = items.map((p) => `<button data-open="${p.id}">${robotSVG(p)}${esc(p.name)}</button>`).join('');
}

function renderBadges() {
  const n = state.cart.reduce((s, i) => s + i.qty, 0);
  $('#cart-badge').textContent = n || '';
  $('#cart-badge').dataset.n = n;
  $('#fav-badge').textContent = state.favs.size || '';
  $('#fav-badge').dataset.n = state.favs.size;
  const bar = $('#compare-bar');
  bar.classList.toggle('show', state.compare.length > 0);
  $('#compare-text').textContent = `比較リスト ${state.compare.length}/3`;
}

function renderAll() {
  renderCats();
  renderGrid();
  renderRecent();
  renderBadges();
  save();
}

// ───────── モーダル・ドロワー ─────────
function openModal(html) {
  $('#drawer').classList.remove('open');
  $('#modal-body').innerHTML = html;
  $('#modal').classList.add('open');
  $('#overlay').classList.add('open');
  $('#modal').scrollTop = 0;
}
function openDrawer(html) {
  $('#modal').classList.remove('open');
  $('#drawer-body').innerHTML = html;
  $('#drawer').classList.add('open');
  $('#drawer').scrollTop = 0;
  $('#overlay').classList.add('open');
}
function closeAll() {
  $('#modal').classList.remove('open');
  $('#drawer').classList.remove('open');
  $('#overlay').classList.remove('open');
  if (location.hash.startsWith('#p=')) history.replaceState(null, '', location.pathname + location.search);
}

// ───────── 製品詳細 ─────────
function openDetail(id) {
  const p = findProduct(id);
  if (!p) return;
  state.recent = [id, ...state.recent.filter((x) => x !== id)].slice(0, 8);
  renderRecent();
  save();
  history.replaceState(null, '', '#p=' + id);
  const cat = CATEGORIES.find((c) => c.id === p.category);
  const [cls, label] = AVAIL[p.availability];
  const est = estimatePrice(p);
  const similar = PRODUCTS.filter((x) => x.category === p.category && x.id !== p.id).slice(0, 4);
  const isBiz = !['home', 'education'].includes(p.category);
  const actionLabel = p.availability === 'quote' ? '見積・発注リストに入れる' : p.availability === 'rental' ? 'レンタル申込リストに入れる' : 'カートに入れる';

  openModal(`<div class="detail" data-detail="${p.id}">
    <div class="d-pic"><div class="pic">${robotSVG(p)}<button class="fav" data-fav="${p.id}" aria-label="お気に入り">${state.favs.has(p.id) ? '❤️' : '🤍'}</button></div></div>
    <div class="d-extra">
      <div class="section-title">AI・自律機能</div>
      <ul class="ai-list">${p.ai.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
      <div class="section-title">用途タグ</div>
      <div>${p.tags.map((t) => `<button class="tag" data-search="${esc(t)}" style="border:0;margin:2px">#${esc(t)}</button>`).join('')}</div>
      ${similar.length ? `<div class="section-title">同じ分類の製品</div><div class="recent-row">${similar.map((s) => `<button data-open="${s.id}">${robotSVG(s)}${esc(s.name)}</button>`).join('')}</div>` : ''}
    </div>
    <div class="d-info">
      <span class="tag">${cat.icon} ${esc(cat.name)}</span> <span class="tag ${cls}">${label}</span>
      <h2>${esc(p.name)}</h2>
      <div class="maker" style="color:var(--muted)">${esc(p.maker)}（日本）</div>
      <p>${esc(p.summary)}</p>
      <div class="price" style="font-size:22px">${priceLabel(p)}</div>
      <div class="disclaimer">${esc(p.priceHint)}・税抜・正式価格は見積で確定</div>
      <table class="specs"><tbody>${Object.entries(p.specs).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
        <tr><th>標準納期</th><td>約${p.leadWeeks}週間（目安）</td></tr></tbody></table>

      <div class="section-title">オプション</div>
      ${OPTIONS.map((o) => {
        const price = optionPrice(o, p);
        const disabled = o.priceRate && !p.price;
        return `<label class="opt"><input type="checkbox" name="opt" value="${o.id}" ${disabled ? 'disabled' : ''}/><span>${esc(o.name)}　<b>${disabled ? '見積時に算出' : yen(price)}</b><small>${esc(o.note)}</small></span></label>`;
      }).join('')}

      <div style="display:flex;align-items:center;gap:12px;margin:12px 0;flex-wrap:wrap">
        <span>数量</span><span class="qty"><button data-qty="-1" aria-label="減らす">−</button><input id="d-qty" type="number" min="1" max="99" value="1" inputmode="numeric"/><button data-qty="1" aria-label="増やす">＋</button></span>
      </div>
      <div style="display:grid;gap:8px">
        <button class="btn block" data-add="${p.id}">🛒 ${actionLabel}</button>
        <button class="btn sub block" data-buynow="${p.id}">今すぐ注文フォームへ</button>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sub sm" data-cmp-btn="${p.id}">⚖️ 比較に追加</button><button class="btn sub sm" data-share="${p.id}">🔗 共有</button><button class="btn sub sm" data-ask="${p.id}">🤖 AIに相談</button></div>
      </div>

      ${est ? `<div class="tool-box"><b>💴 リース月額シミュレーション</b>
        <label>本体価格（目安）<input id="lease-price" type="number" value="${est}" step="10000"/></label>
        <label>期間<select id="lease-years"><option value="3">3年</option><option value="5" selected>5年</option><option value="7">7年</option></select></label>
        <div class="result" id="lease-result"></div><div class="disclaimer">リース料率は一般的な目安で計算。実際はリース会社の審査・見積で決まります。</div></div>` : ''}

      ${isBiz && est ? `<div class="tool-box"><b>📈 導入効果（投資回収）計算</b>
        <label>ロボットに任せる作業 (時間/日)<input id="roi-hours" type="number" value="6" min="0" step="0.5"/></label>
        <label>人件費 (円/時)<input id="roi-wage" type="number" value="1800" min="0" step="100"/></label>
        <label>稼働日数 (日/月)<input id="roi-days" type="number" value="20" min="0"/></label>
        <div class="result" id="roi-result"></div><div class="disclaimer">設置・保守費や電気代を含まない概算です。</div></div>` : ''}

      ${isBiz ? `<div class="note-box">💡 中小企業の省力化・自動化には「中小企業省力化投資補助金」「ものづくり補助金」などが使える場合があります。注文フォームで「補助金の相談を希望」を選ぶと担当者からご案内します（採択を保証するものではありません）。</div>` : ''}
    </div></div>`);
  updateCalcs();
}

function updateCalcs() {
  const lp = $('#lease-price');
  if (lp) {
    const years = Number($('#lease-years').value);
    const rate = { 3: 0.0305, 5: 0.0188, 7: 0.0142 }[years];
    $('#lease-result').textContent = `月額 約${yen(Number(lp.value) * rate)}（${years}年・料率${(rate * 100).toFixed(2)}%）`;
  }
  const rh = $('#roi-hours');
  if (rh) {
    const p = findProduct($('[data-detail]').dataset.detail);
    const monthlySave = Number(rh.value) * Number($('#roi-wage').value) * Number($('#roi-days').value);
    const cost = Number($('#lease-price')?.value) || estimatePrice(p);
    const months = monthlySave > 0 ? cost / monthlySave : Infinity;
    $('#roi-result').textContent = monthlySave > 0
      ? `月 ${yen(monthlySave)} 削減 → 約${months < 1 ? '1か月未満' : Math.ceil(months) + 'か月'}で回収（${(months / 12).toFixed(1)}年）`
      : '作業時間と人件費を入力してください';
  }
}

// ───────── カート ─────────
function addToCart(id, qty = 1, options = []) {
  const p = findProduct(id);
  if (!p) return;
  const plan = p.availability === 'rental' && p.monthly ? 'rental' : 'buy';
  const key = id + '|' + [...options].sort().join(',');
  const found = state.cart.find((i) => i.id + '|' + [...i.options].sort().join(',') === key);
  if (found) found.qty = Math.min(99, found.qty + qty);
  else state.cart.push({ id, qty, options, plan });
  renderBadges();
  save();
  toast(`「${p.name}」をカートに追加しました`);
}

function totalsHTML(t) {
  return `<table class="sum-table"><tbody>
    <tr><td>小計（本体・オプション）</td><td>${yen(t.subtotal)}</td></tr>
    <tr><td>送料${t.subtotal >= FREE_SHIPPING_LINE ? '（10万円以上で無料）' : ''}</td><td>${yen(t.shipping)}</td></tr>
    <tr><td>消費税（10%）</td><td>${yen(t.tax)}</td></tr>
    <tr class="total"><td>お支払い合計（税込）</td><td>${yen(t.total)}</td></tr>
    ${t.monthly ? `<tr><td>＋ 月額レンタル（税込）</td><td>${yen(t.monthlyTotal)}/月</td></tr>` : ''}
    </tbody></table>
    ${t.quoteCount ? `<div class="note-box">「要見積」の製品が ${t.quoteCount} 件あります。発注後、メーカー・販売店から正式見積をお送りし、ご承認後に購入が確定します。</div>` : ''}`;
}

function openCart() {
  const t = calcTotals(state.cart);
  const lines = state.cart.map((item, idx) => {
    const p = findProduct(item.id);
    const line = calcTotals([item]).lines[0];
    const opts = OPTIONS.filter((o) => item.options.includes(o.id)).map((o) => o.name).join('・');
    const price = item.plan === 'rental' ? `月額 ${yen(p.monthly * item.qty)}` : p.price ? yen(line?.lineTotal || 0) : '要見積';
    return `<div class="line-item"><div class="thumb">${robotSVG(p)}</div><div>
      <div class="nm">${esc(p.name)}</div><div class="meta">${esc(p.maker)}${opts ? '／' + esc(opts) : ''}</div>
      <div class="ctrl"><span class="qty"><button data-cq="${idx}" data-d="-1">−</button><input value="${item.qty}" readonly aria-label="数量"/><button data-cq="${idx}" data-d="1">＋</button></span>
      <b>${price}</b><button class="btn ghost sm" data-rm="${idx}">削除</button></div></div></div>`;
  }).join('');
  openDrawer(`<h2>🛒 カート</h2><div class="inner">
    ${state.cart.length ? lines + totalsHTML(t) + `<button class="btn block" id="go-checkout">注文フォームへ進む</button>
      <div style="display:flex;gap:8px;margin-top:8px"><button class="btn sub sm" id="print-quote">🖨️ 見積書を印刷</button><button class="btn ghost sm" id="clear-cart">カートを空にする</button></div>`
      : '<p class="empty">カートは空です。気になるロボットを選んでください。</p>'}</div>`);
}

// ───────── 注文フロー（カート確認 → 注文フォーム → 発注 → 購入完了）─────────
const STEPS = ['カート確認', '注文フォーム', '確認・発注', '購入完了'];
// 個人情報はこの変数（メモリ）にだけ置き、保存しない。送信後すぐ消す
let piiDraft = {};
// 個人情報以外の入力（下書き保存OK）
let orderDraft = store.get('orderDraft', { customerType: 'business', company: '', department: '', site: 'factory', deliveryDate: '', payment: 'invoice', subsidy: false, note: '' });

function stepper(n) {
  return `<ol class="stepper">${STEPS.map((s, i) => `<li class="${i < n ? 'done' : i === n ? 'on' : ''}">${i + 1}. ${s}</li>`).join('')}</ol>`;
}

function checkoutStep1() {
  if (!state.cart.length) return toast('カートが空です');
  const t = calcTotals(state.cart);
  openModal(`<div class="checkout">${stepper(0)}<h2>カートの内容</h2>
    ${t.lines.map((l) => `<div class="list-row">${robotSVG(findProduct(l.id))}<div style="flex:1"><b>${esc(l.name)}</b> × ${l.qty}<div class="meta" style="font-size:12px;color:var(--muted)">${esc(l.maker)}・${l.plan === 'rental' ? 'レンタル' : l.needsQuote ? '要見積' : '購入'}</div></div><b>${l.plan === 'rental' ? yen(l.unitMonthly * l.qty) + '/月' : l.needsQuote ? '見積' : yen(l.lineTotal)}</b></div>`).join('')}
    ${totalsHTML(t)}
    <div class="actions"><button class="btn sub" data-close>買い物を続ける</button><button class="btn" id="to-step2">注文フォームへ</button></div></div>`);
}

function field(name, label, opts = {}) {
  const v = opts.pii ? piiDraft[name] || '' : orderDraft[name] || '';
  return `<div class="field ${opts.full ? 'full' : ''}" data-field="${name}"><label for="f-${name}">${label}${opts.req ? '<span class="req">必須</span>' : ''}</label>
    <input id="f-${name}" name="${name}" type="${opts.type || 'text'}" value="${esc(v)}" ${opts.ph ? `placeholder="${esc(opts.ph)}"` : ''} ${opts.ac ? `autocomplete="${opts.ac}"` : ''} ${opts.pii ? 'data-pii' : ''} ${opts.min ? `min="${opts.min}"` : ''}/>
    <span class="err"></span></div>`;
}

function checkoutStep2() {
  const minDate = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const radio = (name, items) => `<div class="radio-row">${items.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}" ${orderDraft[name] === v ? 'checked' : ''}/>${l}</label>`).join('')}</div>`;
  openModal(`<div class="checkout">${stepper(1)}<h2>注文フォーム</h2>
    <form id="order-form" novalidate><div class="form-grid">
      <div class="field full"><label>ご購入区分</label>${radio('customerType', [['business', '法人・事業者'], ['personal', '個人']])}</div>
      ${field('company', '会社・団体名', { ph: '例: 株式会社〇〇製作所' })}
      ${field('department', '部署名', { ph: '例: 生産技術部' })}
      ${field('name', 'ご担当者名', { req: true, pii: true, ac: 'name', ph: '例: 山田 太郎' })}
      ${field('email', 'メールアドレス', { req: true, pii: true, type: 'email', ac: 'email', ph: '例: taro@example.com' })}
      ${field('phone', '電話番号', { req: true, pii: true, type: 'tel', ac: 'tel', ph: '例: 03-1234-5678' })}
      ${field('postal', '郵便番号', { req: true, pii: true, ac: 'postal-code', ph: '例: 100-0005' })}
      ${field('address', '設置先住所', { req: true, pii: true, full: true, ac: 'street-address', ph: '例: 東京都千代田区丸の内1-1-1' })}
      <div class="field"><label for="f-site">設置場所</label><select id="f-site" name="site">
        ${[['factory', '工場'], ['indoor', '屋内（店舗・オフィス・倉庫）'], ['hospital', '病院・介護施設'], ['farm', '農地'], ['outdoor', '屋外・現場'], ['other', '家庭・その他']].map(([v, l]) => `<option value="${v}" ${orderDraft.site === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${field('deliveryDate', '希望納期', { type: 'date', min: minDate })}
      <div class="field full"><label>お支払い方法</label>${radio('payment', [['invoice', '請求書払い（法人）'], ['bank', '銀行振込'], ['lease', 'リース・分割の相談'], ['card', 'クレジットカード（後日決済リンク）']])}</div>
      <div class="field full"><label><input type="checkbox" name="subsidy" ${orderDraft.subsidy ? 'checked' : ''}/> 補助金・助成金の活用について相談したい</label></div>
      <div class="field full"><label for="f-note">ご要望・備考</label><textarea id="f-note" name="note" rows="3" placeholder="搬入経路、既存設備との連携、デモ希望など（個人情報は書かないでください）">${esc(orderDraft.note)}</textarea></div>
    </div>
    <div class="pii-note">🔒 お名前・メール・電話・住所は、送信後にサーバーで <b>PII Shield</b> により暗号化・伏せ字化されます。このブラウザには保存されません（会社名などそれ以外の入力だけ下書き保存されます）。カード番号はこのフォームでは受け付けません。</div>
    <div class="actions"><button type="button" class="btn sub" id="back-step1">戻る</button><button type="submit" class="btn">確認画面へ</button></div></form></div>`);
}

function readForm() {
  const f = $('#order-form');
  const fd = new FormData(f);
  piiDraft = { name: fd.get('name').trim(), email: fd.get('email').trim(), phone: fd.get('phone').trim(), postal: fd.get('postal').trim(), address: fd.get('address').trim() };
  orderDraft = {
    customerType: fd.get('customerType') || 'business', company: fd.get('company').trim(), department: fd.get('department').trim(),
    site: fd.get('site'), deliveryDate: fd.get('deliveryDate'), payment: fd.get('payment') || 'invoice', subsidy: fd.get('subsidy') === 'on', note: fd.get('note').trim(),
  };
  store.set('orderDraft', orderDraft); // 個人情報を含まない
}

function validateForm() {
  const e = {};
  const p = piiDraft;
  if (!p.name) e.name = 'ご担当者名を入力してください';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) e.email = 'メールアドレスの形式が正しくありません';
  if (!/^[0-9０-９\-－+ ]{10,15}$/.test(p.phone)) e.phone = '電話番号を正しく入力してください（ハイフン可）';
  if (!/^\d{3}-?\d{4}$/.test(p.postal)) e.postal = '郵便番号は 123-4567 の形式で入力してください';
  if (p.address.length < 5) e.address = '住所を入力してください';
  if (orderDraft.customerType === 'business' && !orderDraft.company) e.company = '法人の場合は会社名を入力してください';
  return e;
}

function showErrors(errors) {
  $$('#order-form .field[data-field]').forEach((el) => {
    const msg = errors[el.dataset.field] || '';
    el.classList.toggle('invalid', Boolean(msg));
    el.querySelector('.err').textContent = msg;
  });
  const first = Object.keys(errors)[0];
  if (first) $(`#f-${first}`)?.focus();
}

const PAY = { invoice: '請求書払い', bank: '銀行振込', lease: 'リース・分割の相談', card: 'クレジットカード（後日決済リンク）' };
const SITE = { factory: '工場', indoor: '屋内', hospital: '病院・介護施設', farm: '農地', outdoor: '屋外・現場', other: '家庭・その他' };

function checkoutStep3() {
  const t = calcTotals(state.cart);
  const p = piiDraft;
  const o = orderDraft;
  openModal(`<div class="checkout">${stepper(2)}<h2>ご注文内容の確認</h2>
    <dl class="confirm-list">
      <dt>ご購入区分</dt><dd>${o.customerType === 'business' ? '法人・事業者' : '個人'}${o.company ? '／' + esc(o.company) : ''}${o.department ? '　' + esc(o.department) : ''}</dd>
      <dt>ご担当者</dt><dd>${esc(p.name)}</dd>
      <dt>連絡先</dt><dd>${esc(p.email)}／${esc(p.phone)}</dd>
      <dt>設置先</dt><dd>〒${esc(p.postal)} ${esc(p.address)}（${SITE[o.site]}）</dd>
      <dt>希望納期</dt><dd>${o.deliveryDate || '指定なし（最短）'}</dd>
      <dt>お支払い方法</dt><dd>${PAY[o.payment]}${o.subsidy ? '／補助金の相談あり' : ''}</dd>
      ${o.note ? `<dt>ご要望</dt><dd>${esc(o.note)}</dd>` : ''}
    </dl>
    ${t.lines.map((l) => `<div class="list-row">${robotSVG(findProduct(l.id))}<div style="flex:1"><b>${esc(l.name)}</b> × ${l.qty}</div><b>${l.plan === 'rental' ? yen(l.unitMonthly * l.qty) + '/月' : l.needsQuote ? '見積' : yen(l.lineTotal)}</b></div>`).join('')}
    ${totalsHTML(t)}
    <label style="display:flex;gap:8px;font-size:13px;margin:10px 0"><input type="checkbox" id="agree"/> 価格は目安であり、正式見積・在庫確認後に確定することに同意します</label>
    <div class="actions"><button class="btn sub" id="back-step2">修正する</button><button class="btn" id="place-order" disabled>この内容で発注する</button></div>
    <p class="disclaimer" id="order-msg"></p></div>`);
}

async function placeOrder() {
  const btn = $('#place-order');
  btn.disabled = true;
  btn.textContent = '発注処理中…';
  try {
    const res = await fetch('/api/robot-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: state.cart, customer: piiDraft, order: orderDraft }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.fields) { checkoutStep2(); showErrors(data.fields); }
      throw new Error(data.error || `サーバーエラー（${res.status}）`);
    }
    // 保存するのはサーバーが返したマスク済みの値だけ
    state.orders.unshift({
      orderId: data.orderId, createdAt: data.createdAt, status: data.status, protection: data.protection,
      customer: data.customer, company: orderDraft.company, payment: orderDraft.payment,
      items: state.cart.map((i) => ({ ...i })), totals: data.totals, leadWeeks: data.estimatedLeadWeeks,
    });
    piiDraft = {}; // 個人情報をメモリからも消す
    state.cart = [];
    save();
    renderBadges();
    checkoutDone(state.orders[0]);
  } catch (err) {
    const msg = $('#order-msg');
    if (msg) msg.textContent = '⚠ ' + (err.message === 'Failed to fetch' ? 'サーバーに接続できませんでした。通信環境を確認してもう一度お試しください。' : err.message);
    if ($('#place-order')) { $('#place-order').disabled = false; $('#place-order').textContent = 'この内容で発注する'; }
  }
}

function timeline(order) {
  const start = new Date(order.createdAt).getTime();
  const wk = 7 * 864e5;
  const quote = order.status === 'quote';
  const steps = [
    ['注文受付', start],
    [quote ? 'メーカー・販売店へ見積依頼 → 正式見積のご承認' : 'メーカーへ発注', start + 2 * 864e5],
    ['生産・出荷準備', start + Math.max(1, order.leadWeeks - 2) * wk],
    ['配送', start + Math.max(1, order.leadWeeks - 0.5) * wk],
    ['設置・稼働開始（購入完了）', start + order.leadWeeks * wk],
  ];
  if (order.status === 'cancel-requested') steps.push(['キャンセル申請を受付', Date.now()]);
  const now = Date.now();
  const cur = steps.findLastIndex(([, t]) => t <= now);
  return `<ul class="timeline">${steps.map(([s, t], i) => `<li class="${i < cur ? 'done' : i === cur ? 'now' : ''}">${s}<br><small>${i === 0 ? '' : i <= cur ? '' : '予定 '}${new Date(t).toLocaleDateString('ja-JP')}</small></li>`).join('')}</ul>`;
}

function checkoutDone(order) {
  const c = order.customer;
  openModal(`<div class="checkout">${stepper(3)}<div class="done-hero"><div class="big">🎉</div><h2>ご注文ありがとうございます</h2>
    <p>注文番号 <b style="font-family:monospace">${esc(order.orderId)}</b></p></div>
    <div class="${order.protection === 'encrypted' ? 'ok-box' : 'note-box'}">🔒 ${order.protection === 'encrypted' ? 'お客様の個人情報は PII Shield で暗号化して受け付けました。' : 'お客様の個人情報は PII Shield で伏せ字化して受け付けました（このプレビュー環境ではサーバーに保存していません）。'}
      表示・保存されるのは伏せ字の情報だけです：${esc(c.name)} 様／${esc(c.email)}／電話 ${esc(c.phone)}／${esc(c.address)}</div>
    <p>${order.status === 'quote' ? '要見積の製品が含まれるため、まず正式見積をお送りします。ご承認後に発注・購入が確定します。' : 'メーカーへ発注します。確認メールをお送りします。'}</p>
    ${timeline(order)}
    ${totalsHTML(order.totals)}
    <div class="actions"><button class="btn sub" data-print-order="${esc(order.orderId)}">🖨️ 注文書を印刷</button><button class="btn" data-close>トップへ戻る</button></div></div>`);
}

// ───────── 注文履歴・お気に入り・比較 ─────────
function openOrders() {
  openDrawer(`<h2>📋 注文履歴</h2><div class="inner">
    <p class="disclaimer">このブラウザに保存されているのは伏せ字化された情報だけです。</p>
    ${state.orders.length ? state.orders.map((o) => `<div class="order-card"><div class="id">${esc(o.orderId)}</div>
      <div>${new Date(o.createdAt).toLocaleString('ja-JP')}　${o.status === 'quote' ? '<span class="tag quote">見積待ち</span>' : o.status === 'cancel-requested' ? '<span class="tag">キャンセル申請中</span>' : '<span class="tag buy">発注済み</span>'}</div>
      <div>${o.items.map((i) => esc(findProduct(i.id)?.name) + ' ×' + i.qty).join('、')}</div>
      <div>合計 <b>${yen(o.totals.total)}</b>${o.totals.monthly ? `＋${yen(o.totals.monthlyTotal)}/月` : ''}　ご担当: ${esc(o.customer.name)} 様</div>
      <details><summary>配送状況を見る</summary>${timeline(o)}</details>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"><button class="btn sub sm" data-reorder="${esc(o.orderId)}">🔁 もう一度注文</button><button class="btn sub sm" data-print-order="${esc(o.orderId)}">🖨️ 注文書</button>
      ${o.status !== 'cancel-requested' ? `<button class="btn ghost sm" data-cancel="${esc(o.orderId)}">キャンセル申請</button>` : ''}</div></div>`).join('')
      : '<p class="empty">まだ注文はありません。</p>'}</div>`);
}

function openFavs() {
  const items = [...state.favs].map(findProduct).filter(Boolean);
  openDrawer(`<h2>♡ お気に入り</h2><div class="inner">${items.length ? items.map((p) => `<div class="list-row">${robotSVG(p)}<div style="flex:1"><button class="btn ghost" data-open="${p.id}" style="padding:0;text-align:left">${esc(p.name)}</button><div style="font-size:12px;color:var(--muted)">${esc(p.maker)}・${priceLabel(p)}</div></div><button class="btn sm" data-add-quick="${p.id}">カートへ</button></div>`).join('')
    + `<button class="btn sub block" style="margin-top:12px" id="fav-compare">お気に入りを比較する（最大3件）</button>` : '<p class="empty">♡ を押すとここに保存されます。</p>'}</div>`);
}

function toggleCompare(id) {
  if (state.compare.includes(id)) state.compare = state.compare.filter((x) => x !== id);
  else if (state.compare.length >= 3) { toast('比較は3製品までです'); return false; }
  else state.compare.push(id);
  renderBadges();
  $$(`[data-cmp="${id}"]`).forEach((el) => { el.checked = state.compare.includes(id); });
  return true;
}

function openCompare(ids = state.compare) {
  const ps = ids.map(findProduct).filter(Boolean);
  if (ps.length < 2) return toast('2つ以上選んでください');
  const keys = [...new Set(ps.flatMap((p) => Object.keys(p.specs)))];
  const row = (label, fn) => `<tr><th>${label}</th>${ps.map((p) => `<td>${fn(p)}</td>`).join('')}</tr>`;
  openModal(`<div class="checkout"><h2>⚖️ 製品比較</h2><div class="scroll-x"><table class="compare-table">
    <thead><tr><th></th>${ps.map((p) => `<th>${robotSVG(p)}<br>${esc(p.name)}<br><small style="color:var(--muted)">${esc(p.maker)}</small></th>`).join('')}</tr></thead><tbody>
    ${row('分類', (p) => esc(CATEGORIES.find((c) => c.id === p.category).name))}
    ${row('価格', (p) => priceLabel(p))}
    ${row('販売形態', (p) => AVAIL[p.availability][1])}
    ${row('納期', (p) => `約${p.leadWeeks}週`)}
    ${keys.map((k) => row(esc(k), (p) => esc(p.specs[k] ?? '—'))).join('')}
    ${row('AI機能', (p) => p.ai.map(esc).join('<br>'))}
    ${row('', (p) => `<button class="btn sm" data-add-quick="${p.id}">カートへ</button>`)}
    </tbody></table></div></div>`);
}

// 見積書・注文書の印刷
function printDoc(title, items, totals, extra = '') {
  const t = totals || calcTotals(items);
  $('#print-area').innerHTML = `<h1>${title}</h1><p>発行日: ${new Date().toLocaleDateString('ja-JP')}　ロボマルシェ（日本製フィジカルAIロボット）</p>${extra}
    <table><thead><tr><th>製品</th><th>メーカー</th><th>数量</th><th>形態</th><th>金額</th></tr></thead><tbody>
    ${t.lines.map((l) => `<tr><td>${esc(l.name)}${l.options.length ? '<br><small>' + l.options.map((o) => OPTIONS.find((x) => x.id === o).name).join('・') + '</small>' : ''}</td><td>${esc(l.maker)}</td><td>${l.qty}</td><td>${l.plan === 'rental' ? 'レンタル' : l.needsQuote ? '要見積' : '購入'}</td><td>${l.plan === 'rental' ? yen(l.unitMonthly * l.qty) + '/月' : l.needsQuote ? '別途見積' : yen(l.lineTotal)}</td></tr>`).join('')}
    </tbody></table><p>小計 ${yen(t.subtotal)}　送料 ${yen(t.shipping)}　消費税 ${yen(t.tax)}　<b>合計 ${yen(t.total)}</b>${t.monthly ? `　＋月額 ${yen(t.monthlyTotal)}` : ''}</p>
    <p style="font-size:11px">※ 価格は目安です。正式な価格・納期はメーカー/販売店の見積により確定します。</p>`;
  window.print();
}

// ───────── AIコンシェルジュ（ブラウザ内で動くルールベースのエージェント）─────────
const INTENTS = [
  { cats: ['industrial', 'cobot'], words: ['工場', '製造', '組立', '組み立て', '溶接', '加工', 'ライン', 'ピッキング', 'アーム'] },
  { cats: ['cobot'], words: ['協働', '人の隣', '人と一緒', '安全柵', '柵なし', '初めて', '初心者'] },
  { cats: ['logistics'], words: ['倉庫', '物流', '搬送', '運ぶ', '運搬', '荷物', '荷降ろし', '台車', 'amr', 'agv'] },
  { cats: ['service'], words: ['接客', '店舗', '宅配', '配送', '配達', '小売', 'コンビニ', '受付', 'アバター', '遠隔'] },
  { cats: ['food'], words: ['料理', '調理', '厨房', '飲食', 'レストラン', 'カフェ', 'コーヒー', '寿司', 'そば', 'パスタ'] },
  { cats: ['care'], words: ['介護', '医療', '病院', '手術', 'リハビリ', '腰', 'アシスト', '高齢者施設', '移乗'] },
  { cats: ['agri'], words: ['農業', '農家', '畑', '田んぼ', '田植え', '収穫', 'トラクタ', 'トラクター', '稲'] },
  { cats: ['construction'], words: ['建設', '工事', '現場', '鉱山', '鉄筋', 'ダンプ'] },
  { cats: ['drone'], words: ['ドローン', '空撮', '飛行', '点検', '測量'] },
  { cats: ['security'], words: ['警備', '防犯', '巡回', '清掃', '床'] },
  { cats: ['home'], words: ['家', '家庭', '自宅', 'ペット', '癒し', '見守り', '一人暮らし', '会話', '話し相手', '掃除', '家事', '片付け', 'プレゼント', '犬'] },
  { cats: ['education'], words: ['教育', '学習', 'プログラミング', '子ども', '子供', '研究', '大学', 'ヒューマノイド', '人型', 'キット'] },
];

function parseBudget(text) {
  const t = text.replace(/,/g, '').replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  let m = t.match(/(\d+(?:\.\d+)?)\s*億/);
  if (m) return Number(m[1]) * 1e8;
  m = t.match(/(\d+(?:\.\d+)?)\s*千万/);
  if (m) return Number(m[1]) * 1e7;
  m = t.match(/(\d+(?:\.\d+)?)\s*万/);
  if (m) return Number(m[1]) * 1e4;
  m = t.match(/(\d{4,})\s*円/);
  if (m) return Number(m[1]);
  return 0;
}

function recommend(text) {
  const t = text.toLowerCase();
  const cats = new Set();
  INTENTS.forEach((it) => { if (it.words.some((w) => t.includes(w))) it.cats.forEach((c) => cats.add(c)); });
  const budget = parseBudget(text);
  const wantRental = /レンタル|月額|サブスク|リース|借り/.test(text);
  const wantFast = /すぐ|急ぎ|即納|早く|納期/.test(text);
  const wantCheap = /安い|安く|低価格|手頃|お手頃/.test(text);
  const scored = PRODUCTS.map((p) => {
    let s = 0;
    if (cats.has(p.category)) s += 5;
    const hay = [p.name, p.maker, p.summary, ...p.tags, ...p.ai].join(' ').toLowerCase();
    t.split(/[\s、。,.!?！？]+/).filter((w) => w.length >= 2).forEach((w) => { if (hay.includes(w)) s += 2; });
    p.tags.forEach((tag) => { if (t.includes(tag.toLowerCase())) s += 3; });
    if (t.includes(p.maker.toLowerCase().replace(/（.*?）/, ''))) s += 6;
    const v = p.price || estimatePrice(p) || (p.monthly ? p.monthly * 12 : 0);
    if (budget) { if (v && v <= budget) s += 3; else s -= 6; }
    if (wantRental && p.availability === 'rental') s += 3;
    if (wantFast) s += Math.max(0, 4 - p.leadWeeks / 3);
    if (wantCheap && v) s += Math.max(0, 3 - Math.log10(v) / 2);
    return { p, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  return { list: scored.slice(0, 4).map((x) => x.p), cats: [...cats], budget, wantRental };
}

function botSay(text, recs = [], actions = []) {
  const div = document.createElement('div');
  div.className = 'msg bot';
  div.innerHTML = esc(text) +
    (recs.length ? `<div class="recs">${recs.map((p) => `<button class="rec" data-open="${p.id}">${robotSVG(p)}<span><span class="t">${esc(p.name)}</span><br><span class="s">${esc(p.maker)}・${priceLabel(p).replace(/<[^>]+>/g, '')}</span></span></button>`).join('')}</div>` : '') +
    (actions.length ? `<div class="quick" style="padding:8px 0 0;background:none">${actions.map(([l, cmd]) => `<button data-chat="${esc(cmd)}">${esc(l)}</button>`).join('')}</div>` : '');
  $('#chat-log').appendChild(div);
  $('#chat-log').scrollTop = 1e9;
}
function meSay(text) {
  const div = document.createElement('div');
  div.className = 'msg me';
  div.textContent = text;
  $('#chat-log').appendChild(div);
}

function agent(input) {
  const text = input.trim();
  if (!text) return;
  // 個人情報らしきものが入力されたら注意（チャット内容はどこにも送信・保存しない）
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(text) || /0\d{1,4}-?\d{1,4}-?\d{3,4}/.test(text)) {
    meSay(text.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '＊＊＊').replace(/0\d{1,4}-?\d{1,4}-?\d{3,4}/g, '＊＊＊'));
    return botSay('個人情報（メールアドレス・電話番号など）はチャットに入力しないでください。ご連絡先は注文フォームで安全に（暗号化して）お預かりします。');
  }
  meSay(text);

  // 操作系のコマンド
  if (/カート.*(見|確認|開)|^カート$/.test(text)) { botSay('カートを開きます。'); return openCart(); }
  if (/履歴|注文状況|配送状況/.test(text)) { botSay('注文履歴を開きます。配送状況もここで確認できます。'); return openOrders(); }
  if (/(注文|購入|発注|買う|レジ)(したい|する|へ|に進)/.test(text) || text === '注文') {
    if (!state.cart.length) return botSay('カートがまだ空です。まずロボットを選びましょう。どんな用途でお探しですか？', [], [['工場向け', '工場で使えるロボット'], ['家庭向け', '家で使える癒し系ロボット']]);
    botSay('注文フォームへご案内します。'); return checkoutStep1();
  }
  if (/比較/.test(text)) {
    const ids = (state.compare.length >= 2 ? state.compare : state.lastRecs.slice(0, 3));
    if (ids.length >= 2) { botSay('比較表を開きます。'); return openCompare(ids); }
    return botSay('比較する製品がまだありません。先におすすめを聞いてください。');
  }
  const addMatch = text.match(/(.+?)を?(カートに|カートへ)(入れ|追加)/);
  if (addMatch || /^(1|１|一)?(番目)?.*(入れて|追加して)$/.test(text)) {
    const target = addMatch ? addMatch[1].replace(/(それ|これ|1番目|一番目|１番目)/, '') : '';
    const p = target ? PRODUCTS.find((x) => text.includes(x.name) || x.name.includes(target.trim())) : findProduct(state.lastRecs[0]);
    const pick = p || findProduct(state.lastRecs[0]);
    if (pick) { addToCart(pick.id); return botSay(`「${pick.name}」をカートに入れました。`, [], [['カートを見る', 'カートを見る'], ['注文へ進む', '注文へ進む']]); }
  }
  if (/補助金|助成金/.test(text)) {
    return botSay('ロボット導入では「中小企業省力化投資補助金」「ものづくり補助金」「IT導入補助金」などが活用できる場合があります。要件や公募時期は年度で変わるため、注文フォームで「補助金の相談を希望」にチェックすると担当者がご案内します（採択の保証はできません）。');
  }
  if (/使い方|ヘルプ|何ができ/.test(text)) return greet();

  // おすすめ
  const r = recommend(text);
  if (!r.list.length) {
    return botSay('ぴったりの製品が見つかりませんでした。「どこで」「何をさせたいか」「予算」を教えてください。\n例：「倉庫で荷物を運びたい 月額で」「500万円以下の協働ロボット」', [], [['工場', '工場の組立を自動化したい'], ['介護', '介護の負担を減らしたい'], ['農業', '農作業を自動化したい'], ['家庭', '家族の見守りができるロボット']]);
  }
  state.lastRecs = r.list.map((p) => p.id);
  const catNames = r.cats.map((c) => CATEGORIES.find((x) => x.id === c).name).join('・');
  const cond = [catNames && `分類「${catNames}」`, r.budget && `予算 ${yen(r.budget)} 以内`, r.wantRental && 'レンタル/月額'].filter(Boolean).join('、');
  botSay(`${cond ? cond + 'で' : 'ご要望から'}おすすめを${r.list.length}件選びました。タップすると詳細を見られます。`, r.list,
    [['上の3つを比較', '比較して'], ['1番目をカートへ', '1番目をカートに入れて'], ['補助金について', '補助金について教えて']]);
  if (r.cats.length === 1) { state.cat = r.cats[0]; renderAll(); }
}

function greet() {
  botSay('こんにちは！日本製フィジカルAIロボットのコンシェルジュです。\n用途・場所・予算を話しかけてください。おすすめ・比較・カート追加・注文まで手伝います。\n（チャット内容は保存しません。個人情報は入力しないでください）');
  $('#quick').innerHTML = ['工場の組立を自動化したい', '倉庫で荷物を運びたい 月額で', '介護スタッフの腰の負担を減らしたい', '30万円以下で家族の見守り', '子どものプログラミング学習', '比較して', 'カートを見る']
    .map((q) => `<button data-chat="${esc(q)}">${esc(q)}</button>`).join('');
}

// ───────── イベント ─────────
document.addEventListener('click', (e) => {
  const el = e.target.closest('button, [data-open], input[type=checkbox]');
  if (!el) {
    if (e.target === $('#overlay')) closeAll();
    return;
  }
  const d = el.dataset;
  if (d.cat) { state.cat = d.cat; renderAll(); return; }
  if (d.avail) { state.avail = d.avail; $$('[data-avail]').forEach((b) => b.setAttribute('aria-pressed', b === el)); renderGrid(); return; }
  if (d.open) { openDetail(d.open); return; }
  if (d.fav) {
    state.favs.has(d.fav) ? state.favs.delete(d.fav) : state.favs.add(d.fav);
    $$(`[data-fav="${d.fav}"]`).forEach((b) => { b.textContent = state.favs.has(d.fav) ? '❤️' : '🤍'; });
    renderBadges(); save();
    toast(state.favs.has(d.fav) ? 'お気に入りに追加しました' : 'お気に入りから外しました');
    return;
  }
  if (d.cmp) { if (!toggleCompare(d.cmp)) el.checked = false; return; }
  if (d.cmpBtn) { if (toggleCompare(d.cmpBtn)) toast(state.compare.includes(d.cmpBtn) ? '比較リストに追加しました' : '比較リストから外しました'); return; }
  if (d.close !== undefined) { closeAll(); return; }
  if (d.qty) { const q = $('#d-qty'); q.value = Math.max(1, Math.min(99, Number(q.value) + Number(d.qty))); return; }
  if (d.add || d.buynow) {
    const id = d.add || d.buynow;
    const opts = $$('input[name=opt]:checked').map((x) => x.value);
    addToCart(id, Math.max(1, Math.min(99, Number($('#d-qty').value) || 1)), opts);
    if (d.buynow) checkoutStep1();
    return;
  }
  if (d.addQuick) { addToCart(d.addQuick); return; }
  if (d.share) {
    const url = location.origin + location.pathname + '#p=' + d.share;
    if (navigator.share) navigator.share({ title: findProduct(d.share).name, url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => toast('リンクをコピーしました'), () => toast(url));
    return;
  }
  if (d.ask) { openChat(); agent(`${findProduct(d.ask).name}に似た製品`); return; }
  if (d.search) { closeAll(); $('#q').value = d.search; state.q = d.search; state.cat = 'all'; renderAll(); window.scrollTo({ top: $('#cats').offsetTop - 70, behavior: 'smooth' }); return; }
  if (d.cq) { const it = state.cart[d.cq]; it.qty = Math.max(1, Math.min(99, it.qty + Number(d.d))); save(); renderBadges(); openCart(); return; }
  if (d.rm) { state.cart.splice(Number(d.rm), 1); save(); renderBadges(); openCart(); return; }
  if (d.chat) { agent(d.chat); return; }
  if (d.reorder) { const o = state.orders.find((x) => x.orderId === d.reorder); o.items.forEach((i) => addToCart(i.id, i.qty, i.options)); openCart(); return; }
  if (d.cancel) {
    if (!confirm('この注文のキャンセルを申請しますか？（製品によってはキャンセル料がかかります）')) return;
    const o = state.orders.find((x) => x.orderId === d.cancel); o.status = 'cancel-requested'; save(); openOrders(); toast('キャンセル申請を受け付けました'); return;
  }
  if (d.printOrder) {
    const o = state.orders.find((x) => x.orderId === d.printOrder);
    printDoc('注文書', o.items, o.totals, `<p>注文番号: ${esc(o.orderId)}　${o.company ? esc(o.company) + '　' : ''}${esc(o.customer.name)} 様</p>`);
    return;
  }

  switch (el.id) {
    case 'btn-cart': openCart(); break;
    case 'btn-favs': openFavs(); break;
    case 'btn-orders': openOrders(); break;
    case 'btn-theme': {
      const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next; store.set('theme', next); break;
    }
    case 'go-checkout': checkoutStep1(); break;
    case 'clear-cart': if (confirm('カートを空にしますか？')) { state.cart = []; save(); renderBadges(); openCart(); } break;
    case 'print-quote': printDoc('御見積書（概算）', state.cart); break;
    case 'to-step2': checkoutStep2(); break;
    case 'back-step1': readForm(); checkoutStep1(); break;
    case 'back-step2': checkoutStep2(); break;
    case 'place-order': placeOrder(); break;
    case 'agree': $('#place-order').disabled = !el.checked; break;
    case 'compare-open': openCompare(); break;
    case 'compare-clear': state.compare = []; $$('[data-cmp]').forEach((c) => { c.checked = false; }); renderBadges(); break;
    case 'fav-compare': openCompare([...state.favs].slice(0, 3)); break;
    case 'fab': openChat(); break;
    case 'chat-close': $('#chat').classList.remove('open'); $('#fab').hidden = false; break;
    case 'home-link': break;
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'order-form') {
    e.preventDefault();
    readForm();
    const errors = validateForm();
    if (Object.keys(errors).length) return showErrors(errors);
    checkoutStep3();
  }
  if (e.target.id === 'chat-form') {
    e.preventDefault();
    const v = $('#chat-text').value;
    $('#chat-text').value = '';
    agent(v);
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { state.q = e.target.value; renderGrid(); }
  if (['lease-price', 'lease-years', 'roi-hours', 'roi-wage', 'roi-days'].includes(e.target.id)) updateCalcs();
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'budget') { state.budget = Number(e.target.value); renderGrid(); }
  if (e.target.id === 'sort') { state.sort = e.target.value; renderGrid(); }
  if (e.target.id === 'lease-years') updateCalcs();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
$('#home-link').addEventListener('click', (e) => { e.preventDefault(); state.cat = 'all'; state.q = ''; $('#q').value = ''; closeAll(); renderAll(); window.scrollTo({ top: 0, behavior: 'smooth' }); });

function openChat() {
  $('#chat').classList.add('open');
  $('#fab').hidden = true;
  if (!$('#chat-log').children.length) greet();
  $('#chat-text').focus();
}

// ───────── 起動 ─────────
const savedTheme = store.get('theme', null);
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
renderStats();
renderAll();
const m = location.hash.match(/^#p=([\w-]+)/);
if (m && findProduct(m[1])) openDetail(m[1]);
