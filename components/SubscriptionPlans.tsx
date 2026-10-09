"use client";
import { useState } from "react";
import { useUI } from "@/components/ui-context";
import { Badge, Btn, Card, Modal } from "@/components/ui";
import { currentPlanLabel, PERSONAL_FEATURES, PERSONAL_TIERS, SCHOOL_FEATURES, SCHOOL_PLANS } from "@/lib/subscription-plans";

const yen = (amount: number) => `¥${amount.toLocaleString("ja-JP")}`;

export default function SubscriptionPlans() {
  const { T, session, subs } = useUI();
  const [selected, setSelected] = useState<string | null>(null);
  const current = currentPlanLabel(session.school?.plan);
  const month = new Date().toISOString().slice(0, 7);
  const registered = subs.filter(s => (s.uploadedAt || "").slice(0, 7) === month).length;
  const panel = { border: `1px solid ${T.line}`, borderRadius: 14, padding: 18, background: T.panelAlt, minWidth: 0 };
  const featureList = (features: string[]) => <ul style={{ paddingInlineStart: 20, color: T.textSub, fontSize: 13, lineHeight: 1.9 }}>{features.map(f => <li key={f}>{f}</li>)}</ul>;
  const night = (price: number) => <div style={{ background: T.accentSoft, borderRadius: 10, padding: 12, marginTop: 12 }}>
    <div style={{ fontWeight: 700 }}>深夜採点・翌日結果プラン：20%OFF</div>
    <div style={{ fontSize: 20, fontWeight: 700, marginTop: 5 }}>{yen(price)}<span style={{ fontSize: 12 }}> /月（税別）</span></div>
    <div style={{ fontSize: 12, color: T.textSub, marginTop: 5 }}>提供準備中。現在は予約採点・翌日結果の提供を行っていません。</div>
  </div>;

  return <Card title="サブスクリプション" sub={`現在のプラン：${current}`}>
    <p style={{ fontSize: 13, color: T.textSub, lineHeight: 1.7 }}>採点・返却・復習まで、授業の規模に合わせて選べます。有料プランは料金のご案内です。オンライン契約・決済は準備中です。</p>
    <p style={{ fontSize: 12, color: T.textSub }}>今月登録した答案：{registered.toLocaleString("ja-JP")}件（課金枚数とは連動していません）</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 16 }}>
      <article style={panel}>
        <h3 style={{ marginTop: 0 }}>無料プラン</h3>
        <p style={{ color: T.textSub, fontSize: 13 }}>基本的なAI採点を、まずは少量の答案で体験。</p>
        <div style={{ fontSize: 28, fontWeight: 700 }}>¥0<span style={{ fontSize: 13 }}> /月</span></div>
        <p style={{ fontWeight: 700 }}>月20枚まで・○×マーク中心の基本採点</p>
        {featureList(["答案の取り込みと採点結果の確認", "返却前に先生が判定・得点を確認"])}
        <p style={{ fontSize: 12, color: T.textSub }}>月20枚はプランの設定予定です。現在の画面では枚数制限・機能制限を適用していません。</p>
      </article>
      <article style={{ ...panel, borderColor: T.accent }}>
        <Badge tone="accent">おすすめ</Badge>
        <h3>個人・塾プラン</h3>
        <p style={{ color: T.textSub, fontSize: 13 }}>塾講師・個人教師向け。赤ペンで確認し、生徒本人への返却と復習につなげます。</p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <caption style={{ textAlign: "left", marginBottom: 8, fontWeight: 700 }}>月間枚数と月額料金</caption>
          <thead><tr><th scope="col" style={{ textAlign: "left" }}>枚数</th><th scope="col" style={{ textAlign: "right" }}>通常</th><th scope="col" style={{ textAlign: "right" }}>深夜・準備中</th></tr></thead>
          <tbody>{PERSONAL_TIERS.map(t => <tr key={t.sheets} style={{ borderTop: `1px solid ${T.line}` }}><th scope="row" style={{ textAlign: "left", padding: "10px 0" }}>{t.sheets.toLocaleString("ja-JP")}枚</th><td style={{ textAlign: "right" }}>{yen(t.price)}</td><td style={{ textAlign: "right" }}>{yen(t.nightPrice)}</td></tr>)}</tbody>
        </table>
        <p style={{ fontSize: 13 }}>1,001枚以上：¥8 /枚（適用範囲は契約時に確認）</p>
        <p style={{ fontSize: 12, color: T.textSub }}>個人・塾プランの税区分は確認中です。深夜採点は20%OFFの予定で、提供準備中です。</p>
        {featureList(PERSONAL_FEATURES)}
        <Btn onClick={() => setSelected("個人・塾プラン")}>契約前の確認事項</Btn>
      </article>
      {SCHOOL_PLANS.map(p => <article key={p.id} style={panel}>
        <h3 style={{ marginTop: 0 }}>{p.name}</h3>
        <p style={{ fontSize: 13, color: T.textSub, lineHeight: 1.7 }}>{p.description}</p>
        <div style={{ fontSize: 28, fontWeight: 700 }}>{yen(p.price)}<span style={{ fontSize: 13 }}> /月（税別）</span></div>
        <p style={{ fontWeight: 700 }}>月{p.limit.toLocaleString("ja-JP")}枚まで</p>
        {night(p.nightPrice)}
        {featureList(SCHOOL_FEATURES)}
        <p style={{ fontSize: 12, color: T.textSub }}>採算試算は1枚＝生徒1人分（2ページ・20問）で計算しています。ページ・設問が多い答案の扱い、教職員数は別途設定します。枚数制限の自動適用は準備中です。</p>
        <Btn onClick={() => setSelected(p.name)}>契約前の確認事項</Btn>
      </article>)}
    </div>
    <p style={{ fontSize: 13, color: T.textSub, lineHeight: 1.8, marginBottom: 0 }}>「チャッピー先生」との復習は、生徒本人のChatGPTで行います。ChatGPTの契約・利用料はこのアプリの料金に含まれず、生徒本人または保護者が負担します。会話をアプリ内で開始する機能は含みません。</p>
    <Modal open={selected !== null} onClose={() => setSelected(null)} title={`${selected ?? ""}：契約前の確認事項`} footer={<Btn onClick={() => setSelected(null)}>閉じる</Btn>}>
      <p>この画面から契約・支払い・プラン変更は行われません。</p>
      <ul style={{ paddingInlineStart: 20, lineHeight: 1.9 }}><li>採点枚数の数え方（複数ページ・再採点の扱い）</li><li>月間上限・超過料金・教職員数と利用できる機能</li><li>税区分・開始日・解約条件</li><li>深夜採点プランの提供開始時期</li></ul>
      <p>既存の契約と保存済みの答案は、この料金表示で変更されません。</p>
    </Modal>
  </Card>;
}
