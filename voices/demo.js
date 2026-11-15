// クニゴエ：デモモード（データベース未接続のとき用）
// サーバーと同じ操作を、この端末の中だけで再現する。投稿は localStorage に保存され、他の人には見えない。
(function () {
  const KEY = 'kg_demo_v3';
  const DAY = 864e5;
  class Bad extends Error {}

  // --- 見本データ（すべて架空の投稿）---
  // [種類, 分野, 立場, 気持ち, 暮らし向き, 本文]
  const T = [
    ['life', 'economy', 'oppose', 'anxiety', 2, '食料品がまた値上がり。給料は変わらないのに、毎月の食費だけが増えていく。 #物価高'],
    ['opinion', 'economy', 'support', 'hope', 3, '賃上げを後押しする政策は続けてほしい。中小企業にも届く仕組みが必要だと思う。 #賃上げ'],
    ['feel', 'economy', 'neutral', 'resign', 3, '景気が良くなったと言われても、正直なところ実感がない。'],
    ['proposal', 'economy', 'neutral', 'hope', 3, '【提言】生活必需品の価格動向を、地域ごとに毎月わかりやすく公開してほしい。 #物価高'],
    ['opinion', 'tax', 'oppose', 'anger', 2, '増税の前に、まず歳出の見直しを徹底してほしい。使い道の説明が足りない。 #税金の使い道'],
    ['opinion', 'tax', 'support', null, 4, '将来世代に借金を回さないためには、負担の議論から逃げてはいけないと思う。 #財政'],
    ['proposal', 'tax', 'neutral', 'hope', 3, '【提言】確定申告をスマホだけで完結できるように。控除の自動計算も入れてほしい。 #税金の使い道'],
    ['life', 'tax', 'oppose', 'sad', 2, '手取りが思ったより少なくて驚いた。税と社会保険料の重さを実感する。'],
    ['life', 'welfare', 'oppose', 'anxiety', 2, '年金だけでは暮らせず、70歳を過ぎても働いている。先が見えない。 #年金'],
    ['opinion', 'welfare', 'support', 'hope', 3, '給付と負担のバランスを見直す改革は、痛みがあっても進めるべきだ。 #年金'],
    ['feel', 'welfare', 'neutral', 'anxiety', 3, '自分たちの世代は年金をいくらもらえるのだろう、と考えると不安になる。 #年金'],
    ['proposal', 'welfare', 'neutral', null, 3, '【提言】将来もらえる年金額を、誰でも1分で試算できる公式ツールを整備してほしい。'],
    ['life', 'health', 'oppose', 'anxiety', 2, '親の介護で仕事を減らした。介護サービスの空きがなく、家族だけでは限界。 #介護'],
    ['opinion', 'health', 'support', 'joy', 4, 'オンライン診療が広がって通院が楽になった。この流れは進めてほしい。 #医療'],
    ['proposal', 'health', 'support', 'hope', 3, '【提言】介護職の処遇改善を最優先に。人手が足りなければ制度は回らない。 #介護'],
    ['feel', 'health', 'neutral', 'sad', 3, '地元の病院が診療科を減らすと聞いた。地方の医療はどうなるのか。 #医療'],
    ['life', 'child', 'oppose', 'anxiety', 2, '保育園に入れず、育休を延長することに。復職の見通しが立たない。 #子育て支援'],
    ['opinion', 'child', 'support', 'joy', 4, '児童手当の拡充は助かっている。現金だけでなく、預け先の整備も続けてほしい。 #子育て支援'],
    ['proposal', 'child', 'support', 'hope', 3, '【提言】病児保育の枠を増やしてほしい。子どもの発熱のたびに仕事を休むのは限界。 #子育て支援'],
    ['feel', 'child', 'neutral', 'resign', 2, '2人目がほしいけれど、教育費を考えると踏み切れない。 #少子化'],
    ['opinion', 'edu', 'support', 'hope', 3, '高校授業料の負担軽減はありがたい。次は大学の学費にも目を向けてほしい。 #教育費'],
    ['life', 'edu', 'oppose', 'anxiety', 2, '奨学金の返済が月2万円。結婚も貯金も後回しになっている。 #奨学金'],
    ['proposal', 'edu', 'neutral', 'hope', 3, '【提言】教員の事務作業を減らし、子どもと向き合う時間を確保できる体制に。 #教育費'],
    ['feel', 'edu', 'neutral', 'anxiety', 3, '先生が足りないと聞く。子どもの学校は大丈夫だろうか。'],
    ['life', 'work', 'oppose', 'anger', 2, '非正規で10年。同じ仕事をしても賞与がなく、将来設計ができない。 #働き方'],
    ['opinion', 'work', 'support', 'joy', 4, 'テレワークが定着して、地方に住みながら働けるようになった。良い変化だと思う。 #働き方'],
    ['proposal', 'work', 'support', 'hope', 3, '【提言】学び直しの費用補助を、非正規やフリーランスにも使いやすくしてほしい。 #リスキリング'],
    ['opinion', 'work', 'neutral', null, 3, '最低賃金の引き上げは賛成だが、小さな店が耐えられる支援策とセットで。 #賃上げ'],
    ['opinion', 'security', 'support', 'anxiety', 3, '周辺の情勢を考えると、防衛力の強化はやむを得ないと思う。 #安全保障'],
    ['opinion', 'security', 'oppose', 'anxiety', 3, '防衛費を増やす前に、外交でできる努力をもっと説明してほしい。 #安全保障'],
    ['feel', 'security', 'neutral', 'anxiety', 3, '海外のニュースを見るたび、平和が当たり前ではないと感じる。'],
    ['proposal', 'security', 'neutral', null, 3, '【提言】外交・防衛の方針は、専門用語を使わない説明資料も毎回出してほしい。'],
    ['life', 'energy', 'oppose', 'anxiety', 2, '電気代の請求を見て驚いた。冬の暖房を我慢する日が増えそう。 #電気代'],
    ['opinion', 'energy', 'support', 'hope', 4, '再生可能エネルギーへの投資は、長い目で見て国の強みになると思う。 #再エネ'],
    ['opinion', 'energy', 'neutral', null, 3, '電気の安定供給と脱炭素、どちらも大事。現実的な工程表を示してほしい。 #電気代'],
    ['proposal', 'energy', 'support', 'hope', 3, '【提言】住宅の断熱改修への補助を拡充してほしい。光熱費と健康の両方に効く。 #再エネ'],
    ['life', 'disaster', 'oppose', 'sad', 2, '被災から時間がたっても、仮住まいのまま。生活再建の支援が届くのが遅い。 #防災'],
    ['opinion', 'disaster', 'support', 'joy', 3, '避難所の環境改善が進んでいると聞いた。備えへの投資は評価したい。 #防災'],
    ['proposal', 'disaster', 'neutral', 'hope', 3, '【提言】被災時の支援制度の申請を一つの窓口・一度の入力で済むようにしてほしい。 #防災'],
    ['feel', 'disaster', 'neutral', 'anxiety', 3, '大雨のたびに川の水位が気になる。この町の備えは十分だろうか。'],
    ['life', 'agri', 'oppose', 'anxiety', 2, '肥料も燃料も上がり、作っても利益が残らない。後継ぎもいない。 #農業'],
    ['opinion', 'agri', 'support', 'hope', 3, '食料自給率を上げる取り組みには賛成。国産を選びやすい表示も進めてほしい。 #食料安全保障'],
    ['proposal', 'agri', 'neutral', 'hope', 3, '【提言】新しく農業を始める人に、農地と住まいをセットで紹介する仕組みを。 #農業'],
    ['feel', 'agri', 'neutral', 'sad', 3, 'お米の値段が上がった。農家さんに届いているなら良いのだけれど。 #物価高'],
    ['opinion', 'digital', 'support', 'joy', 4, '役所の手続きがオンラインで済んで助かった。もっと対象を広げてほしい。 #行政DX'],
    ['opinion', 'digital', 'oppose', 'anxiety', 3, 'デジタル化は良いが、個人情報の管理体制が本当に大丈夫なのか説明がほしい。 #行政DX'],
    ['life', 'digital', 'oppose', 'resign', 3, '高齢の親はスマホ申請ができず、結局窓口で半日並んだ。'],
    ['proposal', 'digital', 'neutral', 'hope', 3, '【提言】オンライン手続きが苦手な人のために、身近な場所に相談員を置いてほしい。 #行政DX'],
    ['opinion', 'reform', 'oppose', 'anger', 3, '政治資金の流れが見えない。まず透明化から始めてほしい。 #政治改革'],
    ['opinion', 'reform', 'support', 'hope', 3, '若い世代が立候補しやすくなる制度改正の議論は歓迎したい。 #政治改革'],
    ['proposal', 'reform', 'support', 'hope', 3, '【提言】ネット投票を、まずは在外投票や離島から試験的に導入してほしい。 #ネット投票'],
    ['feel', 'reform', 'neutral', 'resign', 3, '選挙に行っても何も変わらない気がしてしまう。でも投票には行く。 #選挙'],
    ['feel', 'other', 'neutral', 'hope', 3, '立場が違う人の投稿を読むと、自分の見えていない暮らしがあると気づく。'],
    ['opinion', 'other', 'neutral', null, 3, '政策の説明は、結論だけでなく「なぜそう決めたか」まで公開してほしい。'],
    ['life', 'other', 'neutral', 'joy', 4, '近所に新しい公園ができて、子どもと過ごす時間が増えた。身近な行政に感謝。'],
    ['proposal', 'other', 'neutral', 'hope', 3, '【提言】国の主要な政策ごとに、市民の声を集めて公開する仕組みを常設してほしい。'],
  ];
  const NAMES = ['はるか', 'たけし', 'みなと', 'さくら', 'ゆうき', 'かおる', 'しんじ', 'あおい', 'なおこ', 'だいき', 'りん', 'そうた',
    'ちひろ', 'けんた', 'まどか', 'ひろし', 'えみ', 'じゅん', 'のぞみ', 'こうじ', 'あかね', 'りょう', 'みさき', 'とおる', 'ゆい', 'まさと',
    'かずみ', 'しょう', 'ともこ', 'げん', 'ひかり', 'たくや', 'さとみ', 'れん', 'よしえ', 'いつき', 'もえ', 'つよし', 'あや', 'きよし'];
  const POLLS = [
    ['economy', '物価高対策として、いちばん効果があると思うものは？ #物価高', ['消費税の引き下げ', '現金給付', '賃上げの後押し', 'エネルギー補助']],
    ['child', '少子化対策で最優先にしてほしいのは？ #少子化', ['保育の受け皿', '教育費の負担軽減', '働き方の見直し', '住宅支援']],
    ['reform', 'ネット投票の導入に賛成ですか？ #ネット投票', ['賛成', '条件つきで賛成', '反対']],
  ];

  // 見本の「窓口」（実在の個人名は使わない）
  const DESKS = {
    JP: [['pref', '東京都'], ['pref', '大阪府'], ['pref', '北海道'], ['pref', '福岡県'], ['city', '横浜市'], ['city', '札幌市'],
      ['politician', '総理大臣'], ['politician', '財務大臣'], ['policy', '消費税減税'], ['policy', '児童手当の拡充'], ['policy', '防衛費の増額'],
      ['theme', '少子化'], ['theme', '物価高'], ['theme', '働き方'], ['other', 'デジタル庁']],
    US: [['state', 'カリフォルニア州'], ['state', 'テキサス州'], ['politician', '大統領'], ['theme', '気候変動']],
    '*': [['politician', '首相・大統領'], ['policy', '最低賃金の引き上げ'], ['theme', '気候変動'], ['city', '首都']],
  };

  function rng(seed) { // 毎回同じ見本データになる乱数
    let s = seed;
    return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  }
  function seed() {
    const R = rng(20261115), pick = (a) => a[Math.floor(R() * a.length)];
    const wpick = (list, weights) => { let x = R() * weights.reduce((a, b) => a + b, 0); for (let i = 0; i < list.length; i++) { x -= weights[i]; if (x < 0) return list[i]; } return list[0]; };
    const CC = ['JP', 'JP', 'JP', 'JP', 'JP', 'JP', 'JP', 'JP', 'JP', 'JP', 'JP', 'JP', 'JP', 'JP', 'US', 'US', 'GB', 'DE', 'FR', 'KR', 'TW', 'IN', 'BR', 'AU', 'CA', 'IT'];
    const users = NAMES.map((n, i) => ({
      id: i + 1, handle: 'user' + String(i + 1).padStart(2, '0'), name: n, bio: '', country: pick(CC),
      age: wpick(KG.keys(KG.AGES), [1, 4, 5, 5, 4, 3, 2]), gender: wpick(['f', 'm', 'o', null], [9, 9, 1, 2]),
      area: wpick(KG.keys(KG.AREAS), [5, 3, 3]), joined: Date.now() - (40 + R() * 300) * DAY,
    }));
    const now = Date.now(), posts = [];
    const base = (u, t, created) => ({
      id: 0, uid: u.id, country: u.country, kind: t[0], topic: t[1], stance: t[2], emotion: t[3], sat: t[4], body: t[5],
      parent: null, quote: null, poll: null, pollCounts: null, likes: 0, agrees: 0, disagrees: 0, replies: 0, quotes: 0, created,
      deskType: 'country', deskId: null,
    });
    const desks = [];
    const deskFor = (country, type, name) => {
      let d = desks.find((x) => x.country === country && x.type === type && x.name === name);
      if (!d) { d = { id: desks.length + 1, country, type, name, posts: 0 }; desks.push(d); }
      d.posts++; return d;
    };
    for (let i = 0; i < 420; i++) {
      const u = pick(users), t = pick(T).slice();
      // 年代によって暮らし向きや立場が少し変わるようにして、統計に傾向が出るようにする
      if (t[4]) t[4] = Math.max(1, Math.min(5, t[4] + (R() < 0.3 ? 1 : 0) - (R() < 0.3 ? 1 : 0) - (['20s', '30s'].includes(u.age) && R() < 0.3 ? 1 : 0)));
      if (R() < 0.15) t[2] = pick(['support', 'neutral', 'oppose']);
      const p = base(u, t, now - Math.pow(R(), 1.6) * 30 * DAY);
      if (R() < 0.5) { const [type, name] = pick(DESKS[u.country] || DESKS['*']); p.deskType = type; p.deskId = deskFor(u.country, type, name).id; }
      p.likes = Math.floor(Math.pow(R(), 3) * 60);
      if (p.kind === 'opinion' || p.kind === 'proposal') { p.agrees = Math.floor(Math.pow(R(), 2) * 80); p.disagrees = Math.floor(Math.pow(R(), 2) * 40); }
      posts.push(p);
    }
    POLLS.forEach(([topic, body, options], i) => {
      const p = base(users[i], ['opinion', topic, null, null, null, body], now - (0.3 + i) * DAY);
      p.country = 'JP'; p.poll = { options }; p.pollCounts = options.map(() => 20 + Math.floor(R() * 150)); p.likes = 12 + i * 7;
      posts.push(p);
    });
    posts.sort((a, b) => a.created - b.created).forEach((p, i) => { p.id = i + 1; });
    const REPLIES = ['同じ状況です。声を上げ続けたいですね。', 'その視点はなかったです。参考になります。', '賛成です。具体的な数字も知りたいです。', '自分は少し違う意見ですが、事情はよくわかります。', '地方でも同じことが起きています。'];
    const tops = posts.slice();
    for (let i = 0; i < 70; i++) {
      const parent = pick(tops), u = pick(users);
      posts.push({ ...base(u, ['opinion', parent.topic, null, null, null, pick(REPLIES)], Math.min(now - 6e4, parent.created + R() * 2 * DAY)), id: posts.length + 1, country: parent.country, parent: parent.id, deskType: parent.deskType, deskId: parent.deskId });
      parent.replies++;
    }
    return { users, posts, desks, my: {}, votes: {}, follows: {}, me: null, nextId: posts.length + 1 };
  }

  let S;
  function load() {
    if (S) return S;
    try { S = JSON.parse(localStorage.getItem(KEY)); } catch { S = null; }
    if (!S || !S.posts || !S.desks) S = seed();
    return S;
  }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* 保存できなくても動作は続ける */ } };
  const me = () => S.users.find((u) => u.handle === S.me) || null;
  const needMe = () => { const u = me(); if (!u) throw new Bad('ログインが必要です。'); return u; };
  const userOf = (id) => S.users.find((u) => u.id === id) || { handle: 'unknown', name: '退会済み' };
  const pub = (u) => u && ({ handle: u.handle, name: u.name, country: u.country, age: u.age, gender: u.gender, area: u.area, bio: u.bio, isAdmin: false });

  function shape(p) {
    const u = userOf(p.uid), m = me(), qp = p.quote && S.posts.find((x) => x.id === p.quote);
    const has = (t) => !!S.my[p.id + ':' + t];
    return {
      id: p.id, country: p.country, kind: p.kind, topic: p.topic, stance: p.stance, emotion: p.emotion, sat: p.sat, body: p.body,
      parent: p.parent, created: p.created, user: { handle: u.handle, name: u.name }, mine: !!m && m.id === p.uid,
      desk: p.deskId ? (({ id, type, name }) => ({ id, type, name }))(S.desks.find((d) => d.id === p.deskId) || {}) : null,
      likes: p.likes, agrees: p.agrees, disagrees: p.disagrees, replies: p.replies, quotes: p.quotes,
      poll: p.poll ? { options: p.poll.options, counts: p.pollCounts, my: S.votes[p.id] ?? null } : null,
      my: { like: has('like'), bookmark: has('bookmark'), agree: has('agree'), disagree: has('disagree') },
      quote: qp ? { id: qp.id, body: qp.body, kind: qp.kind, created: qp.created, user: (({ handle, name }) => ({ handle, name }))(userOf(qp.uid)) } : null,
    };
  }
  const byId = (id) => { const p = S.posts.find((x) => x.id === Number(id)); if (!p) throw new Bad('投稿が見つかりません。'); return p; };

  const A = {
    me: () => ({ me: pub(me()) }),
    signup(p) {
      const handle = String(p.handle || '').toLowerCase();
      if (!/^[a-z0-9_]{3,15}$/.test(handle)) throw new Bad('ユーザーIDは半角英数字と _ で3〜15文字にしてください。');
      if (S.users.some((u) => u.handle === handle)) throw new Bad('このユーザーIDはすでに使われています。');
      // デモモードではパスワードを保存しない（この端末だけの仮アカウント）
      S.users.push({ id: S.users.length + 1001, handle, name: String(p.name || handle).slice(0, 20), bio: '', country: p.country, age: p.age || null, gender: p.gender || null, area: p.area || null, joined: Date.now(), local: true });
      S.me = handle;
      return { me: pub(me()) };
    },
    login(p) {
      const u = S.users.find((x) => x.handle === String(p.handle || '').toLowerCase() && x.local);
      if (!u) throw new Bad('デモモードでは、この端末で作ったアカウントだけ使えます。「新規登録」からお試しください。');
      S.me = u.handle;
      return { me: pub(u) };
    },
    logout() { S.me = null; return { ok: true }; },
    updateProfile(p) {
      const u = needMe();
      Object.assign(u, { name: String(p.name || u.handle).slice(0, 20), bio: String(p.bio || '').slice(0, 160), country: p.country, age: p.age || null, gender: p.gender || null, area: p.area || null });
      return { me: pub(u) };
    },
    changePassword() { throw new Bad('デモモードではパスワードを使いません。'); },
    deleteAccount() {
      const u = needMe();
      S.posts = S.posts.filter((x) => x.uid !== u.id); S.users = S.users.filter((x) => x.id !== u.id); S.me = null;
      return { ok: true };
    },
    feed(p) {
      let list;
      if (p.id) list = S.posts.filter((x) => x.id === Number(p.id));
      else if (p.parent) list = S.posts.filter((x) => x.parent === Number(p.parent)).sort((a, b) => a.id - b.id);
      else {
        list = S.posts.slice();
        if (p.tab === 'bookmarks') { needMe(); list = list.filter((x) => S.my[x.id + ':bookmark']); } else {
          if (p.user) list = list.filter((x) => userOf(x.uid).handle === p.user);
          else {
            list = list.filter((x) => !x.parent);
            if (p.desk) list = list.filter((x) => x.deskId === Number(p.desk));
            else if (p.country && p.country !== 'ALL') list = list.filter((x) => x.country === p.country);
            if (p.deskType) list = list.filter((x) => x.deskType === p.deskType);
          }
          if (p.tab === 'following') { needMe(); list = list.filter((x) => S.follows[userOf(x.uid).handle]); }
          if (p.kind) list = list.filter((x) => x.kind === p.kind);
          if (p.topic) list = list.filter((x) => x.topic === p.topic);
          if (p.tag) list = list.filter((x) => KG.tagsOf(x.body).includes(String(p.tag).toLowerCase()));
          if (p.q) list = list.filter((x) => x.body.toLowerCase().includes(String(p.q).toLowerCase()));
        }
        const score = (x) => x.likes + x.agrees + x.disagrees + x.replies * 2 + x.quotes * 2;
        if (p.tab === 'popular') return { posts: list.filter((x) => x.created > Date.now() - 14 * DAY).sort((a, b) => score(b) - score(a)).slice(0, 40).map(shape), more: false };
        list.sort((a, b) => b.created - a.created);
        if (p.before) { const i = list.findIndex((x) => x.id === Number(p.before)); list = list.slice(i + 1); }
      }
      return { posts: list.slice(0, 20).map(shape), more: list.length > 20 };
    },
    post(p) {
      const u = needMe();
      const body = String(p.body || '').trim().slice(0, KG.MAX_BODY);
      if (!body && !p.quote) throw new Bad('本文を入力してください。');
      const parent = p.parent ? byId(p.parent) : null;
      const options = Array.isArray(p.poll) ? p.poll.map((o) => String(o).trim().slice(0, 40)).filter(Boolean) : [];
      if (options.length === 1 || options.length > 4) throw new Bad('アンケートの選択肢は2〜4個にしてください。');
      let deskType = p.deskType || 'country', deskId = null;
      if (parent) { deskType = parent.deskType; deskId = parent.deskId; } else if (deskType !== 'country') {
        const name = String(p.deskName || '').normalize('NFKC').trim().replace(/\s+/g, ' ').slice(0, KG.MAX_DESK);
        if (!name) throw new Bad('窓口の名前を入力してください。');
        let d = S.desks.find((x) => x.country === p.country && x.type === deskType && x.name === name);
        if (!d) { d = { id: Math.max(0, ...S.desks.map((x) => x.id)) + 1, country: p.country, type: deskType, name, posts: 0 }; S.desks.push(d); }
        d.posts++; deskId = d.id;
      }
      const post = {
        deskType, deskId,
        id: S.nextId++, uid: u.id, country: parent ? parent.country : p.country, kind: p.kind, topic: parent ? parent.topic : p.topic,
        stance: p.stance || null, emotion: p.emotion || null, sat: p.sat ? Number(p.sat) : null, body,
        parent: parent ? parent.id : null, quote: p.quote ? byId(p.quote).id : null,
        poll: options.length ? { options } : null, pollCounts: options.length ? options.map(() => 0) : null,
        likes: 0, agrees: 0, disagrees: 0, replies: 0, quotes: 0, created: Date.now(),
      };
      S.posts.push(post);
      if (parent) parent.replies++;
      if (post.quote) byId(post.quote).quotes++;
      return { post: shape(post) };
    },
    deletePost(p) {
      const u = needMe(), post = byId(p.id);
      if (post.uid !== u.id) throw new Bad('削除できません。');
      if (post.parent) { const x = S.posts.find((y) => y.id === post.parent); if (x) x.replies = Math.max(0, x.replies - 1); }
      if (post.deskId && !post.parent) { const d = S.desks.find((x) => x.id === post.deskId); if (d) d.posts = Math.max(0, d.posts - 1); }
      S.posts = S.posts.filter((x) => x.id !== post.id && x.parent !== post.id);
      return { ok: true };
    },
    react(p) {
      needMe();
      const post = byId(p.id), C = { like: 'likes', agree: 'agrees', disagree: 'disagrees' };
      const set = (t, on) => {
        const k = post.id + ':' + t;
        if (!!S.my[k] === on) return;
        if (on) S.my[k] = 1; else delete S.my[k];
        if (C[t]) post[C[t]] = Math.max(0, post[C[t]] + (on ? 1 : -1));
      };
      const on = !S.my[post.id + ':' + p.type];
      set(p.type, on);
      if (on && p.type === 'agree') set('disagree', false);
      if (on && p.type === 'disagree') set('agree', false);
      return { post: shape(post) };
    },
    vote(p) {
      needMe();
      const post = byId(p.id);
      if (post.poll && S.votes[post.id] === undefined && post.pollCounts[p.opt] !== undefined) { S.votes[post.id] = p.opt; post.pollCounts[p.opt]++; }
      return { post: shape(post) };
    },
    follow(p) {
      needMe();
      if (S.follows[p.handle]) delete S.follows[p.handle]; else S.follows[p.handle] = 1;
      return { following: !!S.follows[p.handle] };
    },
    profile(p) {
      const u = S.users.find((x) => x.handle === p.handle);
      if (!u) throw new Bad('ユーザーが見つかりません。');
      const m = me();
      return { profile: { handle: u.handle, name: u.name, bio: u.bio, country: u.country, joined: u.joined, posts: S.posts.filter((x) => x.uid === u.id).length, followers: (u.id * 7) % 40 + (S.follows[u.handle] ? 1 : 0), following: m && m.id === u.id ? Object.keys(S.follows).length : (u.id * 3) % 25, followed: !!S.follows[u.handle], mine: !!m && m.id === u.id } };
    },
    desks(p) {
      let list = S.desks.filter((d) => d.posts > 0);
      if (p.id) list = list.filter((d) => d.id === Number(p.id));
      else {
        if (p.country && p.country !== 'ALL') list = list.filter((d) => d.country === p.country);
        if (p.type) list = list.filter((d) => d.type === p.type);
        if (p.q) list = list.filter((d) => d.name.toLowerCase().includes(String(p.q).toLowerCase()));
      }
      return { desks: list.sort((a, b) => b.posts - a.posts || a.id - b.id).slice(0, 40) };
    },
    trends(p) { return { tags: tagCount(S.posts.filter((x) => x.created > Date.now() - 7 * DAY && (!p.country || p.country === 'ALL' || x.country === p.country)), 10) }; },
    notifications() {
      const u = needMe(), mine = new Set(S.posts.filter((x) => x.uid === u.id).map((x) => x.id));
      const items = S.posts.filter((x) => x.uid !== u.id && (mine.has(x.parent) || mine.has(x.quote)))
        .map((x) => ({ type: mine.has(x.parent) ? 'reply' : 'quote', postId: x.id, body: x.body.slice(0, 80), user: (({ handle, name }) => ({ handle, name }))(userOf(x.uid)), at: x.created }));
      return { items: items.sort((a, b) => b.at - a.at).slice(0, 40) };
    },
    report() { needMe(); return { ok: true }; },
    reportDesk() { needMe(); return { ok: true }; },
    stats(p) {
      const days = Number(p.days ?? 30), since = days ? Date.now() - days * DAY : 0;
      const inC = (x) => (!p.country || p.country === 'ALL' || x.country === p.country) && (!p.desk || x.deskId === Number(p.desk)) && (!p.deskType || x.deskType === p.deskType);
      const all = S.posts.filter((x) => x.created > since);
      const noTopic = all.filter(inC), list = p.topic ? noTopic.filter((x) => x.topic === p.topic) : noTopic;
      const count = (rows, keyFn) => { const m = new Map(); rows.forEach((r) => { const k = keyFn(r); if (k != null) m.set(k, (m.get(k) || 0) + 1); }); return [...m].map(([k, n]) => ({ k, n })); };
      const newest = list.slice().sort((a, b) => b.id - a.id);
      const latest = (rows, keyFn) => { const seen = new Set(); return rows.filter((r) => { const k = keyFn(r); if (seen.has(k)) return false; seen.add(k); return true; }); };
      const st = latest(newest.filter((x) => x.stance), (x) => x.uid + ':' + x.topic);
      const sat = latest(newest.filter((x) => x.sat), (x) => x.uid);
      const uids = [...new Set(list.map((x) => x.uid))];
      const dstr = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
      const cm = new Map();
      all.forEach((x) => { const c = cm.get(x.country) || { k: x.country, n: 0, u: new Set() }; c.n++; c.u.add(x.uid); cm.set(x.country, c); });
      const dm = new Map();
      list.filter((x) => x.deskId && !x.parent).forEach((x) => { const c = dm.get(x.deskId) || { n: 0, u: new Set() }; c.n++; c.u.add(x.uid); dm.set(x.deskId, c); });
      return KG.buildStats({
        deskTypes: count(list.filter((x) => !x.parent), (x) => x.deskType),
        desks: [...dm].map(([id, c]) => { const d = S.desks.find((x) => x.id === id); return { id, type: d.type, name: d.name, country: d.country, n: c.n, users: c.u.size }; }).sort((a, b) => b.n - a.n).slice(0, 15),
        totals: { posts: list.length, users: uids.length, today: list.filter((x) => x.created > Date.now() - DAY).length },
        byDay: count(list.filter((x) => x.created > Date.now() - 90 * DAY), (x) => dstr(x.created)).map((x) => ({ d: x.k, n: x.n })).sort((a, b) => (a.d < b.d ? -1 : 1)),
        byKind: count(list, (x) => x.kind), topicCount: count(noTopic, (x) => x.topic), emotions: count(list, (x) => x.emotion),
        topicStance: st.map((x) => ({ topic: x.topic, stance: x.stance, n: 1 })),
        sat: sat.map((x) => { const u = userOf(x.uid); return { sat: x.sat, age: u.age, area: u.area, n: 1 }; }),
        stanceDemo: st.map((x) => { const u = userOf(x.uid); return { age: u.age, gender: u.gender, stance: x.stance, n: 1 }; }),
        demo: uids.map((id) => { const u = userOf(id); return { age: u.age, gender: u.gender, area: u.area, n: 1 }; }),
        tags: tagCount(list, 15),
        proposals: list.filter((x) => x.kind === 'proposal' && !x.parent).sort((a, b) => (b.agrees - b.disagrees) - (a.agrees - a.disagrees)).slice(0, 10)
          .map((x) => ({ id: x.id, body: x.body.slice(0, 120), topic: x.topic, agrees: x.agrees, disagrees: x.disagrees, handle: userOf(x.uid).handle })),
        countries: [...cm.values()].map((c) => ({ k: c.k, n: c.n, users: c.u.size })).sort((a, b) => b.n - a.n).slice(0, 15),
      });
    },
  };
  function tagCount(posts, limit) {
    const m = new Map();
    posts.forEach((x) => KG.tagsOf(x.body).forEach((t) => m.set(t, (m.get(t) || 0) + 1)));
    return [...m].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || (a.tag < b.tag ? -1 : 1)).slice(0, limit);
  }

  window.KGDemo = {
    async call(action, p) {
      load();
      if (!A[action]) throw new Error('この操作はデモモードでは使えません。');
      const out = A[action](p || {});
      save();
      return JSON.parse(JSON.stringify(out));
    },
    reset() { localStorage.removeItem(KEY); S = null; },
  };
})();
