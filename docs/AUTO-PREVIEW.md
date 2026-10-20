# 自動プレビューのしくみ（B方式）と、最初に1回だけする設定

Replit のように「頼む → 自動で反映 → URL で確認 → 手直しを頼む」だけで進めるための仕組みです。
設定は **最初に1回だけ**。そのあとは、先生の作業は「URL を開いて見る・直してほしい所を伝える」だけです。

---

## しくみ（設定のあと、毎回自動で起きること）

```
① Claude が修正してブランチに push
      │
      ├─▶ GitHub Actions「checks」     … 自動テスト（単体・DB）
      ├─▶ GitHub Actions「verify-db」  … DB の変更があれば、検証用 Supabase（saiten-verify）へ自動で適用
      └─▶ Vercel                       … Preview（確認用の URL）を自動で作る
                │
② Claude が Preview の URL を開いて確認（画面が開くか・エラーが無いか・ログインできるか・画面写真）
                │
③ Claude が「確認済みの URL」と結果を先生に報告 → 先生は URL を見て、直したい所を伝えるだけ
```

- **本番には何も起きません。** 自動で変わるのは「検証用の DB（saiten-verify）」と「Preview の URL」だけです。
  本番の DB・本番のサイトは、これまでどおり先生が決めてから反映します。
- 検証用 DB への適用は、接続先が saiten-verify であること・適用の前後で DB の形が期待どおりかを毎回照合し、
  少しでも違えば **何もせずに止まります**（`scripts/verify-db/apply.mjs`）。

---

## 最初に1回だけする設定（合計 約15分）

> 鍵（トークン・パスワード）は、**チャットに貼らないでください**。下の画面に直接入れます。

### 設定1．GitHub に Supabase の鍵を登録する（約5分）

検証用 DB へ自動で適用するための鍵です。

1. https://supabase.com/dashboard/account/tokens を開き、**Generate new token** を押す
   - 名前：`github-verify-db`　有効期限：**30日** など短めがおすすめ（切れたら同じ手順で作り直す）
   - 表示された `sbp_…` をコピー（この画面を閉じると二度と見られません）
2. GitHub のリポジトリ（grading-ai）→ **Settings → Secrets and variables → Actions → New repository secret**
   - Name：`SUPABASE_ACCESS_TOKEN`
   - Secret：さきほどコピーした値 → **Add secret**
3. 確認：GitHub → **Actions → verify-db → Run workflow**。緑の ✓ になり、ログの最後に「完了：…」か「適用するファイルはありません」と出れば OK

> この鍵は、先生の Supabase アカウントの全プロジェクトを操作できる強い鍵です。
> ただし仕組みの側で、saiten-verify（名前・東京リージョン・ref まで照合）以外には使わないようにしています。心配なときは有効期限を短くしてください。

### 設定2．Vercel の Preview に鍵を足す（約5分）

Vercel → プロジェクト → **Settings → Environment Variables**。どれも **「Preview」だけにチェック**（Production には付けない）。

| 名前 | 値 | 何のため |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`・`NEXT_PUBLIC_SUPABASE_ANON_KEY` | 検証用（saiten-verify）の値 | 設定済みなら何もしない |
| `ANTHROPIC_API_KEY` | Anthropic の API キー | Preview で AI 採点を試す |
| `SUPABASE_SERVICE_ROLE_KEY` | **検証用**（saiten-verify）の service_role キー（Supabase → Project Settings → API Keys） | 生徒のスマホから提出・アカウントの削除 |

次に、Claude が Preview を開けるようにします（Vercel は既定で、Preview を見るのに Vercel のログインを求めるため）。

1. Vercel → プロジェクト → **Settings → Deployment Protection → Protection Bypass for Automation** → **Add Secret**（名前は自由）
2. 表示された値をコピー（次の設定3で使う）

足したあと、Vercel → **Deployments → 最新の Preview → Redeploy** を1回押します。

### 設定3．Claude の作業環境に、Vercel への通信と鍵を足す（約5分）

この会話の画面上部の **クラウド環境のメニュー → Edit**（環境の設定）。

1. **Network access**：`Limited` のまま、**Allowed domains** に `*.vercel.app` を足す（「Allow package managers」のチェックは付けたまま）
   - 手順の公式説明：https://code.claude.com/docs/en/cloud-environments#network-access
2. **Environment variables**（または Network secrets）に次を足す
   - `VERCEL_AUTOMATION_BYPASS_SECRET` = 設定2でコピーした値
   - または **Network secrets** に、ヘッダー名 `x-vercel-protection-bypass`・値 = 設定2の値（接続のたびに自動で付く。Claude からは値が見えないので、こちらがより安全）
   - （任意）検証用の教職員でのログインまで Claude に確かめさせる場合：`PREVIEW_TEACHER_EMAIL`・`PREVIEW_TEACHER_PASSWORD`（**検証用の学校のアカウントだけ**。本番のアカウントは入れない）
3. 新しい会話（セッション）から有効になります

---

## 設定のあと、Claude が毎回すること（CLAUDE.md の決まり）

1. 修正 → 手元の自動テスト → push
2. GitHub の Actions（checks・verify-db）と Vercel の Preview の完了を確かめる（Vercel が作った URL は GitHub の「Deployments」から読む）
3. `npm run preview:check -- <URL> --shots <フォルダ>`（ログインまで見るときは `--email "$PREVIEW_TEACHER_EMAIL" --password-env PREVIEW_TEACHER_PASSWORD`）
   - 公開ページが開ける・画面のエラーが無い・でたらめな提出リンクを断る・（ログイン時）AI採点の準備状況がそろっている・スマホ幅と PC 幅の画面写真
4. 先生に **「確認済みの URL」・確かめたこと・確かめられなかったこと** を報告

## 自動にしていないこと（わざと）

- **本番の DB・本番のサイトへの反映**（先生が決めてから。`docs/DB-RUNBOOK.md` 第2部）
- 本物の AI を大量に呼ぶ確認・本物の決済（費用がかかるため、先生の指示があってから）
- 検証用 DB に「期待と違う形」が見つかったときの修復（自動では直さず、止まって知らせます）

## 困ったとき

| 症状 | 原因と直し方 |
|---|---|
| Actions の verify-db が「Secret … が無いので省きました」 | 設定1が未完了 |
| verify-db が「HTTP 401」 | Supabase の鍵の期限切れ → 設定1で作り直して Secret を更新 |
| verify-db が「どの番号の適用後とも一致しません」 | 検証用 DB が手で変えられている。Claude に、表示された違いを伝える（自動では直しません） |
| Claude が「Vercel のログインで止められました」 | 設定2の Protection Bypass か、設定3の `VERCEL_AUTOMATION_BYPASS_SECRET` が未設定 |
| 個別の URL（grading-xxxx-…）は開けるのに、ブランチの URL（grading-ai-git-…）だけ Vercel のログインに飛ぶ | Network secrets の対象のドメインが、ブランチの URL に合っていない可能性。対象を `*.vercel.app` にする |
| 画面のエラーに `vercel.live` | Vercel が Preview にだけ差し込むツールバー。アプリの不具合ではない（確認スクリプトは数えない） |
| Claude が「Preview に届かない」 | 設定3の `*.vercel.app` が未設定、または新しい会話になっていない |
