// 入力途中の下書き（ブラウザの IndexedDB）。画像などのファイルもそのまま保存できる。
// 端末ごとの保存で、学校では共有しない。保存できない環境（プライベートブラウズなど）では何もしない。
const DB = "saiten-drafts";
const STORE = "drafts";

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    } catch {
      resolve(null);
    }
  });
}

export const loadDraft = <T>(key: string) => run<T>("readonly", (s) => s.get(key));
export const saveDraft = (key: string, value: unknown) => run("readwrite", (s) => s.put(value, key));
export const deleteDraft = (key: string) => run("readwrite", (s) => s.delete(key));
