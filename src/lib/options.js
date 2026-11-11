// 入力フォームの選択肢・プラン・言語・通貨など、アプリ全体で使う一覧

export const SCHOOL_TYPES = [
  { value: 'elementary', label: '小学校' },
  { value: 'middle', label: '中学校' },
  { value: 'high', label: '高等学校' },
];
export const GRADES = { elementary: ['1', '2', '3', '4', '5', '6'], middle: ['1', '2', '3'], high: ['1', '2', '3'] };
export const SUBJECTS = {
  elementary: ['国語', '算数', '理科', '社会', '生活', '音楽', '図画工作', '家庭', '体育', '外国語活動', '外国語', '道徳', '総合的な学習の時間', '特別活動'],
  middle: ['国語', '数学', '理科', '社会', '英語', '音楽', '美術', '保健体育', '技術・家庭', '道徳', '総合的な学習の時間', '特別活動'],
  high: ['国語', '数学', '理科', '地理歴史', '公民', '英語', '保健体育', '芸術', '家庭', '情報', '総合的な探究の時間', '特別活動', '理数'],
};
export const CLASS_FORMATS = ['一斉授業', 'グループ学習', 'ペア学習', '個別学習', 'ジグソー法', '反転授業', 'プロジェクト型学習', '問題解決型学習', '探究学習', 'ディスカッション', 'ディベート', 'ロールプレイ', 'フィールドワーク', '実験・実習', 'ICT活用授業', 'ハイブリッド授業'];

export const THEORIES = {
  '構成主義（Constructivism）': '学習者が既有の知識や経験をもとに、自ら新しい知識を構築していくという考え方。教師は伝達者ではなく学びの促進者となる。',
  '行動主義（Behaviorism）': '学習を観察可能な行動の変化として捉え、強化と即時フィードバックで望ましい行動を形成する。ドリルや段階的な目標設定に向く。',
  '認知主義（Cognitivism）': '学習を情報処理の過程として捉え、注意・記憶・問題解決に着目する。概念マップや先行オーガナイザーを活用する。',
  '社会的構成主義（Social Constructivism）': '知識は対話や協働といった社会的な相互作用を通じて構築されるという考え方。話し合いと協働を重視する。',
  '経験学習（Experiential Learning）': '具体的経験→内省的観察→抽象的概念化→能動的実験のサイクルで学ぶ。体験活動や実験から学びを引き出す。',
  '発見学習（Discovery Learning）': '教師が答えを直接教えず、問いや環境設定を通じて学習者が法則や概念を自ら発見する過程を重視する。',
  '問題基盤型学習（PBL）': '現実の問題を出発点に、その解決過程で知識や技能を習得する。批判的思考力・問題解決力・協働力を育てる。',
  '協同学習（Cooperative Learning）': '小グループで互いに協力して学ぶ。互恵的な相互依存と個人の責任を両立させる。',
  'アクティブラーニング（Active Learning）': '聞くだけでなく能動的に参加する学びの総称。「主体的・対話的で深い学び」の土台となる考え方。',
  'ブルーム分類学（Bloom\'s Taxonomy）': '教育目標を記憶→理解→応用→分析→評価→創造の6段階で整理する枠組み。到達目標と評価の設計に使う。',
  '多重知能理論（Multiple Intelligences）': '知能は一つではなく複数あるという考え方。児童生徒の多様な強みを生かした活動を設計する。',
  '自己決定理論（Self-Determination Theory）': '自律性・有能感・関係性の3つの欲求が満たされると内発的動機づけが高まるとする理論。選択の機会と成功体験を重視する。',
  '足場かけ理論（Scaffolding）': '自力では難しい課題に適切な支援を与え、習熟に応じて支援を減らしていく指導法。最終的な自立を目指す。',
  '最近接発達領域（ZPD）': '「自力でできること」と「支援があればできること」の間の領域で学習が最も進むという考え方。',
  'バックワードデザイン（Understanding by Design）': '求める結果→その証拠→学習経験の順に逆向きで設計する。目標・評価・指導の一貫性を確保する。',
  'ユニバーサルデザイン（UDL）': '最初から多様な学び方に対応できるよう授業を設計する枠組み。提示・表現・取り組みの多様性を用意する。',
  '反転学習（Flipped Learning）': '基礎知識は事前に学び、授業時間を演習・議論・応用に充てる。個別支援の時間を確保しやすい。',
  'STEM/STEAM教育': '科学・技術・工学・数学（＋芸術）を統合し、教科横断で実世界の課題に取り組む。',
  'インクルーシブ教育': '多様な学習者が共に学び、すべての子どもの参加と達成を保障する。合理的配慮と個別の支援計画を重視する。',
  '形成的評価（Formative Assessment）': '学習の途中で継続的に行う評価。到達状況を把握し、指導の改善とフィードバックに生かす。',
};
export const THEORY_NAMES = Object.keys(THEORIES);

