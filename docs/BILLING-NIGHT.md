# 契約・採点枠・Opus追加料金・夜間採点

## 実装と課金方式

16コースの金額・税区分・上限・テスト用の料金IDは `lib/subscription-plans.ts` の一元表（2026-10-13 確定。docs/SUBSCRIPTION-PLANS.md）。学校の Stripe の料金は税別額（例 40,000円）で、消費税10%は作成済みの税率（`STRIPE_SCHOOL_TAX_RATE_ID`）で加える。

- 月額契約はStripe Checkout（subscription）と署名検証付きWebhook。月次請求の入金済みと現在の契約を照合して利用権を付ける。成功ページだけでは有効化しない。
- 個人・塾は3モデル併用が基本。Opus単独は採点1回の追加55円を固定額のCheckout（payment）で支払い、入金確認後に自動採点する。月末まとめ請求ではない。夜間も55円、併用の自動点検は追加料金なし。
- 失敗・取消は枠を戻し、支払済みOpus追加料金を返金対象にする。定期処理がStripe Refundを実行し、再送による重複を防ぐ。決済手数料の返還は決済事業者の条件に従う。
- 1回の採点で1枠。再採点も1枠。リクエストの通信再送とモデルの追加点検では増えない。上限超過は新しい採点を断り、超過分の自動請求はしない。
- 枠は学校ID（個人・塾も1テナント）ごとに共用。無料は日本時間の暦月10答案（2026-11-01 に30答案から変更。0025。その前は 2026-10-20 に20回から30答案へ。3モデル併用だけ）、有料はStripeの契約期間ごとの枠。契約の途中変更で増枠・減枠すると同じ期間の使用済み分を引き継ぐ。
- 料金を確定した範囲は2ページ・20問まで。これを超える答案は課金経路で受付しない。PDFはページ数の検証が必要なため画像に分けて取り込む。既存の答案は削除しない。
- 日本時間22:00〜翌06:00にサーバーが予約を順次実行。日中受付は当日22時から。画面を閉じても予約はDBに残る。結果は既存の採点履歴へ保存し、先生の確認を経て従来の返却操作を行う。自動返却・メール通知はしない。
- （2026-11-02 から）夜間の答案は **Anthropic の Message Batches API**（AI の費用が半分）にまとめて送る（`app/api/billing/worker` → `lib/grading/batch.ts`）。結果は多くは1時間以内・最長24時間。翌日までの全件完了は保証しない。`NIGHT_BATCH=off` で従来の1件ずつの採点に戻せる

## 設定前の挙動と既存データ

0017を適用するだけでは課金を有効にしない。billing_config.enabled=falseとBILLING_ENABLED未設定なら、旧採点を保つ。既存のschools.plan、答案、採点・返却データを置換・削除しない。移行前の採点をさかのぼって請求しない。
有効化後、未契約のテナントは無料枠。旧学校契約は個別にStripe契約へ移行するか、管理者が契約を確認して台帳を準備する。既存契約に勝手に新料金を適用しない。

## 検証用環境での導入

本番へのSQL適用・公開・実課金をこの作業では行わない。最初に本番と別のSupabaseとStripeのsandboxを使う。

1. バックアップと適用済み番号を確認し、0001〜0016適用済みの検証DBに0017_billing_night.sql、続けて 0018_billing_review.sql を全文1回ずつ適用（PR #2 では 0016 だったが、アカウントの削除の 0016 と重なるため 0017 にした）。
2. Stripeのsandbox（テスト採点ver5 検証用）の16コースの商品・料金は作成済み（2026-10-13 ユーザー確認：金額・tax_behavior・毎月・有効・テスト環境）。**作り直さない**。
   テスト用の料金IDはコードの一元表 `lib/subscription-plans.ts`（`COURSES` の testPriceId）にある。サンドボックスのキー（sk_test_・rk_test_）のときだけ使う。
   本番のキー（sk_live_・rk_live_）では、環境変数 `STRIPE_LIVE_PRICE_IDS_JSON`（{"personal-mini":"price_…", …}。キーは一元表の key）の料金IDだけを使う。無いコース・テスト用の料金IDを入れたコースは申し込みを止める。
   個人・塾は税込（tax_behavior=inclusive）、学校は税別（exclusive）。学校のコースは、Stripe に作成済みの消費税の税率（10%・税別に加算）の ID を `STRIPE_SCHOOL_TAX_RATE_ID` に入れたときだけ申し込める（無ければ学校のコースを止める。税率の新規作成・Stripe Tax の有効化はこの作業では行わない）。
   Customer Portalは1契約1商品・数量1、月額のこの16コースだけを許可し、クーポンやトライアルは使わない。解約は「期間の終わりに解約」にする（利用規約・特定商取引法に基づく表記と同じ）。プラン変更の差額（按分）は Portal の設定に従い、アプリは同じ契約期間の使用済み回数を引き継ぐ。
