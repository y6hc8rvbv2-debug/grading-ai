# このアプリの開発ルール

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

## このアプリ（マンション管理エージェント）固有のルール
- 画面だけで動くアプリ（サーバーに個人情報を送らない）。データは端末内に AES-GCM で暗号化して保存する
- 氏名・マイナンバー・口座番号・住所・電話番号は保存しない。従業員は「表示名（イニシャル）」、区分所有者は「部屋番号」だけで扱う
- 滞納情報と役員名簿を結びつける機能は作らない
- 画面に出す値は必ず esc() でエスケープする（XSS対策）。inline script / onclick は使わない（CSPで禁止）
- 将来サーバー側（/api）でAIを使う場合は、送信前に lib/pii-shield.js でマスクする
