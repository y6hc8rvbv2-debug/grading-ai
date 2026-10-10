# 採点モデル比較試験（Haiku / Sonnet / Opus）

> **ふだんはアプリの画面（管理者メニューの「🧪 モデル比較試験」、Vercel の Preview）で実行します。**
> APIキーは Vercel のサーバーの環境変数にだけあり、画面・ログには出ません（`docs/SUPABASE-SETUP.md` ステップ6.5-b）。
> このスクリプトは、手元の環境にキーがある場合の代わりの手段です。条件・料金・照合は画面版と共通（`lib/ai/compare.ts`）。

同じ答案画像・同じ採点指示・同じ採点基準を、Claude Haiku 4.5 / Claude Sonnet 5.5 / Claude Opus 5 に
1回ずつ独立して送り、読み取り・正誤・得点・処理時間・トークン数・概算費用を比べる。

- 採点指示と出力形式はアプリの採点と同じもの（`lib/ai/grade.ts` の `buildGradingPrompt`）を使う
- モデルID は **Models API** で表示名から確認する。見つからないモデルは代わりを使わず「利用不可（未実行）」と記録する
- 自動再試行なし（`maxRetries: 0`）。拒否時に別モデルへ切り替える `fallbacks` も付けない
- thinking・effort は指定しない（各モデルの既定のまま）。Haiku 4.5 は adaptive thinking / effort に対応していないため、全モデル同じ本文にそろえている
- 採点基準: 各問20点・正答のみ加点・部分点なし。正答（答案キー）は既定では渡さない（`--with-answer-key` で渡す）
- 期待結果（`lib/ai/compare-expected.json`）は **モデルの応答が返った後に** 照合にだけ使う
- 結果は `scripts/model-compare/results/<日時>/`（`result.json`・`report.md`）に保存する。DB の答案・成績には書き込まない。このフォルダは Git に入れない
- 1回の実行で API を最大3回呼ぶ（費用は数円程度。結果の表に概算を出す）

## 実行のしかた

### 1. APIキーを設定する（チャットには貼らない）

キーは **実行する環境の環境変数** にだけ置く。スクリプトはキーを表示・保存しない（エラー文に含まれても伏せ字にする）。

- **Claude Code on the web で実行する場合**：セッション上部の環境名 →「Edit」→ 環境変数に
  `ANTHROPIC_API_KEY=<キー>` を追加して保存し、**新しいセッション** を開始する
- **自分のパソコンで実行する場合**：プロジェクト直下の `.env.local`（Git に入らない）に書くか、ターミナルで
  ```bash
  read -s ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY   # 入力は画面に表示されない
  ```
- 試験用に **利用上限額を設定した別のキー** を Anthropic Console で作ると安心（本番の Vercel のキーをコピーして使わない）

### 2. 答案画像を置く

JPEG / PNG（5MB まで）。答案に生徒の氏名が写っている場合があるので、**Git にコミットしない場所** に置く
（例: `scripts/model-compare/results/` の外の一時フォルダ、またはアップロード先のパス）。

### 3. 実行する

```bash
npm run compare:models -- --image /path/to/answer.jpg --dry-run   # 送る内容を確認するだけ（API を呼ばない）
npm run compare:models -- --image /path/to/answer.jpg             # 比較試験を実行
```

**依頼元と合意した実行条件（2026-09-29）**: 実際のアプリと同じ条件にするため `--with-answer-key` を付ける。
全モデル共通の正答は ①6 ②18 ③36 ④72 ⑤144、各問20点・部分点なし。期待判定・期待得点・合計60点は渡さず、照合にだけ使う。
APIキーと答案画像ファイルがそろってから、各モデル1回ずつ実行する。

```bash
npm run compare:models -- --image /path/to/answer.jpg --with-answer-key
```

終了コード: 0 = 実行した / 2 = 画像の指定が不正 / 3 = APIキー未設定（未実行）/ 4 = Models API を呼べない（未実行）

## 料金

`run.ts` の `PRICES`（USD / 100万トークン）。出典は
https://platform.claude.com/docs/en/about-claude/pricing（2026-09-29 取得）。
出力トークンには思考（thinking）のトークンも含まれ、同じ単価で課金される。
