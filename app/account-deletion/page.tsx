// アカウントの削除の方法（Google Play の「アカウント削除の URL」に登録する。アプリを入れていなくても読める）
import type { Metadata } from "next";
import { APP_INFO } from "@/lib/app-info";
import { H2, Missing, PublicPage } from "@/components/PublicPage";

export const metadata: Metadata = { title: `アカウントの削除｜${APP_INFO.name}` };

export default function AccountDeletionPage() {
  return (
    <PublicPage title={`「${APP_INFO.name}」のアカウントの削除`} updated={false}>
      <p>提供者：{APP_INFO.provider || <Missing what="提供者名" />}</p>
      <H2>アプリ（またはこのサイト）から削除する</H2>
      <ul>
        <li><b>生徒</b>：<a href="/student">生徒の画面</a>にログイン →「アカウント」→「アカウントを削除する」→「削除」と入力して「削除する」</li>
        <li><b>先生・職員</b>：ログイン →「設定」→「アカウント」→「アカウントを削除する」→「削除」と入力して「削除する」。
          学校の最後の管理者は、先にほかの職員を管理者にしてから削除してください。</li>
      </ul>
      <p>削除はすぐに行われます。ログインできない場合は、下のお問い合わせ先に、登録したメールアドレスから「アカウントの削除の依頼」とお送りください。ご本人であることを確かめて削除します。</p>
      <p>お問い合わせ先：{APP_INFO.supportEmail ? <a href={`mailto:${APP_INFO.supportEmail}?subject=${encodeURIComponent("アカウントの削除の依頼")}`}>{APP_INFO.supportEmail}</a> : <Missing what="問い合わせ先" />}</p>
      <H2>削除されるもの</H2>
      <ul>
        <li>ログインのアカウント（メールアドレス・パスワード）</li>
        <li>先生・職員のプロフィール（表示名・所属・役割）</li>
        <li>生徒の返却先の登録と、復習の自己申告</li>
      </ul>
      <H2>残るもの</H2>
      <ul>
        <li>学校が管理する記録（名簿の番号・答案・採点結果・返却した内容・監査ログ）。これらは学校の記録として、学校が設定した保存期間が過ぎると削除されます。氏名はもともと保存していません。</li>
        <li>サービスのバックアップに含まれる情報は、バックアップの保存期間が過ぎると消えます。</li>
      </ul>
    </PublicPage>
  );
}
