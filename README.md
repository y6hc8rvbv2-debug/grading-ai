# テスト採点ver.3

答案画像をアップロードすると、AIが採点・赤ペン添削・弱点分析までを自動化する学校向けWebアプリ。

## はじめに読むもの

| ファイル | 内容 |
|---|---|
| `docs/MOVE-TO-CLAUDE-CODE.md` | **まずこれ。** Claude Codeで作業を始める手順 |
| `CLAUDE.md` | プロジェクトの現在地と次のタスク（Claude Codeが自動で読む） |
| `docs/SUPABASE-SETUP.md` | Supabase接続手順 |
| `docs/original-requirements.md` | 元の要件定義 |

## 現在の状態

Next.js 14 への移植、Supabase への保存、採点AI（Claude の Vision）による採点まで実装済み。

```bash
npm install
npm run dev        # .env.local が無ければデモモード（保存されない）で起動
                   # ANTHROPIC_API_KEY があれば AI 採点が使える（無ければ画像の保存まで）
```

Supabase の設定は `docs/SUPABASE-SETUP.md`、全体の状況と次の作業は `CLAUDE.md` を参照。
