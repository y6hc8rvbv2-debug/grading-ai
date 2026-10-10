# App Store・Google Play への申請（1次完成版）

アプリは、本番の Web アプリを開くネイティブの殻（Capacitor 8）です。画面・データ・AI 採点はすべて本番のサーバーで動き、
アプリの中に秘密（API キーなど）は入りません。先生と生徒で1つのアプリ（起動画面 `/start` で選ぶ）。

---

## 0. 決めてあること

| 項目 | 値 |
|---|---|
| アプリ名 | テスト採点 |
| アプリID（Bundle ID・パッケージ名） | `jp.tesutosaiten.app`（**最初のアップロードの後は変えられない**） |
| 版 | 1.0（ビルド番号 1） |
| 提供者 | 個人（開発者アカウントの名義） |
| カテゴリ | 教育（Education） |
| 価格・課金 | 無料・アプリ内課金なし・広告なし |
| 対応 | iPhone・iPad（iOS 15 以上）、Android 7.0 以上（targetSdk 36） |
| 利用者 | 先生（学校の管理者が作るアカウント）と生徒（小学生を含む。13歳未満は保護者の同意。「ChatGPT で復習」は13歳以上のクラスだけ） |

## 1. あなたが入れる値（3つ。ここだけ）

| 環境変数 | 内容 | 例 |
|---|---|---|
| `NEXT_PUBLIC_APP_PROVIDER` | 提供者名。**開発者アカウント（Apple・Google）の名義と同じ** | 山田 太郎 |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | 問い合わせ用のメールアドレス（ストアのサポート欄と同じ） | support@example.jp |
| `NEXT_PUBLIC_APP_URL` | 本番の URL（独自ドメイン。https:// から、末尾の / なし） | https://saiten.example.jp |

- Vercel → Settings → Environment Variables で **Production** に設定し、再デプロイ
- 手元のパソコンでアプリを作るときも同じ値を使う（下の 4.）
- 確かめ方：`npm run store:check`（3つとも ✓ になる）。本番に出したあとは `STORE_CHECK_ONLINE=1 npm run store:check` で公開ページが開けるかも確かめる

## 2. 本番の準備（ストアの審査の前に）

1. **独自ドメイン**を取り、Vercel の Production に割り当てる（Vercel → Settings → Domains）
2. **本番の DB**：`docs/DB-RUNBOOK.md` 第2部で 0004〜0016 を適用（バックアップ → check.sql → 1ファイルずつ → check.sql）。
   0016 はアカウントの削除と保存期間の削除に必要
3. **Vercel の Production の環境変数**（値はチャット・Git に書かない）

   | 環境変数 | 用途 |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL`・`NEXT_PUBLIC_SUPABASE_ANON_KEY` | 本番の Supabase |
   | `ANTHROPIC_API_KEY` | AI 採点 |
   | `SUPABASE_SERVICE_ROLE_KEY` | **アカウントの削除**と保存期間の削除だけに使う（`NEXT_PUBLIC_` を付けない） |
   | `CRON_SECRET` | 保存期間の削除（毎日1回。`vercel.json`）。32文字以上の乱数 |
   | 1. の3つ | 提供者名・問い合わせ先・本番の URL |

   `TUTOR_INAPP` は設定しない（アプリ内の AI との会話は使わない）
4. **Supabase の Auth**：Authentication → URL Configuration の Site URL を本番の URL に、Redirect URLs に `https://（本番）/auth/callback` を入れる。
   生徒が自分でアカウントを作るので、「Allow new users to sign up」は**オンのまま**（一般の登録者は学校に所属しないので、先生の画面は使えない）
5. 設定画面の「準備状況」がすべて「済」になることを確かめる（0016・アカウントの削除・保存期間の削除・公開の情報を含む）

## 3. 審査用のアカウント（ストアの審査担当がログインする）

本番に、架空の学校・先生・生徒と、架空の答案を用意する（実在の学校・生徒のデータは使わない）。

1. `docs/SUPABASE-SETUP.md` のステップ3〜4 で、審査用の学校（例「審査用中学校（架空）」）・管理者・クラス・生徒2人
2. 先生で、架空の答案（手書きの計算問題など）を2〜3枚取り込み、AI 採点 → 確認 → 生徒に返却
3. 生徒のアカウントを1つ作り（`/student` で登録 → 先生が返却先に登録）、「ChatGPT で復習」を有効にしたクラスにする
4. ストアの審査用の欄に、先生と生徒のメールアドレス・パスワードを書く（下の 5.・6.）。**審査のあいだは消さない・パスワードを変えない**

