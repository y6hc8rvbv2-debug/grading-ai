# DB の移行手順：まず検証環境、本番は後で（バックアップ・順序・データを失わない戻し方）

> この手順は**依頼者（Supabase・Vercel の管理者）が実行する**。開発担当・Claude は本番の SQL を実行しない。
> 本番に適用済みなのは 0001〜0003（2026-09-28）。0004〜0016 は未適用。
> 検証用 saiten-verify は 0001〜0015 を適用済み（2026-10-08）。**0016 はまだ**。
>
> **生徒の復習は「本人の ChatGPT で復習」（B方式。`docs/REVIEW-CHATGPT.md`）だけを使う方針（2026-10-07）。**
> B方式は AI を呼ばないので、見回り・暗号鍵・`CRON_SECRET`・OpenAI の API キーは要らない。
> 下の 1-5〜1-7（見回り・OpenAI との実接続・アプリ内の会話の実機確認）は、アプリ内の会話（A方式）を使うと決めた場合だけ行う。
>
> **順序：第1部（検証環境）で、DB の移行 → 検証用のアカウント → Preview の接続 → B方式の確認 を終えてから、第2部（本番）に進む。**
> 本番への適用は、第1部がすべて終わり、依頼者が本番へ進むと決めたときだけ行う。

---

# 第1部　検証環境（本番とは別の Supabase プロジェクト）

いまの Preview は本番の Supabase プロジェクトにつながっている。検証では本番のデータに触れないよう、**別の Supabase プロジェクト**を作り、
Vercel の Preview だけをそちらへつなぐ。実在の生徒・答案のデータは入れない。

### 1-1. 検証用の Supabase プロジェクトを作る
- `docs/SUPABASE-SETUP.md` のステップ1（名前の例：`saiten-verify`）。Region は本番と同じにする

### 1-2. DB の移行（0001 → 0016）
- 新しいプロジェクトでは、Data API の設定「**Automatically expose new tables**」がオフのことがある（Supabase の既定が変わりつつある）。
  オフのままでよい。オフだと 0001〜0014 だけでは表・関数に Data API の権限が付かないので、**最後に必ず 0014（明示的な GRANT）を実行する**。
  0014 で付く権限は、オンの環境（いまの本番）と同じになることを開発側で確認済み（`supabase/runbook/acl-snapshot.sql` の結果が一致）
- SQL Editor で `supabase/runbook/check.sql` を実行（すべて false のはず）
- `supabase/migrations/` の 0001 から 0014 まで、**番号の順に1ファイルずつ**実行（エラーなら止めて開発担当へ）。
  0001〜0003 は本番に適用済みのため中身を変えておらず、`begin;`・`commit;` が無い。SQL Editor では**先頭に `begin;`、末尾に `commit;` を足して**実行すると、途中でエラーになっても何も残らない
- 続けて `0015_review_copy.sql`（B方式の学校・クラスの設定。列2つと関数2つを足すだけ。既定は無効。権限も明示している）
- 最後に `0016_account_deletion.sql`（本人によるアカウントの削除・保存期間の削除。外部キー2つを「削除したら空にする」に変え、関数を2つ足し、返却内容の補完の関数を置き換える。既存の行は変えない）
- もう一度 `check.sql`：0001〜0016 がすべて true、すべての表で「RLS 有効」が true
- （任意）`supabase/runbook/acl-snapshot.sql` を実行し、結果の行数が開発環境の 548 行と同じか（オンの環境と同じ権限か）を見る
- 本番と同じ「0001〜0003 にデータがある状態から足す」手順は、開発側で `supabase/tests/upgrade_test.sh` により確認済み

### 1-2b. （任意）0008 以降をスクリプトで適用する（`npm run verify-db`）

SQL Editor の代わりに、`scripts/verify-db/apply.mjs` が Supabase Management API（HTTPS。SQL Editor と同じ経路）で1ファイルずつ適用する。

- 接続先は ref `cpfhsxbmzoyrlkynveqd`（saiten-verify・東京）に固定。名前・リージョンも確かめ、違えば止まる。本番には使えない
- 適用の前に、DB の状態が「直前の番号の適用後」と完全に一致するかを確かめる（`supabase/runbook/verify-expected.json`。表・ビュー・関数・ポリシー・トリガー・列）。
  一致しなければ何もせず止まる。適用済みのファイルは再実行しない。自動でやり直さない・データを消さない
