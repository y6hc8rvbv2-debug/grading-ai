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
