# ロボマルシェ セキュリティ対策（App Store アプリの防御機能を Web に適用）

## 調べ方
App Store で配信されているアプリの防御機能を、**公開資料**から調べた。
他社アプリを分解して解析する「リバースエンジニアリング」は、Apple の利用規約と各アプリの使用許諾に反するため行っていない。

参考にした公開資料
- Apple「Platform Security Guide」（App Transport Security、サンドボックス、コード署名、Keychain、App Attest / DeviceCheck）
- Apple「App Review Guidelines」「App Privacy Details」（プライバシーマニフェスト、App Tracking Transparency）
- OWASP「MASVS（Mobile Application Security Verification Standard）」と「MASTG」：通信、保存、認証、改ざん耐性（RESILIENCE）、プライバシー
- OWASP「ASVS」と「Secure Headers Project」：Web 側の対応策

## 対応表
| App Store アプリの防御機能 | 目的 | このサイトでの実装 | 場所 |
|---|---|---|---|
| App Transport Security（HTTPS の強制） | 通信の盗み見・改ざんを防ぐ | HSTS（2年）、`upgrade-insecure-requests` | `vercel.json` |
| アプリのサンドボックス・コード署名 | 不正なコードの実行を防ぐ | CSP（外部スクリプト禁止・`script-src 'self'`）、`object-src 'none'`、`base-uri 'none'` | `vercel.json` |
| 画面の重ね合わせ・偽画面への対策 | クリックジャッキングを防ぐ | `frame-ancestors 'none'`、`X-Frame-Options: DENY`、COOP / CORP | `vercel.json` |
| 権限の許可制（カメラ・位置情報など） | 不要な機能を使わない | `Permissions-Policy` でカメラ・マイク・位置情報・決済などを無効化 | `vercel.json` |
| App Attest / DeviceCheck | 正規アプリからの通信か確認する（API の偽装を防ぐ） | 署名付きの短命トークン（HMAC・2時間・ブラウザに結び付け）＋送信元（Origin / Sec-Fetch-Site）チェック | `lib/security.js`、`/api/robot-session` |
| 脱獄・自動操作の検知 | ボットや自動化ツールを防ぐ | おとり入力欄（ハニーポット）、表示から3秒未満の注文を拒否 | `lib/security.js`、`app.js` |
| サーバー側のレート制限 | 大量取得や総当たりを防ぐ | 接続元ごと＋サイト全体の回数制限、送信サイズの上限、JSON 以外を拒否 | `lib/security.js` |
| Keychain（安全な保存） | 端末内の情報漏えいを防ぐ | 個人情報はブラウザに保存しない。サーバーで PII Shield により暗号化・伏せ字化 | `lib/pii-shield.js` |
| 保存データの整合性チェック | 改ざんされたデータを使わない | 読み込み時に形と値を検査し、不正な値は捨てる | `app.js`（`cleanCart` など） |
| 自動ロック・再認証 | 放置された端末からの漏えいを防ぐ | 10分操作がないと入力中の個人情報を消去。ページを離れたときもメモリから消去 | `app.js` |
| アプリ切替画面のスナップショット保護 | 切替画面に個人情報が映るのを防ぐ | タブが隠れたら入力画面をぼかす | `app.js`、`styles.css` |
| プライバシーマニフェスト・ATT | 追跡しないことを示す | 外部のトラッキング・広告サービスは使わない。サイト内に「セキュリティ対策」の説明画面 | `app.js`（`openSecurity`） |
| 改ざん検知つきの記録 | 攻撃を後から調べられるようにする | 個人情報を含まないセキュリティログ（IP はハッシュ化） | `lib/security.js` |

## Web では再現できないもの
- **証明書ピンニング**：ブラウザでは使えない。代わりに HSTS を使う。
- **脱獄検知・デバッガ検知・コード難読化**：ブラウザのコードは誰でも見られるため、守る価値が低い。秘密はすべてサーバー側に置いている。
- **生体認証（Face ID 等）**：会員ログイン機能を作るときに WebAuthn（パスキー）で実装できる。

## 運用メモ
- Vercel の環境変数に `APP_SIGNING_SECRET`（長いランダム文字列）を登録すると、トークンの署名専用の鍵になる。未登録のときは、サーバーにある別の秘密から派生した鍵を使う。
- この対策で「完全に防げる」わけではない。トークンは攻撃の手間を大きく増やすが、本物のブラウザを自動操作されると見分けられない場合がある。そのためレート制限と組み合わせている。
