// チャッピー先生：本人の OpenAI API キーで、本物の Realtime API に接続できるかを手元で確かめる（開発・導入担当者用）。
//
//   npm run tutor:live-check              … モデル一覧の確認（キーが有効か・音声会話に使えるモデル）
//   npm run tutor:live-check -- --paid    … 通話の確認（通話を1回作り、文字で1往復して、サーバー側から切る。課金される）
//
// 呼ぶ API（これ以外は呼ばない。tests/unit/tutor-live-check.test.ts で代役のサーバーに対して確かめている）
//   モデル一覧の確認：GET https://api.openai.com/v1/models の1回だけ
//     → モデルの一覧を返すだけで、生成（トークン）を伴わない。ただし「料金がかからない」ことは公式の料金表で
//       まだ確認できていない（開発環境から料金表のページを開けない）。そのため画面でも「無料」とは書かない
//   通話の確認（--paid）：上の GET /v1/models に加えて
//     POST /v1/realtime/calls（通話を作る。Realtime の利用として課金される）
//     データチャネルで conversation.item.create と response.create を1回ずつ（応答の生成。トークンとして課金される）
//     POST /v1/realtime/calls/{call_id}/hangup（通話を切る）
//
// 安全のための決まり（docs/TUTOR-LIVE-CHECK.md）
//   - キーは画面に表示しない入力（打った文字が出ない）でだけ受け取る。ファイル・環境変数・引数・ログには書かない
//   - 使うのは入力したキーだけ。OPENAI_API_KEY などの環境変数のキーは読まない（アプリと同じ lib/tutor/openai.ts を使う）
//   - 通話の確認は --paid を付け、確認の文を打ったときだけ。会話は文字で1往復・最大60秒。終わったら必ず通話を切る
//   - 結果（イベント名・モデル・所要時間）は画面に出すだけ。キーの末尾4文字以外は出さない
import { createInterface } from "node:readline";
import { createCall, hangupCall, listModels, TutorError } from "@/lib/tutor/openai";

const PAID = process.argv.includes("--paid");
const CONFIRM = "有料で実行します";
const CONFIRM_MODELS = "モデル一覧を取得します";

/** 打った文字を表示しない入力 */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    if (!stdin.isTTY) {
      // パスワード管理ソフトなどから渡すとき（表示しない）
      nextLine().then((l) => { process.stdout.write("\n"); resolve(l); });
      return;
    }
    let v = "";
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") { stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData); process.stdout.write("\n"); resolve(v.trim()); return; }
        if (c === "\u0003") { process.stdout.write("\n中止しました\n"); process.exit(130); }
        if (c === "\u007f" || c === "\b") v = v.slice(0, -1); else v += c;
      }
    };
    stdin.on("data", onData);
  });
}
// 入力を1行ずつ読む（端末でもパイプでも同じ読み方にする）
let lines: AsyncIterableIterator<string> | null = null;
async function nextLine(): Promise<string> {
  lines ??= createInterface({ input: process.stdin })[Symbol.asyncIterator]();
  const r = await lines.next();
  return r.done ? "" : String(r.value).trim();
}
async function ask(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const a = await nextLine();
  if (!process.stdin.isTTY) process.stdout.write("\n");
  return a;
}
const tail = (k: string) => `…${k.slice(-4)}`;

