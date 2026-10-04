# チャッピー先生（返却した答案の音声復習）導入ガイド

先生が確認・返却した答案について、生徒が間違えた問題を AI「チャッピー先生」と音声または文字で復習する機能です。
**追加の AI 利用料は、生徒本人または保護者が AI 提供元（OpenAI）と直接契約して支払います。** 学校・アプリの管理者は立て替えません。

---

## 1. 料金の支払者

| 費用 | 支払う人 | 備考 |
|---|---|---|
| チャッピー先生（アプリ内）の AI 利用料（音声・文字・文字起こし・音声合成） | **生徒本人または保護者**（OpenAI と直接契約） | 生徒が自分の API キーを登録する。管理者のキーは使わない |
| 外部の ChatGPT での復習 | **生徒本人**（本人の ChatGPT アカウントの条件・利用枠） | アプリの外の会話 |
| 採点 AI（Claude） | 学校（これまでどおり） | `ANTHROPIC_API_KEY`。チャッピー先生からは参照しない |
| ホスティング・DB・保存・通信など | 学校（これまでどおり） | 「管理者負担なし」はチャッピー先生の AI 利用料だけの意味 |

**追加の AI 利用料が管理者へ流れないことの確かめ方**（いずれも自動テストで確認済み）
- チャッピー先生のコード（`lib/tutor/`・`app/api/tutor/`・`components/tutor/`・`app/student/`）は、採点 AI（`lib/ai/`）・Anthropic SDK を読み込まず、
  `ANTHROPIC_API_KEY`・`OPENAI_API_KEY` を読まない（`tests/unit/tutor.test.ts` の依存関係の検査）
- OpenAI を呼ぶ関数は、引数で受け取った本人のキーだけを使う。環境変数の読み取りを記録し、管理者のキーに触れないことを検査（同上）
- キーの不備・残高不足・失効・混雑では、別のキーへ切り替えず理由を表示（同上・E2E）
- E2E では、アプリのサーバーに管理者のキー（`ANTHROPIC_API_KEY`・`OPENAI_API_KEY`）を置いたまま、OpenAI の代役が受けた要求のキーを全件記録し、
  すべて生徒本人のキーか短期の資格情報だったことを確認（`tests/e2e/tutor.mjs`）

## 2. 採用した方式と制限（2026-10-04 時点）

| 方式 | 状態 | 理由 |
|---|---|---|
| A. アプリ内音声（本人の OpenAI API 契約・BYOK） | **実装** | サーバーが本人のキーで `POST /v1/realtime/client_secrets` を呼んで短期の資格情報（60秒）を発行し、ブラウザはそれだけで `POST /v1/realtime/calls`（WebRTC）に接続する |
| B. 本人の ChatGPT で復習（外部アプリ） | **実装** | 「復習内容をコピー」「ChatGPT を開く」。ログイン・貼り付け・音声開始・会話の取得はアプリが行わない |
| C. Sign in with ChatGPT で本人の ChatGPT 契約をアプリ内で使う | **無効（実装しない）** | 公開の経路は、オープンソースやローカルで動くアプリが対象で、商用・リモートホスト型は別途申請が必要。対象は Responses API（`stream: true`・`store: false` などの制約）で、Realtime API は ChatGPT のプランのトークンを受け付けない |

- 公式ドキュメント（developers.openai.com）はこの開発環境のネットワークから直接開けなかったため、検索結果の要約で確認した。**導入前に公式資料で必ず再確認すること**：
  - WebRTC：https://developers.openai.com/api/docs/guides/voice-webrtc
  - 料金：https://developers.openai.com/api/docs/pricing
  - ChatGPT プランの利用：https://developers.openai.com/siwc/token-sharing-open-source ・ https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- **モデル名は固定していない**。生徒のキーで `GET /v1/models` を呼び、名前に `realtime` を含むものから本人が選ぶ（字幕用の文字起こしは `transcribe` を含むモデルがあれば使う）
