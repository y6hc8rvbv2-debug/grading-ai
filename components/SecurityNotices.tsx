"use client";
// セキュリティのお知らせ（管理者だけ。2026-11-10。セキュリティの12項目の9「異常時に通知」）
//   監査ログ（自校）から、直近7日の気をつけるべき出来事を出す：教職員の役割・所属の変更、二段階認証の解除、
//   いつもより多いデータの書き出し（1日20回以上）、従量課金・保存期間・AIエンジンの設定変更。個人の名前・メールアドレスは出さない
import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUI } from "@/components/ui-context";
import { Card } from "@/components/ui";
import { WATCH, securityNotices, type AuditRow } from "@/lib/security-notices";

type Row = AuditRow;

export function SecurityNotices() {
  const { T, ds, isAdmin } = useUI();
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (!isAdmin || ds.mode !== "supabase") return;
    createClient().from("audit_logs").select("action,created_at,detail").in("action", WATCH)
      .gte("created_at", new Date(Date.now() - 7 * 24 * 3600_000).toISOString()).order("created_at", { ascending: false }).limit(500)
      .then(({ data }) => setRows((data ?? []) as Row[]), () => setRows([]));
  }, [isAdmin, ds.mode]);
  if (!isAdmin || ds.mode !== "supabase" || rows === null) return null;
  const { warn, info } = securityNotices(rows);
  return <Card title="セキュリティのお知らせ（直近7日）" sub="管理者だけに表示します。監査ログから、気をつけるべき出来事をまとめています">
    <div data-testid="security-notices" style={{ fontSize: 13, lineHeight: 1.8 }}>
      {warn.length === 0 && <div style={{ color: T.ok }}>気をつけるべき出来事はありません。</div>}
      {warn.map((w) => <div key={w} role="alert" style={{ color: T.warn, fontWeight: 700 }}>⚠ {w}</div>)}
      {info.length > 0 && <div style={{ color: T.textSub, marginTop: 4 }}>記録：{info.join(" ／ ")}</div>}
    </div>
  </Card>;
}
