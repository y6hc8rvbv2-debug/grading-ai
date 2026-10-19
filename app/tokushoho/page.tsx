// 特定商取引法に基づく表記（有料プランを Web で申し込むときの表示）。料金は lib/subscription-plans.ts と同じ値を使う
import type { Metadata } from "next";
import { APP_INFO } from "@/lib/app-info";
import { FREE_QUOTA } from "@/lib/billing/catalog";
import { PERSONAL_OPUS_SURCHARGE, coursesOf, limitLabel, priceLabel } from "@/lib/subscription-plans";
import { H2, Missing, PublicPage } from "@/components/PublicPage";
import { PAYMENT_METHODS } from "@/lib/billing/prepaid";

export const metadata: Metadata = { title: `特定商取引法に基づく表記｜${APP_INFO.name}` };

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

export default function TokushohoPage() {
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
            {(["personal", "school"] as const).map((aud) => (["通常採点", "夜間採点"] as const).map((kind, i) => (
              <div key={aud + kind} style={{ marginTop: 6 }}>
                <div>{aud === "personal" ? "個人・塾プラン" : "学校プラン"}（{kind}）</div>
                <ul style={{ margin: "2px 0" }}>
                  {coursesOf(aud, i === 1).map((x) => <li key={x.key}>{x.name}：{priceLabel(x)}・{limitLabel(x)}</li>)}
                </ul>
              </div>
            )))}
            <div>個人・塾プランの「Opus 単独」の採点：1回につき {yen(PERSONAL_OPUS_SURCHARGE)}（税込）</div>
            <div>学校プランの消費税：お支払いのときに、税別の月額に消費税（10%）を加えて請求します。</div>
            <div>1回（学校は1枚）＝生徒1人分の答案（2ページ・20問まで）の採点1回です（再採点も1回）。</div>
          </>)}
          {row("商品代金以外の必要料金", "インターネットの接続・通信の料金はお客様のご負担です。")}
          {row("お支払い方法", `月額（自動更新）：${PAYMENT_METHODS.monthly}（決済サービス Stripe）。前払い（1・3・6・12か月分）：${PAYMENT_METHODS.prepaid}、および${PAYMENT_METHODS.crypto}。いずれも Web ブラウザから申し込みます（ストア用のアプリの中では購入できません）。`)}
          {row("お支払いの時期", "月額料金は申し込みのときに初回を、以後は契約期間ごとの更新日に自動でお支払いいただきます。前払いは申し込みのときに、選んだ月数分をまとめてお支払いいただきます（コンビニ払い・銀行振込は表示された期限までに）。「Opus 単独」の追加料金は、その採点を申し込むときにお支払いいただきます。")}
          {row("提供の時期", "お支払いの確認後、すぐに使えます。夜間採点のコースは、採点の予約を日本時間22時〜翌6時の間に順に処理します（終わる時刻はお約束できません）。")}
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
