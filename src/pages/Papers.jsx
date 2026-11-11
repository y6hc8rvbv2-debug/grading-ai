import { useState } from 'react';
import { BookOpen, Search, Sparkles, Bookmark, BookmarkCheck, ExternalLink, FileText, Printer } from 'lucide-react';
import { useStore, db } from '../lib/store.js';
import { runAi } from '../lib/ai.js';
import { esc } from '../lib/util.js';
import { printHtml } from '../lib/exporters.js';
import { Button, Card, Input, Select, PageHeader, Empty, Badge, Notice, Modal, Tabs, AiProgress, toast, DemoNote } from '../ui.jsx';

const CONF = { high: ['確度 高', 'good'], medium: ['確度 中', 'warn'], low: ['要確認', 'bad'] };
const REPORT = [['introduction', '1. 研究の背景と目的'], ['literature', '2. 関連する研究の流れ'], ['methodology', '3. 研究のアプローチ'], ['results', '4. 主な知見'], ['discussion', '5. 教育的意義と授業への活かし方'], ['conclusion', '6. まとめと留意点']];

export default function Papers() {
  const s = useStore();
  const [tab, setTab] = useState('search');
  const [q, setQ] = useState('');
  const [planId, setPlanId] = useState('');
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState('');
  const [res, setRes] = useState(null);
  const [report, setReport] = useState(null);

  const search = async () => {
    const plan = s.plans.find((p) => p.id === planId);
    if (!q.trim() && !plan) { toast('キーワードを入力するか、指導案を選んでください', 'bad'); return; }
    setBusy(true); setStream(''); setRes(null);
    try {
      const payload = q.trim() ? { query: q.trim() } : { subject: plan.subject, grade: plan.grade, unit: plan.unit, objective: plan.currentLessonObjective };
      const { result, demo } = await runAi('papers', payload, { onText: setStream });
      setRes({ papers: result.papers || [], demo });
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  const saved = (p) => s.papers.find((x) => x.title === p.title);
  const toggle = (p) => { const x = saved(p); if (x) db.remove('papers', x.id); else { db.add('papers', p); toast('保存しました。指導案の作成時に「授業に生かす研究」として選べます'); } };

  return (
    <div>
      <PageHeader icon={BookOpen} title="教育論文" desc="授業に関連する研究を探し、指導案づくりに生かす" />
      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[{ id: 'search', label: '探す', icon: Search }, { id: 'saved', label: '保存した研究', icon: Bookmark, count: s.papers.length }]} />
      {tab === 'search' && (<>
        <Card className="p-4 mb-4">
          <div className="flex flex-col md:flex-row gap-2">
            <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-mute" /><Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="例：協同学習 算数 小学校" /></div>
            <Select className="md:w-72" value={planId} onChange={(e) => setPlanId(e.target.value)} options={s.plans.map((p) => ({ value: p.id, label: p.title }))} placeholder="または指導案から探す" />
            <Button icon={Sparkles} loading={busy} onClick={search}>AIで探す</Button>
          </div>
        </Card>
        <Notice tone="warn" className="mb-4">AIが知識から挙げた研究です。書誌情報は誤りを含むことがあるため、引用する前に必ず「原典を確認」から実在と内容をご確認ください。</Notice>
        {busy && <AiProgress text={stream} label="関連する研究を探しています" />}
        {res && <DemoNote show={res.demo} />}
        {res && <div className="space-y-3">{res.papers.map((p, i) => <PaperCard key={i} p={p} saved={Boolean(saved(p))} onSave={() => toggle(p)} onReport={() => setReport({ paper: p })} />)}</div>}
        {!busy && !res && <Card><Empty icon={BookOpen} title="キーワードか指導案を選んで探しましょう" desc="見つかった研究は保存して、指導案を作る時にAIへ「授業に生かす研究」として渡せます。" /></Card>}
      </>)}
      {tab === 'saved' && (s.papers.length === 0 ? <Card><Empty icon={Bookmark} title="保存した研究はありません" /></Card> : <div className="space-y-3">{s.papers.map((p) => <PaperCard key={p.id} p={p} saved onSave={() => db.remove('papers', p.id)} onReport={() => setReport({ paper: p })} />)}</div>)}
      <ReportModal state={report} onClose={() => setReport(null)} />
    </div>
  );
}

function PaperCard({ p, saved, onSave, onReport }) {
  const c = CONF[p.confidence] || CONF.medium;
  const scholar = `https://scholar.google.com/scholar?q=${encodeURIComponent(`${p.title} ${p.authors || ''}`)}`;
  const cinii = `https://cir.nii.ac.jp/all?q=${encodeURIComponent(p.title)}`;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-1.5 mb-2"><Badge tone={c[1]}>{c[0]}</Badge>{p.relevance && <Badge tone="brand">関連度 {p.relevance}</Badge>}{p.country && <Badge>{p.country}</Badge>}{p.year && <Badge>{p.year}</Badge>}</div>
      <h3 className="font-bold leading-snug">{p.title}</h3>
      <p className="text-sm text-mute mt-0.5">{[p.authors, p.journal].filter(Boolean).join('／')}</p>
      <p className="text-sm mt-3 leading-relaxed">{p.abstract}</p>
      {p.summary && <p className="text-sm mt-2 leading-relaxed rounded-xl bg-brand-soft/50 p-3"><strong className="text-brand-strong">授業への示唆：</strong>{p.summary}</p>}
      <div className="flex flex-wrap gap-2 mt-4">
        <Button size="sm" variant={saved ? 'soft' : 'outline'} icon={saved ? BookmarkCheck : Bookmark} onClick={onSave}>{saved ? '保存済み' : '保存'}</Button>
        <Button size="sm" variant="outline" icon={FileText} onClick={onReport}>解説レポート</Button>
        <a href={scholar} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm border border-line hover:border-brand"><ExternalLink className="size-3.5" />原典を確認（Scholar）</a>
        <a href={cinii} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm border border-line hover:border-brand"><ExternalLink className="size-3.5" />CiNii</a>
      </div>
    </Card>
  );
}

