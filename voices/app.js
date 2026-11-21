// クニゴエ：画面側の本体
// 利用者が書いた文字は必ず textContent で表示する（HTMLとして解釈させない＝XSS対策）
(function () {
  'use strict';
  const $ = (sel, root = document) => root.querySelector(sel);
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const k in props || {}) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k in e && k !== 'list' && k !== 'form') e[k] = v;
      else e.setAttribute(k, v);
    }
    kids.flat().forEach((c) => { if (c != null && c !== false) e.append(c); });
    return e;
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できなくても続行 */ } },
  };

  const st = {
    mode: 'live', me: null,
    country: store.get('kg_country', 'JP'),
    muted: new Set(store.get('kg_muted', [])),
  };

  // ---------- サーバーとの通信 ----------
  async function api(action, params = {}) {
    if (st.mode === 'demo') return window.KGDemo.call(action, params);
    let res;
    if (action === 'stats' || action === 'trends') { // 集計は GET にして CDN キャッシュを効かせる
      const qs = new URLSearchParams({ action, ...Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== '')) });
      res = await fetch('/api/voices?' + qs);
    } else {
      res = await fetch('/api/voices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action, ...params }) });
    }
    let data = null;
    try { data = await res.json(); } catch { /* JSON でない応答 */ }
    if (!res.ok) { const e = new Error((data && data.error) || '通信に失敗しました。'); e.status = res.status; e.code = data && data.code; throw e; }
    return data;
  }

  // ---------- 小さな部品 ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }
  const fail = (e) => toast(e.message || 'エラーが起きました。');
  function ago(ms) {
    const s = (Date.now() - ms) / 1000;
    if (s < 60) return 'たった今';
    if (s < 3600) return Math.floor(s / 60) + '分前';
    if (s < 86400) return Math.floor(s / 3600) + '時間前';
    if (s < 86400 * 7) return Math.floor(s / 86400) + '日前';
    const d = new Date(ms); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }
  function avatar(user, big) {
    let n = 0; for (const c of user.handle) n = (n * 31 + c.charCodeAt(0)) % 6;
    return h('span', { class: `av av${n}${big ? ' av-big' : ''} notranslate`, text: [...(user.name || user.handle)][0] || '?', 'aria-hidden': 'true' });
  }
  const cName = (code) => { const c = KG.country(code); return c ? `${c.flag} ${c.name}` : code; };
  const deskType = (k) => KG.DESK_TYPES.find((t) => t.k === k) || KG.DESK_TYPES[0];
  const deskLabel = (d) => `${deskType(d.type).icon} ${deskType(d.type).name}：${d.name}`;
  const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

  function modal(title, body, opts = {}) {
    const close = () => { back.remove(); document.removeEventListener('keydown', esc); if (opts.onClose) opts.onClose(); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    const box = h('div', { class: 'modal' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('h2', { text: title }), h('button', { class: 'icon-btn', 'aria-label': '閉じる', text: '✕', onclick: close })), body);
    const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) close(); } }, box);
    document.addEventListener('keydown', esc);
    $('#modal-root').append(back);
    const f = box.querySelector('input, textarea, select, button.primary'); if (f) f.focus();
    return close;
  }
  function field(label, input, hint) { return h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), input, hint && h('small', { class: 'muted', text: hint })); }
  function select(list, value, emptyLabel) {
    const s = h('select', {}, emptyLabel != null && h('option', { value: '', text: emptyLabel }), list.map((x) => h('option', { value: x.k, text: (x.icon ? x.icon + ' ' : '') + x.name })));
    s.value = value || ''; return s;
  }
  const countrySelect = (value, withAll) => {
    const s = h('select', {}, withAll && h('option', { value: 'ALL', text: '🌐 すべての国' }), KG.COUNTRIES.map((c) => h('option', { value: c.code, text: `${c.flag} ${c.name}` })));
    s.value = value; return s;
  };
  // 選択式のチップ（もう一度押すと解除できる）
  function chips(list, value, onChange, opts = {}) {
    let cur = value || null;
    const box = h('div', { class: 'chips', role: 'group' });
    const draw = () => {
      box.replaceChildren(...list.map((x) => h('button', {
        type: 'button', class: 'chip' + (cur === x.k ? ' on' : ''), 'aria-pressed': String(cur === x.k), title: x.hint || x.name,
        text: (x.icon ? x.icon + ' ' : '') + x.name,
        onclick: () => { cur = cur === x.k && !opts.required ? null : x.k; draw(); onChange(cur); },
      })));
    };
    draw(); return box;
  }

  // ---------- ログイン・登録 ----------
  function requireLogin(msg) { if (st.me) return true; openAuth('signup', msg || 'この操作にはログインが必要です。'); return false; }
  function openAuth(tab = 'login', note) {
    const body = h('div', { class: 'modal-body' });
    let close;
    const draw = (which) => {
      const err = h('p', { class: 'err', role: 'alert' });
      const handle = h('input', { type: 'text', autocomplete: 'username', maxLength: 15, placeholder: '例：taro_2026', required: true });
      const pw = h('input', { type: 'password', autocomplete: which === 'login' ? 'current-password' : 'new-password', minLength: st.mode === 'demo' ? 0 : 8, maxLength: 100, required: st.mode !== 'demo' });
      const name = h('input', { type: 'text', maxLength: 20, placeholder: '画面に表示される名前（本名は不要）' });
      const country = countrySelect(st.country === 'ALL' ? 'JP' : st.country);
      const age = select(KG.AGES, '', '答えない'), gender = select(KG.GENDERS, '', '答えない'), area = select(KG.AREAS, '', '答えない');
      const agree = h('input', { type: 'checkbox', required: true });
      const submit = h('button', { class: 'primary block', type: 'submit', text: which === 'login' ? 'ログイン' : '登録してはじめる' });
      const form = h('form', {
        onsubmit: async (e) => {
          e.preventDefault(); err.textContent = ''; submit.disabled = true;
          try {
            const p = which === 'login' ? { handle: handle.value, password: pw.value }
              : { handle: handle.value, password: pw.value, name: name.value, country: country.value, age: age.value, gender: gender.value, area: area.value };
            st.me = (await api(which, p)).me;
            close(); toast(which === 'login' ? 'ログインしました。' : 'ようこそ！登録が完了しました。'); renderChrome(); route();
          } catch (ex) { err.textContent = ex.message; } finally { submit.disabled = false; }
        },
      },
      note && h('p', { class: 'note', text: note }),
      h('div', { class: 'tabs' },
        h('button', { type: 'button', class: 'tab' + (which === 'login' ? ' on' : ''), text: 'ログイン', onclick: () => draw('login') }),
        h('button', { type: 'button', class: 'tab' + (which === 'signup' ? ' on' : ''), text: '新規登録', onclick: () => draw('signup') })),
      field('ユーザーID（半角英数字と _ ・3〜15文字）', handle),
      st.mode === 'demo' ? h('p', { class: 'muted small', text: 'デモモードではパスワードは不要です（この端末だけの仮アカウント）。' }) : field('パスワード（8文字以上）', pw),
      which === 'signup' && [
        field('表示名', name),
        field('主に声を届けたい国', country),
        h('fieldset', { class: 'attrs' }, h('legend', { text: '統計用の属性（任意）' }),
          h('p', { class: 'muted small', text: '世論の集計にだけ使います。プロフィールには表示されず、少人数の区分は集計結果にも出しません。' }),
          h('div', { class: 'grid3' }, field('年代', age), field('性別', gender), field('お住まい', area))),
        h('label', { class: 'check' }, agree, h('span', {}, h('a', { href: '#/about', text: '利用ルールとプライバシー', onclick: () => close() }), 'に同意します')),
        h('p', { class: 'muted small', text: 'メールアドレス・電話番号・本名は集めません。そのためパスワードを忘れると再発行できません。' }),
      ],
      err, submit);
      body.replaceChildren(form);
      handle.focus();
    };
    close = modal('クニゴエへようこそ', body);
    draw(tab);
  }

  // ---------- 投稿カード ----------
  function richBody(text) {
    const out = h('p', { class: 'body' });
    const re = /([#＃][\p{L}\p{N}_ー]{1,30})|(@[a-z0-9_]{3,15})/gu;
    let last = 0, m;
    while ((m = re.exec(text))) {
      out.append(text.slice(last, m.index));
      if (m[1]) out.append(h('a', { class: 'tag', href: '#/tag/' + encodeURIComponent(m[1].slice(1).toLowerCase()), text: m[1], onclick: (e) => e.stopPropagation() }));
      else out.append(h('a', { class: 'tag', href: '#/u/' + m[2].slice(1), text: m[2], onclick: (e) => e.stopPropagation() }));
      last = m.index + m[0].length;
    }
    out.append(text.slice(last));
    return out;
  }
  function badges(p) {
    const kind = KG.KINDS.find((k) => k.k === p.kind), stance = KG.STANCES.find((s) => s.k === p.stance), emo = KG.EMOTIONS.find((e) => e.k === p.emotion);
    return h('div', { class: 'badges' },
      p.desk && !p.parent && h('a', { class: 'badge desk', href: '#/desk/' + p.desk.id, text: deskLabel(p.desk), title: 'この窓口の投稿を見る', onclick: (e) => e.stopPropagation() }),
      kind && !p.parent && h('span', { class: 'badge kind-' + p.kind, text: `${kind.icon} ${kind.name}` }),
      !p.parent && h('a', { class: 'badge', href: '#/search?topic=' + p.topic, text: KG.nameOf(KG.TOPICS, p.topic), onclick: (e) => e.stopPropagation() }),
      stance && h('span', { class: 'badge st-' + p.stance, text: `${stance.icon} 政策を${stance.name}` }),
      emo && h('span', { class: 'badge', text: `${emo.icon} ${emo.name}` }),
      p.sat && h('span', { class: 'badge', text: `暮らし向き：${KG.SAT_LABELS[p.sat - 1]}` }));
  }
  function pollView(p, card) {
    const total = p.poll.counts.reduce((a, b) => a + b, 0);
    const voted = p.poll.my != null;
    return h('div', { class: 'poll', onclick: (e) => e.stopPropagation() },
      p.poll.options.map((o, i) => {
        const share = KGChart.pct(p.poll.counts[i], total);
        if (!voted) return h('button', { class: 'poll-opt', text: o, onclick: async () => { if (!requireLogin('投票するにはログインが必要です。')) return; try { card.update((await api('vote', { id: p.id, opt: i })).post); } catch (e) { fail(e); } } });
        const fill = h('span', { class: 'poll-fill' }); fill.style.width = share + '%';
        return h('div', { class: 'poll-res' + (p.poll.my === i ? ' mine' : '') }, fill, h('span', { class: 'poll-name', text: (p.poll.my === i ? '✓ ' : '') + o }), h('span', { class: 'poll-pct notranslate', text: share + '%' }));
      }),
      h('small', { class: 'muted', text: `${total.toLocaleString()}票${voted ? '' : '・投票すると結果が見られます'}` }));
  }
  function postCard(p, opts = {}) {
    const card = h('article', { class: 'post' + (opts.detail ? ' detail' : ''), tabIndex: 0 });
    card.update = (np) => { p = np; draw(); };
    const act = (icon, label, count, on, fn, cls) => h('button', {
      class: 'act' + (on ? ' on' : '') + (cls ? ' ' + cls : ''), 'aria-label': label, title: label, 'aria-pressed': on == null ? null : String(!!on),
      onclick: (e) => { e.stopPropagation(); fn(); },
    }, h('span', { class: 'act-i', text: icon }), count != null && h('span', { class: 'act-n notranslate', text: count ? count.toLocaleString() : '' }));
    const react = async (type) => { if (!requireLogin()) return; try { card.update((await api('react', { id: p.id, type })).post); } catch (e) { fail(e); } };
    function menu() {
      const items = h('div', { class: 'modal-body menu-list' });
      const add = (text, fn, danger) => items.append(h('button', { class: 'menu-item' + (danger ? ' danger' : ''), text, onclick: () => { close(); fn(); } }));
      add('🔗 リンクをコピー', () => share(p));
      if (p.mine) add('🗑️ この投稿を削除', async () => { if (!confirm('この投稿を削除しますか？')) return; try { await api('deletePost', { id: p.id }); card.remove(); toast('削除しました。'); if (opts.detail) go('#/'); } catch (e) { fail(e); } }, true);
      else {
        add(`🔇 @${p.user.handle} さんをミュート`, () => { st.muted.add(p.user.handle); store.set('kg_muted', [...st.muted]); toast('ミュートしました（設定から解除できます）。'); route(); });
        add('🚩 この投稿を通報', () => openReport(p), true);
      }
      const close = modal('投稿のメニュー', items);
    }
    function draw() {
      card.replaceChildren(
        h('a', { class: 'av-link', href: '#/u/' + p.user.handle, onclick: (e) => e.stopPropagation(), 'aria-label': p.user.name + 'のプロフィール' }, avatar(p.user)),
        h('div', { class: 'post-main' },
          h('header', { class: 'post-head' },
            h('a', { class: 'name notranslate', href: '#/u/' + p.user.handle, text: p.user.name, onclick: (e) => e.stopPropagation() }),
            h('span', { class: 'muted', text: `@${p.user.handle}・${ago(p.created)}` }),
            (st.country === 'ALL' || opts.showCountry) && h('span', { class: 'muted', text: '・' + cName(p.country) }),
            h('button', { class: 'icon-btn more', 'aria-label': 'メニュー', text: '⋯', onclick: (e) => { e.stopPropagation(); menu(); } })),
          badges(p),
          p.body && richBody(p.body),
          p.poll && pollView(p, card),
          p.quote && h('a', { class: 'quote', href: '#/p/' + p.quote.id, onclick: (e) => e.stopPropagation() },
            h('span', { class: 'muted small', text: `${p.quote.user.name} @${p.quote.user.handle}・${ago(p.quote.created)}` }), h('span', { class: 'quote-body', text: p.quote.body })),
          h('footer', { class: 'acts' },
            act('💬', '返信', p.replies, null, () => { if (requireLogin()) openCompose({ parent: p }); }),
            act('🔁', '引用して投稿', p.quotes, null, () => { if (requireLogin()) openCompose({ quote: p }); }),
            act('♡', 'いいね', p.likes, p.my.like, () => react('like'), 'like'),
            (p.kind === 'opinion' || p.kind === 'proposal') && !p.parent && [
              act('⭕', p.kind === 'proposal' ? 'この提言に賛同' : 'この意見に賛成', p.agrees, p.my.agree, () => react('agree'), 'agree'),
              act('✖', p.kind === 'proposal' ? 'この提言に反対' : 'この意見に反対', p.disagrees, p.my.disagree, () => react('disagree'), 'disagree')],
            act('🔖', 'ブックマーク', null, p.my.bookmark, () => react('bookmark'), 'bm'),
            act('↗', '共有', null, null, () => share(p)))));
    }
    if (!opts.detail) {
      const open = (e) => { if (e.target.closest('a, button, .poll')) return; if (String(getSelection())) return; go('#/p/' + p.id); };
      card.addEventListener('click', open);
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === card) go('#/p/' + p.id); });
    }
    draw();
    return card;
  }
  async function share(p) {
    const url = location.origin + location.pathname + '#/p/' + p.id;
    try {
      if (navigator.share) await navigator.share({ title: 'クニゴエ', text: p.body.slice(0, 80), url });
      else { await navigator.clipboard.writeText(url); toast('リンクをコピーしました。'); }
    } catch { /* 共有を取り消した場合など */ }
  }
  function openReport(p, isDesk) {
    if (!requireLogin()) return;
    const reasons = isDesk ? ['中傷・差別的な名前', '個人情報が含まれている', '公人ではない個人の名前', 'スパム・宣伝', 'その他'] : ['誹謗中傷・差別的な内容', '個人情報が書かれている', 'デマ・明らかな虚偽', 'スパム・宣伝', '暴力や違法行為をあおる内容', 'その他'];
    const reason = h('select', {}, reasons.map((t) => h('option', { text: t })));
    const body = h('div', { class: 'modal-body' }, h('p', { class: 'muted', text: '意見が違うことだけを理由にした通報はできません。ルール違反と思われる理由を選んでください。' }), field('理由', reason),
      h('button', { class: 'primary block', text: '通報する', onclick: async () => { try { await api(isDesk ? 'reportDesk' : 'report', { id: p.id, reason: reason.value }); close(); toast('通報を受け付けました。運営が確認します。'); } catch (e) { fail(e); } } }));
    const close = modal(isDesk ? '窓口を通報' : '投稿を通報', body);
  }

  // ---------- 投稿フォーム ----------
  function openCompose({ parent, quote, desk } = {}) {
    if (!requireLogin('投稿するには登録（無料）が必要です。')) return;
    const simple = !!parent;
    const draft = simple || quote ? {} : store.get('kg_draft', {});
    const d = { kind: draft.kind || 'opinion', topic: draft.topic || 'economy', stance: draft.stance || null, emotion: draft.emotion || null, sat: draft.sat || null, body: draft.body || '',
      deskType: desk ? desk.type : draft.deskType || 'country', deskName: desk ? desk.name : draft.deskName || '' };
    let country = desk ? desk.country : st.country === 'ALL' ? st.me.country : st.country;
    const saveDraft = () => { if (!simple && !quote) store.set('kg_draft', d); };
    const text = h('textarea', { rows: simple ? 4 : 5, maxLength: KG.MAX_BODY, value: d.body, placeholder: simple ? '返信を書く' : 'いまの暮らし、感じていること、政策への意見や提案を書いてみましょう。\n#ハッシュタグ も使えます。' });
    const count = h('span', { class: 'muted small' });
    const hint = h('p', { class: 'muted small' });
    const upd = () => { d.body = text.value; count.textContent = `${[...text.value].length} / ${KG.MAX_BODY}`; saveDraft(); };
    text.addEventListener('input', upd); upd();
    const setHint = () => { hint.textContent = (KG.KINDS.find((k) => k.k === d.kind) || {}).hint || ''; };
    setHint();
    const topic = select(KG.TOPICS, d.topic); topic.addEventListener('change', () => { d.topic = topic.value; saveDraft(); });
    const cSel = countrySelect(country); cSel.addEventListener('change', () => { country = cSel.value; suggest(); });
    // 意見の窓口：国以外を選んだら名前を入力（すでにある窓口は候補に出る）
    const deskList = h('datalist', { id: 'kg-desk-list' });
    const deskName = h('input', { type: 'text', maxLength: KG.MAX_DESK, value: d.deskName, list: 'kg-desk-list', autocomplete: 'off' });
    const deskHint = h('small', { class: 'muted' });
    const deskField = h('label', { class: 'field' }, h('span', { class: 'field-label', text: '窓口の名前' }), deskName, deskList, deskHint);
    let sugTimer;
    const suggest = () => {
      clearTimeout(sugTimer);
      if (d.deskType === 'country') return;
      sugTimer = setTimeout(() => api('desks', { country, type: d.deskType, q: deskName.value.trim() }).then((out) => deskList.replaceChildren(...out.desks.map((x) => h('option', { value: x.name })))).catch(() => {}), 250);
    };
    const drawDesk = () => {
      const t = deskType(d.deskType);
      deskField.hidden = d.deskType === 'country';
      deskName.placeholder = t.eg;
      deskHint.textContent = d.deskType === 'politician' ? '政治家への声は、公人としての活動や政策についての意見に限ります。私生活への言及や中傷はできません。' : 'すでにある窓口は候補に表示されます。なければ新しく作られます。';
      suggest();
    };
    deskName.addEventListener('input', () => { d.deskName = deskName.value; saveDraft(); suggest(); });
    drawDesk();
    const pollBox = h('div', { class: 'poll-edit' }); let pollOn = false;
    const pollInputs = [];
    const drawPoll = () => {
      pollBox.replaceChildren();
      if (!pollOn) return;
      pollInputs.forEach((inp, i) => pollBox.append(field('選択肢 ' + (i + 1), inp)));
      if (pollInputs.length < 4) pollBox.append(h('button', { type: 'button', class: 'link', text: '＋ 選択肢を追加', onclick: () => { pollInputs.push(h('input', { type: 'text', maxLength: 40 })); drawPoll(); } }));
    };
    const err = h('p', { class: 'err', role: 'alert' });
    const submit = h('button', { class: 'primary', type: 'submit', text: simple ? '返信する' : '投稿する' });
    const form = h('form', {
      class: 'modal-body compose',
      onsubmit: async (e) => {
        e.preventDefault(); err.textContent = ''; submit.disabled = true;
        try {
          const p = simple ? { body: d.body, parent: parent.id, kind: 'opinion', topic: parent.topic, country: parent.country }
            : { ...d, country, quote: quote && quote.id, poll: pollOn ? pollInputs.map((i) => i.value) : null };
          const out = await api('post', p);
          if (!simple && !quote) store.set('kg_draft', {});
          if (desk) { close(); toast('投稿しました。'); route(); return; }
          close(); toast(simple ? '返信しました。' : '投稿しました。');
          if (simple) go('#/p/' + parent.id); else if (location.hash.replace(/^#\/?/, '') === '') { const list = $('.feed-list'); if (list && (st.country === 'ALL' || st.country === out.post.country)) list.prepend(postCard(out.post)); } else go('#/');
        } catch (ex) { err.textContent = ex.message; } finally { submit.disabled = false; }
      },
    },
    parent && h('p', { class: 'muted small', text: `@${parent.user.handle} さんへの返信` }),
    !simple && [
      h('div', { class: 'field' }, h('span', { class: 'field-label', text: '何を伝えますか？' }), chips(KG.KINDS, d.kind, (v) => { d.kind = v; setHint(); saveDraft(); }, { required: true }), hint),
      h('div', { class: 'grid2' }, field('対象の国', cSel), field('政策分野', topic)),
      h('div', { class: 'field' }, h('span', { class: 'field-label', text: '意見の窓口（どこ・誰・何に向けた声ですか？）' }), chips(KG.DESK_TYPES, d.deskType, (v) => { d.deskType = v; saveDraft(); drawDesk(); }, { required: true })),
      deskField],
    text, h('div', { class: 'row between' }, h('span', { class: 'muted small', text: '氏名・住所・電話番号などの個人情報は書かないでください。' }), count),
    quote && h('div', { class: 'quote' }, h('span', { class: 'muted small', text: `${quote.user.name} @${quote.user.handle}` }), h('span', { class: 'quote-body', text: quote.body })),
    !simple && [
      h('details', { class: 'more-fields', open: !!(d.stance || d.emotion || d.sat) }, h('summary', { text: '統計に協力する（任意）：立場・気持ち・暮らし向き' }),
        h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'この分野の、いまの政策を' }), chips(KG.STANCES, d.stance, (v) => { d.stance = v; saveDraft(); })),
        h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'いまの気持ち' }), chips(KG.EMOTIONS, d.emotion, (v) => { d.emotion = v; saveDraft(); })),
        h('div', { class: 'field' }, h('span', { class: 'field-label', text: 'いまの暮らし向き' }), chips(KG.SAT_LABELS.map((name, i) => ({ k: i + 1, name })), d.sat, (v) => { d.sat = v; saveDraft(); }))),
      !quote && h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { pollOn = e.target.checked; if (pollOn && !pollInputs.length) pollInputs.push(h('input', { type: 'text', maxLength: 40 }), h('input', { type: 'text', maxLength: 40 })); drawPoll(); } }), h('span', { text: '📊 アンケートを付ける（2〜4択）' })),
      pollBox],
    err, h('div', { class: 'row end' }, submit));
    const close = modal(simple ? '返信' : quote ? '引用して投稿' : '声を届ける', form, { wide: true });
    text.focus();
  }

  // ---------- 投稿の一覧 ----------
  function feedView(params, emptyText) {
    const list = h('div', { class: 'feed-list' });
    const more = h('button', { class: 'ghost block', text: 'もっと見る', hidden: true });
    const status = h('p', { class: 'muted center', text: '読み込み中…' });
    let last = null;
    async function load() {
      more.disabled = true;
      try {
        const out = await api('feed', { ...params, before: last });
        status.hidden = true;
        const posts = out.posts.filter((p) => !st.muted.has(p.user.handle));
        posts.forEach((p) => list.append(postCard(p, { showCountry: !!params.user || params.tab === 'bookmarks' })));
        if (out.posts.length) last = out.posts[out.posts.length - 1].id;
        more.hidden = !out.more;
        if (!list.children.length) { status.hidden = false; status.textContent = emptyText || 'まだ投稿がありません。最初の声を届けてみませんか？'; }
      } catch (e) { status.hidden = false; status.textContent = e.message; } finally { more.disabled = false; }
    }
    more.addEventListener('click', load);
    load();
    return h('div', { class: 'feed' }, list, status, more);
  }

  // ---------- 各ページ ----------
  const pages = {};
  const title = (text, sub) => h('div', { class: 'page-head' }, h('h1', { text }), sub && h('p', { class: 'muted', text: sub }));

  pages.home = () => {
    const state = store.get('kg_home', { tab: 'latest', kind: '', topic: '', deskType: '' });
    const box = h('div');
    const draw = () => {
      store.set('kg_home', state);
      const topic = select(KG.TOPICS, state.topic, 'すべての分野'); topic.addEventListener('change', () => { state.topic = topic.value; draw(); });
      const deskSel = select(KG.DESK_TYPES, state.deskType, 'すべての窓口'); deskSel.setAttribute('aria-label', '窓口の種類'); deskSel.addEventListener('change', () => { state.deskType = deskSel.value; draw(); });
      box.replaceChildren(
        h('div', { class: 'tabs sticky' }, [['latest', '新着'], ['popular', '人気'], ['following', 'フォロー中']].map(([k, n]) =>
          h('button', { class: 'tab' + (state.tab === k ? ' on' : ''), text: n, onclick: () => { if (k === 'following' && !requireLogin('フォロー中の投稿を見るにはログインが必要です。')) return; state.tab = k; draw(); } }))),
        h('button', { class: 'compose-teaser', onclick: () => openCompose() }, st.me ? avatar(st.me) : h('span', { class: 'av av0 notranslate', text: '声' }), h('span', { text: `${cName(st.country === 'ALL' ? (st.me ? st.me.country : 'JP') : st.country)} の政策に、あなたの声を届けよう` })),
        h('div', { class: 'filters' }, chips([{ k: '', name: 'すべて' }, ...KG.KINDS], state.kind, (v) => { state.kind = v || ''; draw(); }, { required: true }), deskSel, topic),
        feedView({ country: st.country, tab: state.tab, kind: state.kind, topic: state.topic, deskType: state.deskType },
          state.tab === 'following' ? 'フォロー中の人の投稿がここに並びます。気になる人をフォローしてみましょう。' : null));
    };
    draw();
    return box;
  };

  // 窓口の一覧（種類ごとに、投稿の多い順）
  pages.desks = () => {
    const f = { type: '', q: '' };
    const list = h('div', { class: 'desk-list' });
    const q = h('input', { type: 'search', placeholder: '窓口の名前でさがす（例：大阪、消費税）', 'aria-label': '窓口の名前でさがす' });
    let timer;
    const load = async () => {
      try {
        const out = await api('desks', { country: st.country, type: f.type, q: f.q });
        list.replaceChildren(...out.desks.map((d) => h('a', { class: 'desk-row', href: '#/desk/' + d.id },
          h('span', { class: 'desk-icon', text: deskType(d.type).icon }),
          h('span', { class: 'desk-main' }, h('b', { text: d.name }), h('small', { class: 'muted', text: `${deskType(d.type).name}・${cName(d.country)}` })),
          h('span', { class: 'muted small', text: d.posts.toLocaleString() + '件' }))));
        if (!out.desks.length) list.replaceChildren(h('p', { class: 'muted center pad', text: 'この条件の窓口はまだありません。「声を届ける」から新しい窓口を作れます。' }));
      } catch (e) { list.replaceChildren(h('p', { class: 'err pad', text: e.message })); }
    };
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { f.q = q.value.trim(); load(); }, 250); });
    load();
    const c = st.country === 'ALL' ? null : KG.country(st.country);
    return h('div', {}, title('意見の窓口', '国・州・県・市・政治家・政策・社会テーマなど、声を届ける先ごとに投稿と統計を見られます。'),
      h('div', { class: 'filters' }, chips([{ k: '', name: 'すべて' }, ...KG.DESK_TYPES.filter((t) => t.k !== 'country')], '', (v) => { f.type = v || ''; load(); }, { required: true })),
      h('div', { class: 'search-bar' }, q),
      c && h('a', { class: 'desk-row', href: '#/' }, h('span', { class: 'desk-icon', text: '🏛️' }), h('span', { class: 'desk-main' }, h('b', { text: c.name + '（国全体）' }), h('small', { class: 'muted', text: '国・' + cName(c.code) })), h('span', { class: 'muted small', text: 'ホームへ' })),
      list);
  };

  // 1つの窓口のページ
  pages.desk = (id) => {
    const head = h('div', { class: 'profile' }, h('p', { class: 'muted center', text: '読み込み中…' }));
    api('desks', { id }).then((out) => {
      const d = out.desks[0];
      if (!d) { head.replaceChildren(h('h1', { text: '窓口が見つかりません' })); return; }
      head.replaceChildren(
        h('div', { class: 'row' }, h('button', { class: 'icon-btn', 'aria-label': '戻る', text: '←', onclick: () => history.back() }), h('span', { class: 'muted', text: `${deskType(d.type).icon} ${deskType(d.type).name}の窓口・${cName(d.country)}` })),
        h('h1', { text: d.name }), h('p', { class: 'muted', text: `${d.posts.toLocaleString()}件の声` }),
        h('div', { class: 'row' }, h('button', { class: 'primary', text: '✏️ この窓口に声を届ける', onclick: () => openCompose({ desk: d }) }), h('a', { class: 'ghost btn', href: '#/stats?desk=' + d.id, text: '📊 統計を見る' }),
          h('button', { class: 'icon-btn', 'aria-label': 'この窓口を通報', title: 'この窓口を通報', text: '🚩', onclick: () => openReport(d, true) })));
    }).catch((e) => head.replaceChildren(h('p', { class: 'err', text: e.message })));
    return h('div', {}, head, feedView({ desk: id }, 'この窓口にはまだ投稿がありません。'));
  };

  pages.post = (id) => {
    const box = h('div', {}, h('p', { class: 'muted center', text: '読み込み中…' }));
    (async () => {
      try {
        const out = await api('feed', { id });
        const p = out.posts[0];
        if (!p) { box.replaceChildren(title('投稿が見つかりません'), h('p', { class: 'muted', text: '削除されたか、非表示になった可能性があります。' })); return; }
        box.replaceChildren(
          h('div', { class: 'page-head row' }, h('button', { class: 'icon-btn', 'aria-label': '戻る', text: '←', onclick: () => history.back() }), h('h1', { text: '投稿' })),
          p.parent && h('a', { class: 'muted small pad', href: '#/p/' + p.parent, text: '↑ 返信先の投稿を見る' }),
          postCard(p, { detail: true, showCountry: true }),
          h('h2', { class: 'sub-h', text: `返信（${p.replies}）` }),
          feedView({ parent: p.id }, 'まだ返信はありません。'));
      } catch (e) { box.replaceChildren(h('p', { class: 'err', text: e.message })); }
    })();
    return box;
  };

  pages.search = (arg, qs) => {
    const p = { q: qs.get('q') || '', topic: qs.get('topic') || '', tag: arg || '' };
    const input = h('input', { type: 'search', value: p.tag ? '#' + p.tag : p.q, placeholder: 'キーワード・#タグで検索', 'aria-label': '検索' });
    const topic = select(KG.TOPICS, p.topic, 'すべての分野');
    const submit = () => {
      const v = input.value.trim();
      if (/^[#＃]/.test(v)) go('#/tag/' + encodeURIComponent(v.slice(1).toLowerCase()));
      else go('#/search?' + new URLSearchParams({ ...(v && { q: v }), ...(topic.value && { topic: topic.value }) }));
    };
    topic.addEventListener('change', submit);
    const has = p.q || p.topic || p.tag;
    return h('div', {}, title('さがす'),
      h('form', { class: 'search-bar', onsubmit: (e) => { e.preventDefault(); submit(); } }, input, topic, h('button', { class: 'primary', text: '検索' })),
      has ? feedView({ country: st.country, q: p.q, topic: p.topic, tag: p.tag }, '該当する投稿は見つかりませんでした。') : h('div', { class: 'pad' }, trendsBox()));
  };

  function trendsBox() {
    const list = h('ol', { class: 'trends' });
    const box = h('section', { class: 'side-card' }, h('h2', { text: `話題のタグ（${st.country === 'ALL' ? 'すべての国' : (KG.country(st.country) || {}).name}・7日間）` }), list);
    api('trends', { country: st.country }).then((out) => {
      if (!out.tags.length) list.replaceWith(h('p', { class: 'muted', text: 'まだ話題のタグはありません。' }));
      out.tags.forEach((t) => list.append(h('li', {}, h('a', { href: '#/tag/' + encodeURIComponent(t.tag), text: '#' + t.tag }), h('span', { class: 'muted small', text: t.n + '件' }))));
    }).catch(() => {});
    return box;
  }

  pages.notifs = () => {
    if (!st.me) return loginWall('通知を見るにはログインが必要です。');
    const list = h('div', { class: 'feed-list' }, h('p', { class: 'muted center', text: '読み込み中…' }));
    const label = { reply: 'が返信しました', quote: 'が引用しました', like: 'が「いいね」しました', agree: 'が賛成しました', disagree: 'が反対しました', follow: 'にフォローされました' };
    const icon = { reply: '💬', quote: '🔁', like: '♡', agree: '⭕', disagree: '✖', follow: '👤' };
    api('notifications').then((out) => {
      store.set('kg_notif_seen', Date.now());
      list.replaceChildren(...out.items.map((n) => h('a', { class: 'notif', href: n.postId ? '#/p/' + n.postId : '#/u/' + n.user.handle },
        h('span', { class: 'notif-i', text: icon[n.type] }), h('div', {}, h('p', {}, h('b', { text: n.user.name }), ' さん' + label[n.type]), n.body && h('p', { class: 'muted small', text: n.body }), h('span', { class: 'muted small', text: ago(n.at) })))));
      if (!out.items.length) list.replaceChildren(h('p', { class: 'muted center', text: 'まだ通知はありません。' }));
    }).catch((e) => list.replaceChildren(h('p', { class: 'err', text: e.message })));
    return h('div', {}, title('通知'), list);
  };
  const loginWall = (msg) => h('div', { class: 'pad center' }, h('p', { class: 'muted', text: msg }), h('button', { class: 'primary', text: 'ログイン / 新規登録', onclick: () => openAuth('login') }));

  pages.bookmarks = () => (st.me ? h('div', {}, title('ブックマーク', '自分だけが見られる保存リストです。'), feedView({ tab: 'bookmarks' }, 'ブックマークした投稿がここに並びます。')) : loginWall('ブックマークを見るにはログインが必要です。'));

  pages.user = (handle) => {
    const head = h('div', { class: 'profile' }, h('p', { class: 'muted center', text: '読み込み中…' }));
    api('profile', { handle }).then(({ profile: u }) => {
      const followBtn = h('button', { class: u.followed ? 'ghost' : 'primary', text: u.followed ? 'フォロー中' : 'フォローする', onclick: async () => {
        if (!requireLogin()) return;
        try { const out = await api('follow', { handle }); u.followed = out.following; followBtn.className = u.followed ? 'ghost' : 'primary'; followBtn.textContent = u.followed ? 'フォロー中' : 'フォローする'; } catch (e) { fail(e); }
      } });
      head.replaceChildren(h('div', { class: 'row between' }, avatar(u, true), u.mine ? h('a', { class: 'ghost btn', href: '#/settings', text: 'プロフィールを編集' }) : followBtn),
        h('h1', { class: 'notranslate', text: u.name }), h('p', { class: 'muted', text: `@${u.handle}・${cName(u.country)}・${new Date(u.joined).getFullYear()}年${new Date(u.joined).getMonth() + 1}月から利用` }),
        u.bio && h('p', { class: 'body', text: u.bio }),
        h('p', { class: 'counts' }, h('span', {}, h('b', { text: u.posts.toLocaleString() }), ' 投稿'), h('span', {}, h('b', { text: u.following.toLocaleString() }), ' フォロー中'), h('span', {}, h('b', { text: u.followers.toLocaleString() }), ' フォロワー')));
    }).catch((e) => head.replaceChildren(h('p', { class: 'err', text: e.message })));
    return h('div', {}, head, feedView({ user: handle }, 'まだ投稿がありません。'));
  };

  pages.settings = () => {
    const box = h('div', {}, title('設定'));
    const themeSel = h('select', {}, [['auto', '端末の設定に合わせる'], ['light', 'ライト'], ['dark', 'ダーク']].map(([v, t]) => h('option', { value: v, text: t })));
    themeSel.value = store.get('kg_theme', 'auto');
    themeSel.addEventListener('change', () => { store.set('kg_theme', themeSel.value); applyTheme(); });
    if (st.me) {
      const name = h('input', { type: 'text', maxLength: 20, value: st.me.name }), bio = h('textarea', { rows: 3, maxLength: 160, value: st.me.bio || '' });
      const country = countrySelect(st.me.country), age = select(KG.AGES, st.me.age, '答えない'), gender = select(KG.GENDERS, st.me.gender, '答えない'), area = select(KG.AREAS, st.me.area, '答えない');
      box.append(h('form', { class: 'card', onsubmit: async (e) => {
        e.preventDefault();
        try { st.me = (await api('updateProfile', { name: name.value, bio: bio.value, country: country.value, age: age.value, gender: gender.value, area: area.value })).me; toast('保存しました。'); renderChrome(); } catch (ex) { fail(ex); }
      } }, h('h2', { text: 'プロフィール' }), field('表示名', name), field('自己紹介（160文字まで）', bio), field('主に声を届けたい国', country),
      h('fieldset', { class: 'attrs' }, h('legend', { text: '統計用の属性（任意・非公開）' }), h('div', { class: 'grid3' }, field('年代', age), field('性別', gender), field('お住まい', area))),
      h('button', { class: 'primary', text: '保存する' })));
    }
    box.append(h('div', { class: 'card' }, h('h2', { text: '表示' }), field('テーマ', themeSel)));
    box.append(h('div', { class: 'card' }, h('h2', { text: 'ミュート中のユーザー' }),
      st.muted.size ? [...st.muted].map((m) => h('div', { class: 'row between' }, h('span', { text: '@' + m }), h('button', { class: 'ghost', text: '解除', onclick: () => { st.muted.delete(m); store.set('kg_muted', [...st.muted]); route(); } }))) : h('p', { class: 'muted', text: 'ミュート中のユーザーはいません。' })));
    if (st.me && st.mode === 'live') {
      const cur = h('input', { type: 'password', autocomplete: 'current-password' }), nw = h('input', { type: 'password', autocomplete: 'new-password', minLength: 8 });
      box.append(h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); try { await api('changePassword', { current: cur.value, password: nw.value }); cur.value = nw.value = ''; toast('パスワードを変更しました。他の端末はログアウトされます。'); } catch (ex) { fail(ex); } } },
        h('h2', { text: 'パスワードの変更' }), field('現在のパスワード', cur), field('新しいパスワード（8文字以上）', nw), h('button', { class: 'primary', text: '変更する' })));
    }
    if (st.me) {
      box.append(h('div', { class: 'card' }, h('h2', { text: 'アカウント' }),
        h('button', { class: 'ghost', text: 'ログアウト', onclick: async () => { try { await api('logout'); } catch { /* 失敗しても画面上はログアウト */ } st.me = null; renderChrome(); go('#/'); toast('ログアウトしました。'); } }),
        h('p', { class: 'muted small', text: '退会すると、あなたの投稿・反応・属性データはすべて削除され、元に戻せません。' }),
        h('button', { class: 'ghost danger', text: '退会する（データを完全に削除）', onclick: async () => {
          const pw = st.mode === 'demo' ? '' : prompt('確認のためパスワードを入力してください。');
          if (pw === null || !confirm('本当に退会しますか？この操作は取り消せません。')) return;
          try { await api('deleteAccount', { password: pw }); st.me = null; renderChrome(); go('#/'); toast('退会しました。ご利用ありがとうございました。'); } catch (ex) { fail(ex); }
        } })));
    } else box.append(loginWall('ログインするとプロフィールを編集できます。'));
    if (st.me && st.me.isAdmin) box.append(h('div', { class: 'card' }, h('h2', { text: '運営者メニュー' }), h('a', { class: 'ghost btn', href: '#/admin', text: '通報の確認・集計の自動発信' })));
    if (st.mode === 'demo') box.append(h('div', { class: 'card' }, h('h2', { text: 'デモデータ' }), h('p', { class: 'muted small', text: 'この端末に保存されたデモ用の投稿・アカウントを消して、最初の状態に戻します。' }),
      h('button', { class: 'ghost', text: 'デモデータを初期化', onclick: () => { if (!confirm('デモデータを初期化しますか？')) return; window.KGDemo.reset(); st.me = null; renderChrome(); go('#/'); } })));
    box.append(h('p', { class: 'center' }, h('a', { href: '#/about', text: '利用ルールとプライバシー' })));
    return box;
  };

  // 運営者：集計結果の自動発信（週報）の下見と、今すぐ発信
  function digestBox() {
    const box = h('div', { class: 'card' }, h('h2', { text: '集計結果の自動発信（週報）' }), h('p', { class: 'muted', text: '読み込み中…' }));
    const load = () => api('adminDigest').then((d) => {
      const any = d.platforms.some((x) => x.on);
      const send = h('button', { class: 'primary', text: '今すぐ発信する', disabled: !any, onclick: async () => {
        if (!confirm('設定済みのSNSに、下の内容を今すぐ投稿します。よろしいですか？')) return;
        send.disabled = true;
        try { const out = await api('adminDigestSend'); const skipped = out.results.find((r) => r.skipped);
          toast(out.results.some((r) => r.ok) ? '発信しました。' : skipped ? '発信しませんでした：' + skipped.skipped : '発信に失敗しました。下の記録を確認してください。'); load(); } catch (e) { fail(e); send.disabled = false; }
      } });
      box.replaceChildren(...h('div', {}, h('h2', { text: '集計結果の自動発信（週報）' }),
        h('p', { class: 'muted small', text: `毎週月曜の朝9時（日本時間）に、直近7日間の集計を自動で投稿します。投稿者が${d.minUsers}人未満の週は発信しません。` }),
        h('div', { class: 'badges' }, d.platforms.map((x) => h('span', { class: 'badge' + (x.on ? ' st-support' : ''), text: `${x.name}：${x.on ? '設定済み' : '未設定'}` }))),
        !any && h('p', { class: 'note', text: 'SNSの鍵がまだ設定されていないため、発信は行われません。Vercel の環境変数に鍵を入れると有効になります。' }),
        d.previews.map((pv) => h('div', {}, h('p', { class: 'field-label', text: `発信される内容（${cName(pv.country)}・投稿者 ${pv.users}人）` }),
          pv.skip && h('p', { class: 'err', text: '今週は発信されません：' + pv.skip }),
          h('pre', { class: 'digest notranslate', text: pv.short }), h('details', {}, h('summary', { class: 'small', text: '長い版（Mastodon用）を見る' }), h('pre', { class: 'digest notranslate', text: pv.long })))),
        h('div', { class: 'row' }, send),
        h('p', { class: 'muted small' }, 'YouTube 用の動画は「統計」ページの「🎬 動画を作る」から作れます（期間を「直近7日」にすると週報になります）。 ', h('a', { href: '#/stats', text: '統計ページへ' })),
        d.history.length ? h('details', {}, h('summary', { class: 'small', text: `発信の記録（${d.history.length}件）` }), KGChart.table(['日時', '国', 'SNS', '結果', '詳細'], d.history.map((r) => [new Date(r.at).toLocaleString('ja-JP'), r.country, r.platform, r.ok ? '成功' : '失敗', h('span', { class: 'small', text: r.detail || '' })]))) : null).childNodes);
    }).catch((e) => box.replaceChildren(h('h2', { text: '集計結果の自動発信（週報）' }), h('p', { class: 'err', text: e.message })));
    load();
    return box;
  }

  pages.admin = () => {
    const list = h('div', {}, h('p', { class: 'muted pad', text: '読み込み中…' }));
    // 通報1件ぶんのカード（投稿・窓口で共通）。ボタンで非表示／再表示を切り替える
    const item = (r, head, body, action) => {
      const state = h('span', { class: 'badge' + (r.hidden ? ' st-oppose' : ''), text: r.hidden ? '非表示中' : '表示中' });
      const btn = h('button', { class: 'ghost', text: r.hidden ? '再表示する' : '非表示にする', onclick: async () => {
        try { await api(action, { id: r.id, hidden: !r.hidden }); r.hidden = !r.hidden; btn.textContent = r.hidden ? '再表示する' : '非表示にする'; state.textContent = r.hidden ? '非表示中' : '表示中'; state.className = 'badge' + (r.hidden ? ' st-oppose' : ''); toast(r.hidden ? '非表示にしました。' : '再表示しました。'); } catch (e) { fail(e); }
      } });
      return h('div', { class: 'card' }, h('div', { class: 'row between' }, h('span', { class: 'muted small', text: `${head}・通報 ${r.n}件` }), state), h('p', { class: 'body', text: body }), h('ul', {}, r.reasons.map((x) => h('li', { class: 'small', text: x }))), btn);
    };
    api('adminReports').then((out) => {
      const none = () => h('p', { class: 'muted pad', text: '通報はありません。' });
      list.replaceChildren(
        h('h2', { class: 'sub-h', text: `窓口への通報（${out.desks.length}）` }),
        ...(out.desks.length ? out.desks.map((d) => item(d, `${deskType(d.type).name}の窓口・${cName(d.country)}・投稿 ${d.posts}件`, d.name, 'adminHideDesk')) : [none()]),
        h('h2', { class: 'sub-h', text: `投稿への通報（${out.reports.length}）` }),
        ...(out.reports.length ? out.reports.map((r) => item(r, '@' + r.handle, r.body, 'adminHide')) : [none()]));
    }).catch((e) => list.replaceChildren(h('p', { class: 'err pad', text: e.message })));
    return h('div', {}, title('運営者メニュー'), digestBox(),
      title('通報の確認', '意見の違いではなく、ルール違反かどうかで判断してください。窓口を非表示にしても、投稿そのものは残ります。'), list);
  };

  pages.about = () => h('div', { class: 'prose' }, title('クニゴエについて'),
    h('h2', { text: 'クニゴエとは' }), h('p', { text: '国を選び、さらに州・県・市・政治家・政策・社会テーマなどの「窓口」を選んで、政策に対する「生活の現状」「気持ち」「意見」「政策提言」を届ける、政治に特化した市民の声のSNSです。集まった声は自動で集計され、誰でも統計として見ることができます。' }),
    h('h2', { text: '利用ルール' }), h('ul', {}, ['特定の個人や集団への誹謗中傷・差別・脅迫はしない', '氏名・住所・電話番号など、自分や他人の個人情報を書かない', '事実と異なる情報を、事実であるかのように広めない', '同じ内容の連続投稿や、なりすまし・多重登録による水増しをしない', '意見の違う相手にも敬意を払う（反対は「反対」ボタンで示せます）'].map((t) => h('li', { text: t }))),
    h('p', { text: 'ルールに反する投稿や、不適切な名前の窓口は、通報をもとに運営が確認し、非表示にすることがあります。立場や意見の内容を理由に非表示にすることはありません。' }),
    h('h2', { text: 'プライバシー' }), h('ul', {}, ['メールアドレス・電話番号・本名は集めません（ユーザーIDとパスワードだけで使えます）', 'パスワードは復元できない形（ハッシュ）で保存します', '年代・性別・お住まいの区分は任意で、集計にだけ使い、プロフィールには表示しません', '集計では、3人未満の少人数の区分は表示しません（個人が推測されるのを防ぐため）', '投稿に含まれるメールアドレスや電話番号らしき文字列は、自動で伏せ字にします', '退会すると、投稿や属性を含むすべてのデータが削除されます', '広告用の追跡（トラッキング）は行いません', '画面の言語を日本語以外にしたときだけ、自動翻訳のために画面の文字（投稿を含む）が Google に送られます。日本語のままなら送られません'].map((t) => h('li', { text: t }))),
    h('h2', { text: '統計を読むときの注意' }), h('p', { text: 'クニゴエの統計は、自分から投稿した人の声の集計です。無作為に選んだ人に聞く世論調査とは違い、利用者の年代や関心にかたよりがあります。「社会全体の割合」ではなく「ここに集まった声の傾向」としてお読みください。立場と暮らし向きは、同じ人が何度投稿しても1人1回（最新の回答）として数えています。' }));

  // ---------- 統計ページ ----------
  const V = (name) => `var(--${name})`;
  const STANCE_COLOR = { support: V('c-support'), neutral: V('c-neutral'), oppose: V('c-oppose') };
  const stanceParts = (r) => KG.STANCES.map((s) => ({ name: s.name, value: r[s.k], color: STANCE_COLOR[s.k], dark: s.k !== 'neutral' }));
  function chartCard(heading, sub, chart, tbl) {
    const body = h('div', { class: 'chart-body' }, chart);
    let showTable = false;
    const btn = tbl && h('button', { class: 'link small', text: '表で見る', onclick: () => { showTable = !showTable; btn.textContent = showTable ? 'グラフで見る' : '表で見る'; body.replaceChildren(showTable ? KGChart.table(tbl.cols, tbl.rows) : chart); } });
    return h('section', { class: 'card chart-card' }, h('div', { class: 'row between' }, h('h2', { text: heading }), btn), sub && h('p', { class: 'muted small', text: sub }), body);
  }
  const empty = () => h('p', { class: 'muted', text: 'この条件ではまだ十分なデータがありません。' });

  // YouTube 用の動画・サムネイル・説明文を作る（半自動：保存して自分で投稿する）
  function openVideoMaker(stats, meta) {
    let vertical = true;
    const out = h('div', { class: 'video-out' });
    const bar = h('progress', { max: 100, value: 0, hidden: true, class: 'video-bar' });
    const status = h('p', { class: 'muted small' });
    const copyBtn = (label, getText) => h('button', { type: 'button', class: 'ghost', text: label, onclick: async () => {
      try { await navigator.clipboard.writeText(getText()); toast('コピーしました。'); } catch { toast('コピーできませんでした。文字を選んでコピーしてください。'); }
    } });
    const make = h('button', { class: 'primary', text: '🎬 動画を作る', onclick: async () => {
      make.disabled = true; bar.hidden = false; bar.value = 0;
      const W = vertical ? 1080 : 1920, H = vertical ? 1920 : 1080;
      const canvas = h('canvas', { width: W, height: H, class: 'video-canvas' + (vertical ? ' v' : '') });
      out.replaceChildren(canvas);
      const m = { ...meta, vertical };
      status.textContent = '作成中です…（30秒ほどかかります。このタブを開いたままにしてください）';
      try {
        const r = await KGVideo.record(canvas, stats, m, (p) => { bar.value = Math.round(p * 100); });
        const url = URL.createObjectURL(r.blob);
        const thumb = await KGVideo.thumbnail(stats, m);
        const md = KGVideo.metadata(stats, m);
        const date = new Date().toISOString().slice(0, 10);
        const title = h('input', { type: 'text', readOnly: true, value: md.title });
        const desc = h('textarea', { rows: 10, readOnly: true, value: md.description });
        status.textContent = `できました（${r.seconds}秒・${r.slides}枚の場面）。内容を確認してから保存してください。`;
        out.replaceChildren(
          h('video', { src: url, controls: true, playsInline: true, class: 'video-canvas' + (vertical ? ' v' : '') }),
          h('div', { class: 'row wrap' },
            h('a', { class: 'primary btn', href: url, download: `kunigoe_${date}_${vertical ? 'short' : 'video'}.${r.ext}`, text: '⬇ 動画を保存' }),
            !vertical && h('a', { class: 'ghost btn', href: thumb, download: `kunigoe_${date}_thumbnail.png`, text: '⬇ サムネイル画像を保存' })),
          !vertical && h('img', { src: thumb, alt: 'サムネイル画像', class: 'video-thumb' }),
          field('タイトル（YouTube に貼り付け）', title), h('div', { class: 'row' }, copyBtn('タイトルをコピー', () => md.title)),
          field('説明文（YouTube に貼り付け）', desc), h('div', { class: 'row' }, copyBtn('説明文をコピー', () => md.description)),
          h('ol', { class: 'steps small' },
            h('li', { text: '「動画を保存」で動画をパソコンやスマホに保存する' }),
            h('li', { text: 'YouTube Studio（またはYouTubeアプリ）で「作成」→「動画をアップロード」から保存した動画を選ぶ' }),
            h('li', { text: 'タイトルと説明文をコピーして貼り付ける' + (vertical ? '（縦長で3分以内なのでショートとして公開されます）' : '。サムネイル画像も設定する') }),
            h('li', { text: '数字に誤りや不適切なタグがないか確認してから公開する' })));
      } catch (e) { status.textContent = ''; out.replaceChildren(h('p', { class: 'err', text: e.message })); }
      finally { make.disabled = false; bar.hidden = true; }
    } });
    modal('YouTube用の動画を作る', h('div', { class: 'modal-body' },
      h('p', { class: 'muted small', text: `いま表示している統計（${meta.where}・${meta.period}${meta.sub ? '・' + meta.sub : ''}）から、約30秒の動画・サムネイル・説明文を作ります。動画はこの端末の中で作るので、データが外に送られることはありません。` }),
      meta.demo && h('p', { class: 'note', text: '⚠ 現在はデモ用の架空データです。動画にも「デモ・架空データ」と表示されます。公開しないでください。' }),
      h('div', { class: 'field' }, h('span', { class: 'field-label', text: '動画の形' }),
        chips([{ k: 'v', name: '📱 縦長（ショート向け・1080×1920）' }, { k: 'h', name: '🖥️ 横長（通常の動画・1920×1080）' }], 'v', (v) => { vertical = v === 'v'; }, { required: true })),
      h('div', { class: 'row' }, make), bar, status, out), { wide: true });
  }

  pages.stats = (qs) => {
    const f = store.get('kg_stats', { days: 30, topic: '', deskType: '' });
    const deskId = Number(qs.get('desk')) || null;
    const out = h('div', { class: 'stats' }, h('p', { class: 'muted center', text: '集計中…' }));
    const country = countrySelect(st.country, true);
    country.addEventListener('change', () => { setCountry(country.value); });
    const days = h('select', { 'aria-label': '期間' }, [[7, '直近7日'], [30, '直近30日'], [90, '直近90日'], [0, '全期間']].map(([v, t]) => h('option', { value: v, text: t })));
    days.value = f.days;
    const topic = select(KG.TOPICS, f.topic, 'すべての分野');
    const deskSel = select(KG.DESK_TYPES, deskId ? '' : f.deskType, 'すべての窓口'); deskSel.setAttribute('aria-label', '窓口の種類');
    const reload = () => { f.days = Number(days.value); f.topic = topic.value; if (!deskId) f.deskType = deskSel.value; store.set('kg_stats', f); load(); };
    days.addEventListener('change', reload); topic.addEventListener('change', reload); deskSel.addEventListener('change', reload);
    // 特定の窓口だけの統計（窓口ページの「統計を見る」から来たとき）
    const deskChip = h('p', { class: 'note', hidden: !deskId });
    if (deskId) api('desks', { id: deskId }).then((o) => { const d = o.desks[0]; if (d) deskName = `${d.name}（${cName(d.country).replace(/^\S+\s/, '')}）`;
      if (d) deskChip.replaceChildren(`窓口「${deskLabel(d)}」（${cName(d.country)}）に届いた声だけを集計しています。 `, h('a', { href: '#/stats', text: '絞り込みを解除' })); }).catch(() => {});
    let csvRows = [], lastStats = null, deskName = '';
    const videoBtn = h('button', { class: 'ghost', text: '🎬 動画を作る', onclick: () => {
      if (!lastStats) return;
      const sel = (x) => x.selectedOptions[0].textContent;
      const now = new Date(), d0 = new Date(now - (f.days - 1) * 864e5), md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
      const period = f.days ? (f.days === 7 ? `${md(d0)}〜${md(now)}` : `${sel(days)}（${md(d0)}〜${md(now)}）`) : '全期間';
      const c = deskId ? null : st.country === 'ALL' ? null : KG.country(st.country);
      openVideoMaker(lastStats, {
        where: deskId ? (deskName || '窓口') : c ? c.name : '世界', period, demo: st.mode === 'demo',
        sub: [!deskId && f.deskType && sel(deskSel), f.topic && sel(topic)].filter(Boolean).join('・'),
        url: location.origin + location.pathname,
      });
    } });
    const csvBtn = h('button', { class: 'ghost', text: '⬇ CSVで保存', onclick: () => {
      const esc = (v) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const blob = new Blob(['﻿' + csvRows.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `kunigoe_${st.country}_${new Date().toISOString().slice(0, 10)}.csv` });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } });

    async function load() {
      let s;
      try { s = await api('stats', { country: deskId ? 'ALL' : st.country, days: f.days, topic: f.topic, desk: deskId, deskType: deskId ? '' : f.deskType }); } catch (e) { out.replaceChildren(h('p', { class: 'err', text: e.message })); return; }
      const C = KGChart, nm = KG.nameOf, total = s.totals.posts;
      lastStats = s;
      csvRows = [['クニゴエ 統計', cName(st.country === 'ALL' ? '' : st.country) || 'すべての国', days.selectedOptions[0].textContent, topic.selectedOptions[0].textContent], []];
      const csv = (name, cols, rows) => { csvRows.push([name], cols, ...rows, []); return { cols, rows }; };
      const sorted = (list) => list.slice().sort((a, b) => b.n - a.n);
      const ordered = (list, defs) => defs.map((d) => list.find((x) => x.k === d.k) || { k: d.k, n: 0 });
      const cards = [];

      // 1. 推移
      const dayMap = new Map(s.byDay.map((d) => [d.d, d.n])), series = [];
      const span = f.days || 90, today = new Date();
      for (let i = span - 1; i >= 0; i--) { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i); const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; series.push({ d: key, n: dayMap.get(key) || 0 }); }
      cards.push(h('div', { class: 'span2' }, chartCard('投稿数の推移', `日ごとの投稿数${f.days ? '' : '（直近90日）'}`, C.line(series), csv('投稿数の推移', ['日付', '投稿数'], series.map((d) => [d.d, d.n])))));

      // 2. 種類
      const kinds = ordered(s.byKind, KG.KINDS);
      cards.push(chartCard('声の種類', '投稿の内訳', total ? C.hbar(kinds.map((x, i) => ({ label: nm(KG.KINDS, x.k), value: x.n, color: V('s' + (i + 1)), note: C.pct(x.n, total) + '%' }))) : empty(),
        csv('声の種類', ['種類', '投稿数', '割合(%)'], kinds.map((x) => [nm(KG.KINDS, x.k), x.n, C.pct(x.n, total)]))));

      // 窓口の種類
      const dts = ordered(s.deskTypes, KG.DESK_TYPES), dTotal = dts.reduce((a, x) => a + x.n, 0);
      if (!deskId) cards.push(chartCard('声の届け先（窓口の種類）', '返信を除く投稿の内訳', dTotal ? C.hbar(dts.map((x) => ({ label: `${deskType(x.k).icon} ${deskType(x.k).name}`, value: x.n, note: C.pct(x.n, dTotal) + '%' }))) : empty(),
        csv('声の届け先（窓口の種類）', ['窓口の種類', '投稿数', '割合(%)'], dts.map((x) => [deskType(x.k).name, x.n, C.pct(x.n, dTotal)]))));

      // 3. 気持ち
      const emos = ordered(s.emotions, KG.EMOTIONS), eTotal = emos.reduce((a, x) => a + x.n, 0);
      cards.push(chartCard('気持ちの分布', `気持ちを選んだ投稿 ${eTotal.toLocaleString()}件`, eTotal ? C.hbar(emos.map((x, i) => ({ label: `${KG.EMOTIONS[i].icon} ${KG.EMOTIONS[i].name}`, value: x.n, color: V('s' + (i + 1)), note: C.pct(x.n, eTotal) + '%' }))) : empty(),
        csv('気持ちの分布', ['気持ち', '投稿数', '割合(%)'], emos.map((x) => [nm(KG.EMOTIONS, x.k), x.n, C.pct(x.n, eTotal)]))));

      // 4. 分野別の関心
      const topics = sorted(s.topicCount), tTotal = topics.reduce((a, x) => a + x.n, 0);
      cards.push(chartCard('関心の高い政策分野', '分野ごとの投稿数（分野の絞り込みに関係なく表示）', topics.length ? C.hbar(topics.map((x) => ({ label: nm(KG.TOPICS, x.k), value: x.n, note: C.pct(x.n, tTotal) + '%' }))) : empty(),
        csv('関心の高い政策分野', ['分野', '投稿数', '割合(%)'], topics.map((x) => [nm(KG.TOPICS, x.k), x.n, C.pct(x.n, tTotal)]))));

      // 5. 分野別の政策評価
      const stCols = ['区分', '支持', 'どちらともいえない', '不支持', '回答者数'];
      const stRows = (list, defs) => list.map((r) => [nm(defs, r.k), r.support, r.neutral, r.oppose, r.n]);
      cards.push(chartCard('政策への評価（分野別）', '1人1票換算：同じ人が何度投稿しても、分野ごとに最新の立場を1回だけ数えます',
        s.topicStance.length ? C.stacked(s.topicStance.map((r) => ({ label: nm(KG.TOPICS, r.k), parts: stanceParts(r) }))) : empty(), csv('政策への評価（分野別）', stCols, stRows(s.topicStance, KG.TOPICS))));

      // 6. 暮らし向き
      const SAT_C = ['c-sat1', 'c-sat2', 'c-sat3', 'c-sat4', 'c-sat5'].map(V);
      const satParts = KG.SAT_LABELS.map((name, i) => ({ name, value: s.sat.dist[i], color: SAT_C[i], dark: i === 0 || i === 4 }));
      cards.push(chartCard('暮らし向き', `回答者 ${s.sat.n.toLocaleString()}人（1人1回・最新の回答）`,
        s.sat.n ? h('div', {}, h('div', { class: 'hero' }, h('span', { class: 'hero-n notranslate', text: s.sat.avg.toFixed(2) }), h('span', { class: 'muted', text: '／5　平均（1＝とても苦しい、5＝とてもゆとりがある）' })), C.stacked([{ label: '全体', parts: satParts }])) : empty(),
        csv('暮らし向き', ['回答', '人数', '割合(%)'], KG.SAT_LABELS.map((n, i) => [n, s.sat.dist[i], C.pct(s.sat.dist[i], s.sat.n)]))));

      const satBars = (list, defs) => C.hbar(list.map((x) => ({ label: nm(defs, x.k), value: Math.round(x.avg * 100) / 100, note: `n=${x.n}` })), { max: 5, fmt: (v) => v.toFixed(2) });
      cards.push(chartCard('暮らし向きの平均（年代別）', '5点満点。数字が大きいほど「ゆとりがある」', s.sat.byAge.length ? satBars(s.sat.byAge, KG.AGES) : empty(), csv('暮らし向きの平均（年代別）', ['年代', '平均', '回答者数'], s.sat.byAge.map((x) => [nm(KG.AGES, x.k), x.avg.toFixed(2), x.n]))));
      cards.push(chartCard('暮らし向きの平均（お住まい別）', '5点満点。数字が大きいほど「ゆとりがある」', s.sat.byArea.length ? satBars(s.sat.byArea, KG.AREAS) : empty(), csv('暮らし向きの平均（お住まい別）', ['お住まい', '平均', '回答者数'], s.sat.byArea.map((x) => [nm(KG.AREAS, x.k), x.avg.toFixed(2), x.n]))));

      // 7. 属性別の評価
      cards.push(chartCard('政策への評価（年代別）', '1人1票換算', s.stanceByAge.length ? C.stacked(s.stanceByAge.map((r) => ({ label: nm(KG.AGES, r.k), parts: stanceParts(r) }))) : empty(), csv('政策への評価（年代別）', stCols, stRows(s.stanceByAge, KG.AGES))));
      cards.push(chartCard('政策への評価（性別）', '1人1票換算', s.stanceByGender.length ? C.stacked(s.stanceByGender.map((r) => ({ label: nm(KG.GENDERS, r.k), parts: stanceParts(r) }))) : empty(), csv('政策への評価（性別）', stCols, stRows(s.stanceByGender, KG.GENDERS))));

      // 8. 回答者の属性
      const demoCard = (name, list, defs) => { const t = list.reduce((a, x) => a + x.n, 0); return chartCard(name, '投稿した人のうち、属性を登録した人の内訳', list.length ? C.hbar(list.map((x) => ({ label: nm(defs, x.k), value: x.n, note: C.pct(x.n, t) + '%' }))) : empty(), csv(name, ['区分', '人数', '割合(%)'], list.map((x) => [nm(defs, x.k), x.n, C.pct(x.n, t)]))); };
      cards.push(demoCard('投稿者の年代', s.demo.age, KG.AGES), demoCard('投稿者の性別', s.demo.gender, KG.GENDERS), demoCard('投稿者のお住まい', s.demo.area, KG.AREAS));

      // 9. タグ・提言・国別（表）
      const link = (href, text) => h('a', { href, text });
      csv('話題のタグ', ['順位', 'タグ', '投稿数'], s.tags.map((t, i) => [i + 1, '#' + t.tag, t.n]));
      cards.push(h('section', { class: 'card chart-card' }, h('h2', { text: '話題のタグ' }), s.tags.length ? C.table(['タグ', '投稿数'], s.tags.map((t) => [link('#/tag/' + encodeURIComponent(t.tag), '#' + t.tag), t.n])) : empty()));
      csv('賛同の多い政策提言', ['順位', '提言', '分野', '賛同', '反対'], s.proposals.map((p, i) => [i + 1, p.body, nm(KG.TOPICS, p.topic), p.agrees, p.disagrees]));
      cards.push(h('div', { class: 'span2' }, h('section', { class: 'card chart-card' }, h('h2', { text: '賛同の多い政策提言' }), h('p', { class: 'muted small', text: '賛同から反対を引いた数が多い順' }),
        s.proposals.length ? C.table(['提言', '分野', '賛同', '反対'], s.proposals.map((p) => [link('#/p/' + p.id, p.body), nm(KG.TOPICS, p.topic), p.agrees, p.disagrees])) : empty())));
      csv('声の多い窓口', ['順位', '種類', '窓口', '国', '投稿数', '投稿者数'], s.desks.map((d, i) => [i + 1, deskType(d.type).name, d.name, (KG.country(d.country) || {}).name || d.country, d.n, d.users]));
      if (!deskId) cards.push(h('section', { class: 'card chart-card' }, h('h2', { text: '声の多い窓口' }), h('p', { class: 'muted small', text: '国以外の窓口（州・県・市・政治家・政策・社会テーマなど）' }),
        s.desks.length ? C.table(['窓口', '種類', '投稿数', '投稿者数'], s.desks.map((d) => [link('#/desk/' + d.id, d.name), deskType(d.type).name, d.n, d.users])) : empty()));
      const cTotal = s.countries.reduce((a, x) => a + x.n, 0);
      cards.push(h('div', { class: 'span2' }, chartCard('国別の投稿数', '国の絞り込みに関係なく、上位15か国を表示', s.countries.length ? C.hbar(s.countries.map((x) => ({ label: cName(x.k), value: x.n, note: `${x.users}人` }))) : empty(),
        csv('国別の投稿数', ['国', '投稿数', '投稿者数', '割合(%)'], s.countries.map((x) => [(KG.country(x.k) || {}).name || x.k, x.n, x.users, C.pct(x.n, cTotal)])))));

      const tile = (label, value, sub) => h('div', { class: 'tile' }, h('span', { class: 'tile-l', text: label }), h('span', { class: 'tile-v notranslate', text: value }), sub && h('span', { class: 'muted small', text: sub }));
      const sup = s.topicStance.reduce((a, r) => a + r.support, 0), opp = s.topicStance.reduce((a, r) => a + r.oppose, 0), sn = s.topicStance.reduce((a, r) => a + r.n, 0);
      out.replaceChildren(
        h('div', { class: 'tiles' }, tile('投稿数', total.toLocaleString(), `うち直近24時間 ${s.totals.today.toLocaleString()}件`), tile('投稿した人', s.totals.users.toLocaleString(), '人'),
          tile('政策を支持', sn ? C.pct(sup, sn) + '%' : '—', sn ? `不支持 ${C.pct(opp, sn)}%` : 'データなし'), tile('暮らし向き平均', s.sat.avg ? s.sat.avg.toFixed(2) : '—', '5点満点')),
        h('p', { class: 'note' }, '⚠ この統計は、自分から投稿した人の声の集計です。無作為抽出の世論調査とは異なり、社会全体の割合を示すものではありません。',
          `個人が推測されないよう、${s.minCell}人未満の区分は表示していません。`, st.mode === 'demo' && ' 現在はデモ用の架空データです。'),
        h('div', { class: 'chart-grid' }, cards));
    }
    load();
    return h('div', {}, title('みんなの声の統計', '集まった声を、表とグラフで見える化します。'),
      h('div', { class: 'filters stats-filters' }, !deskId && country, days, !deskId && deskSel, topic, csvBtn, videoBtn), deskChip, out);
  };

  // ---------- 画面の枠 ----------
  function setCountry(code) { st.country = code; store.set('kg_country', code); renderChrome(); route(); }
  function openCountryPicker() {
    const q = h('input', { type: 'search', placeholder: '国名でさがす', 'aria-label': '国名でさがす' });
    const grid = h('div', { class: 'country-grid' });
    const draw = () => {
      const list = [{ code: 'ALL', name: 'すべての国', flag: '🌐' }, ...KG.COUNTRIES].filter((c) => !q.value || c.name.includes(q.value.trim()) || c.code.toLowerCase() === q.value.trim().toLowerCase());
      grid.replaceChildren(...list.map((c) => h('button', { class: 'country' + (c.code === st.country ? ' on' : ''), onclick: () => { close(); setCountry(c.code); } }, h('span', { class: 'flag', text: c.flag }), h('span', { text: c.name }))));
    };
    q.addEventListener('input', draw); draw();
    const close = modal('国をえらぶ', h('div', { class: 'modal-body' }, q, grid), { wide: true });
  }
  const NAV = [['#/', '🏠', 'ホーム'], ['#/desks', '🏛️', '窓口'], ['#/search', '🔍', 'さがす'], ['#/stats', '📊', '統計'], ['#/notifs', '🔔', '通知'], ['#/bookmarks', '🔖', 'ブックマーク'], ['#/settings', '⚙️', '設定']];
  function renderChrome() {
    const cur = '#/' + (location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] || '');
    const links = (list) => list.map(([href, icon, name]) => h('a', { class: 'nav-item' + (cur === href ? ' on' : ''), href, 'aria-current': cur === href ? 'page' : null }, h('span', { class: 'nav-i', text: icon }), h('span', { class: 'nav-t', text: name })));
    const c = st.country === 'ALL' ? { flag: '🌐', name: 'すべての国' } : KG.country(st.country);
    $('#country-btn').replaceChildren(h('span', { class: 'flag', text: c.flag }), h('span', { text: c.name }), h('span', { class: 'muted', text: '▾' }));
    $('#nav').replaceChildren(...links(NAV),
      h('button', { class: 'primary block nav-post', text: '✏️ 声を届ける', onclick: () => openCompose() }),
      st.me ? h('a', { class: 'me', href: '#/u/' + st.me.handle }, avatar(st.me), h('span', { class: 'notranslate' }, h('b', { text: st.me.name }), h('small', { class: 'muted', text: '@' + st.me.handle })))
        : h('button', { class: 'ghost block', text: 'ログイン / 新規登録', onclick: () => openAuth('login') }));
    $('#tabbar').replaceChildren(...links([NAV[0], NAV[1], NAV[2], NAV[3], NAV[4], st.me ? ['#/u/' + st.me.handle, '👤', 'マイページ'] : NAV[6]]));
    $('#side').replaceChildren(trendsBox(), h('section', { class: 'side-card' }, h('h2', { text: 'クニゴエとは' }), h('p', { class: 'small', text: '国を選んで、政策への「暮らしの実情・気持ち・意見・提言」を届ける市民の声のSNS。集まった声は統計として誰でも見られます。' }), h('a', { class: 'small', href: '#/about', text: '利用ルールとプライバシー' })));
    $('#demo-banner').hidden = st.mode !== 'demo';
  }
  function applyTheme() {
    const t = store.get('kg_theme', 'auto');
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  }

  function route() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, query = ''] = raw.split('?');
    const [name, ...rest] = path.split('/');
    const arg = decodeURIComponent(rest.join('/') || '');
    const qs = new URLSearchParams(query);
    const table = { '': () => pages.home(), search: () => pages.search('', qs), tag: () => pages.search(arg, qs), stats: () => pages.stats(qs), desks: () => pages.desks(), desk: () => pages.desk(Number(arg)), notifs: () => pages.notifs(), bookmarks: () => pages.bookmarks(), u: () => pages.user(arg.toLowerCase()), p: () => pages.post(Number(arg)), settings: () => pages.settings(), about: () => pages.about(), admin: () => pages.admin() };
    document.body.classList.toggle('wide-page', name === 'stats');
    $('#main').replaceChildren((table[name] || table[''])());
    renderChrome();
    window.scrollTo(0, 0);
  }

  async function start() {
    applyTheme();
    if (!KG.country(st.country) && st.country !== 'ALL') st.country = 'JP';
    try { st.me = (await api('me')).me; } catch (e) {
      // サーバーまたはデータベースが未設定のときは、端末内だけで動くデモモードに切り替える
      st.mode = 'demo';
      try { st.me = (await api('me')).me; } catch { st.me = null; }
    }
    $('#country-btn').addEventListener('click', openCountryPicker);
    $('#fab').addEventListener('click', () => openCompose());
    window.addEventListener('hashchange', route);
    route();
  }
  start();
})();
