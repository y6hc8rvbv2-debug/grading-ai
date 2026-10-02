"use client";
// テストの登録フォーム（テスト情報 + 設問ごとの大問・小問・形式・単元・配点・正答）。
// Supabase では tests / questions に保存される。
//
// 「模範解答・配点表から自動入力」：模範解答（画像・PDF・HEIC、複数ページ可）と、必要なら問題用紙・配点表・
// 生徒の答案（印刷された配点だけを読む）を選ぶと、AI が設問の一覧を読み取って入力欄を作る（/api/test-import）。
// 読み取れなかった配点・正答は空欄のまま「要確認」にし、教師が確認・修正してから「登録する」で保存する。
// 入力途中の内容（資料のファイルを含む）は、この端末に下書きとして自動保存する（lib/draft.ts）。
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FONT_MONO } from "@/lib/ui/theme";
import { QTYPES } from "@/lib/grading/engine";
import { friendlyError } from "@/lib/errors";
import { prepareImage, isHeic } from "@/lib/image";
import { deleteDraft, loadDraft, saveDraft } from "@/lib/draft";
import { draftToFile, fileToDraft } from "@/lib/draft-file";
import { useUI } from "@/components/ui-context";
import { Badge, Btn, Field, Input, Modal, Select, grid, inputStyle } from "@/components/ui";
import type { FigureRef, ImportBox, ImportResult, NewTestInput, QType } from "@/lib/types";

type Kind = "key" | "paper" | "student";
const KIND_LABEL: Record<Kind, string> = {
  key: "模範解答",
  paper: "問題用紙・配点表",
  student: "生徒の答案（配点の印刷だけ参照）",
};

type Row = {
  key: number;
  big: number;
  sub: string;
  type: QType;
  unit: string;
  points: number | "";          // "" = 未入力（要確認）
  pointsHint?: number | null;
  difficulty: string;
  correct: string;
  model: string;
  flags: string[];              // 要確認の理由（自動入力）
  confirmed: boolean;           // 教師が確認したか
  answerBox?: Ref;              // 元画像での正答の位置
  figure?: Ref;                 // 作図の模範図の位置
};
/** 元の資料の中の位置。資料は id で指す（資料を削除しても、ほかの設問の参照がずれない） */
type Ref = { sourceId: string; page: number; x: number; y: number; w: number; h: number } | null;
type Source = { id: string; name: string; kind: Kind; type: string; blob: Blob; path?: string; requestId?: string };
type Draft = {
  v: 1 | 2; savedAt: string;
  name: string; subject: string; grade: string; term: string; date: string; testNo: string; unitsText: string;
  rows: Row[]; sources: Source[];
  imported: { importId: string; maxScore: number | null; warnings: string[]; requestId: string } | null;
};

const DRAFT_KEY = "new-test";
const DIFFICULTIES = ["基本", "標準", "難"];
const MAX_SOURCES = 12;
const defaultPoints = (t: QType) => (t === "long" ? 8 : t === "short" || t === "graph" ? 6 : 4);
let rowKey = 0;
const blankRow = (o: Partial<Row> = {}): Row => ({
  key: ++rowKey, big: 1, sub: "(1)", type: "calc", unit: "", points: defaultPoints(o.type ?? "calc"),
  difficulty: "標準", correct: "", model: "", flags: [], confirmed: true, ...o,
});
/** 次の小問表記：(1) → (2)、① → ②。分からなければ空 */
function nextSub(sub: string) {
  const m = sub.match(/^(\D*)(\d+)(\D*)$/);
  if (m) return `${m[1]}${Number(m[2]) + 1}${m[3]}`;
  const circled = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
  const i = circled.indexOf(sub);
  return i >= 0 && i < circled.length - 1 ? circled[i + 1] : "";
}
export const labelOf = (big: number, sub: string) => (sub ? `大問${big}-${sub}` : `大問${big}`);
const uid = () => Math.random().toString(36).slice(2, 10);

