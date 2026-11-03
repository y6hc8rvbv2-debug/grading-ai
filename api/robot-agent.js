// ロボマルシェ AIコンシェルジュ API（Claude に接続）
// ・ANTHROPIC_API_KEY が未設定なら 503 を返し、画面側は内蔵の簡易コンシェルジュに切り替える
// ・個人情報（メール・電話・郵便番号など）は Claude に送る前にサーバーでも伏せ字にする
// ・会話内容は保存しない／ログに出さない
import Anthropic from '@anthropic-ai/sdk';
import { CATEGORIES, PRODUCTS, findProduct } from '../robot-shop/data.js';

// 費用を抑えるため、最も安い現行モデル（Claude Haiku 5.5）を使う
const MODEL = 'claude-haiku-5-5';

// ── 製品カタログを Claude に渡す形（毎回同じ文字列になるので、プロンプトキャッシュが効く）──
const CATALOG = PRODUCTS.map((p) => {
  const cat = CATEGORIES.find((c) => c.id === p.category).name;
  const price = p.price ? `${p.price}円〜(目安)` : p.monthly ? `月額${p.monthly}円〜` : '要見積';
  const specs = Object.entries(p.specs).map(([k, v]) => `${k}:${v}`).join(' / ');
  return `- id=${p.id} | ${p.name} | ${p.maker} | 分類:${cat} | 価格:${price}（${p.priceHint}） | 販売:${p.availability} | 納期:約${p.leadWeeks}週 | ${p.summary} | 仕様:${specs} | AI:${p.ai.join('、')} | タグ:${p.tags.join(',')}`;
}).join('\n');

const SYSTEM = `あなたは「ロボマルシェ」のAIコンシェルジュです。ロボマルシェは日本製フィジカルAIロボットを選んで注文・購入できる通販サイトです。
お客様（工場・物流・飲食・介護・農業などの事業者や、家庭の個人）の用途・場所・予算・困りごとを聞き取り、下のカタログから最適な製品を提案します。

## 回答のルール
- 日本語で、やさしく簡潔に答える。ロボットに詳しくない人にも分かる言葉を使い、専門用語には短い説明を添える。reply は300字以内を目安にする。
- 提案する製品は、必ず下のカタログにある id だけを product_ids に入れる（最大4件、おすすめ順）。カタログにない製品や仕様をでっち上げない。
- 価格はすべて「目安」。「要見積」の製品は正式見積で価格が決まることを伝える。値引きや在庫・納期を約束しない。
- 情報が足りないときは、用途・設置場所・予算のうち足りないものを1つか2つだけ質問する。
- 補助金（中小企業省力化投資補助金、ものづくり補助金など）の話題では、要件や公募時期は変わること、採択は保証できないこと、注文フォームの「補助金の相談を希望」で担当者が案内することを伝える。
- 医療機器（手術支援・リハビリ）は医療機関向けであることを伝える。
- お客様の氏名・メール・電話・住所などの個人情報は聞かない。入力されても使わず、注文フォームで入力するよう案内する。
- ロボットやこのサイトと関係ない依頼には、丁寧にお断りしてロボット選びの話に戻す。

## 画面の操作（action）
お客様がはっきり望んだときだけ action を指定する。それ以外は "none"。
- add_to_cart: 製品をカートに入れる（action_product_id に id を入れる）
- compare: product_ids の製品（2〜3件）を比較表で表示する
- open_cart: カートを開く
- checkout: 注文手続き（カート確認→注文フォーム）へ進む
- open_orders: 注文履歴・配送状況を開く
- filter_category: 一覧をその分類で絞り込む（action_category に分類idを入れる）

分類id: ${CATEGORIES.map((c) => `${c.id}=${c.name}`).join(', ')}

## 製品カタログ（${PRODUCTS.length}製品）
${CATALOG}`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'お客様への返答（日本語）' },
    product_ids: { type: 'array', items: { type: 'string' }, description: 'おすすめ製品のid（最大4件・おすすめ順）。なければ空配列' },
    action: { type: 'string', enum: ['none', 'add_to_cart', 'compare', 'open_cart', 'checkout', 'open_orders', 'filter_category'] },
    action_product_id: { type: 'string', description: 'add_to_cart のときの製品id。それ以外は空文字' },
    action_category: { type: 'string', description: 'filter_category のときの分類id。それ以外は空文字' },
  },
  required: ['reply', 'product_ids', 'action', 'action_product_id', 'action_category'],
  additionalProperties: false,
};

