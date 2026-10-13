// サポート（ストアの「サポートの URL」に登録する）
import type { Metadata } from "next";
import { APP_INFO } from "@/lib/app-info";
import { H2, Missing, PublicPage } from "@/components/PublicPage";

export const metadata: Metadata = { title: `サポート｜${APP_INFO.name}` };

export default function SupportPage() {
  return (
    <PublicPage title="サポート" updated={false}>
      <p>「{APP_INFO.name}」のお問い合わせ先とよくある質問です。</p>
      <H2>お問い合わせ</H2>
      <p>
        メール：{APP_INFO.supportEmail ? <a href={`mailto:${APP_INFO.supportEmail}`}>{APP_INFO.supportEmail}</a> : <Missing what="問い合わせ先" />}<br />
        返信はメールで行います。生徒の氏名は書かないでください。
      </p>
      <H2>はじめかた</H2>
      <ul>
        <li><b>先生</b>：学校の管理者が作ったアカウントでログインします（アプリの起動画面で「先生」）。</li>
        <li><b>生徒</b>：「生徒」からアカウントを作り、登録したメールアドレスを先生に伝えます。先生が確認して返却した答案が届きます。</li>
      </ul>
      <H2>よくある質問</H2>
      <ul>
        <li><b>パスワードを忘れた</b>：先生は学校の管理者に、生徒は先生にご相談ください。</li>
        <li><b>答案が届かない</b>：先生が返却先として登録し、答案を確認して返却すると届きます。「更新」を押してください。</li>
        <li><b>「ChatGPT で復習」が出ない</b>：先生が学校・クラスで有効にすると出ます（13歳以上の生徒だけ）。</li>
        <li><b>AI の採点がまちがっている</b>：先生が採点結果の画面で直せます。AI の採点は下書きです。</li>
      </ul>
      <H2>アカウントの削除</H2>
      <p><a href="/account-deletion">アカウントの削除の方法</a>をご覧ください。</p>
    </PublicPage>
  );
}