- 各ファイルはそのまま1回で送る（ファイルの `begin;`・`commit;` で1つのトランザクション）。エラーならそのファイルの変更は残らず、そこで止まる
- 適用の後、期待と一致しなければ止まる。0014 の後は Data API の権限が本番と同じ 548 件か（`supabase/runbook/acl-expected.txt`）も確かめる
- CLI の移行履歴（`supabase_migrations.schema_migrations`）は読むだけで書き換えない。`supabase db push` は使わない（SQL Editor で入れた 0001〜0007 が履歴に無いため、再実行の恐れがある）
- 手元の PostgreSQL での確認：`supabase/tests/verify_db_test.sh`（`npm run test:db` に含まれる）。本物の Management API ではまだ実行していない

準備（Claude Code のクラウド環境で実行する場合）
1. 環境の設定（セッションのタイトルの環境メニュー → Edit）で、Network access を Custom にし、既定の一覧を残したまま **`api.supabase.com`** を Allowed domains に足す
2. Supabase の管理画面 → Account → Access Tokens で、**有効期限を短く**したトークンを作る（このトークンはアカウント全体＝本番にも使えるので、作業が終わったら削除する）
3. 同じ環境の設定で、環境変数 **`SUPABASE_ACCESS_TOKEN`** にトークンを入れる（チャットには貼らない）
4. 新しいセッションを開き（環境変数は新しいセッションで読み込まれる）、`npm run verify-db -- --check` → `npm run verify-db -- --apply --to 0014 --confirm-ref cpfhsxbmzoyrlkynveqd`（0014 まで適用済みなら `--to 0016` で続きだけを足す）

### 1-3. 検証用のアカウントとデータ
- `docs/SUPABASE-SETUP.md` のステップ3〜4 で、検証用の学校・管理者・クラス・生徒（架空の番号だけ）を作る
- 生徒のアカウント（配信先）を1つ作る（`docs/WORKFLOW-SETUP.md`）。メールアドレスは検証用のもの

### 1-4. Vercel の Preview を検証用につなぐ
- Vercel → Settings → Environment Variables で、**Environment を Preview だけ**にして次を設定（Production には触れない）
  - `NEXT_PUBLIC_SUPABASE_URL`・`NEXT_PUBLIC_SUPABASE_ANON_KEY`：検証用プロジェクトの値
  - B方式に必要なのはこの2つだけ。`TUTOR_INAPP` は**設定しない**（アプリ内の会話は無効のまま）
  - （A方式を使うと決めた場合だけ）`SUPABASE_SERVICE_ROLE_KEY`（検証用の service_role キー）・`TUTOR_KEY_ENCRYPTION_KEY`・`CRON_SECRET`（新しく作った乱数）・`TUTOR_INAPP=on`
  - 既に追加した環境変数は消さなくてよい（`TUTOR_INAPP` が無ければ使われない）
- 再デプロイし、ブランチの固定の URL（Branch URL）を控える

### 1-4b. B方式（本人の ChatGPT で復習）を確かめる
- `docs/REVIEW-CHATGPT.md` の 3.（設定）→ 先生で練習用の答案を確認・返却 → 生徒アカウントで 4.（操作）→ 7.（実機の確認）
- 既定で生徒の画面に出ないこと、有効にすると出ること、未公開の正答がコピー内容に入らないことを確かめる
- ChatGPT での会話は本人（検証用の生徒役）のアカウントで行う。アプリから AI は呼ばれない

### 1-5. （A方式を使う場合だけ）見回り（定期処理）を設定する
- `docs/TUTOR-SWEEP.md` の 3. のとおり（pg_cron・pg_net、Vault、`tutor-sweep-cron.sql`）
- 設定画面の「チャッピー先生」に「見回り：動いています」と出るまで確認

### 1-6. （A方式を使う場合だけ）学校・クラスでチャッピー先生を有効にし、OpenAI との実接続を確かめる
- `docs/TUTOR-LIVE-CHECK.md` の順に進める（モデル一覧の確認 → **依頼者の指示があってから**通話の確認 → Preview での確認）

### 1-7. 実機の確認
- B方式：`docs/REVIEW-CHATGPT.md` の 7.
- （A方式を使う場合だけ）`docs/TUTOR-DEVICE-CHECK.md`

### 1-8. 検証の記録

| 項目 | 記入 |
|---|---|
| 検証用プロジェクト名・作成日 | |
| 0001〜0016 の適用結果 | |
| B方式：既定で非表示・有効化・コピー・ChatGPT を開く・未公開の正答の除外 | |
| 実機の確認（端末ごと） | |
| （A方式を使う場合だけ）見回り・モデル一覧・通話・Preview での確認 | |
| 本番へ進むかの判断（日付・判断した人） | |

---

# 第2部　本番（第1部が終わり、本番へ進むと決めてから）

### 2-0. 前提と方針

- 0004〜0016 は**既存の行を消さない・書き換えない**（表・列・関数・トリガー・ポリシーを足すだけ。0013 は 0012 の関数 `set_tutor_call` を1つ置き換えるが、データには触れない）。
  足す列はすべて既定値つき（例：`tests.archived_at` は null、`schools.tutor_enabled` は false）なので、既存のデータの意味は変わらない
