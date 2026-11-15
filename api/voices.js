// クニゴエのサーバー側（Vercel サーバーレス関数・1ファイルに集約して無料枠に収める）
// データベース：PostgreSQL（Neon / Supabase などの無料枠）。DATABASE_URL が未設定のときは
// 「未設定」と返し、画面側はデモモード（端末内保存）で動く。
const crypto = require('crypto');
const { Pool } = require('pg');
const KG = require('../voices/shared.js');

const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
// セッション署名用の秘密鍵。未設定なら DB 接続文字列（これ自体が秘密）から導出する
const SECRET = process.env.KG_SESSION_SECRET
  || (DB_URL ? crypto.createHmac('sha256', DB_URL).update('kunigoe-session').digest('hex') : '');
const ADMINS = (process.env.KG_ADMINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

let pool = null;
let ready = null;
function db() {
  if (!pool) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL);
    pool = new Pool({ connectionString: DB_URL, max: 3, idleTimeoutMillis: 10000, ssl: local ? false : { rejectUnauthorized: true } });
    pool.on('error', (e) => console.error('[voices] db pool error', e.message));
  }
  return pool;
}
const q = (text, params) => db().query(text, params);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kg_users(
  id BIGSERIAL PRIMARY KEY, handle TEXT UNIQUE NOT NULL, name TEXT NOT NULL, pw TEXT NOT NULL,
  country TEXT NOT NULL, age TEXT, gender TEXT, area TEXT, bio TEXT NOT NULL DEFAULT '',
  sv INT NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS kg_posts(
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES kg_users(id) ON DELETE CASCADE,
  country TEXT NOT NULL, kind TEXT NOT NULL, topic TEXT NOT NULL, stance TEXT, emotion TEXT, sat SMALLINT,
  body TEXT NOT NULL, parent_id BIGINT REFERENCES kg_posts(id) ON DELETE CASCADE,
  quote_id BIGINT REFERENCES kg_posts(id) ON DELETE SET NULL,
  poll JSONB, poll_counts INT[], likes INT NOT NULL DEFAULT 0, agrees INT NOT NULL DEFAULT 0,
  disagrees INT NOT NULL DEFAULT 0, replies INT NOT NULL DEFAULT 0, quotes INT NOT NULL DEFAULT 0,
  hidden BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS kg_posts_country ON kg_posts(country, id DESC);
CREATE INDEX IF NOT EXISTS kg_posts_user ON kg_posts(user_id, id DESC);
CREATE INDEX IF NOT EXISTS kg_posts_parent ON kg_posts(parent_id);
CREATE TABLE IF NOT EXISTS kg_desks(
  id BIGSERIAL PRIMARY KEY, country TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL,
  posts INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(country, type, name));
ALTER TABLE kg_posts ADD COLUMN IF NOT EXISTS desk_type TEXT NOT NULL DEFAULT 'country';
ALTER TABLE kg_posts ADD COLUMN IF NOT EXISTS desk_id BIGINT REFERENCES kg_desks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS kg_posts_desk ON kg_posts(desk_id, id DESC);
ALTER TABLE kg_desks ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS kg_desk_reports(
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES kg_users(id) ON DELETE CASCADE,
  desk_id BIGINT NOT NULL REFERENCES kg_desks(id) ON DELETE CASCADE, reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(user_id, desk_id));
CREATE TABLE IF NOT EXISTS kg_reactions(
  user_id BIGINT NOT NULL REFERENCES kg_users(id) ON DELETE CASCADE,
  post_id BIGINT NOT NULL REFERENCES kg_posts(id) ON DELETE CASCADE,
  type TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(user_id, post_id, type));
CREATE INDEX IF NOT EXISTS kg_reactions_post ON kg_reactions(post_id);
CREATE TABLE IF NOT EXISTS kg_votes(
  user_id BIGINT NOT NULL REFERENCES kg_users(id) ON DELETE CASCADE,
  post_id BIGINT NOT NULL REFERENCES kg_posts(id) ON DELETE CASCADE,
  opt SMALLINT NOT NULL, PRIMARY KEY(user_id, post_id));
CREATE TABLE IF NOT EXISTS kg_follows(
  follower BIGINT NOT NULL REFERENCES kg_users(id) ON DELETE CASCADE,
  followee BIGINT NOT NULL REFERENCES kg_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(follower, followee));
CREATE TABLE IF NOT EXISTS kg_tags(
  post_id BIGINT NOT NULL REFERENCES kg_posts(id) ON DELETE CASCADE,
  tag TEXT NOT NULL, country TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS kg_tags_country ON kg_tags(country, created_at);
CREATE INDEX IF NOT EXISTS kg_tags_tag ON kg_tags(tag);
CREATE TABLE IF NOT EXISTS kg_reports(
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES kg_users(id) ON DELETE CASCADE,
  post_id BIGINT NOT NULL REFERENCES kg_posts(id) ON DELETE CASCADE, reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(user_id, post_id));
CREATE TABLE IF NOT EXISTS kg_rl(k TEXT NOT NULL, w BIGINT NOT NULL, n INT NOT NULL, PRIMARY KEY(k, w));
CREATE TABLE IF NOT EXISTS kg_logs(
  id BIGSERIAL PRIMARY KEY, ev TEXT NOT NULL, uid BIGINT, iph TEXT, detail TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now());
`;
function init() {
  if (!ready) {
    ready = (async () => {
      const c = await db().connect();
      try {
        await c.query('SELECT pg_advisory_lock(5770101)'); // 同時起動で表作成がぶつからないように
        await c.query(SCHEMA);
        await c.query('SELECT pg_advisory_unlock(5770101)');
      } finally { c.release(); }
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

// ---------- 共通の道具 ----------
class Bad extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const ipHash = (req) => {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  return sign('ip:' + ip).slice(0, 16); // IPアドレスそのものは保存しない（ハッシュ化）
};
function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  return `s1$${b64(salt)}$${b64(crypto.scryptSync(pw, salt, 64))}`;
}
function verifyPw(pw, stored) {
  const [v, salt, hash] = String(stored).split('$');
  if (v !== 's1') return false;
  const a = crypto.scryptSync(pw, Buffer.from(salt, 'base64url'), 64);
  const b = Buffer.from(hash, 'base64url');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const SESSION_DAYS = 30;
function setSession(res, user) {
  const body = `${user.id}.${user.sv}.${Date.now() + SESSION_DAYS * 864e5}`;
  res.setHeader('Set-Cookie', `kg_s=${body}.${sign(body)}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
}
const clearSession = (res) => res.setHeader('Set-Cookie', 'kg_s=; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
async function currentUser(req) {
  const m = /(?:^|;\s*)kg_s=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 4) return null;
  const body = parts.slice(0, 3).join('.');
  const a = Buffer.from(sign(body)); const b = Buffer.from(parts[3]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(parts[2]) < Date.now()) return null;
  const r = await q('SELECT id, handle, name, country, age, gender, area, bio, sv FROM kg_users WHERE id=$1', [parts[0]]);
  const u = r.rows[0];
  if (!u || String(u.sv) !== parts[1]) return null;
  u.id = Number(u.id);
  return u;
}
const publicMe = (u) => u && ({
  handle: u.handle, name: u.name, country: u.country, age: u.age, gender: u.gender, area: u.area, bio: u.bio,
  isAdmin: ADMINS.includes(u.handle),
});
// 回数制限：key ごとに windowSec 秒あたり limit 回まで
async function rateLimit(key, limit, windowSec) {
  const w = Math.floor(Date.now() / 1000 / windowSec);
  const r = await q(
    'INSERT INTO kg_rl(k, w, n) VALUES($1, $2, 1) ON CONFLICT(k, w) DO UPDATE SET n = kg_rl.n + 1 RETURNING n',
    [`${key}:${windowSec}`, w]);
  if (Math.random() < 0.02) q('DELETE FROM kg_rl WHERE w < $1', [Math.floor(Date.now() / 1000 / 86400) - 2]).catch(() => {});
  if (r.rows[0].n > limit) throw new Bad('操作が多すぎます。しばらく待ってからもう一度お試しください。', 429);
}
const log = (ev, uid, iph, detail) => {
  console.log(`[voices] ${ev} uid=${uid || '-'} ${detail || ''}`);
  return q('INSERT INTO kg_logs(ev, uid, iph, detail) VALUES($1,$2,$3,$4)', [ev, uid || null, iph, String(detail || '').slice(0, 200)]).catch(() => {});
};

// ---------- 入力検査 ----------
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '');
const oneOf = (v, list, optional) => {
  if ((v === null || v === undefined || v === '') && optional) return null;
  if (!KG.keys(list).includes(v)) throw new Bad('選択肢が正しくありません。');
  return v;
};
const countryOf = (v, allowAll) => {
  if (allowAll && v === 'ALL') return 'ALL';
  if (!KG.country(v)) throw new Bad('国の指定が正しくありません。');
  return v;
};
const idOf = (v) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new Bad('指定が正しくありません。'); return n; };
// 投稿本文に紛れ込んだ個人情報（メール・電話番号・カード番号らしきもの）を伏せ字にする
function maskPII(s) {
  return s
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '［メールアドレス非表示］')
    .replace(/(?<!\d)(?:\d[ -]?){13,16}(?!\d)/g, '［番号非表示］')
    .replace(/(?<![\d,.])(?:0\d{1,3}-\d{1,4}-\d{4}|0[5789]0\d{8})(?!\d)/g, '［電話番号非表示］');
}

