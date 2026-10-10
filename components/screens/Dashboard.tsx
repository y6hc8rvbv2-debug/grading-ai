"use client";
// ダッシュボード。docs/prototype-v3.jsx から移植。
// 表示するのは、この学校の実際のデータと、アプリが実際にできることだけ（デモの数値・架空の利用者の声・料金表は出さない）。
import React, { useState } from "react";
import { FONT_UI, FONT_HAND } from "@/lib/ui/theme";
import { pct } from "@/lib/util";
import { useUI, type View } from "@/components/ui-context";
import { Btn, Card, Field, Input, Section, Stat, grid, inputStyle } from "@/components/ui";
import { APP_INFO, POLICY_VERSION, mailtoLink } from "@/lib/app-info";

const QA = [
  { q: "生徒の実名は保存されますか？", a: "保存しません。名簿は出席番号・受験番号・イニシャル・匿名IDだけで、実名を入れる欄はデータベースにありません。答案の写真に氏名が書かれている場合、写真そのものは保存され、採点のため AI に送られます（氏名を読み取って保存・表示はしません）。" },
  { q: "採点結果は修正できますか？", a: "できます。採点結果の画面で、丸・三角・バツと得点を1問ずつ直せます。直した内容は赤ペン画像と合計点に反映されます。" },
  { q: "答案が全問白紙のときはどうなりますか？", a: "採点はせず「白紙」として記録します。模範解答の画面で、テストに登録した正答・解説をもとにした下書きを確認できます。" },
  { q: "印刷機やコピー機の答案を取り込めますか？", a: "複合機で PDF にスキャンして保存し、「新規採点」の「PDF一括」で取り込めます。" },
  { q: "生徒のスマートフォンから提出できますか？", a: "生徒が自分で提出する機能はありません。答案は先生が撮影・取り込みます。採点結果は、先生が確認したあと、生徒のアカウントに返却できます。" },
  { q: "AIの採点はどのくらい信頼できますか？", a: "AI の採点は下書きです。設問ごとに読み取りの確かさを記録し、低いものや記述式（設定による）は「要確認」に回します。成績は、返却前に先生が確認して決めてください。" },
  { q: "答案の写真はどこに送られますか？", a: "採点のため、答案の写真と設問・正答を AI の提供元（Anthropic）に送ります。初めて AI 採点を使うときに確認の画面が出ます。詳しくはプライバシーポリシーをご覧ください。" },
  { q: "対応言語は？", a: "メニューなどの主な表示は、設定画面で言語を切り替えられます（本文は日本語です）。アラビア語などの右から左に書く言語の表示にも対応しています。" },
];

