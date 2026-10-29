# App Store 申請前の点検表（テスト採点ver6）

- 点検の日：2026-10-29（ブランチ `claude/test-scoring-v6-app-ii46ie`）
- 方針：本番の公開・main へのマージ・ストアへの提出はしない。架空のデータだけを使う。RLS・認証・暗号化は外さず、service_role で権限の検査を迂回しない
- 状態の書き方：**検証済み**（このリポジトリのテスト・Preview で確かめた）／**不具合あり→修正済み**／**未実施**／**環境不足で確認不能**（この開発環境では確かめられない。必要な操作を「残作業」に書く）
- 検証の環境：
  - 「DB」＝ `supabase/tests/run.sh`（素の PostgreSQL＋全マイグレーション。RLS は本物）
  - 「画面」＝ `tests/e2e-lite/run.sh`（専用の PostgreSQL＋本物の PostgREST＋ログインと Storage の代役＋ブラウザ。写真は暗号化して保存）。
    Storage の代役は 2026-10-29 から、本物と同じく **storage.objects の RLS（本人のトークン）** と **保存先の許可形式・大きさの上限** で読み書きを決める
  - 「Preview」＝ https://grading-ai-git-claude-test-sc-b3ad9f-y6hc8rvbv2-debugs-projects.vercel.app（検証用の DB saiten-verify につながっている。配信された画面の設定から確認）

## 先に確認済み（利用者が PC・Preview で確認。今回は再点検しない）

ログイン／答案・資料の取り込み／AI による模範解答の作成・AI 採点／複数ページの切り替え／保存した答案の再表示／AWS KMS の設定「OK」／
新しい答案画像の保存と再表示／以前の写真21枚の暗号化と暗号化済み1枚のスキップ／暗号化後の以前の答案の2ページの画像と赤ペン／
プライバシーポリシー・利用規約・特商法・アカウントの削除の画面があること（**画面があること**の確認。内容と実際の動作は下の 5・7 で点検）。
AI 採点が動いたことは、採点の精度全般の保証ではない（下の 4）。

---

## 1. アクセス制限

| 項目 | 状態 | 環境 | 証拠 | 残作業 |
|---|---|---|---|---|
| 学校Xの先生が学校Yの答案・採点結果・設問・名簿・返却・監査ログを読めない／変えられない／消せない | 検証済み | DB・画面 | `supabase/tests/access_test.sql` 1、`tests/e2e-lite/access.mjs` 2（REST に本人のトークンで直接） | — |
| 学校Yの答案を返却・確認済み・テストの削除・生徒の招待・AI 採点に送れない | 検証済み | DB・画面 | 同上（AI への要求0件も確認） | — |
| 学校Yの画像：画像の API・Storage への直接の取得・保存（上書き）ができない | 検証済み | 画面 | access.mjs 2（`/api/image` は 404、保存は 403 `storage_denied`、学校Yの写真は書き換わらない） | — |
| 学校Yの答案の URL（/history/…）を直接開いても内容が出ない | 検証済み | 画面 | access.mjs 2 | — |
| **他校の ID・画像のパスを自校の答案に書き込み、返却させて学校Yの写真・正答を自校の生徒に見せる手口** | **不具合あり→修正済み** | DB・画面 | 修正前の DB で再現（学校Xの生徒アカウントから学校Yの写真と正答が見えた）。`0024_tenant_integrity.sql` で、他校を指す書き込みを断る（30表）・画像のパスは自校のフォルダだけ・返却された画像の規則に学校の一致を追加。access_test 2・access.mjs 2 | 検証用 DB には push 時に自動で適用。本番 DB へは DB-RUNBOOK の手順で（ユーザーの判断） |
| 生徒Aが生徒Bの返却・画像・受信箱を見られない（REST・Storage・画像の API） | 検証済み | DB・画面 | access_test 3、access.mjs 3、既存の review-copy.mjs | — |
| 生徒が先生用の表（答案・採点結果・名簿・設問・テスト）を読めない・返却内容を書き換えられない・写真を保存できない・AI 採点の API を使えない | 検証済み | DB・画面 | access_test 3、access.mjs 3 | — |
| 未ログイン：画面（/・/history/…・/scores・/settings）はログイン画面へ。画像・保存・採点・取り込み・振り分けの API は受け付けない。REST は0件 | 検証済み | DB・画面・Preview | access_test 4、access.mjs 1、Preview でも `/api/image`・`/api/health` はログイン画面へ転送（307） | — |
| **写真の保存 API が、ブラウザの申告どおりの種類で保存していた（HTML・SVG を写真として置き、同じサイトの上でスクリプトを動かせた）** | **不具合あり→修正済み** | 画面・単体 | 暗号化で Storage の許可形式の検査が効かなくなっていた。保存は中身で写真・PDF か確かめる（`sniffMime`）、表示は写真・PDF 以外をダウンロード扱い＋ CSP `sandbox`。access.mjs 2、`tests/unit/storage-errors.test.ts` | — |
| 保存の失敗を一律「権限エラー（403）」と表示していた | **不具合あり→修正済み** | 画面・単体 | `lib/storage-errors.ts`：許可形式（415 `storage_type_not_allowed`）・大きさ（413）・権限（403）・保存先なし・その他を区別し、画面に原因の種類を添える。ログは原因・状態・利用者 ID の先頭8文字だけ（秘密・中身は書かない）。access.mjs で 2026-10-28 の不具合（許可形式に octet-stream が無い）を再現して確認 | — |
| 保存先の許可形式に `application/octet-stream`（暗号化した写真）| 修正済み（記録） | DB・画面 | 検証用 DB は利用者が画面から追加済み。0024 で同じ設定を記録（既にあれば何もしない）。暗号化の無効化・保存先の公開はしていない | 本番 DB にも 0024 で入る |
| Preview と本番が同じ DB か | 確認済み（Preview 側） | Preview | Preview の画面の設定は検証用 DB（ref cpfh…veqd）。本番の Vercel の設定はこの環境から見えない | 本番の環境変数は利用者が Vercel で確認 |

