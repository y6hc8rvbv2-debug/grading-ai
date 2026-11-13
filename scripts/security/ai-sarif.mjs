// AI（Claude）のセキュリティ点検の結果を、GitHub の「Security → Code scanning」に載せる形（SARIF）に変える
// （2026-11-13。docs/SECURITY-12.md の 13。.github/workflows/security-ai.yml から呼ぶ）
//
// このリポジトリは公開なので、点検の中身は Actions のログ・まとめに出さない（誰でも読める）。
// Code scanning の警告は、書き込みの権限がある人だけが見られる。
//
//   node scripts/security/ai-sarif.mjs <Claude の実行記録（execution_file）> <出力する .sarif>
//   ログに出すのは件数だけ
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const SEVERITY = { critical: "error", high: "error", medium: "warning", low: "note" };
const SCORE = { critical: "9.5", high: "8.0", medium: "5.5", low: "3.0" };

// 実行記録（メッセージの配列）から、最後の structured_output を取り出す
export function extractFindings(execution) {
  const list = Array.isArray(execution) ? execution : [execution];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m && typeof m === "object" && m.type === "result" && m.structured_output) {
      const out = typeof m.structured_output === "string" ? JSON.parse(m.structured_output) : m.structured_output;
      return Array.isArray(out?.findings) ? out.findings : [];
    }
  }
  return null; // 結果が無い（途中で止まった）
}

// AI の出力はそのまま信じない：形・長さ・ファイルの場所を確かめ、合わないものは捨てる
export function cleanFinding(f, fileExists = existsSync) {
  if (!f || typeof f !== "object") return null;
  const file = String(f.file ?? "").replace(/^\.\//, "");
  if (!file || file.length > 300 || file.startsWith("/") || file.split("/").includes("..") || !fileExists(file)) return null;
  const severity = String(f.severity ?? "").toLowerCase();
  if (!(severity in SEVERITY)) return null;
  const line = Number.isInteger(f.line) && f.line > 0 && f.line < 1e6 ? f.line : 1;
  const text = (v, n) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").slice(0, n);
  const title = text(f.title, 200);
  if (!title) return null;
  const category = text(f.category, 60).toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "security";
  return { file, line, severity, category, title, description: text(f.description, 4000), recommendation: text(f.recommendation, 2000) };
}

export function toSarif(findings) {
  const rules = new Map();
  const results = findings.map((f) => {
    const ruleId = `claude-ai/${f.category}`;
    if (!rules.has(ruleId)) rules.set(ruleId, { id: ruleId, name: f.category, shortDescription: { text: `AI セキュリティ点検：${f.category}` }, properties: { tags: ["security", "ai"], "security-severity": SCORE[f.severity] } });
    return {
      ruleId,
      level: SEVERITY[f.severity],
      message: { text: `[${f.severity}] ${f.title}\n\n${f.description}${f.recommendation ? `\n\n直し方：${f.recommendation}` : ""}` },
      locations: [{ physicalLocation: { artifactLocation: { uri: f.file }, region: { startLine: f.line } } }],
      partialFingerprints: { primaryLocationLineHash: `${f.category}:${f.file}:${f.title}`.slice(0, 300) },
      properties: { "security-severity": SCORE[f.severity] },
    };
  });
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{ tool: { driver: { name: "Claude AI security review", informationUri: "https://docs.claude.com/", rules: [...rules.values()] } }, results }],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [execPath, outPath] = process.argv.slice(2);
  if (!execPath || !outPath) { console.error("使い方：node scripts/security/ai-sarif.mjs <execution_file> <out.sarif>"); process.exit(2); }
  const raw = existsSync(execPath) ? JSON.parse(readFileSync(execPath, "utf8")) : null;
  const found = raw ? extractFindings(raw) : null;
  if (found === null) { console.error("AI の点検の結果が見つかりませんでした（途中で止まった可能性）。"); process.exit(1); }
  const clean = found.map((f) => cleanFinding(f)).filter(Boolean);
  writeFileSync(outPath, JSON.stringify(toSarif(clean)));
  const by = (s) => clean.filter((f) => f.severity === s).length;
  // ログには件数だけ（中身は書かない）
  console.log(`AI の点検：${clean.length} 件（重大 ${by("critical")}・高 ${by("high")}・中 ${by("medium")}・低 ${by("low")}。形の合わない ${found.length - clean.length} 件は捨てた）`);
}
