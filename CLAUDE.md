# テスト採点ver.3

答案画像をアップロードすると、AIが採点・赤ペン添削・弱点分析までを自動で行う学校向けWebアプリ。

このファイルは Claude Code がセッション開始時に自動で読み込むプロジェクト記憶です。
作業を引き継いだら、まず「現在地」と「次のタスク」を確認してください。

---

## 現在地

**Next.js 14 への移植・Supabase 接続・採点AI（Claude Vision）の実装が完了。**（2026-09-28）

- 全15画面 + ログイン画面が `app/` 配下で動く。データは Supabase に保存され、再読み込みしても残る。
- Supabase の接続情報（`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`）が無いと **デモモード** で起動する。
  デモモードはプロトタイプと同じデモデータで全機能を試せるが、何も保存しない（画面上部に「デモモード（保存されません）」と出る）。
- 採点AI: サーバーの `ANTHROPIC_API_KEY` があれば、「新規採点」は画像を保存して続けて AI 採点する。
  保存済み（AI採点待ち）の答案も「採点中」画面・答案詳細から採点できる。キーが無ければ画像の保存だけ。
- 本番 Supabase（ユーザーのプロジェクト）には 0001〜0003 を適用済み（2026-09-28）。**0004〜0013 はまだ**（0005 はモデル比較試験、0006 は採点方式と AI採点の記録、0009 は赤ペンの位置、0010・0011 は返却、0012 は返却の版・受信箱とチャッピー先生、0013 はチャッピー先生の見回り）。
  Vercel の Preview で、ログイン・名簿表示・答案画像の保存まで動作確認済み（ユーザー報告）。
- **本物の Claude API での採点はまだ一度も実行していない**（開発環境にキーが無い）。
  E2E はリクエストの形を検査する代役サーバー（`tests/e2e/mock-anthropic.mjs`）で検証している。
- `docs/prototype-v3.jsx` は移植元として残している。今後の変更は `app/` / `components/` / `lib/` に対して行う。

---
## 次にやること（優先順）

### 1. 本番で AI 採点を動かす ← ユーザー作業待ち

- **順序（ユーザーの決定）：検証環境 → 本番は後回し**。`docs/DB-RUNBOOK.md` 第1部：本番とは別の Supabase プロジェクトに 0001〜0013 を適用 →
  Vercel の Preview（Preview だけの環境変数）をそこへつなぐ → 見回り（`docs/TUTOR-SWEEP.md`）→ OpenAI の実接続（`docs/TUTOR-LIVE-CHECK.md`）→ 実機（`docs/TUTOR-DEVICE-CHECK.md`）。
  本番（第2部：バックアップ2種 → check.sql → 1ファイルずつ → check.sql）は第1部が終わり、ユーザーが決めてから。戻すときは drop せず、機能停止・Instant Rollback・新しい番号のファイルで
- 本物の OpenAI：`npm run tutor:live-check` は `GET /v1/models` の1回だけ（料金がかからないことは料金表で未確認なので「無料」と書かない）。`-- --paid`・Preview での会話・実機は**ユーザーの指示があってから**
- Preview で誤登録の模擬テスト（1問・満点4点・採点済0枚）をごみ箱から削除する（ユーザー作業）
- Preview で模範解答（20問・100点・5・5・1・3・1・3・2）から自動入力し、読み取り精度を確かめる
- Preview で「3モデル併用」を試し、Sonnet・Opus に回った割合（目安 20%・5%）と実際の費用を「AI採点の記録」で確かめる
- Preview で管理者がモデル比較試験（`/compare`）を実行し、結果を確認する
- Vercel に `ANTHROPIC_API_KEY` を設定して再デプロイする（`docs/SUPABASE-SETUP.md` ステップ6.5）
- 保存済みの確認用答案（「2＋3＝5」）を「採点中」画面から AI 採点し、○・4点になるか確かめる
- 実際の答案で、読み取り精度・bbox（赤ペンの位置）の精度・1枚あたりの時間と費用を確かめる。
  bbox がずれる場合は「清書版」表示で運用できる
- Preview で、3モデル併用で採点済みの2ページ答案（赤ペンがずれていた答案）を開き、赤ペンが解答欄の右・各行の中央に出るか、
  「位置の要確認」の設問を確かめる（AI を呼ばずに表示が変わる。動かした位置の保存は 0009 が必要）

### 1b. Supabase のスキーマ（参考）

`docs/SUPABASE-SETUP.md` のステップ1〜5（SQL は 0001 → 0002 → 0003 → 0004 の順）。
エラーが出たらエラー文を元に直す。ただし **本番に一度でも流したマイグレーションは書き換えず、新しい連番ファイルで直す**。

ローカルでは次の2段階で検証済み（スキーマを変えたら両方通すこと）:
- `npm run test:db` … 素の PostgreSQL + Supabase 模擬環境で RLS・トリガー・ビューを検証（`supabase/tests/rls_test.sql`）。
  root 環境では `su postgres -c "bash supabase/tests/run.sh"`