export const MATERIALS = ['教科書', '副教材', 'ワークシート', 'プリント教材', 'デジタル教科書', '映像教材', '音声教材', '実験器具', '模型', '地図・地球儀', 'カード教材', '絵本・読み物', '新聞記事', '統計資料', '写真・イラスト'];
export const TOOLS = ['黒板・ホワイトボード', '電子黒板', 'プロジェクター', 'タブレット端末', 'PC（パソコン）', '実物投影機', 'テレビモニター', 'スピーカー', 'マイク', 'ビデオカメラ', '3Dプリンター', 'プログラミング教材', 'VR/AR機器', '楽器', '運動用具', '実験道具'];
export const EVALUATIONS = ['知識・技能の評価', '思考・判断・表現の評価', '主体的に学習に取り組む態度の評価', 'ルーブリック評価', 'ポートフォリオ評価', 'パフォーマンス評価', '自己評価', '相互評価', '観察記録', 'テスト・小テスト', 'レポート', 'プレゼンテーション', '成果物評価', '振り返りシート'];
export const EXPERIENTIAL = ['自然体験', '社会体験', '職業体験', 'ボランティア活動', '文化体験', '交流活動', '調査活動', '制作活動', '栽培活動', '飼育活動', '宿泊活動', '地域連携活動'];
export const COMMUNICATION = ['ペアワーク', 'グループディスカッション', 'プレゼンテーション', 'インタビュー活動', 'ロールプレイ', 'ディベート', 'ブレインストーミング', 'ワールドカフェ', 'ギャラリーウォーク', 'シンク・ペア・シェア', 'ジグソー活動', '情報交換活動'];

export const EMPTY_FORM = {
  title: '', instructorName: '', schoolName: '', lessonDate: '', schoolType: '', grade: '', subject: '', unit: '', unitObjective: '',
  subUnit: '', subUnitObjective: '', currentLessonObjective: '', lessonNumber: 1, teachingHours: 1, classFormat: [], teachingTheory: [],
  studentCount: 30, materials: [], teachingTools: [], schoolEnvironment: '', studentCharacteristics: '', specialNeedsInfo: '', priorKnowledge: '',
  experientialActivities: '', communicationActivities: '', questions: '', expectedResponses: '', notes: '', evaluation: '', otherInfo: '', language: 'ja',
};

// すぐ試せる入力例（ワンタップで呼び出せる）
export const PRESETS = [
  { name: '小5 算数｜分数のたし算', form: { schoolType: 'elementary', grade: '5', subject: '算数', unit: '分数のたし算とひき算', unitObjective: '異分母分数の加法及び減法の計算ができるようにする', subUnit: '通分して計算しよう', currentLessonObjective: '通分の意味を理解し、異分母分数のたし算ができる', priorKnowledge: '同分母分数の加法・減法、約数と倍数（最小公倍数）', classFormat: ['一斉授業', 'ペア学習'], teachingTheory: ['構成主義（Constructivism）'], materials: ['教科書', 'ワークシート'], teachingTools: ['電子黒板'], studentCount: 32, lessonNumber: 3 } },
  { name: '中3 英語｜現在完了形', form: { schoolType: 'middle', grade: '3', subject: '英語', unit: '現在完了形', unitObjective: '現在完了形の基本的な用法を理解し、使えるようにする', subUnit: '経験を表す現在完了形', currentLessonObjective: 'Have you ever ...? を使って経験を尋ねたり答えたりできる', classFormat: ['ペア学習'], teachingTheory: ['アクティブラーニング（Active Learning）'], materials: ['教科書', 'カード教材'], teachingTools: ['プロジェクター'], studentCount: 35, lessonNumber: 2 } },
  { name: '高1 理科｜光の反射', form: { schoolType: 'high', grade: '1', subject: '理科', unit: '光の性質', unitObjective: '光の反射・屈折の法則を理解し、日常の現象を科学的に説明できる', currentLessonObjective: '実験データから反射の法則を見いだす', classFormat: ['実験・実習', 'グループ学習'], teachingTheory: ['発見学習（Discovery Learning）'], materials: ['実験器具', 'ワークシート'], teachingTools: ['実物投影機'], studentCount: 40, teachingHours: 2 } },
  { name: '小4 国語｜ごんぎつね', form: { schoolType: 'elementary', grade: '4', subject: '国語', unit: 'ごんぎつね', unitObjective: '登場人物の気持ちの変化を、行動や情景描写と結び付けて読む', currentLessonObjective: '最後の場面のごんと兵十の気持ちを、叙述をもとに話し合う', classFormat: ['グループ学習', 'ディスカッション'], teachingTheory: ['社会的構成主義（Social Constructivism）'], materials: ['教科書', 'ワークシート'], teachingTools: ['黒板・ホワイトボード'], studentCount: 30, lessonNumber: 8 } },
  { name: '中2 社会｜江戸幕府の成立', form: { schoolType: 'middle', grade: '2', subject: '社会', unit: '江戸幕府の成立と鎖国', unitObjective: '幕藩体制の仕組みと、対外政策の意図を資料から考察する', currentLessonObjective: '大名統制の仕組みが長期政権を支えた理由を説明できる', classFormat: ['ジグソー法'], teachingTheory: ['協同学習（Cooperative Learning）'], materials: ['教科書', '統計資料', '地図・地球儀'], teachingTools: ['タブレット端末'], studentCount: 34 } },
];