async function main() {
  console.log("チャッピー先生：本物の OpenAI Realtime への接続確認");
  console.log("呼ぶ API：GET /v1/models（モデルの一覧。生成は伴わない。料金がかからないことは公式の料金表で未確認）");
  if (PAID) {
    console.log("          POST /v1/realtime/calls（通話を作る：課金される）");
    console.log("          データチャネルで conversation.item.create・response.create を1回（応答の生成：課金される）");
    console.log("          POST /v1/realtime/calls/{id}/hangup（通話を切る）");
  }
  if ((await ask(`上の API を呼んでよければ「${CONFIRM_MODELS}」と入力してください: `)) !== CONFIRM_MODELS) { console.log("中止しました（API は呼んでいません）"); return; }
  const key = await askHidden("OpenAI API キー（入力した文字は表示されません）: ");
  if (!key) { console.log("キーが入力されませんでした"); process.exit(1); }

  // 1. キーの確認と、音声会話に使えるモデル（GET /v1/models だけ）
  const t0 = Date.now();
  const models = await listModels(key);
  console.log(`✓ キー（${tail(key)}）は有効です（GET /v1/models・${Date.now() - t0}ms）`);
  console.log(`  音声会話に使えるモデル：${models.voice.join(", ") || "（なし）"}`);
  console.log(`  字幕に使う文字起こしのモデル：${models.transcribe ?? "（なし：字幕は出ません）"}`);
  if (!PAID) { console.log("\nモデル一覧の確認は終わりました（呼んだのは GET /v1/models の1回だけ）。OpenAI の Usage に記録が出ていないかも確かめてください。"); return; }
  if (!models.voice.length) { console.log("音声会話に使えるモデルが無いので、通話の確認はできません"); process.exit(1); }

  // 2. 通話の確認（課金される）：確認の文を打ったときだけ
  const model = models.voice.includes("gpt-realtime-mini") ? "gpt-realtime-mini" : models.voice[0];
  console.log(`\nこれから、あなたのキーで「${model}」の通話を1回作り、文字で1往復します（料金がかかります。最大60秒）。`);
  if ((await ask(`続けるときは「${CONFIRM}」と入力してください: `)) !== CONFIRM) { console.log("中止しました（料金はかかっていません）"); return; }

  // ブラウザ（Chromium）で本物の WebRTC の申し込み（SDP）を作る。マイクは使わない（受信用の音声の枠とデータチャネルだけ）
  const { chromium } = await import("playwright");
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage();
  await page.goto("about:blank");
  const offer: string = await page.evaluate(async () => {
    const w = window as unknown as { pc: RTCPeerConnection; dc: RTCDataChannel; ev: { t: number; type: string; text?: string }[]; dcState: string[] };
    w.ev = []; w.dcState = [];
    const pc = new RTCPeerConnection();
    pc.addTransceiver("audio", { direction: "recvonly" });
    const dc = pc.createDataChannel("oai-events");
    dc.onmessage = (e) => { try { const o = JSON.parse(e.data); w.ev.push({ t: Date.now(), type: o.type, text: o.delta ?? o.text ?? o.error?.message }); } catch { /* 無視 */ } };
    dc.onopen = () => w.dcState.push("open");
    dc.onclose = () => w.dcState.push("closed");
    w.pc = pc; w.dc = dc;
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise((r) => { if (pc.iceGatheringState === "complete") r(null); else { pc.onicegatheringstatechange = () => pc.iceGatheringState === "complete" && r(null); setTimeout(r, 3000); } });
    return pc.localDescription!.sdp;
  });

  let callId: string | null = null;
  const started = Date.now();
  try {
    // アプリのサーバーと同じ関数で通話を作る（POST /v1/realtime/calls・multipart）
    const r = await createCall(key, offer, { model, instructions: "あなたは中学生の学習を手伝う先生です。日本語で、ひとことで答えてください。", mode: "text", slow: false });
    callId = r.callId;
    console.log(`✓ 通話を作りました（POST /v1/realtime/calls・${Date.now() - started}ms・通話ID ${callId ? "あり" : "なし（Location が無い）"}）`);
    await page.evaluate(async (answer) => { await (window as unknown as { pc: RTCPeerConnection }).pc.setRemoteDescription({ type: "answer", sdp: answer }); }, r.answer);
    await page.waitForFunction(() => (window as unknown as { dcState: string[] }).dcState.includes("open"), null, { timeout: 20000 });
    console.log("✓ データチャネルがつながりました");
    await page.evaluate(() => {
      const dc = (window as unknown as { dc: RTCDataChannel }).dc;
      dc.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "1+1は？" }] } }));
      dc.send(JSON.stringify({ type: "response.create" }));
    });
    await page.waitForFunction(() => (window as unknown as { ev: { type: string }[] }).ev.some((e) => e.type === "response.done" || e.type === "error"), null, { timeout: 30000 });
    const ev = await page.evaluate(() => (window as unknown as { ev: { type: string; text?: string }[] }).ev);
    const types = [...new Set(ev.map((e) => e.type))];
    const reply = ev.filter((e) => e.type === "response.output_text.delta").map((e) => e.text).join("");
    console.log(`✓ 受け取ったイベント：${types.join(", ")}`);
    console.log(`  応答：${reply || "（文字の応答なし）"}`);
    // アプリが使うイベント名（lib/tutor/realtime-client.ts）と照合する
    for (const need of ["session.created", "response.created", "response.output_text.delta", "response.output_text.done", "response.done"]) {
      console.log(`  ${types.includes(need) ? "✓" : "✗"} ${need}`);
    }
  } finally {
    // 3. サーバー側から切る（アプリの上限時間・同意の撤回・停止と同じ関数）
    if (callId) {
      const ok = await hangupCall(key, callId);
      console.log(`${ok ? "✓" : "✗"} 通話を切りました（POST /v1/realtime/calls/{id}/hangup）`);
      const closed = await page.waitForFunction(() => {
        const w = window as unknown as { dcState: string[]; pc: RTCPeerConnection };
        return w.dcState.includes("closed") || ["disconnected", "failed", "closed"].includes(w.pc.connectionState);
      }, null, { timeout: 20000 }).then(() => true, () => false);
      console.log(`${closed ? "✓" : "✗"} 切ったあと、ブラウザ側の接続も閉じた${closed ? "" : "（20秒以内に閉じなかった：要確認）"}`);
    }
    await browser.close();
    console.log(`所要 ${Math.round((Date.now() - started) / 1000)} 秒。料金は OpenAI の管理画面（Usage）で確かめてください。`);
  }
}

main().then(() => process.exit(0), (e) => {
  // キーの値は出さない（TutorError の文は本人向けの日本語で、キーを含まない）
  console.log(`✗ ${e instanceof TutorError ? `${e.message}（${e.code}）` : String(e?.message ?? e).replace(/sk-[A-Za-z0-9_-]+/g, "sk-…")}`);
  process.exit(1);
});
