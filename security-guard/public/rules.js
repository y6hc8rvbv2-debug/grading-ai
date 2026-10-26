// 守りダッシュボードの危険判定ルール。画面（index.html）とサーバー（/api/check）の両方で使う。
// 個人情報は保存も送信もしない（渡された文章をその場で調べるだけ）。
(function (root) {
'use strict';
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
const SUSP_TLD=/\.(zip|mov|top|xyz|gq|cf|ml|tk|work|click|link|loan|country|kim|science|review)(\b|\/|$)/i;
const BRANDS=['amazon','apple','paypal','google','microsoft','rakuten','mufg','smbc','mizuho','jcb','visa','mastercard','netflix','line','docomo','au','softbank','yamato','sagawa','jppost','etc','amex','facebook','instagram','metamask','coinbase','binance'];
const URGENT=[/至急|今すぐ|緊急|ただちに|直ちに/,/24時間以内|期限|本日中|まもなく|停止され|ロックされ|制限され/,/urgent|immediately|suspend|locked|verify now|within 24/i];
const ASK=[/パスワード|暗証番号|カード番号|セキュリティコード|ワンタイム|認証コード|口座番号|個人情報|本人確認/,/password|credit card|ssn|one-?time|verify your account|confirm your identity/i];
const LURE=[/当選|高額|副業|必ず儲か|無料プレゼント|現金|給付金|還付金|未納|滞納|裁判/,/you(?:'ve| have) won|prize|refund|lottery|bitcoin|investment/i];
function analyzeUrl(url){
  const out=[]; let score=0; let host='';
  try{
    const u=new URL(url.trim());
    host=u.hostname;
    const parts=host.split('.');
    const tld=parts.slice(-2).join('.');
    if(/^\d{1,3}(\.\d{1,3}){3}$/.test(host)){ score+=35; out.push(['high','🔢',`URLのドメインが<b>IPアドレス直打ち</b>（${esc(host)}）。正規サービスではまず使いません。`]); }
    if(url.includes('@')){ score+=30; out.push(['high','🎭',`URLに <b>@</b> が含まれます。@より前は飾りで、実際は <code>${esc(host)}</code> に飛びます。`]); }
    if(host.includes('xn--')){ score+=30; out.push(['high','🅰️',`国際化ドメイン（<b>xn--</b>）。正規そっくりの偽文字が使われている可能性があります。`]); }
    if(SUSP_TLD.test(host)){ score+=25; out.push(['high','🚩',`あやしい種類のドメイン末尾（例：.top/.zip/.xyz など）です。`]); }
    if(parts.length>=5){ score+=15; out.push(['mid','🧩',`サブドメインが非常に多い（${esc(host)}）。本物のブランド名を前方に置いた偽装の手口によくあります。`]); }
    // ブランド名がドメイン本体ではなくサブドメイン/パスにある
    // co.jp などの2段の末尾は3つ分を「本当のドメイン」とみなす
    const regDomain=parts.slice(/^(co|ne|or|go|ac|ad|ed|gr|lg|com|net|org|gov|edu)\.[a-z]{2}$/i.test(parts.slice(-2).join('.'))?-3:-2).join('.').toLowerCase();
    const labels=host.toLowerCase().split(/[.\-]/);
    BRANDS.forEach(b=>{
      // au・line などの短い名前は単語として一致したときだけ数える（auction などの誤判定を防ぐ）
      const hit = b.length<=4 ? labels.includes(b) : (host.toLowerCase().includes(b)||url.toLowerCase().includes(b));
      if(hit && !regDomain.split('.')[0].includes(b)){
        score+=30; out.push(['high','🏷️',`「<b>${b}</b>」の名前が出てきますが、本当のドメインは <code>${esc(regDomain)}</code> です。<b>なりすまし</b>の疑いが濃厚。`]);
      }
    });
    if(/-/.test(parts[parts.length-2]||'') && BRANDS.some(b=>host.toLowerCase().includes(b))){ score+=10; out.push(['mid','➖',`ブランド名＋ハイフンのドメインは偽装に多い形です。`]); }
    if(u.protocol!=='https:'){ score+=10; out.push(['mid','🔓',`暗号化されていない通信（http）です。`]); }
  }catch(e){
    if(url.trim()){ score+=10; out.push(['mid','❓','URLとして正しく読み取れませんでした。手入力・短縮URLの可能性があります。']); }
  }
  // 短縮URL
  if(/(bit\.ly|tinyurl|t\.co|is\.gd|goo\.gl|ow\.ly|cutt\.ly|rb\.gy)/i.test(url)){ score+=15; out.push(['mid','🔗','短縮URLです。本当の飛び先が隠されています。展開してから確認を。']); }
  return {score,findings:out,host};
}
function analyzeText(text){
  const out=[]; let score=0;
  if(URGENT.some(re=>re.test(text))){ score+=20; out.push(['high','⏰','「至急・24時間以内・停止されました」などの<b>あおり文句</b>。あわてさせて判断を奪う典型手口。']); }
  if(ASK.some(re=>re.test(text))){ score+=30; out.push(['high','🔑','<b>パスワード・カード番号・認証コードなどの入力</b>を求めています。正規はメール/SMSから直接要求しません。']); }
  if(LURE.some(re=>re.test(text))){ score+=20; out.push(['mid','🎁','「当選・還付金・未納・副業」などの<b>うま過ぎる/不安をあおる</b>話題。']); }
  if(/(http|www\.|\.com|\.jp|リンク|下記|こちら)/i.test(text) && /(確認|手続|ログイン|更新|再登録)/.test(text)){ score+=10; out.push(['mid','👉','リンクを踏ませてログイン/手続きさせようとしています。']); }
  if(/(お客様各位|ユーザー様|会員様)/.test(text) && !/様\s*$/.test(text)){ out.push(['low','🙇','宛名があなたの名前でなく「お客様」など一般的。ばらまき型の可能性。']); score+=5; }
  return {score,findings:out};
}
const KIND_LABEL={call:'この電話',mail:'このメール',sms:'このSMS',sns:'このSNSメッセージ',url:'このURL'};
const KIND_NAME={call:'電話',mail:'メール',sms:'SMS',sns:'SNSメッセージ',url:'URL'};
// 電話・SMSで多い「お金を払わせる・カードを渡させる」系の言葉
const MONEY_SCAM=[/ATM|キャッシュカード|暗証番号|口座(が|を)?凍結/,/警察|検察|金融庁|裁判所|逮捕|捜査/,/電子マネー|ギフトカード|プリペイドカード|コンビニで(購入|支払)/,/会社のお金|示談金|(息子|孫|オレ|俺).{0,6}(だけど|です)/];
// 折り返すと高額になりやすい国・地域の国番号（ワン切り詐欺で多い）
const HIGH_RISK_CC=['675','676','677','678','679','681','682','685','686','688','690','691','692','881','882','883','252','236','239','247','246','222','223'];
const FREEMAIL=/(^|\.)(gmail\.com|yahoo\.co\.jp|ymail\.ne\.jp|outlook\.(com|jp)|hotmail\.(com|co\.jp)|icloud\.com|me\.com|aol\.com|163\.com|qq\.com|mail\.ru)$/i;
// [名前, 本文に出てくる言葉, 公式ドメインに含まれる文字]
const BRAND_MAP=[
  ['Amazon',/amazon|アマゾン/i,/amazon\./],['楽天',/rakuten|楽天/i,/rakuten\./],['Apple',/\bapple\b|アップル|icloud/i,/apple\.com|icloud\.com/],
  ['PayPay',/paypay/i,/paypay/],['三井住友',/smbc|三井住友/i,/smbc|vpass/],['三菱UFJ',/mufg|三菱ＵＦＪ|三菱UFJ/i,/mufg/],['みずほ',/mizuho|みずほ/i,/mizuho/],
  ['ゆうちょ銀行',/ゆうちょ|jp-bank/i,/jp-bank|japanpost/],['日本郵便',/日本郵便|郵便局|japan ?post/i,/japanpost/],
  ['ヤマト運輸',/ヤマト運輸|クロネコ|kuroneko/i,/kuronekoyamato|yamato/],['佐川急便',/佐川|sagawa/i,/sagawa/],
  ['NTTドコモ',/docomo|ドコモ/i,/docomo/],['au',/\bKDDI\b|auからの|au ID/i,/au\.com|kddi/],['ソフトバンク',/softbank|ソフトバンク/i,/softbank/],
  ['国税庁',/国税庁|税務署/,/nta\.go\.jp/],['メルカリ',/mercari|メルカリ/i,/mercari/],['ETC',/ETC利用|ETCサービス/,/etc-meisai|go-etc|nexco/],
  ['Netflix',/netflix|ネットフリックス/i,/netflix\./],['PayPal',/paypal/i,/paypal\./],['Microsoft',/microsoft|マイクロソフト/i,/microsoft|outlook\.com|live\.com/],
];

function toHalf(s){ return String(s).replace(/[０-９Ａ-Ｚａ-ｚ＋－（）：＠．]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/[ー―‐−]/g,'-'); }
function detectKind(text){
  const t=toHalf(text).trim();
  if(/^(着信|電話)?[:\s]*(非通知|通知不可能?|公衆電話)\s*$/.test(t)) return 'call';
  const digits=t.replace(/\D/g,'');
  if(/^[\d+\-()\s]+$/.test(t) && digits.length>=3 && digits.length<=15) return 'call';
  if(/^(from|to|subject|差出人|送信者|宛先|件名)\s*:/im.test(t) || /[\w.+-]+@[\w-]+\.[\w.-]+/.test(t)) return 'mail';
  if(/^\S+$/.test(t) && /^(https?:\/\/|www\.)/i.test(t)) return 'url';
  if(/instagram|facebook|messenger|twitter|tiktok|discord|インスタ|フォロー|友だち追加|ストーリー/i.test(t) || /\bLINE\b|\bDM\b/.test(t)) return 'sns';
  return 'sms';
}
function extractUrls(text){
  return [...new Set((text.match(/\bhttps?:\/\/[^\s<>"'（）「」、。]+|\bwww\.[^\s<>"'（）「」、。]+/gi)||[]).map(u=>/^www\./i.test(u)?'https://'+u:u))].slice(0,5);
}
function extractPhones(text){
  return [...new Set((toHalf(text).match(/\+?\d[\d\-\s()]{7,17}\d/g)||[]).filter(n=>{ const d=n.replace(/\D/g,''); return d.length>=10&&d.length<=15; }))].slice(0,3);
}
function analyzePhone(raw){
  const out=[]; let score=0;
  const s=toHalf(raw).trim();
  if(/非通知|通知不可|公衆電話|unknown|private|anonymous/i.test(s)){
    score+=30; out.push(['mid','🙈','<b>非通知・番号不明</b>の着信です。詐欺や迷惑電話によく使われます。大事な用件なら相手は番号を出してかけ直してきます。']);
    return {score,findings:out};
  }
  let d=s.replace(/[^\d+]/g,'');
  if(d.startsWith('+81')) d='0'+d.slice(3);
  else if(d.startsWith('00')) d='+'+d.slice(2);
  if(d.startsWith('+')){
    score+=45; out.push(['high','🌐',`<b>海外からの電話</b>（国番号 ${esc(d.slice(0,4))}…）です。身に覚えがなければ出ない・折り返さないで。国際詐欺電話や、ワン切りで折り返させる手口の典型です。`]);
    if(HIGH_RISK_CC.some(c=>d.slice(1).startsWith(c))){ score+=25; out.push(['high','💸','<b>折り返すと高額な通話料</b>を請求されやすい国・地域の番号です。']); }
    return {score,findings:out};
  }
  if(/^1\d{2}$/.test(d)){ out.push(['ok','🚓','緊急・公共サービスの短い番号です。']); return {score,findings:out}; }
  if(/^0990/.test(d)){ score+=40; out.push(['high','💴','<b>0990（有料情報サービス）</b>の番号です。折り返すと高い料金がかかります。']); }
  else if(/^0570/.test(d)){ score+=15; out.push(['mid','📟','<b>0570（ナビダイヤル）</b>は通話料が高めです。折り返す前に公式サイトの番号か確認を。']); }
  else if(/^050/.test(d)){ score+=20; out.push(['mid','☎️','<b>050（IP電話）</b>は誰でも簡単に取れる番号で、詐欺や架空請求によく使われます。']); }
  else if(/^(0120|0800)/.test(d)){ score+=5; out.push(['low','🆓','フリーダイヤルです。企業の窓口のほか、営業・勧誘電話のこともあります。']); }
  else if(/^0[789]0/.test(d)){ out.push(['low','📱','携帯電話の番号です。知らない番号なら、出る前に番号をネット検索するのも手です。']); }
  if(/^0/.test(d) && (d.length<10||d.length>11)){ score+=20; out.push(['mid','🔢','日本の電話番号としては<b>桁数がおかしい</b>です。偽装された番号の可能性があります。']); }
  if(!/^[0+]/.test(d)){ score+=10; out.push(['mid','❓','電話番号として正しく読み取れませんでした。']); }
  return {score,findings:out};
}
function analyzeSender(text){
  const out=[]; let score=0;
  const t=toHalf(text);
  const m=t.match(/(?:from|差出人|送信者)\s*:[^\n]*?([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/i)||t.match(/([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/);
  if(!m) return {score,findings:out,domain:''};
  const domain=m[1].split('@')[1].toLowerCase();
  if(SUSP_TLD.test(domain)){ score+=25; out.push(['high','🚩',`差出人のドメイン <code class="ip">${esc(domain)}</code> は、詐欺によく使われる種類の末尾です。`]); }
  const claimed=BRAND_MAP.filter(([,word,dom])=>word.test(t) && !dom.test(domain)).map(([name])=>name);
  if(claimed.length && FREEMAIL.test(domain)){ score+=35; out.push(['high','🎭',`「<b>${esc(claimed[0])}</b>」を名乗っているのに、差出人は<b>フリーメール</b>（${esc(domain)}）です。企業がフリーメールで連絡することはまずありません。`]); }
  else if(claimed.length){ score+=30; out.push(['high','🏷️',`「<b>${esc(claimed[0])}</b>」を名乗っていますが、差出人のドメイン <code class="ip">${esc(domain)}</code> は公式のものではありません。<b>なりすまし</b>の疑いが濃厚です。`]); }
  return {score,findings:out,domain};
}
function analyzeIncoming(raw, kindHint){
  const text=raw.trim();
  const kind=(kindHint&&kindHint!=='auto')?kindHint:detectKind(text);
  let score=0; const findings=[]; const hosts=[];
  const add=(r,prefix)=>{ score+=r.score; r.findings.forEach(f=>findings.push(prefix?[f[0],f[1],prefix+f[2]]:f)); };
  if(kind==='call'){
    const nums=extractPhones(text);
    add(analyzePhone(nums[0]||text));
    const memo=text.replace(/\+?\d[\d\-\s()（）]{2,}\d/g,'');
    if(memo.replace(/\s/g,'').length>3) add(analyzeText(memo));
  }else{
    // 本文中のURLは自動で取り出して、一番危険なものを採点
    const urls=kind==='url'?[text]:extractUrls(text);
    const ur=urls.map(u=>analyzeUrl(u)).sort((a,b)=>b.score-a.score);
    ur.forEach(r=>{ if(r.host) hosts.push(r.host); });
    if(ur[0]) add(ur[0], urls.length>1?'本文中のURL：':'');
    if(kind!=='url'){
      add(analyzeText(text));
      if(kind==='mail') add(analyzeSender(text));
      const pr=extractPhones(text).map(n=>analyzePhone(n)).sort((a,b)=>b.score-a.score)[0];
      if(pr && pr.score>0){ pr.score=Math.round(pr.score*0.6); add(pr,'本文中の電話番号：'); }
    }
  }
  if(MONEY_SCAM.some(re=>re.test(text))){ score+=35; findings.push(['high','💳','<b>ATM・キャッシュカード・電子マネー・警察</b>などの話が出ています。お金やカードを求める電話・メッセージは詐欺を強く疑ってください。']); }
  score=Math.min(100,score);
  if(!findings.length) findings.push(['ok','✅','分かりやすい危険サインは見つかりませんでした。']);
  const ord={high:0,mid:1,low:2,ok:3};
  findings.sort((a,b)=>ord[a[0]]-ord[b[0]]);
  return {kind,score,findings,hosts:[...new Set(hosts)]};
}
function alertInfo(kind,score){
  const label=KIND_LABEL[kind];
  if(score>=55) return {cls:'danger',icon:'🚨',title:`${label}は危険です。`,
    msg: kind==='call'?'出ない・折り返さないでください。出てしまったら、お金やカードの話が出た時点ですぐに切りましょう。'
       : kind==='url'?'このURLは開かないでください。':'リンクを開かず、返信もしないでください。パスワードやカード番号は絶対に入力しないで。'};
  if(score>=30) return {cls:'warn',icon:'⚠️',title:`${label}はあやしいです。注意してください。`,
    msg: kind==='call'?'知らない番号ならすぐには出ず、用件は留守電で確認するのが安全です。':'リンクは開かず、公式アプリや公式サイトから自分で確認しましょう。'};
  return {cls:'ok',icon:'✅',title:`${label}に大きな危険サインは見つかりませんでした。`,msg:'ただし100%安全とは限りません。少しでも変だと感じたら、公式の窓口に確認を。'};
}
root.OmamoriRules={KIND_LABEL,KIND_NAME,detectKind,analyzeIncoming,alertInfo};
})(globalThis);
