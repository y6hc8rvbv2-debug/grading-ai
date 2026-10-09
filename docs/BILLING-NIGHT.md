# 契約・採点枠・Opus追加料金・夜間採点

## 実装と課金方式

個人・塾の通常月額（税込）は100回1,650円・200回2,750円・300回3,850円・1,000回12,100円。夜間は20%OFFの1,320円・2,200円・3,080円・9,680円。
学校の通常月額（税別）は800回40,000円・2,500回120,000円・4,500回200,000円・6,500回300,000円。夜間は20%OFF。Stripeに設定する学校の実際の支払金額は消費税相当10%込みの44,000円・132,000円・220,000円・330,000円（夜間35,200円・105,600円・176,000円・264,000円）。

- 月額契約はStripe Checkout（subscription）と署名検証付きWebhook。月次請求の入金済みと現在の契約を照合して利用権を付ける。成功ページだけでは有効化しない。
- 個人・塾は3モデル併用が基本。Opus単独は採点1回の追加55円を固定額のCheckout（payment）で支払い、入金確認後に自動採点する。月末まとめ請求ではない。夜間も55円、併用の自動点検は追加料金なし。
- 失敗・取消は枠を戻し、支払済みOpus追加料金を返金対象にする。定期処理がStripe Refundを実行し、再送による重複を防ぐ。決済手数料の返還は決済事業者の条件に従う。
- 1回の採点で1枠。再採点も1枠。リクエストの通信再送とモデルの追加点検では増えない。上限超過は新しい採点を断り、超過分の自動請求はしない。
- 枠は学校ID（個人・塾も1テナント）ごとに共用。無料は日本時間の暦月20回、有料はStripeの契約期間ごとの枠。契約の途中変更で増枠・減枠すると同じ期間の使用済み分を引き継ぐ。
- 料金を確定した範囲は2ページ・20問まで。これを超える答案は課金経路で受付しない。PDFはページ数の検証が必要なため画像に分けて取り込む。既存の答案は削除しない。
- 日本時間22:00〜翌06:00にサーバーが予約を順次実行。日中受付は当日22時から。画面を閉じても予約はDBに残る。結果は既存の採点履歴へ保存し、先生の確認を経て従来の返却操作を行う。自動返却・メール通知はしない。
- 通常APIをサーバーから夜間に呼ぶ実装。Anthropic Batch APIによる原価割引はまだ使わない。夜間は販売価格の割引であり、時間帯でAPI単価が下がるという意味ではない。翌日までの全件完了を保証しない。キュー能力の負荷試験と同時実行数の調整が必要。

## 設定前の挙動と既存データ

0016を適用するだけでは課金を有効にしない。billing_config.enabled=falseとBILLING_ENABLED未設定なら、旧採点を保つ。既存のschools.plan、答案、採点・返却データを置換・削除しない。移行前の採点をさかのぼって請求しない。
有効化後、未契約のテナントは無料枠。旧学校契約は個別にStripe契約へ移行するか、管理者が契約を確認して台帳を準備する。既存契約に勝手に新料金を適用しない。

## 検証用環境での導入

本番へのSQL適用・公開・実課金をこの作業では行わない。最初に本番と別のSupabaseとStripeのsandboxを使う。

1. バックアップと適用済み番号を確認し、0001〜0015適用済みの検証DBに0016_billing_night.sqlを全文1回適用。
2. Stripeのsandboxで通常・夜間の16プランを各別Productとして作成。月額JPYのPriceを用意し、税込の固定総額、tax_behavior=inclusive、月1回にする。価格IDを`STRIPE_PRICE_IDS_JSON`でplan_id→price_idのJSONとして登録。plan_idはlib/billing/catalog.ts参照。Customer Portalは1契約1商品・数量1、月額プランだけを許可し、クーポンやトライアルは使わない。
3. サーバーのみの環境変数：`STRIPE_SECRET_KEY`（必要権限に絞ったrestricted keyを推奨）、`STRIPE_WEBHOOK_SECRET`、`SUPABASE_SERVICE_ROLE_KEY`、`BILLING_APP_URL`（HTTPSのPreviewオリジン）、`BILLING_WORKER_SECRET`（32文字以上のランダム秘密）。公開用Stripeキーは不要。秘密をチャット・git・ブラウザへ入れない。
4. WebhookのURL `/api/billing/webhook` に checkout.session.completed / async_payment_succeeded / async_payment_failed / expired、customer.subscription.created / updated / deleted、invoice.paid / payment_failed を送る。
5. Supabaseでpg_cron・pg_net・Vaultを有効化。Vaultに環境変数と同じ秘密をbilling_worker_secretとして登録（SQL履歴に平文を残さない）。Preview保護がある場合はVaultのvercel_protection_bypassを準備。次のURLを検証用URLに置換して定期処理を登録：

```sql
select cron.schedule('billing-night-worker', '* * * * *',
 $$select public.billing_worker_ping('https://YOUR-PREVIEW/api/billing/worker');$$);
```

6. `BILLING_ENABLED=on`、`NIGHT_GRADING_ENABLED=on`をPreviewに設定。DBの `update public.billing_config set enabled=true where id=true;` を検証環境だけで実行。再デプロイ後、workerのlast_seenが3分以内か確認。停止している間は新しい予約を受け付けない。
7. sandboxの決済→契約期間・上限→追加55円→入金済みだけ実行→夜間実行→失敗の枠戻しと返金→更新・未払い・解約を画面とWebhookで確認。端末を閉じたままの夜間実行と、定期処理の停止・復旧も確かめる。

税について：自動税計算は有効にしていない。税込の固定総額を徴収する。学校の税別表示と実際の総額を決済画面でも確認する。税登録・請求書の記載・申告方法を運用者が確定し、Stripe Taxを使う場合は税登録を確認してから別途接続する。

## 停止・運用

- 夜間受付を止める：NIGHT_GRADING_ENABLED=off。予約データは残る。再開すると次の夜間帯に処理する。
- 全体を停止：BILLING_ENABLED=off（DBが有効の間はAI採点も安全側で停止）。既存のStripe契約の請求まで停止するわけではない。契約停止・返金はPortalまたはStripeで別途対応する。
- 定期処理は1回で1モデル段階を処理し、6分のリースで重複を防ぐ。呼出し中の段階が10分を超えたら再呼出しせず失敗とする。大規模校での翌日納品は未保証。
- 未完了の申し込み・解約後の再申込は、Stripe上の支払・契約状態を先に確認し、billing_accountsのsubscription_id / checkout_plan / checkout_session_idを管理者が照合してから解除する。DBだけ書き換えて支払い済みと扱わない。
- 監視対象：billing_worker_state、night_queueのqueued件数と最古時刻、billing_ordersのpending / refund_pending。決済エラー・期限切れ・取り消しは台帳で確認する。

## 検証状況

ローカルでビルド・型チェック・単体テスト・隔離PostgreSQLによる課金台帳のテストを行う。Stripeの署名改変と期限切れ、料金・夜間時刻の境界もテスト。外部の実決済、Supabase pg_cronからPreviewへの実行、実機、ピーク負荷、返金の到着は未確認。設定を入れただけで本番導入完了とは扱わない。
