# テスト採点ver6

答案画像をアップロードすると、AIが採点・赤ペン添削・弱点分析までを自動化する学校向けWebアプリ（ver5 を改良した版）。

## はじめに読むもの

| ファイル | 内容 |
|---|---|
| `docs/V6-SETUP.md` | **先生（管理者）がする設定**（Supabase で SQL を1つ実行・環境変数の確認）と、最低限の確認 |
| `docs/V6-VERIFICATION.md` | 開発側で行った検証の結果と、まだ確かめられていないこと |
| `docs/screenshots/ver6/` | ver6 の主な画面の写真 |
| `CLAUDE.md` | プロジェクトの現在地と次のタスク（Claude Code が自動で読む） |
| `docs/SUPABASE-SETUP.md`・`docs/DB-RUNBOOK.md` | Supabase の接続と DB の移行の手順 |

## ver6 で変わったこと（要点）

- **採点が速い**：複数の答案を同時に採点（既定8件）。120人分でも数分
- **先生の確認が減る**：おまかせモードで、生徒・クラス・テストを自動で決め、問題がなければ自動で採点開始
- **模範解答づくりが正確・速い**：2つのAIが別々に解いて検算。一致した設問は確認を省ける
- **生徒のタブレット・スマホから提出**：QRコードを映すだけ
- **AIエンジンを切り替えられる**：新しいモデルが出たら設定画面からワンタップ（既定は Haiku 5.5 / Sonnet 5.5 / Opus 5.5）
- **支払い方法**：カード・Apple Pay・Google Pay・コンビニ・PayPay・銀行振込・暗号資産（前払い）
- **便利機能10個**と、画面右上の 🌐 での言語切り替え

## 開発

```bash
npm install
npm run dev            # .env.local が無ければデモモード（保存されない）で起動
npm run build          # 本番ビルド
npm run test:unit      # 単体テスト
npm run test:db:memory # DB（全マイグレーション＋RLS）のテスト
npm run test:e2e:lite  # 画面テスト（PostgreSQL・PostgREST・ブラウザ。AI・決済は代役）
```
