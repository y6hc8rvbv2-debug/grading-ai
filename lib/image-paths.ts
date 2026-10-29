// 答案画像の保存先（Storage の answer-sheets）のパスの形。サーバーの画像の API が、決まった形以外を断るために使う
//   答案：{school_id}/{test_id}/{submission_id}/{page}.{ext}　自動入力の資料：{school_id}/imports/{requestId}/{n}.{ext}
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
//   先頭は学校の ID（Storage の規則が学校ごとに読み書きを決める）。".." や空の区切りなど、ほかの場所を指す書き方は断る
const PATH = new RegExp(`^${UUID}/[0-9A-Za-z_.-]+(?:/[0-9A-Za-z_.-]+){0,4}$`, "i");

export const isImagePath = (p: unknown): p is string =>
  typeof p === "string" && p.length <= 300 && PATH.test(p) && !p.split("/").some((seg) => seg === "." || seg === "..");
export const schoolOfPath = (p: string) => p.split("/")[0];
/** 拡張子から画像の種類（暗号化していない以前の写真の表示に使う） */
export function mimeOfPath(p: string) {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", heif: "image/heif", pdf: "application/pdf" } as Record<string, string>)[ext]
    ?? "application/octet-stream";
}

// 保存・表示してよい種類（2026-10-29）。暗号化した写真は Storage では application/octet-stream になり、Storage の許可形式の検査が効かないため、
// サーバーが中身の先頭から種類を確かめる。HTML・SVG などを答案として置き、同じサイトの上で開かせる攻撃を防ぐ
export const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif", "application/pdf"]);
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);
/** ファイルの先頭から種類を決める（答案に使う形式でなければ null） */
export function sniffMime(buf: Uint8Array): string | null {
  const b = Buffer.from(buf.subarray(0, 16));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.toString("latin1", 0, 6))) return "image/gif";
  if (b.length >= 5 && b.toString("latin1", 0, 5) === "%PDF-") return "application/pdf";
  if (b.length >= 12 && b.toString("latin1", 4, 8) === "ftyp") {
    const brand = b.toString("latin1", 8, 12);
    if (HEIF_BRANDS.has(brand)) return brand === "mif1" || brand === "msf1" ? "image/heif" : "image/heic";
  }
  return null;
}
