// チャッピー先生：OpenAI Realtime API の呼び出し（サーバー専用）。
//
// 料金の支払者は生徒本人（または保護者）。ここで使うキーは、必ず呼び出し側から引数で受け取った
// 「本人のキー」だけ。環境変数のキー（採点用の ANTHROPIC_API_KEY・OPENAI_API_KEY など）は読まない。
// 失敗・再試行・要約・文字起こし・音声合成のどの経路でも、別のキーへ切り替えない。
//
// 公式の手順（2026-10 時点。実装時に再確認すること）
//   1. サーバーが本人のキーで POST /v1/realtime/client_secrets → 短期の資格情報（value）
//   2. ブラウザがその短期資格情報で、WebRTC の SDP を POST /v1/realtime/calls へ送る
// モデル名は固定しない。本人のキーで GET /v1/models を呼び、名前に realtime を含むものから本人が選ぶ。
import "server-only";

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
  | "invalid_key" | "no_quota" | "rate_limited" | "forbidden" | "model_unavailable" | "provider_down" | "network";

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

/** 本人のキーで使える Realtime のモデルと、文字起こしのモデル（字幕用）。キーの確認も兼ねる */
export async function listModels(apiKey: string): Promise<{ realtime: string[]; transcribe: string[] }> {
  const res = await call(apiKey, "/models");
  if (!res.ok) throw await toError(res);
  const ids: string[] = ((await res.json())?.data ?? []).map((m: { id?: unknown }) => String(m?.id ?? "")).filter(Boolean);
  return {
    realtime: ids.filter((id) => /realtime/i.test(id) && !/transcri|translat/i.test(id)).sort(),
    transcribe: ids.filter((id) => /transcribe|^whisper/i.test(id)).sort(),
  };
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

/** 短期の資格情報を発行する（有効期限 60 秒。会話の開始にだけ使える） */
export async function mintClientSecret(apiKey: string, o: SessionOptions) {
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
  const res = await call(apiKey, "/realtime/client_secrets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expires_after: { anchor: "created_at", seconds: 60 }, session }),
  });
  if (!res.ok) throw await toError(res);
  const j = await res.json();
  const value = String(j?.value ?? j?.client_secret?.value ?? "");
  if (!value) throw new TutorError("provider_down", "OpenAI から会話用の資格情報を受け取れませんでした。時間をおいてお試しください。", 502);
  return { value, expiresAt: Number(j?.expires_at ?? j?.client_secret?.expires_at ?? 0) || null };
}

/** ブラウザが SDP を送る先（短期資格情報で使う） */
export const callsUrl = () => apiBase() + "/realtime/calls";
