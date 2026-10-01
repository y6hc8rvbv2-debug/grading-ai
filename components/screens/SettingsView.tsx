"use client";
// 設定。docs/prototype-v3.jsx から移植。
// 表示の設定は端末に、保存期間は学校（schools.retention）に保存する。
import React, { useEffect, useState } from "react";
import { FONT_UI, FONT_MONO } from "@/lib/ui/theme";
import { LANGS } from "@/lib/i18n";
import { download, fmtDateTime, toCSV } from "@/lib/util";
import { friendlyError } from "@/lib/errors";
import { useUI, type DisplayMode } from "@/components/ui-context";
import { Badge, Btn, Card, Field, Input, Select, grid } from "@/components/ui";
import type { Retention } from "@/lib/types";

export default function SettingsView() {
  const {
    T, t, lang, setLang, mode, setMode, anonMode, setAnonMode, display, setDisplay,
    answerLang, setAnswerLang, studentLang, setStudentLang, toast, ds, session, isAdmin, ai,
  } = useUI();
  const demo = ds.mode === "demo";
  const [q, setQ] = useState("");
  const [code] = useState("MFP-8F3K-2026");
  const [retention, setRetentionState] = useState<Retention>(session.school?.retention ?? "year");
  const [auditBusy, setAuditBusy] = useState(false);

  const setRetention = async (v: string) => {
    const before = retention;
    setRetentionState(v as Retention);
    try {
      await ds.updateRetention(v as Retention);
      toast("答案画像の保存期間を変更しました");
    } catch (e) {
      setRetentionState(before);
      toast(friendlyError(e, "保存期間の変更"), "ng");
    }
  };

  const exportAudit = async () => {
    setAuditBusy(true);
    try {
      const rows = await ds.loadAudit();
      if (!rows.length) { toast("まだ監査ログがありません。採点や修正を行うと記録されます", "warn"); return; }
      download("audit-log.csv", toCSV(rows, [
        { label: "日時", get: (r: (typeof rows)[number]) => fmtDateTime(r.createdAt) },
        { label: "操作", key: "action" },
        { label: "対象", get: (r: (typeof rows)[number]) => `${r.targetTable} ${r.targetId ?? ""}` },
        { label: "実行者", key: "actor" },
        { label: "内容", get: (r: (typeof rows)[number]) => JSON.stringify(r.detail) },
      ]), "text/csv;charset=utf-8");
      toast(`監査ログ ${rows.length} 件を書き出しました`);
    } catch (e) {
      toast(friendlyError(e, "監査ログの書き出し"), "ng");
    } finally {
      setAuditBusy(false);
    }
  };

  const verifyAudit = async () => {
    setAuditBusy(true);
    try {
      const r = await ds.verifyAudit();
      if (r.broken) toast(`監査ログ ${r.total} 件のうち ${r.broken} 件で連鎖が途切れています。改ざんの可能性があるため管理者に連絡してください`, "ng");
      else toast(`監査ログ ${r.total} 件の連鎖を確認しました。改ざんはありません`);
    } catch (e) {
      toast(friendlyError(e, "監査ログの確認"), "ng");
    } finally {
      setAuditBusy(false);
    }
  };
  const list = LANGS.filter((l) => !q || `${l.n}${l.e}${l.c}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={grid(330, 14)}>
      <Card title="表示言語" sub={`${LANGS.length} 言語に対応・RTL言語も表示できます`}>
        <Field label="言語を検索"><Input value={q} onChange={setQ} placeholder="日本語 / English / العربية …" /></Field>
        <div style={{ maxHeight: 260, overflowY: "auto", display: "grid", gap: 4, border: `1px solid ${T.line}`, borderRadius: 10, padding: 6 }}>
          {list.map((l) => (
            <button key={l.c} onClick={() => { setLang(l.c); toast(`${l.n} に切り替えました`); }}
              style={{
                display: "flex", gap: 9, alignItems: "center", padding: "8px 10px", borderRadius: 8, cursor: "pointer",
                border: `1px solid ${lang === l.c ? T.accent : "transparent"}`,
                background: lang === l.c ? T.accentSoft : "transparent", font: `13px ${FONT_UI}`, color: T.text, textAlign: "start",
              }}>
              <span style={{ fontSize: 15 }}>{l.f}</span>
              <span style={{ fontWeight: 700, flex: 1 }}>{l.n}</span>
              <span style={{ fontSize: 11, color: T.textFaint }}>{l.e}</span>
              {l.rtl && <Badge tone="info">RTL</Badge>}
            </button>
          ))}
          {list.length === 0 && <div style={{ padding: 16, textAlign: "center", color: T.textFaint, fontSize: 12 }}>該当する言語がありません</div>}
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label="答案の言語（UIとは別に設定）">
            <Select value={answerLang} onChange={setAnswerLang}
              options={LANGS.slice(0, 20).map((l) => ({ value: l.c, label: `${l.f} ${l.n}` }))} />
          </Field>
          <Field label="生徒に表示する言語" hint="教師と生徒で別々の言語を使えます。">
            <Select value={studentLang} onChange={setStudentLang}
              options={LANGS.slice(0, 20).map((l) => ({ value: l.c, label: `${l.f} ${l.n}` }))} />
          </Field>
        </div>
      </Card>

      <Card title="表示と外観">
        <Field label={t("theme")}>
          <div style={{ display: "flex", gap: 7 }}>
            <Btn full variant={mode === "light" ? "primary" : "default"} onClick={() => setMode("light")}>☀ {t("light")}</Btn>
            <Btn full variant={mode === "dark" ? "primary" : "default"} onClick={() => setMode("dark")}>🌙 {t("dark")}</Btn>
          </div>
        </Field>
        <Field label="生徒の表示形式" hint="実名は保存されないため、いずれかの匿名表記を使います。">
          <Select value={display} onChange={(v: string) => setDisplay(v as DisplayMode)} options={[
            { value: "class", label: "学年＋クラス＋出席番号（例：2年A組12番）" },
            { value: "exam", label: "受験番号（例：2A12）" },
            { value: "initials", label: "イニシャル（例：T.K）" },
            { value: "anon", label: "匿名ID（例：生徒001）" },
          ]} />
        </Field>
        <label style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "11px 0", borderTop: `1px solid ${T.line}`, cursor: "pointer" }}>
          <input type="checkbox" checked={anonMode} onChange={(e) => setAnonMode(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: T.text, display: "block" }}>匿名モード</span>
            <span style={{ fontSize: 11.5, color: T.textSub, lineHeight: 1.7 }}>
              画面共有や職員会議のときに使います。出席番号も伏せ、匿名IDだけを表示します。
            </span>
          </span>
        </label>
      </Card>

      <Card title="データの取り扱い" sub="学校の規程に合わせて調整できます">
        <Field label="答案画像の保存期間" hint={isAdmin ? "学校全体の設定です。変更は監査ログに残ります。" : "変更できるのは学校の管理者だけです。"}>
          <Select value={retention} onChange={setRetention} style={isAdmin ? undefined : { opacity: 0.6 }} options={[
            { value: "30", label: "30日で自動削除" },
            { value: "180", label: "180日で自動削除" },
            { value: "year", label: "学年度末＋1年（既定）" },
            { value: "manual", label: "手動削除のみ" },
          ]} />
        </Field>
        <div style={{ display: "grid", gap: 9, fontSize: 12, color: T.textSub, lineHeight: 1.8 }}>
          <div>・生徒の実名フィールドはデータベースに存在しません。</div>
          <div>・答案画像は生成AIの学習には使用しません。</div>
          <div>・採点の修正履歴は監査ログに残り、書き出せます。</div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 13, flexWrap: "wrap" }}>
          <Btn size="sm" disabled={auditBusy} onClick={exportAudit}>監査ログを書き出す</Btn>
          <Btn size="sm" variant="soft" disabled={auditBusy} onClick={verifyAudit}>改ざんがないか確認する</Btn>
          {demo && <Btn size="sm" variant="danger" onClick={() => window.location.reload()}>デモデータを初期化</Btn>}
        </div>
      </Card>

      {!demo ? (
      <Card title="複合機・印刷機との連携" sub="スキャンした答案をそのまま採点キューへ" right={<Badge tone="mute">準備中</Badge>}>
        <div style={{ fontSize: 12.5, color: T.textSub, lineHeight: 1.85 }}>
          複合機からのスキャンを直接受け取る機能は準備中です。それまでは、複合機で PDF にスキャンして PC に保存し、
          「新規採点」の「PDF一括」または「PCから選択」で取り込んでください。
        </div>
      </Card>
      ) : (
      <Card title="複合機・印刷機との連携" sub="スキャンした答案をそのまま採点キューへ">
        <div style={{ background: T.panelAlt, border: `1px dashed ${T.lineStrong}`, borderRadius: 11, padding: 13, marginBottom: 12 }}>
          <div style={{ fontSize: 11.5, color: T.textSub, marginBottom: 5 }}>連携コード</div>
          <div style={{ font: `700 18px ${FONT_MONO}`, color: T.accent, letterSpacing: ".06em" }}>{code}</div>
        </div>
        <ol style={{ margin: 0, paddingInlineStart: 20, fontSize: 12.5, color: T.textSub, lineHeight: 2 }}>
          <li>複合機の管理画面で「スキャン送信先」を追加します。</li>
          <li>送信先アドレスに <span style={{ font: `12px ${FONT_MONO}`, color: T.text }}>scan@grade.example.jp</span> を入力します。</li>
          <li>件名に上の連携コードを入れると、対応するクラスの採点キューに入ります。</li>
          <li>両面スキャンとADFに対応しています。ページ抜けは自動で検出します。</li>
        </ol>
        <div style={{ display: "flex", gap: 8, marginTop: 13 }}>
          <Btn size="sm" onClick={() => { navigator.clipboard && navigator.clipboard.writeText(code); toast("連携コードをコピーしました"); }}>コードをコピー</Btn>
          <Btn size="sm" variant="soft" onClick={() => toast("接続テストに成功しました（デモ）")}>接続テスト</Btn>
        </div>
      </Card>
      )}

      {demo && <Card title="通知" sub="デモ表示です（通知の送信は準備中）">
        {[
          ["採点が完了したら通知する", true],
          ["要確認が10件を超えたら通知する", true],
          ["画質不良で採点できない答案があったら通知する", true],
          ["生徒の提出が締切を過ぎたら通知する", false],
          ["月次の利用レポートをメールで受け取る", false],
        ].map(([label, def], i) => (
          <label key={i} style={{ display: "flex", gap: 9, alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${T.line}`, cursor: "pointer" }}>
            <input type="checkbox" defaultChecked={def as boolean} />
            <span style={{ fontSize: 12.5, color: T.text }}>{label}</span>
          </label>
        ))}
      </Card>}

      <ReadinessCard />

      <Card title="AIエンジン" sub="本番接続の設定">
        <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12.5, color: T.textSub, width: 90 }}>採点モデル</span>
            <b style={{ fontSize: 12.5, color: T.text }}>{ai.enabled ? `Claude（${ai.model}）` : "Claude（Vision + 記述採点）"}</b>
            {ai.enabled ? <Badge tone="ok">接続済み</Badge> : <Badge tone="mute">{demo ? "デモでは使えません" : "未設定"}</Badge>}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12.5, color: T.textSub, width: 90 }}>いま動く採点</span>
            <span style={{ fontSize: 12.5, color: T.text }}>
              {demo ? "ローカルのルールベース採点（デモ）"
                : ai.enabled ? "AI採点（答案画像・正答・配点・採点基準をもとに採点）"
                : "なし（答案は「AI採点待ち」で保存。サーバーに ANTHROPIC_API_KEY を設定すると使えます）"}
            </span>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: T.textFaint, lineHeight: 1.8 }}>
          {/* PROD-API: ここで /v1/messages に接続し、画像 + 採点基準プロンプトを送る */}
          本番環境では、答案画像とこのアプリの採点基準をAPIに渡し、設問ごとの正誤・部分点・信頼度を受け取ります。
          APIキーはサーバーの環境変数にだけ置き、この画面やブラウザには入力・保存しません。
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ AI採点の準備状況 */
type Health = { supabase: boolean; ai: boolean; migrations?: Record<string, boolean>; env: string };

