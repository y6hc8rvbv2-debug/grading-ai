# iPhoneアプリ（App Store）公開の手順

授業スタジオの iPhone アプリは Capacitor で作ります。
**画面一式はアプリの中に入っていて**、指導案などのデータも端末の中に保存します。
AI・課金などのサーバー処理だけを、本番のサーバー（Vercel）に問い合わせます。

- 有料プランは、iPhone アプリでは **Apple のアプリ内課金**、Web 版では **Stripe** で販売します
- どちらで契約しても、同じアカウントで同じプランが使えます（サーバーが両方の契約を見て判断します）
- 申請に使う文面・スクリーンショットは `docs/APP-STORE-LISTING.md` と `store/screenshots/` にあります

> 必要なもの：Mac（Xcode）、Apple Developer Program、本番の公開URL、Upstash Redis（共有データの置き場）

---

## 0. 本番のサーバーを用意する（最初に1回）
⚠ いまの Vercel プロジェクト `grading-ai` の本番では「採点アプリ」が動いています。
授業スタジオを同じプロジェクトの本番にすると採点アプリが置き換わるため、**授業スタジオ専用の Vercel プロジェクト**を作ります。

1. Vercel →「Add New」→「Project」→ GitHub の `grading-ai` を選ぶ
2. Project Name：`jugyo-studio`
3. 作成後に「Settings」→「Environments」→「Production」→「Branch Tracking」で、本番にするブランチを授業スタジオのブランチ（`claude/quirky-sagan-rfans1`、または main に統合した後なら main）にする
4. 「Environment Variables」に、下の「4. 環境変数」の値を登録して「Deploy」
5. 「Storage」→ **Upstash for Redis** を追加（`KV_REST_API_URL` などが自動で入る）→ 再デプロイ
6. 表示された本番URL（例：`https://jugyo-studio.vercel.app`、独自ドメインも可）を控える

## 1. App Store Connect でアプリを登録
1. App Store Connect →「アプリ」→「＋」→「新規App」
   - プラットフォーム：iOS ／ 名前：授業スタジオ ／ プライマリ言語：日本語
   - バンドルID：`jp.jugyostudio.app`（一覧に無い場合は、先に developer.apple.com →「Certificates, IDs & Profiles」→「Identifiers」→「＋」→「App IDs」で登録）
   - SKU：`jugyostudio-ios-001` ／ ユーザアクセス：フルアクセス
2. 「App情報」に表示される **Apple ID（数字）** を控える → Vercel の `APPLE_APP_ID` に登録
3. 「ビジネス」（旧「契約／税金／口座情報」）で **有料App契約** に同意し、銀行口座・税務情報を登録（Apple からの売上の振込先）

## 2. サブスクリプション（商品）を作る
「収益化」→「サブスクリプション」→ グループを1つ作成（参照名：授業スタジオ プラン）。次の4つを **同じグループ** に作ります。
商品ID・プランの対応はサーバー（`api/_apple.js` の `APPLE_PRODUCTS`）と一致させてあるので、**この通りに入力**してください。

| 並び順 | 商品ID | 参照名・表示名 | 期間 | 価格（日本） |
|---|---|---|---|---|
| 1（最上位） | `jugyo_government_monthly` | 行政コース | 1か月 | ¥9,980 |
| 2 | `jugyo_school_monthly` | 学校コース | 1か月 | ¥4,980 |
| 3 | `jugyo_individual_monthly` | 個人・塾コース | 1か月 | ¥1,980 |
| 4 | `jugyo_mini_monthly` | ミニコース | 1か月 | ¥500 |

- 価格は Web 版（Stripe）と同じ金額です。アプリに表示される価格は App Store に登録した価格がそのまま出ます
- 各商品に「表示名」「説明」（例：毎月30件までAIで指導案を作成できます）と、審査用スクリーンショット（プラン画面）を登録
- 「サブスクリプショングループのローカリゼーション」に日本語の表示名を登録