## 2. 先生の修正・確認・返却

| 項目 | 状態 | 環境 | 証拠 | 残作業 |
|---|---|---|---|---|
| 判定・点数・コメントの修正が保存され、合計点に反映される（開き直しても同じ） | 検証済み | 画面 | access.mjs 4（× → ○ で合計 10/10・DB の total_score も 10、コメント保存） | Preview での手動確認は任意 |
| 修正すると確認済みが外れ、確認前は返却できない | 検証済み | DB・画面 | workflow_test（編集で確認が外れる）、access.mjs 4（確認前の返却は 400） | — |
| 確認前の修正は生徒に見えない。確認後に返却すると、生徒本人にだけ新しい版が出る | 検証済み | 画面 | access.mjs 4（第2版・10/10点、生徒1には見えない） | — |
| 未確認・要確認・設問の欠落・配信先なし・削除済みは返却を断る／同じ内容の返し直しはしない | 検証済み | DB | workflow_test | — |

## 3. iPhone 実機

| 項目 | 状態 | 環境 | 証拠 | 残作業 |
|---|---|---|---|---|
| Safari（ブラウザー）：撮影・写真の選択・HEIC・複数ページ・保存と再表示・権限の拒否・通信の切断と再試行・二重送信 | 環境不足で確認不能 | — | 開発環境に iPhone が無い。HEIC の変換・複数ページ・二重送信の防止（requestId）は単体・画面テストのみ | 下の「利用者の操作 A」 |
| 提出用の iOS アプリ（Capacitor）：同じ項目 | 環境不足で確認不能 | — | Mac・Xcode・実機が無い | 下の「利用者の操作 B」 |

## 4. 採点精度・一括処理

| 項目 | 状態 | 環境 | 証拠 | 残作業 |
|---|---|---|---|---|
| 正答・誤答・空欄・記述・作図・部分点を、先生の期待結果と比べる | 未実施 | — | 本物の Claude での精度は未確認（代役の AI で形と保存だけ確認） | 先生が期待結果つきの答案を用意し、Preview で採点して比べる（「利用者の操作 C」） |
| 不確実な結果は要確認になり、先生が最終判断する | 検証済み（仕組み） | 単体・画面 | normalizeResult の単体テスト（判定と得点の食い違い・信頼度・記述の確認必須）、要確認があると返却できない（workflow_test） | 本物の AI での要確認の割合は C で確認 |
| 複数人・複数ページで混同・欠落・重複がない | 検証済み（代役の AI） | 画面 | ver6.mjs：120人分を並列で採点（要求120件・採点済み120人）、複数ページの束ね、同じ requestId の再送は二重に採点しない | 本物の AI では C |
| AI の失敗・時間切れの後に再開・再試行できる | 検証済み（代役） | DB・単体 | fail_grading_job（状態を戻す）・test-import の待ち方の単体テスト | 本物の AI では C |

