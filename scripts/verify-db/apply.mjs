// 検証用 Supabase（saiten-verify）に、マイグレーションを1ファイルずつ安全に適用する（本番には使えない）。
//
//   node scripts/verify-db/apply.mjs --check
//       読み取りだけ。接続先・現在の状態（どの番号まで適用済みか）・CLI の移行履歴を表示する
//   node scripts/verify-db/apply.mjs --apply --to 0014 --confirm-ref cpfhsxbmzoyrlkynveqd
//   node scripts/verify-db/apply.mjs --apply --to latest --confirm-ref cpfhsxbmzoyrlkynveqd --at 0019
//       指紋だけでは「いまの番号」が決まらないとき（記録が無い DB）に、起点の番号を人が指定する（指紋と合わなければ止まる）
//       次の番号から --to まで、番号順に1ファイルずつ適用する（--to latest は最後の番号まで。GitHub Actions の自動適用が使う）
//
// 接続（どちらか）
//   既定：Supabase Management API（HTTPS）。SQL Editor と同じ経路でファイルの中身をそのまま送る
//     環境変数 SUPABASE_ACCESS_TOKEN（個人のアクセストークン。画面・ログには出さない）
//   テスト用：VERIFY_DB_TEST_URL（手元の PostgreSQL。psql で実行する。開発者の検証用）
//
// 安全のための決まり（docs/DB-RUNBOOK.md 第1部）
//   - 接続先は TARGET_REF（saiten-verify）だけ。別の ref は、トークンがあっても断る。API では名前とリージョンも確かめる
//   - 適用の前に、DB の状態が「直前の番号まで適用済み」と完全に一致すること（supabase/runbook/verify-expected.json）を確かめる。
//     一致しなければ何もせずに止まる（適用済みの SQL を再実行しない・自動でやり直さない・データを消さない）
//   - 各ファイルは中身をそのまま1回で送る（ファイルの begin;/commit; で1つのトランザクション）。エラーなら止まる
//   - 適用の後、期待した状態と一致しなければ止まる。0014 の後は、Data API の権限が本番と同じか（acl-expected.txt）も確かめる
//   - CLI の移行履歴（supabase_migrations.schema_migrations）は読むだけで、書き換えない（db push は使わない）
//   - 適用した番号を、検証用 DB の verify_ledger.applied に記録する（public の外。アプリ・指紋には関係しない）。
//     指紋は名前の一覧なので、名前を変えないマイグレーション（例 0020）は前の番号と同じ指紋になる。
//     そのときは記録で決め、記録が無ければ止まる（手動で --at <いまの番号> を指定したときだけ、その番号を起点として記録して進む）
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const TARGET_REF = "cpfhsxbmzoyrlkynveqd";
const TARGET_NAME = "saiten-verify";
const TARGET_REGION = "ap-northeast-1";
const ROOT = new URL("../../", import.meta.url).pathname;
// 別のフォルダのマイグレーションは、手元のテスト（VERIFY_DB_TEST_URL）のときだけ使える（途中のエラーを再現するため）
const MIG = process.env.VERIFY_DB_TEST_URL && process.env.VERIFY_DB_MIGRATIONS ? process.env.VERIFY_DB_MIGRATIONS.replace(/\/?$/, "/") : ROOT + "supabase/migrations/";
const EXPECTED = JSON.parse(readFileSync(ROOT + "supabase/runbook/verify-expected.json", "utf8"));
const ACL_EXPECTED = readFileSync(ROOT + "supabase/runbook/acl-expected.txt", "utf8").trim();
const ACL_SQL = readFileSync(ROOT + "supabase/runbook/acl-snapshot.sql", "utf8");

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const APPLY = args.includes("--apply");
const TO_ARG = arg("--to") ?? "0014";
const TO = TO_ARG === "latest" ? readdirSync(MIG).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort().at(-1).slice(0, 4) : TO_ARG;
const TEST_URL = process.env.VERIFY_DB_TEST_URL ?? "";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? "";

const stop = (msg) => { console.log(`✗ 停止：${msg}`); process.exit(1); };
const hide = (s) => String(s).replaceAll(TOKEN || "\u0000", "***").replace(/sbp_[A-Za-z0-9]+/g, "sbp_***");