- `npm run test:e2e` … Supabase CLI のローカル環境（Docker）にアプリを繋ぎ、ブラウザで教員の作業を通しで検証（`tests/e2e/`）。
  採点AIは代役サーバー（本物の API は呼ばない）。ECR に届かない環境では `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io` を付ける
- `npm run test:db` には `supabase/tests/workflow_test.sql`（返却）・`tutor_test.sql`（受信箱・チャッピー先生）・`tutor_sweep_test.sql`（見回り）・`upgrade_test.sh`（0001〜0003＋既存データの DB に 0004〜0013 を足す：途中失敗で何も残らない・2回目はエラー・件数と合計が変わらない）も含まれる
- `npm run test:e2e` は `tests/e2e/tutor.mjs`（返却・チャッピー先生）→ `scenario.mjs`（教員の作業）→ `fullflow.mjs`（答案登録→採点→教師確認→返却→復習を画面で1本に）→ `tutor-sweep.mjs`（ブラウザが来なくても見回りが通話を切る。アプリを再起動するので最後）の順。
  ローカルの Supabase に pg_cron（5秒ごと）→ pg_net → `http://host.docker.internal:3200/api/tutor/sweep` を登録して、本番と同じ経路で動かす
- `npm run test:unit` … チャッピー先生（管理者のキーを使わない・依存関係の分離・暗号化）・赤ペンの置き場所（罫線の検出・表への割り当て。実物の写真は REDPEN_REAL_DIR があるときだけ）・採点AIの出力の後処理（`normalizeResult`）・3モデル併用の振り分けと料金の目安・比較試験・HEIC 変換（`tests/fixtures/sample.heic` は合成画像）の単体テスト

検証中に見つけて直したもの（0001/0002 は未適用だったので直接修正、0003 で追加修正）:
- サインアップ時の `user_metadata` で任意校の管理者になれた → `app_metadata` から読むよう変更
- 教員が `profiles.role` を自分で `admin` に書き換えられた → 更新可能列を `display_name` / `ui_lang` に限定
- 監査ログの `digest()` が Supabase（pgcrypto は `extensions` スキーマ）で見つからず INSERT が全て失敗 → search_path に追加
- `verify_audit_chain` が security definer で他校のログを覗けた → security invoker に変更
- `purge_expired_submissions` を未ログインでも実行できた → service_role のみに限定
- 監査ログの `actor_id` を他人に偽れた / 学校既定ルーブリックが重複できた / `submission_links` に UPDATE ポリシーがなかった
- （0003）採点完了後も status が `processing` のまま残った → progress = 100 なら done / review / quality を判定
- （0003）分析ビューが白紙答案を 0 点として集計していた → 除外。設問形式別・ミス傾向・クラス別設問正答率のビューを追加

### 2. 採点AI（実装済み）の仕組みと、残りの接続ポイント

- `app/api/grade/route.ts`（POST `{ submissionId, mode, requestId }`）が採点する。**教員のセッション（RLS）で** 答案・設問・採点基準・画像を読み、
  `lib/ai/grade.ts` の `callClaude()` で Claude に送り、`normalizeResult()` で整えてから `save_ai_grading()`（0004）で保存する。
  service_role は使わない。サーバーに置く秘密は `ANTHROPIC_API_KEY` だけ
- モデルは `claude-opus-5`（`ANTHROPIC_MODEL` で変更可）。adaptive thinking・effort high・structured outputs（JSON スキーマ）。
  拒否されたときの自動再実行（`fallbacks: "default"`、beta `server-side-fallback-2026-07-01`）を有効にしている（`ANTHROPIC_FALLBACKS=off` で無効）
- **AI の出力はそのまま信じない**: 得点は判定に合わせて 0〜配点に決め直し、判定と得点が食い違えば要確認。
  信頼度 < `rubrics.review_threshold`、記述問題で `require_teacher`、AI が返さなかった設問も要確認。設問ID は DB 側で qno から決める
