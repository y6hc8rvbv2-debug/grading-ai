# iPhoneアプリ（App Store）公開の手順

授業スタジオの iPhone アプリは、本番の Web アプリを開く「入れ物」です（Capacitor）。
有料プランは **Apple のアプリ内課金** で販売し、Web 版は Stripe のままです。
どちらで契約しても、同じアカウントで同じプランが使えます（サーバーが両方の契約を見て判断します）。

> 必要なもの：Mac（Xcode）、Apple Developer Program（年 12,980 円）、本番の公開URL、Vercel の共有データの置き場（Upstash Redis）

---

## 1. App Store Connect の準備
1. App Store Connect →「マイApp」→「＋」で新規アプリを作成
   - バンドルID：`jp.jugyostudio.app`（変える場合は、下の APPLE_BUNDLE_ID と capacitor.config.ts も同じ値に）
2. 「App情報」に表示される **Apple ID（数字）** を控える → Vercel の `APPLE_APP_ID` に設定
3. 「契約／税金／口座情報」で **有料App契約** に同意し、銀行口座・税務情報を登録
   （売上は Apple から、ここで登録した口座に毎月振り込まれます）

## 2. サブスクリプション（商品）を作る
「サブスクリプション」→ サブスクリプショングループを1つ作り（例：授業スタジオ プラン）、次の4つを **同じグループ** に作成します。

| 商品ID（この通りに入力） | プラン | 期間 | 価格の目安 |
|---|---|---|---|
| `jugyo_mini_monthly` | ミニコース | 1か月 | ¥500 |
| `jugyo_individual_monthly` | 個人・塾コース | 1か月 | ¥1,980 |
| `jugyo_school_monthly` | 学校コース | 1か月 | ¥4,980 |
| `jugyo_government_monthly` | 行政コース | 1か月 | ¥9,980 |

- グループ内の並び順は「上位プランほど上」にします（Apple がアップグレード／ダウングレードを判断します）
- 各商品に表示名・説明・審査用スクリーンショット（プラン画面）を登録します

## 3. Apple からの通知の送り先
App Store Connect →「App情報」→「App Storeサーバ通知」
- 本番サーバURL：`https://（本番URL）/api/apple-notify`
- Sandbox サーバURL：同じURL
- バージョン：**バージョン2**

## 4. Vercel の環境変数
| 名前 | 値 |
|---|---|
| `APPLE_BUNDLE_ID` | `jp.jugyostudio.app` |
| `APPLE_APP_ID` | 手順1-2で控えた数字 |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash for Redis を追加すると自動で入る |

設定後に再デプロイし、アプリの「設定 → 連携・管理」で「iPhoneアプリ内課金（Apple）」が **有効** になれば完了です。

## 5. アプリを作って TestFlight で試す（Mac で行う）
```bash
npm install
APP_URL=https://（本番URL） npx cap sync ios   # 設定を ios/ に反映
npx cap open ios                              # Xcode が開く
```
Xcode で：
1. 「Signing & Capabilities」で Team（自分の開発者アカウント）を選ぶ
2. 「＋ Capability」→ **In-App Purchase** を追加
3. 「Product → Archive」→「Distribute App」→ App Store Connect にアップロード
4. TestFlight で自分の iPhone に入れ、**Sandbox アカウント**（App Store Connect →「ユーザとアクセス」→「Sandbox」）で購入を試す
   - 購入 → プランが変わる／「購入を復元」→ 別の端末でも使える／Apple の設定で解約 → 期限後に無料に戻る

## 6. 審査で確認されること（対応済み）
- アプリ内の購入は Apple の課金のみ（Stripe の申し込みボタンや Web への誘導はアプリでは表示しない）
- 有料の指導案（ライブラリ）の購入はアプリでは表示しない
- 「購入を復元」ボタン、自動更新の説明、利用規約・プライバシーポリシー・EULA へのリンク
- アプリ内でのアカウント削除（設定 → データ →「アカウントを削除」）
- カメラ・マイク・音声認識を使う理由の表示（Info.plist）