- 音声の声は `marin`、ゆっくり話すときは `speed: 0.85`。イベント名は GA と以前の名前の両方を受け付けているが、**実機の OpenAI との接続は未検証**
- **未成年の利用**：OpenAI の利用規約上の年齢・保護者の同意の条件は、導入時点の規約で確認すること。保護者の契約を年齢制限の回避手段として扱わない。
  アプリでは、学校・クラスごとに有効にでき（既定は無効）、生徒は支払者（本人／保護者）を選んで利用条件を確認したことにチェックしないと使えない。
  使えない生徒は、返却画面で先生のコメント・（公開した場合）解説で復習する

## 3. 導入手順（管理者）

1. Supabase の SQL Editor で `0010_workflow.sql`・`0011_individual_return.sql`（未適用なら）→ **`0012_voice_tutor.sql`** を実行する。
   設定画面の「AI採点の準備状況」で 0012 が「済」になることを確かめる
2. （任意）生徒がキーを「暗号化して保存」できるようにするときは、Vercel の環境変数に `TUTOR_KEY_ENCRYPTION_KEY`（32バイトの乱数を base64）を入れる。
   作り方：`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`。**DB には置かない。変えると保存済みのキーは使えなくなる**。
   設定しない場合、生徒は「保存しない（画面を閉じるまで使う）」だけを選べる
3. （任意）概算料金を表示するときは `TUTOR_PRICES_JSON` に、OpenAI の料金表を見て単価（1M トークンあたりの米ドル）を入れる。無ければ概算料金は出さない
4. 設定画面の「チャッピー先生（生徒の音声復習）」で、学校で有効にし、使ってよいクラスにチェックし、1回・1日の上限（分）を決めて保存する
5. 止めるとき：設定画面で無効にする。緊急時は環境変数 `TUTOR_FEATURE=off`（チャッピー先生の API だけが止まり、採点は止まらない）

## 4. 先生の操作

1. テスト管理 →「設問と配点を見る」→「チャッピー先生（生徒の復習）用の設定」で、設問の**問題文**（生徒の画面に出し、生徒が同意すれば本人の契約の AI に送る）と、
   **返却時に正答・解説を生徒に見せるか**を決めて保存する（氏名などの個人情報は書かない）
2. 採点結果を確認・修正し「確認済みにする」→ 返却（一括返却・個別返却。生徒の配信先の登録が必要）
   - 返却内容は返却した時点の写し。**確認後に点数・コメントを直すと再確認が必要**で、未確認の修正は生徒に出ない
   - 同じ内容の返却を二度押し・再送しても、版も通知も増えない。内容を変えて返し直すと「第2版」として生徒の受信箱に「更新」が1件届く
3. 答案詳細の「設問別採点」タブの「生徒への返却と復習」で、返却の版・チャッピー先生の利用回数と時間・問題ごとの復習の状態を見る。
   生徒の理解を確かめたら「理解確認済みにする」（生徒は自己申告までしか付けられない）。
   振り返り・会話の文字起こしは、生徒が共有に同意したときだけ見える

## 5. 生徒の操作（スマホ・タブレット）

1. `/student` に自分のアカウントでログイン → 受信箱（新着・更新）→ 返却されたテスト → 間違えた問題 →「チャッピー先生に聞く」
2. はじめに「チャッピー先生の設定」で、料金の説明を読み、支払者（本人／保護者）・送る内容を選んで同意する
3. **キーの登録（アプリ内で話すとき）**
   1. 本人（または保護者）が OpenAI のサイトでアカウントと支払い方法を設定し、API キーを作る（アプリの外で行う）。予算・通知も設定する
   2. 設定画面の「OpenAI API キー」欄に貼り付け、「保存しない」または「暗号化して保存する」を選んで「キーを確かめて登録」
   3. 使うモデルを選ぶ（料金はモデルで違うので、OpenAI の料金表で確かめる）
   - キーはチャット・メール・メモに書かない。画面には末尾4文字だけが出る。先生・管理者も見られない
