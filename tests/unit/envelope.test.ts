// 答案の写真の暗号化（lib/crypto/envelope.ts）。本物の AWS には接続しない（代役の KMS を差し込む）
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptImage, encryptImage, encryptionProvider, isEncrypted, __setKmsClientForTest } from "../../lib/crypto/envelope";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(2000)]);
const PATH = "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333/1.jpg";
const withEnv = async (env: Record<string, string | undefined>, fn: () => Promise<void>) => {
  const old = { ...process.env };
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  try { __setKmsClientForTest(null); await fn(); } finally { process.env = old; __setKmsClientForTest(null); }
};
const LOCAL = { IMAGE_ENC_PROVIDER: "local", IMAGE_ENC_LOCAL_KEY: randomBytes(32).toString("base64"), AWS_KMS_KEY_ID: undefined };

test("設定が無ければ暗号化しない（以前と同じ）・以前の写真はそのまま読める", async () => {
  await withEnv({ IMAGE_ENC_PROVIDER: undefined }, async () => {
    assert.equal(encryptionProvider(), null);
    const e = await encryptImage(JPEG, "image/jpeg", PATH);
    assert.equal(e.encrypted, false);
    assert.ok(e.data.equals(JPEG));
    const d = await decryptImage(JPEG, PATH, "image/jpeg");
    assert.ok(d.data.equals(JPEG) && !d.encrypted && d.mime === "image/jpeg");
  });
});

test("暗号化すると中身が読めず、正しい鍵と場所でだけ元に戻る", async () => {
  await withEnv(LOCAL, async () => {
    const e = await encryptImage(JPEG, "image/jpeg", PATH);
    assert.ok(e.encrypted && isEncrypted(e.data));
    assert.ok(!e.data.includes(JPEG.subarray(4, 64)), "暗号文に元の写真のバイト列が含まれない");
    const d = await decryptImage(e.data, PATH);
    assert.ok(d.data.equals(JPEG) && d.mime === "image/jpeg" && d.encrypted);
    // 1バイトの書き換え・別の答案の場所への移動・別の鍵は失敗する
    const t = Buffer.from(e.data); t[t.length - 1] ^= 1;
    await assert.rejects(decryptImage(t, PATH));
    await assert.rejects(decryptImage(e.data, PATH.replace("/1.jpg", "/2.jpg")));
    process.env.IMAGE_ENC_LOCAL_KEY = randomBytes(32).toString("base64"); __setKmsClientForTest(null);
    await assert.rejects(decryptImage(e.data, PATH));
  });
});

test("AWS KMS：データ鍵を KMS に作らせ・ほどかせる（鍵金庫の鍵はアプリに来ない）", async () => {
  const kek = randomBytes(32);
  const calls: string[] = [];
  // KMS の代役：データ鍵を作り、kek で「包んだ」ことにする（中身は XOR。形の確認だけ）
  const fake = {
    async send(cmd: { constructor: { name: string }; input: Record<string, unknown> }) {
      calls.push(cmd.constructor.name);
      assert.deepEqual(cmd.input.EncryptionContext, { app: "test-saiten", purpose: "answer-sheet" });
      if (cmd.constructor.name === "GenerateDataKeyCommand") {
        assert.equal(cmd.input.KeySpec, "AES_256");
        const plain = randomBytes(32);
        return { Plaintext: plain, CiphertextBlob: Buffer.from(plain.map((b, i) => b ^ kek[i])) };
      }
      const blob = Buffer.from(cmd.input.CiphertextBlob as Uint8Array);
      return { Plaintext: Buffer.from(blob.map((b, i) => b ^ kek[i])) };
    },
  };
  await withEnv({ IMAGE_ENC_PROVIDER: "aws-kms", AWS_KMS_KEY_ID: "arn:aws:kms:ap-northeast-1:000000000000:key/test" }, async () => {
    __setKmsClientForTest(fake);
    const a = await encryptImage(JPEG, "image/jpeg", PATH);
    const b = await encryptImage(JPEG, "image/jpeg", PATH);
    assert.ok(!a.data.equals(b.data), "同じ写真でも毎回ちがう暗号文");
    assert.equal(calls.filter((c) => c === "GenerateDataKeyCommand").length, 1, "データ鍵は使い回して KMS を呼ぶ回数を減らす");
    __setKmsClientForTest(fake);   // 覚えた鍵を消して、KMS にほどかせる
    assert.ok((await decryptImage(a.data, PATH)).data.equals(JPEG));
    assert.ok(calls.includes("DecryptCommand"));
  });
});

import { isImagePath } from "../../lib/image-paths";
test("写真の API が受け付ける保存先：学校のフォルダの中だけ（.. や空の区切りは断る）", () => {
  for (const p of [PATH, "11111111-1111-1111-1111-111111111111/imports/req-1/1.pdf"]) assert.ok(isImagePath(p), p);
  for (const p of ["../etc/passwd", "11111111-1111-1111-1111-111111111111/../x.jpg", "11111111-1111-1111-1111-111111111111//x", "x/1.jpg", "11111111-1111-1111-1111-111111111111/a b.jpg"]) assert.ok(!isImagePath(p), p);
});

import { paddedBox, usableNameBox } from "../../lib/redact";
test("氏名欄の塗りつぶし：不自然な位置（広すぎる・細長い・ページの外・無い）は塗りつぶさない", () => {
  assert.ok(usableNameBox({ x: 0.05, y: 0.02, w: 0.3, h: 0.06 }));
  for (const b of [null, { x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 0.9, h: 0.05 }, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, { x: 0.8, y: 0, w: 0.3, h: 0.05 }, { x: 0, y: 0, w: 0.2, h: 0.3 }])
    assert.ok(!usableNameBox(b as never), JSON.stringify(b));
  const p = paddedBox({ x: 0.05, y: 0.02, w: 0.3, h: 0.06 });
  assert.ok(p.x < 0.05 && p.y < 0.02 && p.y >= 0 && p.x + p.w > 0.35 && p.y + p.h > 0.08, "少し広めに");
  const e = paddedBox({ x: 0, y: 0, w: 0.3, h: 0.06 });
  assert.ok(e.x === 0 && e.y === 0, "ページの外に出さない");
});
