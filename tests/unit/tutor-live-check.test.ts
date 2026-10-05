// npm run tutor:live-check が呼ぶ API を、代役の OpenAI（tests/e2e/mock-openai.mjs）に対して確かめる。
//   - 既定（モデル一覧の確認）：GET /v1/models の1回だけ。通話・生成の API は呼ばない
//   - 確認の文を打たなければ、何も呼ばない
//   - --paid でも、通話の確認の文を打たなければ GET /v1/models だけ
//   - 環境変数のキー（OPENAI_API_KEY）は使わない
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";

const KEY = "sk-proj-liveCHECKkeyAAAAAAAAAAAAAAAAAAAAA7777";
const PORT = 4300 + Math.floor(Math.random() * 500);

async function withMock<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const mock: ChildProcess = spawn(process.execPath, ["tests/e2e/mock-openai.mjs"], {
    env: { ...process.env, MOCK_OPENAI_PORT: String(PORT), MOCK_OPENAI_KEYS: KEY }, stdio: "ignore",
  });
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/__requests`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    return await fn(`http://127.0.0.1:${PORT}`);
  } finally { mock.kill(); }
}

function runScript(base: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/tutor-live-check/run.ts", ...args], {
      env: { ...process.env, TUTOR_OPENAI_BASE_URL: `${base}/v1`, OPENAI_API_KEY: "sk-proj-envKEYshouldNOTbeUSEDxxxxxxxxxxx9999" },
    });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { out += d; });
    p.on("close", () => resolve(out));
    p.stdin.end(input);
  });
}
const requests = async (base: string) => (await (await fetch(`${base}/__requests`)).json()) as { method: string; url: string; keyTail: string }[];

test("tutor:live-check（既定）が呼ぶのは GET /v1/models の1回だけ", async () => {
  await withMock(async (base) => {
    const out = await runScript(base, [], `モデル一覧を取得します\n${KEY}\n`);
    const reqs = await requests(base);
    assert.deepEqual(reqs.map((r) => `${r.method} ${r.url}`), ["GET /v1/models"], out);
    assert.ok(reqs.every((r) => r.keyTail === "7777"), "入力したキーだけを使う（環境変数のキーは使わない）");
    assert.ok(!out.includes(KEY) && !out.includes("無料"), "キーを表示しない・「無料」と断定しない");
  });
});

test("tutor:live-check：確認の文を打たなければ API を呼ばない。--paid でも通話の確認を断れば GET /v1/models だけ", async () => {
  await withMock(async (base) => {
    await runScript(base, [], "いいえ\n");
    assert.equal((await requests(base)).length, 0);
    const out = await runScript(base, ["--paid"], `モデル一覧を取得します\n${KEY}\nいいえ\n`);
    assert.deepEqual((await requests(base)).map((r) => `${r.method} ${r.url}`), ["GET /v1/models"], out);
    assert.ok(out.includes("POST /v1/realtime/calls") && out.includes("課金される"), "通話の確認で呼ぶ API と課金を、実行前に表示する");
  });
});
