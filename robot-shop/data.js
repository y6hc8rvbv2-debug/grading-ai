// 日本製フィジカルAIロボット 製品カタログ
// ・画面（app.js）とサーバー（/api/robot-order.js）の両方から読み込む共通データ
// ・価格はすべて「参考価格（目安・税抜）」。実際の価格・仕様・在庫はメーカー/販売店の見積で確定する
// ・price が null の製品は「要見積」。availability: buy=購入可 / quote=見積後に発注 / rental=レンタル・サブスク中心

export const CATEGORIES = [
  { id: 'industrial', name: '産業用ロボット', icon: '🏭', desc: '溶接・組立・搬送などの工場向けアーム' },
  { id: 'cobot', name: '協働ロボット', icon: '🤝', desc: '柵なしで人の隣で働ける安全設計' },
  { id: 'logistics', name: '物流・搬送', icon: '📦', desc: 'AMR/AGV・荷降ろし・追従台車' },
  { id: 'service', name: '接客・配送', icon: '🛎️', desc: '店舗・施設・屋外の配送や接客' },
  { id: 'food', name: '調理・飲食', icon: '🍜', desc: '厨房の自動調理・ドリンク提供' },
  { id: 'care', name: '介護・医療・装着型', icon: '🩺', desc: '手術支援・移乗・パワーアシスト' },
  { id: 'agri', name: '農業', icon: '🌾', desc: '自動運転トラクタ・収穫ロボット' },
  { id: 'construction', name: '建設・インフラ', icon: '🏗️', desc: '建設現場・鉱山の自動化' },
  { id: 'drone', name: 'ドローン', icon: '🚁', desc: '国産の空撮・点検ドローン' },
  { id: 'security', name: '警備・清掃', icon: '🛡️', desc: '巡回警備・自律清掃' },
  { id: 'home', name: '家庭・パートナー', icon: '🏠', desc: 'ペット型・会話・家事ロボット' },
  { id: 'education', name: '教育・研究・ヒューマノイド', icon: '🎓', desc: 'プログラミング学習・研究開発' },
];