// 個人情報らしき文字列を伏せ字にする（Claude に送る前の最後の防波堤）
function redact(text) {
  return text
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '［メール省略］')
    .replace(/(?:\+81[-\s]?|0)\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}/g, '［電話番号省略］')
    .replace(/〒?\s?\d{3}-\d{4}/g, '［郵便番号省略］')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '［番号省略］');
}

// 接続元ごとの簡易回数制限（1分に15回まで）
const recent = new Map();
function rateLimited(key) {
  const now = Date.now();
  const list = (recent.get(key) || []).filter((t) => now - t < 60_000);
  list.push(now);
  recent.set(key, list);
  return list.length > 15;
}

let client;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST で送信してください' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'AI（Claude）が未設定です', fallback: true });
  }
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0] || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: '少し時間をおいてからお試しください', fallback: true });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const history = Array.isArray(body?.messages) ? body.messages.slice(-12) : [];
  const messages = history
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
    .map((m) => ({ role: m.role, content: redact(m.text.slice(0, 800)) }));
  // 先頭は user、最後も user である必要がある
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length || messages.at(-1).role !== 'user') return res.status(400).json({ error: 'メッセージがありません' });

  // カートの中身（製品idと数量だけ。個人情報は含まない）を会話の最後に添える
  const cart = Array.isArray(body?.cart) ? body.cart.slice(0, 20).filter((i) => findProduct(String(i?.id))) : [];
  const cartNote = cart.length ? `\n\n（参考：現在のカート＝${cart.map((i) => `${findProduct(i.id).name}×${Number(i.qty) || 1}`).join('、')}）` : '';
  messages[messages.length - 1] = { role: 'user', content: messages.at(-1).content + cartNote };

  client ??= new Anthropic();
  try {
    // Haiku 5.5 にはサーバー側の自動切替（fallbacks）が無いため、断られた場合は下で丁寧な定型文を返す
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages,
    });

    if (response.stop_reason === 'refusal') {
      return res.status(200).json({ reply: '申し訳ありません、そのご質問にはお答えできません。ロボット選びのご相談ならお手伝いします。', product_ids: [], action: 'none', model: response.model });
    }
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let out;
    try { out = JSON.parse(text); } catch { out = null; }
    if (!out || typeof out.reply !== 'string') {
      return res.status(502).json({ error: 'AIの応答を読み取れませんでした', fallback: true });
    }
    const ids = (Array.isArray(out.product_ids) ? out.product_ids : []).filter((id) => findProduct(id)).slice(0, 4);
    const action = OUTPUT_SCHEMA.properties.action.enum.includes(out.action) ? out.action : 'none';
    return res.status(200).json({
      reply: out.reply.slice(0, 1500),
      product_ids: ids,
      action,
      action_product_id: findProduct(out.action_product_id) ? out.action_product_id : '',
      action_category: CATEGORIES.some((c) => c.id === out.action_category) ? out.action_category : '',
      model: response.model,
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      console.error('[robot-agent] APIキーが無効です');
      return res.status(503).json({ error: 'AI（Claude）のAPIキーが無効です', fallback: true });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'AIが混み合っています', fallback: true });
    }
    if (error instanceof Anthropic.APIError) {
      console.error('[robot-agent] API error', error.status);
      return res.status(502).json({ error: 'AIとの通信でエラーが発生しました', fallback: true });
    }
    console.error('[robot-agent] unexpected', error?.name);
    return res.status(500).json({ error: 'AIとの通信でエラーが発生しました', fallback: true });
  }
}
