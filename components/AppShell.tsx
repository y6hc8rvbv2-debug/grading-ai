"use client";
// アプリの外枠（サイドバー・ヘッダー・フッター）と、画面全体で共有する状態。
// docs/prototype-v3.jsx の App / Sidebar を移植し、状態の保存先を Supabase に差し替えた。
import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { THEME, FONT_UI, FONT_MONO, FONT_HAND } from "@/lib/ui/theme";
import { LANGS, makeT, isRTL } from "@/lib/i18n";
import { clamp, uid } from "@/lib/util";
import { DEFAULT_RUBRIC } from "@/lib/grading/engine";
import { friendlyError } from "@/lib/errors";
import { isSupabaseConfigured, type DataSource, type SessionInfo } from "@/lib/data/source";
import { createDemoSource } from "@/lib/data/demo";
import { createSupabaseSource } from "@/lib/data/supabase";
import { Ctx, useUI, type DisplayMode, type UIContext, type View } from "@/components/ui-context";
import { Btn, Toast, inputStyle } from "@/components/ui";
import type { AiGradeSummary, AiStatus, Item, ItemPatch, Rubric, Submission, Workspace } from "@/lib/types";
import { MODE_LABEL, STAGE_LABEL, type GradingMode } from "@/lib/grading/cost";
import type { AiGradeProgress } from "@/lib/data/source";

/** 採点結果の通知に添える方式（例: 3モデル併用・Sonnetで確定） */
const modeNote = (r: AiGradeSummary) =>
  r.mode === "cascade" && r.finalStage ? `${MODE_LABEL.cascade}・${STAGE_LABEL[r.finalStage]}で確定` : MODE_LABEL[r.mode ?? "opus"];

/* ------------------------------------------------------------ 画面の対応表 */
const NAV: { k: View; i: string; tk: string; admin?: boolean }[] = [
  { k: "dashboard", i: "🏠", tk: "nav_dashboard" },
  { k: "new", i: "📤", tk: "nav_new" },
  { k: "history", i: "🗃", tk: "nav_history" },
  { k: "processing", i: "⏳", tk: "nav_processing" },
  { k: "tests", i: "📝", tk: "nav_tests" },
  { k: "model", i: "📘", tk: "nav_model" },
  { k: "rubric", i: "⚖️", tk: "nav_rubric" },
  { k: "students", i: "🧑‍🎓", tk: "nav_students" },
  { k: "classes", i: "🏫", tk: "nav_classes" },
  { k: "scores", i: "📈", tk: "nav_scores" },
  { k: "weakness", i: "🔬", tk: "nav_weakness" },
  { k: "reports", i: "📄", tk: "nav_reports" },
  { k: "review", i: "🔍", tk: "nav_review" },
  { k: "settings", i: "⚙️", tk: "nav_settings" },
  // 管理者だけに表示する（API 側でも管理者本人かを確かめる）
  { k: "compare", i: "🧪", tk: "nav_compare", admin: true },
];

const TITLES: Record<View, [string, string]> = {
  dashboard: ["nav_dashboard", "採点の状況・お知らせ・利用状況をまとめて確認できます"],
  new: ["nav_new", "答案画像を取り込むと、5つのステップで自動採点します"],
  history: ["nav_history", "採点済みの答案を検索・書き出しできます"],
  processing: ["nav_processing", "いま処理中の答案とその進み具合"],
  tests: ["nav_tests", "テストの設問構成・配点・単元を管理します"],
  model: ["nav_model", "模範解答と解説を生成・保存します"],
  rubric: ["nav_rubric", "採点のきびしさと表記の扱いを決めます"],
  students: ["nav_students", "実名を保存しない設計で生徒を管理します"],
  classes: ["nav_classes", "クラスごとの平均と分布"],
  scores: ["nav_scores", "クラス × テストの得点を一覧します"],
  weakness: ["nav_weakness", "単元別・設問別のつまずきを可視化します"],
  reports: ["nav_reports", "クラス成績レポートと個人成績票を作ります"],
  review: ["nav_review", "認識信頼度が低い設問を確定させます"],
  settings: ["nav_settings", "言語・表示・データの扱い・外部連携"],
  compare: ["nav_compare", "同じ答案を3つの採点モデルで1回ずつ採点し、結果・時間・費用を比べます（管理者専用・成績には保存しません）"],
  detail: ["nav_history", "赤ペン採点画像・修正・分析・フィードバック"],
};

