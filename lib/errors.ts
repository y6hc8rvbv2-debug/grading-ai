// エラーを先生向けの日本語メッセージにする。
// 方針：「何が起きたか」と「どう直すか」を1文ずつ書く。英語の生エラーは画面に出さない。

export function friendlyError(e: any, action = "処理"): string {
  const code = e?.code ?? "";
  const msg = String(e?.message ?? e ?? "");

  // アプリ側で日本語メッセージを用意しているもの
  if (/[ぁ-んァ-ン一-龥]/.test(msg)) return msg;

  if (code === "42501" || /row-level security|permission denied/i.test(msg)) {
    return `${action}の権限がありません。管理者に役割（admin / teacher）を確認してもらってください。`;
  }
  if (code === "23505" || /duplicate key/i.test(msg)) {
    return `同じ内容がすでに登録されているため${action}できませんでした。一覧を確認してから、もう一度お試しください。`;
  }
  if (code === "23503" || /foreign key/i.test(msg)) {
    return `関連するテスト・クラス・生徒が見つからないため${action}できませんでした。画面を再読み込みしてから、もう一度お試しください。`;
  }
  if (code === "PGRST301" || /JWT|expired/i.test(msg)) {
    return "ログインの有効期限が切れました。もう一度ログインしてください。";
  }
  if (/Failed to fetch|NetworkError|fetch failed|Load failed/i.test(msg)) {
    return `サーバーに接続できないため${action}できませんでした。インターネット接続を確認して、もう一度お試しください。`;
  }
  if (/Invalid login credentials/i.test(msg)) {
    return "メールアドレスかパスワードが違います。入力を確かめて、もう一度お試しください。";
  }
  if (/Email not confirmed/i.test(msg)) {
    return "メールアドレスの確認が済んでいません。届いた確認メールのリンクを開いてから、ログインしてください。";
  }
  if (/mime type|file size|Payload too large|exceeded the maximum/i.test(msg)) {
    return "画像の形式か大きさが対応外です。JPEG / PNG / HEIC / PDF の 20MB 以下のファイルを選んでください。";
  }
  return `${action}に失敗しました。時間をおいて、もう一度お試しください。（詳細: ${msg || code || "不明"}）`;
}
