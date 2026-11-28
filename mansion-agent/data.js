// 初期データ（資料から読み取った内容）。個人名・口座番号は含めない。
'use strict';

window.SEED = {
  building: {
    name: '当マンション',  // 実名は公開ファイルに書かない（設定画面で変更）
    units: '住宅133戸・店舗1戸',
    period: '第34期（2026年8月〜2027年7月）',
  },
  // 期限・予定（ダッシュボードのアラート元）
  deadlines: [
    { id: 'd1', date: '2026-12-15', title: '次回理事会（12月）の日時を決める', note: '招集案内の日時が空欄のまま', level: 'mid' },
    { id: 'd2', date: '2027-09-30', title: '管理費等保証契約の満了', note: '委託契約（〜2028/1/31）より先に切れる。更新されるか管理会社に確認', level: 'high' },
    { id: 'd3', date: '2027-10-31', title: '管理委託契約の更新・解約の申し出期限', note: '満了（2028/1/31）の3ヵ月前まで・書面（第21条・第23条）', level: 'high' },
    { id: 'd4', date: '2027-01-31', title: '管理委託契約（新）開始の前日', note: '第3号議案の契約は2027/2/1から', level: 'low' },
  ],
  // 点検の指摘事項（特記事項より）
  todos: [
    { id: 't1', cat: '電気設備', date: '2026-09-09', text: '電気室の区分開閉器（2007年製・15年超）の交換。故障すると周辺を停電させる波及事故のおそれ', pri: 'high', status: '未対応' },
    { id: 't2', cat: '簡易専用水道', date: '2026-07-16', text: '受水槽No.1・No.2のボルト腐食。内部の水質を汚染するおそれ', pri: 'high', status: '未対応' },
    { id: 't3', cat: '設備総合点検', date: '2026-09-09', text: '屋上の貯湯槽設備排水管からの水漏れ（修繕中）', pri: 'high', status: '対応中' },
    { id: 't4', cat: '消防設備', date: '2026-07-18', text: '住戸内の火災感知器1個が作動しない（点検報告書で部屋を確認）', pri: 'high', status: '未対応' },
    { id: 't5', cat: '消防設備', date: '2026-07-18', text: '14階大浴場・14階外階段出入口の誘導灯（2台）バッテリー電圧不足', pri: 'high', status: '未対応' },
    { id: 't6', cat: '消防設備', date: '2026-07-18', text: '連結送水管4階格納箱が腐食で開閉困難', pri: 'mid', status: '未対応' },
    { id: 't7', cat: 'エレベーター', date: '2026-10-07', text: '制御盤内コンダクタの是正（見積提出済み）', pri: 'high', status: '見積あり' },
    { id: 't8', cat: 'エレベーター', date: '2026-10-07', text: '欠相検出リレー・タイマーリレー・巻上機ベアリング・停電用バッテリー等の交換推奨', pri: 'mid', status: '未対応' },
    { id: 't9', cat: '設備総合点検', date: '2026-09-09', text: '各階送水口ボックスの腐食で開閉困難。交換推奨', pri: 'mid', status: '未対応' },
    { id: 't10', cat: '設備総合点検', date: '2026-09-09', text: '各誘導灯の定期交換サイン（赤ランプ）点滅', pri: 'mid', status: '未対応' },
    { id: 't11', cat: '設備総合点検', date: '2026-09-09', text: '屋上の消防用補給水槽の制御盤と配管に腐食。交換推奨', pri: 'mid', status: '未対応' },
    { id: 't12', cat: '設備総合点検', date: '2026-09-09', text: '非常用照明ランプの一部が点灯しない', pri: 'mid', status: '未対応' },
    { id: 't13', cat: '設備総合点検', date: '2026-09-09', text: '2階作業スペース天井（1階フロント真上）に漏水跡', pri: 'mid', status: '未対応' },
    { id: 't14', cat: '設備総合点検', date: '2026-09-09', text: 'ラウンジ系統の通気ダクト腐食／電気室ドア下部に腐食穴', pri: 'low', status: '未対応' },
    { id: 't15', cat: '簡易専用水道', date: '2026-07-16', text: '受水槽マンホール蓋のヒンジ緩み・防水密閉不良、パッキン劣化', pri: 'mid', status: '未対応' },
    { id: 't16', cat: '電気設備', date: '2026-09-09', text: '屋外階段誘導灯の器具が錆で腐食／屋上排煙ファン制御盤の腐食', pri: 'mid', status: '未対応' },
    { id: 't17', cat: '自動扉', date: '2026-08-06', text: '正面玄関内・プール出入口の下框腐食で変形（見積提出済み）', pri: 'mid', status: '見積あり' },
    { id: 't18', cat: '自動扉', date: '2026-08-06', text: '正面玄関・プール出入口の扉ブレ止め破損、補助センサー増設・ユニット交換', pri: 'low', status: '未対応' },
    { id: 't19', cat: '共用部外観', date: '2026-04-23', text: '外壁等大規模修繕／屋上給湯器配管漏れ／屋上床防水などの検討', pri: 'mid', status: '検討中' },
  ],
  finance: {
    asOf: '2026-09-30',
    kanriSurplus: 2337118,
    shuzenBalance: 49366756,
    shuzenAfterBudget: 13230000,
    shuzenPlannedWork: 47950000,
    arrearsTotal: 357920,
    contractMonthly: 1023330,
    contractMonthlyExTax: 930300,
    // 管理委託費のうち、自分で雇うと置き換わる部分（別紙2・税抜）
    staffPartsExTax: { '管理員': 180000, '夜間管理員': 174000, '清掃員': 195000 },
  },
  // 滞納（部屋番号は公開ファイルに書かず、画面で入力して暗号化保存する）
  arrears: [
    { id: 'a1', room: '（部屋番号を入力）', amount: 150000, period: '2023/11〜2025/01', history: '電話・訪問・督促状。11/16 督促', next: '' },
    { id: 'a2', room: '（部屋番号を入力）', amount: 40000, period: '2026/03〜2026/06', history: '督促中。12/15 督促予定', next: '2026-12-15' },
  ],
  // 別紙3：管理事務を実施しない場合の精算（税抜・1回あたり）
  settlement: [
    { id: 's1', name: '定期清掃Ⅰ', months: [7, 1], amount: 24000 },
    { id: 's2', name: '定期清掃Ⅱ', months: [4, 10], amount: 90000 },
    { id: 's3', name: '定期清掃Ⅲ', months: [7, 1], amount: 30000 },
    { id: 's4', name: '定期清掃Ⅳ', months: [4, 7, 10, 1], amount: 9000 },
    { id: 's5', name: '定期清掃Ⅴ', months: [6], amount: 24000 },
    { id: 's6', name: '定期清掃Ⅵ', months: [6], amount: 30000 },
    { id: 's7', name: '設備総合点検', months: [3, 5, 7, 9, 11, 1], amount: 13000 },
    { id: 's8', name: '貯水槽清掃', months: [6], amount: 78000 },
    { id: 's9', name: '簡易専用水道検査', months: [7], amount: 18000 },
    { id: 's10', name: '建築設備定期検査', months: [8], amount: 192000 },
    { id: 's11', name: '消防用設備点検', months: [7, 1], amount: 228000 },
    { id: 's12', name: '自動扉設備点検', months: [4, 8, 12], amount: 48000 },
    { id: 's13', name: '自家用電気設備点検', months: [3, 5, 7, 9, 11, 1], amount: 37000 },
    { id: 's14', name: 'プリペイ設備点検', months: [10], amount: 168000 },
    { id: 's15', name: 'ヒーツ保守点検', months: [9], amount: 144000 },
  ],
  contractNotes: [
    { level: 'high', text: '第18条：再委託のときに管理組合の承諾が不要になり、「再委託先を監督する」だけになっています。個人情報を扱う再委託先を事前に知らせてもらう条件を総会で求めるのがおすすめです。' },
    { level: 'high', text: '第18条6項：契約終了時の個人情報は「協議して返却又は廃棄」のみで、書面での報告義務がありません。廃棄証明の提出を求めましょう。' },
    { level: 'mid', text: '委託費は月額約7万円下がりますが、エレベーター保守（月37,400円）が別契約になるため、実際の削減は月額33,440円です。管理員の勤務は週6日→週5日に減ります。' },
    { level: 'mid', text: '別紙3：点検を実施しなかった分の精算は「書面で申し出た場合」だけ行われます。下の精算チェックで未実施を記録してください。' },
    { level: 'low', text: '別紙4：通帳は管理会社、印鑑・支払承認パスワードは管理組合が保管。片方だけでは引き出せない安全な形です。' },
    { level: 'low', text: '委託費内訳（別紙2）の合計 930,300円＋税93,030円＝1,023,330円。計算は契約書と一致しています。' },
  ],
  // 従業員（サンプル枠。名前は入れない）
  employees: [
    { id: 'e1', name: 'スタッフA', job: '管理員（日勤）', type: '正社員', payType: 'monthly', base: 210000, allowance: 0, commute: 10000, weeklyHours: 40, weeklyDays: 5, monthlyHours: 173, birth: '', dependents: 0, hireDate: '2027-02-01', residentTax: 0 },
    { id: 'e2', name: 'スタッフB', job: '管理員（交代）', type: 'パート', payType: 'hourly', base: 1200, allowance: 0, commute: 5000, weeklyHours: 24, weeklyDays: 3, monthlyHours: 0, birth: '', dependents: 0, hireDate: '2027-02-01', residentTax: 0 },
    { id: 'e3', name: 'スタッフC', job: '夜間管理員', type: '正社員', payType: 'monthly', base: 200000, allowance: 0, commute: 10000, weeklyHours: 40, weeklyDays: 5, monthlyHours: 173, birth: '', dependents: 0, hireDate: '2027-02-01', residentTax: 0, nightHoursDefault: 56 },
    { id: 'e4', name: 'スタッフD', job: '夜間管理員（交代）', type: 'パート', payType: 'hourly', base: 1250, allowance: 0, commute: 5000, weeklyHours: 16, weeklyDays: 2, monthlyHours: 0, birth: '', dependents: 0, hireDate: '2027-02-01', residentTax: 0, nightHoursDefault: 24 },
    { id: 'e5', name: 'スタッフE', job: '清掃員', type: 'パート', payType: 'hourly', base: 1100, allowance: 0, commute: 5000, weeklyHours: 25, weeklyDays: 5, monthlyHours: 0, birth: '', dependents: 0, hireDate: '2027-02-01', residentTax: 0 },
    { id: 'e6', name: 'スタッフF', job: '清掃員', type: 'パート', payType: 'hourly', base: 1100, allowance: 0, commute: 5000, weeklyHours: 20, weeklyDays: 4, monthlyHours: 0, birth: '', dependents: 0, hireDate: '2027-02-01', residentTax: 0 },
  ],
  // 料率（必ず最新の公表値に更新すること）
  rates: {
    healthPct: 9.55,      // 協会けんぽ新潟（2025年度の値）
    kaigoPct: 1.59,       // 介護保険（2025年度の値）
    pensionPct: 18.3,     // 厚生年金
    kodomoShienPct: 0.23, // 子ども・子育て支援金（2026年4月分〜・目安）
    kodomoKyoshutsuPct: 0.36, // 子ども・子育て拠出金（事業主のみ）
    koyoEmpPerMil: 5.5,   // 雇用保険 労働者負担（‰）
    koyoErPerMil: 9,      // 雇用保険 事業主負担（‰）
    rosaiPerMil: 5.5,     // 労災保険（ビルメンテナンス業・事業主のみ‰）
    minWage: 1050,        // 新潟県最低賃金（要確認）
    shahoHours: 30,       // 社会保険に入る週の労働時間の目安
    koyoHours: 20,        // 雇用保険に入る週の労働時間
    payday: 25,
    // 源泉所得税（電子計算機特例の定数・月額）
    taxKyuyoMin: 54167,
    taxKiso: 48334,
    taxFuyo: 31667,
  },
  hiringChecklist: [
    { id: 'h1', when: '雇う前', text: '総会で「管理員・清掃員を直接雇用する」予算と方針を決議する' },
    { id: 'h2', when: '雇う前', text: '管理会社と契約変更を協議（管理員業務・清掃業務を委託から外す。申し出は3ヵ月前・書面）' },
    { id: 'h3', when: '雇入れ時', text: '労働条件通知書（雇用契約書）を作って渡す' },
    { id: 'h4', when: '10日以内', text: '労働保険 保険関係成立届（労働基準監督署）' },
    { id: 'h5', when: '50日以内', text: '労働保険 概算保険料申告書' },
    { id: 'h6', when: '10日以内', text: '雇用保険 適用事業所設置届（ハローワーク）' },
    { id: 'h7', when: '翌月10日まで', text: '雇用保険 被保険者資格取得届（週20時間以上の人）' },
    { id: 'h8', when: '5日以内', text: '健康保険・厚生年金 新規適用届（年金事務所）※法人なので加入義務あり' },
    { id: 'h9', when: '5日以内', text: '健康保険・厚生年金 資格取得届（週30時間以上の人）' },
    { id: 'h10', when: '1ヵ月以内', text: '給与支払事務所等の開設届出書（税務署）' },
    { id: 'h11', when: '任意', text: '源泉所得税の納期の特例の承認申請（10人未満なら年2回納付にできる）' },
    { id: 'h12', when: '雇入れ時', text: '扶養控除等申告書を各従業員から回収' },
    { id: 'h13', when: '雇入れ時', text: '法定三帳簿（労働者名簿・賃金台帳・出勤簿）を用意（5年保存）' },
    { id: 'h14', when: '残業させる前', text: '36協定を結んで労働基準監督署に届け出る' },
    { id: 'h15', when: '雇入れ時', text: '雇入れ時の健康診断（週30時間以上の人）' },
    { id: 'h16', when: '検討', text: '夜間管理員：仮眠時間の扱い・宿日直許可（労基署）を確認' },
    { id: 'h17', when: '雇入れ時', text: 'マイナンバー・給与振込口座はこのアプリに入れず、鍵付きの書類保管で管理' },
  ],
  yearlyTasks: [
    { month: 0, day: 10, text: '前月分の源泉所得税・住民税（特別徴収）を納付（納期の特例なら1/20・7/10）' },
    { month: 1, day: 20, text: '（納期の特例）7〜12月分の源泉所得税を納付' },
    { month: 1, day: 31, text: '法定調書合計表・給与支払報告書（市区町村）を提出' },
    { month: 6, day: 10, text: '算定基礎届（7/1〜7/10）・労働保険の年度更新（6/1〜7/10）' },
    { month: 7, day: 10, text: '（納期の特例）1〜6月分の源泉所得税を納付' },
    { month: 12, day: 25, text: '年末調整（12月の給与で精算）' },
  ],
};
