// 「テストを追加」の下書きをファイルに書き出す・読み込む（ブラウザ専用）。
//
// 下書きはブラウザの IndexedDB に保存していて、URL（オリジン）ごとに別々になる。
// Vercel の Preview は版ごとに URL が変わることがあるので、別の URL や別の端末へ移すときに使う。
// ファイルは JSON で、資料の画像（Blob）を base64 にして同じファイルに入れる。
//
// 同じ形式のファイルは、書き出しボタンが無い以前の版の画面でも、開発者ツールのコンソールに
// docs/draft-export-snippet.js を貼って書き出せる（手順は docs/DRAFT-MOVE.md）。
export const DRAFT_FILE_FORMAT = "saiten-test-draft";

type FileEntry = { id: string; name: string; kind: string; type: string; path?: string | null; data: string };
export type DraftFile = { format: string; version: number; exportedAt: string; draft: Record<string, unknown>; files: FileEntry[] };

const toBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result).split(",")[1] ?? "");
  fr.onerror = () => reject(fr.error);
  fr.readAsDataURL(blob);
});

/** 下書き（sources に Blob を含む）を、1つの JSON ファイルにする */
export async function draftToFile(draft: { sources?: { id: string; name: string; kind: string; type: string; blob: Blob; path?: string }[] } & Record<string, unknown>) {
  const { sources = [], ...rest } = draft;
  const files: FileEntry[] = [];
  for (const s of sources) files.push({ id: s.id, name: s.name, kind: s.kind, type: s.type, path: s.path ?? null, data: await toBase64(s.blob) });
  const out: DraftFile = { format: DRAFT_FILE_FORMAT, version: Number(rest.v) || 2, exportedAt: new Date().toISOString(), draft: rest, files };
  return new Blob([JSON.stringify(out)], { type: "application/json" });
}

/** 書き出したファイルを、下書き（sources に Blob を含む）に戻す。形式が違えば日本語のエラーにする */
export function fileToDraft(text: string) {
  let f: DraftFile;
  try {
    f = JSON.parse(text);
  } catch {
    throw new Error("下書きのファイルを読み取れませんでした。「下書きを書き出す」で作ったファイル（.json）を選んでください。");
  }
  if (f?.format !== DRAFT_FILE_FORMAT || !f.draft || !Array.isArray(f.files)) {
    throw new Error("このファイルはテストの下書きではありません。「下書きを書き出す」で作ったファイル（.json）を選んでください。");
  }
  const sources = f.files.map((e) => {
    const bin = atob(e.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // requestId は付けない（別の URL では、同じ読み取りとして扱えるとは限らないため。AI は呼ばない）
    return { id: e.id, name: e.name, kind: e.kind, type: e.type, blob: new Blob([bytes], { type: e.type }), ...(e.path ? { path: e.path } : {}) };
  });
  return { ...f.draft, sources } as Record<string, unknown> & { sources: typeof sources };
}
