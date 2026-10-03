"use client";
// ダッシュボード。docs/prototype-v3.jsx から移植。
import React, { useEffect, useState } from "react";
import { FONT_UI, FONT_MONO, FONT_HAND } from "@/lib/ui/theme";
import { download, pct } from "@/lib/util";
import { useUI, type View } from "@/components/ui-context";
import { Badge, Bar, Btn, Card, Field, Input, Modal, Section, Stat, grid, inputStyle } from "@/components/ui";

const FX_BASE = [
  { pair: "USD/JPY", v: 152.4 }, { pair: "EUR/JPY", v: 166.8 }, { pair: "GBP/JPY", v: 195.2 },
  { pair: "CNY/JPY", v: 21.05 }, { pair: "KRW/JPY", v: 0.111 }, { pair: "AUD/JPY", v: 99.7 },
  { pair: "INR/JPY", v: 1.82 }, { pair: "BRL/JPY", v: 27.4 },
];

const SUPPORT_EMAIL = "support@example-grading.jp";
const mailtoLink = (subject: string, body: string) =>
  `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

const PLANS = [
  { id: "free", name: "Free", price: "¥0", per: "/月", limit: 30, quota: "月 30 枚まで", feats: ["自動採点", "赤ペン画像", "CSV出力"], cta: "利用中" },
  { id: "school", name: "School", price: "¥9,800", per: "/月・1校", limit: 5000, quota: "月 5,000 枚", feats: ["クラス・生徒管理", "弱点分析レポート", "印刷機スキャン連携", "SSO"], cta: "アップグレード" },
  { id: "board", name: "Board", price: "個別見積", per: "", limit: 0, quota: "無制限", feats: ["教育委員会向け統合管理", "監査ログ", "オンプレ／専用リージョン", "SLA 99.9%"], cta: "問い合わせる" },
];

const QA = [
  { q: "生徒の実名は保存されますか？", a: "保存しません。答案から氏名を読み取れた場合でも、表示・保存は出席番号／受験番号／イニシャル／匿名IDのいずれかに置き換えます。実名フィールドはデータベースに存在しません。" },
  { q: "採点結果は修正できますか？", a: "できます。採点結果画面で丸・三角・バツと得点を1問ずつ編集でき、修正した内容は赤ペン画像と合計点に即時反映されます。修正履歴は監査ログに残ります。" },
  { q: "答案が全問白紙のときはどうなりますか？", a: "採点をスキップし、そのテストの模範解答と解説を自動生成します。生徒への配布用と教師の解説準備用の両方に使えます。" },
  { q: "印刷機やコピー機からアップロードできますか？", a: "できます。複合機のスキャン先に本アプリの取り込みアドレスを登録すると、スキャンした答案がそのまま採点キューに入ります。設定画面から連携コードを発行してください。" },
  { q: "生徒のスマートフォンから提出できますか？", a: "できます。テストごとに提出用リンクとQRコードを発行できます。生徒はアプリのインストール不要で、撮影ガイド枠に合わせて撮るだけで提出が完了します。" },
  { q: "AIの採点はどのくらい信頼できますか？", a: "選択式・穴埋め式はほぼ確実に一致判定できますが、記述式は認識信頼度を1問ごとに表示し、しきい値を下回るものは「要確認一覧」に自動で送ります。返却前の目視確認を前提とした設計です。" },
  { q: "対応言語は？", a: "UI は112言語に切り替えられます。答案の言語とUIの言語は別々に設定でき、教師と生徒で異なる言語を使えます。アラビア語などのRTL言語にも対応します。" },
];

export default function Dashboard() {
  const { T, t, go, subs, toast, testById, session } = useUI();
  const [fx, setFx] = useState(() => FX_BASE.map((f) => ({ ...f, d: 0 })));
  const [openQA, setOpenQA] = useState(0);
  const [votes, setVotes] = useState({ good: 1284, bad: 37 });
  const [voted, setVoted] = useState<"good" | "bad" | null>(null);
  const [contact, setContact] = useState({ name: "", email: "", body: "" });
  const [terms, setTerms] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      setFx((prev) =>
        prev.map((f) => {
          const d = (Math.random() - 0.5) * (f.v * 0.0016);
          return { ...f, v: Math.round((f.v + d) * 10000) / 10000, d };
        })
      );
    }, 3000);
    return () => clearInterval(id);
  }, []);

  const done = subs.filter((s) => s.status !== "processing");
  const graded = done.filter((s) => s.status !== "blank" && testById(s.testId));
  const reviewCount = subs.filter((s) => s.result.items.some((i) => i.needReview) && s.status !== "processing").length;
  const avgRate = graded.length
    ? Math.round(graded.reduce((a, s) => a + pct(s.result.total, testById(s.testId)!.maxScore), 0) / graded.length * 10) / 10
    : 0;
  const savedMin = Math.round(done.length * 4.5);

  // 今月の採点枚数（プランの上限と比べる）
  const plan = PLANS.find((p) => p.id === (session.school?.plan ?? "free")) ?? PLANS[0];
  const month = new Date().toISOString().slice(0, 7);
  const usedThisMonth = subs.filter((s) => (s.uploadedAt || "").slice(0, 7) === month).length;

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
            { k: "new", icon: "📤", t: "答案をアップロード", d: "カメラ・PC・PDF・複合機スキャンから取り込み" },
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
        {/* 利用規定 */}
        <Card title="アプリ使用規定" sub="ご利用の前にご確認ください">
          <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12.5, color: T.textSub, lineHeight: 1.85 }}>
            <li>答案画像のアップロードは、学校または保護者の同意の範囲内で行ってください。</li>
            <li>AIの採点結果は下書きです。返却前に教師が確認・修正することを前提としています。</li>
            <li>生徒の実名・住所・連絡先を本文欄に入力しないでください。</li>
            <li>出力データの二次利用（模試作成・研究）は学校の規程に従ってください。</li>
          </ul>
          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
            <Btn size="sm" onClick={() => setTerms(true)}>利用規約の全文</Btn>
            <span style={{ fontSize: 11, color: T.textFaint }}>最終更新 2026/06/01・v3.0</span>
          </div>
          <Modal open={terms} onClose={() => setTerms(false)} title="利用規約（要約版）"
            footer={<Btn variant="primary" onClick={() => setTerms(false)}>同意して閉じる</Btn>}>
            <div style={{ fontSize: 12.5, color: T.textSub, lineHeight: 1.9 }}>
              {[
                ["第1条（目的）", "本規約は、教育機関が本サービスを用いて答案の採点・分析を行う際の条件を定めます。"],
                ["第2条（アカウント）", "学校管理者は教職員アカウントを発行し、退職・異動時に速やかに無効化するものとします。"],
                ["第3条（データの取扱い）", "答案画像と採点結果は契約校のテナント内にのみ保存し、他校と混在しません。モデルの再学習には使用しません。"],
                ["第4条（AI採点の位置づけ）", "AIの出力は補助であり、成績評価の最終決定は教員が行います。"],
                ["第5条（禁止事項）", "第三者の答案の無断アップロード、生徒を特定できる情報の外部送信を禁じます。"],
                ["第6条（保存期間）", "既定では学年度末＋1年で自動削除します。設定画面から短縮できます。"],
              ].map(([h, b]) => (
                <div key={h} style={{ marginBottom: 12 }}>
                  <div style={{ fontWeight: 700, color: T.text, marginBottom: 3 }}>{h}</div>
                  <div>{b}</div>
                </div>
              ))}
            </div>
          </Modal>
        </Card>

        {/* 国際プライバシーポリシー */}
        <Card title="国際プライバシーポリシー" sub="GDPR / FERPA / COPPA / 個人情報保護法">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 11 }}>
            {["GDPR (EU)", "UK GDPR", "FERPA (US)", "COPPA (US)", "PIPL (中国)", "APPI (日本)", "PIPEDA (加)"].map((x) => (
              <Badge key={x} tone="accent">{x}</Badge>
            ))}
          </div>
          <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12.5, color: T.textSub, lineHeight: 1.85 }}>
            <li><b style={{ color: T.text }}>データ最小化</b>：生徒の実名は保存せず、匿名IDと出席番号のみを扱います。</li>
            <li><b style={{ color: T.text }}>保存場所</b>：既定は東京リージョン。EU圏の学校はフランクフルトを選択できます。</li>
            <li><b style={{ color: T.text }}>権利行使</b>：開示・訂正・削除・可搬性の請求に30日以内で対応します。</li>
            <li><b style={{ color: T.text }}>学習利用なし</b>：答案画像を生成AIの学習データに使用しません。</li>
            <li><b style={{ color: T.text }}>16歳未満</b>：保護者同意の記録を学校単位で管理します。</li>
          </ul>
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn size="sm" onClick={() => { download("privacy-policy-v3.txt", "テスト採点ver.3 プライバシーポリシー（デモ）\n\n1. 収集する情報\n2. 利用目的\n3. 保存期間\n4. 第三者提供\n5. データ主体の権利\n"); toast("ポリシーを書き出しました"); }}>
              ポリシーを保存
            </Btn>
            <Btn size="sm" variant="soft" onClick={() => { download("dpa-request.txt", "データ処理契約(DPA)の請求フォーム（デモ）"); toast("DPA請求書を書き出しました"); }}>
              DPAを請求
            </Btn>
          </div>
        </Card>
      </div>

      <div style={{ ...grid(320, 14), marginBottom: 18 }}>
        {/* サブスクリプション */}
        <Card title="サブスクリプション" sub={`現在のプラン：${plan.name}`}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: T.textSub, marginBottom: 5 }}>
              <span>今月の採点枚数</span>
              <span style={{ fontWeight: 700, color: T.text }}>
                {usedThisMonth.toLocaleString()} / {plan.limit ? `${plan.limit.toLocaleString()} 枚` : "無制限"}
              </span>
            </div>
            <Bar value={usedThisMonth} max={plan.limit || Math.max(1, usedThisMonth)} tone="accent" />
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {PLANS.map((p) => (
              <div key={p.id} style={{
                border: `1px solid ${p.id === plan.id ? T.accent : T.line}`, borderRadius: 11, padding: 11,
                background: p.id === plan.id ? T.accentSoft : T.panelAlt,
              }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>{p.name}</span>
                  <span style={{ font: `700 16px ${FONT_MONO}`, color: T.accent }}>{p.price}</span>
                  <span style={{ fontSize: 11, color: T.textSub }}>{p.per}</span>
                  <span style={{ flex: 1 }} />
                  <Btn size="sm" variant={p.id === plan.id ? "soft" : "default"}
                    onClick={() => {
                      if (p.id === plan.id) { toast("現在ご利用中のプランです"); return; }
                      window.location.href = mailtoLink(`${p.name} プランの申し込み`, `学校名：${session.school?.name ?? ""}\n学校コード：${session.school?.code ?? ""}\n希望プラン：${p.name}\n`);
                    }}>
                    {p.id === plan.id ? "利用中" : p.id === "board" ? "問い合わせる" : "申し込む"}
                  </Btn>
                </div>
                <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 5 }}>{p.quota}・{p.feats.join(" / ")}</div>
              </div>
            ))}
          </div>
          {/* PROD-API: Stripe Billing Portal へのリダイレクト */}
          <div style={{ fontSize: 11, color: T.textFaint, marginTop: 10 }}>請求書・支払い方法の変更はカスタマーポータルから行えます。</div>
        </Card>

        {/* 為替レート */}
        <Card title="リアルタイム為替レート" sub="海外校向け請求額の目安（3秒ごとに更新・参考値）">
          <div style={grid(140, 8)}>
            {fx.map((f) => (
              <div key={f.pair} style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 11px", background: T.panelAlt }}>
                <div style={{ fontSize: 11, color: T.textSub, fontWeight: 700 }}>{f.pair}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ font: `700 16px ${FONT_MONO}`, color: T.text }}>
                    {f.v < 1 ? f.v.toFixed(4) : f.v.toFixed(2)}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: f.d >= 0 ? T.ok : T.ng }}>
                    {f.d >= 0 ? "▲" : "▼"}{Math.abs(f.d).toFixed(3)}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: T.textFaint, marginTop: 10 }}>
            {/* PROD-API: 為替APIに接続（例 exchangerate.host / OpenExchangeRates） */}
            デモでは擬似変動値を表示しています。本番では為替APIに接続します。
          </div>
        </Card>
      </div>

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

        {/* ユーザーの声 */}
        <Card title="ユーザーの声" sub="評価とシェア">
          <div style={{ display: "grid", gap: 9, marginBottom: 13 }}>
            {[
              { who: "中学校 数学科・2年担当", body: "40枚の答案が10分で下書き採点まで終わりました。記述は要確認だけ見ればよく、放課後の残業が実際に減りました。" },
              { who: "学習塾 教室長", body: "生徒がスマホで提出できるので、欠席者の答案回収がなくなりました。弱点分析をそのまま面談資料に使っています。" },
              { who: "特別支援教育担当", body: "実名が出ない設計なので、支援会議の資料に安心して出せます。" },
            ].map((v, i) => (
              <div key={i} style={{ border: `1px solid ${T.line}`, borderRadius: 11, padding: 11, background: T.panelAlt }}>
                <div style={{ fontSize: 12.5, color: T.text, lineHeight: 1.75 }}>{v.body}</div>
                <div style={{ fontSize: 11, color: T.textFaint, marginTop: 6 }}>— {v.who}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Btn size="sm" variant={voted === "good" ? "primary" : "default"}
              onClick={() => { if (voted !== "good") { setVotes((v) => ({ ...v, good: v.good + 1, bad: voted === "bad" ? v.bad - 1 : v.bad })); setVoted("good"); toast("評価ありがとうございます"); } }}>
              👍 グッド {votes.good.toLocaleString()}
            </Btn>
            <Btn size="sm" variant={voted === "bad" ? "danger" : "default"}
              onClick={() => { if (voted !== "bad") { setVotes((v) => ({ ...v, bad: v.bad + 1, good: voted === "good" ? v.good - 1 : v.good })); setVoted("bad"); toast("ご意見として記録しました", "warn"); } }}>
              👎 バッド {votes.bad.toLocaleString()}
            </Btn>
            <Btn size="sm" variant="soft" onClick={() => {
              const text = `テスト採点ver.3 — 答案画像をアップロードするだけで採点・添削・分析まで自動化`;
              if (navigator.share) navigator.share({ title: "テスト採点ver.3", text }).catch(() => {});
              else if (navigator.clipboard) { navigator.clipboard.writeText(text); toast("紹介文をコピーしました"); }
              else toast("共有に対応していない環境です", "warn");
            }}>
              ↗ 拡散する
            </Btn>
          </div>
        </Card>
      </div>

      {/* お問い合わせ */}
      <Card title="お問い合わせ" sub="カスタマーセンター">
        <div style={{ ...grid(260, 14) }}>
          <div>
            <div style={{ fontSize: 12.5, color: T.textSub, lineHeight: 2 }}>
              <div><b style={{ color: T.text }}>受付時間</b>　平日 9:00–18:00（日本時間）</div>
              <div><b style={{ color: T.text }}>電話</b>　0120-000-000（学校向け窓口）</div>
              <div><b style={{ color: T.text }}>メール</b>　{SUPPORT_EMAIL}</div>
              <div><b style={{ color: T.text }}>緊急時</b>　管理画面の「障害情報」から状況を確認できます</div>
              <div><b style={{ color: T.text }}>導入相談</b>　教育委員会単位の説明会も承ります</div>
            </div>
          </div>
          <div>
            <Field label="お名前（担当者）"><Input value={contact.name} onChange={(v) => setContact({ ...contact, name: v })} placeholder="例：教務 担当" /></Field>
            <Field label="返信先メールアドレス"><Input value={contact.email} onChange={(v) => setContact({ ...contact, email: v })} placeholder="school@example.ed.jp" /></Field>
            <Field label="お問い合わせ内容" hint="生徒の実名は記入しないでください。">
              <textarea value={contact.body} onChange={(e) => setContact({ ...contact, body: e.target.value })}
                rows={4} style={{ ...inputStyle(T), resize: "vertical" }} placeholder="ご質問・ご要望をご記入ください" />
            </Field>
            <Btn variant="primary" full onClick={() => {
              if (!contact.email || !contact.body) { toast("メールアドレスと内容を入力してください", "warn"); return; }
              // 送信はお使いのメールソフトで行う（アプリからは外部に送らない）
              window.location.href = mailtoLink("テスト採点ver.3 お問い合わせ",
                `お名前：${contact.name}\n返信先：${contact.email}\n学校：${session.school?.name ?? ""}\n\n${contact.body}`);
              toast("メールソフトを開きました。内容を確認して送信してください");
              setContact({ name: "", email: "", body: "" });
            }}>メールで送る</Btn>
          </div>
        </div>
      </Card>
    </div>
  );
}
