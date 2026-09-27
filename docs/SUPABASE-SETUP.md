# テスト採点ver.3 — Supabase 接続手順

上から順に実行してください。所要 30〜40 分です。
各ステップの終わりに「ここまでで確認できること」を書いています。そこが通ってから次へ進んでください。

---

## ステップ1　Supabase プロジェクトを作る

1. https://supabase.com にログインします。
2. 「New project」を押します。
3. 次のように入力します。
   - **Name**：`test-saiten-v3`
   - **Database Password**：自動生成して、**必ず手元に控えます**（あとから見られません）
   - **Region**：`Northeast Asia (Tokyo)`
4. 「Create new project」を押し、2〜3分待ちます。

**ここまでで確認できること**：ダッシュボード左上にプロジェクト名が表示される。

---

## ステップ2　スキーマを流し込む

1. 左メニューの **SQL Editor** を開きます。
2. 「New query」を押します。
3. `supabase/migrations/0001_init.sql` の中身を**全部**貼り付けます。
4. 右下の **Run** を押します。
5. 同じ手順で `supabase/migrations/0002_storage.sql` も実行します。

> `0002` は `0001` の関数（`current_school_id`）を使うので、**順番を守ってください**。

**ここまでで確認できること**：左メニュー **Table Editor** に `schools` `students` `submissions` など 12 個のテーブルが並ぶ。

**もしエラーが出たら**：エラー文をそのまま貼ってください。よくあるのは、`0001` を途中まで実行した状態で再実行して `already exists` が出るケースです。その場合は SQL Editor で
```sql
drop schema public cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
```
を実行してから `0001` をやり直します（**開発中のプロジェクトでのみ**行ってください）。

---

## ステップ3　最初の学校とアカウントを作る

RLS が効いているため、`school_id` を持つユーザーでないと何も見えません。最初の1件だけ手動で作ります。

### 3-1. 学校を作る

SQL Editor で実行します。

```sql
insert into public.schools (name, code, region, retention, plan)
values ('○○中学校', 'SCHOOL-001', 'jp', 'year', 'school')
returning id;
```

返ってきた **id（UUID）をコピー**します。以降これを「学校ID」と呼びます。

### 3-2. 教職員アカウントを作る

1. 左メニュー **Authentication → Users** を開きます。
2. 「Add user」→「Create new user」を押します。
3. メールアドレスとパスワードを入れます。
4. **Auto Confirm User** を **オン**にします。
5. 「Create user」を押します。

### 3-3. アカウントと学校を結びつける

SQL Editor で、`<学校ID>` と `<メールアドレス>` を書き換えて実行します。

```sql
insert into public.profiles (id, school_id, role, display_name)
select u.id, '<学校ID>'::uuid, 'admin', 'T.K'
  from auth.users u
 where u.email = '<メールアドレス>'
on conflict (id) do update
  set school_id = excluded.school_id,
      role      = excluded.role;
```

**ここまでで確認できること**：`select * from public.profiles;` で1行返る。

> 2人目以降は、招待時のメタデータに `school_id` を入れれば自動で作られます（`handle_new_user` トリガー）。この手作業は最初の1人だけです。

---

## ステップ4　クラスと生徒を登録する

生徒テーブルに**氏名カラムはありません**。出席番号・受験番号・匿名ID・イニシャルだけです。

```sql
-- クラス
insert into public.classes (school_id, grade, name, teacher_label, school_year)
values ('<学校ID>'::uuid, 2, 'A', '担任 T.K', 2026)
returning id;

-- 生徒（出席番号1〜9を一括登録）
insert into public.students (school_id, class_id, number, exam_no, anon_id, initials)
select
  '<学校ID>'::uuid,
  '<クラスID>'::uuid,
  n,
  '2A' || lpad(n::text, 2, '0'),
  '生徒' || lpad(n::text, 3, '0'),
  ''
from generate_series(1, 9) as n;
```

**ここまでで確認できること**：Table Editor の `students` に9行入っている。

---

## ステップ5　アプリ側の環境変数を設定する

1. 左メニュー **Project Settings → API** を開きます。
2. 次の2つをコピーします。
   - **Project URL**
   - **anon public** キー
3. プロジェクト直下に `.env.local` を作り、`.env.local.example` を参考に貼り付けます。

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
```

> **service_role キーは絶対に `NEXT_PUBLIC_` を付けないでください。** 付けるとブラウザに露出し、RLS を無視して全校のデータが読めてしまいます。

---

## ステップ6　パッケージを入れる

プロジェクトのターミナルで実行します。

```bash
npm install @supabase/supabase-js @supabase/ssr
```

そのあと、この配布物のファイルを次の場所に置きます。

```
middleware.ts              ← プロジェクト直下（app/ と同じ階層）
lib/supabase/client.ts
lib/supabase/server.ts
lib/db/grading.ts
```

**ここまでで確認できること**：`npm run dev` が起動し、`/login` にリダイレクトされる。

---

## ステップ7　保存期間の自動削除を有効にする（任意）

1. 左メニュー **Database → Extensions** で `pg_cron` を検索し、有効にします。
2. SQL Editor で実行します。

```sql
select cron.schedule(
  'purge-expired-submissions',
  '0 3 * * *',                       -- 毎日3時
  $$ select public.purge_expired_submissions(); $$
);
```

これで、学校ごとの保存期間設定（30日／180日／学年度末＋1年）に従って、答案が自動で論理削除され画像パスが消えます。

---

## ステップ8　動作を確かめる

`app/page.tsx` などから呼び出して確認します。

```ts
import { loadWorkspace, loadSubmissions } from "@/lib/db/grading";

const ws = await loadWorkspace();
console.log(ws.classes.length, ws.students.length, ws.tests.length);

const subs = await loadSubmissions();
console.log(subs.length);
```

**ここまでで確認できること**：クラス1件・生徒9件が返る。別の学校のアカウントで同じコードを実行しても、そちらのデータは1件も返らない（RLS が効いている証拠）。

---

## セキュリティの確認ポイント

移行が終わったら、次を1つずつ確認してください。

1. **他校のデータが見えないこと**
   2つ目の学校とアカウントを作り、ログインし直して `loadSubmissions()` が空になることを確かめます。
2. **監査ログが改ざんされていないこと**
   ```sql
   select * from public.verify_audit_chain('<学校ID>'::uuid) where ok is false;
   ```
   0行なら連鎖は無傷です。
3. **service_role キーがブラウザに出ていないこと**
   ブラウザの開発者ツールで `view-source` を検索し、`service_role` が含まれないことを確認します。
4. **答案画像が直リンクで開けないこと**
   Storage のファイルURLを直接ブラウザに貼り、`400` か `403` が返ることを確認します（署名付きURLからのみ開ける状態が正しい）。

---

## 次の段階

この手順で「保存されない」問題は解消します。そのうえで残っている作業は次の3つです。

1. **アプリ本体の差し替え** — 単一ファイル JSX の `useState(INITIAL_SUBMISSIONS)` を `loadSubmissions()` に、`updateSub()` を `updateItem()` に置き換える。
2. **採点AIの実接続** — `// PROD-API:` の12箇所を Route Handler 経由で Claude API に繋ぐ。API キーはサーバー側に置く。
3. **生徒モバイル提出** — `submission_links` を発行し、Edge Function（service_role）でトークンを検証してアップロードを代行する。生徒はログインしない設計。
