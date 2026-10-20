// ④ ログイン完了：署名を公開鍵で検証し、OKならセッションCookieを発行する
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { getUser, saveUser } from "../../lib/store.js";
import { createToken, getCookie, readToken, setCookie } from "../../lib/session.js";
import { origin, rpID } from "../../lib/webauthn.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const pending = readToken(getCookie(req, "wa_auth"));
  setCookie(res, "wa_auth", "", 0);
  if (!pending) return res.status(400).json({ error: "時間切れです。もう一度お試しください" });

  const user = await getUser(pending.username);
  const stored = user?.credentials.find((c) => c.id === req.body?.id);
  if (!stored) return res.status(400).json({ error: "ログインできませんでした" });

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge: pending.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: stored.id,
        publicKey: Buffer.from(stored.publicKey, "base64url"),
        counter: stored.counter,
        transports: stored.transports,
      },
    });
  } catch (e) {
    return res.status(400).json({ error: "ログインできませんでした" });
  }
  if (!verification.verified) return res.status(400).json({ error: "ログインできませんでした" });

  // 使用回数カウンタを更新（鍵のコピーによる不正利用の検知に使われる）
  stored.counter = verification.authenticationInfo.newCounter;
  await saveUser(user);

  setCookie(res, "session", createToken({ username: user.username }, 60 * 60 * 8), 60 * 60 * 8);
  res.status(200).json({ ok: true });
}
