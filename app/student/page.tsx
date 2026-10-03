"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/data/source";
import { analyzePage, displayableUrl } from "@/lib/redpen/analyze";
import { layoutMarks } from "@/lib/redpen/layout";
import { RedPenOverlay } from "@/components/RedPenOverlay";
import type { Submission, Test, Item, MarkPos } from "@/lib/types";
type ReleasedItem = Item & { big: number };
type Release = {
  id: string;
  released_at: string;
  image_paths: string[];
  payload: {
    test: string;
    total: number;
    maxScore: number;
    items: ReleasedItem[];
    positions: MarkPos[];
  };
};
function ReleasedAnswer({ r }: { r: Release }) {
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
      {items.map((i) => (
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
export default function StudentPage() {
  const [user, setUser] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [rows, setRows] = useState<Release[]>([]);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    if (!isSupabaseConfigured()) {
      setMessage("接続設定が必要です");
      return;
    }
    const db = createClient();
    const {
      data: { user },
    } = await db.auth.getUser();
    setUser(user?.email || "");
    if (user) {
      const { data, error } = await db
        .from("result_releases")
        .select("id,payload,image_paths,released_at")
        .order("released_at", { ascending: false });
      if (error) setMessage("結果を取得できません。先生に確認してください");
      else
        setRows((previous) =>
          JSON.stringify(previous) === JSON.stringify(data || [])
            ? previous
            : ((data || []) as Release[]),
        );
    }
  };
  useEffect(() => {
    load();
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
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "ログインできません");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main
      style={{
        maxWidth: 850,
        margin: "auto",
        padding: 20,
        fontFamily: "sans-serif",
      }}
    >
      <h1>返却された答案</h1>
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
          <p>
            {user}{" "}
            <button
              onClick={async () => {
                await createClient().auth.signOut();
                setUser("");
                setRows([]);
              }}
            >
              ログアウト
            </button>{" "}
            <button onClick={load}>更新</button>
          </p>
          {!rows.length && (
            <p>
              返却された答案はまだありません。先生の配信後にここへ表示されます。
            </p>
          )}
          {rows.map((r) => (
            <ReleasedAnswer key={r.id} r={r} />
          ))}
        </>
      )}
    </main>
  );
}
