// 指導案の書き出し（すべてブラウザの中で作るので、サーバーに内容を送らない）
import { download, esc, fmtDate, schoolLabel } from './util.js';

const safeName = (s) => String(s || '指導案').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
const list = (v) => (Array.isArray(v) ? v.join('、') : v || '');

export function planRows(p) {
  return [
    ['授業タイトル', p.title], ['指導者', p.instructorName], ['学校名', p.schoolName], ['実施日', p.lessonDate],
    ['校種・学年', `${schoolLabel(p.schoolType)} ${p.grade ? `${p.grade}年` : ''}`.trim()], ['教科', p.subject], ['単元', p.unit],
    ['単元のねらい', p.unitObjective], ['小単元', p.subUnit], ['本時のねらい', p.currentLessonObjective],
    ['次数／時間数', `${p.lessonNumber || 1}次／${p.teachingHours || 1}時間`], ['児童生徒数', p.studentCount ? `${p.studentCount}名` : ''],
    ['授業形態', list(p.classFormat)], ['指導理論', list(p.teachingTheory)], ['教材', list(p.materials)], ['教具', list(p.teachingTools)],
  ].filter(([, v]) => v);
}
const SECTIONS = [['introduction', '導入'], ['development', '展開'], ['conclusion', 'まとめ']];
const COLS = [['time', '時間'], ['activity', '学習活動'], ['teacherAction', '教師の働きかけ'], ['studentAction', '児童生徒の活動'], ['materials', '教材・教具'], ['notes', '留意点']];

export function planToMarkdown(p) {
  const c = p.generatedContent || {};
  const cell = (x) => String(x || '').replace(/\|/g, '｜').replace(/\n/g, ' ');
  return [
    `# ${p.title || '学習指導案'}`, '',
    ...planRows(p).slice(1).map(([k, v]) => `- **${k}**：${v}`), '',
    ...SECTIONS.flatMap(([k, l]) => [`## ${l}`, c[k] || '', '']),
    '## 学習過程', `| ${COLS.map((x) => x[1]).join(' | ')} |`, `|${COLS.map(() => '---').join('|')}|`,
    ...(c.detailedPlan || []).map((r) => `| ${COLS.map(([k]) => cell(r[k])).join(' | ')} |`), '',
    '## 評価規準', ...(c.evaluationCriteria || []).map((x) => `- ${x}`), '',
    '## 板書計画', c.boardPlan || '', '',
  ].join('\n');
}

export function planToHtml(p, { forPrint = false } = {}) {
  const c = p.generatedContent || {};
  const br = (s) => esc(s).replace(/\n/g, '<br>');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(p.title)}</title>