## 4. アプリを作る（ビルド）

前提：Node.js 20 以上。iOS は Mac と Xcode（最新）、Android は Android Studio。

```bash
npm ci
export NEXT_PUBLIC_APP_URL=https://saiten.example.jp     # 1. の本番の URL
npm run mobile:sync                                      # ios/・android/ に設定を反映（URL が無いと止まる）
```

**iOS**
1. `npm run mobile:open:ios`（Xcode が開く）
2. App → Signing & Capabilities で Team（Apple Developer Program の名義）を選ぶ。Bundle Identifier は `jp.tesutosaiten.app`
3. 実機で起動し、起動画面 → 先生でログイン → 「カメラで撮影」でカメラの許可の文が出る → 生徒でログイン、を確かめる
4. Product → Archive → Distribute App → App Store Connect にアップロード

**Android**
1. `npm run mobile:open:android`（Android Studio が開く）
2. 実機またはエミュレーターで起動して、iOS と同じことを確かめる
3. Build → Generate Signed App Bundle（.aab）。アップロード鍵を作り、**鍵とパスワードは安全な場所に保管**（無くすと更新できない）。Play App Signing を使う
4. Play Console にアップロード

アイコン・起動画面は `npm run mobile:icons` で作ってあります（`store/`・`public/icons/`・`ios/`・`android/`）。

## 5. App Store Connect の入力

| 項目 | 入力 |
|---|---|
| 名前・サブタイトル | テスト採点／答案の写真から採点の下書きと赤ペン |
| カテゴリ | 教育（サブ：仕事効率化） |
| プライバシーポリシーの URL | `https://（本番）/privacy` |
| サポートの URL | `https://（本番）/support` |
| 年齢区分 | 質問に答える（暴力・ギャンブル・成人向けの内容なし。アプリ内に Web ブラウザは無い。外部のサイトは「ChatGPT を開く」で端末のブラウザが開く）。キッズカテゴリには入れない（先生の業務用アプリで、生徒の利用は学校の管理の下） |
| 輸出コンプライアンス | 標準の暗号（HTTPS）だけ（Info.plist に `ITSAppUsesNonExemptEncryption = false` 済み） |
| App のプライバシー（収集するデータ） | 連絡先情報：メールアドレス（アプリの機能・アカウント）／ユーザーコンテンツ：写真（答案）・その他のユーザーコンテンツ（採点結果・コメント）／識別子：ユーザー ID。いずれも「ユーザーに関連付けられる」「トラッキングに使わない」。広告・分析なし |
| 審査メモ | 下の文を使う |

**審査メモ（例）**
```
学校の先生が答案を撮影し、AI（Anthropic の Claude）で採点の下書きと赤ペン添削を作り、
先生が確認して生徒に返却するアプリです。起動画面で「先生・職員」「生徒」を選びます。
審査用アカウント：先生 ＜メール＞／＜パスワード＞、生徒 ＜メール＞／＜パスワード＞（架空の学校・答案です）
・答案の写真を AI に送る前に、送り先と内容を示して同意をたずねます（設定画面で取り消せます）。
・アカウントは アプリ内で削除できます（先生：設定 → アカウント、生徒：アカウント → アカウントを削除する）。
・生徒の「ChatGPT で復習」は、生徒が内容を確認してコピーし、自分の ChatGPT に貼り付ける機能です（アプリから OpenAI には送りません）。
・アプリ内の購入・広告はありません。
```

## 6. Google Play Console の入力

| 項目 | 入力 |
|---|---|
| アプリのアクセス権 | 一部の機能に制限あり → 審査用の先生・生徒のアカウントを入れる |
| 広告 | なし |
| コンテンツのレーティング | アンケートに答える（教育・ユーザー間のやり取りなし） |
| ターゲット ユーザー | **13歳未満を含む**（小学生も使う）→ ファミリー ポリシーに従う：プライバシーポリシーの URL・広告なし・子どものデータは学校と保護者の同意の下で扱う |
| データ セーフティ | 収集：メールアドレス（アカウント管理）・写真（答案）・その他のユーザー コンテンツ（採点結果）・ユーザー ID。第三者と共有：写真を AI の処理のため Anthropic に（サービスの提供のため）。転送は暗号化。削除の依頼：可（アプリ内と下の URL） |
| アカウント削除の URL | `https://（本番）/account-deletion` |
| ストアの掲載情報 | アイコン `store/icon-512.png`、フィーチャー グラフィック `store/feature-graphic.png`、スクリーンショット `store/screenshots/android-phone/` |

