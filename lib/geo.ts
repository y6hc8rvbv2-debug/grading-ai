// 海外の IP アドレスからのアクセスを断る（2026-11-13 ユーザーの指示。docs/SECURITY-12.md の 15）
//
// 国は Vercel が付ける x-vercel-ip-country（Vercel の入口が付け直すので、利用者は偽れない）で判断する。
// Vercel の外（手元・画面テスト）では国が分からないので、断らない。
//
// 環境変数：
//   GEO_BLOCK            "off" で止める（緊急時）。既定は Vercel の上でだけ有効
//   GEO_ALLOW_COUNTRIES  通す国（ISO の2文字、カンマ区切り）。既定 "JP"。App Store の審査の間は "JP,US" など
//   GEO_ALLOW_IPS        国に関係なく通す IP（カンマ区切り。海外出張の先生など、一時的に）
//
// 例外（海外からでも通す）：
//   - 決済・定期処理の通知（Stripe・暗号資産の決済代行・Vercel Cron・Supabase の pg_net）。それぞれ署名・秘密の値で確かめている
//   - 規約・プライバシーなどの公開ページ（個人情報を含まない。ストアの審査・保護者が読む）
//   - Vercel の自動確認（Protection Bypass の秘密の値が一致するときだけ）
//
// 注意：VPN を使えば国は偽れる。また、Supabase（データベース）の入口へ直接つなぐ通信はこの仕組みを通らない。
// データを守る本体は、ログイン・二段階認証・RLS（学校ごとの分離）のまま。これは「入口を狭くする」追加の層。

export const GEO_EXEMPT_PATHS = [
  // 通知・定期処理（署名・秘密の値で確かめる）
  "/api/billing/webhook",
  "/api/billing/crypto/webhook",
  "/api/billing/worker",
  "/api/retention",
  "/api/tutor/sweep",
  // 公開ページ（個人情報なし）
  "/start",
  "/privacy",
  "/terms",
  "/support",
  "/account-deletion",
  "/tokushoho",
  "/manifest.webmanifest",
];

export type GeoEnv = Record<string, string | undefined> & {
  VERCEL?: string;
  GEO_BLOCK?: string;
  GEO_ALLOW_COUNTRIES?: string;
  GEO_ALLOW_IPS?: string;
  VERCEL_AUTOMATION_BYPASS_SECRET?: string;
};

export type GeoInput = {
  path: string;
  country: string | null; // x-vercel-ip-country
  ip: string | null;      // x-real-ip / x-forwarded-for の先頭
  bypass: string | null;  // x-vercel-protection-bypass
};

export type GeoDecision = { allow: true; reason: string } | { allow: false; reason: "country"; country: string };

const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// 長さの違いも含めて、比べる時間が中身で変わらないようにする
function sameSecret(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function geoEnabled(env: GeoEnv): boolean {
  if ((env.GEO_BLOCK ?? "").toLowerCase() === "off") return false;
  return env.VERCEL === "1" || (env.GEO_BLOCK ?? "").toLowerCase() === "on";
}

export function geoDecision(input: GeoInput, env: GeoEnv): GeoDecision {
  if (!geoEnabled(env)) return { allow: true, reason: "disabled" };
  const path = input.path || "/";
  if (GEO_EXEMPT_PATHS.some((p) => path === p || path.startsWith(p + "/"))) return { allow: true, reason: "exempt_path" };
  const secret = env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";
  if (secret && input.bypass && sameSecret(input.bypass, secret)) return { allow: true, reason: "bypass" };
  if (input.ip && list(env.GEO_ALLOW_IPS).includes(input.ip.trim())) return { allow: true, reason: "allow_ip" };
  const country = (input.country ?? "").trim().toUpperCase();
  // 国が分からない（Vercel の外・ごくまれな欠落）ときは断らない（締め出しを避ける）
  if (!/^[A-Z]{2}$/.test(country)) return { allow: true, reason: "unknown_country" };
  const allowed = list(env.GEO_ALLOW_COUNTRIES || "JP").map((c) => c.toUpperCase());
  if (allowed.includes(country)) return { allow: true, reason: "country_ok" };
  return { allow: false, reason: "country", country };
}

export function clientIp(h: { get(name: string): string | null }): string | null {
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

// 断ったときの画面（日本語と英語。内部の情報は出さない）
export function geoBlockedBody(): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>アクセスできません</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:48px 16px;background:#f7f7f5;color:#222}main{max-width:520px;margin:auto;background:#fff;border-radius:12px;padding:24px;line-height:1.7}</style></head>
<body><main><h1 style="font-size:20px">このサービスは日本国内からのみ利用できます</h1>
<p>海外からのアクセスは、安全のため受け付けていません。海外で利用する必要がある場合は、学校の管理者にお問い合わせください。</p>
<p lang="en" style="color:#555">This service is available only from Japan.</p></main></body></html>`;
}
