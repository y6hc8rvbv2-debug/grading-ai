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

プロトタイプは完成済み、永続化層は未接続。
`docs/prototype-v3.jsx` は全15画面が動作するが、データが `useState` 上にありリロードで消える。

詳細は `CLAUDE.md` を参照。
