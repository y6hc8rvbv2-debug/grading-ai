// マンション管理エージェント 本体
// データは端末内だけに保存（AES-GCMで暗号化）。サーバーには送らない。
'use strict';
(function () {
  const VAULT_KEY = 'ma_vault_v1';
  const LOCK_KEY = 'ma_lock_v1';
  const KDF_ITER = 310000;
  const IDLE_MS = 15 * 60 * 1000;
  const enc = new TextEncoder(), dec = new TextDecoder();

  let state = null;     // 復号したデータ
  let dataKey = null;   // CryptoKey
  let role = null;      // 'admin' | 'viewer'
  let tab = 'home';
  let idleTimer = null;
  let ui = { ym: '', docType: 'tokusoku', docOut: '', payslipFor: '', empEdit: '' };

  // ---------- 小道具 ----------
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yen = (v) => (Math.round(Number(v) || 0)).toLocaleString('ja-JP') + '円';
  const man = (v) => (Math.round((Number(v) || 0) / 10000)).toLocaleString('ja-JP') + '万円';
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const daysUntil = (s) => Math.round((new Date(s + 'T00:00:00') - today()) / 86400000);
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
  const uid = () => 'x' + b64(rnd(6)).replace(/[^a-zA-Z0-9]/g, '');
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };

  function toast(msg, kind = '') {
    const t = $('#toast');
    t.textContent = msg; t.className = 'toast show ' + kind;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = 'toast'), 3500);
  }

  // ---------- 個人情報ガード（入力チェック） ----------
  function piiCheck(text) {
    const s = String(text || '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    if (/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/.test(s)) return 'マイナンバー（12桁）や口座番号のような数字';
    if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(s)) return 'メールアドレス';
    if (/0\d{1,4}-?\d{1,4}-?\d{3,4}/.test(s) && /\d{10,11}/.test(s.replace(/-/g, ''))) return '電話番号';
    if (/口座番号|普通\s*\d{6,8}|当座\s*\d{6,8}/.test(s)) return '口座番号';
    return null;
  }

  // ---------- 暗号化 ----------
  async function kek(pass, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: KDF_ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function wrapKey(raw, pass) {
    const salt = rnd(16), iv = rnd(12);
    const k = await kek(pass, salt);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, raw);
    return { salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  }
  async function unwrapKey(w, pass) {
    const k = await kek(pass, unb64(w.salt));
    const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(w.iv) }, k, unb64(w.ct));
    return { raw, key: await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']) };
  }
  async function encryptData(obj) {
    const iv = rnd(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dataKey, enc.encode(JSON.stringify(obj)));
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function decryptData(d) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(d.iv) }, dataKey, unb64(d.ct));
    return JSON.parse(dec.decode(pt));
  }
  function readVault() { try { return JSON.parse(lsGet(VAULT_KEY) || 'null'); } catch { return null; } }

  let saving = Promise.resolve();
  function persist() {
    if (role !== 'admin') return;
    const snapshot = clone(state);
    saving = saving.then(async () => {
      const v = readVault(); if (!v) return;
      v.data = await encryptData(snapshot);
      v.savedAt = new Date().toISOString();
      if (!lsSet(VAULT_KEY, JSON.stringify(v))) toast('保存できませんでした（ブラウザの保存領域を確認してください）', 'err');
    }).catch(() => toast('保存に失敗しました', 'err'));
  }
  function log(action) {
    state.log = state.log || [];
    state.log.unshift({ t: new Date().toISOString(), role, action });
    state.log = state.log.slice(0, 300);
  }

  // ---------- ログイン・回数制限 ----------
  function lockInfo() { try { return JSON.parse(lsGet(LOCK_KEY) || '{"n":0,"until":0}'); } catch { return { n: 0, until: 0 }; } }
  function setLock(o) { lsSet(LOCK_KEY, JSON.stringify(o)); }

  function seedState() {
    const s = clone(window.SEED);
    s.payroll = {}; s.settleStatus = {}; s.checklist = {}; s.log = []; s.version = 1;
    return s;
  }

  async function setup(passAdmin, passViewer) {
    const raw = rnd(32);
    const vault = { v: 1, kdf: { name: 'PBKDF2-SHA256', iter: KDF_ITER }, roles: { admin: await wrapKey(raw, passAdmin) } };
    if (passViewer) vault.roles.viewer = await wrapKey(raw, passViewer);
    dataKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    state = seedState(); role = 'admin';
    log('初期設定（暗号化された保管庫を作成）');
    vault.data = await encryptData(state);
    if (!lsSet(VAULT_KEY, JSON.stringify(vault))) throw new Error('storage');
  }

  async function unlock(pass) {
    const li = lockInfo();
    if (Date.now() < li.until) throw new Error(`入力ミスが続いたため、${Math.ceil((li.until - Date.now()) / 1000)}秒お待ちください`);
    const v = readVault();
    for (const r of ['admin', 'viewer']) {
      if (!v.roles[r]) continue;
      try {
        const { key } = await unwrapKey(v.roles[r], pass);
        dataKey = key; role = r;
        state = await decryptData(v.data);
        setLock({ n: 0, until: 0 });
        log('ログイン'); persist();
        return;
      } catch { /* 次の権限で試す */ }
    }
    const n = li.n + 1;
    setLock({ n, until: n >= 5 ? Date.now() + 30000 * 2 ** (n - 5) : 0 });
    throw new Error(n >= 5 ? '合言葉が違います。しばらく入力できません' : `合言葉が違います（あと${5 - n}回で一時ロック）`);
  }

  function lock(reason) {
    state = null; dataKey = null; role = null; tab = 'home';
    ui = { ym: '', docType: 'tokusoku', docOut: '', payslipFor: '', empEdit: '' };
    clearTimeout(idleTimer);
    renderLogin(reason);
  }
  function bumpIdle() {
    if (!state) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => lock('15分操作がなかったため、自動でロックしました'), IDLE_MS);
  }

  // ---------- データ操作 ----------
  function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
  function setPath(obj, path, val) {
    const ks = path.split('.'); const last = ks.pop();
    let o = obj;
    for (const k of ks) { if (o[k] == null) o[k] = {}; o = o[k]; }
    o[last] = val;
  }
  const findById = (arr, id) => arr.find((x) => x.id === id);

  // ---------- エージェント：やることを自動で洗い出す ----------
  function agentFindings() {
    const out = [];
    const add = (level, title, detail, go) => out.push({ level, title, detail, go });
    const t0 = today();

    for (const d of state.deadlines) {
      const left = daysUntil(d.date);
      if (d.done) continue;
      if (left < 0) add('high', `期限切れ：${d.title}`, `${d.date}（${-left}日経過）${d.note}`, 'home');
      else if (left <= 120 || d.level === 'high') add(left <= 60 ? 'high' : d.level, `${d.title}（あと${left}日）`, `${d.date}　${d.note}`, 'home');
    }
    const openHigh = state.todos.filter((t) => t.pri === 'high' && t.status !== '対応済');
    if (openHigh.length) add('high', `優先度の高い点検指摘が ${openHigh.length} 件 未完了`, openHigh.slice(0, 3).map((t) => `・${t.cat}：${t.text}`).join('\n'), 'todo');

    const f = state.finance;
    add('high', '修繕積立金が大きく減る見込み', `9/30時点 ${man(f.shuzenBalance)} → 第34期の工事（約${man(f.shuzenPlannedWork)}）後は約${man(f.shuzenAfterBudget)}。給湯管工事の前倒しを検討中のため、資金計画（増額・借入・工事の分割）を理事会で確認しましょう。`, 'money');

    const ar = state.arrears.filter((a) => Number(a.amount) > 0);
    const arSum = ar.reduce((s, a) => s + Number(a.amount), 0);
    if (ar.length) add('mid', `3ヵ月以上の滞納 ${ar.length} 件（${yen(arSum)}）`, '督促の記録を残し、長期のものは少額訴訟・支払督促も検討。「文書作成」で督促状の文案を作れます。', 'money');

    const ym = `${t0.getFullYear()}-${String(t0.getMonth() + 1).padStart(2, '0')}`;
    const unpaid = settleSummary();
    if (unpaid.count) add('mid', `点検・清掃の未実施 ${unpaid.count} 回 → 精算請求 ${yen(unpaid.totalTax)}（税込）`, '別紙3により、書面で申し出ないと返金されません。「文書作成」→「精算の申入れ」で文案を作れます。', 'contract');

    const r = state.rates;
    let warnCount = 0;
    for (const e of state.employees) warnCount += Calc.payroll(e, (state.payroll[ym] || {})[e.id], r, ym).warn.length;
    if (warnCount) add('mid', `給与計算で確認が必要な点が ${warnCount} 件`, '最低賃金・36協定・生年月の未入力など。「従業員・給与」を開いて確認してください。', 'staff');

    const ck = state.employees.length ? state.hiringChecklist.filter((h) => !state.checklist[h.id]).length : 0;
    if (ck) add('mid', `雇用の手続きチェックリスト：未完了 ${ck} 件`, '雇う前に「総会決議」と「管理会社との契約変更」が必要です。', 'staff');

    for (const yt of state.yearlyTasks) {
      const due = yt.month === 0 ? new Date(t0.getFullYear(), t0.getMonth() + (t0.getDate() > yt.day ? 1 : 0), yt.day)
        : new Date(t0.getFullYear() + (new Date(t0.getFullYear(), yt.month - 1, yt.day) < t0 ? 1 : 0), yt.month - 1, yt.day);
      const left = Math.round((due - t0) / 86400000);
      if (left <= 30) add('low', `給与事務：${yt.text}`, `期限 ${ymd(due)}（あと${left}日）`, 'staff');
    }
    for (const c of state.contractNotes.filter((c) => c.level === 'high')) add('mid', '委託契約の確認ポイント', c.text, 'contract');

    const order = { high: 0, mid: 1, low: 2 };
    return out.sort((a, b) => order[a.level] - order[b.level]);
  }

  function settleSummary() {
    let count = 0, total = 0;
    for (const s of state.settlement) for (const m of s.months) {
      if (state.settleStatus[`${s.id}_${m}`] === 'miss') { count++; total += s.amount; }
    }
    return { count, total, totalTax: Math.round(total * 1.1) };
  }

  // ---------- 描画 ----------
  const LV = { high: ['重要', 'b-high'], mid: ['注意', 'b-mid'], low: ['参考', 'b-low'] };
  const badge = (l) => `<span class="badge ${LV[l][1]}">${LV[l][0]}</span>`;
  const ro = () => (role !== 'admin' ? 'disabled' : '');

  function renderLogin(msg) {
    document.body.classList.remove('readonly');
    const has = !!readVault();
    $('#app').innerHTML = `
    <section class="login card">
      <h1>マンション管理エージェント</h1>
      <p class="muted">管理組合の業務をお手伝いするアプリ</p>
      ${msg ? `<p class="note">${esc(msg)}</p>` : ''}
      ${has ? `
        <form id="f-unlock" autocomplete="off">
          <label>合言葉<input type="password" id="pass" required minlength="10" autocomplete="current-password"></label>
          <button class="primary" type="submit">開く</button>
        </form>
        <details class="mt"><summary>合言葉を忘れたとき</summary>
          <p class="muted">データは合言葉で暗号化されているため、復元できません。バックアップファイルがあれば「設定」から読み込めます。</p>
          <button class="danger" data-action="wipe">この端末のデータを消して最初から</button>
        </details>` : `
        <p>はじめに合言葉を決めてください。データはこの端末の中だけに暗号化して保存され、サーバーには送られません。</p>
        <form id="f-setup" autocomplete="off">
          <label>管理者の合言葉（10文字以上・編集できる）<input type="password" id="pa" required minlength="10" autocomplete="new-password"></label>
          <label>もう一度<input type="password" id="pa2" required minlength="10" autocomplete="new-password"></label>
          <label>閲覧用の合言葉（任意・見るだけ）<input type="password" id="pv" minlength="10" autocomplete="new-password"></label>
          <button class="primary" type="submit">はじめる</button>
        </form>`}
    </section>`;
    const fu = $('#f-unlock');
    if (fu) fu.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = fu.querySelector('button'); btn.disabled = true; btn.textContent = '確認中…';
      try { await unlock($('#pass').value); start(); }
      catch (err) { renderLogin(err.message); }
    });
    const fs = $('#f-setup');
    if (fs) fs.addEventListener('submit', async (e) => {
      e.preventDefault();
      const a = $('#pa').value, a2 = $('#pa2').value, v = $('#pv').value;
      if (a !== a2) return toast('合言葉が一致しません', 'err');
      if (v && v === a) return toast('閲覧用は管理者と別の合言葉にしてください', 'err');
      try { await setup(a, v); start(); } catch { toast('保存できませんでした。プライベートブラウズでは使えません', 'err'); }
    });
  }

  const TABS = [
    ['home', 'ダッシュボード'], ['todo', '点検・修繕'], ['money', '会計・滞納'],
    ['contract', '委託契約'], ['staff', '従業員・給与'], ['docs', '文書作成'], ['settings', '設定'],
  ];

  function start() {
    document.body.classList.toggle('readonly', role !== 'admin');
    const t = today();
    ui.ym = ui.ym || `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
    bumpIdle();
    render();
  }

  function render() {
    if (!state) return;
    $('#app').innerHTML = `
      <header class="top">
        <div><strong>マンション管理エージェント</strong><span class="muted sm">　${esc(state.building.name)}・${esc(state.building.period)}</span></div>
        <div class="row">
          <span class="badge ${role === 'admin' ? 'b-low' : 'b-mid'}">${role === 'admin' ? '管理者' : '閲覧のみ'}</span>
          <button data-action="lock">ロック</button>
        </div>
      </header>
      <nav class="tabs">${TABS.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</nav>
      <main id="main">${VIEWS[tab]()}</main>`;
  }

  const VIEWS = {
    home() {
      const f = state.finance;
      const items = agentFindings();
      const ss = settleSummary();
      return `
      <div class="kpis">
        <div class="kpi"><div class="k">修繕積立金（9/30）</div><div class="v">${man(f.shuzenBalance)}</div><div class="s">工事後の見込み ${man(f.shuzenAfterBudget)}</div></div>
        <div class="kpi"><div class="k">管理費会計の剰余金</div><div class="v">${man(f.kanriSurplus)}</div><div class="s">9/30時点</div></div>
        <div class="kpi"><div class="k">未収金（滞納）</div><div class="v">${yen(f.arrearsTotal)}</div><div class="s">うち3ヵ月以上 ${yen(state.arrears.reduce((s, a) => s + Number(a.amount || 0), 0))}</div></div>
        <div class="kpi"><div class="k">未対応の点検指摘</div><div class="v">${state.todos.filter((t) => t.status !== '対応済').length}件</div><div class="s">重要 ${state.todos.filter((t) => t.pri === 'high' && t.status !== '対応済').length}件</div></div>
        <div class="kpi"><div class="k">精算請求できる額</div><div class="v">${yen(ss.totalTax)}</div><div class="s">未実施 ${ss.count}回（税込）</div></div>
      </div>
      <section class="card">
        <h2>エージェントからの報告（${items.length}件）</h2>
        <p class="muted sm">資料と入力内容を自動で点検し、今やるべきことを重要な順に並べています。</p>
        <ul class="findings">${items.map((i) => `
          <li>${badge(i.level)} <div><b>${esc(i.title)}</b><p class="pre">${esc(i.detail)}</p>
          <button class="link" data-tab="${i.go}">開く →</button></div></li>`).join('')}</ul>
      </section>
      <section class="card">
        <h2>期限の管理</h2>
        <table><thead><tr><th>期限</th><th>内容</th><th>残り</th><th>済</th></tr></thead><tbody>
        ${state.deadlines.map((d, i) => `<tr class="${d.done ? 'done' : ''}">
          <td><input type="date" data-bind="deadlines.${i}.date" value="${esc(d.date)}" ${ro()}></td>
          <td><input data-bind="deadlines.${i}.title" value="${esc(d.title)}" ${ro()}><div class="muted sm">${esc(d.note)}</div></td>
          <td class="num">${d.done ? '—' : daysUntil(d.date) + '日'}</td>
          <td><input type="checkbox" data-bind="deadlines.${i}.done" data-type="bool" ${d.done ? 'checked' : ''} ${ro()}></td></tr>`).join('')}
        </tbody></table>
        <button data-action="addDeadline" ${ro()}>＋ 期限を追加</button>
      </section>`;
    },

    todo() {
      const st = ['未対応', '見積あり', '対応中', '検討中', '対応済'];
      const order = { high: 0, mid: 1, low: 2 };
      const list = state.todos.map((t, i) => ({ t, i })).sort((a, b) => (a.t.status === '対応済') - (b.t.status === '対応済') || order[a.t.pri] - order[b.t.pri]);
      return `
      <section class="card">
        <h2>点検の指摘事項・修繕ToDo</h2>
        <p class="muted sm">特記事項（点検報告）から登録しています。状況を更新すると、ダッシュボードに反映されます。</p>
        <div class="tablewrap"><table><thead><tr><th>重要度</th><th>区分・点検日</th><th>内容</th><th>状況</th><th>メモ</th></tr></thead><tbody>
        ${list.map(({ t, i }) => `<tr class="${t.status === '対応済' ? 'done' : ''}">
          <td><select data-bind="todos.${i}.pri" ${ro()}>${['high', 'mid', 'low'].map((p) => `<option value="${p}" ${t.pri === p ? 'selected' : ''}>${LV[p][0]}</option>`).join('')}</select></td>
          <td>${esc(t.cat)}<div class="muted sm">${esc(t.date)}</div></td>
          <td class="wide">${esc(t.text)}</td>
          <td><select data-bind="todos.${i}.status" ${ro()}>${st.map((s) => `<option ${t.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
          <td><input data-bind="todos.${i}.memo" value="${esc(t.memo || '')}" placeholder="見積額・業者など" ${ro()}></td></tr>`).join('')}
        </tbody></table></div>
        <form id="f-todo" class="row mt">
          <input id="nt-cat" placeholder="区分（例：給水設備）" ${ro()}>
          <input id="nt-text" placeholder="内容" class="grow" ${ro()}>
          <button class="primary" ${ro()}>追加</button>
        </form>
      </section>`;
    },

    money() {
      const f = state.finance;
      const years = [];
      let bal = f.shuzenAfterBudget;
      const inc = Number(state.forecastIncome ?? 15452760), out = Number(state.forecastSpend ?? 5000000);
      for (let y = 35; y <= 44; y++) { bal += inc - out; years.push([y, bal]); }
      const max = Math.max(...years.map((y) => Math.abs(y[1])), 1);
      return `
      <section class="card">
        <h2>修繕積立金の見通し</h2>
        <p class="muted sm">第34期の工事後の残高（約${man(f.shuzenAfterBudget)}）から、毎年の積立額と工事費を入れて10年先まで試算します。</p>
        <div class="row">
          <label>毎年の積立収入<input type="number" data-bind="forecastIncome" data-type="num" value="${inc}" ${ro()}></label>
          <label>毎年の工事・支出<input type="number" data-bind="forecastSpend" data-type="num" value="${out}" ${ro()}></label>
        </div>
        <p class="muted sm">初期値の積立収入は、増額後の月額 1,287,730円×12ヵ月 です。</p>
        <div class="bars" role="img" aria-label="修繕積立金の残高見通し">
          ${years.map(([y, b]) => `<div class="bar"><span class="lbl">第${y}期</span><span class="track"><span class="fill ${b < 0 ? 'neg' : ''}" style="width:${Math.max(2, Math.abs(b) / max * 100)}%"></span></span><span class="val">${man(b)}</span></div>`).join('')}
        </div>
      </section>
      <section class="card">
        <h2>滞納の管理（部屋番号のみ）</h2>
        <p class="muted sm">氏名は入れません。督促の記録を残すと、法的手続きのときの証拠になります。</p>
        <div class="tablewrap"><table><thead><tr><th>部屋</th><th>金額</th><th>期間</th><th>督促の記録</th><th>次の督促日</th><th></th></tr></thead><tbody>
        ${state.arrears.map((a, i) => `<tr>
          <td><input class="short" data-bind="arrears.${i}.room" value="${esc(a.room)}" ${ro()}></td>
          <td><input type="number" data-bind="arrears.${i}.amount" data-type="num" value="${esc(a.amount)}" ${ro()}></td>
          <td><input data-bind="arrears.${i}.period" value="${esc(a.period)}" ${ro()}></td>
          <td><input data-bind="arrears.${i}.history" value="${esc(a.history)}" ${ro()}></td>
          <td><input type="date" data-bind="arrears.${i}.next" value="${esc(a.next)}" ${ro()}></td>
          <td><button data-action="docArrear" data-id="${a.id}">督促状</button></td></tr>`).join('')}
        </tbody></table></div>
        <button data-action="addArrear" ${ro()}>＋ 追加</button>
      </section>
      <section class="card">
        <h2>決算・予算の主な数字（資料より）</h2>
        <ul class="facts">
          <li>管理費会計の剰余金：${yen(f.kanriSurplus)}（9/30）</li>
          <li>修繕積立金会計の繰越金：${yen(f.shuzenBalance)}（9/30）</li>
          <li>未収金合計：${yen(f.arrearsTotal)}</li>
          <li>第34期の修繕工事予定：約${man(f.shuzenPlannedWork)}（うち給湯管一部更新 4,000万円）</li>
          <li>修繕積立金の増額：1㎡あたり約136円 → 約272円（予算は増額前6ヵ月＋増額後6ヵ月で計算・検算済み）</li>
        </ul>
      </section>`;
    },

    contract() {
      const ss = settleSummary();
      const f = state.finance;
      return `
      <section class="card">
        <h2>管理委託契約の確認ポイント</h2>
        <ul class="findings">${state.contractNotes.map((c) => `<li>${badge(c.level)}<div>${esc(c.text)}</div></li>`).join('')}</ul>
        <p class="muted sm">委託費：月額 ${yen(f.contractMonthlyExTax)}（税込 ${yen(f.contractMonthly)}）／契約期間 2027/2/1〜2028/1/31</p>
      </section>
      <section class="card">
        <h2>点検・清掃の精算チェック（別紙3）</h2>
        <p class="muted sm">予定月ごとに「実施」「未実施」を記録します。未実施の分は書面で申し出ると返金されます。</p>
        <div class="tablewrap"><table><thead><tr><th>項目</th><th>1回の精算額（税抜）</th><th>予定月ごとの実施状況</th></tr></thead><tbody>
        ${state.settlement.map((s) => `<tr><td>${esc(s.name)}</td><td class="num">${yen(s.amount)}</td><td><div class="months">
          ${s.months.map((m) => { const k = `${s.id}_${m}`; const v = state.settleStatus[k] || ''; return `<label class="mchip">${m}月
            <select data-bind="settleStatus.${k}" ${ro()}><option value="" ${!v ? 'selected' : ''}>予定</option><option value="done" ${v === 'done' ? 'selected' : ''}>実施</option><option value="miss" ${v === 'miss' ? 'selected' : ''}>未実施</option></select></label>`; }).join('')}
        </div></td></tr>`).join('')}
        </tbody></table></div>
        <p class="total">未実施 ${ss.count}回 → 精算請求額 ${yen(ss.total)}（税込 ${yen(ss.totalTax)}）</p>
        <button data-action="docSettle">精算の申入れ書を作る</button>
      </section>`;
    },

    staff() {
      const r = state.rates, ym = ui.ym;
      const month = state.payroll[ym] || {};
      const rows = state.employees.map((e) => ({ e, p: Calc.payroll(e, month[e.id], r, ym) }));
      const tot = rows.reduce((a, { p }) => ({ gross: a.gross + p.gross, net: a.net + p.net, cost: a.cost + p.employerCost, tax: a.tax + p.tax, social: a.social + p.social }), { gross: 0, net: 0, cost: 0, tax: 0, social: 0 });
      const staffEx = Object.values(state.finance.staffPartsExTax).reduce((a, b) => a + b, 0);
      const diff = tot.cost - staffEx * 1.1;
      const editing = ui.empEdit && findById(state.employees, ui.empEdit);
      return `
      <section class="card">
        <h2>従業員（${state.employees.length}名）</h2>
        <p class="note sm">個人情報を守るため、表示名はイニシャルなどにしてください。<b>氏名・マイナンバー・住所・口座番号は入力しないでください</b>（書類で鍵をかけて保管）。</p>
        <div class="tablewrap"><table><thead><tr><th>表示名</th><th>職種</th><th>雇用形態</th><th>賃金</th><th>週の時間</th><th>社会保険</th><th>雇用保険</th><th>有給（現在）</th><th></th></tr></thead><tbody>
        ${state.employees.map((e) => { const el = Calc.eligibility(e, r); const pl = Calc.paidLeave(e, today()); return `<tr>
          <td>${esc(e.name)}</td><td>${esc(e.job)}</td><td>${esc(e.type)}</td>
          <td class="num">${e.payType === 'hourly' ? '時給 ' + yen(e.base) : '月給 ' + yen(e.base)}</td>
          <td class="num">${esc(e.weeklyHours)}時間・${esc(e.weeklyDays)}日</td>
          <td>${el.shaho ? '加入' : '対象外'}</td><td>${el.koyo ? '加入' : '対象外'}</td>
          <td class="sm">${pl ? (pl.days ? `${pl.days}日（次 ${ymd(pl.next)}に${pl.nextDays}日）` : `${ymd(pl.next)}に${pl.nextDays}日付与`) : '入社日未入力'}</td>
          <td><button data-action="editEmp" data-id="${e.id}">編集</button></td></tr>`; }).join('')}
        </tbody></table></div>
        <button data-action="addEmp" ${ro()}>＋ 従業員を追加</button>
        ${editing ? empForm(editing) : ''}
      </section>

      <section class="card">
        <h2>給与計算</h2>
        <div class="row"><label>対象月<input type="month" id="ym" value="${esc(ym)}"></label>
          <span class="muted sm">勤怠（時間・日数）を入れると自動で計算します。給料日：毎月${esc(r.payday)}日</span></div>
        <div class="tablewrap"><table class="pay"><thead><tr><th>表示名</th><th>出勤日</th><th>実働h（時給）</th><th>残業h</th><th>深夜h</th><th>休日h</th><th>欠勤日</th><th>住民税</th>
          <th>総支給</th><th>社会保険等</th><th>所得税</th><th>差引支給</th><th>会社負担込み</th><th></th></tr></thead><tbody>
        ${rows.map(({ e, p }) => { const a = p.att; const b = (k) => `payroll.${ym}.${e.id}.${k}`; return `<tr>
          <td class="namecell">${esc(e.name)}<div class="muted sm">${esc(e.job)}</div>${p.warn.map((w) => `<div class="warn sm">⚠ ${esc(w)}</div>`).join('')}</td>
          <td><input type="number" class="short" data-bind="${b('days')}" data-type="num" value="${a.days}" ${ro()}></td>
          <td><input type="number" class="short" data-bind="${b('hours')}" data-type="num" value="${a.hours}" ${e.payType !== 'hourly' ? 'disabled' : ro()}></td>
          <td><input type="number" class="short" data-bind="${b('ot')}" data-type="num" value="${a.ot}" ${ro()}></td>
          <td><input type="number" class="short" data-bind="${b('night')}" data-type="num" value="${a.night}" ${ro()}></td>
          <td><input type="number" class="short" data-bind="${b('holiday')}" data-type="num" value="${a.holiday}" ${ro()}></td>
          <td><input type="number" class="short" data-bind="${b('absent')}" data-type="num" value="${a.absent}" ${e.payType === 'hourly' ? 'disabled' : ro()}></td>
          <td><input type="number" class="short" data-bind="${b('resTax')}" data-type="num" value="${a.resTax}" ${ro()}></td>
          <td class="num">${yen(p.gross)}</td><td class="num">${yen(p.social)}</td><td class="num">${yen(p.tax)}</td>
          <td class="num"><b>${yen(p.net)}</b></td><td class="num">${yen(p.employerCost)}</td>
          <td><button data-action="payslip" data-id="${e.id}">明細</button></td></tr>`; }).join('')}
        </tbody><tfoot><tr><td colspan="8">合計</td><td class="num">${yen(tot.gross)}</td><td class="num">${yen(tot.social)}</td><td class="num">${yen(tot.tax)}</td><td class="num"><b>${yen(tot.net)}</b></td><td class="num">${yen(tot.cost)}</td><td></td></tr></tfoot></table></div>
        <p class="muted sm">「会社負担込み」＝総支給＋会社が払う社会保険料・雇用保険料・労災保険料。深夜（22時〜5時）は25%、残業は25%、休日は35%を上乗せしています。</p>
        ${ui.payslipFor ? payslip(findById(state.employees, ui.payslipFor), ym) : ''}
      </section>

      <section class="card">
        <h2>人件費の比較：自分で雇う vs 管理会社に委託</h2>
        <table class="cmp"><tbody>
          <tr><td>今の委託費のうち管理員・夜間管理員・清掃員の分（別紙2）</td><td class="num">${yen(staffEx)}（税込 ${yen(staffEx * 1.1)}）／月</td></tr>
          <tr><td>この月の給与で雇った場合の総人件費（会社負担込み）</td><td class="num">${yen(tot.cost)}／月</td></tr>
          <tr><td><b>差額</b></td><td class="num"><b class="${diff > 0 ? 'warn' : 'good'}">${diff > 0 ? '雇うと 月' + yen(diff) + ' 高い' : '雇うと 月' + yen(-diff) + ' 安い'}</b></td></tr>
        </tbody></table>
        <p class="muted sm">直接雇うと、急な欠勤の代わりの手配、採用、労務管理、年末調整などの事務も管理組合の仕事になります。代行（給与計算の外部委託）費用も見込んでください。</p>
      </section>

      <section class="card">
        <h2>雇用の手続きチェックリスト</h2>
        <ul class="checks">${state.hiringChecklist.map((h) => `<li><label><input type="checkbox" data-bind="checklist.${h.id}" data-type="bool" ${state.checklist[h.id] ? 'checked' : ''} ${ro()}>
          <span class="badge b-low">${esc(h.when)}</span> ${esc(h.text)}</label></li>`).join('')}</ul>
        <h3>毎年の給与事務カレンダー</h3>
        <ul class="facts">${state.yearlyTasks.map((y) => `<li>${y.month ? y.month + '月' + y.day + '日' : '毎月' + y.day + '日'}：${esc(y.text)}</li>`).join('')}</ul>
      </section>`;
    },

    docs() {
      const opt = [['tokusoku', '督促状（滞納）'], ['settle', '精算の申入れ（未実施の点検）'], ['mitsumori', '見積依頼（点検指摘）'], ['rijikai', '理事会の招集通知'], ['keiji', '掲示：工事・点検のお知らせ'], ['roudou', '労働条件通知書（従業員）']];
      return `
      <section class="card">
        <h2>文書作成</h2>
        <p class="muted sm">資料と入力したデータから文案を作ります。内容を確認・修正してから使ってください。</p>
        <div class="row">
          <label>文書の種類<select id="docType">${opt.map(([k, l]) => `<option value="${k}" ${ui.docType === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          ${docParams()}
          <button class="primary" data-action="makeDoc">文案を作る</button>
        </div>
        <textarea id="docOut" rows="22">${esc(ui.docOut)}</textarea>
        <div class="row"><button data-action="copyDoc">コピー</button><button data-action="printDoc">印刷</button></div>
      </section>`;
    },

    settings() {
      const r = state.rates;
      const field = (k, label, step = 'any') => `<label>${label}<input type="number" step="${step}" data-bind="rates.${k}" data-type="num" value="${esc(r[k])}" ${ro()}></label>`;
      return `
      <section class="card">
        <h2>マンションの名前</h2>
        <label>表示名<input data-bind="building.name" value="${esc(state.building.name)}" maxlength="40" ${ro()}></label>
        <p class="muted sm">ここで入れた名前は、この端末の中に暗号化して保存されます（公開ファイルには入りません）。</p>
      </section>
      <section class="card">
        <h2>給与計算の料率</h2>
        <p class="note sm">⚠ 料率・最低賃金は毎年変わります。初期値は2025年度の値などの目安です。協会けんぽ（新潟支部）・厚生労働省・国税庁の最新の発表に合わせて更新し、最初の給与支払いの前に社会保険労務士・税理士に確認してください。</p>
        <div class="grid">
          ${field('healthPct', '健康保険料率（%・労使合計）')}${field('kaigoPct', '介護保険料率（%・40〜64歳）')}
          ${field('pensionPct', '厚生年金保険料率（%）')}${field('kodomoShienPct', '子ども・子育て支援金率（%）')}
          ${field('kodomoKyoshutsuPct', '子ども・子育て拠出金率（%・会社のみ）')}${field('koyoEmpPerMil', '雇用保険 本人負担（‰）')}
          ${field('koyoErPerMil', '雇用保険 会社負担（‰）')}${field('rosaiPerMil', '労災保険（‰・会社のみ）')}
          ${field('minWage', '最低賃金（円/時）', 1)}${field('payday', '給料日（日）', 1)}
          ${field('taxKyuyoMin', '源泉：給与所得控除の最低額（月）', 1)}${field('taxKiso', '源泉：基礎控除（月）', 1)}${field('taxFuyo', '源泉：扶養1人あたり（月）', 1)}
        </div>
      </section>
      <section class="card">
        <h2>バックアップ</h2>
        <p class="muted sm">暗号化されたままファイルに保存します。復元には、そのときの合言葉が必要です。月に1回、USBメモリなどに保存してください。</p>
        <div class="row">
          <button data-action="backup">バックアップを保存</button>
          <label class="filebtn">バックアップから復元<input type="file" id="restore" accept="application/json" ${ro()}></label>
        </div>
      </section>
      <section class="card">
        <h2>合言葉とアクセス</h2>
        <form id="f-pass" class="row" autocomplete="off">
          <select id="cp-role" ${ro()}><option value="admin">管理者</option><option value="viewer">閲覧用</option></select>
          <input type="password" id="cp-new" minlength="10" placeholder="新しい合言葉（10文字以上）" autocomplete="new-password" ${ro()}>
          <button ${ro()}>変更</button>
        </form>
        <ul class="facts sm">
          <li>データはこの端末の中だけに AES-256-GCM で暗号化して保存（サーバーに送信しません）</li>
          <li>5回続けて間違えると一時ロック。15分操作がないと自動でロック</li>
          <li>閲覧用の合言葉では、見ることだけできます（監事・他の理事向け）</li>
        </ul>
      </section>
      <section class="card">
        <h2>操作ログ（最新50件）</h2>
        <div class="tablewrap"><table><tbody>${(state.log || []).slice(0, 50).map((l) => `<tr><td class="sm">${esc(new Date(l.t).toLocaleString('ja-JP'))}</td><td>${l.role === 'admin' ? '管理者' : '閲覧'}</td><td>${esc(l.action)}</td></tr>`).join('')}</tbody></table></div>
      </section>
      <section class="card">
        <h2>データの初期化</h2>
        <button class="danger" data-action="wipe" ${ro()}>この端末のデータをすべて消す</button>
      </section>`;
    },
  };

  function empForm(e) {
    const i = state.employees.indexOf(e);
    const b = (k) => `employees.${i}.${k}`;
    const inp = (k, label, type = 'text', extra = '') => `<label>${label}<input type="${type}" data-bind="${b(k)}" ${type === 'number' ? 'data-type="num"' : ''} value="${esc(e[k] ?? '')}" ${extra} ${ro()}></label>`;
    return `<div class="subcard">
      <h3>${esc(e.name)} を編集</h3>
      <div class="grid">
        ${inp('name', '表示名（イニシャル推奨）', 'text', 'maxlength="20"')}${inp('job', '職種')}
        <label>雇用形態<select data-bind="${b('type')}" ${ro()}>${['正社員', '契約社員', 'パート'].map((t) => `<option ${e.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>給与の形<select data-bind="${b('payType')}" ${ro()}><option value="monthly" ${e.payType === 'monthly' ? 'selected' : ''}>月給</option><option value="hourly" ${e.payType === 'hourly' ? 'selected' : ''}>時給</option></select></label>
        ${inp('base', e.payType === 'hourly' ? '時給（円）' : '月給（円）', 'number')}${inp('allowance', '固定手当（円/月）', 'number')}
        ${inp('commute', '通勤手当（円/月）', 'number')}${inp('weeklyHours', '週の所定労働時間', 'number')}
        ${inp('weeklyDays', '週の勤務日数', 'number')}${e.payType === 'monthly' ? inp('monthlyHours', '月平均の所定労働時間', 'number') : ''}
        ${inp('nightHoursDefault', '毎月の深夜時間（目安）', 'number')}${inp('birth', '生年月（介護保険の判定用）', 'month')}
        ${inp('dependents', '扶養の人数（源泉税）', 'number')}${inp('hireDate', '入社日', 'date')}
        ${inp('residentTax', '住民税（月額・特別徴収）', 'number')}${inp('stdOverride', '標準報酬月額（決定通知の額・空欄で自動）', 'number')}
        <label>社会保険<select data-bind="${b('shahoOverride')}" ${ro()}><option value="">自動判定（週${state.rates.shahoHours}時間以上）</option><option value="yes" ${e.shahoOverride === 'yes' ? 'selected' : ''}>加入する</option><option value="no" ${e.shahoOverride === 'no' ? 'selected' : ''}>加入しない</option></select></label>
        <label class="chk"><input type="checkbox" data-bind="${b('agreement36')}" data-type="bool" ${e.agreement36 ? 'checked' : ''} ${ro()}> 36協定を届出済み</label>
      </div>
      <div class="row"><button data-action="closeEmp">閉じる</button><button class="danger" data-action="delEmp" data-id="${e.id}" ${ro()}>この従業員を削除</button></div>
    </div>`;
  }

  function payslip(e, ym) {
    if (!e) return '';
    const p = Calc.payroll(e, (state.payroll[ym] || {})[e.id], state.rates, ym);
    const row = (l, v) => (v ? `<tr><td>${l}</td><td class="num">${yen(v)}</td></tr>` : '');
    return `<div class="subcard payslip" id="payslip">
      <h3>給与明細　${esc(ym.replace('-', '年'))}月分　${esc(e.name)} 様</h3>
      <div class="two">
        <table><thead><tr><th colspan="2">支給</th></tr></thead><tbody>
          ${row('基本給', p.basePay)}${row('固定手当', Number(e.allowance))}${row('残業手当', p.otPay)}${row('深夜手当', p.nightPay)}${row('休日手当', p.holPay)}
          ${p.absentDed ? `<tr><td>欠勤控除</td><td class="num">−${yen(p.absentDed)}</td></tr>` : ''}${row('通勤手当（非課税）', p.commute)}
          <tr class="sum"><td>総支給額</td><td class="num">${yen(p.gross)}</td></tr></tbody></table>
        <table><thead><tr><th colspan="2">控除</th></tr></thead><tbody>
          ${row(p.kaigo ? '健康保険（介護含む）' : '健康保険', p.health)}${row('厚生年金', p.pension)}${row('子ども・子育て支援金', p.shien)}${row('雇用保険', p.koyo)}
          ${row('所得税', p.tax)}${row('住民税', p.resTax)}${row('その他', p.otherDed)}
          <tr class="sum"><td>控除合計</td><td class="num">${yen(p.deductions)}</td></tr></tbody></table>
      </div>
      <p class="total">差引支給額 ${yen(p.net)}</p>
      <p class="muted sm">勤怠：出勤${p.att.days}日${e.payType === 'hourly' ? `・実働${p.att.hours}時間` : ''}・残業${p.att.ot}h・深夜${p.att.night}h・休日${p.att.holiday}h${p.std ? `／標準報酬月額 ${yen(p.std)}` : ''}</p>
      <div class="row noprint"><button data-action="printSlip">明細を印刷</button><button data-action="closeSlip">閉じる</button></div>
    </div>`;
  }

  function docParams() {
    const t = ui.docType;
    if (t === 'tokusoku') return `<label>部屋<select id="dp-a">${state.arrears.map((a) => `<option value="${a.id}" ${ui.docArrear === a.id ? 'selected' : ''}>${esc(a.room)}号室（${yen(a.amount)}）</option>`).join('')}</select></label>
      <label>回数<select id="dp-n"><option value="1">1回目（お願い）</option><option value="2">2回目（催告）</option><option value="3">最終（法的手続きの予告）</option></select></label>`;
    if (t === 'mitsumori') return `<label>指摘事項<select id="dp-t">${state.todos.filter((x) => x.status !== '対応済').map((x) => `<option value="${x.id}">${esc(x.cat)}：${esc(x.text.slice(0, 24))}</option>`).join('')}</select></label>`;
    if (t === 'roudou') return `<label>従業員<select id="dp-e">${state.employees.map((e) => `<option value="${e.id}">${esc(e.name)}（${esc(e.job)}）</option>`).join('')}</select></label>`;
    if (t === 'rijikai') return `<label>日時<input id="dp-d" type="datetime-local"></label><label>場所<input id="dp-p" value="会議室"></label>`;
    if (t === 'keiji') return `<label>件名<input id="dp-k" placeholder="例：受水槽の補修工事"></label><label>日付<input id="dp-d" type="date"></label>`;
    return '';
  }

  function makeDoc() {
    const t = ui.docType, B = state.building.name, now = new Date();
    const date = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
    const sender = `${B}管理組合法人\n理事長`;
    const v = (id) => ($('#' + id) || {}).value || '';
    if (t === 'tokusoku') {
      const a = findById(state.arrears, v('dp-a')); if (!a) return '滞納データがありません';
      const n = v('dp-n');
      const head = n === '1' ? '管理費等お支払いのお願い' : n === '2' ? '管理費等の催告書' : '管理費等の最終催告書';
      const body = n === '1'
        ? '日頃より管理組合の運営にご協力いただき、ありがとうございます。\n下記の管理費等について、お支払いが確認できておりません。お手数ですが、期限までにお支払いくださいますようお願いいたします。\nすでにお支払い済みの場合は、行き違いをご容赦ください。'
        : n === '2'
          ? 'これまで再三お支払いをお願いしておりますが、下記の管理費等が未だ納付されておりません。\n管理規約に基づき、期限までに必ずお支払いくださいますよう催告いたします。'
          : '下記の管理費等について、これまでの督促にもかかわらずお支払いがありません。\n期限までにお支払いがない場合は、理事会の決議に基づき、遅延損害金を含めて支払督促・少額訴訟等の法的手続きに移行いたします。';
      return `${date}\n\n${a.room}号室　区分所有者様\n\n${sender}\n\n${head}\n\n${body}\n\n記\n1．未納額　　${yen(a.amount)}\n2．対象期間　${a.period}\n3．お支払い期限　　　年　　月　　日\n4．お支払い方法　管理組合の指定口座へお振込み（口座はお問い合わせください）\n\nご事情によりお支払いが難しい場合は、期限までに管理事務室までご相談ください。\n\n以上`;
    }
    if (t === 'settle') {
      const ss = settleSummary();
      const lines = [];
      for (const s of state.settlement) for (const m of s.months) if (state.settleStatus[`${s.id}_${m}`] === 'miss') lines.push(`・${s.name}（${m}月実施予定分）　${yen(s.amount)}`);
      return `${date}\n\n日本ハウズイング株式会社　御中\n\n${sender}\n\n管理事務の未実施分の精算についての申入れ\n\n管理委託契約 第6条及び別紙3に基づき、下記の管理事務が実施されていないため、精算を申し入れます。\n\n記\n${lines.length ? lines.join('\n') : '・（「委託契約」画面で未実施の回を記録してください）'}\n\n合計　${yen(ss.total)}（消費税込 ${yen(ss.totalTax)}）\n\n上記の金額を、管理組合の指定口座へお振込みくださいますようお願いいたします。\nあわせて、未実施となった理由と今後の実施予定を書面でご報告ください。\n\n以上`;
    }
    if (t === 'mitsumori') {
      const x = findById(state.todos, v('dp-t')); if (!x) return '未対応の指摘事項がありません';
      return `${date}\n\n日本ハウズイング株式会社　御中\n\n${sender}\n\n見積書提出のお願い\n\n${x.date}実施の${x.cat}で、次の指摘をいただきました。\n「${x.text}」\n\nつきましては、下記のとおり見積書のご提出をお願いいたします。\n\n記\n1．内容　上記指摘への対応工事（交換・補修）\n2．提出物　見積書（内訳つき）、工事の必要性と緊急度の説明、工事をしない場合のリスク\n3．相見積り　管理組合で他社にも見積りを依頼する場合がありますので、仕様書もあわせてご提出ください\n4．提出期限　　　年　　月　　日\n\n以上`;
    }
    if (t === 'rijikai') {
      const d = v('dp-d'); const dt = d ? new Date(d) : null;
      const when = dt ? `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日（${'日月火水木金土'[dt.getDay()]}）${dt.getHours()}時${String(dt.getMinutes()).padStart(2, '0')}分` : '　　年　　月　　日（　）　　時　　分';
      const topics = state.todos.filter((x) => x.pri === 'high' && x.status !== '対応済').slice(0, 4).map((x, i) => `${i + 3}．${x.cat}の指摘への対応（${x.text.slice(0, 30)}…）`).join('\n');
      return `${date}\n\n理事各位\n\n${sender}\n\n第34期　理事会開催のご案内\n\n下記のとおり理事会を開催いたします。ご出席くださいますようお願いいたします。\n\n記\n1．日時　${when}\n2．場所　${v('dp-p') || '会議室'}\n3．議題\n1．管理費等の収支状況・滞納の状況について\n2．修繕積立金の資金計画（給湯管工事の前倒しを含む）について\n${topics}\n\n以上`;
    }
    if (t === 'keiji') {
      const d = v('dp-d');
      return `居住者の皆様へ\n\n${date}\n${sender}\n\n${v('dp-k') || '工事・点検'}のお知らせ\n\n下記のとおり実施いたします。ご不便をおかけしますが、ご協力をお願いいたします。\n\n記\n1．日時　${d || '　　年　　月　　日'}　　時　　分〜　　時　　分\n2．場所　\n3．内容　\n4．お願い　作業中は\n\nご不明な点は、管理事務室までお問い合わせください。\n\n以上`;
    }
    if (t === 'roudou') {
      const e = findById(state.employees, v('dp-e')); if (!e) return '';
      const el = Calc.eligibility(e, state.rates);
      return `労働条件通知書\n\n${date}\n\n${e.name} 殿\n\n事業場名称　${B}管理組合法人\n使用者職氏名　理事長\n\n契約期間　　期間の定めなし（または　　年　月　日〜　　年　月　日、更新の有無：　）\n就業の場所　${B}\n従事する業務　${e.job}${/夜間/.test(e.job) ? '（夜間の巡回・緊急対応を含む）' : ''}\n始業・終業　　時　　分〜　　時　　分（休憩　　分）${/夜間/.test(e.job) ? '\n　※深夜（22時〜5時）の勤務を含む。仮眠時間の扱い：' : ''}\n所定労働時間　週${e.weeklyHours}時間・週${e.weeklyDays}日\n所定時間外労働　${e.agreement36 ? '有（36協定の範囲内）' : '無'}\n休日　\n休暇　年次有給休暇（6ヵ月継続勤務で付与。週${e.weeklyDays}日勤務の付与日数による）\n\n賃金\n1．基本賃金　${e.payType === 'hourly' ? '時間給 ' + yen(e.base) : '月給 ' + yen(e.base)}\n2．手当　${Number(e.allowance) ? '固定手当 ' + yen(e.allowance) : 'なし'}／通勤手当 ${yen(e.commute)}（月額上限）\n3．割増賃金率　法定時間外25%、休日35%、深夜25%\n4．締切日・支払日　毎月末日締め・翌月${state.rates.payday}日払い\n5．支払方法　本人名義の口座へ振込（本人の同意による）\n6．昇給・賞与・退職金　\n\n退職に関する事項　自己都合退職は　日前までに届け出ること\n社会保険の加入　健康保険・厚生年金：${el.shaho ? '有' : '無'}／雇用保険：${el.koyo ? '有' : '無'}／労災保険：有\n\n相談窓口　理事長\n\n※この文案は目安です。交付前に社会保険労務士に確認してください。`;
    }
    return '';
  }

  // ---------- イベント ----------
  document.addEventListener('click', async (ev) => {
    bumpIdle();
    const tb = ev.target.closest('[data-tab]');
    if (tb && state) { tab = tb.dataset.tab; render(); window.scrollTo(0, 0); return; }
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset.action, id = btn.dataset.id;
    const admin = role === 'admin';
    const needAdmin = ['addDeadline', 'addArrear', 'addEmp', 'delEmp'];
    if (needAdmin.includes(a) && !admin) return toast('閲覧用では変更できません', 'err');

    if (a === 'lock') { if (state) { log('ロック'); persist(); await saving; } lock(); return; }
    if (a === 'wipe') {
      if (!confirm('この端末のデータをすべて消します。元に戻せません。よろしいですか？')) return;
      try { localStorage.removeItem(VAULT_KEY); localStorage.removeItem(LOCK_KEY); } catch { /* 無視 */ }
      state = null; renderLogin('データを消しました'); return;
    }
    if (a === 'addDeadline') { state.deadlines.push({ id: uid(), date: ymd(today()), title: '新しい期限', note: '', level: 'mid' }); log('期限を追加'); }
    if (a === 'addArrear') { state.arrears.push({ id: uid(), room: '', amount: 0, period: '', history: '', next: '' }); log('滞納を追加'); }
    if (a === 'docArrear') { tab = 'docs'; ui.docType = 'tokusoku'; ui.docArrear = id; ui.docOut = ''; }
    if (a === 'docSettle') { tab = 'docs'; ui.docType = 'settle'; ui.docOut = makeDoc(); }
    if (a === 'addEmp') {
      const e = { id: uid(), name: `スタッフ${state.employees.length + 1}`, job: '', type: 'パート', payType: 'hourly', base: state.rates.minWage, allowance: 0, commute: 0, weeklyHours: 20, weeklyDays: 4, monthlyHours: 0, birth: '', dependents: 0, hireDate: '', residentTax: 0 };
      state.employees.push(e); ui.empEdit = e.id; log('従業員を追加');
    }
    if (a === 'editEmp') ui.empEdit = id;
    if (a === 'closeEmp') ui.empEdit = '';
    if (a === 'delEmp') {
      if (!confirm('この従業員を削除しますか？（賃金台帳は法律で5年保存が必要です。先にバックアップを）')) return;
      state.employees = state.employees.filter((e) => e.id !== id); ui.empEdit = ''; log('従業員を削除');
    }
    if (a === 'payslip') ui.payslipFor = id;
    if (a === 'closeSlip') ui.payslipFor = '';
    if (a === 'printSlip' || a === 'printDoc') {
      document.body.classList.add(a === 'printSlip' ? 'print-slip' : 'print-doc');
      window.print();
      document.body.classList.remove('print-slip', 'print-doc');
      return;
    }
    if (a === 'makeDoc') { ui.docOut = makeDoc(); log('文書を作成：' + ui.docType); }
    if (a === 'copyDoc') {
      try { await navigator.clipboard.writeText($('#docOut').value); toast('コピーしました'); } catch { toast('コピーできませんでした。手動で選択してください', 'err'); }
      return;
    }
    if (a === 'backup') {
      await saving;
      const raw = lsGet(VAULT_KEY);
      const blob = new Blob([raw], { type: 'application/json' });
      const u = URL.createObjectURL(blob);
      const l = document.createElement('a'); l.href = u; l.download = `mansion-agent-backup-${ymd(today())}.json`; l.click();
      setTimeout(() => URL.revokeObjectURL(u), 1000);
      log('バックアップを保存');
    }
    if (admin) persist();
    render();
  });

  document.addEventListener('change', async (ev) => {
    bumpIdle();
    const el = ev.target;
    if (el.id === 'ym') { ui.ym = el.value || ui.ym; ui.payslipFor = ''; render(); return; }
    if (el.id === 'docType') { ui.docType = el.value; ui.docOut = ''; render(); return; }
    if (el.id === 'restore') return restore(el);
    const path = el.dataset && el.dataset.bind;
    if (!path || !state) return;
    if (role !== 'admin') { toast('閲覧用では変更できません', 'err'); render(); return; }
    let val = el.dataset.type === 'bool' ? el.checked : el.value;
    if (el.dataset.type === 'num') {
      val = el.value === '' ? '' : Number(el.value);
      if (val !== '' && (!Number.isFinite(val) || val < 0 || val > 1e10)) { toast('0以上の数字を入れてください', 'err'); render(); return; }
    } else if (typeof val === 'string') {
      val = val.slice(0, 300);
      const hit = piiCheck(val);
      if (hit) { toast(`${hit}が含まれているようです。個人情報は保存できません`, 'err'); render(); return; }
    }
    setPath(state, path, val);
    log('編集：' + path.split('.').slice(0, 2).join('.'));
    persist();
    render();
  });

  document.addEventListener('submit', (ev) => {
    const f = ev.target;
    if (f.id === 'f-todo') {
      ev.preventDefault();
      if (role !== 'admin') return;
      const text = $('#nt-text').value.trim().slice(0, 300), cat = $('#nt-cat').value.trim().slice(0, 40) || 'その他';
      if (!text) return toast('内容を入れてください', 'err');
      const hit = piiCheck(text + cat); if (hit) return toast(`${hit}は登録できません`, 'err');
      state.todos.push({ id: uid(), cat, date: ymd(today()), text, pri: 'mid', status: '未対応' });
      log('ToDoを追加'); persist(); render();
    }
    if (f.id === 'f-pass') {
      ev.preventDefault();
      if (role !== 'admin') return;
      changePass($('#cp-role').value, $('#cp-new').value);
    }
  });

  async function changePass(r, p) {
    if (!p || p.length < 10) return toast('10文字以上にしてください', 'err');
    await saving;
    const v = readVault();
    // 現在の鍵を取り出すため、管理者の鍵を一度エクスポート可能な形で作り直す
    const raw = await rawKeyFromSession();
    if (!raw) return toast('一度ロックして開き直してから変更してください', 'err');
    v.roles[r] = await wrapKey(raw, p);
    lsSet(VAULT_KEY, JSON.stringify(v));
    log((r === 'admin' ? '管理者' : '閲覧用') + 'の合言葉を変更'); persist();
    toast('合言葉を変更しました');
    render();
  }
  // 鍵は取り出し不可で読み込んでいるため、合言葉変更時は再入力してもらう
  async function rawKeyFromSession() {
    const cur = prompt('確認のため、今の管理者の合言葉を入力してください');
    if (!cur) return null;
    try { const { raw } = await unwrapKey(readVault().roles.admin, cur); return raw; } catch { toast('合言葉が違います', 'err'); return null; }
  }

  async function restore(input) {
    if (role !== 'admin') return;
    const file = input.files[0]; if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast('ファイルが大きすぎます', 'err');
    try {
      const v = JSON.parse(await file.text());
      if (!v || v.v !== 1 || !v.roles || !v.roles.admin || !v.data) throw new Error();
      if (!confirm('今のデータをバックアップの内容で置き換えます。よろしいですか？')) return;
      lsSet(VAULT_KEY, JSON.stringify(v));
      lock('バックアップを読み込みました。バックアップ時の合言葉で開いてください');
    } catch { toast('バックアップファイルとして読み込めませんでした', 'err'); }
  }

  ['keydown', 'pointerdown', 'scroll'].forEach((e) => document.addEventListener(e, bumpIdle, { passive: true }));
  window.addEventListener('error', () => toast('エラーが起きました。画面を再読み込みしてください', 'err'));

  if (!window.crypto || !crypto.subtle) {
    $('#app').innerHTML = '<p class="card">このブラウザでは暗号化機能が使えないため、安全のため起動しません。HTTPSの最新ブラウザで開いてください。</p>';
  } else {
    renderLogin();
  }
})();