// ---------- 投稿の取得 ----------
const POST_SELECT = `
SELECT p.id, p.country, p.kind, p.topic, p.stance, p.emotion, p.sat, p.body, p.parent_id, p.poll, p.poll_counts,
  p.likes, p.agrees, p.disagrees, p.replies, p.quotes, p.created_at, u.handle, u.name, (p.user_id = $1) AS mine,
  (SELECT array_agg(type) FROM kg_reactions r WHERE r.user_id = $1 AND r.post_id = p.id) AS my,
  (SELECT opt FROM kg_votes v WHERE v.user_id = $1 AND v.post_id = p.id) AS myvote,
  q.id AS qid, q.body AS qbody, q.kind AS qkind, q.created_at AS qcreated, q.hidden AS qhidden,
  qu.handle AS qhandle, qu.name AS qname, p.desk_type, p.desk_id, d.name AS desk_name, d.hidden AS desk_hidden
FROM kg_posts p JOIN kg_users u ON u.id = p.user_id LEFT JOIN kg_desks d ON d.id = p.desk_id
LEFT JOIN kg_posts q ON q.id = p.quote_id LEFT JOIN kg_users qu ON qu.id = q.user_id`;
function shape(r) {
  const my = r.my || [];
  return {
    id: Number(r.id), country: r.country, kind: r.kind, topic: r.topic, stance: r.stance, emotion: r.emotion, sat: r.sat,
    body: r.body, parent: r.parent_id ? Number(r.parent_id) : null, created: new Date(r.created_at).getTime(),
    user: { handle: r.handle, name: r.name }, mine: !!r.mine,
    desk: r.desk_id && !r.desk_hidden ? { id: Number(r.desk_id), type: r.desk_type, name: r.desk_name } : null,
    likes: r.likes, agrees: r.agrees, disagrees: r.disagrees, replies: r.replies, quotes: r.quotes,
    poll: r.poll ? { options: r.poll.options, counts: r.poll_counts, my: r.myvote } : null,
    my: { like: my.includes('like'), bookmark: my.includes('bookmark'), agree: my.includes('agree'), disagree: my.includes('disagree') },
    quote: r.qid && !r.qhidden ? { id: Number(r.qid), body: r.qbody, kind: r.qkind, created: new Date(r.qcreated).getTime(), user: { handle: r.qhandle, name: r.qname } } : null,
  };
}
const like = (s) => '%' + s.replace(/[\\%_]/g, '\\$&') + '%';

