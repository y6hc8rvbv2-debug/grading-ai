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
- 本番 Supabase（ユーザーのプロジェクト）には 0001〜0003 を適用済み（2026-09-28）。**0004 はまだ**。
  Vercel の Preview で、ログイン・名簿表示・答案画像の保存まで動作確認済み（ユーザー報告）。
- **本物の Claude API での採点はまだ一度も実行していない**（開発環境にキーが無い）。
  E2E はリクエストの形を検査する代役サーバー（`tests/e2e/mock-anthropic.mjs`）で検証している。
- `docs/prototype-v3.jsx` は移植元として残している。今後の変更は `app/` / `components/` / `lib/` に対して行う。

---
## 次にやること（優先順）

### 1. 本番で AI 採点を動かす ← ユーザー作業待ち

- Supabase の SQL Editor で `0004_ai_grading.sql` を実行する
- Vercel に `ANTHROPIC_API_KEY` を設定して再デプロイする（`docs/SUPABASE-SETUP.md` ステップ6.5）
- 保存済みの確認用答案（「2＋3＝5」）を「採点中」画面から AI 採点し、○・4点になるか確かめる
- 実際の答案で、読み取り精度・bbox（赤ペンの位置）の精度・1枚あたりの時間と費用を確かめる。
  bbox がずれる場合は「清書版」表示で運用できる

### 1b. Supabase のスキーマ（参考）

`docs/SUPABASE-SETUP.md` のステップ1〜5（SQL は 0001 → 0002 → 0003 → 0004 の順）。
エラーが出たらエラー文を元に直す。ただし **本番に一度でも流したマイグレーションは書き換えず、新しい連番ファイルで直す**。

ローカルでは次の2段階で検証済み（スキーマを変えたら両方通すこと）:
- `npm run test:db` … 素の PostgreSQL + Supabase 模擬環境で RLS・トリガー・ビューを検証（`supabase/tests/rls_test.sql`）。
  root 環境では `su postgres -c "bash supabase/tests/run.sh"`
- `npm run test:e2e` … Supabase CLI のローカル環境（Docker）にアプリを繋ぎ、ブラウザで教員の作業を通しで検証（`tests/e2e/`）。
  採点AIは代役サーバー（本物の API は呼ばない）。ECR に届かない環境では `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io` を付ける
- `npm run test:unit` … 採点AIの出力の後処理（`normalizeResult`）の単体テスト

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

- `app/api/grade/route.ts`（POST `{ submissionId }`）が採点する。**教員のセッション（RLS）で** 答案・設問・採点基準・画像を読み、
  `lib/ai/grade.ts` の `callClaude()` で Claude に送り、`normalizeResult()` で整えてから `save_ai_grading()`（0004）で保存する。
  service_role は使わない。サーバーに置く秘密は `ANTHROPIC_API_KEY` だけ
- モデルは `claude-opus-5`（`ANTHROPIC_MODEL` で変更可）。adaptive thinking・effort high・structured outputs（JSON スキーマ）。
  拒否されたときの自動再実行（`fallbacks: "default"`、beta `server-side-fallback-2026-07-01`）を有効にしている（`ANTHROPIC_FALLBACKS=off` で無効）
- **AI の出力はそのまま信じない**: 得点は判定に合わせて 0〜配点に決め直し、判定と得点が食い違えば要確認。
  信頼度 < `rubrics.review_threshold`、記述問題で `require_teacher`、AI が返さなかった設問も要確認。設問ID は DB 側で qno から決める
- 失敗したら答案の状態を元に戻す（AI採点待ちのまま）。1枚ずつ順に採点する（Vercel の関数は `maxDuration = 300`）
- 画像はブラウザで長辺 2400px の JPEG に縮小してから保存する（`lib/image.ts`。API の上限は1枚5MB）。HEIC は採点できない旨を案内する
- 赤ペン: AI が返す `bbox`（解答欄の位置）に `components/RedPenOverlay.tsx` でマークを重ねる。1ページ目のみ。「清書版」（`RedPenSheet`）にも切り替えられる

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
      ├── grading/engine.ts      仮採点（ルールベース）・1枚単位の分析・文面生成・定数
      ├── demo/data.ts           デモデータ（デモモード専用）
      ├── i18n.ts / ui/theme.ts  多言語・テーマ
      ├── errors.ts              エラーを「何が起きたか＋どう直すか」の日本語にする
      └── supabase/{client,server}.ts

Supabase
  ├── PostgreSQL             12テーブル + RLS + トリガー + 分析ビュー + AI採点の保存関数（supabase/migrations/0001〜0004）
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
```

Supabaseスキーマの変更は `supabase/migrations/` に新しい連番SQLを追加する。
既存のマイグレーションファイルは書き換えない。

---

## 未検証・未解決の事項

1. **本物の Claude API での採点が未実行** — 代役サーバーでリクエストの形と保存までを検証済み。読み取り精度・bbox の精度・所要時間・費用は本番で確かめる
2. **0004 が本番 Supabase に未適用**（「次にやること」1）
3. **生徒モバイル提出・複合機スキャン連携は「準備中」** — 画面に準備中と表示し、代わりの取り込み方法を案内している
4. **保存期間による自動削除で Storage の画像が消えない**（「次にやること」4）
5. **他校のIDを外部キーに指定できる** — 例: 学校Aの教員が学校Bの `test_id` を参照する `submissions` を作れる。読み取りはRLSで防がれるが整合性は崩れる。複合外部キー `(school_id, id)` で塞ぐのが本筋（未対応）。AI採点の保存（0004）は設問ID を DB 側で決めるので影響しない
6. **役割（role）の変更・教職員の招待画面がない** — 招待は SUPABASE-SETUP.md のサーバー側コード、役割変更は SQL で行う
7. **クラス・生徒の登録画面がない** — 名簿は SQL で登録する（SUPABASE-SETUP.md ステップ4）。テストは画面から登録できる
8. **フィードバック・模範解答はテンプレート文面** — 生成AIへの置き換えは未実装（`buildFeedback` / `buildModelAnswers`）
9. **赤ペンの重ね描きは1ページ目のみ** — 2ページ目以降の答案は「清書版」で確認する
10. **AI採点は1枚ずつ順番に実行** — 40枚で数十分かかりうる。画面を閉じると残りは「AI採点待ち」のまま（「まとめてAI採点」で再開できる）。サーバー側のキュー処理は未実装
11. **多言語は主要12言語のみ実翻訳** — ナビゲーション等のみ。画面本文は日本語のまま（残りは英語フォールバック）
12. **ダッシュボードの為替レート・ユーザーの声の評価数はデモ値** — プロトタイプから引き継いだ表示。問い合わせはメールソフトを開く方式
13. **要件の「GPT5.6以上」との差** — Anthropic 以外のモデルは呼べないため Claude の Vision を使う（依頼元に確認が必要なら確認する）