function ReadinessCard() {
  const { T, ds } = useUI();
  const [h, setH] = useState<Health | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (ds.mode === "demo") return;
    fetch("/api/health", { cache: "no-store" })
      .then(async (r) => (r.ok ? setH(await r.json()) : setError("準備状況を確認できませんでした。画面を再読み込みしてください。")))
      .catch(() => setError("準備状況を確認できませんでした。通信状態を確認してください。"));
  }, [ds.mode]);

  const rows: { label: string; ok: boolean | null; fix: string }[] = ds.mode === "demo"
    ? [{ label: "Supabase（データの保存先）", ok: false, fix: "環境変数 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY を設定すると、答案を保存してAI採点できます（docs/SUPABASE-SETUP.md ステップ5）。" }]
    : h ? [
      { label: "Supabase（データの保存先）", ok: h.supabase, fix: "環境変数 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してください。" },
      { label: "採点AI（ANTHROPIC_API_KEY）", ok: h.ai, fix: `Vercel の Settings → Environment Variables に ANTHROPIC_API_KEY を追加し、${h.env === "preview" ? "Preview" : h.env === "production" ? "Production" : "この環境"} にチェックを入れて再デプロイしてください（ステップ6.5）。` },
      { label: "AI採点の保存（0004_ai_grading.sql）", ok: h.migrations?.["0004"] ?? null, fix: "Supabase の SQL Editor で supabase/migrations/0004_ai_grading.sql を実行してください。" },
      { label: "モデル比較試験の記録（0005_model_compare.sql）", ok: h.migrations?.["0005"] ?? null, fix: "管理者がモデル比較試験を使う場合だけ必要です。Supabase の SQL Editor で 0005_model_compare.sql を実行してください。" },
      { label: "iPhone の写真（HEIC）", ok: true, fix: "" },
    ] : [];
  const ready = h && h.supabase && h.ai && h.migrations?.["0004"];

  return (
    <Card title="AI採点の準備状況" sub={h ? `実行環境: ${h.env === "preview" ? "Preview（プレビュー）" : h.env === "production" ? "Production（本番）" : "ローカル"}` : "AI採点に必要な設定がそろっているかを確認します"}
      right={ready ? <Badge tone="ok">AI採点できます</Badge> : h || ds.mode === "demo" ? <Badge tone="warn">準備が必要です</Badge> : null}>
      {error && <div role="alert" style={{ fontSize: 12.5, color: T.ng }}>{error}</div>}
      {!error && !rows.length && <div style={{ fontSize: 12.5, color: T.textSub }}>確認しています…</div>}
      <div style={{ display: "grid", gap: 8 }}>
        {rows.map((r) => (
          <div key={r.label} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{ width: 22, textAlign: "center", fontWeight: 700, color: r.ok ? T.ok : T.warn }}>{r.ok ? "✓" : "!"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: T.text, fontWeight: 600 }}>
                {r.label}：{r.ok ? "OK" : "未設定"}
                {r.label.startsWith("iPhone") && <span style={{ fontWeight: 400, color: T.textSub }}>（取り込み時に JPEG へ自動変換します）</span>}
              </div>
              {!r.ok && <div style={{ fontSize: 11.5, color: T.textSub, lineHeight: 1.7, marginTop: 2 }}>{r.fix}</div>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
