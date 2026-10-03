/** Only unambiguous final answers; never copy a full explanation or a doubtful candidate. */
export function answerFromExplanation(model: string): string {
  const text = model.trim();
  if (!text || /不明|不確|推測|候補|読め|読み取|見切|不足|未確認|見当たら|かもしれ|生徒の|手書き/.test(text)) return "";
  const labelled = [...text.matchAll(/(?:^|\n)\s*(?:正答|答え|答|最終解答)\s*[:：]\s*([^\n]+)/g)];
  const candidate = labelled.length === 1 ? labelled[0][1].trim().replace(/[。.]$/, "") : text;
  // Plain numbers, expressions, choice symbols and units only. Prose stays in model.
  return candidate.length <= 150 && /^[0-9０-９a-zA-Zα-ωΑ-Ωπ√±＋+−\-*/÷×=＝<>≤≥≦≧^²³⁰¹⁴⁵⁶⁷⁸⁹₀-₉.,，、 ()（）{}\[\]／/％%°°㎝㎠㎤cm円分秒個本枚ア-オ\s]+$/.test(candidate) ? candidate : "";
}

export function fillAnswer<T extends {type: string; correct: string; model: string}>(row: T): T {
  if (row.type === "graph" || row.correct.trim()) return row;
  const correct = answerFromExplanation(row.model);
  return correct ? {...row, correct} : row;
}