## 3. Apple からの通知の送り先
「App情報」→「App Storeサーバ通知」
- 本番サーバURL・Sandbox サーバURL：どちらも `https://（本番URL）/api/apple-notify`
- バージョン：**バージョン2**
- 設定後「テスト通知を送信」→ 正常なら Vercel のログにエラーが出ません

## 4. 環境変数（Vercel の授業スタジオ用プロジェクト）
| 名前 | 値 | 必須 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude の APIキー | ○ |
| `APPLE_BUNDLE_ID` | `jp.jugyostudio.app` | ○ |
| `APPLE_APP_ID` | 手順1-2の数字 | ○ |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash を追加すると自動 | ○ |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Web版の決済（任意） | |
| `PII_KEY_V1` / `PII_INDEX_KEY` | お問い合わせフォームの暗号化（任意） | |

確認：アプリまたは Web の「設定 → 連携・管理」で「iPhoneアプリ内課金（Apple）」が **有効** になっていれば OK。

## 5. アプリをビルドして TestFlight へ（Mac で行う）
```bash
git clone https://github.com/y6hc8rvbv2-debug/grading-ai.git && cd grading-ai
git checkout claude/quirky-sagan-rfans1
npm install
APP_URL=https://（本番URL） npm run ios:build   # 画面をビルドして ios/ に反映
npm run ios:open                               # Xcode が開く
```
Xcode で：
1. 左の「App」→「Signing & Capabilities」→ Team に自分の開発者アカウントを選ぶ（「Automatically manage signing」をオン）
2. 「＋ Capability」→ **In-App Purchase** を追加
3. 上部の端末選択を「Any iOS Device (arm64)」にして「Product → Archive」
4. 完了後の画面で「Distribute App」→「App Store Connect」→「Upload」
5. 15〜30分ほどで App Store Connect の「TestFlight」にビルドが表示されます

## 6. TestFlight での確認項目
App Store Connect →「ユーザとアクセス」→「Sandbox」でテスト用アカウントを作り、iPhone の「設定 → App Store → Sandboxアカウント」でサインインしてから試します。
Sandbox では1か月が約5分に短縮されるので、更新・期限切れも短時間で確認できます。

| 確認すること | 期待する結果 |
|---|---|
| 起動・初回登録 | お名前と規約同意だけで使い始められる |
| AIの同意 | 初めてAIを使う時に同意画面が出る。同意しないとAIは使えない |
| 購入 | 「プラン」で購入 → 現在のプランが変わる |
| 購入の復元 | アプリを入れ直して「購入を復元」→ プランが戻る |
| 更新 | 約5分ごとに自動更新され、プランが続く |
| 解約 | 「プランの変更・解約」→ 自動更新オフ → 期限後に無料コースに戻る |
| 期限切れ | 更新が止まった後、アプリを開き直すと無料コースになる |
| アカウント削除 | 設定 → データ →「アカウントを削除」→ データが消え、最初の画面に戻る |
| 書き出し | Word などで書き出すと、共有メニュー（ファイルに保存・メールなど）が開く |

## 7. 審査に出す
`docs/APP-STORE-LISTING.md` の内容を App Store Connect に入力し、TestFlight で確認したビルドを選んで「審査へ提出」。
サブスクリプションの4商品も、**初回はアプリと一緒に審査に提出**します（バージョンのページの「App内課金とサブスクリプション」で4つを選択）。

## 審査対策として実装済みのこと
- アプリ内の購入は Apple の課金のみ（Stripe の申し込みや Web への購入誘導はアプリでは表示しない）
- 「購入を復元」ボタン、自動更新の説明、利用規約・プライバシーポリシー・Apple標準EULA へのリンク
- アプリ内でのアカウント削除
- 外部AIへのデータ送信の事前同意（送信先・内容・目的を表示。設定から取り消し可）
- 画面一式をアプリに同梱（Webサイトを表示するだけのアプリではない。通信できない場所でもAI以外は使える）
- 他の利用者の投稿（ライブラリ・利用者の声）はアプリでは表示しない
- カメラ・マイク・音声認識・写真の利用目的の表示、iPhone 専用（iPad 対象外）