// shape: 画像（SVGイラスト）の形。color: イラストの色
export const PRODUCTS = [
  // ── 産業用ロボット ──
  { id: 'fanuc-lrmate200id', name: 'LR Mate 200iD', maker: 'ファナック', category: 'industrial', shape: 'arm', color: '#f5c400',
    price: null, priceHint: '本体 約250万円〜（目安）', availability: 'quote', leadWeeks: 8,
    summary: '小型・軽量の6軸ロボット。部品のピッキングや組立、検査に。',
    specs: { 可搬質量: '7kg', リーチ: '717mm', 軸数: '6軸', 設置: '床・天吊・壁掛' },
    ai: ['AIビジョン（iRVision）でばら積みピッキング', 'AIサーボチューニング'], tags: ['組立', 'ピッキング', '検査', '工場'] },
  { id: 'fanuc-m20id', name: 'M-20iD/25', maker: 'ファナック', category: 'industrial', shape: 'arm', color: '#f5c400',
    price: null, priceHint: '本体 約400万円〜（目安）', availability: 'quote', leadWeeks: 10,
    summary: '中可搬の万能アーム。ケーブル内蔵で狭い場所のハンドリングに強い。',
    specs: { 可搬質量: '25kg', リーチ: '1831mm', 軸数: '6軸' },
    ai: ['3Dビジョンによる位置補正', '学習制御で振動を抑制'], tags: ['搬送', 'ハンドリング', '工場'] },
  { id: 'fanuc-m2000ia', name: 'M-2000iA/2300', maker: 'ファナック', category: 'industrial', shape: 'arm', color: '#f5c400',
    price: null, priceHint: '要見積（大型・据付工事含む）', availability: 'quote', leadWeeks: 20,
    summary: '自動車ボディも持ち上げる世界最大級の超重可搬ロボット。',
    specs: { 可搬質量: '2300kg', リーチ: '3734mm', 軸数: '6軸' },
    ai: ['ビジョンによるワーク位置検出'], tags: ['重量物', '自動車', '工場'] },
  { id: 'yaskawa-gp7', name: 'MOTOMAN-GP7', maker: '安川電機', category: 'industrial', shape: 'arm', color: '#1c63c7',
    price: null, priceHint: '本体 約200万円〜（目安）', availability: 'quote', leadWeeks: 8,
    summary: '高速・高精度の小型汎用ロボット。食品・医薬品の搬送にも。',
    specs: { 可搬質量: '7kg', リーチ: '927mm', 軸数: '6軸' },
    ai: ['MOTOMAN NEXT連携で自律判断（オプション）'], tags: ['搬送', '組立', '工場'] },
  { id: 'yaskawa-next', name: 'MOTOMAN NEXT', maker: '安川電機', category: 'industrial', shape: 'arm', color: '#1c63c7',
    price: null, priceHint: '要見積', availability: 'quote', leadWeeks: 12,
    summary: '自律的に判断して動く「自律ロボット」。AI処理用コントローラを搭載。',
    specs: { 可搬質量: '4〜35kg（機種別）', 特長: 'オープンなAI開発プラットフォーム' },
    ai: ['周囲を認識して動作を自分で計画', 'パートナー企業のAIアプリを搭載可能'], tags: ['自律', 'AI', '工場', '多品種'] },
  { id: 'kawasaki-rs007n', name: 'RS007N', maker: '川崎重工業', category: 'industrial', shape: 'arm', color: '#ff7a00',
    price: null, priceHint: '本体 約200万円〜（目安）', availability: 'quote', leadWeeks: 8,
    summary: '小型高速の汎用ロボット。電子部品・食品などの軽作業に。',
    specs: { 可搬質量: '7kg', リーチ: '730mm', 軸数: '6軸' },
    ai: ['ビジョン連携ピッキング'], tags: ['組立', 'ピッキング', '工場'] },
  { id: 'nachi-mz07', name: 'MZ07', maker: '不二越（NACHI）', category: 'industrial', shape: 'arm', color: '#2c9c5a',
    price: null, priceHint: '本体 約200万円〜（目安）', availability: 'quote', leadWeeks: 8,
    summary: '世界最速クラスの小型ロボット。モーター・減速機まで自社製。',
    specs: { 可搬質量: '7kg', リーチ: '723mm', 軸数: '6軸' },
    ai: ['3Dビジョン「NACHI AI」でばら積みピッキング'], tags: ['組立', 'ピッキング', '工場'] },
  { id: 'denso-vs', name: 'VSシリーズ', maker: 'デンソーウェーブ', category: 'industrial', shape: 'arm', color: '#e4002b',
    price: null, priceHint: '本体 約180万円〜（目安）', availability: 'quote', leadWeeks: 8,
    summary: 'コンパクトな6軸ロボット。医薬・クリーンルーム仕様も選べる。',
    specs: { 可搬質量: '4〜7kg', リーチ: '505〜905mm', 軸数: '6軸' },
    ai: ['AIによる異常検知（予知保全）'], tags: ['組立', '医薬', 'クリーンルーム', '工場'] },
  { id: 'epson-gx4', name: 'GX4 スカラロボット', maker: 'セイコーエプソン', category: 'industrial', shape: 'scara', color: '#003f98',
    price: null, priceHint: '本体 約150万円〜（目安）', availability: 'quote', leadWeeks: 6,
    summary: '水平方向の高速移動が得意なスカラ。電子部品の組立・整列に。',
    specs: { 可搬質量: '4kg', アーム長: '250〜350mm', 軸数: '4軸' },
    ai: ['力覚センサー連携で精密はめ合い'], tags: ['組立', '電子部品', '工場'] },
  { id: 'yamaha-ykxg', name: 'YK-XG スカラ', maker: 'ヤマハ発動機', category: 'industrial', shape: 'scara', color: '#7a1fa2',
    price: null, priceHint: '本体 約120万円〜（目安）', availability: 'quote', leadWeeks: 6,
    summary: 'ロングセラーの高速スカラロボット。小型から大型まで豊富。',
    specs: { 可搬質量: '1〜50kg（機種別）', 軸数: '4軸' }, ai: ['画像処理連携'], tags: ['組立', '搬送', '工場'] },
  { id: 'mitsubishi-rvfr', name: 'MELFA RV-FR', maker: '三菱電機', category: 'industrial', shape: 'arm', color: '#d9001b',
    price: null, priceHint: '本体 約200万円〜（目安）', availability: 'quote', leadWeeks: 8,
    summary: 'FA機器とつながる「MELFA FR」。AI技術「Maisart」で故障を予知。',
    specs: { 可搬質量: '2〜20kg（機種別）', 軸数: '6軸' }, ai: ['Maisartによる予知保全', '力覚・ビジョン連携'], tags: ['組立', '工場', '予知保全'] },
  { id: 'daihen-fdb4', name: 'FD-B4 溶接ロボット', maker: 'ダイヘン', category: 'industrial', shape: 'arm', color: '#0067b1',
    price: null, priceHint: '溶接電源込み 要見積', availability: 'quote', leadWeeks: 10,
    summary: 'アーク溶接専用ロボット。溶接機メーカーならではの高品質溶接。',
    specs: { 可搬質量: '4kg', リーチ: '1437mm', 用途: 'アーク溶接' }, ai: ['溶接線の自動補正'], tags: ['溶接', '工場'] },

  // ── 協働ロボット ──
  { id: 'fanuc-crx10ia', name: 'CRX-10iA', maker: 'ファナック', category: 'cobot', shape: 'cobot', color: '#2fa84f',
    price: 4500000, priceHint: '目安', availability: 'buy', leadWeeks: 6,
    summary: 'タブレットで直感的に教えられる緑の協働ロボット。初めての導入に人気。',
    specs: { 可搬質量: '10kg', リーチ: '1249mm', 安全: '接触停止・ISO 10218準拠' },
    ai: ['ダイレクトティーチ（手で動かして教える）', 'AIビジョン連携'], tags: ['協働', '組立', '検査', '初心者向け'] },
  { id: 'yaskawa-hc10dtp', name: 'MOTOMAN-HC10DTP', maker: '安川電機', category: 'cobot', shape: 'cobot', color: '#1c63c7',
    price: 4200000, priceHint: '目安', availability: 'buy', leadWeeks: 6,
    summary: '防じん・防滴（IP67）の協働ロボット。食品現場や水回りにも。',
    specs: { 可搬質量: '10kg', リーチ: '1200mm', 保護等級: 'IP67' }, ai: ['手押しで教示', 'ビジョン連携'], tags: ['協働', '食品', '組立'] },
  { id: 'kawasaki-duaro2', name: 'duAro2', maker: '川崎重工業', category: 'cobot', shape: 'dualarm', color: '#ff7a00',
    price: 5500000, priceHint: '目安', availability: 'buy', leadWeeks: 8,
    summary: '人ひとり分のスペースに置ける双腕スカラ。人と並んで作業。',
    specs: { 可搬質量: '3kg×2（片腕）', 腕: '双腕', 移動: 'キャスター台車一体型' }, ai: ['タブレット教示'], tags: ['協働', '組立', '双腕'] },
  { id: 'denso-cobotta', name: 'COBOTTA', maker: 'デンソーウェーブ', category: 'cobot', shape: 'small', color: '#e4002b',
    price: 2000000, priceHint: '目安', availability: 'buy', leadWeeks: 4,
    summary: '持ち運べる約4kgの小型協働ロボット。研究室や卓上作業に。',
    specs: { 可搬質量: '0.5kg', 質量: '約4kg', 軸数: '6軸' }, ai: ['Python等でAI連携しやすい'], tags: ['協働', '卓上', '研究', '検査'] },
  { id: 'mitsubishi-assista', name: 'MELFA ASSISTA', maker: '三菱電機', category: 'cobot', shape: 'cobot', color: '#d9001b',
    price: 4000000, priceHint: '目安', availability: 'buy', leadWeeks: 6,
    summary: 'アーム上のボタンで簡単に教示できる協働ロボット。',
    specs: { 可搬質量: '5kg', リーチ: '910mm' }, ai: ['RT VisualBoxでノーコード作成'], tags: ['協働', '組立', '初心者向け'] },
  { id: 'nachi-cmz05', name: 'CMZ05', maker: '不二越（NACHI）', category: 'cobot', shape: 'cobot', color: '#2c9c5a',
    price: 3500000, priceHint: '目安', availability: 'buy', leadWeeks: 6,
    summary: '人とぶつかると止まる安全設計の協働ロボット。軽量でレイアウト変更も容易。',
    specs: { 可搬質量: '5kg', リーチ: '1046mm' }, ai: ['ビジョン連携'], tags: ['協働', '組立'] },
  { id: 'kawada-nextage', name: 'NEXTAGE', maker: 'カワダロボティクス', category: 'cobot', shape: 'humanoid', color: '#4d6bfe',
    price: null, priceHint: '要見積', availability: 'quote', leadWeeks: 12,
    summary: '頭のカメラで見て両腕で作業するヒト型協働ロボット。人の作業をそのまま置き換え。',
    specs: { 腕: '双腕（6軸×2）', 目: 'ステレオカメラ', 安全: '低出力モーター' }, ai: ['画像認識でワークを把握', '研究用オープン版あり'], tags: ['協働', '双腕', 'ヒューマノイド', '組立'] },

  // ── 物流・搬送 ──
  { id: 'mujin-truckbot', name: 'TruckBot（荷降ろし）', maker: 'Mujin', category: 'logistics', shape: 'arm', color: '#111111',
    price: null, priceHint: '要見積', availability: 'quote', leadWeeks: 24,
    summary: 'トラックやコンテナの荷物を自律で降ろすロボット。MujinControllerで動作を自動生成。',
    specs: { 用途: 'トラック/コンテナ荷降ろし', 制御: 'MujinController' }, ai: ['3D認識で段ボールの位置を判断', 'ティーチング不要の動作計画'], tags: ['物流', '倉庫', '荷降ろし', '自律'] },
  { id: 'zmp-carriro', name: 'CarriRo（キャリロ）', maker: 'ZMP', category: 'logistics', shape: 'amr', color: '#00a0e9',
    price: null, priceHint: 'レンタル 月額 約5万円〜（目安）', availability: 'rental', leadWeeks: 3,
    monthly: 50000,
    summary: '自律走行・追従・遠隔操作ができる台車ロボット。工場や倉庫の搬送に。',
    specs: { 積載: '最大100〜500kg（機種別）', 走行: '自律/追従/手押し' }, ai: ['自己位置推定で自律走行'], tags: ['物流', '工場', '台車', 'AMR'] },
  { id: 'doog-thouzer', name: 'サウザー（THOUZER）', maker: 'Doog', category: 'logistics', shape: 'cart', color: '#ffb300',
    price: 980000, priceHint: '目安', availability: 'buy', leadWeeks: 3,
    summary: '人の後ろをついてくる運搬ロボット。工場・農場・物流センターで活躍。',
    specs: { 積載: '最大120kg', 走行: '人追従・ライントレース' }, ai: ['人を認識して追従'], tags: ['物流', '農業', '台車', '追従'] },
  { id: 'pfr-kachaka-pro', name: 'カチャカプロ', maker: 'Preferred Robotics', category: 'logistics', shape: 'amr', color: '#36b37e',
    price: null, priceHint: 'サブスク 月額 約5万円〜（目安）', availability: 'rental', leadWeeks: 2,
    monthly: 50000,
    summary: '専用ワゴンにドッキングして運ぶ、オフィス・病院・飲食店向け搬送ロボット。',
    specs: { 積載: '最大20〜60kg（ワゴン別）', 操作: 'スマホ・音声' }, ai: ['深層学習による障害物認識', '音声で指示'], tags: ['物流', 'オフィス', '病院', 'AMR'] },
  { id: 'panasonic-hospi', name: 'HOSPI', maker: 'パナソニック', category: 'logistics', shape: 'kiosk', color: '#0041c0',
    price: null, priceHint: '要見積', availability: 'quote', leadWeeks: 8,
    summary: '病院で薬や検体を運ぶ自律搬送ロボット。エレベーターにも乗れる。',
    specs: { 積載: '最大20kg', 機能: '鍵付き収納・EV連携' }, ai: ['自律走行・人の回避'], tags: ['物流', '病院', '搬送'] },
  { id: 'rapyuta-paamr', name: 'ピッキングアシストAMR', maker: 'ラピュタロボティクス', category: 'logistics', shape: 'amr', color: '#ff5a5f',
    price: null, priceHint: 'RaaS（月額）要見積', availability: 'rental', leadWeeks: 8,
    summary: '倉庫のピッキング作業者を案内し、商品を運ぶ協働型AMR。',
    specs: { 用途: '倉庫ピッキング', 台数: '複数台を群制御' }, ai: ['クラウドAIで最適ルート計算'], tags: ['物流', '倉庫', 'AMR'] },
  { id: 'hitachi-racrew', name: 'Racrew（ラックル）', maker: '日立製作所', category: 'logistics', shape: 'amr', color: '#e60027',
    price: null, priceHint: '要見積', availability: 'quote', leadWeeks: 16,
    summary: '棚ごと作業者のところへ運ぶ「棚搬送型」ロボット。歩かないピッキングを実現。',
    specs: { 方式: '棚搬送（GTP）' }, ai: ['在庫配置の最適化'], tags: ['物流', '倉庫', 'AMR'] },

  // ── 接客・配送 ──
  { id: 'avatarin-newme', name: 'newme（ニューミー）', maker: 'avatarin', category: 'service', shape: 'avatar', color: '#00b2a9',
    price: null, priceHint: 'レンタル 要見積', availability: 'rental', leadWeeks: 3,
    summary: '遠隔地から“そこにいるように”接客・見学ができるアバターロボット。',
    specs: { 操作: 'PC/スマホから遠隔操作', 画面: 'タブレット' }, ai: ['自動走行支援'], tags: ['接客', 'アバター', '遠隔', '観光'] },
  { id: 'tx-ghost', name: 'GHOST（棚補充）', maker: 'Telexistence', category: 'service', shape: 'humanoid', color: '#222831',
    price: null, priceHint: 'RaaS 要見積', availability: 'rental', leadWeeks: 16,
    summary: 'コンビニのバックヤードで飲料を陳列するAIロボット。AIが難しい時は遠隔操作。',
    specs: { 用途: '飲料陳列', 方式: 'AI自律＋遠隔操作' }, ai: ['AIで商品を認識して陳列'], tags: ['接客', '小売', '陳列', '自律'] },
  { id: 'zmp-deliro', name: 'DeliRo（デリロ）', maker: 'ZMP', category: 'service', shape: 'amr', color: '#00a0e9',
    price: null, priceHint: '要見積', availability: 'quote', leadWeeks: 12,
    summary: '公道や施設内を走る宅配ロボット。かわいい表情で街になじむ。',
    specs: { 走行: '自動運転（歩道）', 積載: 'ロッカー式' }, ai: ['自動運転AI'], tags: ['配送', '屋外', '自律'] },
  { id: 'panasonic-hakobo', name: 'ハコボ（自動配送）', maker: 'パナソニック', category: 'service', shape: 'amr', color: '#0041c0',
    price: null, priceHint: '配送サービスとして要見積', availability: 'quote', leadWeeks: 16,
    summary: '住宅街での配送を想定した自動配送ロボット。遠隔監視と組み合わせて運用。',
    specs: { 走行: '自律＋遠隔監視' }, ai: ['自律走行'], tags: ['配送', '屋外'] },

  // ── 調理・飲食 ──
  { id: 'cr-soba', name: 'そばロボット', maker: 'コネクテッドロボティクス', category: 'food', shape: 'kitchen', color: '#8d6e63',
    price: null, priceHint: '要見積', availability: 'quote', leadWeeks: 12,
    summary: '生そばを茹でて、洗って、締める工程を自動化。駅そば店で稼働。',
    specs: { 能力: '1時間に約150食（目安）' }, ai: ['調理工程の自動化'], tags: ['飲食', '厨房', '調理'] },
  { id: 'techmagic-probo', name: 'P-Robo（パスタ）', maker: 'TechMagic', category: 'food', shape: 'kitchen', color: '#ff7043',
    price: null, priceHint: '要見積', availability: 'quote', leadWeeks: 16,
    summary: 'パスタの茹で・ソース調理・盛り付けまでを自動で行う調理ロボット。',
    specs: { 能力: '1食 約45秒（目安）' }, ai: ['レシピを再現する自動調理'], tags: ['飲食', '厨房', '調理'] },
  { id: 'newinno-rootc', name: 'root C（無人カフェ）', maker: 'New Innovations', category: 'food', shape: 'kiosk', color: '#6d4c41',
    price: null, priceHint: '要見積', availability: 'quote', leadWeeks: 12,
    summary: 'スマホで注文するとロボットがコーヒーを淹れて受け渡す無人カフェ。',
    specs: { 設置: '約1㎡', 注文: 'スマホアプリ' }, ai: ['顔認証/QRで受け取り'], tags: ['飲食', 'カフェ', '無人店舗'] },
  { id: 'suzumo-sushi', name: 'シャリ玉ロボット', maker: '鈴茂器工', category: 'food', shape: 'kitchen', color: '#26a69a',
    price: 1200000, priceHint: '目安', availability: 'buy', leadWeeks: 4,
    summary: '寿司のシャリを職人のようにふんわり成形。回転寿司・スーパーで定番。',
    specs: { 能力: '1時間に約4,800貫（機種別・目安）' }, ai: ['シャリの硬さを自動調整'], tags: ['飲食', '寿司', '厨房'] },

  // ── 介護・医療・装着型 ──
  { id: 'cyberdyne-hal', name: 'HAL 腰タイプ', maker: 'CYBERDYNE', category: 'care', shape: 'exo', color: '#9e9e9e',
    price: null, priceHint: 'レンタル 月額 約2万円〜（目安）', availability: 'rental', leadWeeks: 2,
    monthly: 20000,
    summary: '体を動かそうとする生体電位信号を読み取り、腰の負担を軽くする装着型ロボット。',
    specs: { 質量: '約3kg', 用途: '介護・作業支援' }, ai: ['生体電位信号で装着者の意思を推定'], tags: ['介護', '装着型', '腰'] },
  { id: 'medicaroid-hinotori', name: 'hinotori サージカルロボット', maker: 'メディカロイド', category: 'care', shape: 'arm', color: '#c62828',
    price: null, priceHint: '医療機関向け 要見積', availability: 'quote', leadWeeks: 26,
    summary: '国産初の手術支援ロボット。医師がコックピットから4本のアームを操作。',
    specs: { アーム: '4本', 区分: '医療機器（医療機関のみ）' }, ai: ['手ぶれ補正・動作スケーリング'], tags: ['医療', '手術'] },
  { id: 'fuji-hug', name: 'Hug T1（移乗サポート）', maker: 'FUJI', category: 'care', shape: 'cart', color: '#00897b',
    price: 800000, priceHint: '目安', availability: 'buy', leadWeeks: 4,
    summary: 'ベッドから車いすへの移乗を抱きかかえてサポート。介護者の腰を守る。',
    specs: { 対象: '立ち上がり支援が必要な方', 操作: 'リモコン' }, ai: ['人の動きに合わせた動作'], tags: ['介護', '移乗'] },
  { id: 'innophys-musclesuit', name: 'マッスルスーツ Every', maker: 'イノフィス', category: 'care', shape: 'exo', color: '#455a64',
    price: 150000, priceHint: '目安', availability: 'buy', leadWeeks: 1,
    summary: '電源不要・人工筋肉で腰をアシスト。介護・物流・農業で使える。',
    specs: { 質量: '約3.8kg', 動力: '空気圧人工筋肉（電源不要）' }, ai: ['（電子制御なしのアシストスーツ）'], tags: ['介護', '装着型', '腰', '農業'] },
  { id: 'toyota-welwalk', name: 'ウェルウォーク WW-2000', maker: 'トヨタ自動車', category: 'care', shape: 'kiosk', color: '#eb0a1e',
    price: null, priceHint: 'レンタル 要見積', availability: 'rental', leadWeeks: 8,
    summary: '脳卒中などで歩きにくくなった方の歩行リハビリを支援するロボット。',
    specs: { 区分: '医療機関向け', 構成: 'トレッドミル＋ロボット脚' }, ai: ['歩行状態に合わせたアシスト調整'], tags: ['医療', 'リハビリ'] },
  { id: 'fujisoft-palro', name: 'PALRO（パルロ）', maker: '富士ソフト', category: 'care', shape: 'humanoid', color: '#ff8a65',
    price: 600000, priceHint: '高齢者福祉モデル 目安', availability: 'buy', leadWeeks: 3,
    summary: '高齢者施設でレクリエーションや体操を進行するコミュニケーションロボット。',
    specs: { 身長: '約40cm', 機能: '会話・体操・クイズ' }, ai: ['顔と名前を覚えて会話'], tags: ['介護', '会話', '高齢者'] },

  // ── 農業 ──
  { id: 'kubota-mr1000a', name: 'アグリロボトラクタ MR1000A', maker: 'クボタ', category: 'agri', shape: 'tractor', color: '#ff6f00',
    price: null, priceHint: '本体 約1,500万円〜（目安）', availability: 'quote', leadWeeks: 12,
    summary: '無人で耕うん・代かきができる自動運転トラクタ。人が監視しながら運用。',
    specs: { 出力: '約100馬力', 測位: 'GNSS（RTK）' }, ai: ['障害物検知で自動停止', '自動経路生成'], tags: ['農業', '自動運転', 'トラクタ'] },
  { id: 'kubota-drh1200a', name: 'アグリロボコンバイン DRH1200A', maker: 'クボタ', category: 'agri', shape: 'tractor', color: '#ff6f00',
    price: null, priceHint: '要見積', availability: 'quote', leadWeeks: 12,
    summary: '自動運転で稲・麦を収穫するコンバイン。オペレーター1人で効率作業。',
    specs: { 刈幅: '6条', 測位: 'GNSS' }, ai: ['収穫経路の自動生成', '食味・収量センシング'], tags: ['農業', '自動運転', '収穫'] },
  { id: 'kubota-nw8sa', name: 'アグリロボ田植機 NW8SA', maker: 'クボタ', category: 'agri', shape: 'tractor', color: '#ff6f00',
    price: null, priceHint: '要見積', availability: 'quote', leadWeeks: 10,
    summary: 'まっすぐ自動で植えていく自動運転田植機。苗補給だけで作業可能。',
    specs: { 条数: '8条', 測位: 'GNSS' }, ai: ['自動直進・自動旋回'], tags: ['農業', '自動運転', '田植え'] },
  { id: 'yanmar-yt5113a', name: 'ロボットトラクター YT5113A', maker: 'ヤンマー', category: 'agri', shape: 'tractor', color: '#e60012',
    price: null, priceHint: '要見積', availability: 'quote', leadWeeks: 12,
    summary: 'タブレットで指示して無人作業。有人機との2台協調作業も可能。',
    specs: { 出力: '約113馬力', 測位: 'GNSS（RTK）' }, ai: ['障害物センサーで停止', '作業経路の自動作成'], tags: ['農業', '自動運転', 'トラクタ'] },
  { id: 'inaho-harvester', name: '自動野菜収穫ロボット', maker: 'inaho', category: 'agri', shape: 'cart', color: '#43a047',
    price: null, priceHint: '収穫量に応じた従量課金（RaaS）', availability: 'rental', leadWeeks: 8,
    summary: 'AIで収穫に適したアスパラガス等を見分けて自動収穫。',
    specs: { 対象: 'アスパラガス・きゅうり等', 方式: 'AI画像認識' }, ai: ['画像AIで収穫適期を判定'], tags: ['農業', '収穫', 'AI'] },

  // ── 建設・インフラ ──
  { id: 'komatsu-ahs', name: '無人ダンプトラック運行システム（AHS）', maker: 'コマツ', category: 'construction', shape: 'tractor', color: '#ffc20e',
    price: null, priceHint: '鉱山向け 要見積', availability: 'quote', leadWeeks: 52,
    summary: '鉱山で大型ダンプトラックを無人運行する自律システム。',
    specs: { 対象: '超大型ダンプ', 運用: '管制システムで集中管理' }, ai: ['自律走行・衝突回避'], tags: ['建設', '鉱山', '自律'] },
  { id: 'kenrobo-tomorobo', name: 'トモロボ（鉄筋結束）', maker: '建ロボテック', category: 'construction', shape: 'cart', color: '#1565c0',
    price: null, priceHint: 'レンタル 要見積', availability: 'rental', leadWeeks: 3,
    summary: '鉄筋の交差部を自動で結束するロボット。腰をかがめる重労働を削減。',
    specs: { 用途: '鉄筋結束（スラブ）' }, ai: ['交差点を検出して自走'], tags: ['建設', '現場'] },

  // ── ドローン ──
  { id: 'acsl-soten', name: 'SOTEN（蒼天）', maker: 'ACSL', category: 'drone', shape: 'drone', color: '#1e88e5',
    price: null, priceHint: '機体 約70万円〜（目安）', availability: 'quote', leadWeeks: 4,
    summary: 'セキュリティを重視した国産小型空撮ドローン。カメラを用途で交換可能。',
    specs: { 飛行時間: '約25分', カメラ: '交換式（標準/赤外線/マルチスペクトル）' }, ai: ['自動飛行・画像解析連携'], tags: ['ドローン', '点検', '空撮', 'セキュリティ'] },
  { id: 'liberaware-ibis2', name: 'IBIS2', maker: 'Liberaware', category: 'drone', shape: 'drone', color: '#263238',
    price: null, priceHint: 'レンタル/点検サービス 要見積', availability: 'rental', leadWeeks: 3,
    summary: '天井裏・配管内など狭く暗い場所の点検に特化した小型ドローン。',
    specs: { サイズ: '約20cm角', 用途: '屋内狭小空間点検' }, ai: ['撮影映像から3Dモデル生成'], tags: ['ドローン', '点検', '屋内'] },
  { id: 'sony-airpeak-s1', name: 'Airpeak S1', maker: 'ソニー', category: 'drone', shape: 'drone', color: '#333333',
    price: 1100000, priceHint: '機体 目安', availability: 'buy', leadWeeks: 2,
    summary: 'αシリーズのカメラを載せて飛べるプロ向け空撮ドローン。',
    specs: { 搭載: 'フルサイズミラーレス一眼', 最高速度: '約90km/h' }, ai: ['ビジョンセンサーで障害物検知'], tags: ['ドローン', '空撮', '映像制作'] },

  // ── 警備・清掃 ──
  { id: 'secom-x2', name: 'セコムロボットX2', maker: 'セコム', category: 'security', shape: 'kiosk', color: '#005bac',
    price: null, priceHint: '警備サービスとして要見積', availability: 'quote', leadWeeks: 8,
    summary: '施設内を自律巡回して異常を見つける警備ロボット。',
    specs: { 機能: '巡回・画像監視・通話' }, ai: ['AIによる不審物・異常検知'], tags: ['警備', '施設', '自律'] },
  { id: 'alsok-reborg', name: 'REBORG-Z', maker: 'ALSOK', category: 'security', shape: 'kiosk', color: '#0071bc',
    price: null, priceHint: '警備サービスとして要見積', availability: 'quote', leadWeeks: 8,
    summary: '空港や商業施設で巡回・案内を行う警備ロボット。',
    specs: { 機能: '巡回・案内・顔認証' }, ai: ['顔認証・異常検知'], tags: ['警備', '施設', '案内'] },
  { id: 'ugo-pro', name: 'ugo Pro', maker: 'ugo', category: 'security', shape: 'avatar', color: '#00bcd4',
    price: null, priceHint: 'レンタル 要見積', availability: 'rental', leadWeeks: 4,
    summary: '高さを変えられる2本腕の業務用ロボット。警備巡回・点検・遠隔操作に。',
    specs: { 腕: '双腕', 操作: '遠隔＋自律' }, ai: ['メーター読取りなどの自動点検'], tags: ['警備', '点検', 'アバター'] },
  { id: 'amano-egrobo', name: 'EGrobo（イージーロボ）', maker: 'アマノ', category: 'security', shape: 'vacuum', color: '#3949ab',
    price: null, priceHint: '本体 約300万円〜（目安）', availability: 'quote', leadWeeks: 6,
    summary: '業務用の自律走行床洗浄ロボット。商業施設・空港の夜間清掃に。',
    specs: { 方式: '床洗浄（スクラバー）', 走行: '教示ルート自律走行' }, ai: ['障害物回避'], tags: ['清掃', '施設', '自律'] },

  // ── 家庭・パートナー ──
  { id: 'sony-aibo', name: 'aibo（ERS-1000）', maker: 'ソニー', category: 'home', shape: 'pet', color: '#e0e0e0',
    price: 290000, priceHint: '本体 目安（別途プラン料金）', availability: 'buy', leadWeeks: 1,
    summary: '家族を覚えて成長する犬型ロボット。表情豊かに一緒に暮らす。',
    specs: { センサー: 'カメラ・ToF・タッチ', 通信: 'Wi-Fi/LTE' }, ai: ['顔認識で家族を覚える', 'クラウドAIで性格が育つ'], tags: ['家庭', 'ペット', '癒し'] },
  { id: 'groovex-lovot', name: 'LOVOT', maker: 'GROOVE X', category: 'home', shape: 'pet', color: '#8d6e63',
    price: 500000, priceHint: '本体 目安（別途月額）', availability: 'buy', leadWeeks: 2,
    summary: '抱っこできる、あたたかい家族型ロボット。名前を呼ぶと寄ってくる。',
    specs: { センサー: '50以上', 体温: '約37℃' }, ai: ['人を見分けて懐き方が変わる', '自律充電'], tags: ['家庭', 'ペット', '癒し', '見守り'] },
  { id: 'pfr-kachaka', name: 'カチャカ（家庭用）', maker: 'Preferred Robotics', category: 'home', shape: 'amr', color: '#36b37e',
    price: 200000, priceHint: '本体 目安', availability: 'buy', leadWeeks: 1,
    summary: '家具を運ぶ家庭用ロボット。「カチャカ、ワゴンを持ってきて」で片付けが楽に。',
    specs: { 積載: '最大20kg（専用家具）', 操作: '音声・スマホ' }, ai: ['深層学習で床の小物も回避', 'スマートスピーカー連携'], tags: ['家庭', '家事', '片付け'] },
  { id: 'sharp-robohon', name: 'RoBoHoN（ロボホン）', maker: 'シャープ', category: 'home', shape: 'humanoid', color: '#90a4ae',
    price: 200000, priceHint: '本体 目安', availability: 'buy', leadWeeks: 1,
    summary: '歩いて踊る小さなロボット型電話。プロジェクター内蔵。',
    specs: { 身長: '約19.5cm', 機能: '通話・写真・プロジェクター' }, ai: ['音声対話AI'], tags: ['家庭', '会話', 'ガジェット'] },
  { id: 'panasonic-nicobo', name: 'NICOBO（ニコボ）', maker: 'パナソニック', category: 'home', shape: 'pet', color: '#bcaaa4',
    price: 60000, priceHint: '本体 目安（別途月額）', availability: 'buy', leadWeeks: 1,
    summary: 'ちょっと弱くて、かわいい“モコ語”で話す丸いロボット。',
    specs: { サイズ: '直径約18cm' }, ai: ['少しずつ言葉を覚える'], tags: ['家庭', 'ペット', '癒し'] },
  { id: 'mixi-romi', name: 'Romi（ロミィ）', maker: 'MIXI', category: 'home', shape: 'small', color: '#ffd54f',
    price: 40000, priceHint: '本体 目安（別途月額）', availability: 'buy', leadWeeks: 1,
    summary: '手のひらサイズの会話AIロボット。生成AIで自然なおしゃべり。',
    specs: { サイズ: '手のひらサイズ' }, ai: ['生成AIによる自由会話', '日記・見守り'], tags: ['家庭', '会話', '見守り'] },
  { id: 'yukai-boccoemo', name: 'BOCCO emo', maker: 'ユカイ工学', category: 'home', shape: 'small', color: '#ffab91',
    price: 30000, priceHint: '目安', availability: 'buy', leadWeeks: 1,
    summary: '家族のメッセージを伝える見守りコミュニケーションロボット。',
    specs: { 機能: 'メッセージ・センサー連携' }, ai: ['音声認識・天気や予定の読み上げ'], tags: ['家庭', '見守り', '会話'] },
  { id: 'yukai-qoobo', name: 'Qoobo', maker: 'ユカイ工学', category: 'home', shape: 'pet', color: '#9e9e9e',
    price: 15000, priceHint: '目安', availability: 'buy', leadWeeks: 1,
    summary: 'なでると“しっぽ”で応えるクッション型セラピーロボット。',
    specs: { 種類: '標準/プチ' }, ai: ['なで方で反応が変わる'], tags: ['家庭', '癒し', 'ペット'] },
  { id: 'panasonic-rulo', name: 'ロボット掃除機 RULO', maker: 'パナソニック', category: 'home', shape: 'vacuum', color: '#424242',
    price: 100000, priceHint: '目安', availability: 'buy', leadWeeks: 1,
    summary: '三角形で部屋の隅まで掃除するロボット掃除機。',
    specs: { 形状: 'ルーローの三角形', 機能: 'ゴミ検知・マッピング' }, ai: ['空間認識で効率よく掃除'], tags: ['家庭', '掃除', '家事'] },

  // ── 教育・研究・ヒューマノイド ──
  { id: 'kawasaki-kaleido', name: 'Kaleido（カレイド）', maker: '川崎重工業', category: 'education', shape: 'humanoid', color: '#ff7a00',
    price: null, priceHint: '研究開発向け 要見積', availability: 'quote', leadWeeks: 26,
    summary: '人と同じ環境で働くことを目指す大型ヒューマノイド。災害対応の研究にも。',
    specs: { 身長: '約180cm', 区分: '研究開発用' }, ai: ['歩行・転倒からの起き上がり'], tags: ['ヒューマノイド', '研究', '災害対応'] },
  { id: 'vstone-sota', name: 'Sota（ソータ）', maker: 'ヴイストン', category: 'education', shape: 'humanoid', color: '#eceff1',
    price: 100000, priceHint: '目安', availability: 'buy', leadWeeks: 2,
    summary: '受付・プログラミング教育・研究に使える卓上コミュニケーションロボット。',
    specs: { 身長: '約28cm', 開発: 'Java/ビジュアルプログラミング' }, ai: ['顔検出・音声対話'], tags: ['教育', '研究', '会話', '受付'] },
  { id: 'kondo-khr3hv', name: 'KHR-3HV Ver.3', maker: '近藤科学', category: 'education', shape: 'humanoid', color: '#546e7a',
    price: 100000, priceHint: '組立キット 目安', availability: 'buy', leadWeeks: 1,
    summary: 'ロボット競技でおなじみの二足歩行ヒューマノイド組立キット。',
    specs: { 身長: '約40cm', 自由度: '17軸' }, ai: ['（外部PCでAI制御を学べる）'], tags: ['教育', 'ヒューマノイド', 'ホビー'] },
  { id: 'sony-toio', name: 'toio（トイオ）', maker: 'ソニー・インタラクティブエンタテインメント', category: 'education', shape: 'small', color: '#ffffff',
    price: 15000, priceHint: '目安', availability: 'buy', leadWeeks: 1,
    summary: '小さなキューブ型ロボットで遊びながらプログラミングを学べる。',
    specs: { 対象: '小学生〜', 開発: 'ビジュアル/JavaScript/Python' }, ai: ['位置検出マットで正確に移動'], tags: ['教育', 'プログラミング', '子ども'] },
];

