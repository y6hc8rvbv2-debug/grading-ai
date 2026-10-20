// ① 登録開始：ブラウザに「この条件で鍵を作って」という指示（チャレンジ）を返す
import crypto from "node:crypto";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { getUser } from "../../lib/store.js";
import { createToken, getSessionUser, setCookie } from "../../lib/session.js";
import { rpID, rpName, isValidUsername } from "../../lib/webauthn.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { username, registrationCode } = req.body || {};
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: "ユーザー名は英数字・_・- の3〜32文字にしてください" });
  }

  const existing = await getUser(username);
  if (existing) {
    // 既存ユーザーに端末を追加できるのは、本人としてログイン中のときだけ
    if (getSessionUser(req) !== username) {
      return res.status(409).json({ error: "このユーザー名は使われています" });
    }
  } else if (!process.env.REGISTRATION_CODE || registrationCode !== process.env.REGISTRATION_CODE) {
    // 誰でも勝手に登録できないよう、新規登録には登録コードを必須にする
    return res.status(403).json({ error: "登録コードが違います" });
  }

  const userID = existing?.id ?? crypto.randomBytes(16).toString("base64url");
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: username,
    userID: Buffer.from(userID, "base64url"),
    attestationType: "none",
    excludeCredentials: (existing?.credentials ?? []).map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: {
      // platform = 端末内蔵の認証器（虹彩・顔・指紋センサー）を使う
      authenticatorAttachment: "platform",
      // required = 生体認証による本人確認を必ず行う
      userVerification: "required",
      residentKey: "preferred",
    },
  });

  // チャレンジは5分だけ有効な署名付きCookieに保存
  setCookie(res, "wa_reg", createToken({ challenge: options.challenge, username, userID }, 300), 300);
  res.status(200).json(options);
}
