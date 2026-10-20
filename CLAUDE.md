# CLAUDE.md

このファイルは Claude Code がこのリポジトリで作業するときに毎回読み込む「会話の条件」です。

## 会話の条件

- 説明は日本語で、簡潔に要点を押さえつつ、初心者にもわかるように詳しく説明する。
- 専門用語（WebAuthn、チャレンジ、公開鍵など）は初出時に一言で意味を添える。

## アプリ概要

- 小学生テスト採点AI。`index.html`（画面）と `api/`（Vercel のサーバーレス関数）で構成。
- 共通処理は `lib/` に置く。Node.js の ES Modules（`import`/`export`）を使う。

## ログイン認証のルール（虹彩認証）

ログインは **虹彩認証** で行う。仕組みは WebAuthn（パスキー）で、虹彩の照合は端末側
（Windows Hello の虹彩認証など、OS の生体認証）に任せる。

必ず守ること:

1. **虹彩の画像・特徴量をサーバーに送ったり保存したりしない。** サーバーが保存するのは公開鍵だけ。
   - 理由: 生体情報は漏れると変更できない。特に子ども向けアプリなので個人情報保護が最優先。
   - Webカメラ映像から自前で虹彩を照合する実装は、写真でなりすましされやすく危険なので作らない。
2. WebAuthn の設定は `authenticatorAttachment: "platform"`（端末内蔵センサー）と
   `userVerification: "required"`（生体認証を必須にする）を維持する。サーバー側の検証でも
   `requireUserVerification: true` を外さない。
3. チャレンジは1回きり・5分で期限切れ（`lib/session.js` の署名付きCookie）。使い回さない。
4. ログインが必要なAPIは先頭で `getSessionUser(req)` を確認し、未ログインなら 401 を返す。
5. 新規登録には `REGISTRATION_CODE` を必須にし、誰でも登録できる状態にしない。
6. ログイン失敗時のエラー文は「ユーザーが存在しない」ことがわからない共通の文にする。
7. 認証まわりの秘密情報（`SESSION_SECRET` など）はコードに書かず、環境変数で渡す。

### 認証の流れ

| 手順 | API | 内容 |
| --- | --- | --- |
| ① 登録開始 | `POST /api/auth/register-options` | チャレンジ（使い捨ての乱数）を発行 |
| ② 登録完了 | `POST /api/auth/register-verify` | 端末が作った公開鍵を検証して保存 |
| ③ ログイン開始 | `POST /api/auth/login-options` | チャレンジを発行 |
| ④ ログイン完了 | `POST /api/auth/login-verify` | 虹彩認証後の署名を公開鍵で検証し、セッション発行 |
| 確認 / ログアウト | `GET /api/auth/me` / `POST /api/auth/logout` | |

### 環境変数

| 名前 | 例 | 説明 |
| --- | --- | --- |
| `SESSION_SECRET` | 32文字以上のランダム文字列 | Cookie の署名用 |
| `REGISTRATION_CODE` | 任意の文字列 | 新規登録に必要なコード |
| `RP_ID` | `example.com` | アプリのドメイン名 |
| `ORIGIN` | `https://example.com` | アプリのURL |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | | Upstash Redis（Vercel KV）。未設定だとメモリ保存（開発用） |
| `OPENAI_API_KEY` | | 採点AI用 |
