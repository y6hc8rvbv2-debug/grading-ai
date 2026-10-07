"use client";
import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/data/source";
import { analyzePage, displayableUrl } from "@/lib/redpen/analyze";
import { layoutMarks } from "@/lib/redpen/layout";
import { RedPenOverlay } from "@/components/RedPenOverlay";
import { TutorPanel, type EphemeralKey, type TutorStatus } from "@/components/tutor/TutorPanel";
import { TutorSettings } from "@/components/tutor/TutorSettings";
import { ReviewCopyPanel } from "@/components/tutor/ReviewCopyPanel";
import type { ReleasedItem as TutorItem } from "@/lib/tutor/prompt";
import type { Submission, Test, Item, MarkPos } from "@/lib/types";
type ReleasedItem = Item & { big: number };
type Release = {
  id: string;
  released_at: string;
  version?: number;
  image_paths: string[];
  payload: {
    test: string;
    total: number;
    maxScore: number;
    items: (ReleasedItem & { detected?: string; prompt?: string; correct?: string; model?: string })[];
    positions: MarkPos[];
    showModelAnswer?: boolean;
    subject?: string;
    grade?: number | null;
  };
};
/** 「本人の ChatGPT で復習」（B方式）を、自分の学校・クラスで使えるか（0015 の review_copy_status）。missing は 0015 が未適用 */
type CopyStatus = { student: boolean; enabled: boolean; missing?: boolean };
type InboxRow = { id: string; release_id: string; version: number; kind: string; created_at: string; read_at: string | null };
function ReleasedAnswer({ r, tutor }: { r: Release; tutor?: React.ReactNode }) {
  const [pages, setPages] = useState<
    { url: string; info: Awaited<ReturnType<typeof analyzePage>> }[]
  >([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const urls: string[] = [];
    (async () => {
      try {
        const loaded: {
          url: string;
          info: Awaited<ReturnType<typeof analyzePage>>;
        }[] = [];
        for (const path of r.image_paths) {
          const { data, error } = await createClient()
            .storage.from("answer-sheets")
            .createSignedUrl(path, 600);
          if (error) throw error;
          const url = await displayableUrl(path, data.signedUrl);
          urls.push(url);
          loaded.push({ url, info: await analyzePage(url) });
        }
        if (live) setPages(loaded);
      } catch {
        if (live)
          setError("原本を表示できません。更新するか先生に確認してください");
      }
    })();
    return () => {
      live = false;
      urls.filter((u) => u.startsWith("blob:")).forEach(URL.revokeObjectURL);
    };
  }, [r]);
  const items = r.payload.items.map((i) => ({
    ...i,
    id: String(i.qno),
    needReview: false,
    blank: false,
  }));
  const test = {
    name: r.payload.test,
    subject: "",
    maxScore: r.payload.maxScore,
    questions: items.map((i) => ({
      no: i.qno,
      big: i.big,
      label: i.label,
      type: i.type,
      points: i.points,
    })),
  } as Test;
  const sub = {
    id: r.id,
    status: "done",
    result: { items, total: r.payload.total, blank: false },
  } as unknown as Submission;
  const layouts = layoutMarks(
    items.map((i) => ({
      qno: i.qno,
      big: i.big,
      graph: i.type === "graph",
      bbox: i.bbox,
    })),
    pages.map((p) => p.info),
    r.payload.positions || [],
  );
  return (
    <article
      style={{
        margin: "24px 0",
        padding: 16,
        border: "1px solid #ddd",
        borderRadius: 12,
      }}
    >
      <h2>
        {r.payload.test}：{r.payload.total}／{r.payload.maxScore}点
      </h2>
      <p>返却日時：{new Date(r.released_at).toLocaleString("ja-JP")}</p>
      {error && <p>{error}</p>}
      {pages.map((p, i) => (
        <RedPenOverlay
          key={i}
          imageUrl={p.url}
          sub={sub}
          test={test}
          page={i + 1}
          aspect={p.info.aspect}
          layout={layouts[i]}
        />
      ))}
      {tutor ?? items.map((i) => (
        <p key={i.qno}>
          <b>
            {i.label} {i.mark} {i.earned}／{i.points}点
          </b>
          <br />
          {i.comment}
        </p>
      ))}
    </article>
  );
}
/** 返却されたテスト1件：原本の赤ペンと、間違えた問題ごとの「ChatGPT で復習」（アプリ内の会話を使う設定のときだけ「チャッピー先生に聞く」も） */
function ReleaseDetail({ r, copy, status, ephemeral, openSettings }: { r: Release; copy: CopyStatus | null; status: TutorStatus | null; ephemeral: EphemeralKey; openSettings: () => void }) {
  const [open, setOpen] = useState<{ qno: number; mode: "copy" | "inapp" } | null>(null);
  const wrong = r.payload.items.filter((i) => i.mark !== "○");
  const inapp = status?.inapp === true;
  const meta = { grade: r.payload.grade ?? null, subject: r.payload.subject ?? "", showModelAnswer: r.payload.showModelAnswer === true };
  const toggle = (qno: number, mode: "copy" | "inapp") => setOpen(open?.qno === qno && open.mode === mode ? null : { qno, mode });
  const pill = (active: boolean): React.CSSProperties => ({ padding: "8px 12px", minHeight: 40, borderRadius: 10, border: "1px solid #1E3A5F", background: active ? "#1E3A5F" : "#fff", color: active ? "#fff" : "#1E3A5F", fontSize: 14 });
  return (
    <ReleasedAnswer r={r} tutor={
      <section>
        <h3>間違えた問題（{wrong.length}問）</h3>
        {!wrong.length && <p>全問正解です。</p>}
        {wrong.length > 0 && copy && !copy.enabled && (
          <p data-testid="review-copy-off" style={{ fontSize: 13.5, color: "#555" }}>ChatGPT での復習は、先生が学校・クラスで有効にすると使えます。</p>
        )}
        {wrong.map((i) => (
          <div key={i.qno} data-testid="wrong-question" style={{ borderTop: "1px solid #e1e4e8", padding: "10px 0" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <b>{i.label}</b><span>{i.mark}</span><span>{i.earned}／{i.points}点</span>
              {copy?.enabled && (
                <button style={pill(open?.qno === i.qno && open.mode === "copy")} onClick={() => toggle(i.qno, "copy")}>
                  {open?.qno === i.qno && open.mode === "copy" ? "閉じる" : "ChatGPT で復習"}
                </button>
              )}
              {inapp && (
                <button style={pill(open?.qno === i.qno && open.mode === "inapp")} onClick={() => toggle(i.qno, "inapp")}>
                  {open?.qno === i.qno && open.mode === "inapp" ? "閉じる" : "チャッピー先生に聞く"}
                </button>
              )}
            </div>
            {i.comment && <p style={{ margin: "4px 0", color: "#B3261E" }}>{i.comment}</p>}
            {open?.qno === i.qno && open.mode === "copy" && copy?.enabled && (
              <ReviewCopyPanel releaseId={r.id} item={i} meta={meta} />
            )}
            {open?.qno === i.qno && open.mode === "inapp" && inapp && (
              <TutorPanel releaseId={r.id} item={i as TutorItem} showModelAnswer={!!r.payload.showModelAnswer}
                status={status} ephemeral={ephemeral} onOpenSettings={openSettings} />
            )}
          </div>
        ))}
        <h3>すべての問題</h3>
        {r.payload.items.map((i) => (
          <p key={i.qno} style={{ margin: "4px 0" }}><b>{i.label} {i.mark} {i.earned}／{i.points}点</b>{i.comment ? `　${i.comment}` : ""}</p>
        ))}
      </section>
    } />
  );
}

export default function StudentPage() {
  const [user, setUser] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [rows, setRows] = useState<Release[]>([]);
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"list" | "settings" | string>("list");
  const [status, setStatus] = useState<TutorStatus | null>(null);
  const [copy, setCopy] = useState<CopyStatus | null>(null);
  // 保存しないキー：この画面を閉じるまでメモリにだけ置く（ブラウザの保存領域には置かない）
  const [ephemeral, setEphemeral] = useState<EphemeralKey>(null);

  // B方式：DB の設定だけで決まる（サーバーの環境変数・API キー・見回りに依存しない）。
  // A方式（アプリ内の会話）：サーバーが使う設定のときだけ画面に出す（status.inapp）
  const loadStatus = async () => {
    const { data, error } = await createClient().rpc("review_copy_status");
    setCopy(error ? { student: false, enabled: false, missing: true } : (data as CopyStatus));
    const res = await fetch("/api/tutor/status", { cache: "no-store" }).catch(() => null);
    setStatus(res && res.ok ? await res.json() : null);
  };
  const load = async () => {
    if (!isSupabaseConfigured()) {
      setMessage("接続設定が必要です");
      return;
    }
    const db = createClient();
    const {
      data: { user },
      error: authError,
    } = await db.auth.getUser();
    // 通信が一時的に切れただけ（ログアウトではない）なら、画面をそのままにする（会話中の画面を閉じない）
    if (!user && authError && /fetch|network/i.test(`${authError.name} ${authError.message}`)) return;
    setUser(user?.email || "");
    if (user) {
      const [{ data, error }, { data: ib }] = await Promise.all([
        db.from("result_releases").select("id,payload,image_paths,released_at,version").order("released_at", { ascending: false }),
        db.from("student_inbox").select("id,release_id,version,kind,created_at,read_at").order("created_at", { ascending: false }),
      ]);
      if (error) setMessage("結果を取得できません。先生に確認してください");
      else
        setRows((previous) =>
          JSON.stringify(previous) === JSON.stringify(data || [])
            ? previous
            : ((data || []) as Release[]),
        );
      setInbox((ib ?? []) as InboxRow[]);
    }
  };
  useEffect(() => {
    // ログイン前はチャッピー先生の状態を問い合わせない（未ログインの 401 を出さない）
    load().then(async () => { const { data: { user } } = await createClient().auth.getUser(); if (user) await loadStatus(); });
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);
  const auth = async (signup: boolean) => {
    setBusy(true);
    try {
      const db = createClient();
      const { error } = signup
        ? await db.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: `${location.origin}/auth/callback` },
          })
        : await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setMessage(
        signup
          ? "確認メールのリンクを開き、先生に登録したアドレスを伝えてください"
          : "",
      );
      setPassword("");
      await load();
      await loadStatus();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "ログインできません");
    } finally {
      setBusy(false);
    }
  };
  // ログアウト：会話・入力したキー・画面の内容を消し、ブラウザのキャッシュに答案を残さない
  const logout = async () => {
    setView("list");
    setEphemeral(null);
    await createClient().auth.signOut();
    try { sessionStorage.clear(); } catch { /* 使えない環境 */ }
    try { if ("caches" in window) for (const k of await caches.keys()) await caches.delete(k); } catch { /* 使えない環境 */ }
    setUser("");
    setRows([]);
    setInbox([]);
    setStatus(null);
    setCopy(null);
  };
  const openRelease = async (r: Release) => {
    setView(r.id);
    const db = createClient();
    for (const m of inbox.filter((x) => x.release_id === r.id && !x.read_at)) await db.rpc("mark_inbox_read", { p_id: m.id });
    setInbox((ib) => ib.map((x) => (x.release_id === r.id ? { ...x, read_at: x.read_at ?? new Date().toISOString() } : x)));
  };
  const unread = (id: string) => inbox.filter((x) => x.release_id === id && !x.read_at);
  const current = rows.find((r) => r.id === view) ?? null;
  const tab = (active: boolean): React.CSSProperties => ({ padding: "8px 14px", minHeight: 40, borderRadius: 10, border: "1px solid #1E3A5F", background: active ? "#1E3A5F" : "#fff", color: active ? "#fff" : "#1E3A5F", fontSize: 15 });

  return (
    <main
      style={{
        maxWidth: 850,
        margin: "auto",
        padding: 16,
        fontFamily: "sans-serif",
      }}
    >
      <h1 style={{ fontSize: 22 }}>返却された答案</h1>
      <p role="status">{message}</p>
      {!user ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            auth(false);
          }}
        >
          <p>自分のアカウントでログインしてください。</p>
          <p>
            <input
              required
              aria-label="メール"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </p>
          <p>
            <input
              required
              aria-label="パスワード"
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </p>
          <button disabled={busy}>ログイン</button>{" "}
          <button
            type="button"
            disabled={busy || !email || password.length < 8}
            onClick={() => auth(true)}
          >
            初めて：アカウント登録
          </button>
        </form>
      ) : (
        <>
          <p style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span>{user}</span>
            <button onClick={logout}>ログアウト</button>
            <button onClick={() => { load(); loadStatus(); }}>更新</button>
          </p>
          <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
            <button style={tab(view === "list" || !!current)} onClick={() => setView("list")}>
              受信箱{inbox.some((x) => !x.read_at) ? `（新着 ${inbox.filter((x) => !x.read_at).length}）` : ""}
            </button>
            {status?.student && status.inapp === true && <button style={tab(view === "settings")} onClick={() => setView("settings")}>チャッピー先生の設定</button>}
          </nav>
          {view === "settings" && status?.inapp === true && (
            <TutorSettings status={status} reload={loadStatus} ephemeral={ephemeral} setEphemeral={setEphemeral} />
          )}
          {view === "list" && (
            <>
              {!rows.length && (
                <p>
                  返却された答案はまだありません。先生の配信後にここへ表示されます。
                </p>
              )}
              <ul data-testid="inbox" style={{ listStyle: "none", padding: 0 }}>
                {rows.map((r) => (
                  <li key={r.id} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12, margin: "8px 0" }}>
                    <button onClick={() => openRelease(r)} style={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }}>
                      <b>{r.payload.test}</b>
                      {unread(r.id).length > 0 && (
                        <span style={{ marginInlineStart: 8, background: "#B3261E", color: "#fff", borderRadius: 8, padding: "2px 8px", fontSize: 12 }}>
                          {unread(r.id).some((x) => x.kind === "updated") ? "更新" : "新着"}
                        </span>
                      )}
                      <br />
                      <span style={{ fontSize: 13, color: "#555" }}>
                        返却日時：{new Date(r.released_at).toLocaleString("ja-JP")}
                        {(r.version ?? 1) > 1 ? `（先生が内容を更新しました・第${r.version}版）` : ""}
                        ／間違えた問題 {r.payload.items.filter((i) => i.mark !== "○").length} 問
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {current && (
            <>
              <button onClick={() => setView("list")}>← 受信箱に戻る</button>
              <ReleaseDetail key={current.id} r={current} copy={copy} status={status} ephemeral={ephemeral} openSettings={() => setView("settings")} />
            </>
          )}
        </>
      )}
    </main>
  );
}