function ReportModal({ state, onClose }) {
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState('');
  const [r, setR] = useState(null);
  const p = state?.paper;
  const make = async () => { setBusy(true); setStream(''); try { const { result, demo } = await runAi('paperReport', p, { onText: setStream }); setR({ ...result, demo }); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  const close = () => { setR(null); onClose(); };
  if (!p) return null;
  return (
    <Modal open onClose={close} title="解説レポート" wide footer={r && <Button variant="outline" icon={Printer} onClick={() => { try { printHtml(p.title, `<h1>${esc(p.title)}</h1><p>${esc(p.authors || '')}</p><p><em>AIによる解説です。原論文の全文ではありません。</em></p>${REPORT.map(([k, l]) => `<h2>${l}</h2><p>${esc(r[k])}</p>`).join('')}`); } catch (e) { toast(e.message, 'bad'); } }}>印刷</Button>}>
      <h3 className="font-bold text-lg">{p.title}</h3><p className="text-sm text-mute mb-4">{p.authors}</p>
      <Notice tone="warn" className="mb-4">AIの知識に基づく解説で、原論文の全文ではありません。数値や引用は原典でご確認ください。</Notice>
      {!r && !busy && <Button icon={Sparkles} onClick={make}>レポートを作成</Button>}
      {busy && <AiProgress text={stream} label="解説レポートを作成しています" />}
      {r && <div><DemoNote show={r.demo} />{REPORT.map(([k, l]) => <section key={k} className="mb-4"><h4 className="font-bold text-brand-strong mb-1">{l}</h4><p className="prose-ja text-[0.95rem]">{r[k]}</p></section>)}{(r.references || []).length > 0 && <section><h4 className="font-bold text-brand-strong mb-1">原典確認の手がかり</h4><ul className="list-disc pl-5 text-sm">{r.references.map((x, i) => <li key={i}>{x}</li>)}</ul></section>}</div>}
    </Modal>
  );
}