export const pathOf = (v: View, param?: string | null) =>
  v === "dashboard" ? "/" : v === "detail" ? `/history/${param ?? ""}` : `/${v}`;

function viewOf(pathname: string): View {
  const seg = pathname.split("/").filter(Boolean);
  if (!seg.length) return "dashboard";
  if (seg[0] === "history" && seg[1]) return "detail";
  return (NAV.some((n) => n.k === seg[0]) ? seg[0] : "dashboard") as View;
}

/* ------------------------------------------------------ 端末ごとの表示設定 */
// 表示の好み（テーマ・お気に入り・匿名モードなど）は端末の localStorage に保存する。
// 採点データとは違い、学校で共有する必要がないため。
function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`saiten.${key}`);
      if (raw != null) setV(JSON.parse(raw));
    } catch { /* 保存領域が使えない環境では既定値のまま */ }
  }, [key]);
  const set = useCallback((next: T) => {
    setV(next);
    try { window.localStorage.setItem(`saiten.${key}`, JSON.stringify(next)); } catch { /* 無視 */ }
  }, [key]);
  return [v, set];
}

/* -------------------------------------------------------------- Provider */
type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "no-school"; session: SessionInfo }
  | { kind: "ready"; session: SessionInfo };

export default function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const view = viewOf(pathname);

  const ds: DataSource = useMemo(
    () => (isSupabaseConfigured() ? createSupabaseSource() : createDemoSource()),
    []
  );

  const [mode, setMode] = usePref<"light" | "dark">("mode", "light");
  const [lang, setLangState] = usePref<string>("lang", "ja");
  const [favs, setFavs] = usePref<string[]>("favs", ["new", "review"]);
  const [anonMode, setAnonMode] = usePref<boolean>("anonMode", false);
  // 採点方式（Opus単独 / 3モデル併用）。端末ごとに覚えておき、新規採点・採点中・答案詳細で使う
  const [gradingMode, setGradingMode] = usePref<GradingMode>("gradingMode", "opus");
  const [display, setDisplay] = usePref<DisplayMode>("display", "class");
  const [answerLang, setAnswerLang] = usePref<string>("answerLang", "ja");
  const [studentLang, setStudentLang] = usePref<string>("studentLang", "ja");

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [ws, setWs] = useState<Workspace>({ classes: [], students: [], tests: [] });
  const [subs, setSubs] = useState<Submission[]>([]);
  const [rubric, setRubric] = useState<Rubric>(DEFAULT_RUBRIC);
  const [ai, setAi] = useState<AiStatus>({ enabled: false, model: null });
  const [toasts, setToasts] = useState<{ id: string; msg: string; tone: string }[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 900);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const T = THEME[mode] ?? THEME.light;
  const t = useMemo(() => makeT(lang), [lang]);
  const rtl = isRTL(lang);

  const toast = useCallback((msg: string, tone: "ok" | "warn" | "ng" = "ok") => {
    const id = uid("t");
    setToasts((p) => [...p, { id, msg, tone }]);
    setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), tone === "ng" ? 6000 : 3200);
  }, []);

  const go = useCallback((v: View, p: string | null = null) => {
    setDrawer(false);
    router.push(pathOf(v, p));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, [router]);

  /* ---------------------------------------------------- 初回の読み込み */
  const loadAll = useCallback(async () => {
    const [w, s, r] = await Promise.all([ds.loadWorkspace(), ds.loadSubmissions(), ds.loadRubric()]);
    setWs(w); setSubs(s); setRubric(r);
  }, [ds]);

  const boot = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const session = await ds.loadSession();
      if (!session) { router.replace("/login"); return; }
      if (!session.profile) { setState({ kind: "no-school", session }); return; }
      if (session.profile.uiLang && session.profile.uiLang !== "ja") setLangState(session.profile.uiLang);
      await loadAll();
      // 採点AIが使えないときは、答案の保存までで止める（画面の案内が変わるだけで、起動は止めない）
      ds.aiStatus().then(setAi).catch(() => setAi({ enabled: false, model: null }));
      setState({ kind: "ready", session });
    } catch (e) {
      setState({ kind: "error", message: friendlyError(e, "データの読み込み") });
    }
  }, [ds, loadAll, router, setLangState]);

  useEffect(() => { boot(); }, [boot]);

  const setLang = useCallback((l: string) => {
    setLangState(l);
    ds.saveUiLang(l).catch(() => { /* 表示言語の保存失敗は端末側の設定で補う */ });
  }, [ds, setLangState]);

  /* ---------------------------------------------------- 検索用の索引 */
  const maps = useMemo(() => ({
    student: new Map(ws.students.map((s) => [s.id, s])),
    klass: new Map(ws.classes.map((c) => [c.id, c])),
    test: new Map(ws.tests.map((x) => [x.id, x])),
  }), [ws]);
  const studentById = useCallback((id: string) => maps.student.get(id), [maps]);
  const classById = useCallback((id: string) => maps.klass.get(id), [maps]);
  const testById = useCallback((id: string) => maps.test.get(id), [maps]);

  const who = useCallback((studentId: string) => {
    const st = maps.student.get(studentId);
    if (!st) return "（名簿にない生徒）";
    if (anonMode) return st.anonId;
    const kl = maps.klass.get(st.classId);
    switch (display) {
      case "exam": return st.examNo;
      case "initials": return st.initials || st.anonId;
      case "anon": return st.anonId;
      default: return `${kl?.label ?? ""} ${st.number}番`;
    }
  }, [maps, anonMode, display]);

  /* ---------------------------------------------------- 操作 */
  const refresh = useCallback(async () => {
    try { await loadAll(); } catch (e) { toast(friendlyError(e, "再読み込み"), "ng"); }
  }, [loadAll, toast]);

  const refreshSub = useCallback(async (id: string) => {
    const fresh = await ds.loadSubmission(id);
    setSubs((prev) => fresh
      ? (prev.some((s) => s.id === id) ? prev.map((s) => (s.id === id ? fresh : s)) : [fresh, ...prev])
      : prev.filter((s) => s.id !== id));
  }, [ds]);

  const editItem = useCallback(async (submissionId: string, item: Item, patch: ItemPatch) => {
    // ○△× を選んだら配点に合わせて得点を決め、要確認を外す（1問単位の規則）
    const next: ItemPatch = { ...patch };
    if (patch.mark) {
      next.earned = patch.mark === "○" ? item.points : patch.mark === "△" ? Math.max(1, Math.round(item.points / 2)) : 0;
      next.needReview = false;
    }
    if (patch.earned != null) next.earned = clamp(Number(patch.earned) || 0, 0, item.points);

    // 画面にはすぐ反映する（合計点・状態は保存後に DB の値で置き換える）
    const before = subs;
    setSubs((prev) => prev.map((s) => s.id !== submissionId ? s : {
      ...s, edited: true,
      result: { ...s.result, items: s.result.items.map((it) => (it.id === item.id ? { ...it, ...next } : it)) },
    }));
    try {
      await ds.updateItem(submissionId, item.id, next);
      await refreshSub(submissionId);
      return true;
    } catch (e) {
      setSubs(before);
      toast(friendlyError(e, "採点の修正"), "ng");
      return false;
    }
  }, [ds, subs, refreshSub, toast]);

  const reviewSub = useCallback(async (submissionId: string) => {
    try {
      await ds.markReviewed(submissionId);
      await refreshSub(submissionId);
      return true;
    } catch (e) {
      toast(friendlyError(e, "確認済みの記録"), "ng");
      return false;
    }
  }, [ds, refreshSub, toast]);

  const aiGradeSub = useCallback(async (submissionId: string, opts: { silent?: boolean; mode?: GradingMode; onProgress?: (p: AiGradeProgress) => void } = {}) => {
    // 採点中の表示にする（サーバーも status = processing にしている）
    setSubs((prev) => prev.map((s) => (s.id === submissionId ? { ...s, status: "processing", progress: 30 } : s)));
    try {
      const r = await ds.aiGrade(submissionId, { mode: opts.mode ?? gradingMode, onProgress: opts.onProgress });
      await refreshSub(submissionId);
      if (!opts.silent) {
        toast(r.blank ? "全問白紙の答案でした。模範解答タブを確認してください"
          : r.needReview ? `AI採点が終わりました（${r.total}点・${modeNote(r)}）。要確認が ${r.needReview} 問あります`
          : `AI採点が終わりました（${r.total}点・${modeNote(r)}）`);
      }
      return { ok: true as const, summary: r };
    } catch (e) {
      // サーバーが元の状態に戻しているので、読み直して画面を合わせる
      await refreshSub(submissionId).catch(() => {});
      const error = friendlyError(e, "AI採点");
      if (!opts.silent) toast(error, "ng");
      return { ok: false as const, error };
    }
  }, [ds, refreshSub, toast, gradingMode]);

  const toggleFav = useCallback((k: string) => {
    setFavs(favs.includes(k) ? favs.filter((x) => x !== k) : [...favs, k]);
  }, [favs, setFavs]);

  /* ---------------------------------------------------- 読み込み中・エラー */
  const frame = (content: ReactNode) => (
    <div dir={rtl ? "rtl" : "ltr"} style={{
      minHeight: "100vh", background: T.bg, color: T.text, font: `14px/1.6 ${FONT_UI}`,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        maxWidth: 480, width: "100%", background: T.panel, border: `1px solid ${T.line}`,
        borderRadius: 16, padding: 24, boxShadow: T.shadow, textAlign: "center",
      }}>{content}</div>
    </div>
  );

  if (state.kind === "loading") {
    return frame(<>
      <div style={{ font: `700 34px ${FONT_HAND}`, color: T.shu, marginBottom: 8 }}>朱</div>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>読み込んでいます…</div>
      <div style={{ fontSize: 12.5, color: T.textSub }}>クラス・生徒・テスト・答案を準備しています。</div>
    </>);
  }
  if (state.kind === "error") {
    return frame(<>
      <div style={{ fontSize: 30, marginBottom: 8 }}>⚠️</div>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>データを読み込めませんでした</div>
      <div style={{ fontSize: 13, color: T.textSub, lineHeight: 1.8, marginBottom: 16 }}>{state.message}</div>
      <button onClick={boot} style={{ ...plainBtn(T.accent), marginInlineEnd: 8 }}>もう一度読み込む</button>
      <button onClick={async () => { await ds.signOut(); router.replace("/login"); }} style={plainBtn(T.textSub)}>ログアウト</button>
    </>);
  }
  if (state.kind === "no-school") {
    return frame(<>
      <div style={{ fontSize: 30, marginBottom: 8 }}>🏫</div>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>学校に紐づいていないアカウントです</div>
      <div style={{ fontSize: 13, color: T.textSub, lineHeight: 1.8, marginBottom: 16, textAlign: "start" }}>
        {state.session.email} でログインしていますが、所属校が設定されていません。
        学校の管理者に、このメールアドレスを所属校に追加してもらってください。
        （管理者向け：docs/SUPABASE-SETUP.md の「ステップ3」を参照）
      </div>
      <button onClick={async () => { await ds.signOut(); router.replace("/login"); }} style={plainBtn(T.accent)}>ログアウト</button>
    </>);
  }

  const session = state.session;
  const ctx: UIContext = {
    T, t, lang, setLang, mode, setMode, mobile, view, go, toast,
    ds, session, isAdmin: session.profile?.role === "admin",
    ws, subs, studentById, classById, testById, who,
    rubric, setRubric, ai, aiGradeSub, gradingMode, setGradingMode,
    anonMode, setAnonMode, display, setDisplay, answerLang, setAnswerLang, studentLang, setStudentLang,
    favs, toggleFav, refresh, refreshSub, editItem, reviewSub,
  };

  const [tk, sub] = TITLES[view] || TITLES.dashboard;
  const reviewCount = subs.filter((s) => s.status !== "processing" && s.result.items.some((i) => i.needReview)).length;

  return (
    <Ctx.Provider value={ctx}>
      <div dir={rtl ? "rtl" : "ltr"} style={{
        display: "flex", minHeight: "100vh", background: T.bg, color: T.text,
        font: `14px/1.6 ${FONT_UI}`, WebkitFontSmoothing: "antialiased",
      }}>
        <Sidebar open={drawer} onClose={() => setDrawer(false)} />

        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <header style={{
            position: "sticky", top: 0, zIndex: 100, background: `${T.panel}f2`, backdropFilter: "blur(8px)",
            borderBottom: `1px solid ${T.line}`, padding: "11px 16px",
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          }}>
            {mobile && (
              <button onClick={() => setDrawer(true)} aria-label="メニュー"
                style={{ border: `1px solid ${T.lineStrong}`, background: T.panel, borderRadius: 9, width: 36, height: 34, cursor: "pointer", color: T.text, fontSize: 15 }}>☰</button>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ margin: 0, font: `700 16px ${FONT_UI}`, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {t(tk)}
              </h1>
              <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
            </div>
            {ds.mode === "demo" && <span title="Supabase が未設定のため、データは保存されません" style={{
              background: T.warnSoft, color: T.warn, border: `1px solid ${T.warn}`, borderRadius: 999,
              padding: "3px 10px", fontSize: 11, fontWeight: 700,
            }}>デモモード（保存されません）</span>}
            {!mobile && reviewCount > 0 && view !== "review" && (
              <Btn size="sm" variant="soft" onClick={() => go("review")}>要確認 {reviewCount}</Btn>
            )}
            <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="language"
              style={{ ...inputStyle(T), width: "auto", padding: "6px 8px", fontSize: 12 }}>
              {LANGS.map((l) => <option key={l.c} value={l.c}>{l.f} {l.n}</option>)}
            </select>
            <button onClick={() => setMode(mode === "light" ? "dark" : "light")} aria-label="theme"
              style={{ border: `1px solid ${T.lineStrong}`, background: T.panel, borderRadius: 9, width: 36, height: 34, cursor: "pointer", color: T.text, fontSize: 14 }}>
              {mode === "light" ? "🌙" : "☀"}
            </button>
            {!mobile && <Btn size="sm" variant="shu" onClick={() => go("new")}>新規採点</Btn>}
          </header>

          <div style={{ padding: mobile ? "14px 12px 60px" : "20px 22px 70px", maxWidth: 1240, width: "100%", boxSizing: "border-box" }}>
            {children}
          </div>

          <footer style={{ marginTop: "auto", borderTop: `1px solid ${T.line}`, padding: "14px 18px", background: T.panel }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 11.5, color: T.textFaint }}>
              <span style={{ fontWeight: 700, color: T.textSub }}>{t("appName")}</span>
              <span>生徒の実名は保存しません</span>
              <span>·</span>
              <span>AIの採点は下書きです。返却前に教師がご確認ください</span>
              <span style={{ flex: 1 }} />
              <button onClick={() => go("settings")} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", font: `600 11.5px ${FONT_UI}` }}>
                プライバシー設定
              </button>
            </div>
          </footer>
        </main>

        {mobile && (
          <button onClick={() => go("new")} aria-label="新規採点"
            style={{
              position: "fixed", insetInlineEnd: 16, bottom: 16, zIndex: 120,
              width: 54, height: 54, borderRadius: 18, border: "none", background: T.shu, color: "#fff",
              fontSize: 21, cursor: "pointer", boxShadow: "0 8px 22px rgba(200,52,43,.4)",
            }}>＋</button>
        )}

        <Toast toasts={toasts} />
      </div>
    </Ctx.Provider>
  );
}

