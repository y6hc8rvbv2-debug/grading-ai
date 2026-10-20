"use client";
// 料金・契約の画面（ダッシュボード）。コース・金額・税区分・上限は lib/subscription-plans.ts の一元表だけを読む。
// 申し込めるかどうか（決済の設定・本番の料金ID・学校の消費税・夜間の受付）はサーバー（/api/billing）が判定し、理由を表示する。
// 利用者には料金ID・原価・利益を出さない。ストア用のアプリの中では、料金の案内・申し込み・支払いを出さない（lib/native.ts）
import { useEffect, useState } from "react";
import { useUI } from "@/components/ui-context";
import { Badge, Btn, Card, Modal } from "@/components/ui";
import { isNativeApp } from "@/lib/native";
import { FREE_QUOTA, billingPlan } from "@/lib/billing/catalog";
import { PAYMENT_METHODS, PREPAID_MONTHS, prepaidTotal, type PrepaidMonths } from "@/lib/billing/prepaid";
import {
  coursesOf, currentPlanLabel, limitLabel, priceLabel, PERSONAL_FEATURES, PERSONAL_OPUS_SURCHARGE, SCHOOL_DESCRIPTIONS, SCHOOL_FEATURES,
  type Audience, type Course,
} from "@/lib/subscription-plans";

type Availability = Record<string, { ok: boolean; reason?: string }>;
type BillingInfo = {
  enabled?: boolean; nightEnabled?: boolean; canManage?: boolean; used?: number; opusAmount?: number; error?: string;
  account?: { plan_id?: string; status?: string; quota?: number; prepaid_until?: string | null } | null;
  pendingOrders?: { id: string }[]; availability?: Availability;
  /** 契約の表示名（確認済みの旧プランを含む。サーバーが決める） */
  planLabel?: string;
  /** 料金表に無い料金ID の契約（確認待ち。0018）。理由は管理者だけ */
  review?: { at: string; reason: string | null } | null;
};

const STATUS_LABEL: Record<string, string> = {
  free: "無料プラン", active: "契約中", payment_pending: "お支払いの確認中", past_due: "お支払いの遅れ", unpaid: "未払い", canceled: "解約済み", incomplete: "お申し込みの途中",
};