- 失敗したら答案の状態を元に戻す（AI採点待ちのまま）。1枚ずつ順に採点する（Vercel の関数は `maxDuration = 300`）
- **採点方式（0006）**: 「Opus単独」と「3モデル併用」（`lib/ai/cascade.ts`）。新規採点で選び、端末に覚える（採点中・答案詳細でも切り替え可）
  - 3モデル併用: 全答案を Haiku（`claude-haiku-4-5`、thinking なし）→ 点検で理由が残れば Sonnet（`claude-sonnet-5-5`、adaptive・effort high）→ さらに残れば Opus。
    点検の理由は 回答の欠落 / 判読不能・無記入なのに文字 / 判定と得点の食い違い / 部分点なしの△ / 正答との照合と判定の矛盾 / 画質 / 応答が使えない / 自信が低い（confidence は理由の1つにすぎない）。
    記述の教員確認必須は上に回す理由にしない。Opus でも残った理由と、Sonnet と判定が分かれた設問は要確認にし、理由を `ai_raw.grading.review_reasons` と `grading_jobs.decision` に残す
  - Sonnet 20%・Opus 5% は料金試算の目安（`lib/grading/cost.ts`）で、上限ではない
  - 1回の要求で呼ぶモデルは1つ。画面が同じ requestId で続きを要求する（`lib/data/supabase.ts` の `aiGrade`）
  - 二重課金の防止: requestId ごとに `grading_jobs` を1つ / 同じ答案の実行中は1つ（一意索引）/ 各段階は呼ぶ前に `grading_stages` の行を作る（job_id, stage 一意、確定後は変更不可）
  - 途中失敗: 保存は `finish_grading_job()` で記録の確定と同じトランザクション。失敗・時間切れ（10分）は `fail_grading_job()` が状態を採点前に戻す
  - 記録: 各段階のモデルID・採点結果・理由・トークン数・概算費用。答案詳細の「AI採点の記録」タブ、採点履歴の「採点方式」列
  - 0006 を実行する前の DB でも画面は動く（採点方式の列が無ければ外して読み直す）が、AI採点は 0006 が必要
- 画像はブラウザで長辺 2400px の JPEG に縮小してから保存する（`lib/image.ts`。API の上限は1枚5MB）
- HEIC（iPhone の写真）: ブラウザが読めれば（Safari）そのまま、読めなければ `heic-to`（libheif の WASM、LGPL-3.0、HEIC のときだけ動的読み込み）で JPEG に変換してから保存する。
  以前に HEIC のまま保存された答案は、採点時にサーバーで変換する（`lib/ai/heic.ts`、`heic-decode` + `jpeg-js`。`next.config.mjs` で外部パッケージ扱い）
- 1人分を複数枚で撮った答案: 「新規採点」の「1人分の答案の枚数」で N 枚ずつ同じ生徒にまとめる（同じ生徒を選んだ写真もまとめる）。1答案10ページまで。採点AIには全ページを送る
- 設定画面の「AI採点の準備状況」（`/api/health`）で、Supabase・ANTHROPIC_API_KEY・0004〜0009 がそろっているかを確認できる（値は返さない）
- **模範解答からテストを自動作成（0007）**: テスト管理 →「テストを追加」→「模範解答・配点表から自動入力」（`components/screens/NewTestForm.tsx`）
  - 資料は 模範解答（必須）/ 問題用紙・配点表 / 生徒の答案（印刷された配点だけ）。画像・PDF・HEIC（ブラウザで JPEG 化）、複数ページ可。
    Storage の `{school_id}/imports/{requestId}/` に置き、`app/api/test-import/route.ts` が Opus（adaptive・effort high・stream）で読み取る
  - 後処理 `lib/ai/test-import.ts` の `normalizeImport`：配点は印刷されたものだけ確定（無ければ空欄＋要確認、候補は placeholder）。
    正答は模範解答の資料から読めたものだけ（読めない・生徒の答案から → 空欄＋要確認）。作図は「右図」を使わず、模範図の位置（`questions.figure`）と採点条件（`model_answer`）を教員が確認
  - 大問・小問は原本どおり（`questions.big` と label「大問1-(1)」／小問が無ければ「大問3」）。以前の「4問ずつ大問を振る」方式は廃止
  - 要確認の設問は「確認した」にチェックしないと登録できない。配点が空欄でも登録できない。合計点と原本の満点が違えば表示し、登録時に確認する
  - 元画像と入力欄を並べて表示（行を選ぶと該当箇所を枠で示す）。入力途中は IndexedDB（`lib/draft.ts`）に下書き（資料のファイルごと）。上書き前に確認
  - 重複実行の防止：requestId の再送は同じ読み取り、同じ資料（内容の sha256＋種類）は実行中なら断り、終わっていれば結果を再利用（`test_imports`）
  - 登録時：模範解答・問題用紙は `tests.answer_key_paths` に残し、生徒の答案は Storage から消す。テスト詳細から模範図を見られる
  - 画面：元画像と設問欄は別の枠（広い幅は左右・画像の枠は内部スクロール、狭い幅は上下）。フッターの「画像を隠す／画像を表示」で切替（端末に記憶）。
    設問の参照は資料の id（`Ref.sourceId`）。旧形式の下書き（v1、資料の番号で参照）は復元時に変換する
  - 資料の削除：ファイル名と影響（作図の模範図の参照元・該当箇所の表示）を示して確認。設問は消さず、参照が外れた作図は要確認に戻す
  - 下書きは URL（オリジン）ごとに別。Preview の URL が変わったら移す（`docs/DRAFT-MOVE.md`）：
    「下書きを書き出す／読み込む」（`lib/draft-file.ts`、JSON に資料の画像を base64 で同梱）／書き出しボタンが無い旧版は `docs/draft-export-snippet.js` をコンソールに貼る／
    予備に「以前のAI読み取り結果から再開」（`test_imports` の未登録・自分の結果。手で直した内容は含まない）。どれも AI を呼ばない