<style>
body{font-family:"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif;color:#111;max-width:900px;margin:24px auto;padding:0 20px;line-height:1.7;font-size:10.5pt}
h1{font-size:17pt;text-align:center;margin:0 0 4px}h2{font-size:12pt;border-left:5px solid #0f766e;padding-left:8px;margin:18px 0 6px}
.sub{text-align:center;color:#555;margin-bottom:14px}table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #888;padding:5px 7px;vertical-align:top;text-align:left}
th{background:#eef5f4;white-space:nowrap}.meta th{width:9em}@page{size:A4;margin:14mm}@media print{body{margin:0;max-width:none}h2{break-after:avoid}tr{break-inside:avoid}}
</style></head><body>
<h1>${esc(p.title || '学習指導案')}</h1><div class="sub">${esc([p.schoolName, p.instructorName && `指導者 ${p.instructorName}`, p.lessonDate && fmtDate(p.lessonDate)].filter(Boolean).join('　'))}</div>
<table class="meta">${planRows(p).slice(1).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${br(v)}</td></tr>`).join('')}</table>
${SECTIONS.map(([k, l]) => `<h2>${l}</h2><p>${br(c[k])}</p>`).join('')}
<h2>学習過程</h2><table><thead><tr>${COLS.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>
${(c.detailedPlan || []).map((r) => `<tr>${COLS.map(([k]) => `<td>${br(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>
<h2>評価規準</h2><ul>${(c.evaluationCriteria || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
<h2>板書計画</h2><p>${br(c.boardPlan)}</p>
${forPrint ? '<script>window.onload=()=>setTimeout(()=>print(),300)</script>' : ''}
</body></html>`;
}

export function printPlan(p) {
  const w = window.open('', '_blank');
  if (!w) throw new Error('ポップアップがブロックされました。ブラウザの設定で許可してください。');
  w.document.write(planToHtml(p, { forPrint: true })); w.document.close();
}
export function printHtml(title, bodyHtml) {
  const w = window.open('', '_blank');
  if (!w) throw new Error('ポップアップがブロックされました。');
  w.document.write(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:"Hiragino Sans","Yu Gothic",sans-serif;max-width:800px;margin:24px auto;padding:0 20px;line-height:1.8}table{border-collapse:collapse;width:100%}th,td{border:1px solid #888;padding:6px}th{background:#f1f1f1}</style></head><body>${bodyHtml}<script>window.onload=()=>setTimeout(()=>print(),300)</script></body></html>`);
  w.document.close();
}

async function toXlsx(p) {
  const XLSX = await import('xlsx');
  const c = p.generatedContent || {};
  const wb = XLSX.utils.book_new();
  const info = [['学習指導案'], [], ...planRows(p), [], ...SECTIONS.map(([k, l]) => [l, c[k] || '']), [], ['評価規準'], ...(c.evaluationCriteria || []).map((x) => ['', x]), [], ['板書計画', c.boardPlan || '']];
  const ws1 = XLSX.utils.aoa_to_sheet(info); ws1['!cols'] = [{ wch: 16 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, ws1, '概要');
  const ws2 = XLSX.utils.aoa_to_sheet([COLS.map((x) => x[1]), ...(c.detailedPlan || []).map((r) => COLS.map(([k]) => r[k] || ''))]);
  ws2['!cols'] = [{ wch: 10 }, { wch: 24 }, { wch: 36 }, { wch: 36 }, { wch: 18 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws2, '学習過程');
  return new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

async function toDocx(p) {
  const d = await import('docx');
  const c = p.generatedContent || {};
  const font = { ascii: 'Yu Mincho', eastAsia: 'Yu Mincho', hAnsi: 'Yu Mincho' };
  const para = (text, opts = {}) => new d.Paragraph({ children: [new d.TextRun({ text: String(text || ''), font, size: 21, ...opts })], spacing: { after: 80 } });
  const h = (text) => new d.Paragraph({ heading: d.HeadingLevel.HEADING_2, children: [new d.TextRun({ text, font, bold: true, size: 24 })], spacing: { before: 240, after: 80 } });
  const cellP = (t, bold) => new d.TableCell({ children: String(t || '').split('\n').map((x) => para(x, { size: 18, bold })), shading: bold ? { fill: 'EEF5F4', type: d.ShadingType.CLEAR, color: 'auto' } : undefined });
  const table = (rows) => new d.Table({ width: { size: 100, type: d.WidthType.PERCENTAGE }, rows: rows.map((r, i) => new d.TableRow({ children: r.map((x, j) => cellP(x, r.header ? true : j === 0 && r.meta)) })) });
  const metaRows = planRows(p).slice(1).map(([k, v]) => Object.assign([k, v], { meta: true }));
  const header = Object.assign(COLS.map((x) => x[1]), { header: true });
  const doc = new d.Document({ sections: [{ properties: { page: { size: { orientation: d.PageOrientation.PORTRAIT } } }, children: [
    new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ text: p.title || '学習指導案', font, bold: true, size: 32 })], spacing: { after: 120 } }),
    table(metaRows),
    ...SECTIONS.flatMap(([k, l]) => [h(l), ...String(c[k] || '').split('\n').map((x) => para(x))]),
    h('学習過程'), table([header, ...(c.detailedPlan || []).map((r) => COLS.map(([k]) => r[k]))]),
    h('評価規準'), ...(c.evaluationCriteria || []).map((x) => para(`・${x}`)),
    h('板書計画'), ...String(c.boardPlan || '').split('\n').map((x) => para(x)),
  ] }] });
  return d.Packer.toBlob(doc);
}

async function toPptx(p) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const c = p.generatedContent || {};
  const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE';
  const F = 'Yu Gothic'; const BRAND = '0F766E';
  const title = (s, t) => { s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.9, fill: { color: BRAND } }); s.addText(t, { x: 0.5, y: 0.12, w: 12.3, h: 0.66, fontFace: F, fontSize: 24, bold: true, color: 'FFFFFF' }); };
  let s = pptx.addSlide();
  s.background = { color: 'F5F2EC' };
  s.addText(p.title || '学習指導案', { x: 0.8, y: 2.3, w: 11.7, h: 1.4, fontFace: F, fontSize: 36, bold: true, color: '1D232C' });
  s.addText([schoolLabel(p.schoolType), p.grade && `${p.grade}年`, p.subject, p.unit].filter(Boolean).join('　'), { x: 0.8, y: 3.7, w: 11.7, h: 0.6, fontFace: F, fontSize: 18, color: BRAND });
  s.addText(p.currentLessonObjective ? `本時のねらい：${p.currentLessonObjective}` : '', { x: 0.8, y: 4.4, w: 11.7, h: 1, fontFace: F, fontSize: 16, color: '646C7A' });
  for (const [k, l] of SECTIONS) { s = pptx.addSlide(); title(s, l); s.addText(c[k] || '', { x: 0.6, y: 1.2, w: 12.1, h: 5.8, fontFace: F, fontSize: 18, valign: 'top', color: '1D232C', lineSpacingMultiple: 1.3 }); }
  const rows = c.detailedPlan || [];
  for (let i = 0; i < rows.length; i += 3) {
    s = pptx.addSlide(); title(s, `学習過程${rows.length > 3 ? `（${i / 3 + 1}）` : ''}`);
    s.addTable([COLS.slice(0, 5).map(([, l]) => ({ text: l, options: { bold: true, fill: { color: 'D8F0EC' } } })), ...rows.slice(i, i + 3).map((r) => COLS.slice(0, 5).map(([k]) => r[k] || ''))], { x: 0.4, y: 1.15, w: 12.5, colW: [1.3, 2.6, 3.4, 3.4, 1.8], fontFace: F, fontSize: 12, border: { type: 'solid', color: 'C8C3B8', pt: 0.75 }, valign: 'top' });
  }
  s = pptx.addSlide(); title(s, '評価規準');
  s.addText((c.evaluationCriteria || []).map((x) => ({ text: x, options: { bullet: true } })), { x: 0.6, y: 1.2, w: 12.1, h: 5.8, fontFace: F, fontSize: 18, valign: 'top', color: '1D232C' });
  s = pptx.addSlide(); title(s, '板書計画');
  s.addText(c.boardPlan || '', { x: 0.6, y: 1.2, w: 12.1, h: 5.8, fontFace: F, fontSize: 18, valign: 'top', color: '1D232C' });
  return pptx.write({ outputType: 'blob' });
}

async function toOdt(p) {
  const { default: JSZip } = await import('jszip');
  const c = p.generatedContent || {};
  const t = (s) => esc(s).replace(/\n/g, '<text:line-break/>');
  const P = (s, style = 'Standard') => `<text:p text:style-name="${style}">${t(s)}</text:p>`;
  const H = (s) => `<text:h text:style-name="H" text:outline-level="2">${t(s)}</text:h>`;
  const row = (cells) => `<table:table-row>${cells.map((x) => `<table:table-cell office:value-type="string">${P(x)}</table:table-cell>`).join('')}</table:table-row>`;
  const tbl = (name, n, rows) => `<table:table table:name="${name}"><table:table-column table:number-columns-repeated="${n}"/>${rows.map(row).join('')}</table:table>`;
  const body = [
    `<text:h text:style-name="T" text:outline-level="1">${t(p.title || '学習指導案')}</text:h>`,
    tbl('概要', 2, planRows(p).slice(1)),
    ...SECTIONS.flatMap(([k, l]) => [H(l), P(c[k])]),
    H('学習過程'), tbl('学習過程', 6, [COLS.map((x) => x[1]), ...(c.detailedPlan || []).map((r) => COLS.map(([k]) => r[k] || ''))]),
    H('評価規準'), ...(c.evaluationCriteria || []).map((x) => P(`・${x}`)), H('板書計画'), P(c.boardPlan),
  ].join('');
  const ns = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"';
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ns} office:version="1.2"><office:automatic-styles><style:style style:name="T" style:family="paragraph"><style:text-properties fo:font-size="18pt" fo:font-weight="bold"/></style:style><style:style style:name="H" style:family="paragraph"><style:text-properties fo:font-size="13pt" fo:font-weight="bold" fo:color="#0f766e"/></style:style></office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
  zip.file('content.xml', content);
  zip.file('META-INF/manifest.xml', '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>');
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.oasis.opendocument.text' });
}

export const FORMATS = [
  { id: 'docx', label: 'Word', ext: 'docx', make: toDocx },
  { id: 'xlsx', label: 'Excel', ext: 'xlsx', make: toXlsx },
  { id: 'pptx', label: 'PowerPoint', ext: 'pptx', make: toPptx },
  { id: 'odt', label: 'OpenDocument', ext: 'odt', make: toOdt },
  { id: 'html', label: 'HTML', ext: 'html', make: async (p) => new Blob([planToHtml(p)], { type: 'text/html;charset=utf-8' }) },
  { id: 'md', label: 'Markdown', ext: 'md', make: async (p) => new Blob([planToMarkdown(p)], { type: 'text/markdown;charset=utf-8' }) },
];

export async function exportPlan(p, id) {
  const f = FORMATS.find((x) => x.id === id);
  download(await f.make(p), `${safeName(p.title)}.${f.ext}`);
}

// 複数の指導案を、選んだ形式でまとめて ZIP に
export async function exportZip(plans, id = 'docx') {
  const { default: JSZip } = await import('jszip');
  const f = FORMATS.find((x) => x.id === id);
  const zip = new JSZip(); const used = new Set();
  for (const p of plans) {
    let name = safeName(p.title); let n = 2;
    while (used.has(name)) name = `${safeName(p.title)}_${n++}`;
    used.add(name);
    zip.file(`${name}.${f.ext}`, await f.make(p));
  }
  download(await zip.generateAsync({ type: 'blob' }), `指導案_${new Date().toISOString().slice(0, 10)}.zip`);
}

// カレンダーアプリに取り込めるファイル（.ics）
export function planToIcs(p, { start, minutes = 45 } = {}) {
  const s = new Date(start || p.lessonDate || Date.now());
  const e = new Date(s.getTime() + minutes * 60000);
  const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const txt = (x) => String(x || '').replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//jugyo-studio//JA', 'BEGIN:VEVENT', `UID:${p.id}@jugyo-studio`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(s)}`, `DTEND:${f(e)}`,
    `SUMMARY:${txt(`【授業】${p.title}`)}`, `DESCRIPTION:${txt(`${p.subject || ''} ${p.unit || ''}\n本時のねらい：${p.currentLessonObjective || ''}`)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}
export function googleCalendarLink(p, { start, minutes = 45 } = {}) {
  const s = new Date(start || p.lessonDate || Date.now()); const e = new Date(s.getTime() + minutes * 60000);
  const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const q = new URLSearchParams({ action: 'TEMPLATE', text: `【授業】${p.title}`, dates: `${f(s)}/${f(e)}`, details: `${p.subject || ''} ${p.unit || ''}\n本時のねらい：${p.currentLessonObjective || ''}` });
  return `https://calendar.google.com/calendar/render?${q}`;
}

export { safeName };
