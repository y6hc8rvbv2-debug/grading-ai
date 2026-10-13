// Web アプリの情報（ホーム画面に追加したとき・Android の表示に使う）
import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/app-info";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: "答案の写真から AI が採点の下書きと赤ペン添削を作り、先生が確認して生徒に返却するアプリ",
    start_url: "/start",
    display: "standalone",
    background_color: "#F6F4EF",
    theme_color: "#1E3A5F",
    lang: "ja",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