- **各ファイルは1つのトランザクション**（先頭 `begin;`・末尾 `commit;`）。途中でエラーになったら、そのファイルの変更はすべて取り消され、DB は実行前のまま
- 同じファイルを2回流すと「すでにある」というエラーで止まる（そのときも何も変わらない）。**エラーが出たら次のファイルへ進まない**
- 一度でも本番で成功したファイルは書き換えない。直すときは新しい番号（0016〜）のファイルを作る
- 適用は**利用の少ない時間**に行う（列を足すときに数秒、表が書き込み待ちになることがある）

### 2-1. バックアップ（適用の前に必ず）

次の **A と B の両方**を行う。

**A. Supabase のバックアップを確かめる**
1. Supabase の管理画面 → Project → Database → **Backups** を開く
2. 直近のバックアップの日時を記録する。Point in Time Recovery（PITR）が使えるプランなら、適用を始める**時刻**も記録する
3. バックアップの一覧が無いプランの場合は、B が唯一のバックアップになる

**B. 自分の手元にダンプを取る**（パソコンで。Supabase CLI を使う）
```bash
# 接続文字列は Supabase の管理画面 → Project Settings → Database → Connection string（URI）。パスワードはコマンド履歴に残さないよう環境変数で渡す
read -s DB_URL && export DB_URL     # 貼り付けて Enter（表示されない）
npx supabase db dump --db-url "$DB_URL" -f backup-$(date +%Y%m%d-%H%M)-schema.sql
npx supabase db dump --db-url "$DB_URL" --data-only -f backup-$(date +%Y%m%d-%H%M)-data.sql
npx supabase db dump --db-url "$DB_URL" --role-only -f backup-$(date +%Y%m%d-%H%M)-roles.sql
```
- 3つのファイルができて、data のファイルに `COPY public.submissions` などの行があることを確かめる
- **ダンプには答案の採点結果が入る**。暗号化した場所（学校の管理するストレージ）に保存し、メール・チャットで送らない
- 答案の画像（Storage）は DB のダンプに入らない。0004〜0016 は Storage のファイルを消さないので、今回は画像の退避は不要

### 2-2. 適用前の確認（読み取り専用）

Supabase の SQL Editor に `supabase/runbook/check.sql` の内容を貼り付けて実行する（`begin transaction read only` … `rollback` なので何も変わらない）。
3つの結果をスクリーンショットかコピーで保存する。

- 1つ目（適用済み）：0001〜0003 が true、0004〜0016 が false であること（0014 は「自動で公開」がオンの本番では最初から true になる。それで正しい）。**違う場合は止めて開発担当に連絡**
- 2つ目（件数と合計）：適用後に比べるために保存
- 3つ目（RLS）：すべての表で「RLS 有効」が true

### 2-3. 適用（この順番で、1ファイルずつ）

| 順 | ファイル | 内容 | 必要とするもの |
|---|---|---|---|
| 1 | `0004_ai_grading.sql` | AI 採点の保存関数 | 0001〜0003 |
| 2 | `0005_model_compare.sql` | モデル比較試験の記録 | 0004 |
| 3 | `0006_grading_modes.sql` | 採点方式・AI 採点の記録 | 0004 |
| 4 | `0007_test_import.sql` | 模範解答からのテスト作成 | 0001 |
| 5 | `0008_test_archive.sql` | テストの削除・アーカイブ | 0001 |
| 6 | `0009_mark_positions.sql` | 赤ペンの位置 | 0001 |
| 7 | `0010_workflow.sql` | 生徒の配信先・返却 | 0001 |
| 8 | `0011_individual_return.sql` | 個別返却 | 0010 |
| 9 | `0012_voice_tutor.sql` | 返却の版・受信箱・チャッピー先生 | 0010・0011 |
| 10 | `0013_tutor_sweep.sql` | チャッピー先生の見回り（通話をサーバーが切る） | 0012 |
| 11 | `0014_explicit_grants.sql` | Data API の権限を明示的に付ける（本番では既に同じ権限が付いているので変化なし） | 0001〜0013 |
| 12 | `0015_review_copy.sql` | 「本人の ChatGPT で復習」の学校・クラスの設定（既定は無効） | 0012・0014 |
| 13 | `0016_account_deletion.sql` | 本人によるアカウントの削除・保存期間の削除（ストアの要件。`docs/STORE-RELEASE.md`） | 0010・0012・0015 |

やり方（どちらか）
- **SQL Editor**：ファイルの中身を**全部**貼り付けて Run。「Success」を確かめてから次へ。エラーなら止める（DB は変わっていない）
- **psql**：`psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0004_ai_grading.sql`（1ファイルずつ。エラーで止まる）

