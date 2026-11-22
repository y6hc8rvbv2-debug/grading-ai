// AI 呼び出しの窓口（Claude API）。Node.js ランタイムで動かし、生成中の文章を少しずつ画面へ流す。
// 鍵（ANTHROPIC_API_KEY）はサーバーの環境変数にだけ置き、画面側には渡さない。
import Anthropic from '@anthropic-ai/sdk';
import { buildRequest } from './_prompts.js';
import { hasStore, claimUser, takeQuota, refundQuota, HttpError, corsHeaders } from './_store.js';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const MAX_BODY = 3_800_000; // Vercel の受信上限（約4MB）より少し小さく

// 同じ接続元からの連続利用を軽く抑える（サーバーが入れ替わると数え直しになる簡易的なもの）
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 2000) hits.clear();
  return list.length > 20;
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

async function handler(request) {
  const cors = corsHeaders(request.headers.get('origin'));
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const res = await respond(request);
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
}

async function respond(request) {
  if (request.method !== 'POST') return json(405, { error: 'POST のみ対応しています' });
  if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: 'AI_NOT_CONFIGURED' });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json(413, { error: '送信データが大きすぎます。画像の枚数を減らしてください。' });
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'リクエストの形式が正しくありません' });
  }

  const required = process.env.APP_ACCESS_CODE;
  if (required && body.accessCode !== required) return json(401, { error: 'ACCESS_CODE_REQUIRED' });

  const ip = (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  if (tooMany(ip)) return json(429, { error: '短時間に利用が集中しています。1分ほど待ってからお試しください。' });

  const req = buildRequest(body.task, body.payload);
  if (!req) return json(400, { error: '未対応のタスクです' });

  // 指導案の作成は、契約プランの月の上限をサーバー側で数える（共有データの置き場がある時）
  let charged = null;
  if (body.task === 'generatePlan' && hasStore) {
    try {
      const user = await claimUser(body.userId, body.deviceKey);
      await takeQuota(body.userId, user);
      charged = body.userId;
    } catch (err) {
      // 利用回数を確認できない時は作成を止める（制限を外して動かすことはしない）
      console.error('[ai] quota check failed:', err instanceof HttpError ? err.message : err?.name);
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      return json(503, { error: 'STORE_UNAVAILABLE' });
    }
  }

  const client = new Anthropic();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      controller.enqueue(encoder.encode(': start\n\n'));
      // 考え中で文字が出ない時間も接続が切れないよう、定期的に合図を送る
      const beat = setInterval(() => {
        try { controller.enqueue(encoder.encode(': keep-alive\n\n')); } catch { /* 既に終了 */ }
      }, 10_000);
      try {
        const messageStream = client.beta.messages.stream({
          model: MODEL,
          max_tokens: req.maxTokens,
          thinking: { type: 'adaptive' },
          output_config: { effort: req.effort },
          // 安全上の理由で応答が止まった場合に、API 側で別モデルへ自動で切り替える
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: req.system,
          messages: req.messages,
        });
        messageStream.on('text', (delta) => send({ t: delta }));
        const final = await messageStream.finalMessage();
        if (final.stop_reason === 'refusal') {
          if (charged) await refundQuota(charged).catch(() => {});
          send({ error: 'この内容にはAIが応答できませんでした。入力内容を見直してお試しください。' });
        } else send({ done: true, stop: final.stop_reason, model: final.model });
      } catch (err) {
        let message = 'AIの呼び出しに失敗しました。時間をおいてお試しください。';
        if (err instanceof Anthropic.AuthenticationError) message = 'APIキーが正しくありません。管理者が ANTHROPIC_API_KEY を確認してください。';
        else if (err instanceof Anthropic.RateLimitError) message = 'AIの利用上限に達しました。少し待ってからお試しください。';
        else if (err instanceof Anthropic.BadRequestError) message = 'AIに送った内容を処理できませんでした（画像の形式やサイズをご確認ください）。';
        else if (err instanceof Anthropic.APIConnectionError) message = 'AIサービスに接続できませんでした。';
        console.error('[ai] failed', body.task, err?.status, err?.name);
        if (charged) await refundQuota(charged).catch(() => {}); // 失敗した作成は数えない
        send({ error: message });
      } finally {
        clearInterval(beat);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' },
  });
}

export default { fetch: handler };
