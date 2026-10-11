"use client";
import { useEffect, useState } from "react";
import { useUI } from "@/components/ui-context";
import { Badge, Btn, Card, Modal } from "@/components/ui";
import { isNativeApp } from "@/lib/native";
import { currentPlanLabel, PERSONAL_FEATURES, PERSONAL_OPUS_SURCHARGE, PERSONAL_TIERS, SCHOOL_FEATURES, SCHOOL_PLANS } from "@/lib/subscription-plans";

const yen = (amount: number) => `¥${amount.toLocaleString("ja-JP")}`;

export default function SubscriptionPlans() {
  const { T, session, subs } = useUI();
  const [selected, setSelected] = useState<string | null>(null);
  const [billing, setBilling] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [personalPlan, setPersonalPlan] = useState<string>(PERSONAL_TIERS[0].id);
  // ストア用のアプリの中では、料金の案内・申し込み・支払いを出さず、契約の状況だけを出す（lib/native.ts）
  const [native, setNative] = useState(false);
  useEffect(() => { setNative(isNativeApp()); }, []);
  useEffect(() => { if (session.profile) fetch("/api/billing").then(r => r.json()).then(setBilling).catch(() => setMessage("契約情報を読み込めませんでした。")); }, [session.profile]);
  const pay = async (planId?: string) => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(planId ? { planId } : { action: "portal" }) });
      const info = await response.json();
      if (!response.ok || !info.url) throw Error(info.error || "決済画面を開けません。");
      window.location.assign(info.url);
    } catch (e) { setMessage(e instanceof Error ? e.message : "決済を開始できません。"); } finally { setBusy(false); }
  };
  const enabled = billing?.enabled && billing?.canManage;
  const resumeOpus = async (jobId: string) => {
    setBusy(true);
    try {
      const r = await fetch("/api/billing/opus", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId }) });
      const data = await r.json();
      if (!r.ok || !data.url) throw Error(data.error || "支払いを再開できません。");
      window.location.assign(data.url);
    } catch (e) { setMessage(e instanceof Error ? e.message : "支払いを再開できません。"); } finally { setBusy(false); }
  };
  const nightReady = enabled && billing?.nightEnabled;
  const current = currentPlanLabel(billing?.account?.plan_id || session.school?.plan);
  const month = new Date().toISOString().slice(0, 7);
  const registered = subs.filter(s => (s.uploadedAt || "").slice(0, 7) === month).length;
  const panel = { border: `1px solid ${T.line}`, borderRadius: 14, padding: 18, background: T.panelAlt, minWidth: 0 };
  const featureList = (features: string[]) => <ul style={{ paddingInlineStart: 20, color: T.textSub, fontSize: 13, lineHeight: 1.9 }}>{features.map(f => <li key={f}>{f}</li>)}</ul>;
  const night = (price: number) => <div style={{ background: T.accentSoft, borderRadius: 10, padding: 12, marginTop: 12 }}>
    <div style={{ fontWeight: 700 }}>夜間採点・翌日結果プラン：20%OFF</div>
    <div style={{ fontSize: 20, fontWeight: 700, marginTop: 5 }}>{yen(price)}<span style={{ fontSize: 12 }}> /月（税別）</span></div>
    <div style={{ fontSize: 12, color: T.textSub, marginTop: 5 }}>日本時間22時〜翌6時に予約を処理。結果は採点履歴に保存します。混雑・障害で遅れる場合があります。</div>
  </div>;

  if (native) {
    return <Card title="ご契約の状況" sub={`現在のプラン：${current}`}>
      {billing?.enabled
        ? <p style={{ fontSize: 13, color: T.textSub, margin: 0 }}>今期の採点：{billing.used || 0} / {billing.account?.quota ?? 20}回</p>
        : <p style={{ fontSize: 13, color: T.textSub, margin: 0 }}>採点の回数の上限は、ご契約の内容に従います。</p>}
    </Card>;
  }

  return <Card title="サブスクリプション" sub={`現在のプラン：${current}`}>
    <p style={{ fontSize: 13, color: T.textSub, lineHeight: 1.7 }}>採点・返却・復習まで、授業の規模に合わせて選べます。{billing?.enabled ? "管理者が決済画面で契約できます。契約期間ごとに採点回数の上限を適用します。" : "有料プランの料金のご案内です。お申し込みの受付を始めたら、管理者がこの画面から申し込めます。"}</p>
    <p style={{ fontSize: 12, color: T.textSub }}>今月登録した答案：{registered.toLocaleString("ja-JP")}件（課金枚数とは連動していません）</p>
    {billing?.enabled && <p>契約状況：{billing.account?.status || "無料"} ／ 今期の採点：{billing.used || 0} / {billing.account?.quota || 20}回 ／ Opus追加料金：{yen(billing.opusAmount || 0)}<br />{billing.canManage && <Btn onClick={() => pay()} disabled={busy}>契約・支払い管理</Btn>}</p>}
    {message && <p role="alert">{message}</p>}
    {billing?.pendingOrders?.map((o: { id: string }) => <p key={o.id}><Btn disabled={busy} onClick={() => resumeOpus(o.id)}>未完了のOpus追加55円の支払いを再開</Btn></p>)}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 16 }}>
      <article style={panel}>
        <h3 style={{ marginTop: 0 }}>無料プラン</h3>
        <p style={{ color: T.textSub, fontSize: 13 }}>基本的なAI採点を、まずは少量の答案で体験。</p>
        <div style={{ fontSize: 28, fontWeight: 700 }}>¥0<span style={{ fontSize: 13 }}> /月</span></div>
        <p style={{ fontWeight: 700 }}>月20回まで・3モデル併用で採点</p>
        {featureList(["答案の取り込みと採点結果の確認", "返却前に先生が判定・得点を確認"])}
        <p style={{ fontSize: 12, color: T.textSub }}>1回の採点で1枠を使います（再採点も1回）。採点に失敗したときは枠を戻します。無料プランは3モデル併用だけです。</p>
      </article>
      <article style={{ ...panel, borderColor: T.accent }}>
        <Badge tone="accent">おすすめ</Badge>
        <h3>個人・塾プラン</h3>
        <p style={{ color: T.textSub, fontSize: 13 }}>塾講師・個人教師向け。赤ペンで確認し、生徒本人への返却と復習につなげます。</p>
        <p style={{ fontWeight: 700 }}>基本料金に3モデル併用の採点を含みます</p>
        <p style={{ color: T.textSub, fontSize: 12, lineHeight: 1.7 }}>Haikuで採点し、追加確認が必要な答案をSonnet・Opusで点検します。毎回3モデルすべてを使う方式ではありません。</p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <caption style={{ textAlign: "left", marginBottom: 8, fontWeight: 700 }}>月間答案数と月額料金（税込）</caption>
            <thead><tr><th scope="col" style={{ textAlign: "left" }}>コース</th><th scope="col" style={{ textAlign: "right" }}>月間上限</th><th scope="col" style={{ textAlign: "right" }}>通常</th>{billing?.nightEnabled && <th scope="col" style={{ textAlign: "right" }}>夜間</th>}</tr></thead>
            <tbody>{PERSONAL_TIERS.map(t => <tr key={t.id} style={{ borderTop: `1px solid ${T.line}` }}><th scope="row" style={{ textAlign: "left", padding: "10px 0" }}>{t.name}</th><td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{t.sheets.toLocaleString("ja-JP")}答案</td><td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{yen(t.price)}</td>{billing?.nightEnabled && <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{yen(t.nightPrice)}</td>}</tr>)}</tbody>
          </table>
        </div>
        {billing?.nightEnabled && <p style={{ fontSize: 12, color: T.textSub, lineHeight: 1.7 }}>夜間採点・翌日結果プランは月額20%OFF、月間上限は通常と同じです。日本時間22時〜翌6時に処理し、結果は採点履歴に保存します。</p>}
        <div style={{ background: T.accentSoft, borderRadius: 10, padding: 12, marginTop: 12 }}>
          <div style={{ fontWeight: 700 }}>Opus単独：1答案につき追加{yen(PERSONAL_OPUS_SURCHARGE)}（税込）</div>
          <p style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 0 }}>Opus単独を選んだ答案は月間枠を1答案分使います。併用で採点した後にOpusで採点し直す場合も、追加1回につき{yen(PERSONAL_OPUS_SURCHARGE)}です。併用中の自動点検には、この追加料金はかかりません。{billing?.nightEnabled ? "夜間プランでも追加料金は同額です。" : ""}</p>
        </div>
        <p style={{ fontSize: 12, color: T.textSub }}>1答案＝生徒1人分で、2ページ・20問までです。これを超える答案と PDF の答案は採点できません（写真・画像で取り込んでください）。1回の採点（再採点も含む）で1枠を使い、失敗したときは枠を戻します。Opus 単独の追加料金は、決済画面で支払ったあとに採点し、失敗したときは返金します。</p>
        {featureList(PERSONAL_FEATURES)}
        {enabled && <label>コース <select value={personalPlan} onChange={e => setPersonalPlan(e.target.value)}>{PERSONAL_TIERS.map(p => <option key={p.id} value={p.id}>{p.name}（月{p.sheets}答案）</option>)}</select></label>}
        {enabled && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}><Btn onClick={() => pay(personalPlan)} disabled={busy}>通常プランを申し込む</Btn>{nightReady && <Btn onClick={() => pay(`${personalPlan}-night`)} disabled={busy}>夜間プランを申し込む</Btn>}</div>}
        <Btn onClick={() => setSelected("個人・塾プラン")}>契約前の確認事項</Btn>
      </article>
      {SCHOOL_PLANS.map(p => <article key={p.id} style={panel}>
        <h3 style={{ marginTop: 0 }}>{p.name}</h3>
        <p style={{ fontSize: 13, color: T.textSub, lineHeight: 1.7 }}>{p.description}</p>
        <div style={{ fontSize: 28, fontWeight: 700 }}>{yen(p.price)}<span style={{ fontSize: 13 }}> /月（税別）</span></div>
        <p style={{ fontWeight: 700 }}>月{p.limit.toLocaleString("ja-JP")}答案まで</p>
        <p style={{ fontSize: 13 }}>Opus単独の採点を基本料金に含みます。3モデル併用も選べます。</p>
        {billing?.nightEnabled && night(p.nightPrice)}
        {featureList(SCHOOL_FEATURES)}
        <p style={{ fontSize: 12, color: T.textSub }}>1答案＝生徒1人分で、2ページ・20問までです。これを超える答案と PDF の答案は採点できません（写真・画像で取り込んでください）。1回の採点（再採点も含む）で1枠を使います。</p>
        {enabled && <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><Btn onClick={() => pay(p.id)} disabled={busy}>通常プランを申し込む</Btn>{nightReady && <Btn onClick={() => pay(`${p.id}-night`)} disabled={busy}>夜間プランを申し込む</Btn>}</div>}
        <Btn onClick={() => setSelected(p.name)}>契約前の確認事項</Btn>
      </article>)}
    </div>
    <p style={{ fontSize: 13, color: T.textSub, lineHeight: 1.8, marginBottom: 0 }}>生徒の復習は、生徒本人の ChatGPT で行います（「ChatGPT で復習」）。ChatGPT の契約・利用料はこのアプリの料金に含まれず、生徒本人または保護者が負担します。アプリの中で AI と会話する機能は含みません。</p>
    <p style={{ fontSize: 12, color: T.textSub, marginBottom: 0 }}><a href="/tokushoho">特定商取引法に基づく表記</a>・<a href="/terms">利用規約</a></p>
    <Modal open={selected !== null} onClose={() => setSelected(null)} title={`${selected ?? ""}：契約前の確認事項`} footer={<Btn onClick={() => setSelected(null)}>閉じる</Btn>}>
      <p>契約はStripeの決済画面で金額を確認して行います。契約変更・解約は「契約・支払い管理」を使ってください。</p>
      <ul style={{ paddingInlineStart: 20, lineHeight: 1.9 }}><li>採点枚数の数え方（複数ページ・再採点の扱い）</li><li>月間上限・超過料金・Opus単独の追加料金・教職員数と利用できる機能</li><li>税区分・開始日・解約条件</li></ul>
      <p>既存の契約と保存済みの答案は、この料金表示で変更されません。</p>
    </Modal>
  </Card>;
}
