# チャッピー先生：ブラウザが来なくても通話を終わらせる仕組み（見回り）

> **いまの方針では使わない（2026-10-07）。** 生徒の復習は「本人の ChatGPT で復習」（B方式。`docs/REVIEW-CHATGPT.md`）だけを使う。
> この文書は、アプリ内の会話（A方式）を使うと決めた場合（環境変数 `TUTOR_INAPP=on`）のためのもの。B方式には、ここの設定（見回り・暗号鍵・`CRON_SECRET`・OpenAI の API キー）は要らない。

ブラウザの強制終了・通信断・生存確認の停止・アプリのサーバーの再起動のあとでも、
**設定した時間に一定の猶予を加えた範囲で、サーバーが OpenAI の通話を切る**ための仕組みです。

---

## 1. 仕組み

```
Supabase（DB）                                   アプリ（Vercel）                            OpenAI
pg_cron（30秒ごと）
  └ tutor_sweep_ping() ── pg_net の POST ──▶ /api/tutor/sweep（CRON_SECRET で認証）
                                              ├ tutor_sweep_due()  … 終わらせるべき会話を終え、切れていない通話を返す
                                              ├ 会話ごとの資格情報を復号（TUTOR_KEY_ENCRYPTION_KEY）
                                              ├ 本人のキーで hangup ─────────────────────────▶ POST /v1/realtime/calls/{id}/hangup
                                              └ tutor_sweep_record() … 結果を記録（失敗は再試行）
```

- 定期処理は **DB の中（pg_cron）** で動く。アプリが止まっていても止まらず、アプリが戻れば次の回で切る
- 見回りの DB 関数は `service_role` だけが呼べる。アプリの `/api/tutor/sweep` だけが `SUPABASE_SERVICE_ROLE_KEY` を使う（ブラウザには出さない）
- 見回りが3分以上動いていなければ、アプリは**新しい会話を始めない**（生徒には「仕組みが止まっている」と表示）。管理者の設定画面に見回りの状態が出る

### 終わらせる理由と、終わるまでの時間（30秒ごと・生存確認が途絶えたとみなす時間 90 秒のとき）

| きっかけ | 判定 | 通話が切れるまで（目安） |
|---|---|---|
| 1回の上限時間 | 開始時刻＋上限（サーバーの時計） | 上限から **最大約40秒** |
| 学校・クラスで無効／同意の撤回／緊急停止 `TUTOR_FEATURE=off` | 次の見回り | **最大約40秒** |
| ブラウザの強制終了・通信断・生存確認の停止 | 最後の生存確認から 90 秒 | 最後の生存確認から **最大約2分10秒** |
| アプリのサーバーの再起動・停止 | 止まっている間は切れない | アプリが起動してから **次の見回り（最大約40秒）** |
| 生徒の「会話を終える」・画面を閉じる・撤回・キーの削除 | その要求の中で | すぐ（失敗したら見回りが再試行） |

（目安＝見回りの間隔 30 秒＋処理の時間。ブラウザから生存確認が届いていれば、20秒ごとの生存確認でも同じ理由で切る）

### 失敗したとき

- 切るのに失敗したら（OpenAI の 5xx・通信の失敗など）、10秒・20秒・40秒…（最大10分）と間隔を広げて再試行する
- 毎回の結果を `tutor_sessions.hangup_status`（pending／failed／done／gave_up）・`hangup_attempts`・`hangup_error` と監査ログ（`tutor.hangup_*`）に残す
- 見回りの呼び出しそのものの失敗（アプリが止まっていた等）は、DB の `net._http_response` に残る
- 資格情報の保持の上限（下の 2.）までに切れなかった通話は `gave_up` として記録し、資格情報を消す。管理者の設定画面に件数が出る

## 2. 通話を切るための資格情報（「保存しない」キーでも切れる理由）

| | 「暗号化して保存する」 | 「保存しない」 |
|---|---|---|
| ブラウザ | 持たない | 画面を閉じるまでメモリにだけ持つ。**会話の開始のときに1回だけ**サーバーへ送る（生存確認・終了には付けない） |
| アカウント（`tutor_credentials`） | 暗号文を保存（本人が削除するまで） | 保存しない |
| 会話ごとの資格情報（`tutor_call_secrets`） | 会話の開始時に、本人のキーを暗号化して置く | 同じ |
| 会話ごとの資格情報を消す時 | **通話を切り終えたらすぐ**。切れなくても、作成時の「1回の上限時間＋30分」で消す（見回りが確実に消す） | 同じ |

