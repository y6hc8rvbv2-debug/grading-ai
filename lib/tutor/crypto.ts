// チャッピー先生：生徒本人の API キーの暗号化（サーバー専用）。
//   - 暗号鍵は環境変数 TUTOR_KEY_ENCRYPTION_KEY（32バイトを base64）。DB には暗号文だけを置く
//   - AES-256-GCM。生徒IDを追加認証データにするので、暗号文を別の生徒の行へ移しても復号できない
//   - 暗号鍵が無いときは「保存する」を選べない（その場で使うだけ）
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "v1";

function encryptionKey(): Buffer | null {
  const raw = process.env.TUTOR_KEY_ENCRYPTION_KEY ?? "";
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

/** キーを保存できるか（暗号鍵が正しく設定されているか） */
export const canStoreKeys = () => encryptionKey() !== null;

export function encryptKey(plain: string, studentId: string): string {
  const key = encryptionKey();
  if (!key) throw new Error("no_encryption_key");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(studentId));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [PREFIX, iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
}

export function decryptKey(ciphertext: string, studentId: string): string {
  const key = encryptionKey();
  if (!key) throw new Error("no_encryption_key");
  const [v, iv, tag, ct] = ciphertext.split(".");
  if (v !== PREFIX || !iv || !tag || !ct) throw new Error("bad_ciphertext");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  d.setAAD(Buffer.from(studentId));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

/** 画面に出す目印（末尾4文字だけ） */
export const keyHint = (k: string) => k.slice(-4);