4. 問題カードで「音声で質問する」（マイクの許可を求める）または「文字で質問する」。会話中は「もう一度説明」「ヒント」「自分で解く」「復習を終了（まとめ）」
   - 状態（接続中／聞き取り中／考え中／発話中／停止／エラー）を表示し、「マイクを止める」「会話を終える」はいつでも押せる
   - チャッピー先生の言葉は字幕でも出る。自分の発言の聞き取り（字幕）が違うときは「聞き取りを直して送る」
   - マイクを許可しない・使えない端末では、文字で質問できる
   - 画面を離れる（別のアプリ・ロック）と会話は自動で終わる。1回の時間・1日の時間に上限がある
5. **キーの削除**：設定画面の「保存したキーを削除」。OpenAI 側のキーは消えないので、不要なら OpenAI の管理画面でも無効にする
6. **外部の ChatGPT で復習**：「復習内容をコピー」→「ChatGPT を開く」→ 自分のアカウントで貼り付け、必要なら自分で音声モードを始める。
   終わったら振り返りを書いて記録する（自己申告として残る）
7. **学習データの削除**：設定画面の「学習データを消す」（復習の状態・振り返り・文字起こし。キーの削除とは別。先生の「理解確認済み」と利用時間の記録は残る）

保護者：OpenAI の契約・支払い・予算の設定を行い、生徒の端末でキーを登録する（またはキーを渡して生徒が登録する）。キーは保護者の管理画面でいつでも無効にできる。

## 6. 外部の AI へ送るもの・送らないもの

- 送る（選んだ1問だけ）：問題番号・問題文（先生が入力した場合）・判定と得点・学年と教科・（同意した場合）本人の解答の読み取り結果・先生のコメント・（先生が公開した場合）正答と解説
- 送らない：氏名・学校名・出席番号・受験番号・匿名ID・メールアドレス・顔・答案の画像・ほかの生徒の情報
- 各問題の「送る内容を見る」で、実際に送る文章を確かめられる
- 答案やコメントの文章は「資料」として渡し、その中の指示には従わないよう AI に指示している。AI には採点・権限・契約を変える操作を渡していない
- 音声の録音はアプリに保存しない。会話の文字起こしは、本人が「保存する」に同意したときだけ保存し、先生への共有も同意したときだけ。同意を撤回すると文字起こしは消える

## 7. 仕組み（開発者向け）

- DB（`0012_voice_tutor.sql`）：`result_releases.version`・`result_release_history`（教職員のみ）・`student_inbox`（(返却,版) で一意）、
  `tutor_consents`・`tutor_credentials`（本人のみ。暗号文）・`tutor_sessions`（同時1件・1時間6回・1日の上限・90秒無応答で終了）・`tutor_progress`（「理解確認済み」は先生だけ）・
  `tutor_reflections`・`tutor_transcripts`（同意したときだけ。共有も同意したときだけ）、`schools.tutor_*`・`classes.tutor_enabled`・`questions.prompt_text`・`tests.release_model_answer`。
  生徒の操作は `current_student_id()`（auth.uid() から決める）で本人に限る。クライアントの生徒IDは信用しない
- API（`app/api/tutor/*`）：同じサイトからの要求か（Origin・Sec-Fetch-Site）、HTTPS か（キーを受け取るとき）、キー登録は10分に5回まで、監査ログ（秘密・会話の中身は残さない）、応答はキャッシュさせない
- キーの暗号化：AES-256-GCM、追加認証データに生徒ID（`lib/tutor/crypto.ts`）。暗号鍵は環境変数だけ
- ブラウザ：`lib/tutor/realtime-client.ts`（WebRTC・データチャネル `oai-events`）。終了・切断・バックグラウンド・画面を閉じたときにマイク・接続・サーバーの会話を終える。
  生徒の画面と API は `cache-control: no-store`。ログアウトで sessionStorage・Cache Storage を消す
- 機能の停止：`schools.tutor_enabled`（画面）・`TUTOR_FEATURE=off`（緊急）

## 8. 元に戻す（ロールバック）