## 5. 個人情報と削除

| 項目 | 状態 | 環境 | 証拠 | 残作業 |
|---|---|---|---|---|
| 氏名を保存しない説明と、答案の写真に写る氏名の扱いが一致 | 検証済み（文言を補足） | コード | 名簿に氏名の欄は無い。ポリシーは「写真に氏名があれば写真として保存（読み取って保存・表示はしない）」と明記。今回、氏名欄の塗りつぶしの設定（既定オフ・塗りつぶし前の写真は AI に送る）を追記 | ストアの説明文の「氏名は保存しません」は「名簿に氏名を保存しません」と読める書き方にする（7 の下書きを修正済み） |
| AI の送信先・送るもの・目的の説明と、送る前の同意 | 検証済み | 画面 | 同意の画面（Anthropic・米国・答案の写真に氏名が写りうること・使い道）、store.mjs（同意しなければ送らない） | — |
| 同意の拒否・取り消し | 検証済み | 画面 | store.mjs（拒否で AI への要求0件・設定画面から取り消すと次回また聞く） | — |
| プライバシーポリシーの委託先が実装と一致 | **不足あり→修正済み** | コード | 追記：AWS KMS（鍵だけ。写真は送らない）・暗号資産の決済代行（使う場合だけ）・音声入力（端末の音声認識の提供元に音声が送られうる）・写真の暗号化 | 文言は利用者の確認待ち（法的な文書のため） |
| アカウントの削除が実際に働く | 検証済み（代役の Auth）／環境不足 | DB・画面 | account_deletion_test、store.mjs（生徒の削除→ログイン不可・返却内容は学校の記録として残る・最後の管理者は不可） | 本物の Supabase の Auth（管理 API）での削除は Preview で架空のアカウントを作って確認（「利用者の操作 D」） |
| 保存期間による写真の削除 | 検証済み（単体・DB） | — | retention.test.ts・account_deletion_test 5 | 本物の Vercel Cron は未確認 |

## 6. iOS 提出版

| 項目 | 状態 | 証拠 | 残作業 |
|---|---|---|---|
| iOS の構成 | 作成済み | `ios/App`（Capacitor 8.5.3・SPM）、起動すると本番の `/start` を開く | — |
| Bundle ID | 一致 | `jp.testgrade.app`（Xcode の PRODUCT_BUNDLE_IDENTIFIER・capacitor.config.ts・Android の applicationId）。変更していない | — |
| 表示名・版 | 確認済み | テスト採点ver6・1.0（ビルド 1）・iOS 15 以上 | — |
| 署名 | 未設定 | DEVELOPMENT_TEAM が空（自動署名） | Xcode で Team を選ぶ（「利用者の操作 B」） |
| 権限の説明 | **不足あり→修正済み** | カメラ・写真は済み。コメントの音声入力（🎤）がマイク・音声認識を使うのに説明が無く、iOS ではアプリが強制終了する。`NSMicrophoneUsageDescription`・`NSSpeechRecognitionUsageDescription` を追加 | 実機で 🎤 を押して許可の文が出ることを確認 |
| プライバシーマニフェスト | 確認済み | Capacitor 本体に PrivacyInfo.xcprivacy あり（追跡なし）。アプリのコードは理由の申告が要る API を使っていない | アップロード時に警告（ITMS-91053/91061）が出たら対応 |
| 暗号化の申告 | 確認済み | `ITSAppUsesNonExemptEncryption = false`（アプリは HTTPS だけ。写真の暗号化はサーバー側） | — |
| 通信できないときの画面の名前 | 修正済み | `mobile/www/*.html` が「ver5」のままだった → ver6 | — |
| ビルド SDK | 環境不足で確認不能 | 2026-04-28 から Xcode 26・iOS 26 SDK でのビルドが必要 | 最新の Xcode でビルド |
| TestFlight | 未実施 | 記録なし | 「利用者の操作 B」 |

