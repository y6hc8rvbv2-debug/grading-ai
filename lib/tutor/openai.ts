// チャッピー先生：OpenAI Realtime API の呼び出し（サーバー専用）。
//
// 料金の支払者は生徒本人（または保護者）。ここで使うキーは、必ず呼び出し側から引数で受け取った
// 「本人のキー」だけ。環境変数のキー（採点用の ANTHROPIC_API_KEY・OPENAI_API_KEY など）は読まない。
// 失敗・再試行・要約・文字起こし・音声合成のどの経路でも、別のキーへ切り替えない。
//
// 接続の方式（公式の API 仕様・公式 SDK 7.27.0 で確認）
//   1. ブラウザが WebRTC の SDP（offer）を作り、このアプリのサーバーへ送る
//   2. サーバーが本人のキーで POST /v1/realtime/calls（multipart：sdp と session）→ SDP（answer）と
//      Location ヘッダーの通話ID を受け取る。ブラウザには SDP だけを返す（キーも短期の資格情報も渡さない）
//   3. 上限時間・同意の撤回・機能の停止・キーの削除・終了のときは、サーバーが本人のキーで
//      POST /v1/realtime/calls/{call_id}/hangup を呼んで通話を切る
// （短期の資格情報 client_secrets は使わない：資格情報の期限は「会話を始められる期限」で、始めた会話は期限後も続き、
//   期限内なら同じ資格情報で別の会話も始められるため、会話の時間制限にはならない）
import "server-only";
import { pickTranscribeModel, pickVoiceModels } from "@/lib/tutor/models";

const OFFICIAL = "https://api.openai.com/v1";

/** 接続先。テスト用の代役サーバーは、このマシンの中（localhost）を指すときだけ使える */
export function apiBase(): string {
  const o = process.env.TUTOR_OPENAI_BASE_URL ?? "";
  if (!o) return OFFICIAL;
  try {
    const u = new URL(o);
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return o.replace(/\/$/, "");
  } catch { /* 下で公式へ */ }
  return OFFICIAL;
}

export type TutorErrorCode =
  | "invalid_key" | "no_quota" | "rate_limited" | "forbidden" | "model_unavailable" | "provider_down" | "network" | "bad_sdp";

export class TutorError extends Error {
  constructor(public code: TutorErrorCode, message: string, public status = 400) { super(message); }
}

const KEY_RE = /^sk-[A-Za-z0-9_\-]{20,200}$/;
/** キーの形だけを確かめる（中身は OpenAI に問い合わせて確かめる） */
export const looksLikeKey = (k: unknown): k is string => typeof k === "string" && KEY_RE.test(k.trim());

/** OpenAI の応答を、本人向けの直し方つきの日本語にする（キーの値は含めない） */
async function toError(res: Response): Promise<TutorError> {
  let code = "";
  try { code = String((await res.json())?.error?.code ?? ""); } catch { /* 本文なし */ }
  if (res.status === 401) return new TutorError("invalid_key", "API キーが無効です。OpenAI の管理画面でキーを確かめ、正しいキーを登録し直してください。", 400);
  if (res.status === 429 && /quota|billing/i.test(code)) return new TutorError("no_quota", "OpenAI の残高・利用上限に達しています。本人（または保護者）の OpenAI の請求設定を確かめてください。", 402);
  if (res.status === 429) return new TutorError("rate_limited", "OpenAI が混み合っているか、利用の上限に達しました。少し待ってからもう一度お試しください。", 429);
  if (res.status === 403) return new TutorError("forbidden", "このキーでは音声の会話（Realtime）を使えません。キーの権限やプロジェクトの設定を確かめてください。", 403);
  if (res.status === 404) return new TutorError("model_unavailable", "選んだモデルをこのキーでは使えません。モデルを選び直してください。", 400);
  if (res.status === 400) return new TutorError("bad_sdp", "音声の接続の準備に失敗しました。ページを開き直してもう一度お試しください。", 400);
  return new TutorError("provider_down", `OpenAI でエラーが起きました（HTTP ${res.status}）。時間をおいてお試しください。`, 502);
}

