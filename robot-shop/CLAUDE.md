# このアプリの開発ルール（日本製フィジカルAIロボット ショップ）

## 構成
- 画面: `robot-shop/index.html` / `styles.css` / `app.js` / `data.js`（製品カタログ。サーバーとも共有）
- サーバー: `/api/robot-order.js`（注文受付。個人情報はここでだけ扱う）
- 個人情報保護: `robot-shop/lib/pii-shield.js`

<!-- pii-shield -->
## 個人情報の扱い（PII Shield）
このアプリは個人情報保護モジュール PII Shield（https://github.com/y6hc8rvbv2-debug/pii-shield）を使う。コードを書くときは次を必ず守ること。

- 利用者の個人情報（氏名・メール・電話・住所・生年月日・カード番号など）は、必ず `lib/pii-shield.js` の `shield` を通して扱う
  - 保存前に `shield.protect(record)`、メール等での検索は `shield.indexOf(項目, 値)`
  - API応答・一覧画面は `shield.toPublic(record)`（マスク済みの値だけ返す）
  - 平文が必要な本人向け画面だけ `shield.reveal(record, { actor: ログイン中の利用者ID })`
- パスワードは `shield.hashPassword()` / `shield.verifyPassword()` を使い、平文で保存しない
- 新しい個人情報の項目を追加したら `lib/pii-shield.js` の schema にも追加する
- PII Shield と鍵はサーバー側のコードでだけ使う。フロントエンド・スマホアプリのコードでは読み込まない
- 鍵（PII_KEY_V1 / PII_INDEX_KEY）はコードに書かず、環境変数か鍵管理サービスから読む。`.env` は Git に入れない
- 変更後は `npx pii-shield-check` を実行し、違反がないことを確認する

## このアプリ独自のルール
- ブラウザ（localStorage）には個人情報の平文を保存しない。注文履歴はサーバーが返したマスク済みの値だけ保存する
- 注文フォームの下書き保存は「個人情報以外の項目」だけにする
- 金額はサーバー側で `data.js` から計算し直す（画面から送られた金額は信用しない）
