// アクセス制限の画面・API のテスト（2026-10-29。docs/APPSTORE-PRECHECK.md 1。tests/e2e-lite/run.sh から ver6.mjs の後に呼ぶ）
//   架空の学校X・学校Y、先生、生徒アカウント2人で、一覧の画面だけでなく、直接の URL・アプリの API・画像の取得・
//   Supabase の入り口（REST・Storage）を本人のトークンで直接たたいても、他校・他の生徒のものが取れないことを確かめる。
//   RLS・暗号化は外さない（アプリは IMAGE_ENC_PROVIDER=local で、写真を暗号化して保存する）。service_role での迂回はしない
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import zlib from "node:zlib";

const BASE = process.env.V6_URL, PG = process.env.PG_URL, GW = process.env.GATEWAY_URL, MOCK = process.env.MOCK_URL;
const ok = (cond, msg) => { if (!cond) { console.log("✗ FAIL:", msg); throw new Error(msg); } console.log("✓", msg); };
const sql = (q) => execFileSync("psql", [PG, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();
const X = "acce55ed-0000-0000-0000-00000000000a", Y = "acce55ed-0000-0000-0000-00000000000b";
const id = (school, tail) => `acce55ed-0000-0000-000${school.slice(-1)}-${tail}`;   // 例：id(X, "0000000000c1")（学校ごとに別の ID）
const PW = "pass-lite-123";
const path = (school, sub, n = 1) => `${school}/${id(school, "0000000000e1")}/${sub}/${n}.png`;
const SUB_X1 = id(X, "000000000051"), SUB_X2 = id(X, "000000000052"), SUB_Y1 = id(Y, "000000000051");

// ---------------------------------------------------------------- 初期データ（架空。実名は持たない）
sql(`insert into public.schools (id, name, code) values ('${X}', '点検用X校（架空）', 'ACC-X'), ('${Y}', '点検用Y校（架空）', 'ACC-Y');
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values
 ('${id(X, "0000000000a1")}', 'acc-x-teacher@lite.example', now(), '{"school_id":"${X}","role":"teacher"}'),
 ('${id(Y, "0000000000a1")}', 'acc-y-teacher@lite.example', now(), '{"school_id":"${Y}","role":"teacher"}'),
 ('${id(X, "0000000000b1")}', 'acc-x-stu1@lite.example', now(), '{}'),
 ('${id(X, "0000000000b2")}', 'acc-x-stu2@lite.example', now(), '{}');
insert into public.classes (id, school_id, grade, name, school_year) values ('${id(X, "0000000000c1")}', '${X}', 1, 'X1', 2026), ('${id(Y, "0000000000c1")}', '${Y}', 1, 'Y1', 2026);
insert into public.students (id, school_id, class_id, number, exam_no, anon_id) values
 ('${id(X, "0000000000d1")}', '${X}', '${id(X, "0000000000c1")}', 1, 'AX01', 'AX01'),
 ('${id(X, "0000000000d2")}', '${X}', '${id(X, "0000000000c1")}', 2, 'AX02', 'AX02'),
 ('${id(Y, "0000000000d1")}', '${Y}', '${id(Y, "0000000000c1")}', 1, 'AY01', 'AY01');
insert into public.student_accounts (student_id, user_id, school_id) values
 ('${id(X, "0000000000d1")}', '${id(X, "0000000000b1")}', '${X}'), ('${id(X, "0000000000d2")}', '${id(X, "0000000000b2")}', '${X}');
insert into public.tests (id, school_id, name, subject, grade, max_score) values
 ('${id(X, "0000000000e1")}', '${X}', 'X校の小テスト', '数学', 1, 10), ('${id(Y, "0000000000e1")}', '${Y}', 'Y校の秘密テスト', '数学', 1, 10);
insert into public.questions (id, school_id, test_id, no, label, qtype, unit, points, correct) values
 ('${id(X, "0000000000f1")}', '${X}', '${id(X, "0000000000e1")}', 1, '1', 'calc', '', 10, '5'),
 ('${id(Y, "0000000000f1")}', '${Y}', '${id(Y, "0000000000e1")}', 1, '1', 'calc', '', 10, 'Y-SECRET');
insert into public.submissions (id, school_id, test_id, student_id, class_id, status, progress, image_paths) values
 ('${SUB_X1}', '${X}', '${id(X, "0000000000e1")}', '${id(X, "0000000000d1")}', '${id(X, "0000000000c1")}', 'done', 100, array['${path(X, SUB_X1)}']),
 ('${SUB_X2}', '${X}', '${id(X, "0000000000e1")}', '${id(X, "0000000000d2")}', '${id(X, "0000000000c1")}', 'done', 100, array['${path(X, SUB_X2)}']),
 ('${SUB_Y1}', '${Y}', '${id(Y, "0000000000e1")}', '${id(Y, "0000000000d1")}', '${id(Y, "0000000000c1")}', 'uploaded', 0, array['${path(Y, SUB_Y1)}']);
insert into public.submission_items (school_id, submission_id, question_id, qno, mark, earned, need_review) values
 ('${X}', '${SUB_X1}', '${id(X, "0000000000f1")}', 1, '○', 10, false), ('${X}', '${SUB_X2}', '${id(X, "0000000000f1")}', 1, '×', 0, false);`);

// 写真の代わり（PNG。学校・答案ごとに模様を変える）
function pngOf(shade) {
  const w = 200, h = 260;
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 0;
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = (x * 3 + y + shade) % 256;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const IMG = { [path(X, SUB_X1)]: pngOf(11), [path(X, SUB_X2)]: pngOf(22), [path(Y, SUB_Y1)]: pngOf(33) };

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } });
const errors = [];
async function session(email, where = "/login") {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[${email}] ${e.message}`));
  if (email) {
    await page.goto(BASE + where);
    await page.getByLabel(where === "/student" ? "メール" : "メールアドレス").fill(email);
    await page.getByLabel("パスワード").fill(PW);
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    if (where === "/login") await page.waitForURL(BASE + "/"); else await page.getByTestId("inbox").waitFor();
  } else await page.goto(BASE + "/start");
  return { ctx, page };
}
// 同じサイトのページの中から API を呼ぶ（ブラウザと同じ Cookie・Origin）
const getImage = (page, p) => page.evaluate(async (u) => {
  const r = await fetch(u, { redirect: "manual" });
  const b = new Uint8Array(await r.arrayBuffer());
  return { status: r.status, type: r.headers.get("content-type"), head: Array.from(b.slice(0, 8)), len: b.length, csp: r.headers.get("content-security-policy"), disp: r.headers.get("content-disposition") };
}, `/api/image?path=${encodeURIComponent(p)}`);
const upload = (page, p, bytes, type = "image/png") => page.evaluate(async ([pp, b64, t]) => {
  const fd = new FormData();
  fd.append("path", pp);
  fd.append("file", new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: t }), "f");
  const r = await fetch("/api/image/upload", { method: "POST", body: fd, redirect: "manual" });
  return { status: r.status, json: await r.json().catch(() => null) };
}, [p, Buffer.from(bytes).toString("base64"), type]);
const post = (page, u, body) => page.evaluate(async ([uu, b]) => {
  const r = await fetch(uu, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b), redirect: "manual" });
  return { status: r.status, text: (await r.text()).slice(0, 400) };
}, [u, body]);
const samePng = (r, p) => r.status === 200 && r.type === "image/png" && r.len === IMG[p].length;
// Supabase の入り口に、本人のトークンで直接（アプリを通さずに）
async function tokenOf(email) {
  const r = await fetch(`${GW}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PW }) });
  return (await r.json()).access_token;
}
const rest = async (token, p, init = {}) => {
  const r = await fetch(`${GW}/rest/v1/${p}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers ?? {}) } });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const storageGet = async (token, p) => (await fetch(`${GW}/storage/v1/object/answer-sheets/${p}`, { headers: { authorization: `Bearer ${token}` } })).status;

// ---------------------------------------------------------------- 準備：両校の先生が、自校の答案の写真を画面と同じ API で保存（暗号化される）
const tx = await session("acc-x-teacher@lite.example");
const ty = await session("acc-y-teacher@lite.example");
for (const p of [path(X, SUB_X1), path(X, SUB_X2)]) ok((await upload(tx.page, p, IMG[p])).status === 200, `学校Xの先生は自校の写真を保存できる（${p.split("/")[2].slice(-2)}）`);
ok((await upload(ty.page, path(Y, SUB_Y1), IMG[path(Y, SUB_Y1)])).status === 200, "学校Yの先生は自校の写真を保存できる");
const objects = async () => Object.fromEntries((await (await fetch(`${GW}/__objects`)).json()).map((o) => [o.path, o.head]));
ok((await objects())[path(Y, SUB_Y1)] === "TSE1", "保存先には暗号文だけが置かれる（先頭 TSE1）");
// 学校Xの先生が確認して、生徒それぞれに返却（本物の関数）
for (const s of [SUB_X1, SUB_X2]) {
  sql(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${id(X, "0000000000a1")}","role":"authenticated"}', false);
       select public.mark_submission_reviewed('${s}'); select public.publish_submission_result('${s}');`);
}