- **テストの削除（0008）**: テスト管理の各カードのごみ箱（管理者だけ）。`remove_test()` が答案0枚なら削除、答案があればアーカイブ（`tests.archived_at`）。
  `tests_protect_delete` トリガーで答案があるテストの直接 DELETE も拒否（0001 の on delete cascade で成績が消えるのを防ぐ）。アーカイブは一覧・新規採点の選択肢から隠し、成績・分析には残す。`restore_test()` で戻す
- 赤ペン（原本に重ねる版。0009）: 置き場所は `lib/redpen/layout.ts` の `layoutMarks()` が決め、画面・PNG 保存・印刷で同じものを使う
  - AI の `bbox` は「だいたいの場所」で1行ずれることがある（以前はそれをそのまま描いていた＝ずれの原因）。
    ブラウザで原本の罫線を調べ（`lib/redpen/frames.ts`。画像は外部に送らない・AI は呼ばない）、**ページ内の解答欄の表を AI の位置に頼らずに全部集め**（`allColumns`）、
    大問ごとに「行数＝小問の数」で AI の位置（大問の中心）に一番近い表を選び、**小問の順番どおりに上から割り当てる**（1行ずれ・表の外への数行のずれ・位置なし・ページ違いも直る）。
    同じページでページ高さの3割より遠い表には割り当てない。表の並びと大問の順番が逆になった組は外す。
    AI の位置が1つも無い大問は、前後の大問の表と縦に並ぶ行数の同じ表が1つだけなら推定で置き「位置の要確認」。
    合わなければ AI の位置を囲む枠（行数が合わないので要確認）、無ければ bbox（枠のあるページでは要確認）
    （以前は AI の位置を囲む表しか探さなかったため、実例の2ページ目で AI の位置が表の数行下にあると表が見つからず、AI の位置のまま要確認も付かなかった）
  - 作図（graph）は枠を使わず、AI が返した作図の範囲。マークは基準の枠の右・上下中央、ページ内で同じ大きさ。同じ表の行は横位置をそろえ、
    右に空きが無ければ画像の外の余白に置いて枠の右端から点線で結ぶ。合計点は1ページ目の上の帯（答案に重ねない）
  - コメントは原本に書かず、横（狭い画面は下）の欄（`components/RedPenPanel.tsx`）。**表示中のページの設問だけ**を並べ（位置が分からない設問はどのページにも出す）、ほかのページの要確認は件数で知らせる
  - 位置の要確認：位置なし・答案に無いページ・同じ欄を2問が指す・順番と並びが逆・枠のあるページで枠が見つからない・大きさが不自然
  - 先生は ○×△ をドラッグ／矢印キーで動かせる。`mark_positions`（0009。答案×設問で1行、マークの中心の割合、右の余白は x>1）に保存。
    判定・得点・コメント・要確認・合計点・状態には触れない。「位置を元に戻す」は行を消す。「この位置でよい」「N ページ目へ移す」（要確認・調整済み・選んだ設問）もある。
    答案を取り込み直す（uploaded_at が変わる）と消える。0009 が無い DB でも表示はできる（保存だけ失敗して案内する）
  - 「赤ペン画像を保存」は原本を埋め込んだ PNG、「印刷」は全ページを PNG にして印刷（`lib/redpen/export.ts`）。HEIC のまま保存された以前の答案は表示時に JPEG に変換
    - 保存のたびに署名付きURLを取り直して写真を取得し（`loadPhoto`。HTTP エラー・画像でない応答は例外）、canvas に写真を直接描いてから赤ペンの SVG を重ねる（`composePng`）。
      写真の部分が単色・縦横比が画面と違うときも例外にし、原本の無い PNG は保存しない（「画像は保存していません」と表示）
    - 以前は画面を開いたときの署名付きURL（10分で期限切れ）から取り直し、応答を確かめずに埋め込んでいたため、10分を過ぎて保存すると白地に赤ペンだけの PNG になった
  - 今後の採点では、指示文で bbox を「解答欄の枠全体（作図は描いた範囲）」と指定している（以前は「解答が書かれている場所」）
- 「清書版」（`RedPenSheet`）は固定レイアウトのまま（原本の座標には使わない）

