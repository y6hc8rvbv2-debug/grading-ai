// 特定商取引法に基づく表記（有料プランを Web で申し込むときの表示）。料金は lib/subscription-plans.ts と同じ値を使う
import type { Metadata } from "next";
import { APP_INFO } from "@/lib/app-info";
import { FREE_QUOTA } from "@/lib/billing/catalog";
import { PERSONAL_OPUS_SURCHARGE, PERSONAL_TIERS, SCHOOL_PLANS } from "@/lib/subscription-plans";
import { H2, Missing, PublicPage } from "@/components/PublicPage";

export const metadata: Metadata = { title: `特定商取引法に基づく表記｜${APP_INFO.name}` };
// 夜間プランは、受付を始めた環境（BILLING_ENABLED・NIGHT_GRADING_ENABLED）でだけ載せる
export const dynamic = "force-dynamic";

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

export default function TokushohoPage() {
  const night = process.env.BILLING_ENABLED === "on" && process.env.NIGHT_GRADING_ENABLED === "on";
  const row = (label: string, body: React.ReactNode) => (
    <tr><th scope="row" style={{ textAlign: "left", verticalAlign: "top", padding: "8px 12px 8px 0", whiteSpace: "nowrap" }}>{label}</th><td style={{ padding: "8px 0" }}>{body}</td></tr>
  );
  return (
    <PublicPage title="特定商取引法に基づく表記">
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14, lineHeight: 1.8 }}>
        <tbody>
          {row("販売事業者", APP_INFO.provider || <Missing what="提供者名" />)}
          {row("運営責任者", APP_INFO.provider || <Missing what="提供者名" />)}
          {row("所在地・電話番号", "請求があった場合には、遅滞なく開示します（下のメールアドレスにご連絡ください）。")}
          {row("お問い合わせ", APP_INFO.supportEmail ? <a href={`mailto:${APP_INFO.supportEmail}`}>{APP_INFO.supportEmail}</a> : <Missing what="問い合わせ先" />)}
          {row("サービス", `${APP_INFO.name}（答案の写真の AI 採点・赤ペン・返却の Web サービス）`)}
          {row("販売価格", <>
            <div>無料プラン：0円（月{FREE_QUOTA}回まで）</div>
            <div style={{ marginTop: 6 }}>個人・塾プラン（月額・税込）</div>
            <ul style={{ margin: "2px 0" }}>
              {PERSONAL_TIERS.map((t) => <li key={t.id}>{t.name}：{yen(t.price)}（月{t.sheets.toLocaleString("ja-JP")}回まで）{night && `／夜間採点プラン ${yen(t.nightPrice)}`}</li>)}
            </ul>
            <div>個人・塾プランの「Opus 単独」の採点：1回につき {yen(PERSONAL_OPUS_SURCHARGE)}（税込）</div>
            <div style={{ marginTop: 6 }}>学校プラン（月額）</div>
            <ul style={{ margin: "2px 0" }}>
              {SCHOOL_PLANS.map((p) => <li key={p.id}>{p.name}：{yen(p.price)}（税別。お支払いは消費税込みの {yen(Math.round(p.price * 1.1))}）（月{p.limit.toLocaleString("ja-JP")}回まで）
                {night && `／夜間採点プラン ${yen(p.nightPrice)}（税別。税込 ${yen(Math.round(p.nightPrice * 1.1))}）`}</li>)}
            </ul>
            <div>1回＝生徒1人分の答案（2ページ・20問まで）の採点1回です（再採点も1回）。</div>
          </>)}
          {row("商品代金以外の必要料金", "インターネットの接続・通信の料金はお客様のご負担です。")}
          {row("お支払い方法", "クレジットカード（決済サービス Stripe）。Web ブラウザから申し込みます（ストア用のアプリの中では購入できません）。")}
          {row("お支払いの時期", "月額料金は申し込みのときに初回を、以後は契約期間ごとの更新日に自動でお支払いいただきます。「Opus 単独」の追加料金は、その採点を申し込むときにお支払いいただきます。")}
          {row("提供の時期", `お支払いの確認後、すぐに使えます。${night ? "夜間採点プランの採点は、日本時間22時〜翌6時に行います。" : ""}`)}
          {row("解約・返金", <>
            <div>解約は「契約・支払い管理」からいつでもでき、その契約期間の終わりまで使えます。次の更新から請求されません。</div>
            <div>デジタルのサービスのため、支払い済みの月額料金は、法令で必要な場合を除き、日割りで返金しません。</div>
            <div>「Opus 単独」の採点に失敗したときは、その追加料金を返金します。採点に失敗した回は、月の回数に数えません。</div>
          </>)}
          {row("動作環境", "最新の Safari・Chrome・Edge（パソコン・タブレット・スマートフォン）")}
        </tbody>
      </table>
    </PublicPage>
  );
}