## 7. 審査資料

| 項目 | 状態 | 証拠 | 残作業 |
|---|---|---|---|
| 審査用アカウント（架空のデータ） | 未実施 | 手順は `docs/STORE-RELEASE.md` 3 | 本番に作る（本番の DB に 0004〜0024 を適用した後） |
| 正式なサポート・プライバシーの URL | 環境不足で確認不能 | この環境のネットワーク方針で `saiten.school-app1.com` に届かない（プロキシが 403）。Preview の /privacy・/support は開ける（preview:check） | 利用者がブラウザで https://saiten.school-app1.com/privacy と /support が開くか確認（独自ドメインの割り当て） |
| 説明文・名前 | 修正済み | STORE-RELEASE.md の名前・説明文の「ver5」を ver6 に | — |
| スクリーンショット | 撮り直し済み | 以前の画像は「ver5」の表示だった → ver6 で撮り直し（`store/screenshots/`。先生の画面はデモモードのため「デモモード（保存されません）」の表示とサンプルの数値が写る） | 本番の審査用アカウントができたら、デモの表示が無い画面で撮り直すとよい（Apple 2.3.3：実際の使用の画面）。画像を確認 |
| 年齢区分 | 未実施 | 新しい質問票（13+・16+・18+）。2026年9月から提出時に回答が必須 | App Store Connect で回答 |
| App のプライバシー（収集するデータ） | 下書きあり | STORE-RELEASE.md 5。今回の追記（音声入力は端末の機能で保存しない）も反映して回答する | App Store Connect で入力 |
| SDK・暗号化の申告 | 確認済み | 上の 6 | — |
| 課金と Apple のルール | **要判断（申請を止めうる）** | アプリ内では料金の案内・申し込み・外部の決済へのリンクを出さない（`lib/native.ts`・サーバーも 403）。ただし **個人・塾の有料プランを Web で買い、iOS アプリで使える** | 下の「Apple の要件」3 |

---

## Apple の最新の要件（2026-10-29 に公式ページで確認）