export default function SubscriptionPlans() {
  const { T, session } = useUI();
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState(false);
  // 選んだコース（個人・塾／学校それぞれ）。キーだけをサーバーに送る
  const [pick, setPick] = useState<Record<Audience, string>>({ personal: "personal-mini", school: "school-mini" });
  const [native, setNative] = useState(false);
  // ver6：前払い（1・3・6・12か月分）。暗号資産は決済代行の設定があるときだけ
  const [months, setMonths] = useState<PrepaidMonths>(3);
  const [cryptoOk, setCryptoOk] = useState(false);
  useEffect(() => { fetch("/api/billing/prepaid").then((r) => r.json()).then((j) => setCryptoOk(!!j.crypto)).catch(() => {}); }, []);
  useEffect(() => { setNative(isNativeApp()); }, []);
  useEffect(() => {
    if (session.profile) fetch("/api/billing").then((r) => r.json()).then(setBilling).catch(() => setMessage("契約情報を読み込めませんでした。"));
  }, [session.profile]);

  const post = async (url: string, body: unknown) => {
    setBusy(true); setMessage("");
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const info = await r.json();
      if (!r.ok || !info.url) throw Error(info.error || "決済画面を開けません。");
      window.location.assign(info.url);
    } catch (e) { setMessage(e instanceof Error ? e.message : "決済を開始できません。"); } finally { setBusy(false); }
  };

  const current = billing?.planLabel || currentPlanLabel(billing?.account?.plan_id || session.school?.plan);
  const resync = async () => {
    setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resync" }) });
      const info = await r.json();
      if (!r.ok) throw Error(info.error || "契約を確認できませんでした。");
      setMessage(info.review ? "まだ料金表・旧プランの対応表に無い契約です（確認待ちのまま。権限は変えていません）。" : "契約を確認し、反映しました。");
      setBilling(await (await fetch("/api/billing")).json());
    } catch (e) { setMessage(e instanceof Error ? e.message : "契約を確認できませんでした。"); } finally { setBusy(false); }
  };
  const quota = billing?.account?.quota ?? 20;
  const prepaidUntil = billing?.account?.prepaid_until && Date.parse(billing.account.prepaid_until) > Date.now() ? new Date(billing.account.prepaid_until) : null;
  const canApply = !!(billing?.enabled && billing?.canManage);

  if (native) {
    return <Card title="ご契約の状況" sub={`現在のプラン：${current}`}>
      {billing?.enabled
        ? <p style={{ fontSize: 13, color: T.textSub, margin: 0 }}>今期の採点：{billing.used || 0} / {quota}回</p>
        : <p style={{ fontSize: 13, color: T.textSub, margin: 0 }}>採点の回数の上限は、ご契約の内容に従います。</p>}
    </Card>;
  }

  const panel = { border: `1px solid ${T.line}`, borderRadius: 14, padding: 18, background: T.panelAlt, minWidth: 0 };
  const featureList = (features: string[]) => <ul style={{ paddingInlineStart: 20, color: T.textSub, fontSize: 13, lineHeight: 1.9 }}>{features.map((f) => <li key={f}>{f}</li>)}</ul>;

  /** 1つの採点方式（通常／夜間）の4コース。選んで申し込む */
  const group = (audience: Audience, night: boolean) => {
    const list = coursesOf(audience, night);
    return <div key={`${audience}-${night}`} style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{night ? "夜間採点" : "通常採点"}</div>
      {night && <p style={{ fontSize: 12, color: T.textSub, margin: "0 0 6px", lineHeight: 1.7 }}>
        採点の予約を、日本時間22時〜翌6時の間に順に処理します。結果は採点履歴に保存します。終わる時刻は答案の量や混み具合で変わり、お約束できません。
      </p>}
      <div role="radiogroup" aria-label={`${audience === "personal" ? "個人・塾" : "学校"}の${night ? "夜間採点" : "通常採点"}のコース`} style={{ display: "grid", gap: 6 }}>
        {list.map((x: Course) => {
          const a = billing?.availability?.[x.key];
          return <label key={x.key} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", padding: "8px 10px", border: `1px solid ${pick[audience] === x.key ? T.accent : T.line}`, borderRadius: 10, background: T.panel }}>
            {canApply && <input type="radio" name={`course-${audience}`} checked={pick[audience] === x.key} onChange={() => setPick({ ...pick, [audience]: x.key })} />}
            <span style={{ fontWeight: 700, minWidth: 110 }}>{x.name}</span>
            <span style={{ whiteSpace: "nowrap" }}>{priceLabel(x)}</span>
            <span style={{ whiteSpace: "nowrap", color: T.textSub }}>{limitLabel(x)}</span>
            {canApply && a && !a.ok && <span style={{ fontSize: 12, color: T.warn, flexBasis: "100%" }}>{a.reason}</span>}
          </label>;
        })}
      </div>
    </div>;
  };

  /** 選んだコースの申し込み（決済が有効で、管理者のときだけ。申し込めないコースは理由を出して押せない） */
  const applyButton = (audience: Audience) => {
    if (!canApply) return null;
    const a = billing?.availability?.[pick[audience]];
    const plan = billingPlan(pick[audience]);
    const total = plan ? prepaidTotal(plan, months) : null;
    return <div style={{ marginTop: 12 }}>
      <Btn variant="primary" onClick={() => post("/api/billing", { planId: pick[audience] })} disabled={busy || !a?.ok || !!prepaidUntil}>選んだコースを月額で申し込む</Btn>
      <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 4 }}>月額（自動更新）：{PAYMENT_METHODS.monthly}</div>
      {plan && !plan.night && total && (
        <div style={{ marginTop: 10, padding: 10, border: `1px dashed ${T.line}`, borderRadius: 10, background: T.panel }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>まとめて前払い（自動更新なし）</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0" }} role="radiogroup" aria-label="前払いの月数">
            {PREPAID_MONTHS.map((m) => <label key={m} style={{ fontSize: 12.5, padding: "4px 8px", border: `1px solid ${months === m ? T.accent : T.line}`, borderRadius: 8, cursor: "pointer" }}>
              <input type="radio" name={`months-${audience}`} checked={months === m} onChange={() => setMonths(m)} /> {m}か月
            </label>)}
          </div>
          <div style={{ fontSize: 13 }}>お支払い：<b>{total.total.toLocaleString("ja-JP")}円</b>{total.tax ? `（税別 ${total.subtotal.toLocaleString("ja-JP")}円＋消費税 ${total.tax.toLocaleString("ja-JP")}円）` : "（税込）"}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            <Btn size="sm" onClick={() => post("/api/billing/prepaid", { planId: plan.id, months, method: "stripe" })} disabled={busy || !a?.ok}>カード・コンビニ・PayPay などで前払い</Btn>
            {cryptoOk && <Btn size="sm" onClick={() => post("/api/billing/prepaid", { planId: plan.id, months, method: "crypto" })} disabled={busy}>暗号資産（ビットコイン・ステーブルコイン）で前払い</Btn>}
          </div>
          <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 4, lineHeight: 1.6 }}>
            前払い：{PAYMENT_METHODS.prepaid}{cryptoOk ? `。${PAYMENT_METHODS.crypto}` : ""}。お支払いの確認後に、選んだ月数のあいだ有料の回数が使えます（月ごとに数え直します）。
          </div>
        </div>
      )}
    </div>;
  };

  return <Card title="サブスクリプション" sub={`現在のプラン：${current}`}>
    <p style={{ fontSize: 13, color: T.textSub, lineHeight: 1.7 }}>
      採点・返却・復習まで、授業の規模に合わせて選べます。
      {billing?.enabled ? "管理者が決済画面（Stripe）で契約できます。契約期間ごとに採点回数の上限を適用します。" : "有料プランの料金のご案内です。お申し込みの受付を始めたら、管理者がこの画面から申し込めます。"}
    </p>
    {billing?.enabled && <p style={{ fontSize: 13 }}>
      契約状況：{STATUS_LABEL[billing.account?.status || "free"] ?? "契約内容をご確認ください"}{prepaidUntil ? `（前払い：${prepaidUntil.toLocaleDateString("ja-JP")} まで）` : ""} ／ 今期の採点：{billing.used || 0} / {quota}回
      {(billing.opusAmount || 0) > 0 && ` ／ Opus 単独の追加料金：${(billing.opusAmount || 0).toLocaleString("ja-JP")}円`}
      {billing.canManage && <><br /><Btn onClick={() => post("/api/billing", { action: "portal" })} disabled={busy}>契約・支払い管理</Btn></>}
    </p>}
    {billing?.review && <div role="status" style={{ border: `1px solid ${T.warn}`, borderRadius: 10, padding: 12, margin: "8px 0", fontSize: 13, lineHeight: 1.7 }}>
      <b>契約の内容を確認しています</b>（{new Date(billing.review.at).toLocaleString("ja-JP")} から）。いまの契約の状況・採点の回数は変えていません。
      {billing.canManage && <>
        <br />理由：{billing.review.reason || "料金表に無い契約です"}。旧プランの対応表を確認したあと「契約を再確認」を押してください（料金・契約は変えません）。
        <br /><Btn size="sm" onClick={resync} disabled={busy}>契約を再確認</Btn>
      </>}
    </div>}
    {message && <p role="alert" style={{ color: T.ng }}>{message}</p>}
    {billing?.pendingOrders?.map((o) => <p key={o.id}><Btn disabled={busy} onClick={() => post("/api/billing/opus", { jobId: o.id })}>未完了の Opus 単独の追加料金（{PERSONAL_OPUS_SURCHARGE}円）の支払いを再開</Btn></p>)}

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 16 }}>
      <article style={panel}>
        <h3 style={{ marginTop: 0 }}>無料プラン</h3>
        <p style={{ color: T.textSub, fontSize: 13 }}>基本的なAI採点を、まずは少量の答案で体験。</p>
        <div style={{ fontSize: 24, fontWeight: 700 }}>月額0円</div>
        <p style={{ fontWeight: 700 }}>月{FREE_QUOTA}答案まで・3モデル併用で採点</p>
        {featureList(["答案の取り込みと採点結果の確認", "返却前に先生が判定・得点を確認"])}
        <p style={{ fontSize: 12, color: T.textSub }}>1答案の採点で1枠を使います（再採点も1枠）。採点に失敗したときは枠を戻します。無料プランは3モデル併用だけです。</p>
      </article>

      <article style={{ ...panel, borderColor: T.accent }}>
        <Badge tone="accent">個人・塾</Badge>
        <h3>個人・塾プラン</h3>
        <p style={{ color: T.textSub, fontSize: 13 }}>塾講師・個人教師向け。月額は税込です。基本料金に3モデル併用の採点を含みます（Haiku で採点し、確認が必要な答案だけを Sonnet・Opus で点検します）。</p>
        {group("personal", false)}
        {group("personal", true)}
        {applyButton("personal")}
        <div style={{ background: T.accentSoft, borderRadius: 10, padding: 12, marginTop: 12 }}>
          <div style={{ fontWeight: 700 }}>Opus 単独：1答案につき追加 {PERSONAL_OPUS_SURCHARGE}円（税込）</div>
          <p style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 0 }}>Opus 単独を選んだ答案は、月の枠を1答案分使い、その都度の決済画面で追加料金を支払います。採点に失敗したときは返金します。3モデル併用の中の自動の点検には、追加料金はかかりません。</p>
        </div>
        {featureList(PERSONAL_FEATURES)}
      </article>

      <article style={panel}>
        <Badge>学校</Badge>
        <h3>学校プラン</h3>
        <p style={{ color: T.textSub, fontSize: 13, lineHeight: 1.7 }}>月額は税別です（お支払いのときに消費税を加えます）。Opus 単独の採点を基本料金に含みます。3モデル併用も選べます。</p>
        {group("school", false)}
        {group("school", true)}
        {applyButton("school")}
        <ul style={{ paddingInlineStart: 20, color: T.textSub, fontSize: 12.5, lineHeight: 1.8 }}>
          {(["mini", "light", "standard", "pro"] as const).map((t) => <li key={t}><b>{coursesOf("school", false).find((x) => x.tier === t)?.name}</b>：{SCHOOL_DESCRIPTIONS[t]}</li>)}
        </ul>
        {featureList(SCHOOL_FEATURES)}
      </article>
    </div>

    <p style={{ fontSize: 12, color: T.textSub, lineHeight: 1.8 }}>
      1答案（学校は1枚）＝生徒1人分の答案で、2ページ・20問までです。これを超える答案と PDF の答案は採点できません（写真・画像で取り込んでください）。
      1回の採点（再採点も含む）で1回分を使い、失敗したときは戻します。月の回数は契約期間ごとに数え直します。
      <Btn size="sm" variant="ghost" onClick={() => setNotes(true)}>契約前の確認事項</Btn>
    </p>
    <p style={{ fontSize: 13, color: T.textSub, lineHeight: 1.8, marginBottom: 0 }}>生徒の復習は、生徒本人の ChatGPT で行います（「ChatGPT で復習」）。ChatGPT の契約・利用料はこのアプリの料金に含まれず、生徒本人または保護者が負担します。アプリの中で AI と会話する機能は含みません。</p>
    <p style={{ fontSize: 12, color: T.textSub, marginBottom: 0 }}><a href="/tokushoho">特定商取引法に基づく表記</a>・<a href="/terms">利用規約</a></p>
    <Modal open={notes} onClose={() => setNotes(false)} title="契約前の確認事項" footer={<Btn onClick={() => setNotes(false)}>閉じる</Btn>}>
      <ul style={{ paddingInlineStart: 20, lineHeight: 1.9 }}>
        <li>契約は決済画面（Stripe）で金額を確かめて行います。お支払いが確認できてから、有料の回数が使えるようになります。</li>
        <li>月額の契約は、カード・Apple Pay・Google Pay・Link で毎月自動で支払います。前払いは、コンビニ払い・PayPay・銀行振込・暗号資産なども使えます（使える方法は決済画面に表示されます）。</li>
        <li>前払いは自動で更新しません。期限を過ぎると無料プランに戻ります。途中解約・返金の扱いは、特定商取引法に基づく表記・利用規約に従います。</li>
        <li>暗号資産の支払いは、決済代行の画面で円建ての金額を支払います。相場の換算・送金手数料は決済代行の画面の表示に従います。</li>
        <li>契約の変更・解約は「契約・支払い管理」から行います。解約は契約期間の終わりまで有効です。</li>
        <li>月の回数を使い切ると、次の契約期間まで新しい採点はできません（超過分を自動で請求しません）。</li>
        <li>既存の契約と保存済みの答案は、この料金の表示で変わりません。</li>
      </ul>
    </Modal>
  </Card>;
}
