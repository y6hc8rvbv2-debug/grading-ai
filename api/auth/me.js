// ログイン状態の確認
import { getSessionUser } from "../../lib/session.js";

export default function handler(req, res) {
  const username = getSessionUser(req);
  if (!username) return res.status(401).json({ error: "未ログインです" });
  res.status(200).json({ username });
}