画面から使えなくするだけなら、設定画面で無効にする（データは残る）。テーブルごと消すときは、**返却の受信箱・版の履歴も消える**ことを確認してから実行する：

```sql
begin;
drop trigger if exists result_releases_enrich on public.result_releases;
drop trigger if exists result_releases_after on public.result_releases;
drop trigger if exists tutor_consent_revoked on public.tutor_consents;
drop table if exists public.tutor_transcripts, public.tutor_reflections, public.tutor_progress, public.tutor_sessions,
  public.tutor_credentials, public.tutor_consents, public.student_inbox, public.result_release_history;
drop function if exists public.result_releases_enrich(), public.result_releases_after(), public.tutor_consent_revoked(),
  public.start_tutor_session(uuid, integer, text, text), public.heartbeat_tutor_session(uuid, integer),
  public.end_tutor_session(uuid, text, integer, jsonb), public.mark_inbox_read(uuid), public.set_tutor_settings(boolean, integer, integer, uuid[]),
  public.tutor_status(), public.tutor_log(text), public.tutor_shared_with_teacher(uuid), public.current_student_id(), public.current_student_school(), public.is_staff();
alter table public.result_releases drop column if exists version;
alter table public.schools drop column if exists tutor_enabled, drop column if exists tutor_session_minutes, drop column if exists tutor_daily_minutes;
alter table public.classes drop column if exists tutor_enabled;
alter table public.questions drop column if exists prompt_text;
alter table public.tests drop column if exists release_model_answer;
commit;
```

返却済みの内容（`result_releases.payload`）に 0012 で加えた項目（本人の解答・問題文・公開した正答と解説・学年と教科）は残る。

## 9. 検証の状況

実行済み（すべて代役の OpenAI。本物の OpenAI は呼んでいない）
- DB（`npm run test:db`、`supabase/tests/tutor_test.sql`）：返却前は見えない・二重返却で版も通知も増えない・確認後の修正は再確認まで出ない・再返却で版2と「更新」1件、
  他の生徒の返却・同意・キー・会話・状態・振り返りが見えない・他人の返却で会話を始められない、管理者・教員は生徒のキーを見られない、
  同時1件・1時間6回・経過時間の過大申告を受け付けない、「理解確認済み」は先生だけ・生徒は戻せない、同意なしの文字起こしは保存できない・撤回で消える、復習しても採点は変わらない
- 単体（`npm run test:unit`、`tests/unit/tutor.test.ts`）：管理者のキーを読まない・依存関係の分離・キーの暗号化・エラー時に切り替えない・送る資料の範囲
- E2E（`tests/e2e/tutor.mjs`、36項目）：スマホ幅の生徒画面で、返却→受信箱→間違えた問題→同意→キー登録（誤ったキー・暗号化保存）→文字の会話→同時2件の拒否→終了、
  マイク拒否→文字への案内、音声→画面を離れると停止、残高不足・失効、他の生徒・他のサイトからの操作の拒否、キー削除後に始めない、外部の ChatGPT へのコピーと振り返り、
  先生の「理解確認済み」、確認後の修正と返し直し、ログアウト、ビルド成果物・アプリのログに生徒のキーが含まれない

未検証・設定待ち
- **本物の OpenAI Realtime との接続（WebRTC の音声・イベント名・料金の数値）**：E2E はブラウザの RTCPeerConnection を代役にしている
- **iPhone / iPad の Safari、Android の Chrome の実機**（マイクの許可・バックグラウンドへの移行・音声の再生）
- OpenAI の年齢・保護者の同意の条件（導入時点の規約で確認）、プッシュ通知（未実装。受信箱で受け取る）、メール通知（実装しない）
- 図が必要な問題の図は AI に送っていない（画像から個人情報を除いて切り出す処理は未実装。図の様子は生徒に尋ねるよう指示している）
- AI による理解確認の判定は実装していない（会話はブラウザと OpenAI の間で行われ、サーバーで確かめられないため）。生徒の自己申告と先生の確認だけ
