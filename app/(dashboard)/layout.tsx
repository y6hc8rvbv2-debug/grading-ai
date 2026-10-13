import type { ReactNode } from "react";
import AppShell from "@/components/AppShell";

// サイドバー付きの主要画面。ログイン確認とデータの読み込みは AppShell が行う。
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
