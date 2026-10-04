// チャッピー先生で選べるモデル（音声の会話に対応したもの）と、字幕用の文字起こしのモデル。
//
// 出典：OpenAI 公式 SDK `openai` 7.27.0（2026-10-01 公開）の型定義
//   - RealtimeSessionCreateRequest.model（Realtime の会話セッションに指定できるモデル）
//   - AudioTranscription.model（入力音声の文字起こしに指定できるモデル）
// 公式の API 仕様（github.com/openai/openai-openapi）でも同じ一覧であることを確かめた。
// 名前に realtime を含んでも、翻訳（translate）・文字起こし（whisper / transcribe）用のモデルは会話に使えないので入れない。
// 一覧に無い新しいモデルは、公式資料で会話に使えることを確かめてからここに足す（推測で足さない）。
export const VOICE_MODELS = [
  "gpt-realtime",
  "gpt-realtime-1.5",
  "gpt-realtime-2",
  "gpt-realtime-2.1",
  "gpt-realtime-2.1-mini",
  "gpt-realtime-2025-08-28",
  "gpt-realtime-mini",
  "gpt-realtime-mini-2025-10-06",
  "gpt-realtime-mini-2025-12-15",
  "gpt-4o-realtime-preview",
  "gpt-4o-realtime-preview-2024-10-01",
  "gpt-4o-realtime-preview-2024-12-17",
  "gpt-4o-realtime-preview-2025-06-03",
  "gpt-4o-mini-realtime-preview",
  "gpt-4o-mini-realtime-preview-2024-12-17",
  "gpt-audio-1.5",
  "gpt-audio-mini",
  "gpt-audio-mini-2025-10-06",
  "gpt-audio-mini-2025-12-15",
] as const;

/** 字幕（生徒の発話の文字起こし）に使うモデル。先にあるものを優先する（話者分離用の diarize は使わない） */
export const TRANSCRIBE_MODELS = [
  "gpt-4o-mini-transcribe",
  "gpt-4o-mini-transcribe-2025-12-15",
  "gpt-4o-transcribe",
  "gpt-transcribe",
  "gpt-realtime-whisper",
  "whisper-1",
] as const;

/** 本人のキーで使えるモデル（/v1/models の id）から、会話に使えるものだけを、一覧の順に返す */
export function pickVoiceModels(available: string[]) {
  const set = new Set(available);
  return VOICE_MODELS.filter((m) => set.has(m));
}
export function pickTranscribeModel(available: string[]) {
  const set = new Set(available);
  return TRANSCRIBE_MODELS.find((m) => set.has(m)) ?? null;
}
