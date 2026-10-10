import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { APP_NAME } from "@/lib/app-info";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "答案の写真から AI が採点の下書きと赤ペン添削を作り、先生が確認して生徒に返却するアプリ",
  applicationName: APP_NAME,
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // iPhone のノッチ・ホームバーの領域まで使う（各画面は safe-area の余白を取る）
  viewportFit: "cover",
  themeColor: "#1E3A5F",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body style={{ margin: 0, paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>{children}</body>
    </html>
  );
}