- **チャッピー先生（0012。生徒の音声復習）**：返却した答案の間違えた問題を、生徒が AI と音声・文字で復習する。詳細は `docs/VOICE-TUTOR.md`
  - **AI 利用料は生徒本人または保護者が OpenAI と直接契約して支払う（BYOK）。管理者のキーへは、失敗・再試行を含めどの経路でもフォールバックしない**
  - 接続：ブラウザは SDP を作るだけ。**サーバーが本人のキーで `POST /v1/realtime/calls`**（multipart）を呼んで通話を作り、`tutor_sessions.call_id` に記録。
    上限時間・学校/クラスの停止・同意の撤回・キーの削除・`TUTOR_FEATURE=off`・終了で、サーバーが `/v1/realtime/calls/{id}/hangup` を呼ぶ（生存確認は20秒ごと、DB の `heartbeat_tutor_session` が理由を返す）。
    短期の資格情報（client_secrets）は使わない（期限は「会話を始められる期限」で会話の時間制限にならないと公式仕様に明記）
  - **見回り（0013、`docs/TUTOR-SWEEP.md`）**：ブラウザが来なくても切る。Supabase の pg_cron（30秒ごと）→ pg_net → `/api/tutor/sweep`（`CRON_SECRET` で認証、`SUPABASE_SERVICE_ROLE_KEY` は見回りの2関数だけに使う）。
    `tutor_sweep_due()` が上限時間・停止・撤回・緊急停止・生存確認の途絶（`TUTOR_STALE_SECONDS`、既定90秒）で会話を終え、切れていない通話を予約して返す → 本人のキーで hangup → `tutor_sweep_record()`（失敗は10秒・20秒…最大10分で再試行、監査ログ）。
    会話ごとの資格情報 `tutor_call_secrets`（本人のキーを暗号化。AAD は会話ID。RLS で全拒否）は切り終えたらすぐ消し、遅くとも「上限時間＋30分」で消す（gave_up）。
    そのため「保存しない」キーもブラウザから送るのは開始の1回だけ。暗号鍵が無い・見回りが3分止まっている（`tutor_sweeper_ok()`）なら会話を始めない。Vercel Cron は Hobby が1日1回なので使わない
  - モデルは `lib/tutor/models.ts`（公式 SDK 7.27.0 の `RealtimeSessionCreateRequest.model`）と本人のキーの `/v1/models` の両方にあるものだけ
  - キーを読めるのは：先生・管理者はアプリ・RLS では不可。ただし暗号文（Supabase）と `TUTOR_KEY_ENCRYPTION_KEY`（Vercel）の両方を扱える運用者は技術的に復号できる。画面・文書もこの区別で説明する
  - `lib/tutor/`（サーバー：`crypto.ts` AES-GCM・`openai.ts` 本人のキーだけ・`prompt.ts` 指導方針と1問分の資料・`server.ts` 本人確認/CSRF/HTTPS/`hangupSessions`）、`app/api/tutor/*`、
    `lib/tutor/realtime-client.ts`（ブラウザの WebRTC）、`components/tutor/`（生徒の `TutorPanel`・`TutorSettings`、教職員の `TeacherTutor`）、生徒画面 `app/student/page.tsx`（受信箱 → 間違えた問題 → チャッピー先生）
  - チャッピー先生のコードは `lib/ai`・Anthropic SDK・`ANTHROPIC_API_KEY`・`OPENAI_API_KEY` に依存しない（`tests/unit/tutor.test.ts` で静的に検査）。この分離を崩さないこと
  - Sign in with ChatGPT（方式C）は商用・ホスト型と Realtime が対象外のため無効。OpenAI の年齢・保護者の同意の条件は未確認（規約ページに届かない）
  - 生徒の操作は `current_student_id()`（auth.uid()）で本人に限る。キーの暗号文は本人しか読めず、暗号鍵は環境変数 `TUTOR_KEY_ENCRYPTION_KEY`（DB に置かない）
  - 「理解確認済み」は先生だけ。生徒は自己申告まで。復習で正式な採点・赤ペン・コメントは変わらない
  - 返却：`result_releases` は内容が変わったときだけ版を上げ、`student_inbox` に (返却,版) で1件。同じ内容の返し直しは何もしない（`result_releases_enrich` が返却内容に本人の解答・問題文・公開した正答と解説を加える）

まだ生成AIに置き換えていないもの（`// PROD-API:` コメントが残っている）:
- `buildFeedback`（生徒向けフィードバック・教師向け指導提案）/ `buildModelAnswers`（白紙時の模範解答）… テンプレート文面のまま。`model_answer_sets` は未使用
- 為替レート・請求（Stripe）… デモ表示のまま

### 3. 生徒モバイル提出（Edge Function）

`submission_links` テーブルにトークンを発行し、Edge Function（service_role）が検証してアップロードを代行する。
**生徒はログインしない設計。** 提出時に氏名を入力させず、出席番号だけで受け付ける。
画面側は「新規採点」の「生徒モバイル提出」が「準備中」になっている。

### 4. 保存期間による画像の削除

`purge_expired_submissions()` は DB 上で論理削除して `image_paths` を空にするだけで、**Storage の画像ファイルは消えない**。
現在の Supabase Storage は SQL での `storage.objects` 削除を禁止している（Storage API を使えというエラーになる）。
service_role のサーバー処理（Edge Function など）で、期限切れ答案の画像を Storage API で削除する処理が必要。

---

## 設計上の絶対条件

この4つは要件の中核であり、実装を変更するときも崩してはいけません。

### 1. 生徒の実名を保存しない