const plainBtn = (color: string): React.CSSProperties => ({
  font: `700 13px ${FONT_UI}`, padding: "9px 16px", borderRadius: 9, cursor: "pointer",
  border: `1px solid ${color}`, background: "transparent", color,
});

/* -------------------------------------------------------------- サイドバー */
function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { T, t, view, go, favs, toggleFav, subs, mobile, ds, session, ws, lang, isAdmin } = useUI();
  const nav = NAV.filter((n) => !n.admin || isAdmin);
  const router = useRouter();
  const counts: Partial<Record<View, number>> = {
    processing: subs.filter((s) => s.status === "processing").length,
    review: subs.filter((s) => s.status !== "processing" && s.result.items.some((i) => i.needReview)).length,
    history: subs.filter((s) => s.status !== "processing").length,
  };
  const favItems = nav.filter((n) => favs.includes(n.k));

  const Item = ({ n, pinned }: { n: (typeof NAV)[number]; pinned?: boolean }) => {
    const active = view === n.k || (view === "detail" && n.k === "history");
    const c = counts[n.k] ?? 0;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <button onClick={() => { go(n.k); if (mobile) onClose(); }}
          style={{
            flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 9,
            border: "none", cursor: "pointer", textAlign: "start", font: `${active ? 700 : 500} 13px ${FONT_UI}`,
            background: active ? T.accentSoft : "transparent", color: active ? T.accent : T.textSub,
            borderInlineStart: `3px solid ${active ? T.accent : "transparent"}`,
          }}>
          <span style={{ fontSize: 15, width: 20, textAlign: "center" }}>{n.i}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t(n.tk)}</span>
          {c > 0 && (
            <span style={{
              background: n.k === "review" ? T.shu : T.info, color: "#fff", borderRadius: 999,
              padding: "1px 7px", font: `700 10.5px ${FONT_MONO}`,
            }}>{c}</span>
          )}
        </button>
        <button onClick={() => toggleFav(n.k)} title={pinned ? t("favRemove") : t("favAdd")}
          aria-label={favs.includes(n.k) ? t("favRemove") : t("favAdd")}
          style={{ border: "none", background: "transparent", cursor: "pointer", color: favs.includes(n.k) ? T.warn : T.textFaint, fontSize: 12, padding: "4px 6px" }}>
          {favs.includes(n.k) ? "★" : "☆"}
        </button>
      </div>
    );
  };

  const body = (
    <nav style={{
      width: 244, flexShrink: 0, background: T.panel, borderInlineEnd: `1px solid ${T.line}`,
      height: "100%", minHeight: "100vh", overflowY: "auto", padding: "12px 8px", boxSizing: "border-box",
    }}>
      <div style={{ padding: "6px 10px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8, background: T.shu, color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center", font: `700 17px ${FONT_HAND}`,
          }}>朱</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ font: `700 13.5px ${FONT_UI}`, color: T.text, whiteSpace: "nowrap" }}>{t("appName")}</div>
            <div style={{ fontSize: 10, color: T.textFaint }}>AI GRADING AGENT</div>
          </div>
        </div>
      </div>

      {favItems.length > 0 && (
        <>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textFaint, padding: "6px 12px", letterSpacing: ".08em" }}>
            ★ {t("fav")}
          </div>
          <div style={{ display: "grid", gap: 2, marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${T.line}` }}>
            {favItems.map((n) => <Item key={`f_${n.k}`} n={n} pinned />)}
          </div>
        </>
      )}

      <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textFaint, padding: "6px 12px", letterSpacing: ".08em" }}>MENU</div>
      <div style={{ display: "grid", gap: 2 }}>
        {nav.map((n) => <Item key={n.k} n={n} />)}
      </div>

      <div style={{ marginTop: 16, padding: "11px 12px", background: T.panelAlt, borderRadius: 10, border: `1px solid ${T.line}` }}>
        {ds.mode === "demo" ? (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textSub, marginBottom: 5 }}>{t("demoData")}</div>
            <div style={{ fontSize: 11, color: T.textFaint, lineHeight: 1.7 }}>
              {ws.students.length}名・{ws.tests.length}テスト・{subs.length}枚の答案で全機能を試せます。
              Supabase が未設定のため、変更はページを再読み込みすると元に戻ります。
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textSub, marginBottom: 3 }}>{session.school?.name}</div>
            <div style={{ fontSize: 11, color: T.textFaint, lineHeight: 1.7, wordBreak: "break-all" }}>
              {session.profile?.displayName || session.email}
              {session.profile?.role === "admin" ? "（管理者）" : ""}
            </div>
            <button onClick={async () => { await ds.signOut(); router.replace("/login"); }}
              style={{ marginTop: 7, border: "none", background: "transparent", padding: 0, color: T.accent, cursor: "pointer", font: `600 11.5px ${FONT_UI}` }}>
              ログアウト
            </button>
          </>
        )}
      </div>
    </nav>
  );

  if (!mobile) return body;
  return (
    <>
      {open && <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.5)", zIndex: 150 }} />}
      <div style={{
        position: "fixed", insetBlock: 0, insetInlineStart: 0, zIndex: 160,
        // 閉じているときは画面の外へ。RTL（アラビア語など）ではメニューが右側にあるので右へ逃がす
        transform: open ? "translateX(0)" : `translateX(${isRTL(lang) ? "105%" : "-105%"})`, transition: "transform .25s ease",
        boxShadow: open ? "0 0 40px rgba(0,0,0,.3)" : "none",
      }}>{body}</div>
    </>
  );
}
