// ミライ予想：問題データ
// ルール：答え合わせは「公開データ」で全自動。自動で判定できない問題は出さない。
//   wx  … Open-Meteo（無料の気象データ）
//   fx  … 欧州中央銀行の基準レート（Frankfurter 経由・無料）

// 判定に使う都市（緯度・経度）と、平年の最高気温のめやす（1〜12月）
window.CITIES = {
  tokyo:   { name: '東京',  lat: 35.6895, lon: 139.6917, avgMax: [10, 11, 14, 19, 23, 26, 30, 31, 27, 22, 17, 12] },
  osaka:   { name: '大阪',  lat: 34.6937, lon: 135.5023, avgMax: [9, 10, 14, 20, 25, 28, 32, 33, 29, 23, 17, 12] },
  sapporo: { name: '札幌',  lat: 43.0618, lon: 141.3545, avgMax: [-1, 0, 4, 11, 17, 21, 25, 26, 22, 16, 8, 2] },
  fukuoka: { name: '福岡',  lat: 33.5902, lon: 130.4017, avgMax: [10, 12, 15, 20, 24, 27, 31, 32, 28, 23, 18, 13] },
  naha:    { name: '那覇',  lat: 26.2124, lon: 127.6809, avgMax: [20, 20, 22, 24, 27, 30, 32, 32, 31, 28, 25, 22] },
};

// 年末スペシャル（すべて公開データで自動判定できる問題）
// judge の書き方：
//   { src:'wx', city, date, metric:'tmax', op:'>=' または '<', value }  … 最高気温
//   { src:'wx', city, date, metric:'rain' }       … 雨（1mm以上）が降ったら「はい」
//   { src:'wx', city, date, metric:'snow' }       … 雪（降雪量0.1cm以上）が降ったら「はい」
//   { src:'wx', city, date, metric:'sunrise' }    … 朝6〜7時の雲の量が50%未満なら「はい」
//   { src:'wxcount', city, from, to, metric:'rain', value } … 雨の日が value 日以上なら「はい」
//   { src:'fx', date, vs:'prev' }                 … 前の営業日より円高なら「はい」
//   { src:'fx', date, vs:'date', base }           … base の日より円安なら「はい」
window.SPECIAL_QUESTIONS = [
  {
    id: 'sp-dec-rain',
    cat: '天気', icon: '☔',
    text: '12月の東京で、雨（1mm以上）が降る日は5日以上ある？',
    deadline: '2026-11-30T23:59:00+09:00',
    judge: { src: 'wxcount', city: 'tokyo', from: '2026-12-01', to: '2026-12-31', metric: 'rain', value: 5 },
    ai: { pick: 'no', conf: 1, reason: '12月の東京で雨が降るのは、ふつう4〜5日ほど。ぎりぎり「いいえ」と見ています。' },
  },
  {
    id: 'sp-yen-yearend',
    cat: '為替', icon: '💴',
    text: '12月30日の1ドルの値段は、12月1日より「円安」（数字が大きい）になっている？',
    deadline: '2026-11-30T23:59:00+09:00',
    judge: { src: 'fx', date: '2026-12-30', vs: 'date', base: '2026-12-01' },
    ai: { pick: 'yes', conf: 1, reason: '1か月の為替の動きは読みにくいですが、少しだけ「円安」寄りに予想します。' },
  },
  {
    id: 'sp-xmas-rain',
    cat: '天気', icon: '🎄',
    text: 'クリスマス（12月25日）、東京で雨（1mm以上）が降る？',
    deadline: '2026-12-24T23:59:00+09:00',
    judge: { src: 'wx', city: 'tokyo', date: '2026-12-25', metric: 'rain' },
    ai: { pick: 'no', conf: 2, reason: '冬の東京は乾燥していて晴れの日が多いので、「いいえ」に自信あり。' },
  },
  {
    id: 'sp-sapporo-mafuyubi',
    cat: '天気', icon: '❄️',
    text: '大晦日（12月31日）の札幌は「真冬日」（最高気温が0℃未満）になる？',
    deadline: '2026-12-30T23:59:00+09:00',
    judge: { src: 'wx', city: 'sapporo', date: '2026-12-31', metric: 'tmax', op: '<', value: 0 },
    ai: { pick: 'yes', conf: 1, reason: '年末の札幌の最高気温は平年で0℃前後。少し寒い方に予想します。' },
  },
  {
    id: 'sp-hatsuhinode',
    cat: 'お正月', icon: '🌅',
    text: '元日の朝（6〜7時）、東京の空の雲は半分より少ない？（初日の出が見えそう）',
    deadline: '2026-12-31T23:59:00+09:00',
    judge: { src: 'wx', city: 'tokyo', date: '2027-01-01', metric: 'sunrise' },
    ai: { pick: 'yes', conf: 2, reason: '元日の東京は晴れることが多いので、初日の出は見えると予想します。' },
  },
  {
    id: 'sp-naha-20',
    cat: 'お正月', icon: '🌺',
    text: '元日の那覇の最高気温は、20℃以上になる？',
    deadline: '2026-12-31T23:59:00+09:00',
    judge: { src: 'wx', city: 'naha', date: '2027-01-01', metric: 'tmax', op: '>=', value: 20 },
    ai: { pick: 'yes', conf: 1, reason: '那覇の1月の最高気温は平年で20℃前後。暖かい方に予想します。' },
  },
  {
    id: 'sp-snow-tokyo',
    cat: 'お正月', icon: '⛄',
    text: '元日、東京都心で雪が降る？（降雪量0.1cm以上）',
    deadline: '2026-12-31T23:59:00+09:00',
    judge: { src: 'wx', city: 'tokyo', date: '2027-01-01', metric: 'snow' },
    ai: { pick: 'no', conf: 3, reason: '東京都心で元日に雪が降るのはとても珍しいです。「いいえ」に強い自信あり。' },
  },
];
