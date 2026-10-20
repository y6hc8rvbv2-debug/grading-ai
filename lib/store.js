// ユーザーと公開鍵の保存先。
// KV_REST_API_URL / KV_REST_API_TOKEN（Upstash Redis / Vercel KV）があればそこへ、
// なければメモリに保存する（メモリはサーバー再起動で消えるので開発用）。
const memory = new Map();

async function redis(command) {
  const res = await fetch(process.env.KV_REST_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`KV error: ${res.status}`);
  return (await res.json()).result;
}

const useRedis = () => process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;

// 保存するのは公開鍵だけ。虹彩の画像や特徴量は端末の外に出ないので保存しない
export async function getUser(username) {
  const key = `user:${username}`;
  const raw = useRedis() ? await redis(["GET", key]) : memory.get(key);
  return raw ? JSON.parse(raw) : null;
}

export async function saveUser(user) {
  const key = `user:${user.username}`;
  const raw = JSON.stringify(user);
  if (useRedis()) await redis(["SET", key, raw]);
  else memory.set(key, raw);
}