`students` テーブルに**氏名カラムを作らない**。DBスキーマのレベルで実名を持てない構造にしてある。
表示は4形式のみ: 学年＋クラス＋出席番号 / 受験番号 / イニシャル / 匿名ID。
答案から氏名を読み取れても、保存も表示もしない。

### 2. マルチテナント分離

全業務テーブルに `school_id` を持たせ、RLSで他校を遮断する。
新しいテーブルを追加するときは、**必ず `school_id` とRLSポリシー4種（select/insert/update/delete）をセットで作る。**

### 3. service_role キーをブラウザに出さない

`SUPABASE_SERVICE_ROLE_KEY` に `NEXT_PUBLIC_` を付けない。
付けるとRLSを無視して全校のデータが読めてしまう。

### 4. AI採点は下書き

最終的な成績評価は教員が行う。記述問題は `rubrics.require_teacher` が真なら確認必須。
返却前に「要確認一覧」を消化する運用を前提とする。

**答案を読んでいない点数を、本物の採点結果として保存しない。** Supabase 接続時、点数を付けるのは採点AIだけ。
採点AIが無い環境の既定は「画像だけ保存（AI採点待ち）」。乱数の仮採点は採点AIが無い環境でのみ、明示的なチェックで選べ、画面に「点数は答案と無関係」と出す。

---

## アーキテクチャ

```
Next.js 14 (App Router, TypeScript)
  ├── middleware.ts              セッション維持 + 未ログインを /login へ（Supabase 未設定なら素通し＝デモモード）
  ├── app/
  │   ├── login/                 教職員ログイン（生徒はログインしない）
  │   ├── api/grade/             採点AIの Route Handler（サーバー専用。ANTHROPIC_API_KEY を使う）
  │   └── (dashboard)/           15画面。各 page.tsx は components/screens/* を表示するだけ
  │       └── history/[id]/      採点結果の詳細（赤ペン画像・修正・分析）
  ├── components/
  │   ├── AppShell.tsx           外枠（サイドバー・ヘッダー）と共有状態。初回にマスタ・答案・採点基準を読む
  │   ├── ui-context.ts          useUI()。画面はここから ws / subs / 操作（editItem・reviewSub など）を取る
  │   ├── ui.tsx                 Card / Btn / Table / Modal などの共通部品（プロトタイプから移植）
  │   ├── RedPenSheet.tsx        赤ペン採点画像（清書版・SVG）
  │   ├── RedPenOverlay.tsx      原本画像の上に赤ペンを重ねる（AI の bbox を使う）
  │   └── screens/               各画面
  └── lib/
      ├── types.ts               画面が使う型（camelCase）
      ├── data/source.ts         DataSource インターフェース（画面はこれだけを通して読み書きする）
      ├── data/supabase.ts       本番。lib/db/grading.ts を呼ぶ
      ├── data/demo.ts           デモモード。メモリ上で動く（本番のトリガー・ビューと同じ規則を JS で再現）
      ├── db/grading.ts          Supabase のデータアクセス層（snake_case → camelCase 変換）
      ├── ai/grade.ts            採点AI（Claude 呼び出し・指示文・出力の後処理）。サーバー専用
      ├── image.ts               答案画像の縮小（ブラウザ）
      ├── redpen/                原本の赤ペンの置き場所（罫線の検出・表への割り当て・PNG/印刷）
      ├── tutor/                 チャッピー先生（本人の OpenAI キーだけを使う。lib/ai に依存しない）
      ├── grading/engine.ts      仮採点（ルールベース）・1枚単位の分析・文面生成・定数
      ├── demo/data.ts           デモデータ（デモモード専用）
      ├── i18n.ts / ui/theme.ts  多言語・テーマ
      ├── errors.ts              エラーを「何が起きたか＋どう直すか」の日本語にする
      └── supabase/{client,server}.ts

Supabase
  ├── PostgreSQL             17テーブル + RLS + トリガー + 分析ビュー + AI採点の保存関数（supabase/migrations/0001〜0009）
  ├── Storage                answer-sheets（非公開・署名付きURLのみ）。パスは {school_id}/{test_id}/{submission_id}/{page}.{ext}
  └── Auth                   教職員のみ。所属校と役割は app_metadata で付与（一般サインアップでは所属が付かない）
```

画面の状態の置き場所:
- 採点データ・テスト・名簿・採点基準・保存期間 → Supabase（学校で共有）
- 表示言語 → `profiles.ui_lang` と端末の localStorage
- テーマ・お気に入り・匿名モード・生徒の表示形式 → 端末の localStorage（学校で共有しない好み）

### 主要テーブル

- `schools` — テナント。`retention` で保存期間、`region` で保存リージョン
- `profiles` — 教職員。`auth.users` と1:1。`school_id` を持つ
- `classes` / `students` — 名簿。**students に氏名カラムなし**
- `tests` / `questions` — テストと設問（配点・単元・模範解答）
- `rubrics` — 採点基準。`test_id` が null なら学校の既定値
- `submissions` — 答案1枚。`total_score` はトリガーが自動計算
- `submission_items` — 1問1行。ここが採点結果の本体
- `audit_logs` — 追記専用＋ハッシュ連鎖。UPDATE/DELETEポリシーを意図的に作っていない

