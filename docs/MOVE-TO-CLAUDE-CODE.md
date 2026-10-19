# Claude Code への移行手順

> **2026-09-27 追記**：この手順は claude.ai から Claude Code へ移すときのものです。
> いまは GitHub リポジトリ（y6hc8rvbv2-debug/grading-ai）で Next.js プロジェクトとして動いているので、
> ステップ1・5は不要です。現在の状況は `CLAUDE.md`、Supabase の設定は `docs/SUPABASE-SETUP.md` を見てください。

この一式をパソコンに置いて、Claude Code で作業を続けるための手順です。
上から順に進めてください。所要20〜30分です。

---

## ステップ1　この一式をパソコンに置く

1. 下に添付した `test-saiten-v3.zip` をダウンロードします。
2. 作業用の場所に展開します。おすすめは次のどちらかです。
   - macOS: `~/Projects/test-saiten-v3`
   - Windows: `C:\Users\<ユーザー名>\Projects\test-saiten-v3`
3. 展開したフォルダの中に `CLAUDE.md` があることを確認します。

**フォルダの中身**

```
test-saiten-v3/
├── CLAUDE.md                      ← Claude Codeが自動で読む引き継ぎ書
├── middleware.ts
├── docs/
│   ├── prototype-v3.jsx           ← 完成済みプロトタイプ(3,538行)
│   ├── SUPABASE-SETUP.md          ← Supabase接続手順
│   └── original-requirements.md   ← 元の要件定義
├── lib/
│   ├── db/grading.ts              ← データアクセス層
│   └── supabase/{client,server}.ts
└── supabase/migrations/
    ├── 0001_init.sql              ← スキーマ本体
    └── 0002_storage.sql           ← 画像保管
```

---

## ステップ2　Claude Code を入れる

ターミナルを開いて、お使いのOSのコマンドを実行します。
（ターミナルの開き方: macOSは「ターミナル」アプリ、Windowsは「PowerShell」）

**macOS / Linux**

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**Windows（PowerShell）**

```powershell
irm https://claude.ai/install.ps1 | iex
```

終わったら**新しいターミナルを開き直して**、次を実行します。

```bash
claude --version
```

`2.x.x (Claude Code)` のようにバージョンが表示されれば成功です。

> `command not found` と出たら、インストール先がPATHに入っていません。
> 一度ターミナルを完全に閉じてから開き直してください。それでも出る場合は `claude doctor` を実行すると診断が出ます。

**必要なもの**
- macOS 13以降 / Windows 10(1809)以降 / Ubuntu 20.04以降
- メモリ4GB以上
- **Claude の Pro / Max / Team / Enterprise いずれかのプラン**（無料プランでは使えません）

---

## ステップ3　ログインする

プロジェクトフォルダに移動して起動します。

```bash
cd ~/Projects/test-saiten-v3
claude
```

初回はブラウザが開くので、お使いのClaudeアカウントでログインします。

---

## ステップ4　引き継ぎを確認する

Claude Code が起動したら、そのまま次のように話しかけてください。

```
CLAUDE.md を読んで、このプロジェクトの現在地と次のタスクを教えて。
```

`CLAUDE.md` はセッション開始時に自動で読み込まれるので、
「テスト採点ver.3 はプロトタイプ完成済み・永続化未接続」という状態から会話が始まります。
これまでの経緯を説明し直す必要はありません。

---

## ステップ5　Next.js プロジェクトとして立ち上げる

Claude Code に次のように頼むのが早いです。

```
このフォルダを Next.js 14 (App Router, TypeScript) のプロジェクトとして
セットアップして。@supabase/supabase-js と @supabase/ssr も入れて。
既存の lib/ と middleware.ts と supabase/ はそのまま残して。
```

自分で実行する場合はこちらです。

```bash
npx create-next-app@latest . --typescript --app --no-src-dir --import-alias "@/*"
npm install @supabase/supabase-js @supabase/ssr
```

> `create-next-app` は既存ファイルがあると確認を求めます。
> `CLAUDE.md` `lib/` `docs/` `supabase/` `middleware.ts` は**上書きしない**よう注意してください。

---

## ステップ6　Supabase を繋ぐ

`docs/SUPABASE-SETUP.md` の手順に沿って進めます。
Claude Code に次のように頼めば、一緒に進めてくれます。

```
docs/SUPABASE-SETUP.md のステップ1から順に進めたい。
最初に何をすればいい?
```

SQLの実行でエラーが出たら、**エラー文をそのままClaude Codeに貼ってください。**
このSQLはまだ実際のPostgreSQLで検証されていないため、初回に修正が必要になる可能性があります。

---

## ステップ7　作業を再開する

Supabaseが繋がったら、次はプロトタイプの移植です。

```
docs/prototype-v3.jsx を Next.js の app/ 配下に分割して、
useState のデモデータを lib/db/grading.ts の関数に置き換えて。
まず採点履歴の画面から着手して。
```

3,538行を一度に移すと確認が大変なので、**画面ごとに区切って進める**のがおすすめです。
CLAUDE.md の「次にやること」に置き換え対応表があります。

---

## 知っておくと楽なこと

**会話を終えて再開しても文脈が残る**
`CLAUDE.md` は毎回自動で読まれます。設計の判断や決まりごとをここに書き足していけば、
次のセッションのClaude Codeもそれを踏まえて動きます。

**決まりごとが増えたら CLAUDE.md に書く**
「この書き方はやめる」「この命名でいく」といった判断が出たら、Claude Code に
「いまの決定を CLAUDE.md に追記して」と頼めば書き足してくれます。

**Gitを使うと安心**
まだGit管理下にないので、最初に初期化しておくと変更を戻せます。

```bash
git init
git add -A
git commit -m "初期状態: プロトタイプとSupabase移行ファイル"
```

**`.env.local` をコミットしない**
APIキーが入るファイルです。`.gitignore` に `.env*.local` が入っていることを確認してください。
`create-next-app` を使えば自動で入ります。

---

## 困ったときの聞き方

Claude Code には状況をそのまま伝えるのが一番早いです。

- 「`npm run dev` でこのエラーが出た（エラー全文を貼る）」
- 「SQLのステップ2で `already exists` と出た」
- 「赤ペン画像が表示されない。どこを見ればいい?」

ファイルを特定して読みに行ってくれるので、こちらでファイル名を調べる必要はありません。
