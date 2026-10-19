"use client";
// 設定画面の「AIエンジン」（ver6）。
// 段階（高速・標準・最上位）ごとに使うモデルと、同時に採点する枚数を表示・変更する。
// 新しいモデルが出ていれば（Anthropic の Models API で確認）、「新しいモデルがあります」と知らせ、ワンタップで切り替えられる。
// 変更できるのは管理者だけ。APIキーはこの画面に出さない。
import React, { useCallback, useEffect, useState } from "react";
import { useUI } from "@/components/ui-context";
import { Badge, Btn, Card, Field, Select } from "@/components/ui";
import { DEFAULT_MODELS, TIERS, TIER_HINT, TIER_LABEL, labelOf, priceOf, type Tier } from "@/lib/grading/models";
import { friendlyError } from "@/lib/errors";

type Info = {
  enabled: boolean; canManage: boolean;
  current: Record<Tier, { id: string; label: string; price: { input: number; output: number }; estimated: boolean }>;
  overrides: Partial<Record<Tier, string | null>>;
  concurrency: number; saved: boolean;
  available: { id: string; label: string; tier: Tier | null; display: string }[];
  availableFrom: "models_api" | "catalog";
  newer: Partial<Record<Tier, { id: string; label: string }>>;
};

const usdM = (usdPerM: number) => `$${usdPerM < 1 ? usdPerM.toFixed(2) : usdPerM.toFixed(0)}`;

export function AiEngineCard() {
  const { T, ds, toast, ai } = useUI();
  const demo = ds.mode === "demo";
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Partial<Record<Tier, string>>>({});
  const [conc, setConc] = useState(8);

  const load = useCallback(async () => {
    if (demo) return;
    setError("");
    try {
      const r = await fetch("/api/ai/models", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setInfo(j); setConc(j.concurrency);
      setDraft(Object.fromEntries(TIERS.map((t) => [t, j.overrides?.[t] ?? ""])) as Record<Tier, string>);
    } catch (e) {
      setError(friendlyError(e, "AIエンジンの確認"));
    }
  }, [demo]);
  useEffect(() => { load(); }, [load]);

  const save = async (patch: Partial<Record<Tier | "concurrency", string | number | null>>) => {
    setBusy(true);
    try {
      const r = await fetch("/api/ai/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      toast("AIエンジンの設定を保存しました。次の採点から使います");
      await load();
    } catch (e) {
      toast(friendlyError(e, "AIエンジンの保存"), "ng");
    } finally {
      setBusy(false);
    }
  };

  const rows = TIERS.map((tier) => {
    const id = info?.current[tier]?.id ?? DEFAULT_MODELS[tier];
    const { price, estimated } = info?.current[tier] ?? { ...priceOf(id) };
    return { tier, id, label: info?.current[tier]?.label ?? labelOf(id), price, estimated };
  });
  const newerCount = info ? Object.keys(info.newer).length : 0;

  return (
    <Card title="AIエンジン" sub="採点・振り分け・模範解答作成に使う AI（新しいモデルに切り替えられます）"
      right={demo ? <Badge tone="mute">デモ</Badge> : newerCount ? <Badge tone="warn">新しいモデルがあります</Badge> : ai.enabled ? <Badge tone="ok">接続済み</Badge> : <Badge tone="mute">未設定</Badge>}>
      {error && <div role="alert" style={{ fontSize: 12, color: T.ng, marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "grid", gap: 10 }}>
        {rows.map((r) => (
          <div key={r.tier} style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: 10 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Badge tone="accent">{TIER_LABEL[r.tier]}</Badge>
              <b style={{ fontSize: 13, color: T.text }}>{r.label}</b>
              <span style={{ fontSize: 11, color: T.textFaint }}>{r.id}</span>
              <span style={{ fontSize: 11, color: T.textSub }}>入力 {usdM(r.price.input)}／出力 {usdM(r.price.output)}（100万トークンあたり{r.estimated ? "・概算" : ""}）</span>
            </div>
            <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 4, lineHeight: 1.6 }}>{TIER_HINT[r.tier]}</div>
            {info?.newer[r.tier] && (
              <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: T.warn, fontWeight: 700 }}>新しいモデル：{info.newer[r.tier]!.label}</span>
                {info.canManage && <Btn size="sm" variant="primary" disabled={busy} onClick={() => save({ [r.tier]: info.newer[r.tier]!.id })}>このモデルに切り替える</Btn>}
              </div>
            )}
            {info?.canManage && (
              <div style={{ marginTop: 8 }}>
                <Select value={draft[r.tier] ?? ""} onChange={(v: string) => setDraft((d) => ({ ...d, [r.tier]: v }))}
                  options={[{ value: "", label: `おすすめ（既定：${labelOf(DEFAULT_MODELS[r.tier])}）` },
                    ...info.available.filter((m) => !m.tier || m.tier === r.tier || r.tier === "top").map((m) => ({ value: m.id, label: `${m.display}（${m.id}）` }))]} />
              </div>
            )}
          </div>
        ))}
        {info?.canManage && (
          <>
            <Field label="同時に採点する答案の数" hint="大きいほど早く終わります（API の利用上限に当たると自動で待ってから続けます）。100枚以上の採点では 8〜12 がおすすめです。">
              <Select value={String(conc)} onChange={(v: string) => setConc(Number(v))}
                options={Array.from({ length: 16 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} 枚ずつ同時に採点` }))} />
            </Field>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Btn variant="primary" disabled={busy} onClick={() => save({ ...Object.fromEntries(TIERS.map((t) => [t, draft[t] || null])), concurrency: conc })}>保存する</Btn>
              <Btn disabled={busy} onClick={() => save({ fast: null, standard: null, top: null })}>おすすめに戻す</Btn>
            </div>
          </>
        )}
        {info && !info.canManage && <div style={{ fontSize: 11.5, color: T.textFaint }}>AIエンジンを変えられるのは学校の管理者だけです。</div>}
        {info?.availableFrom === "catalog" && !demo && (
          <div style={{ fontSize: 11.5, color: T.textFaint }}>Anthropic のモデル一覧を確認できなかったため、アプリに登録されたモデルだけを表示しています。</div>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: T.textFaint, lineHeight: 1.8, marginTop: 10 }}>
        AI採点では、答案画像とこのアプリの採点基準を AI の提供元（Anthropic）に送り、設問ごとの正誤・部分点・信頼度を受け取ります。
        APIキーはサーバーの環境変数にだけ置き、この画面やブラウザには入力・保存しません。
      </div>
    </Card>
  );
}