// オプション（年額や一時費用）
export const OPTIONS = [
  { id: 'install', name: '設置・初期設定サポート', price: 150000, note: '搬入・据付・動作確認（大型機は別途見積）' },
  { id: 'training', name: '操作トレーニング（1日）', price: 80000, note: '現場スタッフ向けの教示・操作講習' },
  { id: 'maintenance', name: '保守プラン（1年）', price: 120000, note: '定期点検・リモート監視・部品優先手配' },
  { id: 'warranty', name: '延長保証（+2年）', priceRate: 0.05, note: '本体価格の5%' },
];

export const TAX_RATE = 0.1;
export const FREE_SHIPPING_LINE = 100000;
export const SHIPPING_FEE = 5000;

export function findProduct(id) {
  return PRODUCTS.find((p) => p.id === id) || null;
}

// オプション価格（延長保証は本体価格に比例）
export function optionPrice(option, product) {
  if (option.priceRate) return product.price ? Math.round(product.price * option.priceRate) : 0;
  return option.price;
}

// カート [{id, qty, options:[...], plan:'buy'|'rental'}] から金額を計算（画面とサーバーで同じ計算を使う）
export function calcTotals(items) {
  let subtotal = 0;
  let monthly = 0;
  let quoteCount = 0;
  const lines = [];
  for (const item of items) {
    const p = findProduct(item.id);
    if (!p) continue;
    const qty = Math.max(1, Math.min(99, Number(item.qty) || 1));
    const plan = item.plan === 'rental' && p.monthly ? 'rental' : 'buy';
    const opts = OPTIONS.filter((o) => (item.options || []).includes(o.id));
    let unit = 0;
    let unitMonthly = 0;
    let needsQuote = false;
    if (plan === 'rental') unitMonthly = p.monthly;
    else if (p.price) unit = p.price;
    else needsQuote = true;
    const optTotal = opts.reduce((s, o) => s + optionPrice(o, p), 0);
    const lineTotal = (unit + optTotal) * qty;
    subtotal += lineTotal;
    monthly += unitMonthly * qty;
    if (needsQuote) quoteCount += 1;
    lines.push({ id: p.id, name: p.name, maker: p.maker, qty, plan, unit, unitMonthly, options: opts.map((o) => o.id), optTotal, lineTotal, needsQuote });
  }
  const shipping = subtotal === 0 || subtotal >= FREE_SHIPPING_LINE ? 0 : SHIPPING_FEE;
  const tax = Math.round((subtotal + shipping) * TAX_RATE);
  const monthlyTax = Math.round(monthly * TAX_RATE);
  return { lines, subtotal, shipping, tax, total: subtotal + shipping + tax, monthly, monthlyTotal: monthly + monthlyTax, quoteCount };
}