// ── 料金プラン ──
// どのプランでも全機能が使える。違いは「1か月にAIで作成できる指導案の数」とサポート。
const ALL = '全機能（教材AI・相談・記録・分析・評価・改善・ライブラリ）';
export const PLANS = [
  { code: 'free', name: '無料コース', price: 0, limit: 1, desc: '月1件まで指導案作成（登録から3か月）', features: ['AI指導案の自動生成（月1件・3か月間）', ALL, 'Word・Excel・PowerPointほか6形式で書き出し'] },
  { code: 'mini', name: 'ミニコース', price: 500, limit: 5, desc: '月5件まで。まず試したい方に', features: ['AI指導案の自動生成（月5件）', ALL, '期間の制限なし'] },
  { code: 'individual', name: '個人・塾コース', price: 1980, limit: 30, desc: '月30件まで。日々の授業づくりに', features: ['AI指導案の自動生成（月30件）', ALL, 'ライブラリでの指導案の販売に最適'], popular: true },
  { code: 'school', name: '学校コース', price: 4980, limit: 100, desc: '月100件まで。校内研究・複数教員での利用に', features: ['AI指導案の自動生成（月100件）', ALL, '授業研究・校内研修での活用に'] },
  { code: 'government', name: '行政コース', price: 9980, limit: Infinity, desc: '無制限。教育委員会・行政機関向け', features: ['AI指導案の自動生成（無制限）', ALL, '優先サポート・大規模導入の相談'] },
];
export const planOf = (code) => PLANS.find((p) => p.code === code) || PLANS[0];

export const CANCEL_REASONS = ['料金が高い', 'あまり使っていない', '必要な機能がない', '不具合があった', '他のサービスに乗り換える', '一時的に利用を中止したい', 'その他'];

// ── 通貨（参考換算。実際の請求は日本円） ──
export const CURRENCIES = [
  ['JPY', '日本円', 1, 0], ['USD', '米ドル', 0.0067, 2], ['EUR', 'ユーロ', 0.0062, 2], ['GBP', '英ポンド', 0.0053, 2], ['CNY', '人民元', 0.048, 2], ['KRW', '韓国ウォン', 8.93, 0],
  ['AUD', '豪ドル', 0.0103, 2], ['CAD', 'カナダドル', 0.0091, 2], ['CHF', 'スイスフラン', 0.006, 2], ['HKD', '香港ドル', 0.052, 2], ['SGD', 'シンガポールドル', 0.009, 2], ['NZD', 'NZドル', 0.0111, 2],
  ['INR', 'インドルピー', 0.56, 2], ['MXN', 'メキシコペソ', 0.115, 2], ['BRL', 'ブラジルレアル', 0.034, 2], ['THB', 'タイバーツ', 0.24, 2], ['PHP', 'フィリピンペソ', 0.39, 2], ['IDR', 'インドネシアルピア', 107.5, 0],
  ['MYR', 'マレーシアリンギット', 0.03, 2], ['VND', 'ベトナムドン', 170, 0], ['TWD', '台湾ドル', 0.21, 2], ['SAR', 'サウジリヤル', 0.025, 2], ['AED', 'UAEディルハム', 0.025, 2], ['TRY', 'トルコリラ', 0.22, 2],
  ['ZAR', '南アフリカランド', 0.12, 2], ['NOK', 'ノルウェークローネ', 0.072, 2], ['SEK', 'スウェーデンクローナ', 0.07, 2], ['DKK', 'デンマーククローネ', 0.046, 2], ['PLN', 'ポーランドズロチ', 0.028, 2], ['CLP', 'チリペソ', 6.5, 0],
].map(([code, name, rate, digits]) => ({ code, name, rate, digits }));
export function formatPrice(jpy, code = 'JPY') {
  const cur = CURRENCIES.find((c) => c.code === code) || CURRENCIES[0];
  return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: cur.code, maximumFractionDigits: cur.digits, minimumFractionDigits: 0 }).format(jpy * cur.rate);
}