1. **ビルド**：2026-04-28 から、App Store Connect へのアップロードは Xcode 26 以降・iOS 26 SDK 以降でのビルドが必要
   （[Upcoming Requirements](https://developer.apple.com/news/upcoming-requirements/)・[SDK minimum requirements](https://developer.apple.com/news/upcoming-requirements/?id=04282026a)）
2. **第三者の AI への送信**：審査ガイドライン 5.1.2(i)。個人データを第三者の AI に送るときは、送り先を明示し、送る前に明示の同意を得る（[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)・[更新のお知らせ](https://developer.apple.com/news/?id=ey6d8onl)）。
   このアプリは AI を使う前に同意の画面を出す。審査担当が同意の画面を見られるよう、審査メモに「最初の AI 採点の前に出る」と書く
3. **課金**：アプリの外で買ったデジタルの機能を使わせる場合の規定。
   - 3.1.3(c) 企業向け：開発者が**組織（学校など）だけに直接売る**場合は、購入済みの機能を使わせてよい。**個人・単独の利用者・家族への販売はアプリ内課金が必要**
   - 3.1.3(f) 無料の単独アプリ：有料の Web ツールの無料の連携アプリは、アプリ内での購入・アプリの外での購入への誘導が無ければアプリ内課金は不要（例は VoIP・クラウド保存・メール・Web ホスティング。採点ツールが当てはまるかは審査の判断）
   - 日本（スマホソフトウェア競争促進法。iOS 26.2 から）：アプリ内の別の決済・Web への誘導のリンクが使える（手数料・報告・StoreKit の権限が必要）
     （[Changes to iOS in Japan](https://developer.apple.com/support/app-distribution-in-japan/)・[Payment options in Japan](https://developer.apple.com/support/payment-options-on-the-app-store-in-japan)）
   - **判断が要ること**：学校向けの契約だけなら 3.1.3(c) に当たる見込みが高い。**個人・塾のコース**を iOS アプリで使えるままだと、3.1.3(f) が認められなければ断られうる。
     選択肢：(a) iOS アプリでは学校の契約の利用者だけに使わせる、(b) 個人・塾向けにアプリ内課金を用意する、(c) 3.1.3(f) として申請し、審査メモで説明する（断られたら a か b）
4. **年齢区分**：新しい区分（13+・16+・18+）と質問票。2026年9月から、新しいアプリ・更新の提出時に回答が必須
   （[Age Rating Updates](https://developer.apple.com/news/upcoming-requirements/?id=07242025a)・[質問票の追加](https://developer.apple.com/news/?id=tlur8uvi)）
5. **アカウントの削除**：5.1.1(v)。アプリの中から削除を始められること（済み）
   （[5.1.1(v) Offering account deletion](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion)）
6. **プライバシーマニフェスト**：理由の申告が要る API・指定の SDK を使う場合（Capacitor は同梱）
   （[Privacy updates for App Store submissions](https://developer.apple.com/news/?id=r1henawx)・[Third-party SDK requirements](https://developer.apple.com/support/third-party-SDK-requirements/)）
7. **最低限の機能**（4.2）：Web をそのまま包んだだけのアプリは断られることがある（`docs/STORE-RELEASE.md` 10）

## 申請を止める問題（2026-10-29 時点）

1. **本番の準備が済んでいない**：本番の DB に 0004〜0024 が未適用、独自ドメイン（saiten.school-app1.com）の割り当てが未確認。アプリは本番の `/start` を開くので、この状態では審査で動かない
2. **個人・塾の有料プランと Apple の課金ルール（3.1.3）**：方針の決定が必要（上の 3）
3. **iOS のビルド・署名・実機・TestFlight が未実施**（Mac・Xcode・実機が必要）
4. 審査用アカウント・年齢区分・App のプライバシーの入力が未実施
5. プライバシーポリシーの追記の文言の確認（法的な文書のため）

## 利用者の操作（必要なときに）

- **A. iPhone の Safari で**（Preview の URL）：先生でログイン → 新規採点で「カメラで撮影」（許可→撮影）・「写真を選ぶ」（HEIC の写真を2枚）→ 2ページで1人分 → 保存 → 開き直して2ページとも表示。
  カメラの許可を「許可しない」にして、案内が出るか。機内モードにして保存 → 失敗の案内 → 機内モードを切って再試行で1件だけ保存されるか。保存ボタンを素早く2回押しても1件か
- **B. Mac で**：`npm ci && npm run mobile:sync && npm run mobile:open:ios` → Xcode で Team を選ぶ → 実機で A と同じ確認＋コメントの 🎤（マイク・音声認識の許可の文）→ Archive → TestFlight
- **C. 採点の精度**：正答・誤答・空欄・記述・作図・部分点を含む架空の答案と、先生の期待結果（設問ごとの○×△と点数）を用意 → Preview で採点 → 結果を比べる（比べる表はこちらで作ります）
- **D. 削除の確認**：Preview で架空の生徒アカウントを作り、アカウントの削除 → ログインできないことを確認（架空のアカウントだけで）
- **E.** ブラウザで https://saiten.school-app1.com/privacy と /support が開くか

## 修正の記録（2026-10-29）

- `supabase/migrations/0024_tenant_integrity.sql`：他校を指す書き込みを断る・画像のパスは自校のフォルダだけ・返却された画像の規則に学校の一致・保存先の許可形式に octet-stream
- `app/api/image/upload`・`app/api/image`：中身で写真・PDF か確かめて保存、表示は CSP sandbox。保存の失敗を原因ごとに（`lib/storage-errors.ts`）。上限を保存先と同じ 20MB に
- `next.config.mjs`：`/api/image` だけはサイト全体の CSP で上書きしない
- `ios/App/App/Info.plist`：マイク・音声認識の説明。`mobile/www`：ver6 の名前
- `app/privacy`：委託先（AWS KMS・暗号資産の決済代行・音声入力）・写真の暗号化・氏名欄の塗りつぶし
- テスト：`supabase/tests/access_test.sql`（新規）、`tests/e2e-lite/access.mjs`（新規）、`tests/unit/storage-errors.test.ts`（新規）、Storage の代役を本物の規則どおりに（`tests/e2e-lite/gateway.mjs`）