export default function Dashboard() {
  const { T, t, go, subs, toast, testById, session } = useUI();
  const [openQA, setOpenQA] = useState(0);
  const [contact, setContact] = useState({ name: "", email: "", body: "" });

  const done = subs.filter((s) => s.status !== "processing");
  const graded = done.filter((s) => s.status !== "blank" && testById(s.testId));
  const reviewCount = subs.filter((s) => s.result.items.some((i) => i.needReview) && s.status !== "processing").length;
  const avgRate = graded.length
    ? Math.round(graded.reduce((a, s) => a + pct(s.result.total, testById(s.testId)!.maxScore), 0) / graded.length * 10) / 10
    : 0;
  const savedMin = Math.round(done.length * 4.5);

  return (
    <div>
      <div style={{
        background: `linear-gradient(135deg, ${T.accent} 0%, ${T.accent}dd 55%, ${T.shu} 240%)`,
        borderRadius: 16, padding: "22px 20px", color: "#fff", marginBottom: 18, position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", right: -30, top: -20, opacity: 0.14, font: `700 130px ${FONT_HAND}` }}>朱</div>
        <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 700, letterSpacing: ".08em" }}>AI GRADING AGENT</div>
        <h1 style={{ margin: "6px 0 6px", font: `700 24px ${FONT_UI}` }}>{t("appName")}</h1>
        <p style={{ margin: 0, fontSize: 13, opacity: 0.9, maxWidth: 520, lineHeight: 1.7 }}>{t("appSub")}</p>
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <Btn variant="shu" onClick={() => go("new")}>答案をアップロードする</Btn>
          <Btn onClick={() => go("review")} style={{ background: "rgba(255,255,255,.16)", color: "#fff", borderColor: "rgba(255,255,255,.35)" }}>
            要確認 {reviewCount} 件を見る
          </Btn>
        </div>
      </div>

      <div style={{ ...grid(160), marginBottom: 18 }}>
        <Stat label="採点済み答案" value={done.length} unit="枚" tone="accent" sub={`未処理 ${subs.length - done.length} 枚`} />
        <Stat label="平均得点率" value={avgRate} unit="%" tone="ok" sub={`対象 ${graded.length} 枚`} />
        <Stat label="要確認の設問" value={reviewCount} unit="枚" tone="warn" sub="返却前に目視確認" />
        <Stat label="削減した採点時間" value={savedMin} unit="分" tone="shu" sub="1枚あたり4.5分換算" />
      </div>

      <Section title="はじめる">
        <div style={grid(200)}>
          {[
            { k: "new", icon: "📤", t: "答案をアップロード", d: "カメラ・PC・PDF から取り込み" },
            { k: "processing", icon: "⏳", t: "採点中を確認", d: "処理の進み具合をリアルタイム表示" },
            { k: "review", icon: "🔍", t: "要確認を片づける", d: "認識信頼度が低い設問だけを集約" },
            { k: "weakness", icon: "📊", t: "弱点分析を見る", d: "単元別・設問形式別の定着度" },
          ].map((a) => (
            <button key={a.k} onClick={() => go(a.k as View)} style={{
              textAlign: "left", background: T.panel, border: `1px solid ${T.line}`, borderRadius: 13,
              padding: 14, cursor: "pointer", font: FONT_UI, boxShadow: T.shadow,
            }}>
              <div style={{ fontSize: 22, marginBottom: 7 }}>{a.icon}</div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text, marginBottom: 4 }}>{a.t}</div>
              <div style={{ fontSize: 11.5, color: T.textSub, lineHeight: 1.6 }}>{a.d}</div>
            </button>
          ))}
        </div>
      </Section>

      <div style={{ ...grid(320, 14), marginBottom: 18 }}>
        {/* Q&A */}
        <Card title="よくある質問" sub="はじめての方はこちらから">
          <div style={{ display: "grid", gap: 6 }}>
            {QA.map((item, i) => (
              <div key={i} style={{ border: `1px solid ${T.line}`, borderRadius: 10, overflow: "hidden" }}>
                <button onClick={() => setOpenQA(openQA === i ? -1 : i)} style={{
                  width: "100%", textAlign: "start", padding: "10px 12px", background: openQA === i ? T.accentSoft : T.panelAlt,
                  border: "none", cursor: "pointer", font: `700 12.5px ${FONT_UI}`, color: T.text,
                  display: "flex", gap: 8, alignItems: "center",
                }}>
                  <span style={{ color: T.accent }}>Q</span>
                  <span style={{ flex: 1 }}>{item.q}</span>
                  <span style={{ color: T.textFaint }}>{openQA === i ? "－" : "＋"}</span>
                </button>
                {openQA === i && (
                  <div style={{ padding: "11px 12px", fontSize: 12.5, color: T.textSub, lineHeight: 1.85, background: T.panel }}>
                    {item.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* 規約とプライバシー */}
        <Card title="利用規約とプライバシー" sub={`ご利用の前にご確認ください（${POLICY_VERSION} 版）`}>
          <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12.5, color: T.textSub, lineHeight: 1.85 }}>
            <li>答案画像の取り込みは、学校の規程と、生徒・保護者への説明の範囲内で行ってください。</li>
            <li>AI の採点結果は下書きです。返却前に先生が確認・修正してください。</li>
            <li>採点のため、答案の写真を AI の提供元（Anthropic）に送ります。</li>
            <li>生徒の実名・住所・連絡先を、コメントや問題文に書かないでください。</li>
          </ul>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <Btn size="sm" onClick={() => { window.location.href = "/terms"; }}>利用規約</Btn>
            <Btn size="sm" onClick={() => { window.location.href = "/privacy"; }}>プライバシーポリシー</Btn>
            <Btn size="sm" variant="soft" onClick={() => go("settings")}>アカウントの削除（設定画面）</Btn>
          </div>
        </Card>
      </div>

      {/* お問い合わせ */}
      <Card title="お問い合わせ" sub={APP_INFO.provider ? `提供者：${APP_INFO.provider}` : "提供者"}>
        <div style={{ ...grid(260, 14) }}>
          <div style={{ fontSize: 12.5, color: T.textSub, lineHeight: 2 }}>
            {APP_INFO.supportEmail
              ? <div><b style={{ color: T.text }}>メール</b>　{APP_INFO.supportEmail}</div>
              : <div style={{ color: T.warn }}>問い合わせ先がまだ設定されていません（管理者が NEXT_PUBLIC_SUPPORT_EMAIL を設定します）。</div>}
            <div>返信はメールで行います。生徒の実名は書かないでください。</div>
            <div><a href="/support">サポートのページ</a></div>
          </div>
          <div>
            <Field label="お名前（担当者）"><Input value={contact.name} onChange={(v) => setContact({ ...contact, name: v })} placeholder="例：教務 担当" /></Field>
            <Field label="返信先メールアドレス"><Input value={contact.email} onChange={(v) => setContact({ ...contact, email: v })} placeholder="school@example.ed.jp" /></Field>
            <Field label="お問い合わせ内容" hint="生徒の実名は記入しないでください。">
              <textarea value={contact.body} onChange={(e) => setContact({ ...contact, body: e.target.value })}
                rows={4} style={{ ...inputStyle(T), resize: "vertical" }} placeholder="ご質問・ご要望をご記入ください" />
            </Field>
            <Btn variant="primary" full disabled={!APP_INFO.supportEmail} onClick={() => {
              if (!contact.email || !contact.body) { toast("メールアドレスと内容を入力してください", "warn"); return; }
              const link = mailtoLink(`${APP_INFO.name} お問い合わせ`,
                `お名前：${contact.name}\n返信先：${contact.email}\n学校：${session.school?.name ?? ""}\n\n${contact.body}`);
              if (!link) return;
              // 送信はお使いのメールソフトで行う（アプリからは外部に送らない）
              window.location.href = link;
              toast("メールソフトを開きました。内容を確認して送信してください");
              setContact({ name: "", email: "", body: "" });
            }}>メールで送る</Btn>
          </div>
        </div>
      </Card>
    </div>
  );
}
