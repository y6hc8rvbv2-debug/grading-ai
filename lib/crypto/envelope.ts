// 答案の写真の暗号化（エンベロープ暗号化。2026-10-27。docs/SECURITY-REVIEW.md）。サーバー専用
//
//   写真1枚ごとに使い捨ての鍵（データ鍵・AES-256）で暗号化し、そのデータ鍵を「鍵金庫」の鍵で包んで写真と一緒に保存する。
//   鍵金庫の鍵は DB・Storage の外にある：
//     aws-kms … AWS KMS（鍵は AWS の HSM の中から出ない。包む・ほどくは AWS に頼む）。本番のおすすめ
//     local   … 環境変数 IMAGE_ENC_LOCAL_KEY（テスト・開発用。鍵は Vercel にあり、DB・Storage とは別）
//   DB・Storage・そのバックアップが丸ごと漏れても、鍵金庫に届かなければ写真は読めない。
//   暗号文には保存先のパスを結び付ける（別の答案の場所へ移すと復号に失敗する）。
//   暗号化していない以前の写真は、そのまま読める（先頭の印で見分ける）。
//
// 形式：'TSE1' | 方式(1) | 包んだ鍵の長さ(2) | 包んだ鍵 | 種類の長さ(1) | 種類（image/jpeg など） | iv(12) | tag(16) | 暗号文
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const MAGIC = Buffer.from("TSE1");
const PROVIDER_CODE = { "aws-kms": 1, local: 2 } as const;
type Provider = keyof typeof PROVIDER_CODE;
const CONTEXT = { app: "test-saiten", purpose: "answer-sheet" };

/** いまの設定で新しく保存する写真を暗号化する方式（無ければ暗号化しない＝以前と同じ） */
export function encryptionProvider(env: Record<string, string | undefined> = process.env): Provider | null {
  const p = (env.IMAGE_ENC_PROVIDER ?? "").trim();
  if (p === "aws-kms") return env.AWS_KMS_KEY_ID ? "aws-kms" : null;
  if (p === "local") return localKey(env) ? "local" : null;
  return null;
}
export const isEncrypted = (buf: Uint8Array) => buf.length > 4 && Buffer.from(buf.subarray(0, 4)).equals(MAGIC);

function localKey(env: Record<string, string | undefined> = process.env) {
  const k = env.IMAGE_ENC_LOCAL_KEY ? Buffer.from(env.IMAGE_ENC_LOCAL_KEY, "base64") : null;
  return k && k.length === 32 ? k : null;
}

/* ------------------------------------------------------------------ 鍵金庫（データ鍵を包む・ほどく） */

type Kms = {
  generate(): Promise<{ plain: Buffer; wrapped: Buffer }>;
  unwrap(wrapped: Buffer): Promise<Buffer>;
};
let awsClient: unknown = null;
/** テストから AWS KMS の代役を差し込む */
export function __setKmsClientForTest(client: unknown) { awsClient = client; dekForEncrypt = null; unwrapCache.clear(); }

async function aws(): Promise<Kms> {
  const { KMSClient, GenerateDataKeyCommand, DecryptCommand } = await import("@aws-sdk/client-kms");
  const client = (awsClient ??= new KMSClient({ region: process.env.AWS_REGION || "ap-northeast-1" })) as InstanceType<typeof KMSClient>;
  const keyId = process.env.AWS_KMS_KEY_ID ?? "";
  return {
    async generate() {
      const r = await client.send(new GenerateDataKeyCommand({ KeyId: keyId, KeySpec: "AES_256", EncryptionContext: CONTEXT }));
      if (!r.Plaintext || !r.CiphertextBlob) throw new Error("鍵金庫（AWS KMS）からデータ鍵を受け取れませんでした");
      return { plain: Buffer.from(r.Plaintext), wrapped: Buffer.from(r.CiphertextBlob) };
    },
    async unwrap(wrapped) {
      const r = await client.send(new DecryptCommand({ CiphertextBlob: wrapped, EncryptionContext: CONTEXT, ...(keyId ? { KeyId: keyId } : {}) }));
      if (!r.Plaintext) throw new Error("鍵金庫（AWS KMS）でデータ鍵をほどけませんでした");
      return Buffer.from(r.Plaintext);
    },
  };
}
function local(): Kms {
  const kek = localKey();
  if (!kek) throw new Error("IMAGE_ENC_LOCAL_KEY（32バイトの base64）がありません");
  return {
    async generate() {
      const plain = randomBytes(32), iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", kek, iv);
      const ct = Buffer.concat([c.update(plain), c.final()]);
      return { plain, wrapped: Buffer.concat([iv, c.getAuthTag(), ct]) };
    },
    async unwrap(w) {
      const d = createDecipheriv("aes-256-gcm", kek, w.subarray(0, 12));
      d.setAuthTag(w.subarray(12, 28));
      return Buffer.concat([d.update(w.subarray(28)), d.final()]);
    },
  };
}
const kmsFor = (p: Provider) => (p === "aws-kms" ? aws() : Promise.resolve(local()));

