// ③ ログイン開始：登録済みの鍵で署名してもらうためのチャレンジを返す
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getUser } from "../../lib/store.js";
import { createToken, setCookie } from "../../lib/session.js";
import { rpID, isValidUsername } from "../../lib/webauthn.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { username } = req.body || {};
  const user = isValidUsername(username) ? await getUser(username) : null;
  // ユーザーの有無を外部に教えないよう、同じエラー文にする
  if (!user) return res.status(400).json({ error: "ログインできませんでした" });

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: user.credentials.map((c) => ({ id: c.id, transports: c.transports })),
    userVerification: "required",
  });

  setCookie(res, "wa_auth", createToken({ challenge: options.challenge, username }, 300), 300);
  res.status(200).json(options);
}
