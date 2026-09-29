"use client";
// 画面全体で共有する状態（テーマ・言語・ログイン情報・マスタ・答案・操作）。
// 実体は components/AppShell.tsx の Provider が作る。
import { createContext, useContext } from "react";
import type { Theme } from "@/lib/ui/theme";
import type { DataSource, SessionInfo } from "@/lib/data/source";
import type {
  AiGradeSummary, AiStatus, ClassRoom, Item, ItemPatch, Rubric, Student, Submission, Test, Workspace,
} from "@/lib/types";

export type View =
  | "dashboard" | "new" | "history" | "processing" | "tests" | "model" | "rubric"
  | "students" | "classes" | "scores" | "weakness" | "reports" | "review" | "settings" | "detail" | "compare";

export type DisplayMode = "class" | "exam" | "initials" | "anon";

export type UIContext = {
  T: Theme;
  t: (key: string) => string;
  lang: string;
  setLang: (l: string) => void;
  mode: "light" | "dark";
  setMode: (m: "light" | "dark") => void;
  mobile: boolean;

  view: View;
  go: (v: View, param?: string | null) => void;
  toast: (msg: string, tone?: "ok" | "warn" | "ng") => void;

  ds: DataSource;
  session: SessionInfo;
  isAdmin: boolean;
  ws: Workspace;
  subs: Submission[];
  studentById: (id: string) => Student | undefined;
  classById: (id: string) => ClassRoom | undefined;
  testById: (id: string) => Test | undefined;
  /** 設定に合わせた生徒の表示名（実名は存在しない） */
  who: (studentId: string) => string;

  rubric: Rubric;
  setRubric: (r: Rubric) => void;

  /** 採点AIの利用可否（サーバーに ANTHROPIC_API_KEY があるか） */
  ai: AiStatus;
  /** 保存済みの答案を AI で採点する。成功したら答案を読み直す。
   *  silent でなければ結果をトーストで知らせる。失敗しても例外にせず、理由を返す。 */
  aiGradeSub: (submissionId: string, opts?: { silent?: boolean }) =>
    Promise<{ ok: true; summary: AiGradeSummary } | { ok: false; error: string }>;

  anonMode: boolean;
  setAnonMode: (v: boolean) => void;
  display: DisplayMode;
  setDisplay: (v: DisplayMode) => void;
  answerLang: string;
  setAnswerLang: (v: string) => void;
  studentLang: string;
  setStudentLang: (v: string) => void;
  favs: string[];
  toggleFav: (k: string) => void;

  /** マスタと答案を読み直す */
  refresh: () => Promise<void>;
  /** 答案1枚を読み直す（修正後の合計点・状態を取り込む） */
  refreshSub: (id: string) => Promise<void>;
  /** 1問を修正する。失敗したら画面を元に戻してトーストで知らせる。 */
  editItem: (submissionId: string, item: Item, patch: ItemPatch) => Promise<boolean>;
  /** 答案を確認済みにする */
  reviewSub: (submissionId: string) => Promise<boolean>;
};

export const Ctx = createContext<UIContext | null>(null);

export function useUI(): UIContext {
  const v = useContext(Ctx);
  if (!v) throw new Error("useUI は AppShell の内側で使ってください");
  return v;
}
