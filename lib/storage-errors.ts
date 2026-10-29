// Storage（answer-sheets）への保存の失敗を、原因ごとに分ける（2026-10-29。docs/APPSTORE-PRECHECK.md）
//   以前は保存の失敗をすべて「権限がありません（403）」と表示していたため、許可形式の設定漏れ（415）と見分けられなかった。
//   画面には「何が起きたか＋どう直すか」だけを返し、ログには原因の種類と HTTP の状態だけを書く（鍵・トークン・答案の中身は書かない）
export type StorageFailure = { code: string; status: number; message: string };

type ErrLike = { status?: unknown; statusCode?: unknown; message?: unknown; error?: unknown } | null | undefined;

export function classifyStorageError(err: unknown): StorageFailure {
  const e = err as ErrLike;
  // Storage は HTTP 400 で返し、本当の理由を本文の statusCode（"403"・"415" など）に入れることがあるので、両方を見る
  const codes = [Number(e?.statusCode), Number(e?.status)].filter((n) => Number.isFinite(n) && n > 0);
  const has = (n: number) => codes.includes(n);
  const text = `${String(e?.message ?? "")} ${String(e?.error ?? "")}`.toLowerCase();
  if (has(415) || /mime type|invalid_mime_type|not supported/.test(text))
    return { code: "storage_type_not_allowed", status: 415,
      message: "保存先（Storage）がこの形式を受け付けませんでした。管理者は、answer-sheets の許可形式（Allowed MIME types）を確認してください（暗号化した写真は application/octet-stream で保存します）。" };
  if (has(413) || /maximum allowed size|payload too large|too large/.test(text))
    return { code: "storage_too_large", status: 413, message: "ファイルが大きすぎて保存できませんでした（1ファイル20MBまで）。写真を撮り直すか、ページを分けてください。" };
  if (/bucket not found/.test(text))
    return { code: "storage_bucket_missing", status: 500, message: "保存先（Storage の answer-sheets）が見つかりませんでした。管理者に連絡してください。" };
  if (has(401) || has(403) || /row-level security|unauthorized|permission|not allowed/.test(text))
    return { code: "storage_denied", status: 403, message: "保存する権限がありませんでした（自分の学校の答案か、教職員のアカウントでログインしているかを確認してください）。" };
  return { code: "storage_failed", status: 502, message: "保存先（Storage）に保存できませんでした。時間をおいて、もう一度お試しください。続くときは管理者に連絡してください。" };
}

/** サーバーのログに書く1行（原因の種類・状態・誰の操作か（ID の先頭だけ））。秘密や答案の中身は含めない */
export function storageLogLine(where: string, f: StorageFailure, err: unknown, userId?: string | null) {
  const e = err as ErrLike;
  return `[${where}] ${f.code} status=${String(e?.status ?? "-")}/${String(e?.statusCode ?? "-")}${userId ? ` user=${userId.slice(0, 8)}` : ""}`;
}