// データ鍵の使い回し：暗号化は同じデータ鍵を5分・200枚まで（鍵金庫を呼ぶ回数と時間を減らす）。ほどいた鍵も10分だけ覚える
let dekForEncrypt: { provider: Provider; plain: Buffer; wrapped: Buffer; until: number; left: number } | null = null;
const unwrapCache = new Map<string, { key: Buffer; until: number }>();

async function dataKey(p: Provider) {
  const now = Date.now();
  if (!dekForEncrypt || dekForEncrypt.provider !== p || dekForEncrypt.until < now || dekForEncrypt.left <= 0) {
    const k = await (await kmsFor(p)).generate();
    dekForEncrypt = { provider: p, ...k, until: now + 5 * 60_000, left: 200 };
  }
  dekForEncrypt.left--;
  return dekForEncrypt;
}
async function unwrapKey(p: Provider, wrapped: Buffer) {
  const id = createHash("sha256").update(wrapped).digest("base64");
  const hit = unwrapCache.get(id);
  if (hit && hit.until > Date.now()) return hit.key;
  const key = await (await kmsFor(p)).unwrap(wrapped);
  if (unwrapCache.size > 500) unwrapCache.clear();
  unwrapCache.set(id, { key, until: Date.now() + 10 * 60_000 });
  return key;
}

const aad = (path: string, mime: string) => Buffer.from(`tsaiten-img-v1|${path}|${mime}`);

/* ------------------------------------------------------------------ 暗号化・復号 */

/** 写真を暗号化する（暗号化の設定が無ければ、そのまま返す） */
export async function encryptImage(buf: Uint8Array, mime: string, path: string): Promise<{ data: Buffer; encrypted: boolean }> {
  const p = encryptionProvider();
  if (!p) return { data: Buffer.from(buf), encrypted: false };
  const type = (mime || "application/octet-stream").slice(0, 100);
  const k = await dataKey(p);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k.plain, iv);
  c.setAAD(aad(path, type));
  const ct = Buffer.concat([c.update(buf), c.final()]);
  const len = Buffer.alloc(2); len.writeUInt16BE(k.wrapped.length);
  const t = Buffer.from(type);
  return { data: Buffer.concat([MAGIC, Buffer.from([PROVIDER_CODE[p]]), len, k.wrapped, Buffer.from([t.length]), t, iv, c.getAuthTag(), ct]), encrypted: true };
}

/** 写真を復号する（暗号化していない以前の写真は、そのまま返す）。書き換え・別の場所への移動は失敗する */
export async function decryptImage(buf: Uint8Array, path: string, fallbackMime = "application/octet-stream"): Promise<{ data: Buffer; mime: string; encrypted: boolean }> {
  const b = Buffer.from(buf);
  if (!isEncrypted(b)) return { data: b, mime: fallbackMime, encrypted: false };
  let o = 4;
  const code = b[o++];
  const provider = (Object.keys(PROVIDER_CODE) as Provider[]).find((k) => PROVIDER_CODE[k] === code);
  if (!provider) throw new Error("暗号化の方式が分かりません");
  const wl = b.readUInt16BE(o); o += 2;
  const wrapped = b.subarray(o, o + wl); o += wl;
  const tl = b[o++];
  const mime = b.subarray(o, o + tl).toString(); o += tl;
  const iv = b.subarray(o, o + 12); o += 12;
  const tag = b.subarray(o, o + 16); o += 16;
  const key = await unwrapKey(provider, wrapped);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAAD(aad(path, mime));
  d.setAuthTag(tag);
  return { data: Buffer.concat([d.update(b.subarray(o)), d.final()]), mime, encrypted: true };
}

/** 設定画面・準備状況に出す、暗号化の状態（鍵の値は返さない） */
export function encryptionStatus() {
  const p = encryptionProvider();
  return { enabled: !!p, provider: p, recommended: p === "aws-kms" };
}
