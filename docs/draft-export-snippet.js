// 「テストを追加」の下書きを、書き出しボタンが無い以前の版の画面から書き出すコード。
// 下書きを作った画面（以前の Preview の URL）で、開発者ツールのコンソールに全部貼り付けて Enter を押す。
// test-draft.json がダウンロードされるので、新しい画面の「下書きを読み込む（ファイル）」で読み込む。
// 何も送信しない（ブラウザの中の下書きを読んで、ファイルにするだけ）。
(async () => {
  const db = await new Promise((ok, ng) => { const r = indexedDB.open("saiten-drafts"); r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error); });
  if (!db.objectStoreNames.contains("drafts")) { alert("この画面には下書きがありません"); return; }
  const d = await new Promise((ok, ng) => { const q = db.transaction("drafts").objectStore("drafts").get("new-test"); q.onsuccess = () => ok(q.result); q.onerror = () => ng(q.error); });
  if (!d) { alert("この画面には下書きがありません"); return; }
  const b64 = (b) => new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(",")[1]); fr.readAsDataURL(b); });
  const files = [];
  for (const s of d.sources || []) files.push({ id: s.id, name: s.name, kind: s.kind, type: s.type, path: s.path || null, data: await b64(s.blob) });
  const { sources, ...draft } = d;
  const out = { format: "saiten-test-draft", version: d.v || 1, exportedAt: new Date().toISOString(), draft, files };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: "application/json" }));
  a.download = "test-draft.json";
  document.body.appendChild(a); a.click(); a.remove();
  alert("下書きを書き出しました（資料 " + files.length + " 件・設問 " + (d.rows || []).length + " 問）。ダウンロードした test-draft.json を新しい画面で読み込んでください");
})();
