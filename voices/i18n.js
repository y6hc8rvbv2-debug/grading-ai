// クニゴエ：画面の言語切り替え（右上の地球儀ボタン）
// 日本語以外を選ぶと、Google の翻訳サービスで画面と投稿を自動翻訳する。
// プライバシーのため、日本語のままなら Google には一切つながない（選んだときだけ読み込む）。
(function () {
  'use strict';
  const LANGS = [
    ['ja', '日本語'], ['en', 'English'], ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'], ['ko', '한국어'], ['es', 'Español'],
    ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português'], ['it', 'Italiano'], ['ru', 'Русский'], ['ar', 'العربية'],
    ['hi', 'हिन्दी'], ['bn', 'বাংলা'], ['id', 'Bahasa Indonesia'], ['vi', 'Tiếng Việt'], ['th', 'ไทย'], ['tr', 'Türkçe'],
    ['af', 'Afrikaans'], ['sq', 'Shqip'], ['am', 'አማርኛ'], ['hy', 'Հայերեն'], ['as', 'অসমীয়া'], ['az', 'Azərbaycan'],
    ['eu', 'Euskara'], ['be', 'Беларуская'], ['bs', 'Bosanski'], ['bg', 'Български'], ['ca', 'Català'], ['ceb', 'Cebuano'],
    ['co', 'Corsu'], ['hr', 'Hrvatski'], ['cs', 'Čeština'], ['da', 'Dansk'], ['nl', 'Nederlands'], ['eo', 'Esperanto'],
    ['et', 'Eesti'], ['fi', 'Suomi'], ['fy', 'Frysk'], ['gl', 'Galego'], ['ka', 'ქართული'], ['el', 'Ελληνικά'],
    ['gu', 'ગુજરાતી'], ['ht', 'Kreyòl ayisyen'], ['ha', 'Hausa'], ['haw', 'ʻŌlelo Hawaiʻi'], ['iw', 'עברית'], ['hmn', 'Hmoob'],
    ['hu', 'Magyar'], ['is', 'Íslenska'], ['ig', 'Igbo'], ['ga', 'Gaeilge'], ['jw', 'Basa Jawa'], ['kn', 'ಕನ್ನಡ'],
    ['kk', 'Қазақ тілі'], ['km', 'ខ្មែរ'], ['rw', 'Kinyarwanda'], ['ku', 'Kurdî'], ['ky', 'Кыргызча'], ['lo', 'ລາວ'],
    ['la', 'Latina'], ['lv', 'Latviešu'], ['lt', 'Lietuvių'], ['lb', 'Lëtzebuergesch'], ['mk', 'Македонски'], ['mg', 'Malagasy'],
    ['ms', 'Bahasa Melayu'], ['ml', 'മലയാളം'], ['mt', 'Malti'], ['mi', 'Māori'], ['mr', 'मराठी'], ['mn', 'Монгол'],
    ['my', 'မြန်မာ'], ['ne', 'नेपाली'], ['no', 'Norsk'], ['ny', 'Chichewa'], ['or', 'ଓଡ଼ିଆ'], ['ps', 'پښتو'],
    ['fa', 'فارسی'], ['pl', 'Polski'], ['pa', 'ਪੰਜਾਬੀ'], ['ro', 'Română'], ['sm', 'Gagana Samoa'], ['gd', 'Gàidhlig'],
    ['sr', 'Српски'], ['st', 'Sesotho'], ['sn', 'ChiShona'], ['sd', 'سنڌي'], ['si', 'සිංහල'], ['sk', 'Slovenčina'],
    ['sl', 'Slovenščina'], ['so', 'Soomaali'], ['su', 'Basa Sunda'], ['sw', 'Kiswahili'], ['sv', 'Svenska'], ['tl', 'Filipino'],
    ['tg', 'Тоҷикӣ'], ['ta', 'தமிழ்'], ['tt', 'Татарча'], ['te', 'తెలుగు'], ['tk', 'Türkmençe'], ['uk', 'Українська'],
    ['ur', 'اردو'], ['ug', 'ئۇيغۇرچە'], ['uz', 'Oʻzbekcha'], ['cy', 'Cymraeg'], ['xh', 'isiXhosa'], ['yi', 'ייִדיש'],
    ['yo', 'Yorùbá'], ['zu', 'isiZulu'],
  ];
  const RTL = new Set(['ar', 'iw', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi']); // 右から左に書く言語
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 保存できなくても続行 */ } };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const current = () => { const c = get('kg_lang'); return LANGS.some(([k]) => k === c) ? c : 'ja'; };

  // Google 翻訳は「googtrans」というクッキーで翻訳先の言語を受け取る
  function setCookie(lang) {
    const hosts = ['', location.hostname, '.' + location.hostname.split('.').slice(-2).join('.')];
    hosts.forEach((h) => {
      const dom = h ? `;domain=${h}` : '';
      document.cookie = lang === 'ja' ? `googtrans=;path=/;max-age=0${dom}` : `googtrans=/ja/${lang};path=/;SameSite=Lax${dom}`;
    });
  }
  function loadGoogle() {
    if (document.getElementById('kg-gt-script')) return;
    window.kgTranslateInit = function () {
      // 画面には出さない「見えない翻訳部品」を作る（言語の選択は自前の画面で行う）
      new window.google.translate.TranslateElement({ pageLanguage: 'ja', autoDisplay: false }, 'kg-gt');
    };
    const s = document.createElement('script');
    s.id = 'kg-gt-script';
    s.src = 'https://translate.googleapis.com/translate_a/element.js?cb=kgTranslateInit';
    s.onerror = () => { const t = document.getElementById('toast'); if (t) { t.textContent = '翻訳サービスに接続できませんでした。'; t.hidden = false; } };
    document.head.append(s);
    // 翻訳が始まらなかったとき（接続できない・Google 側の仕様変更など）は、黙って日本語のままにせず知らせる
    setTimeout(() => {
      if (/translated-(ltr|rtl)/.test(document.documentElement.className)) return;
      const t = document.getElementById('toast');
      if (t) { t.textContent = '自動翻訳を開始できませんでした（Translation could not start）。'; t.hidden = false; setTimeout(() => { t.hidden = true; }, 6000); }
    }, 12000);
  }
  function choose(lang) {
    if (lang !== 'ja' && !get('kg_lang_ok')) {
      const ok = confirm('日本語以外の表示には、Google の自動翻訳を使います。\n画面に表示されている文字（投稿を含む）が Google に送信されます。\n機械翻訳のため、不正確な場合があります。\n\nAutomatic translation is provided by Google. Text shown on this page is sent to Google. Continue?');
      if (!ok) return;
      set('kg_lang_ok', '1');
    }
    set('kg_lang', lang);
    setCookie(lang);
    location.reload(); // 読み込み直すと、選んだ言語で表示される
  }

  function openPicker() {
    const back = el('div', 'modal-back notranslate');
    const box = el('div', 'modal wide'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Language');
    const head = el('div', 'modal-head'); const close = el('button', 'icon-btn', '✕'); close.setAttribute('aria-label', 'Close');
    head.append(el('h2', '', '🌐 Language / 言語'), close);
    const body = el('div', 'modal-body');
    const q = el('input'); q.type = 'search'; q.placeholder = 'Search / さがす（例：English, 한국어, fr）'; q.setAttribute('aria-label', 'Search language');
    const grid = el('div', 'country-grid');
    const cur = current();
    const draw = () => {
      const s = q.value.trim().toLowerCase();
      grid.replaceChildren(...LANGS.filter(([k, n]) => !s || n.toLowerCase().includes(s) || k.toLowerCase().startsWith(s)).map(([k, n]) => {
        const b = el('button', 'country' + (k === cur ? ' on' : ''));
        b.lang = k === 'iw' ? 'he' : k === 'jw' ? 'jv' : k; b.dir = RTL.has(k) ? 'rtl' : 'ltr';
        b.append(el('span', '', n));
        b.addEventListener('click', () => { if (k === cur) done(); else choose(k); });
        return b;
      }));
    };
    const done = () => { back.remove(); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') done(); };
    q.addEventListener('input', draw); close.addEventListener('click', done);
    back.addEventListener('mousedown', (e) => { if (e.target === back) done(); });
    document.addEventListener('keydown', esc);
    body.append(q, grid, el('p', 'muted small', `${LANGS.length} languages · 日本語以外は Google による自動翻訳です（Machine translation by Google）`));
    box.append(head, body); back.append(box);
    document.getElementById('modal-root').append(back);
    draw(); q.focus();
  }

  // 起動時：ボタンを用意し、前回えらんだ言語があれば翻訳を始める
  const lang = current();
  const btn = document.getElementById('lang-btn');
  const name = (LANGS.find(([k]) => k === lang) || LANGS[0])[1];
  btn.append(el('span', 'flag', '🌐'), el('span', 'lang-name', name));
  btn.addEventListener('click', openPicker);
  if (lang === 'ja') setCookie('ja');
  else {
    document.documentElement.classList.add('kg-translated');
    setCookie(lang);
    loadGoogle();
  }
  window.KGLang = { current, count: LANGS.length };
})();