各ファイルの後に `check.sql` の1つ目だけを見て、そのファイルが true になったことを確かめると、どこまで進んだか分からなくなることが無い。

### 2-4. 適用後の確認

1. `check.sql` をもう一度実行する
   - 1つ目：0001〜0016 がすべて true
   - 2つ目：**件数と合計が適用前と同じ**（違ったら止めて連絡。アプリを使っていなければ変わらないはず）
   - 3つ目：すべての表で「RLS 有効」が true。新しい表（grading_jobs・mark_positions・result_releases・tutor_sessions・tutor_call_secrets など）も含む
2. アプリの設定画面 →「AI採点の準備状況」で、0004〜0009・0012・0015・0016 が「済」（0010・0011・0013・0014 は check.sql の1つ目で確認する）
3. B方式は追加の環境変数が要らない。設定画面で、使うクラスだけ有効にする（既定は無効）。
   アプリ内の会話（A方式）を使うと決めた場合だけ、本番用の環境変数と見回りを設定する（`docs/TUTOR-SWEEP.md` の 3.。値は検証環境と別のもの）
4. 本番のアプリで：ログイン → 採点履歴が以前と同じ件数 → 答案を1つ開いて赤ペンが出る

### 2-5. うまくいかないときの戻し方（データを失わない順）

**A. 適用中にエラーが出た**
- そのファイルは取り消されている（DB は実行前のまま）。次のファイルへ進まず、エラー文をそのまま開発担当に渡す
- 0004〜0016 は本番で一度も成功していないので、開発担当はそのファイルを直してよい。直したファイルで、エラーが出たファイルから再開する

**B. 適用は成功したが、アプリの動きがおかしい**（データを消さずに止める）
1. 新しい機能を止める：設定画面で「ChatGPT で復習」を無効にする（A方式を使っている場合は、チャッピー先生を無効にする／Vercel の環境変数 `TUTOR_FEATURE=off`）
2. アプリを以前の版に戻す：Vercel → Deployments → 以前の Production の「Instant Rollback」。
   0004〜0016 で足したものは以前の版の動作を妨げない（以前の版は新しい表・列を使わないだけ）
3. **表や列を drop しない**。足したものは残しておき、原因を直した新しい番号のファイル（0016〜）で対応する

**C. データが壊れた・消えたことが分かった**（最後の手段）
- 本番をそのまま上書きで復元すると、**バックアップ以降に入った採点・返却が消える**。先に次を行う
  1. 先生に、作業を止めてもらう（新しい書き込みを止める）
  2. Supabase で**新しいプロジェクト**を作り、そこへバックアップ（PITR なら適用前の時刻）または手順1-B のダンプを復元する
     （`psql "$NEW_DB_URL" -f backup-…-roles.sql`、`-f backup-…-schema.sql`、`-f backup-…-data.sql` の順）
  3. 復元した DB と本番を比べ、失われた行だけを本番へ戻す（開発担当と一緒に行う）
- 本番を丸ごと過去の時点へ戻すのは、上の方法が取れず、失われる範囲を先生全員が了承したときだけ

### 2-6. 適用の記録（記入）

| 項目 | 記入 |
|---|---|
| 実行した人・日時 | |
| バックアップ A（日時／PITR の時刻） | |
| バックアップ B（ファイル名・保存場所） | |
| 適用前の check.sql の結果（保存場所） | |
| 0004〜0016 の各結果（Success／エラー文） | |
| 適用後の check.sql：件数・合計が同じか | |
| Preview での確認 | |

## 開発側で確かめたこと

- 0001〜0016 を空の DB に順に適用し、RLS・トリガー・関数のテストが通る（`npm run test:db`）。0001〜0014 はローカルの Supabase でも同じ順に適用してアプリの通しテストが通った（`npm run test:e2e`）。
  0015（B方式）・0016（アカウントの削除）は Docker が使えない開発環境のため、専用の PostgreSQL＋本物の PostgREST での画面テスト（`npm run test:e2e:lite`）で確認
- `check.sql` をローカルの Supabase（0014 まで適用済み）で実行し、エラーなく結果が出る
- 0001〜0003 にデータがある DB へ 0004〜0016 を順に足し、件数・合計が変わらないこと、途中で失敗したファイルは何も残さないことを確かめた（`supabase/tests/upgrade_test.sh`）
- 各ファイルの途中でエラーが起きたとき、そのファイルの変更が何も残らないこと（トランザクション）を確かめた（同じファイルを2回流して2回目がエラーになり、表・列が1つずつのまま）
- **未確認**：本番 DB の実際の件数での所要時間、本番の Supabase のプランで使えるバックアップの種類