- **個人の開発者アカウント（2023年11月以降に作成）は、製品版の前にクローズド テスト（12人以上・14日以上）が必要**。先生・保護者に協力を頼む
- 1 の提供者名は、Play Console の開発者名と同じにする

## 7. 掲載文（下書き）

**短い説明（80字以内）**：答案の写真から AI が採点の下書きと赤ペン添削。先生が確認して生徒に返却。

**説明**
```
「テスト採点」は、学校の先生のための採点支援アプリです。

■ 先生
・答案をカメラで撮影、または写真・PDF で取り込み
・AI（Anthropic の Claude）が採点の下書きを作り、原本に赤ペンの○×△を重ねて表示
・読み取りに自信がない設問は「要確認」にまとめて表示。最終的な採点は先生が確認して決めます
・単元別・設問形式別の弱点分析
・確認した答案を、生徒一人ひとりに返却

■ 生徒
・返却された答案と赤ペンを、自分のスマートフォンで確認
・間違えた問題を、自分の ChatGPT で復習（13歳以上・先生が有効にしたクラス）

■ 安心して使うために
・生徒の氏名は保存しません（出席番号・匿名ID で管理）
・学校ごとにデータを分けて守ります
・答案を AI に送る前に、送り先と内容を示して同意をたずねます
・広告・アプリ内課金はありません
```

## 8. スクリーンショット

`store/screenshots/` に、iPhone 6.9 インチ（1320×2868）・iPad 13 インチ（2064×2752）・Android（1080×1920）の画面写真があります。
先生の画面はデモモード（サンプルのデータ）、生徒の画面は手元の検証用の DB（架空のデータ）で撮っています。撮り直すとき：

```bash
NEXT_DIST_DIR=.next-demo npx next build && NEXT_DIST_DIR=.next-demo npx next start -p 3400 &   # デモモード
BASE_URL=http://localhost:3400 node scripts/mobile/screenshots.mjs                              # 先生の画面
STORE_SHOT_DIR=$PWD/store/screenshots npm run test:e2e:lite                                     # 生徒の画面
```

## 9. 開発側で確かめたこと・確かめていないこと

確かめたこと（このリポジトリのテスト）
- 公開ページ（起動・プライバシーポリシー・利用規約・サポート・アカウントの削除）がログインなしで開け、スマホ幅ではみ出さない。manifest・アイコン（`tests/e2e-lite/store.mjs`）
- 未完成の機能・架空の数値（準備中・為替・料金表・利用者の声）が画面に無い（同上）
- AI に送る前の同意：同意しなければ送らない・取り消せる（同上）
- アカウントの削除：生徒の削除・学校の最後の管理者は不可・返却内容は変えない・学校の記録は残る（同上と `supabase/tests/account_deletion_test.sql`）
- 保存期間の削除：期限を過ぎた答案だけ・画像を先に消す・失敗したら削除済みにしない（`tests/unit/retention.test.ts`・DB のテスト）
- 生徒の新規登録は同意が必要。「ChatGPT で復習」は13歳以上の確認が必要（先生・生徒とも）

確かめていないこと（あなたの環境で行う）
- **iOS・Android のビルドと実機**（この開発環境には Xcode・Android SDK が無い）
- 本物の Supabase（クラウド）でのアカウントの削除（Auth の管理 API）と、Vercel Cron での保存期間の削除
- 本物の Claude API での採点（`CLAUDE.md` の未検証の事項）

## 10. 審査で指摘されうること（あらかじめ知っておく）

- **Apple 4.2（最低限の機能）**：Web サイトをそのまま包んだだけのアプリは断られることがある。このアプリは、カメラでの撮影・通信できないときの画面・アプリ内のアカウント削除などを備えるが、
  断られた場合は、指摘の内容に合わせてネイティブの機能（例：撮影の補助・通知）を足すか、Web アプリ（ホーム画面に追加）で提供する
- **Next.js の脆弱性の警告**：`npm audit` が Next.js 14 系に重大な警告を出す（画像最適化の remotePatterns・rewrites・RSC のキャッシュ。修正は Next.js 16 への更新）。
  このアプリは next/image の外部の画像・rewrites を使っていないが、公開後の早いうちに Next.js 16 へ更新する
