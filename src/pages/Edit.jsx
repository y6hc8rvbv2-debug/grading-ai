// 指導案の直接編集（プレビューを見ながら全項目を書き換え）
import { useState } from 'react';
import { Save, ArrowLeft, Plus, Trash2, ArrowUp, ArrowDown, Printer, Eye, PenLine } from 'lucide-react';
import { useStore, db } from '../lib/store.js';
import { navigate, href } from '../lib/router.js';
import { printPlan } from '../lib/exporters.js';
import { Button, Card, Field, Input, Textarea, toast, Empty, confirmDialog, Tabs } from '../ui.jsx';
import { PlanBody } from './PlanView.jsx';

const ROW = { time: '', activity: '', teacherAction: '', studentAction: '', materials: '', notes: '' };

export default function PlanEdit({ id }) {
  const plan = useStore((s) => s.plans.find((p) => p.id === id));
  const [c, setC] = useState(() => structuredClone(plan?.generatedContent || {}));
  const [meta, setMeta] = useState(() => ({ title: plan?.title || '', unit: plan?.unit || '', currentLessonObjective: plan?.currentLessonObjective || '', lessonDate: plan?.lessonDate || '', instructorName: plan?.instructorName || '', schoolName: plan?.schoolName || '' }));
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState('edit');
  if (!plan) return <Card><Empty title="指導案が見つかりません" /></Card>;

  const setField = (k, v) => { setC((x) => ({ ...x, [k]: v })); setDirty(true); };
  const rows = c.detailedPlan || [];
  const setRow = (i, k, v) => setField('detailedPlan', rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const move = (i, d) => { const r = [...rows]; [r[i], r[i + d]] = [r[i + d], r[i]]; setField('detailedPlan', r); };
  const crit = c.evaluationCriteria || [];
  const save = (manual = true) => {
    db.update('plans', id, { ...meta, generatedContent: c });
    if (manual) db.add('versions', { planId: id, label: `手動で編集（${new Date().toLocaleString('ja-JP')}）`, content: c, reason: '編集画面で保存' });
    setDirty(false); toast('保存しました');
  };
  const back = async () => { if (!dirty || (await confirmDialog('保存していない変更があります。破棄して戻りますか？', { ok: '破棄して戻る', danger: true }))) navigate(`/plans/${id}`); };

  return (
    <div>
      <div className="sticky top-16 z-20 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3 mb-5 bg-bg/90 backdrop-blur border-b border-line flex flex-wrap items-center gap-2">
        <Button variant="ghost" icon={ArrowLeft} onClick={back}>戻る</Button>
        <h1 className="font-bold truncate flex-1 min-w-0">編集：{meta.title}</h1>
        {dirty && <span className="text-xs text-warn">未保存の変更</span>}
        <Button variant="outline" icon={Printer} onClick={() => { try { printPlan({ ...plan, ...meta, generatedContent: c }); } catch (e) { toast(e.message, 'bad'); } }}>印刷</Button>
        <Button icon={Save} onClick={() => save()} disabled={!dirty}>保存</Button>
      </div>
      <Tabs className="mb-5 lg:hidden" value={mode} onChange={setMode} tabs={[{ id: 'edit', label: '編集', icon: PenLine }, { id: 'preview', label: 'プレビュー', icon: Eye }]} />
      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <div className={mode === 'edit' ? 'space-y-5' : 'hidden lg:block space-y-5'}>
          <Card className="p-5 grid sm:grid-cols-2 gap-4">
            <Field label="授業タイトル" className="sm:col-span-2"><Input value={meta.title} onChange={(e) => { setMeta({ ...meta, title: e.target.value }); setDirty(true); }} /></Field>
            <Field label="単元"><Input value={meta.unit} onChange={(e) => { setMeta({ ...meta, unit: e.target.value }); setDirty(true); }} /></Field>
            <Field label="実施日"><Input type="date" value={meta.lessonDate} onChange={(e) => { setMeta({ ...meta, lessonDate: e.target.value }); setDirty(true); }} /></Field>
            <Field label="指導者名"><Input value={meta.instructorName} onChange={(e) => { setMeta({ ...meta, instructorName: e.target.value }); setDirty(true); }} /></Field>
            <Field label="学校名"><Input value={meta.schoolName} onChange={(e) => { setMeta({ ...meta, schoolName: e.target.value }); setDirty(true); }} /></Field>
            <Field label="本時のねらい" className="sm:col-span-2"><Textarea rows={2} value={meta.currentLessonObjective} onChange={(e) => { setMeta({ ...meta, currentLessonObjective: e.target.value }); setDirty(true); }} /></Field>
          </Card>
          <Card className="p-5 space-y-4">
            {[['introduction', '導入'], ['development', '展開'], ['conclusion', 'まとめ']].map(([k, l]) => <Field key={k} label={l}><Textarea rows={k === 'development' ? 6 : 4} value={c[k] || ''} onChange={(e) => setField(k, e.target.value)} /></Field>)}
          </Card>
          <Card className="p-5">
            <div className="flex items-center mb-3"><h3 className="font-bold flex-1">学習過程</h3><Button size="sm" variant="soft" icon={Plus} onClick={() => setField('detailedPlan', [...rows, { ...ROW }])}>行を追加</Button></div>
            <div className="space-y-4">{rows.map((r, i) => (
              <div key={i} className="rounded-xl border border-line p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Input className="w-28 h-9" value={r.time} onChange={(e) => setRow(i, 'time', e.target.value)} placeholder="0-5分" aria-label="時間" />
                  <Input className="h-9 flex-1" value={r.activity} onChange={(e) => setRow(i, 'activity', e.target.value)} placeholder="学習活動" aria-label="学習活動" />
                  <button aria-label="上へ" disabled={i === 0} onClick={() => move(i, -1)} className="p-1.5 text-mute disabled:opacity-30"><ArrowUp className="size-4" /></button>
                  <button aria-label="下へ" disabled={i === rows.length - 1} onClick={() => move(i, 1)} className="p-1.5 text-mute disabled:opacity-30"><ArrowDown className="size-4" /></button>
                  <button aria-label="削除" onClick={() => setField('detailedPlan', rows.filter((_, j) => j !== i))} className="p-1.5 text-mute hover:text-bad"><Trash2 className="size-4" /></button>
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  <Textarea rows={2} value={r.teacherAction} onChange={(e) => setRow(i, 'teacherAction', e.target.value)} placeholder="教師の働きかけ" aria-label="教師の働きかけ" />
                  <Textarea rows={2} value={r.studentAction} onChange={(e) => setRow(i, 'studentAction', e.target.value)} placeholder="児童生徒の活動" aria-label="児童生徒の活動" />
                  <Input className="h-9" value={r.materials} onChange={(e) => setRow(i, 'materials', e.target.value)} placeholder="教材・教具" aria-label="教材・教具" />
                  <Input className="h-9" value={r.notes} onChange={(e) => setRow(i, 'notes', e.target.value)} placeholder="留意点" aria-label="留意点" />
                </div>
              </div>
            ))}</div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center mb-3"><h3 className="font-bold flex-1">評価規準</h3><Button size="sm" variant="soft" icon={Plus} onClick={() => setField('evaluationCriteria', [...crit, ''])}>追加</Button></div>
            <div className="space-y-2">{crit.map((x, i) => <div key={i} className="flex gap-2"><Input value={x} onChange={(e) => setField('evaluationCriteria', crit.map((y, j) => (j === i ? e.target.value : y)))} /><button aria-label="削除" onClick={() => setField('evaluationCriteria', crit.filter((_, j) => j !== i))} className="p-2 text-mute hover:text-bad"><Trash2 className="size-4" /></button></div>)}</div>
          </Card>
          <Card className="p-5"><Field label="板書計画"><Textarea rows={5} value={c.boardPlan || ''} onChange={(e) => setField('boardPlan', e.target.value)} /></Field></Card>
        </div>
        <div className={mode === 'preview' ? 'lg:sticky lg:top-36' : 'hidden lg:block lg:sticky lg:top-36'}>
          <Card className="p-5 max-h-[calc(100vh-10rem)] overflow-y-auto scroll-thin">
            <p className="text-xs font-bold text-mute mb-2">プレビュー</p>
            <h2 className="text-xl font-bold mb-4">{meta.title}</h2>
            <PlanBody c={c} />
          </Card>
          <p className="text-xs text-mute mt-2">保存すると版の履歴にも残ります。<a className="text-brand underline" href={href(`/plans/${id}?tab=versions`)}>履歴を見る</a></p>
        </div>
      </div>
    </div>
  );
}