3. サーバーのみの環境変数：`STRIPE_SECRET_KEY`（必要権限に絞ったrestricted keyを推奨）、`STRIPE_WEBHOOK_SECRET`、`SUPABASE_SERVICE_ROLE_KEY`、`BILLING_APP_URL`（HTTPSのPreviewオリジン）、`BILLING_WORKER_SECRET`（32文字以上のランダム秘密）、学校のコースを受け付けるなら `STRIPE_SCHOOL_TAX_RATE_ID`。本番では `STRIPE_LIVE_PRICE_IDS_JSON`。公開用Stripeキーは不要。秘密をチャット・git・ブラウザへ入れない。（以前の `STRIPE_PRICE_IDS_JSON` は使わない）
4. WebhookのURL `/api/billing/webhook` に checkout.session.completed / async_payment_succeeded / async_payment_failed / expired、customer.subscription.created / updated / deleted、invoice.paid / payment_failed を送る。
5. Supabaseでpg_cron・pg_net・Vaultを有効化。Vaultに環境変数と同じ秘密をbilling_worker_secretとして登録（SQL履歴に平文を残さない）。Preview保護がある場合はVaultのvercel_protection_bypassを準備。次のURLを検証用URLに置換して定期処理を登録：

```sql
select cron.schedule('billing-night-worker', '* * * * *',
 $$select public.billing_worker_ping('https://YOUR-PREVIEW/api/billing/worker');$$);
```

6. `BILLING_ENABLED=on`、`NIGHT_GRADING_ENABLED=on`をPreviewに設定。DBの `update public.billing_config set enabled=true where id=true;` を検証環境だけで実行。再デプロイ後、workerのlast_seenが3分以内か確認。停止している間は新しい予約を受け付けない。
7. sandboxの決済→契約期間・上限→追加55円→入金済みだけ実行→夜間実行→失敗の枠戻しと返金→更新・未払い・解約を画面とWebhookで確認。端末を閉じたままの夜間実行と、定期処理の停止・復旧も確かめる。

税について：自動税計算は有効にしていない。税込の固定総額を徴収する。学校の税別表示と実際の総額を決済画面でも確認する。税登録・請求書の記載・申告方法を運用者が確定し、Stripe Taxを使う場合は税登録を確認してから別途接続する。

## 夜間の Batch 採点・学校の Opus単独の追加料金・上限を超えた分の従量課金（2026-11-02。0026_batch_overage.sql）

- **Batch**：定期処理（毎分）が、夜間の予約を最大40件取り出し、`/api/grade` の `batch: "prepare"`（AI を呼ばずに次の段階の要求の中身を返す）で集めて1つの Batch に送る（`ai_batches`・`grading_stages.batch_id`）。
  結果が出たら `batch: "apply"` で、すぐの採点と同じ後処理（normalizeResult・点検・上の段階に回すか・finish_grading_job）をする。上の段階に回った答案は次の Batch に入る（朝6時を過ぎても続きを送る）。
  Batch には fallbacks を付けない（Batch API が断る）。費用は `cost_usd` に半額で記録。送信に失敗したら段階の記録を消して次回やり直す。結果が返らない・エラーは採点の失敗（枠は戻る・請求しない）
- **学校の Opus単独**：1答案 50円（税別）。先生の画面で金額を示して同意をたずね（`opus_charge_accepted`）、採点が終わったものだけを翌月の請求に加える。個人・塾は今までどおり 55円（税込）をその場で支払う
- **上限を超えた分の従量課金**：1答案 個人・塾 22円（税込）／学校 20円（税別）。**管理者が有効にした有料の月額契約だけ**（無料・前払いは上限で止まる）。
  管理者はダッシュボードの「サブスクリプション」で有効・月の上限額（100円以上）を決める（パスワードの確認・`set_overage_settings`・監査ログ）。
  先生は上限に達すると警告と単価・今月の額を見て同意する（`grading_jobs.overage_accepted`。画面を開いている間は1回の同意）。月の上限額を超える分は断る