async function call(apiKey: string, path: string, init: RequestInit = {}): Promise<Response> {
  if (!looksLikeKey(apiKey)) throw new TutorError("invalid_key", "API キーの形が正しくありません（sk- で始まるキーを貼り付けてください）。");
  try {
    return await fetch(apiBase() + path, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${apiKey.trim()}` },
      cache: "no-store",
    });
  } catch {
    throw new TutorError("network", "OpenAI に接続できませんでした。通信状態を確かめてください。", 502);
  }
}

/** 本人のキーで使える、音声の会話に対応したモデルと、字幕用の文字起こしのモデル。キーの確認も兼ねる（料金はかからない） */
export async function listModels(apiKey: string): Promise<{ voice: string[]; transcribe: string | null }> {
  const res = await call(apiKey, "/models");
  if (!res.ok) throw await toError(res);
  const ids: string[] = ((await res.json())?.data ?? []).map((m: { id?: unknown }) => String(m?.id ?? "")).filter(Boolean);
  return { voice: pickVoiceModels(ids), transcribe: pickTranscribeModel(ids) };
}

export type SessionOptions = {
  model: string;
  instructions: string;
  mode: "voice" | "text";
  /** ゆっくり話す */
  slow: boolean;
  /** 生徒の発話の字幕に使う文字起こしのモデル（無ければ字幕なし） */
  transcribeModel?: string | null;
};

/** 会話の設定（公式の RealtimeSessionCreateRequest） */
export function sessionConfig(o: SessionOptions) {
  const session: Record<string, unknown> = {
    type: "realtime",
    model: o.model,
    instructions: o.instructions,
    output_modalities: o.mode === "voice" ? ["audio"] : ["text"],
  };
  if (o.mode === "voice") {
    session.audio = {
      input: {
        turn_detection: { type: "server_vad" },
        ...(o.transcribeModel ? { transcription: { model: o.transcribeModel, language: "ja" } } : {}),
      },
      output: { voice: "marin", speed: o.slow ? 0.85 : 1.0 },
    };
  }
  return session;
}

/** 通話を作る：ブラウザの SDP（offer）を本人のキーで送り、SDP（answer）と通話ID を受け取る */
export async function createCall(apiKey: string, sdp: string, o: SessionOptions): Promise<{ answer: string; callId: string | null }> {
  if (!/^v=0\r?\n/.test(sdp) || sdp.length > 20000) throw new TutorError("bad_sdp", "音声の接続の準備に失敗しました。ページを開き直してもう一度お試しください。");
  // 公式の例（curl -F "sdp=<offer.sdp;type=application/sdp" -F 'session={…};type=application/json'）と同じ形の multipart
  const boundary = `----tutor${crypto.randomUUID().replace(/-/g, "")}`;
  const body = [
    `--${boundary}`, 'Content-Disposition: form-data; name="sdp"', "Content-Type: application/sdp", "", sdp,
    `--${boundary}`, 'Content-Disposition: form-data; name="session"', "Content-Type: application/json", "", JSON.stringify(sessionConfig(o)),
    `--${boundary}--`, "",
  ].join("\r\n");
  const res = await call(apiKey, "/realtime/calls", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}`, accept: "application/sdp" },
    body,
  });
  if (!res.ok) throw await toError(res);
  const location = res.headers.get("location") ?? "";
  const callId = location.split("/").filter(Boolean).pop() ?? "";
  return { answer: await res.text(), callId: /^[A-Za-z0-9_-]{1,100}$/.test(callId) ? callId : null };
}

/** 通話を切る（本人のキーで）。切れなかったときは false（呼び出し側は会話の記録を終えて、画面でも接続を閉じる） */
export async function hangupCall(apiKey: string, callId: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(callId)) return false;
  try {
    const res = await call(apiKey, `/realtime/calls/${callId}/hangup`, { method: "POST" });
    return res.ok || res.status === 404;   // 404：すでに終わっている
  } catch {
    return false;
  }
}
