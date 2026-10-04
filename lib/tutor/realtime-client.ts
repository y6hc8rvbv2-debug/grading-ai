// チャッピー先生：ブラウザと OpenAI Realtime を WebRTC でつなぐ（ブラウザ専用）。
//   - 使うのはサーバーが発行した短期の資格情報だけ（本人の長期キーはブラウザに置かない）
//   - 音声：マイクの音声を送り、AI の声を再生する。文字：マイクを使わず、データチャネルで文字を送る
//   - 終了・切断・画面を閉じる・バックグラウンドに回したときは、マイク・接続を必ず止める
// イベント名は 2026-10 時点の公式仕様（GA）と、以前の名前（beta）の両方を受け付ける。実機で要確認。

export type TutorState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "stopped" | "error";
export type Line = { who: "ai" | "me"; text: string; final: boolean };
export type Usage = { input_tokens: number; output_tokens: number; input_audio_tokens: number; output_audio_tokens: number };

export type StartOptions = { clientSecret: string; callsUrl: string; model: string; mode: "voice" | "text" };

export class RealtimeTutor {
  state: TutorState = "idle";
  lines: Line[] = [];
  usage: Usage = { input_tokens: 0, output_tokens: 0, input_audio_tokens: 0, output_audio_tokens: 0 };
  error = "";
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private mic: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  constructor(private onChange: () => void) {}

  private set(s: TutorState, err = "") {
    this.state = s;
    if (err) this.error = err;
    this.onChange();
  }

  /** 会話を始める。音声はマイクの許可を本人の操作の中で求める（呼び出し元はボタンの処理から呼ぶ） */
  async start(o: StartOptions, mic: MediaStream | null) {
    this.set("connecting");
    this.mic = mic;
    const pc = new RTCPeerConnection();
    this.pc = pc;
    pc.onconnectionstatechange = () => {
      if (["failed", "disconnected", "closed"].includes(pc.connectionState) && this.state !== "stopped") {
        this.stop();
        this.set("error", "接続が切れました。もう一度始めるか、文字で質問してください。");
      }
    };
    if (o.mode === "voice" && mic) {
      const a = document.createElement("audio");
      a.autoplay = true;
      this.audio = a;
      pc.ontrack = (e) => { a.srcObject = e.streams[0]; };
      mic.getTracks().forEach((t) => pc.addTrack(t, mic));
    } else {
      // 文字だけでも、接続には受信用の音声の枠が要る
      pc.addTransceiver("audio", { direction: "recvonly" });
    }
    const dc = pc.createDataChannel("oai-events");
    this.dc = dc;
    dc.onmessage = (e) => this.onEvent(e.data);
    dc.onopen = () => this.set(o.mode === "voice" ? "listening" : "idle");

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const res = await fetch(o.callsUrl, {
      method: "POST",
      body: offer.sdp,
      headers: { authorization: `Bearer ${o.clientSecret}`, "content-type": "application/sdp" },
    });
    if (!res.ok) {
      this.stop();
      throw new Error(`OpenAI に接続できませんでした（HTTP ${res.status}）。キーの残高・権限を確かめてください。`);
    }
    await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
  }

  private push(who: Line["who"], text: string, final: boolean) {
    const last = this.lines[this.lines.length - 1];
    if (last && last.who === who && !last.final) {
      last.text = final ? text || last.text : last.text + text;
      last.final = final;
    } else {
      this.lines.push({ who, text, final });
    }
  }

  private onEvent(raw: string) {
    let e: { type?: string; delta?: string; transcript?: string; text?: string; response?: { usage?: Record<string, unknown> }; error?: { message?: string } };
    try { e = JSON.parse(raw); } catch { return; }
    switch (e.type) {
      case "input_audio_buffer.speech_started": this.set("listening"); break;
      case "input_audio_buffer.speech_stopped":
      case "response.created": this.set("thinking"); break;
      case "output_audio_buffer.started":
      case "response.output_audio.delta":
      case "response.audio.delta": if (this.state !== "speaking") this.set("speaking"); break;
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta":
      case "response.output_text.delta":
      case "response.text.delta": this.push("ai", e.delta ?? "", false); this.onChange(); break;
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
      case "response.output_text.done":
      case "response.text.done": this.push("ai", e.transcript ?? e.text ?? "", true); this.onChange(); break;
      case "conversation.item.input_audio_transcription.completed": this.push("me", e.transcript ?? "", true); this.onChange(); break;
      case "output_audio_buffer.stopped": this.set("listening"); break;
      case "response.done": {
        const u = (e.response?.usage ?? {}) as Record<string, number | Record<string, number>>;
        const det = (k: string) => (u[k] && typeof u[k] === "object" ? (u[k] as Record<string, number>) : {});
        this.usage.input_tokens += Number(u.input_tokens) || 0;
        this.usage.output_tokens += Number(u.output_tokens) || 0;
        this.usage.input_audio_tokens += Number(det("input_token_details").audio_tokens) || 0;
        this.usage.output_audio_tokens += Number(det("output_token_details").audio_tokens) || 0;
        if (this.state === "thinking") this.set(this.mic ? "listening" : "idle");
        else this.onChange();
        break;
      }
      case "error": this.set("error", `チャッピー先生でエラーが起きました：${e.error?.message ?? "不明なエラー"}`); break;
    }
  }

  /** 文字で質問する・ヒントを頼むなど（データチャネルで送る） */
  send(text: string) {
    if (!this.dc || this.dc.readyState !== "open") return false;
    this.push("me", text, true);
    this.dc.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } }));
    this.dc.send(JSON.stringify({ type: "response.create" }));
    this.set("thinking");
    return true;
  }

  /** マイクを止める・再開する（会話は続く） */
  setMic(on: boolean) { this.mic?.getAudioTracks().forEach((t) => { t.enabled = on; }); this.onChange(); }
  get micOn() { return !!this.mic?.getAudioTracks().some((t) => t.enabled); }

  /** 会話を終える：マイク・音声・接続をすべて止める（何度呼んでもよい） */
  stop() {
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    try { this.dc?.close(); } catch { /* 閉じ済み */ }
    try { this.pc?.getSenders().forEach((s) => s.track?.stop()); this.pc?.close(); } catch { /* 閉じ済み */ }
    if (this.audio) { this.audio.srcObject = null; this.audio = null; }
    this.dc = null;
    this.pc = null;
    if (this.state !== "error") this.set("stopped");
  }

  transcript() {
    return this.lines.filter((l) => l.text).map((l) => `${l.who === "ai" ? "チャッピー先生" : "わたし"}：${l.text}`).join("\n");
  }
}

export const STATE_LABEL: Record<TutorState, string> = {
  idle: "待機中（文字で質問できます）",
  connecting: "接続中…",
  listening: "聞き取り中（話してください）",
  thinking: "考え中…",
  speaking: "発話中",
  stopped: "停止しました",
  error: "エラー",
};