export default function NewTestForm({ open, onClose, initialFiles, onCreated, draftKey = DRAFT_KEY }: {
  open: boolean; onClose: () => void; initialFiles?: File[];
  onCreated?: (id: string) => void; draftKey?: string;
}) {
  const { T, ds, toast, refresh, ai } = useUI();
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("数学");
  const [grade, setGrade] = useState("2");
  const [term, setTerm] = useState("1学期");
  const [date, setDate] = useState("");
  const [testNo, setTestNo] = useState("");
  const [unitsText, setUnitsText] = useState("");
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [bulk, setBulk] = useState("5");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // 自動入力
  const [importOpen, setImportOpen] = useState(!!initialFiles);
  const [sources, setSources] = useState<Source[]>(() => (initialFiles ?? []).map(f => ({
    id: uid(), name: f.name, kind: "student", type: f.type, blob: f,
  })));
  const [imported, setImported] = useState<Draft["imported"]>(null);
  const [importing, setImporting] = useState<"" | "upload" | "read">("");
  const [force, setForce] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [view, setView] = useState<{ source: string; box: Ref } | null>(null);
  // 元画像の表示・非表示（端末に覚える）。切り替えても資料・入力・確認状態は変わらない
  const [imagesOn, setImagesOnState] = useState(true);
  const setImagesOn = (v: boolean) => {
    setImagesOnState(v);
    try { window.localStorage.setItem("saiten.testFormImages", v ? "1" : "0"); } catch { /* 保存できない環境では覚えない */ }
  };
  useEffect(() => {
    try { if (window.localStorage.getItem("saiten.testFormImages") === "0") setImagesOnState(false); } catch { /* 無視 */ }
  }, []);
  // 横に並べられる幅があるか（狭いときは画像を上、設問を下に分ける）
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const el = bodyRef.current;
    if (!open || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => setWide((entries[0]?.contentRect.width ?? 0) >= 900));
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);
  const lock = useRef(false);

  // 下書き
  const [draftNote, setDraftNote] = useState("");
  const restored = useRef(false);
  const [draftReady, setDraftReady] = useState(false);

  const units = unitsText.split(/[,、，\n]/).map((u) => u.trim()).filter(Boolean);
  const total = rows.reduce((a, r) => a + (Number(r.points) || 0), 0);
  const flagged = rows.filter((r) => r.flags.length);
  const unconfirmed = flagged.filter((r) => !r.confirmed);
  const maxScore = imported?.maxScore ?? null;
  const mismatch = maxScore != null && total !== maxScore;
  const bigs = useMemo(() => {
    const m = new Map<number, number>();
    rows.forEach((r) => m.set(r.big, (m.get(r.big) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [rows]);

  // 資料の表示用 URL（Blob から作る。下書きから復元したときも作り直す）
  const urls = useMemo(() => new Map(sources.map((s) => [s.id, URL.createObjectURL(s.blob)])), [sources]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  /* ---------------------------------------------------- 下書きの復元・保存 */
  useEffect(() => {
    if (!open || restored.current) return;
    restored.current = true;
    loadDraft<Draft>(draftKey).then((d) => {
      if (d && (d.v === 1 || d.v === 2) && (!initialFiles || window.confirm("新規採点の作成途中の下書きがあります。復元しますか？キャンセルなら今回の答案で新しく作ります。"))) applyDraft(d, `下書きを復元しました（${new Date(d.savedAt).toLocaleString("ja-JP")} に自動保存）`);
    }).finally(() => setDraftReady(true));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 下書きを入力欄に戻す（端末の自動保存・ファイルの読み込みで共通。AI は呼ばない） */
  function applyDraft(d: Draft, note: string) {
    setName(d.name ?? ""); setSubject(d.subject ?? "数学"); setGrade(d.grade ?? "2"); setTerm(d.term ?? ""); setDate(d.date ?? "");
    setTestNo(d.testNo ?? ""); setUnitsText(d.unitsText ?? "");
    const srcs = d.sources ?? [];
    // 以前の下書き（v1）は資料を「何番目か」で指していたので、資料の id に置き換える
    const fromLegacy = (b: unknown): Ref => {
      if (!b || typeof b !== "object") return null;
      const o = b as Record<string, number | string>;
      if ("sourceId" in o) return srcs.some((x) => x.id === o.sourceId) ? (o as unknown as Ref) : null;
      const src = srcs[Number(o.file) - 1];
      return src ? { sourceId: src.id, page: Number(o.page) || 1, x: Number(o.x), y: Number(o.y), w: Number(o.w), h: Number(o.h) } : null;
    };
    setRows(d.rows?.length
      ? d.rows.map((r) => ({ ...r, key: ++rowKey, answerBox: fromLegacy(r.answerBox), figure: fromLegacy(r.figure) }))
      : [blankRow()]);
    setSources(srcs);
    setImported(d.imported ?? null);
    setImportOpen(srcs.length > 0);
    setView(null); setSelected(null); setError("");
    setDraftNote(note);
  }

  /* ---------------------------------------------------- 下書きの書き出し・読み込み（別の URL・端末へ移す） */
  const [moving, setMoving] = useState(false);
  const [openImports, setOpenImports] = useState<Awaited<ReturnType<typeof ds.listOpenImports>> | null>(null);
  const exportDraft = async () => {
    const blob = await draftToFile(snapshot() as unknown as Parameters<typeof draftToFile>[0]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `test-draft-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`下書きを書き出しました（資料 ${sources.length} 件・設問 ${rows.length} 問）。生徒の答案の画像を含む場合があるので、読み込んだ後は削除してください`);
  };
  const importDraftFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const d = fileToDraft(await file.text()) as unknown as Draft;
      const n = (d.rows ?? []).length;
      if (dirty && !window.confirm(`いま入力中の内容を、ファイルの下書き（資料 ${d.sources.length} 件・設問 ${n} 問）で置き換えますか？`)) return;
      applyDraft(d, `ファイルから下書きを読み込みました（資料 ${d.sources.length} 件・設問 ${n} 問。AI は呼んでいません）`);
      await saveDraft(draftKey, { ...d, v: 2, savedAt: new Date().toISOString() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "下書きのファイルを読み込めませんでした。");
    }
  };
  // 予備：端末の下書きが無くても、サーバーに残っている AI の読み取り結果（未登録のもの）から再開できる。AI は呼ばない
  const showOpenImports = async () => setOpenImports(await ds.listOpenImports());
  const resumeImport = async (imp: NonNullable<typeof openImports>[number]) => {
    if (dirty && !window.confirm("いま入力中の内容を、この読み取り結果で置き換えますか？（読み取り後に手で直した内容は含まれません）")) return;
    setMoving(true);
    try {
      const placed: Source[] = [];
      for (const f of imp.files) {
        const blob = await ds.downloadImportFile(f.path);
        const type = blob.type || (f.path.endsWith(".pdf") ? "application/pdf" : f.path.endsWith(".png") ? "image/png" : "image/jpeg");
        placed.push({ id: uid(), name: f.name, kind: f.kind, type, blob, path: f.path, requestId: imp.requestId });
      }
      setSources(placed);
      setImportOpen(true);
      applyImport(imp.result, { importId: imp.id, requestId: imp.requestId }, placed);
      setDraftNote(`以前のAI読み取り結果から再開しました（${new Date(imp.createdAt).toLocaleString("ja-JP")}・資料 ${placed.length} 件。AI は呼んでいません）。読み取り後に手で直した内容は含まれないので、確認してください`);
      setOpenImports(null);
    } catch (e) {
      setError(friendlyError(e, "読み取り結果の読み込み"));
    } finally {
      setMoving(false);
    }
  };

  const snapshot = useCallback((): Draft => ({
    v: 2, savedAt: new Date().toISOString(), name, subject, grade, term, date, testNo, unitsText, rows, sources, imported,
  }), [name, subject, grade, term, date, testNo, unitsText, rows, sources, imported]);
  const dirty = !!(name || testNo || unitsText || sources.length || rows.length > 1 || rows[0]?.correct || rows[0]?.model);
  useEffect(() => {
    if (!open || !draftReady || !dirty) return;
    const t = setTimeout(() => { saveDraft(draftKey, snapshot()); }, 500);
    return () => clearTimeout(t);
  }, [open, dirty, snapshot, draftKey, draftReady]);

  const discardDraft = async () => {
    if (!window.confirm("下書きを破棄して、入力欄を空にしますか？")) return;
    await deleteDraft(draftKey);
    reset();
    toast("下書きを破棄しました");
  };

  /* ---------------------------------------------------- 設問の操作 */
  const update = (key: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const reset = () => {
    setName(""); setTestNo(""); setDate(""); setUnitsText(""); setRows([blankRow()]); setError("");
    setSources([]); setImported(null); setImportOpen(false); setSelected(null); setView(null); setDraftNote("");
  };

  const addRows = (n: number, newBig = false) => {
    setRows((prev) => {
      const out = [...prev];
      for (let i = 0; i < n; i++) {
        const last = out[out.length - 1];
        out.push(blankRow(last
          ? newBig && i === 0
            ? { big: last.big + 1, sub: "(1)", unit: last.unit, type: last.type, points: defaultPoints(last.type) }
            : { big: last.big, sub: nextSub(last.sub), unit: last.unit, type: last.type, points: defaultPoints(last.type) }
          : {}));
      }
      return out;
    });
  };

  /* ---------------------------------------------------- 資料の追加 */
  const addSources = async (list: FileList | null, kind: Kind) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    if (sources.length + files.length > MAX_SOURCES) { toast(`資料は${MAX_SOURCES}ファイルまでです`, "warn"); return; }
    const out: Source[] = [];
    for (const f of files) {
      // HEIC は JPEG に変換し、大きな写真は縮小する（PDF はそのまま）
      const p = /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name) ? f : await prepareImage(f);
      if (isHeic(p)) { toast(`「${f.name}」を変換できませんでした。JPEG で保存し直して選んでください`, "warn"); continue; }
      out.push({ id: uid(), name: f.name, kind, type: p.type || (/\.pdf$/i.test(f.name) ? "application/pdf" : "image/jpeg"), blob: p });
    }
    setSources((prev) => [...prev, ...out]);
    if (out.length && !view) setView({ source: out[0].id, box: null });
  };

  /* ---------------------------------------------------- AI で読み取る */
  const [generateKey, setGenerateKey] = useState(!!initialFiles);
  const runImport = async () => {
    if (lock.current) return;
    if (!generateKey && !sources.some((s) => s.kind === "key")) { toast("模範解答の画像またはPDFを選んでください", "warn"); return; }
    const hasContent = rows.some((r) => r.correct || r.model) || rows.length > 1;
    if (hasContent && !window.confirm("入力済みの設問を、AIの読み取り結果で置き換えます。よろしいですか？（いまの内容は下書きから消えます）")) return;
    lock.current = true;
    setError("");
    try {
      // 資料を学校専用の保管場所に置く（同じ資料・同じ読み取りなら置き直さない）
      setImporting("upload");
      const requestId = crypto.randomUUID();
      const placed: Source[] = [];
      for (let i = 0; i < sources.length; i++) {
        const s = sources[i];
        if (s.path && s.requestId === requestId) { placed.push(s); continue; }
        const ext = s.type === "application/pdf" ? "pdf" : s.type === "image/png" ? "png" : "jpg";
        const file = new File([s.blob], `${i + 1}.${ext}`, { type: s.type });
        placed.push({ ...s, path: await ds.uploadImportFile(requestId, i, file), requestId });
      }
      setSources(placed);
      setImporting("read");
      const r = await ds.importTestKey({
        requestId, force, generate: generateKey, files: placed.map((s) => ({ path: s.path!, kind: s.kind, name: s.name })),
      });
      applyImport(r.result, { importId: r.importId, requestId }, placed);
      setForce(false);
      toast(r.cached
        ? "同じ資料の読み取り結果を使いました（AI は呼んでいません）。要確認の設問を確認してください"
        : `${r.result.questions.length} 問を読み取りました。要確認の設問を確認してから登録してください`);
    } catch (e) {
      // 失敗しても、選んだ資料と入力欄は下書きに残る
      setError(friendlyError(e, "模範解答の読み取り"));
    } finally {
      setImporting("");
      lock.current = false;
    }
  };

  const applyImport = (res: ImportResult, meta: { importId: string; requestId: string }, placed: Source[]) => {
    const toRef = (b: ImportBox): Ref => {
      const src = b ? placed[b.file - 1] : null;
      return b && src ? { sourceId: src.id, page: b.page, x: b.x, y: b.y, w: b.w, h: b.h } : null;
    };
    setRows(res.questions.map((q) => blankRow({
      big: q.big, sub: q.sub, type: q.type, unit: "", points: q.points ?? "", pointsHint: q.pointsHint,
      correct: q.correct, model: q.model, flags: q.flags, confirmed: q.flags.length === 0,
      answerBox: toRef(q.answerBox), figure: toRef(q.figure),
    })));
    if (!name && res.title) setName(res.title);
    if (res.subject) setSubject((s) => s || res.subject);
    setImported({ importId: meta.importId, maxScore: res.maxScore, warnings: res.warnings, requestId: meta.requestId });
    setSelected(null);
  };

  const showBox = (ref: Ref | undefined) => {
    if (!ref || !sources.some((s) => s.id === ref.sourceId)) return;
    setView({ source: ref.sourceId, box: ref });
    setImagesOn(true);
  };
  const sourceNo = (id: string) => sources.findIndex((s) => s.id === id) + 1;

  /* ---------------------------------------------------- 資料の削除 */
  const deleteSource = (id: string) => {
    const s = sources.find((x) => x.id === id);
    if (!s) return;
    const no = sourceNo(id);
    const figRows = rows.filter((r) => r.figure?.sourceId === id);
    const ansRows = rows.filter((r) => r.answerBox?.sourceId === id && r.figure?.sourceId !== id);
    const keysLeft = sources.filter((x) => x.id !== id && x.kind === "key").length;
    const lines = [`「${s.name}」（資料${no}・${KIND_LABEL[s.kind]}）を削除しますか？`, "入力済みの設問は削除しません。"];
    if (figRows.length) {
      lines.push(`この資料は ${figRows.map((r) => labelOf(r.big, r.sub)).join("・")} の模範図の参照元です。削除すると模範図の参照が外れ、その設問は「要確認」に戻ります（採点条件の文章は残ります）。`);
    }
    if (ansRows.length) lines.push(`${ansRows.length} 問で、元画像の該当箇所を表示できなくなります（入力内容は残ります）。`);
    if (s.kind === "key" && !keysLeft) lines.push("模範解答が無くなるため、AIでもう一度読み取ることはできなくなります。");
    if (!window.confirm(lines.join("\n\n"))) return;

    setRows((prev) => prev.map((r) => {
      const fig = r.figure?.sourceId === id;
      const ans = r.answerBox?.sourceId === id;
      if (!fig && !ans) return r;
      return {
        ...r,
        answerBox: ans ? null : r.answerBox,
        figure: fig ? null : r.figure,
        ...(fig ? {
          flags: [...r.flags.filter((f) => !f.startsWith("模範図の参照元")), `模範図の参照元の資料「${s.name}」を削除しました。模範図を確認できる資料を追加するか、採点条件の文章で確認してください`],
          confirmed: false,
        } : {}),
      };
    }));
    // 資料の組み合わせが変わったので、次に読み取るときは新しい読み取りとして扱う（入力済みの設問はそのまま）
    setSources((prev) => prev.filter((x) => x.id !== id).map((x) => ({ ...x, requestId: undefined })));
    if (view?.source === id) setView(null);
    if (s.path) ds.removeImportFiles([s.path]).catch(() => {});
    toast(`「${s.name}」を削除しました（設問の入力は残っています）`);
  };

  /* ---------------------------------------------------- 登録 */
  const validate = (): string => {
    if (!name.trim()) return "テスト名を入力してください。";
    if (!subject.trim()) return "教科を入力してください。";
    const g = Number(grade);
    if (!Number.isInteger(g) || g < 1 || g > 12) return "学年は1〜12の数字で入力してください。";
    if (!rows.length) return "設問を1問以上追加してください。";
    const badBig = rows.find((r) => !Number.isInteger(Number(r.big)) || Number(r.big) < 1 || Number(r.big) > 99);
    if (badBig) return "大問の番号は1〜99の整数にしてください。";
    const dup = rows.find((r, i) => rows.findIndex((x) => x.big === r.big && x.sub.trim() === r.sub.trim()) !== i);
    if (dup) return `${labelOf(dup.big, dup.sub)} が2つあります。大問・小問の番号を直してください。`;
    const noPoints = rows.find((r) => r.points === "" || !Number.isInteger(Number(r.points)) || Number(r.points) < 1 || Number(r.points) > 100);
    if (noPoints) return `${labelOf(noPoints.big, noPoints.sub)} の配点を入力してください（1〜100の整数）。`;
    const graphNoCriteria = rows.find((r) => r.type === "graph" && !r.model.trim());
    if (graphNoCriteria) return `${labelOf(graphNoCriteria.big, graphNoCriteria.sub)}（作図）の採点条件を入力してください。`;
    if (unconfirmed.length) return `要確認の設問が ${unconfirmed.length} 問あります。内容を確認して「確認した」にチェックしてください。`;
    if (units.length) {
      const badUnit = rows.find((r) => r.unit && !units.includes(r.unit));
      if (badUnit) return `${labelOf(badUnit.big, badUnit.sub)} の単元「${badUnit.unit}」が単元の一覧にありません。`;
    }
    return "";
  };

  const save = async () => {
    const msg = validate();
    if (msg) { setError(msg); return; }
    if (mismatch && !window.confirm(`設問の合計点（${total}点）が、原本の満点（${maxScore}点）と一致しません。このまま登録しますか？`)) return;
    setError(""); setSaving(true);
    try {
      const keep = sources.filter((s) => s.path && s.kind !== "student");
      const figureOf = (b?: Ref): FigureRef | null => {
        const s = b ? sources.find((x) => x.id === b.sourceId) : null;
        return b && s?.path && s.kind !== "student" ? { path: s.path, page: b.page, x: b.x, y: b.y, w: b.w, h: b.h } : null;
      };
      const input: NewTestInput = {
        name: name.trim(), subject: subject.trim(), grade: Number(grade), term: term.trim(),
        date, testNo: testNo.trim(), units,
        questions: rows.map((r) => ({
          big: Number(r.big), sub: r.sub.trim(),
          type: r.type, unit: r.unit || units[0] || "", points: Number(r.points),
          correct: r.correct.trim(), model: r.model.trim(), difficulty: r.difficulty,
          figure: r.type === "graph" ? figureOf(r.figure) : null,
        })),
        answerKeyPaths: keep.map((s) => s.path!),
      };
      const testId = await ds.createTest(input);
      // 生徒の答案は、配点を読むためだけに使った。テストには残さない
      await ds.removeImportFiles(sources.filter((s) => s.path && s.kind === "student").map((s) => s.path!)).catch(() => {});
      if (imported?.importId) await ds.linkImport(imported.importId, testId).catch(() => {});
      await deleteDraft(draftKey);
      await refresh();
      toast(`「${name.trim()}」を登録しました（${rows.length} 問・${total} 点）。新規採点で選べます`);
      reset();
      onCreated?.(testId);
      onClose();
    } catch (e) {
      setError(friendlyError(e, "テストの登録"));
    } finally {
      setSaving(false);
    }
  };

  const cell: React.CSSProperties = { ...inputStyle(T), padding: "6px 8px", fontSize: 12.5 };
  const current = view ? sources.find((s) => s.id === view.source) : null;
  const showViewer = sources.length > 0;
  const viewerOn = showViewer && imagesOn;

  return (
    <Modal open={open} onClose={() => { if (!saving) onClose(); }} title={onCreated ? "新規採点：模範解答・配点を準備" : "テストを追加"} width={viewerOn ? 1320 : 1100}
      footer={<>
        <span style={{ flex: 1, fontSize: 12.5, color: error ? T.ng : T.textSub, alignSelf: "center" }} role={error ? "alert" : undefined}>
          {error || `${rows.length} 問・合計 ${total} 点${maxScore != null ? `（原本の満点 ${maxScore} 点）` : ""}`}
        </span>
        {showViewer && (
          <Btn onClick={() => setImagesOn(!imagesOn)} title="資料・入力内容・確認状態はそのまま残ります（AIは再実行しません）">
            <span aria-hidden="true">{imagesOn ? "🙈 " : "🖼 "}</span>{imagesOn ? "画像を隠す" : "画像を表示"}
          </Btn>
        )}
        <Btn onClick={onClose} disabled={saving}>閉じる（下書きは残ります）</Btn>
        <Btn variant="primary" onClick={save} disabled={saving || !!importing}>{saving ? "登録しています…" : onCreated ? "登録して採点を始める" : "登録する"}</Btn>
      </>}>
      {onCreated && <p>答案の印刷された問題と配点から解答案を作成します。生徒の手書き回答を正答には使いません。模範解答がある場合は追加して「模範解答がない」のチェックを外してください。読み取り後、正答・配点を確認して登録してください。</p>}
      {draftNote && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 11px", borderRadius: 9, background: T.infoSoft, color: T.info, fontSize: 12.5, marginBottom: 10 }}>
          <span style={{ flex: 1 }}>{draftNote}</span>
          <Btn size="sm" variant="ghost" onClick={discardDraft}>下書きを破棄</Btn>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10, fontSize: 12, color: T.textSub }}>
        <span>下書き：</span>
        <Btn size="sm" onClick={exportDraft} disabled={!dirty || !!importing}>下書きを書き出す（ファイル）</Btn>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <span style={{ border: `1px solid ${T.line}`, borderRadius: 8, padding: "4px 10px", background: T.panel, color: T.text }}>下書きを読み込む（ファイル）</span>
          <input type="file" accept="application/json,.json" aria-label="下書きを読み込む" style={{ display: "none" }}
            onChange={(e) => { importDraftFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {ds.mode === "supabase" && <Btn size="sm" variant="ghost" onClick={showOpenImports} disabled={moving}>以前のAI読み取り結果から再開</Btn>}
        <span style={{ fontSize: 11, color: T.textFaint }}>別の URL・端末へ移すときに使います（AI は呼びません）</span>
      </div>
      {openImports && (
        <div style={{ border: `1px solid ${T.line}`, borderRadius: 9, padding: 10, marginBottom: 10, background: T.panelAlt, fontSize: 12.5 }}>
          {openImports.length === 0 ? (
            <div>まだテストに登録していない読み取り結果はありません。</div>
          ) : openImports.map((imp) => (
            <div key={imp.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "4px 0" }}>
              <span style={{ flex: 1, minWidth: 220 }}>
                {new Date(imp.createdAt).toLocaleString("ja-JP")}　資料 {imp.files.length} 件・設問 {imp.result?.questions?.length ?? 0} 問
                {imp.result?.title ? `（${imp.result.title}）` : ""}
              </span>
              <Btn size="sm" onClick={() => resumeImport(imp)} disabled={moving}>{moving ? "読み込んでいます…" : "この結果で再開"}</Btn>
            </div>
          ))}
          <div style={{ fontSize: 11, color: T.textFaint, marginTop: 4 }}>読み取り後に手で直した配点・確認済みの印などは含まれません。手で直した内容も移すときは「下書きを書き出す／読み込む」を使ってください。</div>
          <Btn size="sm" variant="ghost" onClick={() => setOpenImports(null)}>閉じる</Btn>
        </div>
      )}
      <div style={grid(200, 12)}>
        <Field label="テスト名（必須）"><Input value={name} onChange={setName} placeholder="例：1学期期末テスト" /></Field>
        <Field label="教科（必須）"><Input value={subject} onChange={setSubject} placeholder="例：数学" /></Field>
        <Field label="学年"><Input value={grade} onChange={setGrade} type="number" /></Field>
        <Field label="学期"><Input value={term} onChange={setTerm} placeholder="例：1学期" /></Field>
        <Field label="実施日"><Input value={date} onChange={setDate} type="date" /></Field>
        <Field label="試験番号"><Input value={testNo} onChange={setTestNo} placeholder="例：M-2026-05" /></Field>
      </div>
      <Field label="単元（読点・カンマ区切り）" hint="弱点分析は単元ごとに集計します。例：式の計算、連立方程式、一次関数">
        <Input value={unitsText} onChange={setUnitsText} placeholder="式の計算、連立方程式、一次関数" />
      </Field>

      {/* ------------------------------------------------ 自動入力 */}
      <div style={{ border: `1px solid ${importOpen ? T.accent : T.line}`, borderRadius: 11, padding: 12, margin: "4px 0 12px", background: importOpen ? T.accentSoft : T.panelAlt }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 240, fontSize: 12.5, color: T.textSub, lineHeight: 1.7 }}>
            <b style={{ color: T.text }}>模範解答・配点表から自動入力</b>　模範解答の写真やPDFから、大問・小問・形式・正答・配点・解説の要点をAIが読み取ります。
          </div>
          {!importOpen && (
            <Btn variant="primary" size="sm" onClick={() => setImportOpen(true)} disabled={!ai.enabled}
              title={ai.enabled ? "" : "採点AIが設定されていないため使えません"}>模範解答・配点表から自動入力</Btn>
          )}
        </div>
        {!ai.enabled && (
          <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 6 }}>
            {ds.mode === "demo" ? "デモモードでは使えません。" : "採点AI（ANTHROPIC_API_KEY）が設定されていないため使えません。"}手入力で登録できます。
          </div>
        )}
        {importOpen && (
          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            <label><input type="checkbox" checked={generateKey} disabled={!!importing} onChange={e => setGenerateKey(e.target.checked)} /> 模範解答がない：問題用紙・生徒答案の印刷された問題から解答案を作る（登録前に教師が確認）</label>
            <div style={grid(260, 10)}>
              <label style={{ fontSize: 12, color: T.text }}>
                <b>1. 模範解答（なしの場合は下のチェック）</b>
                <div style={{ fontSize: 11, color: T.textSub, margin: "2px 0 6px" }}>画像・PDF・iPhone の写真（HEIC）。複数ページは複数選べます</div>
                <input id="import-key" type="file" multiple accept="image/*,.heic,.heif,application/pdf" disabled={!!importing}
                  onChange={(e) => { addSources(e.target.files, "key"); e.target.value = ""; }} />
              </label>
              <label style={{ fontSize: 12, color: T.text }}>
                <b>2. 配点が模範解答に無い場合（任意）</b>
                <div style={{ fontSize: 11, color: T.textSub, margin: "2px 0 6px" }}>問題用紙・配点表の画像を追加できます。生徒の答案を使う場合は、下で種類を「生徒の答案」にしてください</div>
                <input id="import-extra" type="file" multiple accept="image/*,.heic,.heif,application/pdf" disabled={!!importing}
                  onChange={(e) => { addSources(e.target.files, "paper"); e.target.value = ""; }} />
              </label>
            </div>
            {sources.length > 0 && (
              <div style={{ display: "grid", gap: 6 }}>
                {sources.map((s, i) => (
                  <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
                    <span style={{ font: `700 11px ${FONT_MONO}`, color: T.textSub, width: 46 }}>資料{i + 1}</span>
                    <button type="button" onClick={() => setView({ source: s.id, box: null })}
                      style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", font: "inherit", textDecoration: "underline", padding: 0 }}>{s.name}</button>
                    <select aria-label={`資料${i + 1}の種類`} value={s.kind} disabled={!!importing}
                      onChange={(e) => setSources((prev) => prev.map((x) => (x.id === s.id ? { ...x, kind: e.target.value as Kind, path: undefined } : x)))}
                      style={{ ...cell, width: "auto", padding: "3px 6px" }}>
                      {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                    </select>
                    <button type="button" disabled={!!importing} onClick={() => deleteSource(s.id)} aria-label={`「${s.name}」を削除`}
                      style={{ display: "inline-flex", gap: 4, alignItems: "center", border: `1px solid ${T.ng}`, background: T.ngSoft, color: T.ng,
                        borderRadius: 7, padding: "3px 9px", cursor: importing ? "not-allowed" : "pointer", font: "inherit", fontSize: 12 }}>
                      <span aria-hidden="true">🗑</span>削除
                    </button>
                  </div>
                ))}
                <div style={{ fontSize: 11, color: T.textFaint, lineHeight: 1.7 }}>
                  模範解答なしモードでは印刷された問題文から解答案を作ります。生徒の手書きは正答の根拠に使いません。問題文がない場合は問題用紙を追加してください。
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Btn variant="primary" onClick={runImport} disabled={!!importing || !sources.length || (!generateKey && !sources.some((s) => s.kind === "key"))}>
                {importing === "upload" ? "資料を保存しています…" : importing === "read" ? "AIが読み取っています…（1〜3分）" : "AIで読み取って入力する"}
              </Btn>
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11.5, color: T.textSub }}>
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} disabled={!!importing} />
                同じ資料でも、もう一度AIに読み取らせる（料金がかかります）
              </label>
            </div>
            {imported?.warnings.length ? (
              <div style={{ fontSize: 12, color: T.warn, lineHeight: 1.7 }}>
                {imported.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* ------------------------------------------------ 集計 */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }} aria-label="設問の集計">
        <Badge tone="info">設問 {rows.length} 問</Badge>
        <Badge tone={mismatch ? "ng" : "ok"}>合計 {total} 点</Badge>
        {maxScore != null && <Badge tone={mismatch ? "ng" : "ok"}>原本の満点 {maxScore} 点</Badge>}
        <span style={{ fontSize: 11.5, color: T.textSub }}>大問ごとの小問数：{bigs.map(([b, n]) => `大問${b}=${n}`).join("・")}</span>
        {flagged.length > 0 && <Badge tone={unconfirmed.length ? "warn" : "ok"}>要確認 {flagged.length} 問（未確認 {unconfirmed.length}）</Badge>}
      </div>
      {mismatch && (
        <div role="status" style={{ fontSize: 12, color: T.ng, marginBottom: 8 }}>
          合計点 {total} 点が、原本の満点 {maxScore} 点と一致しません。配点を確認してください。
        </div>
      )}

      {/* 元画像と設問欄は、重ならないように別々の枠に分ける。
          広いときは左右（画像の枠は自分の中でスクロール）、狭いとき（スマホ・縮小表示の狭い窓）は上下。
          画像を隠すと、設問欄が横幅いっぱいになる。 */}
      <div ref={bodyRef} data-layout={viewerOn ? (wide ? "side" : "stack") : "full"} style={{
        display: "grid", gap: 14, alignItems: "start",
        gridTemplateColumns: viewerOn && wide ? "minmax(280px, 2fr) minmax(0, 3fr)" : "minmax(0, 1fr)",
      }}>
        {/* ------------------------------------------------ 元画像（見比べ用） */}
        {viewerOn && (
          <div aria-label="元の資料の表示" data-testid="source-viewer" style={{
            minWidth: 0, maxHeight: wide ? "68vh" : "45vh", overflow: "auto",
            position: wide ? "sticky" : "static", top: 0, zIndex: 0,
            border: `1px solid ${T.line}`, borderRadius: 10, background: T.panel, padding: 8,
          }}>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6, alignItems: "center" }}>
              {sources.map((s, i) => (
                <Btn key={s.id} size="sm" variant={current?.id === s.id ? "primary" : "default"} onClick={() => setView({ source: s.id, box: null })}>
                  資料{i + 1}
                </Btn>
              ))}
            </div>
            {!current && <div style={{ fontSize: 12, color: T.textSub, padding: 8 }}>上の「資料1」などを押すと、元の資料を表示します。</div>}
            {current && (
              <div style={{ border: `1px solid ${T.line}`, borderRadius: 9, overflow: "hidden", background: T.bgAlt }}>
                <div style={{ fontSize: 11, color: T.textSub, padding: "4px 8px" }}>
                  {KIND_LABEL[current.kind]}・{current.name}{view?.box ? `（${view.box.page} ページ目の該当箇所を枠で表示）` : ""}
                </div>
                {current.type === "application/pdf" ? (
                  <object data={`${urls.get(current.id)}#page=${view?.box?.page ?? 1}`} type="application/pdf" aria-label="元の資料（PDF）"
                    style={{ width: "100%", height: wide ? 520 : 360 }}>PDF を表示できません。</object>
                ) : (
                  <div style={{ position: "relative", overflow: "hidden" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={urls.get(current.id)} alt={`元の資料：${current.name}`} style={{ width: "100%", display: "block" }} />
                    {view?.box && (
                      <div aria-label="該当箇所" style={{
                        position: "absolute", left: `${view.box.x * 100}%`, top: `${view.box.y * 100}%`,
                        width: `${view.box.w * 100}%`, height: `${view.box.h * 100}%`,
                        border: `3px solid ${T.shu}`, borderRadius: 4, background: "rgba(200,52,43,.08)",
                      }} />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------------ 設問 */}
        <div data-testid="question-editor" style={{ minWidth: 0, position: "relative", zIndex: 1, background: T.panel }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "0 0 10px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, flex: 1 }}>設問</div>
            <input type="number" min={1} max={40} value={bulk} onChange={(e) => setBulk(e.target.value)} aria-label="まとめて追加する問題数"
              style={{ ...cell, width: 64 }} />
            <Btn size="sm" onClick={() => addRows(Math.min(40, Math.max(1, Number(bulk) || 1)))}>問まとめて追加</Btn>
            <Btn size="sm" variant="soft" onClick={() => addRows(1)}>＋ 小問を追加</Btn>
            <Btn size="sm" variant="soft" onClick={() => addRows(1, true)}>＋ 大問を追加</Btn>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900, fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: T.textSub, fontSize: 11 }}>
                  {["大問", "小問", "形式", "単元", "配点", "難易度", "正答", "模範解答・解説の要点（作図は採点条件）", ""].map((h) => (
                    <th key={h} style={{ textAlign: "start", padding: "6px 5px", borderBottom: `1px solid ${T.lineStrong}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const lbl = labelOf(r.big, r.sub);
                  const warn = r.flags.length > 0 && !r.confirmed;
                  return (
                    <React.Fragment key={r.key}>
                      <tr onClick={() => { setSelected(r.key); showBox(r.type === "graph" ? r.figure ?? r.answerBox : r.answerBox); }}
                        style={{ background: warn ? T.warnSoft : selected === r.key ? T.accentSoft : "transparent" }}>
                        <td style={{ padding: 4, width: 58 }}>
                          <input type="number" min={1} max={99} value={r.big} aria-label={`${lbl} の大問番号`}
                            onChange={(e) => update(r.key, { big: Number(e.target.value) })} style={{ ...cell, textAlign: "center" }} />
                        </td>
                        <td style={{ padding: 4, width: 64 }}>
                          <input value={r.sub} aria-label={`${lbl} の小問`} placeholder="なし"
                            onChange={(e) => update(r.key, { sub: e.target.value })} style={{ ...cell, textAlign: "center" }} />
                        </td>
                        <td style={{ padding: 4, width: 112 }}>
                          <Select value={r.type} style={cell}
                            onChange={(v: string) => update(r.key, { type: v as QType, ...(r.flags.length ? {} : { points: defaultPoints(v as QType) }) })}
                            options={QTYPES.map((q) => ({ value: q.k, label: q.label }))} />
                        </td>
                        <td style={{ padding: 4, width: 120 }}>
                          {units.length ? (
                            <Select value={r.unit} style={cell} onChange={(v: string) => update(r.key, { unit: v })}
                              options={[{ value: "", label: "（選ぶ）" }, ...units.map((u) => ({ value: u, label: u }))]} />
                          ) : (
                            <input value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })} placeholder="単元" style={cell} />
                          )}
                        </td>
                        <td style={{ padding: 4, width: 72 }}>
                          <input type="number" min={1} max={100} value={r.points} aria-label={`${lbl} の配点`}
                            placeholder={r.pointsHint ? `候補${r.pointsHint}` : "要確認"}
                            onChange={(e) => update(r.key, { points: e.target.value === "" ? "" : Number(e.target.value) })}
                            style={{ ...cell, textAlign: "center", borderColor: r.points === "" ? T.warn : undefined }} />
                        </td>
                        <td style={{ padding: 4, width: 82 }}>
                          <Select value={r.difficulty} style={cell} onChange={(v: string) => update(r.key, { difficulty: v })}
                            options={DIFFICULTIES.map((d) => ({ value: d, label: d }))} />
                        </td>
                        <td style={{ padding: 4 }}>
                          <input value={r.correct} onChange={(e) => update(r.key, { correct: e.target.value })} aria-label={`${lbl} の正答`}
                            placeholder={r.type === "graph" ? "（作図：右の採点条件）" : r.type === "choice" ? "ア" : r.type === "long" || r.type === "short" ? "（記述）" : "正答"}
                            disabled={r.type === "graph"} style={cell} />
                        </td>
                        <td style={{ padding: 4 }}>
                          <textarea value={r.model} onChange={(e) => update(r.key, { model: e.target.value })} aria-label={`${lbl} の解説`} rows={r.type === "graph" ? 3 : 1}
                            placeholder={r.type === "graph" ? "採点条件（例：角の二等分線の作図の跡が残っている）" : "採点の要点・解き方"}
                            style={{ ...cell, resize: "vertical", minHeight: 30 }} />
                        </td>
                        <td style={{ padding: 4, width: 36 }}>
                          <Btn size="sm" variant="ghost" onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                            disabled={rows.length <= 1} title="この設問を削除">✕</Btn>
                        </td>
                      </tr>
                      {(r.flags.length > 0 || r.type === "graph") && (
                        <tr style={{ background: warn ? T.warnSoft : "transparent" }}>
                          <td colSpan={9} style={{ padding: "0 8px 8px 8px", fontSize: 11.5, color: T.text }}>
                            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                              {r.flags.length > 0 && <Badge tone={r.confirmed ? "ok" : "warn"}>{r.confirmed ? "確認済み" : "要確認"}</Badge>}
                              <ul style={{ margin: 0, paddingInlineStart: 16, flex: 1, minWidth: 240, lineHeight: 1.7 }}>
                                {r.flags.map((f, i) => <li key={i}>{f}</li>)}
                                {r.type === "graph" && (
                                  <li>
                                    模範図：{r.figure && sourceNo(r.figure.sourceId) > 0
                                      ? <button type="button" onClick={(e) => { e.stopPropagation(); showBox(r.figure); }}
                                          style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", font: "inherit", textDecoration: "underline", padding: 0 }}>
                                          資料{sourceNo(r.figure.sourceId)} の {r.figure.page} ページ目を表示
                                        </button>
                                      : "未設定（元画像で模範図の場所を確認し、採点条件に書いてください）"}
                                  </li>
                                )}
                              </ul>
                              {r.flags.length > 0 && (
                                <label style={{ display: "flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
                                  <input type="checkbox" checked={r.confirmed} aria-label={`${lbl} を確認した`}
                                    onChange={(e) => update(r.key, { confirmed: e.target.checked })} />
                                  確認した
                                </label>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 10, lineHeight: 1.7 }}>
            大問・小問は原本どおりに入力してください（小問が無い大問は小問を空欄に）。設問名は「大問1-(1)」のように作ります。
            正答と解説の要点は、採点AIが判定するときの基準になります。作図の問題は、模範図を確認したうえで採点条件を書いてください。
          </div>
        </div>
      </div>
    </Modal>
  );
}