// ---------------------------------------------------------------- 1. 未ログイン
{
  const anon = await session(null);
  for (const u of ["/", `/history/${SUB_X1}`, "/scores", "/settings"]) {
    const r = await anon.page.goto(BASE + u);
    ok(new URL(anon.page.url()).pathname === "/login" && r.ok(), `未ログイン：${u} はログイン画面に送られる`);
  }
  const img = await getImage(anon.page, path(X, SUB_X1));
  ok(img.status !== 200 && img.type !== "image/png", `未ログイン：画像の API は画像を返さない（${img.status}）`);
  const up = await upload(anon.page, path(X, SUB_X1), pngOf(99));
  ok(up.status !== 200, `未ログイン：画像を保存できない（${up.status}）`);
  for (const [u, b] of [["/api/grade", { submissionId: SUB_X1, mode: "cascade", requestId: crypto.randomUUID() }], ["/api/image/migrate", { offset: 0 }], ["/api/test-import", { requestId: crypto.randomUUID() }], ["/api/intake", {}]]) {
    const r = await post(anon.page, u, b);
    ok(r.status !== 200, `未ログイン：${u} は受け付けない（${r.status}）`);
  }
  const anonKey = process.env.ANON_JWT;   // ログインしていないブラウザは、公開の anon キーだけで来る
  const rs = await rest(anonKey, "submissions?select=id");
  ok(rs.status !== 200 || (Array.isArray(rs.body) && rs.body.length === 0), "未ログイン：REST で答案を読めない");
  const rr = await rest(anonKey, "result_releases?select=id");
  ok(rr.status !== 200 || (Array.isArray(rr.body) && rr.body.length === 0), "未ログイン：REST で返却を読めない");
  await anon.ctx.close();
}

