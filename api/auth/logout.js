import { setCookie } from "../../lib/session.js";

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  setCookie(res, "session", "", 0);
  res.status(200).json({ ok: true });
}
