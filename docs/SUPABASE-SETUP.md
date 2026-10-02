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

> このSQLは、Supabase CLI のローカル環境（本番と同じ Docker イメージ）で適用・テスト済みです（`npm run test:e2e`）。
> 本番プロジェクトの設定差でエラーが出ることはあり得るので、そのときはエラー文をそのまま貼ってください。

1. 左メニューの **SQL Editor** を開きます。
2. 「New query」を押します。
3. `supabase/migrations/0001_init.sql` の中身を**全部**貼り付けます。
4. 右下の **Run** を押します。
5. 同じ手順で `supabase/migrations/0002_storage.sql`、`0003_app_support.sql`、`0004_ai_grading.sql`、`0005_model_compare.sql`、`0006_grading_modes.sql`、`0007_test_import.sql`、`0008_test_archive.sql` の順に実行します。

> `0002` 以降は `0001` の関数やテーブルを使うので、**0001 → 0002 → 0003 → 0004 → 0005 → 0006 → 0007 → 0008 の順番を守ってください**。
> すでに 0003 まで流してある場合は、`0004_ai_grading.sql`（採点AIの結果の保存）と `0005_model_compare.sql`（管理者用のモデル比較試験の記録）を追加で実行します。
> 0005 は新しい表を2つ作るだけで、既存の生徒・テスト・答案・成績には触れません。
> `0006_grading_modes.sql`（採点方式「Opus単独 / 3モデル併用」と AI採点の記録）は、AI採点を使うなら必須です。答案の表に列を2つ足し（既存の答案は空のまま）、記録用の表を2つ作ります。0004 の後に実行してください。
> `0007_test_import.sql`（テスト管理の「模範解答・配点表から自動入力」）は、テスト・設問の表に列を1つずつ足し（既存の行は空のまま）、読み取りの記録の表を1つ作ります。
> `0008_test_archive.sql`（テストの削除）は、テストの表に列を1つ足し、答案・成績があるテストを削除できないようにします（削除の代わりにアーカイブ）。0001 のままだとテストを消すと答案・成績まで消えるので、テストを削除する前に必ず実行してください。

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

> 2人目以降は、サーバー側（service_role）で招待し、**app_metadata** に `school_id` と `role` を入れると自動で作られます（`handle_new_user` トリガー）。この手作業は最初の1人だけです。
>
> ```ts
> const admin = createAdminClient();
> const { data } = await admin.auth.admin.inviteUserByEmail(email);
> await admin.auth.admin.updateUserById(data.user.id, {
>   app_metadata: { school_id: schoolId, role: "teacher" },
> });
> ```
>
> **user_metadata（`signUp` の `options.data` や `inviteUserByEmail` の `data`）には入れないでください。** user_metadata はブラウザから誰でも書けるため、トリガーはそこを読みません。
>
> あわせて **Authentication → Sign In / Providers** で「Allow new users to sign up」を **オフ** にしてください。教職員は招待のみで作る運用です。

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

## ステップ6　アプリを起動する

プロジェクトのターミナルで実行します。

```bash
npm install
npm run dev
```

**ここまでで確認できること**：ブラウザで http://localhost:3000 を開くと `/login` に移動し、ステップ3で作ったメールアドレスとパスワードでログインできる。サイドバーの下に学校名が出る。

> `.env.local` が無い（または値が空の）ときは、ログイン画面の代わりに **デモモード** で起動します。画面上部に「デモモード（保存されません）」と出ていたら、`.env.local` の設定を見直して `npm run dev` を起動し直してください。

---

## ステップ6.5　採点AIを使えるようにする

答案をAI（Claude）で採点するには、Anthropic の APIキーをサーバーに設定します。**キーはサーバーの環境変数にだけ置き、チャットやブラウザには貼りません。**

1. https://console.anthropic.com にログインし、**API Keys** で「Create Key」を押してキーを作ります（`sk-ant-` で始まる文字列）。作成直後の画面でコピーボタンを押します（あとから全文は見られません）。
2. Vercel のプロジェクトで **Settings → Environment Variables** を開きます。
3. **Key** に `ANTHROPIC_API_KEY`、**Value** にコピーしたキーを貼り付けます。**`NEXT_PUBLIC_` は付けません**（付けるとブラウザに公開されてしまいます）。
4. **Environments** は **Production** と **Preview** にチェックして「Save」を押します。
5. **Deployments** から最新のデプロイを **Redeploy** します。

**ここまでで確認できること**：アプリの「設定」→「AI採点の準備状況」がすべて ✓（**AI採点できます**）になる。足りないものがあれば、その行に直し方が出る。「新規採点」に「AI（Claude）が答案を読み取って採点します」と出る。

> iPhone の写真（HEIC）はそのまま取り込めます（取り込み時に JPEG に自動変換）。1人分が2枚以上の答案は、「新規採点」の「1人分の答案の枚数」を合わせてから取り込みます。

> ローカルで動かす場合は `.env.local` に `ANTHROPIC_API_KEY=` を書きます（`.gitignore` 済みなのでコミットされません）。
>
> 採点には答案1枚ごとに API の利用料がかかります。Anthropic Console の **Limits** で月の上限額を決めておくと安心です。

### 6.5-b　採点モデルの比較試験（管理者専用・任意）

同じ答案を Claude Haiku 4.5 / Sonnet 5.5 / Opus 5 で1回ずつ採点し、結果・時間・費用を比べる画面です（メニューの「🧪 モデル比較試験」。管理者にだけ表示）。

- `0005_model_compare.sql` を実行してあること
- `ANTHROPIC_API_KEY` が **Preview** の環境変数にあること（上の手順4）
- **本番（Production）では既定で無効**。Vercel の Preview（プルリクエストごとのプレビュー URL）で使う
- 結果は比較試験の記録にだけ保存し、答案・成績には保存しない。答案画像もサーバーに保存しない
- 1回の実行で API を最大3回呼ぶ（Models API でモデルID を確かめる呼び出しは無料）。同じ画像の再実行は、チェックを入れない限りできない

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

> **注意**：この関数は DB 上の記録を消すだけで、Storage の画像ファイルそのものは残ります（Supabase Storage は SQL からのファイル削除を禁止しているため）。画像ファイルの削除は、今後サーバー側の処理として追加する予定です。

---

## ステップ8　動作を確かめる

1. 「テスト管理」→「テストを追加」で、テストと設問（形式・単元・配点・正答）を登録します。
2. 「新規採点」で、登録したテストとクラスを選び、答案画像を取り込んで「保存してAI採点する」を押します（採点AIが未設定なら「答案を保存する」）。
3. 処理ログに生徒ごとの得点が出れば成功です。答案を開くと、原本の上に赤ペン（○×△・得点・コメント）が重なって表示されます。
4. すでに「AI採点待ち」で保存してある答案は、「採点中」の画面の「AIで採点する」（または「まとめてAI採点」）で採点できます。
5. ページを再読み込みしても、テストと採点結果が残っていることを確かめます。

> AIの採点は下書きです。記述問題と、読み取りの自信が低い設問は「要確認一覧」に回ります。返却前に確認してください。

**ここまでで確認できること**：別の学校のアカウントでログインすると、上で登録したテストや答案が1件も見えない（RLS が効いている証拠）。

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

この手順で「保存されない」問題は解消し、AI採点も使えるようになります。残っている作業は次の2つです。

1. **生徒モバイル提出** — `submission_links` を発行し、Edge Function（service_role）でトークンを検証してアップロードを代行する。生徒はログインしない設計。
2. **保存期間を過ぎた画像ファイルの削除** — service_role のサーバー処理で、Storage API を使って削除する。