// ---------------------------------------------------------------- 接続
async function api(path, init = {}) {
  const res = await fetch(`https://api.supabase.com/v1${path}`, {
    ...init, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}：${hide(text).slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}
/** SQL を1回で送る（ファイルの中身もそのまま）。最後の文の結果の行を返す */
async function runSql(sql) {
  if (TEST_URL) {
    const out = execFileSync("psql", [TEST_URL, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return out.trim().split("\n").filter(Boolean);
  }
  return api(`/projects/${TARGET_REF}/database/query`, { method: "POST", body: JSON.stringify({ query: sql }) });
}
/** 1行1列の JSON を返す読み取り */
async function readJson(sql) {
  if (TEST_URL) {
    const lines = await runSql(`select (${sql})::text`);
    return JSON.parse(lines.at(-1));
  }
  const rows = await runSql(`select (${sql}) as r`);
  const r = rows?.[0]?.r;
  return typeof r === "string" ? JSON.parse(r) : r;   // 返し方の違いに備える（違えば下の比較で止まる）
}

// ---------------------------------------------------------------- 状態の指紋（public の表・ビュー・関数・ポリシー・トリガー・列）
const FINGERPRINT = readFileSync(ROOT + "supabase/runbook/fingerprint.sql", "utf8").replace(/^--.*$/gm, "").trim().replace(/;$/, "");

function diff(actual, expected) {
  const out = [];
  for (const k of Object.keys(expected)) {
    const a = actual[k], e = expected[k];
    if (Array.isArray(e)) {
      const plus = a.filter((x) => !e.includes(x)), minus = e.filter((x) => !a.includes(x));
      if (plus.length || minus.length) out.push(`${k}: 余分 [${plus.join(", ")}] / 不足 [${minus.join(", ")}]`);
    } else if (a !== e) out.push(`${k}: ${a}（期待 ${e}）`);
  }
  return out;
}
// ---------------------------------------------------------------- 適用の記録（verify_ledger.applied。検証用 DB だけ）
const LEDGER_DDL = `create schema if not exists verify_ledger;
revoke all on schema verify_ledger from public;
create table if not exists verify_ledger.applied (version text primary key, applied_at timestamptz not null default now(), how text not null);`;
async function ledgerMax() {
  const has = await readJson(`to_json(to_regclass('verify_ledger.applied') is not null)`);
  return has ? await readJson(`(select to_json(max(version)) from verify_ledger.applied)`) : null;
}
async function ledgerAdd(version, how) {
  await runSql(`${LEDGER_DDL}\ninsert into verify_ledger.applied(version, how) values ('${version}', '${how}') on conflict (version) do nothing;`);
}

/** いまの番号：指紋が一致する番号のうち、記録（無ければ --at）で1つに決める。決まらなければ止める */
async function currentStep() {
  const fp = await readJson(FINGERPRINT);
  const cands = Object.keys(EXPECTED).filter((n) => diff(fp, EXPECTED[n]).length === 0);
  if (!cands.length) return { fp, hit: null, cands };
  const led = await ledgerMax();
  if (led) {
    if (!cands.includes(led)) stop(`適用の記録（${led}）と DB の状態（${cands.join("・")} の適用後と一致）が合いません`);
    return { fp, hit: led, cands, how: "記録" };
  }
  const at = arg("--at");
  if (at) {
    if (!cands.includes(at)) stop(`--at ${at} は DB の状態と合いません（一致するのは ${cands.join("・")} の適用後）`);
    return { fp, hit: at, cands, how: "--at", record: true };
  }
  if (cands.length > 1) stop(`DB の状態が ${cands.join("・")} の適用後と同じで、どこまで適用済みか決められません（適用の記録がありません）。` +
    `いまの番号を確かめて --at <番号> を付けて実行してください（GitHub Actions：verify-db → Run workflow の at）`);
  return { fp, hit: cands[0], cands, how: "指紋", record: true };
}

// ---------------------------------------------------------------- 本体
async function main() {
  console.log("検証用 DB への適用（本番には使えません）");
  if (!TEST_URL) {
    if (!TOKEN) stop("環境変数 SUPABASE_ACCESS_TOKEN がありません（docs/DB-RUNBOOK.md の 1-2b）");
    const p = await api(`/projects/${TARGET_REF}`);
    if (p.id !== TARGET_REF && p.ref !== TARGET_REF) stop("プロジェクトの ref が一致しません");
    if (p.name !== TARGET_NAME || p.region !== TARGET_REGION) stop(`接続先が検証用ではありません（名前 ${p.name}・リージョン ${p.region}）`);
    console.log(`✓ 接続先：${p.name}（ref ${TARGET_REF}・${p.region}）`);
  } else {
    console.log("（テスト：手元の PostgreSQL に接続）");
  }

  // 表が無いときに参照すると構文解析の時点でエラーになるので、先に有無だけを見る
  const hasHist = await readJson(`to_json(to_regclass('supabase_migrations.schema_migrations') is not null)`);
  const hist = hasHist ? await readJson(`(select coalesce(json_agg(version order by version), '[]') from supabase_migrations.schema_migrations)`) : null;
  console.log(`  CLI の移行履歴：${hist === null ? "表が無い（SQL Editor で適用したため。db push は使わない）" : JSON.stringify(hist)}（書き換えません）`);

  let { fp, hit, how, record } = await currentStep();
  if (!hit) stop(`DB の状態が、どの番号の適用後とも一致しません。\n  直前と思われる 0007 との違い：${diff(fp, EXPECTED["0007"]).join(" / ") || "なし"}`);
  console.log(`✓ 現在の状態：${hit} まで適用済みと一致（決め方：${how}・表 ${fp.tables.length}・ビュー ${fp.views.length}・関数 ${fp.functions.length}・RLS 無効の表 ${fp.rls_off.length}）`);
  // 起点を記録する（読み取りだけの --check では書かない）
  if (APPLY && record && arg("--confirm-ref") === TARGET_REF) await ledgerAdd(hit, how);

  const files = readdirSync(MIG).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  const todo = files.filter((f) => f.slice(0, 4) > hit && f.slice(0, 4) <= TO);
  if (!APPLY) { console.log(`\n読み取りだけで終わりました。次に適用するファイル：${todo.join(", ") || "なし"}`); return; }
  if (arg("--confirm-ref") !== TARGET_REF) stop(`適用するには --confirm-ref ${TARGET_REF} を付けてください`);
  if (!todo.length) { console.log("適用するファイルはありません"); return; }
  const noExp = todo.filter((f) => !EXPECTED[f.slice(0, 4)]);
  if (noExp.length) stop(`${noExp.join(", ")} の適用後の期待の状態が verify-expected.json にありません（開発側で bash supabase/tests/verify_db_test.sh --write-expected を実行してから）`);

  for (const f of todo) {
    const n = f.slice(0, 4);
    const prev = Object.keys(EXPECTED).filter((k) => k < n).at(-1);
    // 適用の前：直前の番号の状態と完全に一致すること（適用済みのファイルを再実行しない）
    const before = await readJson(FINGERPRINT);
    const d0 = diff(before, EXPECTED[prev]);
    if (d0.length) stop(`${f} の適用前の状態が ${prev} の適用後と一致しません：${d0.join(" / ")}`);
    const sql = readFileSync(MIG + f, "utf8");
    if (!/^begin;$/m.test(sql) || !/^commit;$/m.test(sql)) stop(`${f} に begin;/commit; がありません（1つのトランザクションで送れない）`);
    console.log(`\n== ${f} を適用`);
    try { await runSql(sql); } catch (e) { stop(`${f} の実行でエラー（ファイルのトランザクションにより、このファイルの変更は残りません）：${hide(e.stderr ?? e.message).slice(0, 800)}`); }
    await ledgerAdd(n, "適用");
    // 適用の後：期待した状態と一致すること
    const after = await readJson(FINGERPRINT);
    const d1 = diff(after, EXPECTED[n]);
    if (d1.length) stop(`${f} の適用後の状態が期待と違います：${d1.join(" / ")}`);
    console.log(`✓ ${f}：適用後の状態が期待と一致（表 ${after.tables.length}・ビュー ${after.views.length}・関数 ${after.functions.length}・ポリシー ${after.policies_public}・トリガー ${after.triggers.length}）`);
    if (n === "0014") {
      const acl = (TEST_URL ? (await runSql(ACL_SQL.replace(/;\s*$/, "")))
        : (await runSql(ACL_SQL)).map((r) => `${r.kind} ${r.name} ${r.grantee} ${r.privilege_type}`))
        .map((l) => l.replaceAll("|", " ").trim()).filter(Boolean).sort().join("\n");
      // 並び順は照合順序で変わるので、並べ替えてから比べる
      if (acl !== ACL_EXPECTED.split("\n").map((l) => l.trim()).sort().join("\n")) {
        const a = new Set(acl.split("\n")), e = new Set(ACL_EXPECTED.split("\n"));
        stop(`0014 の後の Data API の権限が本番と同じになっていません。余分 ${[...a].filter((x) => !e.has(x)).slice(0, 5).join(" ; ")} / 不足 ${[...e].filter((x) => !a.has(x)).slice(0, 5).join(" ; ")}`);
      }
      console.log(`✓ 0014：Data API の権限が、自動で公開がオンの環境と同じ（${ACL_EXPECTED.split("\n").length} 件）`);
    }
  }
  console.log(`\n完了：${todo.map((f) => f.slice(0, 4)).join("・")} を適用し、すべての確認が期待と一致しました。`);
}

main().catch((e) => stop(hide(e?.message ?? e)));