// ---------- 各操作 ----------
const A = {};

A.me = async ({ me }) => ({ me: publicMe(me) });

A.signup = async ({ p, req, res }) => {
  const iph = ipHash(req);
  await rateLimit('signup:' + iph, 5, 3600);
  const handle = str(p.handle, 15).toLowerCase();
  if (!/^[a-z0-9_]{3,15}$/.test(handle)) throw new Bad('ユーザーIDは半角英数字と _ で3〜15文字にしてください。');
  const name = str(p.name, 20) || handle;
  if (typeof p.password !== 'string' || p.password.length < 8 || p.password.length > 100) throw new Bad('パスワードは8文字以上にしてください。');
  const vals = [handle, name, hashPw(p.password), countryOf(p.country), oneOf(p.age, KG.AGES, true), oneOf(p.gender, KG.GENDERS, true), oneOf(p.area, KG.AREAS, true)];
  let r;
  try {
    r = await q('INSERT INTO kg_users(handle, name, pw, country, age, gender, area) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id, sv', vals);
  } catch (e) {
    if (e.code === '23505') throw new Bad('このユーザーIDはすでに使われています。');
    throw e;
  }
  const u = { id: Number(r.rows[0].id), sv: r.rows[0].sv };
  setSession(res, u);
  log('signup', u.id, iph);
  return { me: publicMe(await currentUserById(u.id)) };
};
const currentUserById = async (id) => (await q('SELECT id, handle, name, country, age, gender, area, bio, sv FROM kg_users WHERE id=$1', [id])).rows[0];

A.login = async ({ p, req, res }) => {
  const iph = ipHash(req);
  const handle = str(p.handle, 15).toLowerCase();
  await rateLimit('login:' + iph, 20, 900);
  await rateLimit('login:' + handle, 10, 900);
  const r = await q('SELECT id, pw, sv FROM kg_users WHERE handle=$1', [handle]);
  const u = r.rows[0];
  // 「IDが無い」のか「パスワード違い」なのかは教えない（アカウント探しを防ぐ）
  if (!u || typeof p.password !== 'string' || !verifyPw(p.password, u.pw)) {
    log('login_fail', u && u.id, iph, handle);
    throw new Bad('ユーザーIDまたはパスワードが違います。', 401);
  }
  setSession(res, u);
  log('login', u.id, iph);
  return { me: publicMe(await currentUserById(u.id)) };
};

A.logout = async ({ res }) => { clearSession(res); return { ok: true }; };

A.updateProfile = async ({ p, me }) => {
  await q('UPDATE kg_users SET name=$2, bio=$3, country=$4, age=$5, gender=$6, area=$7 WHERE id=$1', [
    me.id, str(p.name, 20) || me.handle, str(p.bio, 160), countryOf(p.country),
    oneOf(p.age, KG.AGES, true), oneOf(p.gender, KG.GENDERS, true), oneOf(p.area, KG.AREAS, true)]);
  return { me: publicMe(await currentUserById(me.id)) };
};

A.changePassword = async ({ p, me, req, res }) => {
  await rateLimit('pw:' + me.id, 5, 3600);
  const r = await q('SELECT pw FROM kg_users WHERE id=$1', [me.id]);
  if (typeof p.current !== 'string' || !verifyPw(p.current, r.rows[0].pw)) throw new Bad('現在のパスワードが違います。', 401);
  if (typeof p.password !== 'string' || p.password.length < 8 || p.password.length > 100) throw new Bad('パスワードは8文字以上にしてください。');
  // sv を増やすと、他の端末のログインはすべて無効になる
  const u = await q('UPDATE kg_users SET pw=$2, sv=sv+1 WHERE id=$1 RETURNING id, sv', [me.id, hashPw(p.password)]);
  setSession(res, u.rows[0]);
  log('pw_change', me.id, ipHash(req));
  return { ok: true };
};

