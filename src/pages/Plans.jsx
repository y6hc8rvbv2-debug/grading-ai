import { useMemo, useState } from 'react';
import { Files, Search, Star, FilePlus2, Trash2, Archive, LayoutGrid, List, Copy, CalendarDays, Tag, MessageCircle } from 'lucide-react';
import { useStore, db } from '../lib/store.js';
import { href, navigate } from '../lib/router.js';
import { exportZip, FORMATS } from '../lib/exporters.js';
import { fmtDate, schoolLabel, cx } from '../lib/util.js';
import { SCHOOL_TYPES } from '../lib/options.js';
import { Button, Card, Input, Select, PageHeader, Empty, Badge, toast, confirmDialog } from '../ui.jsx';

const SORTS = [['updated', '更新が新しい順'], ['created', '作成が新しい順'], ['date', '実施日順'], ['title', 'タイトル順']];

export function PlanList() {
  const s = useStore();
  const [q, setQ] = useState('');
  const [school, setSchool] = useState('');
  const [subject, setSubject] = useState('');
  const [tag, setTag] = useState('');
  const [fav, setFav] = useState(false);
  const [sort, setSort] = useState('updated');
  const [view, setView] = useState(() => localStorage.getItem('js-view') || 'grid');
  const [sel, setSel] = useState([]);
  const [fmt, setFmt] = useState('docx');

  const subjects = [...new Set(s.plans.map((p) => p.subject).filter(Boolean))];
  const tags = [...new Set(s.plans.flatMap((p) => p.tags || []))];
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    const out = s.plans.filter((p) => (!k || [p.title, p.subject, p.unit, p.currentLessonObjective, p.unitObjective, ...(p.tags || []), JSON.stringify(p.generatedContent || {})].join(' ').toLowerCase().includes(k))
      && (!school || p.schoolType === school) && (!subject || p.subject === subject) && (!tag || (p.tags || []).includes(tag)) && (!fav || p.bookmarked));
    const by = { updated: (a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt), created: (a, b) => b.createdAt.localeCompare(a.createdAt), date: (a, b) => (a.lessonDate || '9').localeCompare(b.lessonDate || '9'), title: (a, b) => (a.title || '').localeCompare(b.title || '', 'ja') }[sort];
    return out.sort(by);
  }, [s.plans, q, school, subject, tag, fav, sort]);

  const toggle = (id) => setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const setV = (v) => { setView(v); try { localStorage.setItem('js-view', v); } catch { /* 無視 */ } };
  const bulkDelete = async () => {
    if (!(await confirmDialog(`${sel.length}件の指導案と、ひも付く記録をすべて削除します。元に戻せません。`, { ok: '削除する', danger: true }))) return;
    sel.forEach((id) => db.removePlan(id)); setSel([]); toast('削除しました');
  };
  const bulkZip = async () => { try { await exportZip(s.plans.filter((p) => sel.includes(p.id)), fmt); } catch (e) { toast(e.message, 'bad'); } };

  return (
    <div>
      <PageHeader icon={Files} title="指導案一覧" desc={`${s.plans.length}件の指導案`} actions={<Button icon={FilePlus2} onClick={() => navigate('/create')}>新しい指導案</Button>} />
      <Card className="p-3 sm:p-4 mb-4">
        <div className="flex flex-col lg:flex-row gap-2">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-mute" /><Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="タイトル・単元・本文・タグで検索" aria-label="検索" /></div>
          <div className="grid grid-cols-2 sm:flex gap-2">
            <Select className="sm:w-32" value={school} onChange={(e) => setSchool(e.target.value)} options={SCHOOL_TYPES} placeholder="校種" />
            <Select className="sm:w-32" value={subject} onChange={(e) => setSubject(e.target.value)} options={subjects} placeholder="教科" />
            {tags.length > 0 && <Select className="sm:w-32" value={tag} onChange={(e) => setTag(e.target.value)} options={tags} placeholder="タグ" />}
            <Select className="sm:w-40" value={sort} onChange={(e) => setSort(e.target.value)} options={SORTS.map(([value, label]) => ({ value, label }))} />
          </div>
          <div className="flex gap-1">
            <Button variant={fav ? 'soft' : 'outline'} icon={Star} onClick={() => setFav(!fav)} aria-pressed={fav}>お気に入り</Button>
            <Button variant="outline" aria-label="カード表示" onClick={() => setV('grid')} className={cx('px-3', view === 'grid' && 'bg-sunken')}><LayoutGrid className="size-4" /></Button>
            <Button variant="outline" aria-label="リスト表示" onClick={() => setV('list')} className={cx('px-3', view === 'list' && 'bg-sunken')}><List className="size-4" /></Button>
          </div>
        </div>
      </Card>

      {sel.length > 0 && (
        <div className="sticky top-[72px] z-20 mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-ink text-bg px-4 py-2.5 shadow-lg">
          <span className="text-sm font-bold">{sel.length}件を選択中</span>
          <span className="flex-1" />
          <select value={fmt} onChange={(e) => setFmt(e.target.value)} className="h-8 rounded-lg bg-bg text-ink text-sm px-2">{FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select>
          <Button size="sm" variant="soft" icon={Archive} onClick={bulkZip}>ZIPで書き出し</Button>
          <Button size="sm" variant="danger" icon={Trash2} onClick={bulkDelete}>削除</Button>
          <Button size="sm" variant="ghost" className="text-bg hover:bg-white/10" onClick={() => setSel([])}>解除</Button>
        </div>
      )}

      {list.length === 0 ? (
        <Card><Empty icon={Files} title={s.plans.length ? '条件に合う指導案がありません' : 'まだ指導案がありません'} desc={s.plans.length ? '検索条件を変えてみてください。' : '「新しい指導案」から作成できます。'} action={!s.plans.length && <Button icon={FilePlus2} onClick={() => navigate('/create')}>指導案をつくる</Button>} /></Card>
      ) : view === 'grid' ? (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.map((p) => <PlanCard key={p.id} p={p} selected={sel.includes(p.id)} onSelect={() => toggle(p.id)} counts={countFor(s, p.id)} />)}
        </div>
      ) : (
        <Card className="divide-y divide-line">
          {list.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3">
              <input type="checkbox" checked={sel.includes(p.id)} onChange={() => toggle(p.id)} className="size-4 accent-[var(--brand)]" aria-label="選択" />
              <a href={href(`/plans/${p.id}`)} className="min-w-0 flex-1 hover:text-brand"><span className="block font-medium truncate">{p.bookmarked && <Star className="inline size-3.5 fill-warn text-warn mr-1 -mt-0.5" />}{p.title}</span><span className="block text-xs text-mute truncate">{[schoolLabel(p.schoolType), p.grade && `${p.grade}年`, p.subject, p.unit].filter(Boolean).join('・')}</span></a>
              <span className="hidden sm:block text-xs text-mute w-24 text-right">{p.lessonDate ? fmtDate(p.lessonDate) : '—'}</span>
              <span className="text-xs text-mute w-24 text-right">{fmtDate(p.updatedAt || p.createdAt)}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

const countFor = (s, id) => ({ notes: s.notes.filter((x) => x.planId === id).length, evals: s.evaluations.filter((x) => x.planId === id).length, comments: s.plans.find((p) => p.id === id)?.comments?.length || 0 });

function PlanCard({ p, selected, onSelect, counts }) {
  return (
    <Card className={cx('group relative p-5 flex flex-col transition hover:shadow-lg hover:shadow-black/5 hover:-translate-y-0.5', selected && 'ring-2 ring-brand')}>
      <div className="flex items-start gap-2 mb-3">
        <Badge tone="brand">{p.subject || '教科未設定'}</Badge>
        {p.demo && <Badge tone="warn">見本</Badge>}
        <span className="flex-1" />
        <button aria-label="お気に入り" onClick={() => db.update('plans', p.id, { bookmarked: !p.bookmarked })} className="text-mute hover:text-warn"><Star className={cx('size-[18px]', p.bookmarked && 'fill-warn text-warn')} /></button>
        <input type="checkbox" checked={selected} onChange={onSelect} className="size-4 mt-0.5 accent-[var(--brand)]" aria-label="選択" />
      </div>
      <a href={href(`/plans/${p.id}`)} className="flex-1"><h3 className="font-bold leading-snug line-clamp-2 group-hover:text-brand">{p.title}</h3>
        <p className="text-sm text-mute mt-1 line-clamp-2">{p.currentLessonObjective || p.unit}</p></a>
      {(p.tags || []).length > 0 && <div className="flex flex-wrap gap-1 mt-3">{p.tags.map((t) => <Badge key={t}><Tag className="size-3" />{t}</Badge>)}</div>}
      <div className="flex items-center gap-3 text-xs text-mute mt-4 pt-3 border-t border-line">
        <span>{[schoolLabel(p.schoolType), p.grade && `${p.grade}年`].filter(Boolean).join(' ')}</span>
        {p.lessonDate && <span className="flex items-center gap-1"><CalendarDays className="size-3" />{fmtDate(p.lessonDate)}</span>}
        <span className="flex-1" />
        {counts.comments > 0 && <span className="flex items-center gap-0.5"><MessageCircle className="size-3" />{counts.comments}</span>}
        <button className="flex items-center gap-1 hover:text-brand" onClick={() => navigate(`/create?copy=${p.id}`)} title="条件を複製して新規作成"><Copy className="size-3" />複製</button>
      </div>
    </Card>
  );
}