### 分析ビュー（白紙・採点待ちの答案は含めない）

- `v_unit_mastery` — 単元別の定着度（クラス別）
- `v_question_stats` / `v_question_stats_by_class` — 設問別の正答率（テスト全体 / クラス別）
- `v_qtype_mastery` — 設問形式別の得点率（0003）
- `v_mistake_reasons` — ミスの傾向（誤答理由ごとの件数）（0003）

弱点分析はこのビューで集計する。**クライアント側で全答案のループを回さない。**
（デモモードの `lib/data/demo.ts` だけは、同じ集計を JS で再現している）

### 状態（submissions.status）の決まり方

`recalc_submission_total` トリガー（0003 で更新）が、設問の変更のたびに合計点と状態を決める。
白紙 > 採点中（progress < 100）> 画質注意（未確認のあいだ）> 要確認 > 採点済。
「確認済みにする」は `mark_submission_reviewed(id)` を呼ぶ（要確認の印を外し、画質注意も解除される）。

---

## 赤ペン採点画像について

`components/RedPenSheet.tsx` の `RedPenSheet` / `MarkGlyph` / `wobblePath` が実装（プロトタイプから移植）。
SVGで手描き風のゆらぎを持たせた丸・バツ・三角・得点・朱コメントを描画する。

原本に重ねる版は `components/RedPenOverlay.tsx`。原本画像を `<image>` として敷き、採点AIが返した `bbox`（ページに対する割合）にマークを重ねる。
`submission_items.bbox` カラムがその座標の保存先。bbox が無い答案（仮採点・デモ・旧データ）は清書版だけを表示する。

元の要件には「GPT5.6以上を使用」とあるが、Anthropic以外のモデルは呼び出せないため Claude の Vision を使う。
この点は要件と実装が異なるので、必要なら依頼元に確認すること。

---

## コーディング方針

- 日本語UIが第一言語。コメントも日本語で書く
- 117言語対応。`LANGS` 配列とRTL対応（`dir` 属性）を崩さない
- 教師が専門知識なしで使える画面にする。エラーメッセージは「何が起きたか」と「どう直すか」を書く
- 空白ページ・未実装ボタンを残さない
- コンソールエラーを残さない

---

## 開発コマンド

```bash
npm run dev          # 開発サーバー（.env.local が無ければデモモード）
npm run build        # 本番ビルド（型エラーはここで出る）
npm run lint
npm run test:db      # スキーマのテスト（素の PostgreSQL が必要）
npm run test:e2e     # ローカル Supabase（Docker）+ 採点AIの代役 + ブラウザでの通しテスト
npm run test:unit    # 採点AIの出力の後処理の単体テスト
npm run compare:models -- --image <答案画像> --with-answer-key   # 比較試験の手元版（本物の API を呼ぶ。要 ANTHROPIC_API_KEY）
```

### モデル比較試験（管理者専用、`/compare`）

Haiku 4.5 / Sonnet 5.5 / Opus 5 に同じ答案を1回ずつ採点させて比べる。**Vercel の Preview で、管理者本人が画面から実行する**（ユーザーの決定。開発環境にキーが無いため）。
- 画面 `components/screens/ModelCompareView.tsx`、API `app/api/compare/route.ts`（開始・中止・削除）と `app/api/compare/call/route.ts`（1要求で1モデル）、共通処理 `lib/ai/compare.ts`
- 条件: アプリと同じ採点指示（`buildGradingPrompt`）。模範解答 ①6 ②18 ③36 ④72 ⑤144 を全モデルに渡す。各問20点・部分点なし。thinking・effort は指定しない（Haiku 4.5 が非対応のため全モデルそろえる）。再試行・fallbacks なし
- モデルID は Models API の display_name で確かめ、見つからないモデルは代替せず「利用不可」
- 期待結果（`lib/ai/compare-expected.json`、合計60点）は `judgeCompare()` だけが読む。モデルへの入力に入れない（単体テストと E2E の代役サーバーで検査）
- 記録は `model_compare_runs` / `model_compare_results`（0005）。見られるのは実行した管理者本人だけ。答案・成績には書かない。答案画像は保存しない（sha256 のみ）
- 二重実行の防止: 同時に実行できるのは1人1試験（一意索引）/ request_id の再送は同じ試験 / 各モデルは pending → calling を1回だけ（トリガーで戻せない）/ 同じ画像の再実行は明示のチェックが必要
- 本番（`VERCEL_ENV=production`）では無効（`MODEL_COMPARE_IN_PRODUCTION=1` でのみ有効）
- 手元版 `scripts/model-compare/run.ts` は同じ `lib/ai/compare.ts` を使い、結果を `scripts/model-compare/results/`（Git 管理外）に保存する