- 会話ごとの資格情報は、RLS で**生徒・先生・管理者のだれも読めない**表に置く。復号に使う追加認証データは会話の ID（別の会話の行へ移しても復号できない）
- 暗号鍵 `TUTOR_KEY_ENCRYPTION_KEY` が無い環境では、会話を始めない（通話を確実に切れないため）
- 技術的には、DB の暗号文と暗号鍵の両方を扱える運用者は復号できる（`docs/VOICE-TUTOR.md`「キーを読めるのは誰か」）

## 3. 設定（環境ごとに1回。まず検証環境で行う：`docs/DB-RUNBOOK.md`）

1. Supabase に `0013_tutor_sweep.sql` まで適用する
2. アプリ（Vercel）の環境変数
   - `SUPABASE_SERVICE_ROLE_KEY`：その環境の Supabase の service_role キー（`NEXT_PUBLIC_` を付けない）
   - `CRON_SECRET`：32文字以上の乱数（例：`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`）
   - `TUTOR_KEY_ENCRYPTION_KEY`：`docs/VOICE-TUTOR.md` の手順
   - （任意）`TUTOR_STALE_SECONDS`：生存確認が途絶えたとみなす秒数（既定 90、30〜600）
3. Supabase の管理画面
   - Database → Extensions で **pg_cron** と **pg_net** を有効にする
   - Vault（Project Settings → Vault、または Integrations → Vault）に Secret を追加：名前 `tutor_sweep_secret`、値は `CRON_SECRET` と同じ
   - Vercel の Preview を保護している（Deployment Protection）場合は、Vercel の「Protection Bypass for Automation」の値を、名前 `vercel_protection_bypass` で Vault に追加
4. SQL Editor で `supabase/runbook/tutor-sweep-cron.sql` を実行する（`__SWEEP_URL__` を `https://<その環境の固定の URL>/api/tutor/sweep` に置き換えて）
   - Preview は、デプロイごとに変わる URL ではなく、ブランチの固定の URL（Branch URL）を使う
5. 確認：数分後、設定画面の「チャッピー先生」に「会話を終わらせる見回り：動いています（N秒前）」と出る。
   出ないときは SQL Editor で `select status_code, error_msg, created from net._http_response order by created desc limit 5;`（401＝CRON_SECRET と Vault の値が違う、Vercel の保護、404＝URL の誤り）

**Vercel Cron を使わない理由**：Vercel の Hobby プランでは Cron は1日1回までで、上の時間を守れない。プランに関係なく動く pg_cron を使う。

## 4. 検証の状況

確かめたこと（`npm run test:db`・`npm run test:e2e` の `tests/e2e/tutor-sweep.mjs`。OpenAI とブラウザの WebRTC は代役）
- 見回りの経路は本番と同じ：ローカルの Supabase の pg_cron（テストは5秒ごと）→ pg_net → アプリの `/api/tutor/sweep` → 代役の OpenAI の hangup
- 生存確認の停止・通信断・ブラウザの強制終了（キーは「保存しない」）：最後の生存確認から「途絶えたとみなす時間（テストは45秒）＋猶予35秒」以内に、サーバーが通話を切り、資格情報を消した
- 1回の上限時間：生存確認が来なくても、見回りが切った（開始時刻を11分前にずらして確認）
- アプリの強制終了と再起動：止まっているあいだは切れず（見回りの呼び出しの失敗は `net._http_response` に記録）、起動後の次の見回りで切った
- 切るのに失敗（代役が 500 を2回）：間隔をあけて再試行し、3回目で成功。各回を監査ログに残し、成功後に資格情報を消した
- 見回りが止まっているときは、新しい会話を始めない
- DB：資格情報は生徒・先生・管理者のだれも読めない、見回りの関数は service_role だけ、二重に取り出さない、保持の上限で消す

未検証（`docs/TUTOR-LIVE-CHECK.md`・`docs/TUTOR-DEVICE-CHECK.md`）
- **本物の OpenAI で hangup を呼んだとき、実際に通話（音声・課金）が止まるか**
- 本物の Vercel・Supabase（クラウド）で pg_cron → pg_net → Vercel の経路が動くか（Preview の保護・関数のコールドスタートの時間を含む）
- OpenAI 側の1通話の最大時間（公式資料に記載が見つからない）。`gave_up` になった通話がいつまで続くか

残る隙間
- OpenAI が通話を作ってから DB に通話ID を記録するまでの、ごく短い間にアプリが落ちると、その通話は記録されず切れない
  （記録に失敗したときは、その場で手元のキーで切る）
- 見回り自体（pg_cron・pg_net・アプリ）が止まっている間は切れない。止まって3分たつと新しい会話は始まらないが、進行中の会話は見回りが戻るまで続く
