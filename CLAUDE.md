# テスト採点ver.3

答案画像をアップロードすると、AIが採点・赤ペン添削・弱点分析までを自動で行う学校向けWebアプリ。

このファイルは Claude Code がセッション開始時に自動で読み込むプロジェクト記憶です。
作業を引き継いだら、まず「現在地」と「次のタスク」を確認してください。

---

## 現在地

**プロトタイプは完成済み。永続化層は未接続。**

- `docs/prototype-v3.jsx` — 単一ファイルReactデモ（3,538行）。全15画面が動作し、デモデータで全機能を試せる。**ただし全データが `useState` 上にあり、リロードで消える。**
- `supabase/migrations/` — Supabaseスキーマ（12テーブル、RLS、監査ログ、分析ビュー）。**作成済みだが未実行・未検証。**
- `lib/db/grading.ts` — データアクセス層。**作成済みだが未接続。**

つまり「動くが保存されない」状態です。ここを繋ぐのが最優先。

---

## 次にやること（優先順）

### 1. Supabaseプロジェクトの作成とスキーマ投入 ← いまここ

`docs/SUPABASE-SETUP.md` のステップ1〜4を実行する。

**重要**: このSQLは実際のPostgreSQLで実行検証されていない。初回の `Run` でエラーが出る可能性がある。
エラーが出たら、エラー文を元に `0001_init.sql` を修正する。よくある想定箇所:
- `auth.users` へのトリガー作成権限
- `storage.objects` へのポリシー作成（`0002` は `0001` の `current_school_id()` に依存するので順序厳守）
- ビューの `security_invoker` オプション（PostgreSQL 15以降で有効）

### 2. プロトタイプをNext.js 14へ移植し、状態管理をSupabaseに繋ぐ

`docs/prototype-v3.jsx` を分割して `app/` 配下へ移す。置き換え対応は次のとおり。

| プロトタイプ側 | 置き換え先 |
|---|---|
| `useState(INITIAL_SUBMISSIONS)` | `loadSubmissions()` |
| `updateSub(id, patch)` | `updateItem({ schoolId, submissionId, itemId, patch })` |
| `addSubs(made)` | `saveGrading(input)` |
| `STUDENTS` / `CLASSES` / `TESTS` 定数 | `loadWorkspace()` |
| `analyze()` のクライアント集計 | `unitMastery()` / `questionStats()`（Postgres側で集計） |
| 要確認一覧のクライアント絞り込み | `needsReview()` |

合計点と `status` はDBトリガーが自動計算するので、**アプリ側で合計を再計算しないこと。**

### 3. 採点AIの実接続（PROD-APIマーカー12箇所）

`docs/prototype-v3.jsx` 内の `// PROD-API:` コメント12箇所が接続ポイント。
Route Handler（`app/api/grade/route.ts`）を作り、サーバー側から Claude API を呼ぶ。

**APIキーは絶対にブラウザへ出さない。** `ANTHROPIC_API_KEY` はサーバー環境変数のみ。

送信するもの: 答案画像（Storage署名付きURL or base64）＋ `rubrics` テーブルの採点基準＋ `questions` の配点と模範解答。
受け取るもの: 設問ごとの `detected` / `mark` / `earned` / `confidence` / `reason` / `bbox`。

`confidence` が `rubrics.review_threshold` を下回ったら `need_review = true` にして「要確認一覧」へ回す。

### 4. 生徒モバイル提出（Edge Function）

`submission_links` テーブルにトークンを発行し、Edge Function（service_role）が検証してアップロードを代行する。
**生徒はログインしない設計。** 提出時に氏名を入力させず、出席番号だけで受け付ける。

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

---

## アーキテクチャ

```
Next.js 14 (App Router)
  ├── middleware.ts          セッション維持 + 未ログインを /login へ
  ├── app/
  │   ├── (dashboard)/       サイドバー付きの主要15画面
  │   └── api/grade/         採点AIのRoute Handler（未実装）
  ├── lib/supabase/
  │   ├── client.ts          ブラウザ用（Client Component）
  │   └── server.ts          サーバー用 + createAdminClient（service_role）
  └── lib/db/grading.ts      データアクセス層（camelCase変換込み）

Supabase
  ├── PostgreSQL             12テーブル + RLS + トリガー + 分析ビュー
  ├── Storage                answer-sheets（非公開・署名付きURLのみ）
  └── Auth                   教職員のみ。生徒はログインしない
```

### 主要テーブル

- `schools` — テナント。`retention` で保存期間、`region` で保存リージョン
- `profiles` — 教職員。`auth.users` と1:1。`school_id` を持つ
- `classes` / `students` — 名簿。**students に氏名カラムなし**
- `tests` / `questions` — テストと設問（配点・単元・模範解答）
- `rubrics` — 採点基準。`test_id` が null なら学校の既定値
- `submissions` — 答案1枚。`total_score` はトリガーが自動計算
- `submission_items` — 1問1行。ここが採点結果の本体
- `audit_logs` — 追記専用＋ハッシュ連鎖。UPDATE/DELETEポリシーを意図的に作っていない

### 分析ビュー

- `v_unit_mastery` — 単元別の定着度
- `v_question_stats` — 設問別の正答率

弱点分析はこのビューで集計する。**クライアント側でループを回さない。**

---

## 赤ペン採点画像について

`docs/prototype-v3.jsx` の `RedPenSheet` / `MarkGlyph` / `wobblePath` が実装。
SVGで手描き風のゆらぎを持たせた丸・バツ・三角・得点・朱コメントを描画する。

本番では、原本画像を `<image>` として敷き、Vision が返した `bbox` 座標にこのマークを重ねる。
`submission_items.bbox` カラムがその座標の保存先。

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
npm run dev          # 開発サーバー
npm run build        # 本番ビルド（型エラーはここで出る）
npm run lint
```

Supabaseスキーマの変更は `supabase/migrations/` に新しい連番SQLを追加する。
既存のマイグレーションファイルは書き換えない。

---

## 未検証・未解決の事項

引き継ぎ時点で確定していないこと。作業の前に確認が必要。

1. **SQLの実行検証が未了** — 作成環境にPostgreSQLがなく、実際に流していない
2. **プロトタイプは単一ファイルのまま** — Next.jsのディレクトリ構成へ未分割
3. **採点AIが未接続** — 現在はローカルのルールベース採点（`gradeSubmission()`）がデモとして動作
4. **複合機スキャン連携が画面のみ** — 実際のメール受信→採点キュー投入は未実装
5. **多言語は主要12言語のみ実翻訳** — 残りは英語フォールバック
6. **既存の `api/grade.js` / `index.html` は旧・仮実装** — `api/grade.js` は OpenAI を呼ぶが結果を使わず固定値を返す。Next.js 移植時に `app/api/grade/route.ts`（Claude API）へ置き換えて削除する
