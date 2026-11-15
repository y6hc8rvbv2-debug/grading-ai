// 市民の声：画面側とサーバー側で共通に使う「選択肢の定義」
// （国・投稿の種類・政策分野など。ここに個人情報や秘密の値は書かない）
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KG = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const COUNTRIES = [
    ['JP', '日本'], ['US', 'アメリカ'], ['GB', 'イギリス'], ['DE', 'ドイツ'], ['FR', 'フランス'],
    ['IT', 'イタリア'], ['ES', 'スペイン'], ['CA', 'カナダ'], ['AU', 'オーストラリア'], ['NZ', 'ニュージーランド'],
    ['KR', '韓国'], ['CN', '中国'], ['TW', '台湾'], ['HK', '香港'], ['IN', 'インド'],
    ['ID', 'インドネシア'], ['TH', 'タイ'], ['VN', 'ベトナム'], ['PH', 'フィリピン'], ['MY', 'マレーシア'],
    ['SG', 'シンガポール'], ['BR', 'ブラジル'], ['MX', 'メキシコ'], ['AR', 'アルゼンチン'], ['CL', 'チリ'],
    ['NL', 'オランダ'], ['BE', 'ベルギー'], ['CH', 'スイス'], ['AT', 'オーストリア'], ['SE', 'スウェーデン'],
    ['NO', 'ノルウェー'], ['DK', 'デンマーク'], ['FI', 'フィンランド'], ['PL', 'ポーランド'], ['UA', 'ウクライナ'],
    ['RU', 'ロシア'], ['TR', 'トルコ'], ['IL', 'イスラエル'], ['SA', 'サウジアラビア'], ['AE', 'アラブ首長国連邦'],
    ['EG', 'エジプト'], ['ZA', '南アフリカ'], ['NG', 'ナイジェリア'], ['KE', 'ケニア'], ['PT', 'ポルトガル'],
    ['GR', 'ギリシャ'], ['IE', 'アイルランド'], ['PK', 'パキスタン'], ['BD', 'バングラデシュ'], ['MN', 'モンゴル'],
  ].map(([code, name]) => ({
    code, name,
    flag: String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)),
  }));

  const KINDS = [
    { k: 'life', name: '生活の現状', icon: '🏠', hint: '物価・仕事・子育てなど、いまの暮らしの実情を伝える' },
    { k: 'feel', name: '気持ち', icon: '💭', hint: '政策やニュースに対して感じたことを伝える' },
    { k: 'opinion', name: '意見', icon: '🗣️', hint: '政策への賛否や考えを述べる' },
    { k: 'proposal', name: '政策提言', icon: '📜', hint: '「こうしてほしい」という具体的な提案をする' },
  ];
  const TOPICS = [
    { k: 'economy', name: '経済・物価' }, { k: 'tax', name: '税・財政' }, { k: 'welfare', name: '年金・社会保障' },
    { k: 'health', name: '医療・介護' }, { k: 'child', name: '子育て・少子化' }, { k: 'edu', name: '教育' },
    { k: 'work', name: '雇用・労働' }, { k: 'security', name: '外交・安全保障' }, { k: 'energy', name: 'エネルギー・環境' },
    { k: 'disaster', name: '防災・復興' }, { k: 'agri', name: '農林水産・食' }, { k: 'digital', name: 'デジタル・行政' },
    { k: 'reform', name: '政治改革・選挙' }, { k: 'other', name: 'その他' },
  ];
  // 意見の窓口（どこ・誰・何に向けた声か）。国以外は、名前を付けて窓口を作れる
  const DESK_TYPES = [
    { k: 'country', name: '国', icon: '🏛️', eg: '' },
    { k: 'state', name: '州', icon: '🗺️', eg: '例：カリフォルニア州' },
    { k: 'pref', name: '県', icon: '🗾', eg: '例：大阪府、福岡県' },
    { k: 'city', name: '市', icon: '🏙️', eg: '例：横浜市、世田谷区' },
    { k: 'politician', name: '政治家', icon: '🧑‍💼', eg: '例：総理大臣、〇〇議員' },
    { k: 'policy', name: '政策', icon: '📑', eg: '例：消費税減税、児童手当の拡充' },
    { k: 'theme', name: '社会テーマ', icon: '🌱', eg: '例：少子化、働き方' },
    { k: 'other', name: 'その他', icon: '📮', eg: '例：〇〇省、〇〇委員会' },
  ];
  const STANCES = [
    { k: 'support', name: '支持', icon: '👍' },
    { k: 'neutral', name: 'どちらともいえない', icon: '🤔' },
    { k: 'oppose', name: '不支持', icon: '👎' },
  ];
  const EMOTIONS = [
    { k: 'anger', name: '怒り', icon: '😠' }, { k: 'anxiety', name: '不安', icon: '😟' },
    { k: 'sad', name: '悲しみ', icon: '😢' }, { k: 'resign', name: 'あきらめ', icon: '😑' },
    { k: 'hope', name: '希望', icon: '🌱' }, { k: 'joy', name: '満足', icon: '😊' },
  ];
  const AGES = [
    { k: 'u20', name: '10代以下' }, { k: '20s', name: '20代' }, { k: '30s', name: '30代' }, { k: '40s', name: '40代' },
    { k: '50s', name: '50代' }, { k: '60s', name: '60代' }, { k: '70p', name: '70代以上' },
  ];
  const GENDERS = [{ k: 'f', name: '女性' }, { k: 'm', name: '男性' }, { k: 'o', name: 'その他' }];
  const AREAS = [{ k: 'urban', name: '都市部' }, { k: 'suburb', name: '郊外' }, { k: 'rural', name: '地方・農山漁村' }];
  const SAT_LABELS = ['とても苦しい', '苦しい', 'ふつう', 'ゆとりがある', 'とてもゆとりがある'];

  const keys = (list) => list.map((x) => x.k);
  const nameOf = (list, k) => (list.find((x) => x.k === k) || {}).name || k;
  const country = (code) => COUNTRIES.find((c) => c.code === code);
  // ハッシュタグ（#消費税 など）を本文から取り出す
  const TAG_RE = /[#＃]([\p{L}\p{N}_ー]{1,30})/gu;
  const tagsOf = (body) => [...new Set([...String(body).matchAll(TAG_RE)].map((m) => m[1].toLowerCase()))].slice(0, 5);

  // 集計結果を画面で使う形に整える。少人数の区分（MIN_CELL 人未満）は個人が推測されないよう伏せる
  function buildStats(raw) {
      const MIN_CELL = 3;
    const sum = (rows, f) => rows.reduce((a, r) => a + (f(r) ? r.n : 0), 0);
    const stanceRow = (rows, key, k) => {
      const o = { k };
      for (const s of STANCES) o[s.k] = sum(rows, (r) => r[key] === k && r.stance === s.k);
      o.n = o.support + o.neutral + o.oppose;
      return o;
    };
    const guard = (list) => list.filter((x) => x.n >= MIN_CELL);
    const satAvg = (rows) => { const n = sum(rows, () => true); return n ? rows.reduce((a, r) => a + r.sat * r.n, 0) / n : null; };
    const satBy = (key, list) => guard(list.map((x) => {
      const rows = raw.sat.filter((r) => r[key] === x.k);
      return { k: x.k, n: sum(rows, () => true), avg: satAvg(rows) };
    }));
    const demoBy = (key, list) => guard(list.map((x) => ({ k: x.k, n: sum(raw.demo, (r) => r[key] === x.k) })));
    return {
      totals: raw.totals, byDay: raw.byDay, byKind: raw.byKind, topicCount: raw.topicCount, emotions: raw.emotions,
      topicStance: TOPICS.map((t) => stanceRow(raw.topicStance, 'topic', t.k)).filter((x) => x.n > 0),
      sat: {
        dist: [1, 2, 3, 4, 5].map((v) => sum(raw.sat, (r) => r.sat === v)), avg: satAvg(raw.sat), n: sum(raw.sat, () => true),
        byAge: satBy('age', AGES), byArea: satBy('area', AREAS),
      },
      stanceByAge: guard(AGES.map((a) => stanceRow(raw.stanceDemo, 'age', a.k))),
      stanceByGender: guard(GENDERS.map((g) => stanceRow(raw.stanceDemo, 'gender', g.k))),
      demo: { age: demoBy('age', AGES), gender: demoBy('gender', GENDERS), area: demoBy('area', AREAS) },
      tags: raw.tags, proposals: raw.proposals, countries: raw.countries, deskTypes: raw.deskTypes || [], desks: raw.desks || [], minCell: MIN_CELL,
    };
  }

  return {
    buildStats,
    COUNTRIES, KINDS, TOPICS, DESK_TYPES, STANCES, EMOTIONS, AGES, GENDERS, AREAS, SAT_LABELS,
    keys, nameOf, country, tagsOf, TAG_RE,
    MAX_BODY: 500, MAX_DESK: 30, MIN_CELL: 3,
  };
});