Supabaseスキーマの変更は `supabase/migrations/` に新しい連番SQLを追加する。
既存のマイグレーションファイルは書き換えない。

---

## 未検証・未解決の事項

1. **本物の Claude API での採点が未実行** — 代役サーバーでリクエストの形と保存までを検証済み。読み取り精度・bbox の精度・所要時間・費用は本番で確かめる
17. **赤ペンの位置は、実物の答案写真（1ページ目：IMG_1208、2ページ目：ユーザーのスクリーンショットから切り出した低解像度の原本）＋台本の AI 位置でのみ検証** —
   ユーザーの答案に実際に保存された AI の bbox は見ていない（スクリーンショットの旧版の赤丸から逆算した位置で再現）。
   罫線の無い答案（問題用紙に直接書く形式）では表への割り当てが効かず、AI の位置に頼る（ずれは「位置の要確認」と手動調整で直す）
18. **チャッピー先生は代役の OpenAI でのみ検証** — 接続方法・モデル・イベント名・hangup は公式の API 仕様（openai-openapi）と公式 SDK 7.27.0 の型定義で照合済み（developers.openai.com は開発環境から開けない）。
   本物の Realtime での動作（通話の作成・hangup で実際に切れるか・料金）と iPhone/iPad Safari・Android Chrome の実機は未検証（`docs/TUTOR-LIVE-CHECK.md`・`docs/TUTOR-DEVICE-CHECK.md`）。
   E2E はブラウザの RTCPeerConnection を代役にしている。OpenAI の年齢・保護者の同意の条件と、1通話の最大時間は未確認。
   見回りはローカルの Supabase の pg_cron → アプリでのみ検証（クラウドの pg_cron → pg_net → Vercel の経路、Preview の保護の越え方は検証環境で確かめる）。
   OpenAI が通話を作ってから通話ID を DB に記録するまでのごく短い間にサーバーが落ちると、その通話は切れない（残る隙間）
19. **（解決）既存の通しテスト `tests/e2e/scenario.mjs`** — テスト登録（正答の入力・すべて確認）・新規採点の4手順・3モデル併用（上のモデルには問題の設問だけ）・コメント欄の絞り込みに合わせて直した
2. **0004〜0013 が本番 Supabase に未適用**（「次にやること」1。先に検証環境で行う）
16. **模範解答からの自動入力は代役 API でのみ検証** — 本物の模範解答での読み取り精度（特に配点表・作図・PDF の bbox）は Preview で確かめる。PDF の資料は該当箇所の枠を表示できない（ページを開くだけ）。作図の模範図は採点AIには送っていない（採点条件の文章だけ）
15. **3モデル併用は代役 API でのみ検証** — 本物の Haiku / Sonnet での読み取り精度・振り分けの割合・費用は未確認。正答との照合（`normAnswer`）は表記ゆれで誤検知しうる（誤検知は上のモデル・要確認に回るので、精度側に倒れる）
14. **モデル比較試験は未実行** — Preview で管理者が実行する準備まで完了（代役サーバーでの E2E のみ検証済み）
3. **生徒モバイル提出・複合機スキャン連携は「準備中」** — 画面に準備中と表示し、代わりの取り込み方法を案内している
4. **保存期間による自動削除で Storage の画像が消えない**（「次にやること」4）
5. **他校のIDを外部キーに指定できる** — 例: 学校Aの教員が学校Bの `test_id` を参照する `submissions` を作れる。読み取りはRLSで防がれるが整合性は崩れる。複合外部キー `(school_id, id)` で塞ぐのが本筋（未対応）。AI採点の保存（0004）は設問ID を DB 側で決めるので影響しない
6. **役割（role）の変更・教職員の招待画面がない** — 招待は SUPABASE-SETUP.md のサーバー側コード、役割変更は SQL で行う
7. **クラス・生徒の登録画面がない** — 名簿は SQL で登録する（SUPABASE-SETUP.md ステップ4）。テストは画面から登録できる
8. **フィードバック・模範解答はテンプレート文面** — 生成AIへの置き換えは未実装（`buildFeedback` / `buildModelAnswers`）
9. **（解決）複数ページの答案** — 1人分を複数枚で取り込み、原本の各ページに赤ペンを重ねられる。合計点の表示は1ページ目だけ
10. **AI採点は1枚ずつ順番に実行** — 40枚で数十分かかりうる。画面を閉じると残りは「AI採点待ち」のまま（「まとめてAI採点」で再開できる）。サーバー側のキュー処理は未実装
11. **多言語は主要12言語のみ実翻訳** — ナビゲーション等のみ。画面本文は日本語のまま（残りは英語フォールバック）
12. **ダッシュボードの為替レート・ユーザーの声の評価数はデモ値** — プロトタイプから引き継いだ表示。問い合わせはメールソフトを開く方式
13. **要件の「GPT5.6以上」との差** — Anthropic 以外のモデルは呼べないため Claude の Vision を使う（依頼元に確認が必要なら確認する）