A.deleteAccount = async ({ p, me, req, res }) => {
  const r = await q('SELECT pw FROM kg_users WHERE id=$1', [me.id]);
  if (typeof p.password !== 'string' || !verifyPw(p.password, r.rows[0].pw)) throw new Bad('パスワードが違います。', 401);
  await q('DELETE FROM kg_users WHERE id=$1', [me.id]); // 投稿・反応などもまとめて削除される
  clearSession(res);
  log('account_delete', null, ipHash(req));
  return { ok: true };
};

A.feed = async ({ p, me }) => {
  const uid = me ? me.id : 0;
  const params = [uid];
  const add = (v) => { params.push(v); return '$' + params.length; };
  const w = ['p.hidden = false'];
  let order = 'p.id DESC';
  if (p.id) w.push(`p.id = ${add(idOf(p.id))}`);
  else if (p.parent) { w.push(`p.parent_id = ${add(idOf(p.parent))}`); order = 'p.id ASC'; }
  else {
    if (p.tab === 'bookmarks') {
      if (!me) throw new Bad('ログインが必要です。', 401);
      w.push(`EXISTS(SELECT 1 FROM kg_reactions b WHERE b.user_id = $1 AND b.post_id = p.id AND b.type = 'bookmark')`);
    } else {
      if (p.user) w.push(`u.handle = ${add(str(p.user, 15).toLowerCase())}`);
      else {
        w.push('p.parent_id IS NULL');
        const c = countryOf(p.country || 'ALL', true);
        if (p.desk) w.push(`p.desk_id = ${add(idOf(p.desk))} AND d.hidden = false`); // 窓口を指定したときは、その窓口の投稿だけ
        else if (c !== 'ALL') w.push(`p.country = ${add(c)}`);
        if (p.deskType) w.push(`p.desk_type = ${add(oneOf(p.deskType, KG.DESK_TYPES))}`);
      }
      if (p.tab === 'following') {
        if (!me) throw new Bad('ログインが必要です。', 401);
        w.push('p.user_id IN (SELECT followee FROM kg_follows WHERE follower = $1)');
      }
      if (p.tab === 'popular') {
        w.push(`p.created_at > now() - interval '14 days'`);
        order = '(p.likes + p.agrees + p.disagrees + p.replies * 2 + p.quotes * 2) DESC, p.id DESC';
      }
      if (p.kind) w.push(`p.kind = ${add(oneOf(p.kind, KG.KINDS))}`);
      if (p.topic) w.push(`p.topic = ${add(oneOf(p.topic, KG.TOPICS))}`);
      if (p.tag) w.push(`EXISTS(SELECT 1 FROM kg_tags t WHERE t.post_id = p.id AND t.tag = ${add(str(p.tag, 30).toLowerCase())})`);
      if (p.q) w.push(`p.body ILIKE ${add(like(str(p.q, 50)))}`);
    }
    if (p.before && p.tab !== 'popular') w.push(`p.id < ${add(idOf(p.before))}`);
  }
  const limit = p.tab === 'popular' ? 40 : 20;
  const r = await q(`${POST_SELECT} WHERE ${w.join(' AND ')} ORDER BY ${order} LIMIT ${limit}`, params);
  return { posts: r.rows.map(shape), more: p.tab !== 'popular' && r.rows.length === limit };
};