- **請求**：`billing_usage.charge_status`（none → 採点が終わると pending → 定期処理が Stripe の Invoice Item（次回の請求に加わる。答案ごとの冪等キー）を作って synced。失敗は void）。学校は消費税の税率（`STRIPE_SCHOOL_TAX_RATE_ID`）を付ける
- **料金の値**：DB の `billing_config`（overage_personal_yen・overage_school_yen・school_opus_yen）と `lib/subscription-plans.ts` の同じ値。変えるときは両方と、利用規約・特商法の表記（同じ定数を読む）
- **ストア用のアプリ**：追加料金がかかる同意（従量課金・Opus単独）は、画面に出さず、サーバーも受け付けない
- 検証：`tests/db/billing.mjs`（従量課金・上限額・失敗は請求しない・学校の Opus単独・先生は設定できない）、`tests/e2e-lite/night-batch.mjs`（Batch の送信→結果待ち→保存→上の段階の Batch→従量課金の警告と同意→Stripe の請求項目→二重請求なし→学校の Opus単独→表記）、`tests/unit/batch.test.ts`。
  本物の Batch API・本物の Stripe の請求書への反映は未確認

## 停止・運用

- 夜間受付を止める：NIGHT_GRADING_ENABLED=off。予約データは残る。再開すると次の夜間帯に処理する。
- 全体を停止：BILLING_ENABLED=off（DBが有効の間はAI採点も安全側で停止）。既存のStripe契約の請求まで停止するわけではない。契約停止・返金はPortalまたはStripeで別途対応する。
- 定期処理は1回で1モデル段階を処理し、6分のリースで重複を防ぐ。呼出し中の段階が10分を超えたら再呼出しせず失敗とする。大規模校での翌日納品は未保証。
- 未完了の申し込み・解約後の再申込は、Stripe上の支払・契約状態を先に確認し、billing_accountsのsubscription_id / checkout_plan / checkout_session_idを管理者が照合してから解除する。DBだけ書き換えて支払い済みと扱わない。
- 監視対象：billing_worker_state、night_queueのqueued件数と最古時刻、billing_ordersのpending / refund_pending。決済エラー・期限切れ・取り消しは台帳で確認する。

## 旧料金ID の既存契約と確認待ち（2026-10-13）

- 0018_billing_review.sql を 0017 の後に適用する（billing_accounts に確認待ちの列を足すだけ）
- 確認済みの旧プランは `STRIPE_LEGACY_PLANS_JSON`（docs/SUBSCRIPTION-PLANS.md）。対応の分からない料金ID は権限を変えずに確認待ちにする
- 既存の契約の調べ方（読み取りだけ）：`npm run billing:audit`（STRIPE_SECRET_KEY は読み取りだけの制限付きキー rk_… を推奨。値はチャットに貼らない）、
  Supabase の SQL Editor で `supabase/runbook/billing-audit.sql`

## ブランチへの取り込み時に直したこと（2026-10-11）

- middleware が `/api/billing/webhook`・`/api/billing/worker` を未ログインとして /login に転送していた（Stripe の通知と定期処理が届かない）→ 公開の経路に加えた（それぞれ署名・秘密で確かめる）
- 解約（subscription の canceled）後も「契約の支払いを確認してください」のまま採点できず、申し込み中の印が残って再申し込みもできなかった → 解約で無料プランに戻し、契約の反映・申し込みの期限切れで申し込み中の印を外す
- 課金が有効な状態で、採点したことのある先生がアカウントを削除できなかった（採点記録の作成者を空にする更新を billing_guard が拒否）→ 作成者だけを空にする更新は通す（`supabase/tests/billing_test.sql`）
- ストア用のアプリの中に料金表・申し込み・支払いが出ていた → アプリの中では「ご契約の状況」だけを出し、サーバーもアプリからの申し込み・支払いを断る（`lib/native.ts`、App Store 3.1.1・3.1.3(f)、Google Play の決済ポリシー）
- 特定商取引法に基づく表記（`/tokushoho`）を追加。利用規約の料金の条、プライバシーポリシーの委託先（Stripe）を更新
- 表示：無料プランの「○×マーク中心の基本採点」（実際は同じ3モデル併用）、「チャッピー先生」（いまは使わない A方式の名前）、PDF の扱い、決済が無効の環境の押せないボタン・「提供準備中」を直した

## 検証状況

ローカルでビルド・型チェック・単体テスト（`tests/unit/billing.test.ts`：16コースの値・テスト/本番の料金IDの分離・申し込みを止める条件）・隔離PostgreSQLによる課金台帳のテスト（`tests/db/billing.mjs`、`supabase/tests/billing_test.sql`）・Stripe の代役による画面テスト（`tests/e2e-lite/billing.mjs`：表示→申し込み→決済画面への引き渡し→署名つきの通知で反映→通知の重複→採点の上限の境目→解約→学校の税率）を行う。Stripeの署名改変と期限切れ、料金・夜間時刻の境界もテスト。外部の実決済、Supabase pg_cronからPreviewへの実行、実機、ピーク負荷、返金の到着は未確認。設定を入れただけで本番導入完了とは扱わない。