// ── 言語（画面は日本語／英語。指導案は下記のどの言語でも生成できる） ──
export const LANGUAGES = 'ja|日本語,en|English,zh|中文,ko|한국어,es|Español,fr|Français,de|Deutsch,pt|Português,ar|العربية,hi|हिन्दी,ru|Русский,it|Italiano,th|ไทย,vi|Tiếng Việt,id|Bahasa Indonesia,ms|Bahasa Melayu,tl|Filipino,tr|Türkçe,pl|Polski,nl|Nederlands,af|Afrikaans,am|አማርኛ,ay|Aymar aru,az|Azərbaycan,be|Беларуская,bg|Български,bn|বাংলা,bs|Bosanski,ca|Català,ceb|Cebuano,cs|Čeština,cy|Cymraeg,da|Dansk,el|Ελληνικά,eo|Esperanto,et|Eesti,eu|Euskara,fa|فارسی,fi|Suomi,fj|Vosa Vakaviti,fy|Frysk,ga|Gaeilge,gl|Galego,gn|Avañe\'ẽ,gu|ગુજરાતી,ha|Hausa,haw|ʻŌlelo Hawaiʻi,he|עברית,hr|Hrvatski,ht|Kreyòl ayisyen,hu|Magyar,hy|Հայերեն,ig|Igbo,is|Íslenska,jv|Basa Jawa,ka|ქართული,kk|Қазақ,km|ខ្មែរ,kn|ಕನ್ನಡ,ku|Kurdî,lb|Lëtzebuergesch,lo|ລາວ,lt|Lietuvių,lv|Latviešu,mg|Malagasy,mi|Te Reo Māori,mk|Македонски,ml|മലയാളം,mn|Монгол,mr|मराठी,mt|Malti,my|မြန်မာ,ne|नेपाली,no|Norsk,pa|ਪੰਜਾਬੀ,ps|پښتو,qu|Runa Simi,ro|Română,rw|Kinyarwanda,si|සිංහල,sk|Slovenčina,sl|Slovenščina,sm|Gagana Sāmoa,sn|chiShona,so|Soomaali,sq|Shqip,sr|Српски,su|Basa Sunda,sv|Svenska,sw|Kiswahili,ta|தமிழ்,te|తెలుగు,tg|Тоҷикӣ,to|Lea faka-Tonga,uk|Українська,ur|اردو,uz|Oʻzbek,xh|isiXhosa,yo|Yorùbá,zu|isiZulu'
  .split(',').map((x) => { const [code, name] = x.split('|'); return { code, name }; });
export const langName = (code) => LANGUAGES.find((l) => l.code === code)?.name || code;

export const SUGGEST_CATEGORIES = ['新機能の提案', '既存機能の改善', '使いやすさ・デザイン', 'AI機能の強化', '外部サービスとの連携', 'アクセシビリティ・多言語対応', '不具合の報告', 'その他'];
export const SUGGEST_STATUS = { new: '受付済み', reviewing: '検討中', planned: '対応予定', completed: '対応済み', declined: '見送り' };

export const MATERIAL_KINDS = [
  { kind: 'worksheet', name: 'ワークシート', desc: 'めあて・課題・振り返り欄つき' },
  { kind: 'quiz', name: '小テスト', desc: '5〜8問と解答・採点のポイント' },
  { kind: 'rubric', name: 'ルーブリック', desc: '観点×4段階の評価表' },
  { kind: 'questions', name: '発問集', desc: '主発問・補助発問と切り返し' },
  { kind: 'boardwork', name: '板書計画', desc: '区画・順番・色分けまで詳しく' },
  { kind: 'homework', name: '家庭学習', desc: '15〜20分の課題（基礎・発展）' },
  { kind: 'newsletter', name: '学級通信', desc: '保護者向けの授業紹介文' },
];