// ---------------------------------------------------------------- 2. 学校Xの先生 → 学校Y
{
  const p = tx.page;
  ok(samePng(await getImage(p, path(X, SUB_X1)), path(X, SUB_X1)), "学校Xの先生：自校の写真は復号されて元の画像で表示される");
  const other = await getImage(p, path(Y, SUB_Y1));
  ok(other.status === 404 && other.type !== "image/png", `学校Xの先生：学校Yの写真は画像の API で取れない（${other.status}）`);
  const over = await upload(p, path(Y, SUB_Y1), pngOf(98));
  ok(over.status === 403 && over.json?.code === "storage_denied", `学校Xの先生：学校Yのフォルダに保存できない（${over.status} ${over.json?.code}）。原因の種類が分かる`);
  ok((await objects())[path(Y, SUB_Y1)] === "TSE1" && samePng(await getImage(ty.page, path(Y, SUB_Y1)), path(Y, SUB_Y1)), "学校Yの写真は書き換わっていない");
  await p.goto(`${BASE}/history/${SUB_Y1}`);
  await p.waitForTimeout(1500);
  const body = await p.evaluate(() => document.body.innerText);
  ok(!body.includes("Y校の秘密テスト") && !body.includes("AY01"), "学校Xの先生：学校Yの答案の URL を直接開いても、学校Yの内容は出ない");
  const before = (await (await fetch(`${MOCK}/__requests`)).json()).length;
  const g = await post(p, "/api/grade", { submissionId: SUB_Y1, mode: "cascade", requestId: crypto.randomUUID() });
  const after = (await (await fetch(`${MOCK}/__requests`)).json()).length;
  ok(g.status !== 200 && after === before, `学校Xの先生：学校Yの答案を AI 採点に送れない（${g.status}・AI への要求 0件）`);
  ok(sql(`select status from public.submissions where id = '${SUB_Y1}'`) === "uploaded", "学校Yの答案の状態は変わっていない");
  const m = await post(p, "/api/image/migrate", { offset: 0 });
  ok(m.status === 403, `学校Xの先生（管理者でない）：以前の写真の暗号化（管理者用）を実行できない（${m.status}）`);
  // 入り口に直接（本人のトークン）
  const t = await tokenOf("acc-x-teacher@lite.example");
  const subs = await rest(t, "submissions?select=id,school_id");
  ok(subs.status === 200 && subs.body.length > 0 && subs.body.every((s) => s.school_id === X), "REST：学校Xの先生には自校の答案だけが返る");
  for (const tbl of ["submission_items", "questions", "tests", "students", "result_releases", "audit_logs"]) {
    const r = await rest(t, `${tbl}?select=school_id&school_id=eq.${Y}`);
    ok(r.status === 200 && r.body.length === 0, `REST：学校Yの ${tbl} は0件`);
  }
  const patch = await rest(t, `submissions?id=eq.${SUB_Y1}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) });
  ok(patch.body?.length === 0 && sql(`select status from public.submissions where id = '${SUB_Y1}'`) === "uploaded", "REST：学校Yの答案を書き換えられない");
  const del = await rest(t, `submissions?id=eq.${SUB_Y1}`, { method: "DELETE" });
  ok((del.body?.length ?? 0) === 0 && sql(`select count(*) from public.submissions where id = '${SUB_Y1}'`) === "1", "REST：学校Yの答案を消せない");
  const pub = await rest(t, "rpc/publish_submission_result", { method: "POST", body: JSON.stringify({ p_submission: SUB_Y1 }) });
  ok(pub.status >= 400, `REST：学校Yの答案を返却できない（${pub.status}）`);
  ok(await storageGet(t, path(Y, SUB_Y1)) === 400, "Storage：学校Yの写真を直接取れない");
  // 他校の画像のパス・ID を自校の答案に書き込んで返却させる手口（0024 で断る）
  const forge = await rest(t, `submissions?id=eq.${SUB_X2}`, { method: "PATCH", body: JSON.stringify({ image_paths: [path(Y, SUB_Y1)] }) });
  ok(forge.status >= 400 && sql(`select image_paths[1] from public.submissions where id = '${SUB_X2}'`) === path(X, SUB_X2), `REST：自校の答案に学校Yの画像のパスを書き込めない（${forge.status}）`);
  const forge2 = await rest(t, `submissions?id=eq.${SUB_X2}`, { method: "PATCH", body: JSON.stringify({ test_id: id(Y, "0000000000e1") }) });
  ok(forge2.status >= 400, `REST：自校の答案を学校Yのテストに付け替えられない（${forge2.status}）`);
  // 写真以外（HTML・SVG）は、写真として申告しても保存しない（同じサイトでスクリプトを動かさせない）
  const html = await upload(p, path(X, SUB_X1, 9), Buffer.from("<html><script>alert(1)</script></html>"), "image/png");
  ok(html.status === 415 && html.json?.code === "type_not_allowed", `HTML を写真として保存できない（${html.status}）`);
  const svg = await upload(p, path(X, SUB_X1, 8), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "image/svg+xml");
  ok(svg.status === 415, `SVG を保存できない（${svg.status}）`);
  // 2026-10-28 の不具合の再現：保存先の許可形式に application/octet-stream が無いと、暗号化した写真を保存できない。原因（415）が分かる表示になる
  const types = sql(`select array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'answer-sheets'`);
  sql(`update storage.buckets set allowed_mime_types = array_remove(allowed_mime_types, 'application/octet-stream') where id = 'answer-sheets'`);
  const noOctet = await upload(p, path(X, SUB_X1, 6), pngOf(96));
  sql(`update storage.buckets set allowed_mime_types = string_to_array('${types}', ',') where id = 'answer-sheets'`);
  ok(noOctet.status === 415 && noOctet.json?.code === "storage_type_not_allowed" && /許可形式/.test(noOctet.json?.error ?? ""),
    `許可形式の設定漏れは「権限が無い」ではなく、許可形式の問題として表示される（${noOctet.status} ${noOctet.json?.code}）`);
  ok(types.includes("application/octet-stream"), "マイグレーション（0024）で、許可形式に application/octet-stream が入っている");
  const shown = await getImage(p, path(X, SUB_X1));
  ok(/sandbox/.test(shown.csp ?? "") && shown.disp === "inline", "写真の表示には、スクリプトを動かさせない指定（CSP sandbox）が付く");
}

// ---------------------------------------------------------------- 3. 生徒どうし
{
  const s1 = await session("acc-x-stu1@lite.example", "/student");
  const s2 = await session("acc-x-stu2@lite.example", "/student");
  ok(samePng(await getImage(s1.page, path(X, SUB_X1)), path(X, SUB_X1)), "生徒1：自分に返却された答案の写真は見られる");
  const cross = await getImage(s1.page, path(X, SUB_X2));
  ok(cross.status === 404 && cross.type !== "image/png", `生徒1：生徒2の答案の写真は取れない（${cross.status}）`);
  ok((await getImage(s1.page, path(Y, SUB_Y1))).status === 404, "生徒1：他校の写真は取れない");
  ok(samePng(await getImage(s2.page, path(X, SUB_X2)), path(X, SUB_X2)) && (await getImage(s2.page, path(X, SUB_X1))).status === 404, "生徒2：自分の分だけ見られる");
  const inbox = await s1.page.getByTestId("inbox").innerText();
  ok(inbox.includes("X校の小テスト") && (await s1.page.getByTestId("inbox").locator("li").count()) === 1, "生徒1の受信箱は自分の返却1件だけ");
  const up = await upload(s1.page, path(X, SUB_X1, 7), pngOf(97));
  ok(up.status === 403, `生徒1：答案の写真を保存できない（${up.status}）`);
  const g = await post(s1.page, "/api/grade", { submissionId: SUB_X1, mode: "cascade", requestId: crypto.randomUUID() });
  ok(g.status !== 200, `生徒1：AI 採点の API を使えない（${g.status}）`);
  const t = await tokenOf("acc-x-stu1@lite.example");
  const rel = await rest(t, "result_releases?select=student_id,payload");
  ok(rel.status === 200 && rel.body.length === 1 && rel.body[0].student_id === id(X, "0000000000d1"), "REST：生徒1には自分の返却だけが返る");
  for (const tbl of ["submissions", "submission_items", "students", "questions", "tests"]) {
    const r = await rest(t, `${tbl}?select=id`);
    ok(r.status === 200 && r.body.length === 0, `REST：生徒は ${tbl}（先生用の表）を読めない`);
  }
  const patch = await rest(t, `result_releases?student_id=eq.${id(X, "0000000000d1")}`, { method: "PATCH", body: JSON.stringify({ payload: { total: 100 } }) });
  ok((patch.body?.length ?? 0) === 0, "REST：生徒は返却内容（点数）を書き換えられない");
  ok(await storageGet(t, path(X, SUB_X2)) === 400, "Storage：生徒1は生徒2の写真を直接取れない");
  await s1.ctx.close(); await s2.ctx.close();
}

// ---------------------------------------------------------------- 4. 先生の修正 → 合計点 → 確認 → 返却（docs/APPSTORE-PRECHECK.md 2）
{
  const p = tx.page;
  const stu2 = await session("acc-x-stu2@lite.example", "/student");
  const inbox2 = () => stu2.page.getByTestId("inbox").innerText();
  ok((await inbox2()).includes("間違えた問題 1 問"), "（前提）生徒2には ×（0点）で返却済み");
  await p.goto(`${BASE}/history/${SUB_X2}`);
  await p.getByRole("tab", { name: /設問別採点/ }).click();
  await p.getByRole("button", { name: "1 を ○ にする" }).click();
  await p.getByText("合計 10 / 10 点").waitFor();
  await p.getByText("コメントを追加する（クリック）").first().click();
  await p.getByPlaceholder("赤ペンコメント").fill("途中式もよく書けています");
  await p.getByRole("button", { name: "保存", exact: true }).first().click();
  await p.getByText("コメントを更新しました").waitFor();
  ok(sql(`select total_score || '|' || (reviewed_at is null) from public.submissions where id = '${SUB_X2}'`) === "10|true", "先生が判定を直すと合計点（DB）が 10 点になり、確認済みが外れる");
  ok(sql(`select comment from public.submission_items where submission_id = '${SUB_X2}'`) === "途中式もよく書けています", "コメントの修正が保存される");
  await p.reload();
  await p.getByRole("tab", { name: /設問別採点/ }).click();
  await p.getByText("合計 10 / 10 点").waitFor();
  ok(true, "開き直しても、修正した点数・合計点が出る");
  // 確認前は返却できない。生徒の画面も古いまま（未確認の修正は生徒に出ない）
  const t = await tokenOf("acc-x-teacher@lite.example");
  const early = await rest(t, "rpc/publish_submission_result", { method: "POST", body: JSON.stringify({ p_submission: SUB_X2 }) });
  ok(early.status >= 400 && /確認/.test(JSON.stringify(early.body)), `確認前は返却できない（${early.status}）`);
  await stu2.page.reload(); await stu2.page.getByTestId("inbox").waitFor();
  ok((await inbox2()).includes("間違えた問題 1 問") && !(await inbox2()).includes("第2版"), "確認前の修正は生徒に見えない（返却済みの ×・0点 のまま）");
  // 確認 → 返却 → 生徒本人にだけ新しい点数
  await p.getByRole("button", { name: "確認済みにする" }).click();
  await p.getByText("確認済みにしました").first().waitFor();
  const pub = await rest(t, "rpc/publish_submission_result", { method: "POST", body: JSON.stringify({ p_submission: SUB_X2 }) });
  ok(pub.status === 200 && pub.body === 1, "確認後は返却できる（版が上がる）");
  await stu2.page.reload(); await stu2.page.getByTestId("inbox").waitFor();
  ok((await inbox2()).includes("間違えた問題 0 問") && (await inbox2()).includes("第2版"), "返却後、生徒2の受信箱に更新（第2版・間違い 0問）が出る");
  await stu2.page.getByTestId("inbox").getByText("X校の小テスト").click();
  await stu2.page.getByText("X校の小テスト：10／10点").waitFor();
  ok(true, "生徒2が開くと新しい点数（10／10点）が出る");
  const s1 = await session("acc-x-stu1@lite.example", "/student");
  const s1rel = await rest(await tokenOf("acc-x-stu1@lite.example"), "result_releases?select=student_id");
  ok(s1rel.body.length === 1 && s1rel.body[0].student_id === id(X, "0000000000d1") && !(await s1.page.getByTestId("inbox").innerText()).includes("第2版"),
    "生徒1には生徒2の返却は見えない（返却後も）");
  await s1.ctx.close(); await stu2.ctx.close();
}

ok(errors.length === 0, `画面のエラーなし${errors.length ? "：" + errors.slice(0, 3).join(" / ") : ""}`);
await tx.ctx.close(); await ty.ctx.close();
await browser.close();
console.log("✓ アクセス制限（未ログイン・学校間・生徒間・直接の URL / API / 画像 / REST / Storage）");
