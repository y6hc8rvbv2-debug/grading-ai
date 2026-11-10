// セキュリティのお知らせの中身（画面に依存しない。components/SecurityNotices.tsx が表示する。2026-11-10。セキュリティの12項目の9）
export type AuditRow = { action: string; created_at: string; detail: Record<string, unknown> | null };
export const WATCH = ["staff.role_change", "staff.mfa_removed", "staff.mfa_enabled", "data.export", "billing.overage", "school.retention", "ai.settings"];
const LABEL: Record<string, string> = {
  "staff.role_change": "教職員の役割・所属の変更", "staff.mfa_removed": "二段階認証の解除", "staff.mfa_enabled": "二段階認証の設定",
  "data.export": "データの書き出し（CSV）", "billing.overage": "従量課金の設定の変更", "school.retention": "保存期間の変更", "ai.settings": "AIエンジンの設定の変更",
};
/** 1日に何回以上の書き出しを「いつもより多い」とみなすか */
export const EXPORT_ALERT_PER_DAY = 20;

/** 監査ログの行から、お知らせ（注意・記録）を作る（画面に依存しない。単体テストで確かめる） */
export function securityNotices(rows: AuditRow[], now = Date.now()) {
  const warn: string[] = [], info: string[] = [];
  const count = (a: string) => rows.filter((r) => r.action === a).length;
  if (count("staff.mfa_removed")) warn.push(`二段階認証の解除が ${count("staff.mfa_removed")} 件ありました。心当たりが無ければ、すぐにパスワードを変えてください。`);
  if (count("staff.role_change")) warn.push(`教職員の役割・所属の変更が ${count("staff.role_change")} 件ありました。意図した変更か確かめてください。`);
  const day = rows.filter((r) => r.action === "data.export" && now - Date.parse(r.created_at) < 24 * 3600_000).length;
  if (day >= EXPORT_ALERT_PER_DAY) warn.push(`この24時間のデータの書き出しが ${day} 回と、いつもより多くなっています。`);
  for (const a of WATCH) if (!["staff.mfa_removed", "staff.role_change"].includes(a) && count(a)) info.push(`${LABEL[a]}：${count(a)} 件`);
  return { warn, info };
}