A.post = async ({ p, me, req }) => {
  await rateLimit('post:' + me.id, 10, 300);
  await rateLimit('postday:' + me.id, 100, 86400);
  const quoteId = p.quote ? idOf(p.quote) : null;
  const parentId = p.parent ? idOf(p.parent) : null;
  const body = maskPII(str(p.body, KG.MAX_BODY));
  if (!body && !quoteId) throw new Bad('本文を入力してください。');
  let poll = null;
  if (Array.isArray(p.poll) && p.poll.length) {
    const options = p.poll.map((o) => str(o, 40)).filter(Boolean);
    if (options.length < 2 || options.length > 4) throw new Bad('アンケートの選択肢は2〜4個にしてください。');
    poll = { options };
  }
  let country = countryOf(p.country), kind = oneOf(p.kind, KG.KINDS), topic = oneOf(p.topic, KG.TOPICS);
  let deskType = oneOf(p.deskType || 'country', KG.DESK_TYPES), deskId = null;
  if (parentId) { // 返信は元の投稿の国・分野を引き継ぐ
    const pr = await q('SELECT country, topic, desk_type, desk_id FROM kg_posts WHERE id=$1 AND hidden=false', [parentId]);
    if (!pr.rows[0]) throw new Bad('返信先の投稿が見つかりません。', 404);
    country = pr.rows[0].country; topic = pr.rows[0].topic; deskType = pr.rows[0].desk_type; deskId = pr.rows[0].desk_id;
  } else if (deskType !== 'country') {
    // 窓口（県・市・政治家・政策など）は名前で管理。同じ国・種類・名前なら同じ窓口にまとめる
    const deskName = str(String(p.deskName || '').normalize('NFKC'), KG.MAX_DESK).replace(/\s+/g, ' ');
    if (!deskName) throw new Bad('窓口の名前を入力してください。');
    if (maskPII(deskName) !== deskName) throw new Bad('窓口の名前に連絡先などの個人情報は使えません。');
    const dr = await q(`INSERT INTO kg_desks(country, type, name, posts) VALUES($1,$2,$3,1)
      ON CONFLICT(country, type, name) DO UPDATE SET posts = kg_desks.posts + 1 RETURNING id, hidden`, [country, deskType, deskName]);
    if (dr.rows[0].hidden) throw new Bad('この窓口は運営により非表示になっているため、利用できません。', 403);
    deskId = dr.rows[0].id;
  }
  if (quoteId && !(await q('SELECT 1 FROM kg_posts WHERE id=$1 AND hidden=false', [quoteId])).rows[0]) throw new Bad('引用元の投稿が見つかりません。', 404);
  const sat = p.sat ? Number(p.sat) : null;
  if (sat !== null && ![1, 2, 3, 4, 5].includes(sat)) throw new Bad('暮らし向きの値が正しくありません。');
  const r = await q(
    `INSERT INTO kg_posts(user_id, country, kind, topic, stance, emotion, sat, body, parent_id, quote_id, poll, poll_counts, desk_type, desk_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [me.id, country, kind, topic, oneOf(p.stance, KG.STANCES, true), oneOf(p.emotion, KG.EMOTIONS, true), sat, body,
      parentId, quoteId, poll ? JSON.stringify(poll) : null, poll ? poll.options.map(() => 0) : null, deskType, deskId]);
  const id = Number(r.rows[0].id);
  const tags = KG.tagsOf(body);
  for (const t of tags) await q('INSERT INTO kg_tags(post_id, tag, country) VALUES($1,$2,$3)', [id, t, country]);
  if (parentId) await q('UPDATE kg_posts SET replies = replies + 1 WHERE id=$1', [parentId]);
  if (quoteId) await q('UPDATE kg_posts SET quotes = quotes + 1 WHERE id=$1', [quoteId]);
  const out = await q(`${POST_SELECT} WHERE p.id = $2`, [me.id, id]);
  return { post: shape(out.rows[0]) };
};

A.deletePost = async ({ p, me }) => {
  const id = idOf(p.id);
  const r = await q('DELETE FROM kg_posts WHERE id=$1 AND user_id=$2 RETURNING parent_id, quote_id, desk_id', [id, me.id]); // 自分の投稿だけ消せる
  if (!r.rows[0]) throw new Bad('削除できません。', 403);
  if (r.rows[0].parent_id) await q('UPDATE kg_posts SET replies = GREATEST(replies - 1, 0) WHERE id=$1', [r.rows[0].parent_id]);
  if (r.rows[0].quote_id) await q('UPDATE kg_posts SET quotes = GREATEST(quotes - 1, 0) WHERE id=$1', [r.rows[0].quote_id]);
  if (r.rows[0].desk_id && !r.rows[0].parent_id) await q('UPDATE kg_desks SET posts = GREATEST(posts - 1, 0) WHERE id=$1', [r.rows[0].desk_id]);
  return { ok: true };
};

const COUNTER = { like: 'likes', agree: 'agrees', disagree: 'disagrees' };
A.react = async ({ p, me }) => {
  await rateLimit('react:' + me.id, 120, 300);
  const id = idOf(p.id);
  const type = p.type;
  if (!['like', 'bookmark', 'agree', 'disagree'].includes(type)) throw new Bad('指定が正しくありません。');
  if (!(await q('SELECT 1 FROM kg_posts WHERE id=$1 AND hidden=false', [id])).rows[0]) throw new Bad('投稿が見つかりません。', 404);
  const toggle = async (t, on) => {
    const r = on
      ? await q('INSERT INTO kg_reactions(user_id, post_id, type) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [me.id, id, t])
      : await q('DELETE FROM kg_reactions WHERE user_id=$1 AND post_id=$2 AND type=$3', [me.id, id, t]);
    if (r.rowCount && COUNTER[t]) await q(`UPDATE kg_posts SET ${COUNTER[t]} = GREATEST(${COUNTER[t]} + $2, 0) WHERE id=$1`, [id, on ? 1 : -1]);
  };
  const has = (await q('SELECT 1 FROM kg_reactions WHERE user_id=$1 AND post_id=$2 AND type=$3', [me.id, id, type])).rows[0];
  await toggle(type, !has);
  if (!has && type === 'agree') await toggle('disagree', false); // 賛成と反対は同時に付けられない
  if (!has && type === 'disagree') await toggle('agree', false);
  const out = await q(`${POST_SELECT} WHERE p.id = $2`, [me.id, id]);
  return { post: shape(out.rows[0]) };
};

A.vote = async ({ p, me }) => {
  await rateLimit('react:' + me.id, 120, 300);
  const id = idOf(p.id); const opt = Number(p.opt);
  const pr = (await q('SELECT poll FROM kg_posts WHERE id=$1 AND hidden=false', [id])).rows[0];
  if (!pr || !pr.poll || !Number.isInteger(opt) || opt < 0 || opt >= pr.poll.options.length) throw new Bad('投票できません。');
  const r = await q('INSERT INTO kg_votes(user_id, post_id, opt) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [me.id, id, opt]); // 1人1票
  if (r.rowCount) await q('UPDATE kg_posts SET poll_counts[$2] = poll_counts[$2] + 1 WHERE id=$1', [id, opt + 1]);
  const out = await q(`${POST_SELECT} WHERE p.id = $2`, [me.id, id]);
  return { post: shape(out.rows[0]) };
};

A.follow = async ({ p, me }) => {
  await rateLimit('react:' + me.id, 120, 300);
  const t = (await q('SELECT id FROM kg_users WHERE handle=$1', [str(p.handle, 15).toLowerCase()])).rows[0];
  if (!t || Number(t.id) === me.id) throw new Bad('フォローできません。');
  const d = await q('DELETE FROM kg_follows WHERE follower=$1 AND followee=$2', [me.id, t.id]);
  if (!d.rowCount) await q('INSERT INTO kg_follows(follower, followee) VALUES($1,$2)', [me.id, t.id]);
  return { following: !d.rowCount };
};

A.profile = async ({ p, me }) => {
  const r = await q(
    `SELECT u.id, u.handle, u.name, u.bio, u.country, u.created_at,
      (SELECT count(*) FROM kg_posts WHERE user_id = u.id AND hidden = false)::int AS posts,
      (SELECT count(*) FROM kg_follows WHERE followee = u.id)::int AS followers,
      (SELECT count(*) FROM kg_follows WHERE follower = u.id)::int AS following,
      EXISTS(SELECT 1 FROM kg_follows WHERE follower = $2 AND followee = u.id) AS followed
     FROM kg_users u WHERE u.handle = $1`, [str(p.handle, 15).toLowerCase(), me ? me.id : 0]);
  const u = r.rows[0];
  if (!u) throw new Bad('ユーザーが見つかりません。', 404);
  // 年代・性別・地域は統計にだけ使い、プロフィールには出さない
  return { profile: { handle: u.handle, name: u.name, bio: u.bio, country: u.country, joined: new Date(u.created_at).getTime(), posts: u.posts, followers: u.followers, following: u.following, followed: u.followed, mine: !!me && Number(u.id) === me.id } };
};

// 窓口の一覧・検索（id を指定すると1件だけ）
A.desks = async ({ p }) => {
  const params = [];
  const add = (v) => { params.push(v); return '$' + params.length; };
  const w = ['posts > 0', 'hidden = false'];
  if (p.id) w.push(`id = ${add(idOf(p.id))}`);
  else {
    const c = countryOf(p.country || 'ALL', true);
    if (c !== 'ALL') w.push(`country = ${add(c)}`);
    if (p.type) w.push(`type = ${add(oneOf(p.type, KG.DESK_TYPES))}`);
    if (p.q) w.push(`name ILIKE ${add(like(str(p.q, KG.MAX_DESK)))}`);
  }
  const r = await q(`SELECT id, country, type, name, posts FROM kg_desks WHERE ${w.join(' AND ')} ORDER BY posts DESC, id LIMIT 40`, params);
  return { desks: r.rows.map((x) => ({ ...x, id: Number(x.id) })) };
};

A.trends = async ({ p }) => {
  const c = countryOf(p.country || 'ALL', true);
  const r = await q(
    `SELECT tag, count(*)::int AS n FROM kg_tags WHERE created_at > now() - interval '7 days' ${c === 'ALL' ? '' : 'AND country = $1'}
     GROUP BY tag ORDER BY n DESC, tag LIMIT 10`, c === 'ALL' ? [] : [c]);
  return { tags: r.rows };
};

A.notifications = async ({ me }) => {
  const r = await q(
    `(SELECT 'reply' AS type, c.id AS post_id, c.body, u.handle, u.name, c.created_at AS at
        FROM kg_posts c JOIN kg_posts p ON p.id = c.parent_id JOIN kg_users u ON u.id = c.user_id
        WHERE p.user_id = $1 AND c.user_id <> $1 AND c.hidden = false ORDER BY c.id DESC LIMIT 20)
     UNION ALL
     (SELECT 'quote', c.id, c.body, u.handle, u.name, c.created_at
        FROM kg_posts c JOIN kg_posts p ON p.id = c.quote_id JOIN kg_users u ON u.id = c.user_id
        WHERE p.user_id = $1 AND c.user_id <> $1 AND c.hidden = false ORDER BY c.id DESC LIMIT 20)
     UNION ALL
     (SELECT r.type, p.id, p.body, u.handle, u.name, r.created_at
        FROM kg_reactions r JOIN kg_posts p ON p.id = r.post_id JOIN kg_users u ON u.id = r.user_id
        WHERE p.user_id = $1 AND r.user_id <> $1 AND r.type IN ('like','agree','disagree') ORDER BY r.created_at DESC LIMIT 20)
     UNION ALL
     (SELECT 'follow', NULL, '', u.handle, u.name, f.created_at
        FROM kg_follows f JOIN kg_users u ON u.id = f.follower WHERE f.followee = $1 ORDER BY f.created_at DESC LIMIT 20)
     ORDER BY at DESC LIMIT 40`, [me.id]);
  return { items: r.rows.map((x) => ({ type: x.type, postId: x.post_id ? Number(x.post_id) : null, body: x.body.slice(0, 80), user: { handle: x.handle, name: x.name }, at: new Date(x.at).getTime() })) };
};

A.report = async ({ p, me, req }) => {
  await rateLimit('report:' + me.id, 10, 3600);
  const id = idOf(p.id);
  const reason = str(p.reason, 200);
  if (!reason) throw new Bad('理由を入力してください。');
  await q('INSERT INTO kg_reports(user_id, post_id, reason) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [me.id, id, reason]);
  log('report', me.id, ipHash(req), 'post=' + id);
  return { ok: true };
};

A.reportDesk = async ({ p, me, req }) => {
  await rateLimit('report:' + me.id, 10, 3600);
  const id = idOf(p.id);
  const reason = str(p.reason, 200);
  if (!reason) throw new Bad('理由を入力してください。');
  if (!(await q('SELECT 1 FROM kg_desks WHERE id=$1 AND hidden=false', [id])).rows[0]) throw new Bad('窓口が見つかりません。', 404);
  await q('INSERT INTO kg_desk_reports(user_id, desk_id, reason) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [me.id, id, reason]);
  log('report_desk', me.id, ipHash(req), 'desk=' + id);
  return { ok: true };
};

// 管理者（環境変数 KG_ADMINS に書いたユーザーIDだけ）
const adminOnly = (me) => { if (!me || !ADMINS.includes(me.handle)) throw new Bad('権限がありません。', 403); };
A.adminReports = async ({ me }) => {
  adminOnly(me);
  const r = await q(
    `SELECT p.id, p.body, p.hidden, u.handle, count(*)::int AS n, array_agg(r.reason) AS reasons
     FROM kg_reports r JOIN kg_posts p ON p.id = r.post_id JOIN kg_users u ON u.id = p.user_id
     GROUP BY p.id, u.handle ORDER BY max(r.created_at) DESC LIMIT 100`);
  const d = await q(
    `SELECT d.id, d.type, d.name, d.country, d.posts, d.hidden, count(*)::int AS n, array_agg(r.reason) AS reasons
     FROM kg_desk_reports r JOIN kg_desks d ON d.id = r.desk_id
     GROUP BY d.id ORDER BY max(r.created_at) DESC LIMIT 100`);
  return { reports: r.rows.map((x) => ({ ...x, id: Number(x.id) })), desks: d.rows.map((x) => ({ ...x, id: Number(x.id) })) };
};
// 窓口を非表示にすると、一覧・検索・統計から消え、投稿に付いた窓口名も表示されなくなる（投稿そのものは残る）
A.adminHideDesk = async ({ p, me, req }) => {
  adminOnly(me);
  await q('UPDATE kg_desks SET hidden = $2 WHERE id = $1', [idOf(p.id), !!p.hidden]);
  log('admin_hide_desk', me.id, ipHash(req), `desk=${p.id} hidden=${!!p.hidden}`);
  return { ok: true };
};
A.adminHide = async ({ p, me, req }) => {
  adminOnly(me);
  await q('UPDATE kg_posts SET hidden = $2 WHERE id = $1', [idOf(p.id), !!p.hidden]);
  log('admin_hide', me.id, ipHash(req), `post=${p.id} hidden=${!!p.hidden}`);
  return { ok: true };
};

// ---------- 統計（世論の集計） ----------
A.stats = async ({ p }) => {
  const c = countryOf(p.country || 'ALL', true);
  const days = [7, 30, 90, 0].includes(Number(p.days)) ? Number(p.days) : 30;
  const params = [];
  const add = (v) => { params.push(v); return '$' + params.length; };
  const w = ['p.hidden = false'];
  if (c !== 'ALL') w.push(`p.country = ${add(c)}`);
  if (days) w.push(`p.created_at > now() - make_interval(days => ${add(days)})`);
  if (p.desk) w.push(`p.desk_id = ${add(idOf(p.desk))}`);
  if (p.deskType) w.push(`p.desk_type = ${add(oneOf(p.deskType, KG.DESK_TYPES))}`);
  const wNoTopic = w.join(' AND ');
  if (p.topic) w.push(`p.topic = ${add(oneOf(p.topic, KG.TOPICS))}`);
  const W = w.join(' AND ');
  const paramsNoTopic = params.slice(0, p.topic ? -1 : undefined);
  // 「1人1票」換算：同じ人が何度投稿しても、分野ごとに最新の立場を1回だけ数える
  const LATEST_STANCE = `WITH l AS (SELECT DISTINCT ON (p.user_id, p.topic) p.user_id, p.topic, p.stance
    FROM kg_posts p WHERE ${W} AND p.stance IS NOT NULL ORDER BY p.user_id, p.topic, p.id DESC)`;
  const LATEST_SAT = `WITH l AS (SELECT DISTINCT ON (p.user_id) p.user_id, p.sat
    FROM kg_posts p WHERE ${W} AND p.sat IS NOT NULL ORDER BY p.user_id, p.id DESC)`;
  const [tot, byDay, byKind, topicCount, topicStance, emo, sat, stDemo, demo, tags, props, countries, deskTypes, desks] = await Promise.all([
    q(`SELECT count(*)::int AS posts, count(DISTINCT p.user_id)::int AS users,
         count(*) FILTER (WHERE p.created_at > now() - interval '24 hours')::int AS today FROM kg_posts p WHERE ${W}`, params),
    q(`SELECT to_char(p.created_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') AS d, count(*)::int AS n FROM kg_posts p
       WHERE ${W} AND p.created_at > now() - interval '90 days' GROUP BY 1 ORDER BY 1`, params),
    q(`SELECT p.kind AS k, count(*)::int AS n FROM kg_posts p WHERE ${W} GROUP BY 1`, params),
    q(`SELECT p.topic AS k, count(*)::int AS n FROM kg_posts p WHERE ${wNoTopic} GROUP BY 1`, paramsNoTopic),
    q(`${LATEST_STANCE} SELECT topic, stance, count(*)::int AS n FROM l GROUP BY 1, 2`, params),
    q(`SELECT p.emotion AS k, count(*)::int AS n FROM kg_posts p WHERE ${W} AND p.emotion IS NOT NULL GROUP BY 1`, params),
    q(`${LATEST_SAT} SELECT l.sat, u.age, u.area, count(*)::int AS n FROM l JOIN kg_users u ON u.id = l.user_id GROUP BY 1, 2, 3`, params),
    q(`${LATEST_STANCE} SELECT u.age, u.gender, l.stance, count(*)::int AS n FROM l JOIN kg_users u ON u.id = l.user_id GROUP BY 1, 2, 3`, params),
    q(`SELECT u.age, u.gender, u.area, count(*)::int AS n FROM (SELECT DISTINCT p.user_id FROM kg_posts p WHERE ${W}) d
       JOIN kg_users u ON u.id = d.user_id GROUP BY 1, 2, 3`, params),
    q(`SELECT t.tag, count(*)::int AS n FROM kg_tags t JOIN kg_posts p ON p.id = t.post_id WHERE ${W} GROUP BY 1 ORDER BY n DESC, t.tag LIMIT 15`, params),
    q(`SELECT p.id, p.body, p.topic, p.agrees, p.disagrees, u.handle FROM kg_posts p JOIN kg_users u ON u.id = p.user_id
       WHERE ${W} AND p.kind = 'proposal' AND p.parent_id IS NULL ORDER BY (p.agrees - p.disagrees) DESC, p.agrees DESC, p.id DESC LIMIT 10`, params),
    q(`SELECT p.country AS k, count(*)::int AS n, count(DISTINCT p.user_id)::int AS users FROM kg_posts p
       WHERE p.hidden = false ${days ? `AND p.created_at > now() - make_interval(days => $1)` : ''} GROUP BY 1 ORDER BY n DESC LIMIT 15`, days ? [days] : []),
    q(`SELECT p.desk_type AS k, count(*)::int AS n FROM kg_posts p WHERE ${W} AND p.parent_id IS NULL GROUP BY 1`, params),
    q(`SELECT d.id, d.type, d.name, d.country, count(*)::int AS n, count(DISTINCT p.user_id)::int AS users
       FROM kg_posts p JOIN kg_desks d ON d.id = p.desk_id WHERE ${W} AND p.parent_id IS NULL AND d.hidden = false GROUP BY d.id ORDER BY n DESC, d.id LIMIT 15`, params),
  ]);
  return KG.buildStats({
    totals: tot.rows[0], byDay: byDay.rows, byKind: byKind.rows, topicCount: topicCount.rows, topicStance: topicStance.rows,
    emotions: emo.rows, sat: sat.rows, stanceDemo: stDemo.rows, demo: demo.rows, tags: tags.rows,
    proposals: props.rows.map((x) => ({ id: Number(x.id), body: x.body.slice(0, 120), topic: x.topic, agrees: x.agrees, disagrees: x.disagrees, handle: x.handle })),
    countries: countries.rows, deskTypes: deskTypes.rows, desks: desks.rows.map((x) => ({ ...x, id: Number(x.id) })),
  });
};

const NEED_LOGIN = new Set(['updateProfile', 'changePassword', 'deleteAccount', 'post', 'deletePost', 'react', 'vote', 'follow', 'notifications', 'report', 'reportDesk', 'adminReports', 'adminHide', 'adminHideDesk']);
const CACHEABLE_GET = new Set(['stats', 'trends']); // 誰が見ても同じ集計は CDN に短時間キャッシュ（DB負荷と費用を抑える）

async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  try {
    let p;
    if (req.method === 'GET') {
      p = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
      if (!CACHEABLE_GET.has(p.action)) throw new Bad('この操作はできません。', 405);
    } else if (req.method === 'POST') {
      // 他サイトからの勝手な操作（CSRF）を防ぐ：同じサイトからの JSON だけ受け付ける
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) throw new Bad('不正なリクエストです。', 403);
      if (!/^application\/json/.test(req.headers['content-type'] || '')) throw new Bad('不正なリクエストです。', 415);
      p = typeof req.body === 'object' && req.body ? req.body : {};
    } else throw new Bad('この操作はできません。', 405);

    const fn = Object.prototype.hasOwnProperty.call(A, p.action) ? A[p.action] : null;
    if (!fn) throw new Bad('この操作はできません。', 404);
    if (!DB_URL) return res.status(503).json({ error: 'データベースが未設定です。', code: 'NO_DB' });
    await init();
    const me = req.method === 'POST' ? await currentUser(req) : null;
    if (NEED_LOGIN.has(p.action) && !me) throw new Bad('ログインが必要です。', 401);
    if (!me) await rateLimit('ip:' + ipHash(req), 300, 300);
    const out = await fn({ p, me, req, res });
    if (req.method === 'GET') res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
    res.status(200).json(out);
  } catch (e) {
    if (e instanceof Bad) return res.status(e.status).json({ error: e.message });
    console.error('[voices] error', e); // 詳細はサーバーのログにだけ残し、利用者には出さない
    res.status(500).json({ error: 'サーバーでエラーが起きました。時間をおいてもう一度お試しください。' });
  }
}

module.exports = handler;
