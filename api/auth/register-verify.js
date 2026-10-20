// ② 登録完了：端末が作った公開鍵を検証して保存する
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { getUser, saveUser } from "../../lib/store.js";
import { createToken, getCookie, readToken, setCookie } from "../../lib/session.js";
import { origin, rpID } from "../../lib/webauthn.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const pending = readToken(getCookie(req, "wa_reg"));
  setCookie(res, "wa_reg", "", 0); // チャレンジは1回きり
  if (!pending) return res.status(400).json({ error: "時間切れです。もう一度お試しください" });

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: pending.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    return res.status(400).json({ error: "登録の検証に失敗しました" });
  }
  if (!verification.verified) return res.status(400).json({ error: "登録の検証に失敗しました" });

  const { credential } = verification.registrationInfo;
  const user = (await getUser(pending.username)) ?? {
    id: pending.userID,
    username: pending.username,
    credentials: [],
  };
  user.credentials.push({
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: credential.transports,
  });
  await saveUser(user);

  setCookie(res, "session", createToken({ username: user.username }, 60 * 60 * 8), 60 * 60 * 8);
  res.status(200).json({ ok: true });
}
