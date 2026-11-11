import { useState } from 'react';
import { Video, MessagesSquare, BarChart3, ArrowRight } from 'lucide-react';
import { useStore } from '../lib/store.js';
import { href, navigate } from '../lib/router.js';
import { fmtDateTime, avg } from '../lib/util.js';
import { Card, PageHeader, Empty, Select, Badge, Button, Stat } from '../ui.jsx';
import { RecordingItem, Recorder, ReflectionView } from './tabs/RecordTabs.jsx';
import { EvaluationView } from './tabs/EvalTabs.jsx';

const planTitle = (plans, id) => plans.find((p) => p.id === id)?.title || '（削除された指導案）';

export function Recordings() {
  const s = useStore();
  const [planId, setPlanId] = useState(s.plans[0]?.id || '');
  return (
    <div>
      <PageHeader icon={Video} title="録画・録音" desc="すべての授業記録。データはこの端末の中だけに保存されます。" />
      <div className="grid lg:grid-cols-[380px_1fr] gap-5 items-start">
        <div className="space-y-3">
          {s.plans.length ? (<>
            <Card className="p-4"><label className="text-sm font-medium block mb-1.5">記録する指導案</label><Select value={planId} onChange={(e) => setPlanId(e.target.value)} options={s.plans.map((p) => ({ value: p.id, label: p.title }))} /></Card>
            {planId && <Recorder planId={planId} key={planId} />}
          </>) : <Card><Empty icon={Video} title="先に指導案をつくりましょう" desc="録画・録音は指導案にひも付けて保存します。" action={<Button onClick={() => navigate('/create')}>指導案をつくる</Button>} /></Card>}
        </div>
        <div className="space-y-3 min-w-0">
          {s.recordings.length === 0 ? <Card><Empty icon={Video} title="録画・録音はまだありません" /></Card> : s.recordings.map((r) => <RecordingItem key={r.id} r={r} showPlan />)}
        </div>
      </div>
    </div>
  );
}

export function Reflections() {
  const s = useStore();
  const [open, setOpen] = useState(s.reflections[0]?.id);
  const current = s.reflections.find((r) => r.id === open);
  return (
    <div>
      <PageHeader icon={MessagesSquare} title="振り返り会議" desc="授業後の協議会の記録と、AIによる要約・助言" />
      {s.reflections.length === 0 ? <Card><Empty icon={MessagesSquare} title="振り返りはまだありません" desc="指導案の「振り返り会議」タブから、協議会の発言を記録できます。" action={s.plans[0] && <Button onClick={() => navigate(`/plans/${s.plans[0].id}?tab=reflection`)}>最新の指導案で記録する</Button>} /></Card> : (
        <div className="grid lg:grid-cols-[320px_1fr] gap-5 items-start">
          <Card className="p-2">{s.reflections.map((r) => (
            <button key={r.id} onClick={() => setOpen(r.id)} className={`w-full text-left px-3 py-2.5 rounded-xl ${open === r.id ? 'bg-brand-soft' : 'hover:bg-sunken'}`}>
              <span className="block text-sm font-medium truncate">{r.result?.meetingTitle}</span>
              <span className="block text-xs text-mute truncate">{planTitle(s.plans, r.planId)}・{fmtDateTime(r.createdAt)}</span>
            </button>
          ))}</Card>
          <div className="min-w-0 space-y-2">{current && <><a className="text-sm text-brand inline-flex items-center gap-1" href={href(`/plans/${current.planId}?tab=reflection`)}>{planTitle(s.plans, current.planId)}<ArrowRight className="size-3" /></a><ReflectionView r={current} /></>}</div>
        </div>
      )}
    </div>
  );
}

export function Evaluations() {
  const s = useStore();
  const [open, setOpen] = useState(null);
  const current = s.evaluations.find((e) => e.id === open);
  const scores = s.evaluations.map((e) => e.result?.overallScore).filter((n) => typeof n === 'number');
  const noteScores = s.notes.map((n) => n.result?.score).filter((n) => typeof n === 'number');
  return (
    <div>
      <PageHeader icon={BarChart3} title="評価レポート" desc="総合評価・ノート分析の一覧" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="総合評価" value={`${s.evaluations.length}件`} icon={BarChart3} />
        <Stat label="平均スコア" value={avg(scores) ?? '—'} />
        <Stat label="分析したノート" value={`${noteScores.length}件`} />
        <Stat label="ノート平均" value={avg(noteScores) ?? '—'} />
      </div>
      {current ? (<div className="space-y-2"><Button variant="ghost" onClick={() => setOpen(null)}>← 一覧に戻る</Button><a className="block text-sm text-brand" href={href(`/plans/${current.planId}?tab=evaluation`)}>{planTitle(s.plans, current.planId)}</a><EvaluationView ev={current} plan={s.plans.find((p) => p.id === current.planId)} /></div>) : s.evaluations.length === 0 ? (
        <Card><Empty icon={BarChart3} title="総合評価はまだありません" desc="指導案の「総合評価」タブで作成できます。" /></Card>
      ) : (
        <Card className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-mute border-b border-line"><th className="px-4 py-3">指導案</th><th className="px-3">総合</th><th className="px-3 hidden sm:table-cell">ねらい</th><th className="px-3 hidden sm:table-cell">理解</th><th className="px-3 hidden md:table-cell">意欲</th><th className="px-3">日時</th></tr></thead>
          <tbody>{s.evaluations.map((e) => (
            <tr key={e.id} onClick={() => setOpen(e.id)} className="border-b border-line hover:bg-sunken cursor-pointer">
              <td className="px-4 py-3 font-medium">{planTitle(s.plans, e.planId)} {e.demo && <Badge tone="warn">見本</Badge>}</td>
              <td className="px-3 font-bold tabular-nums">{e.result.overallScore}</td>
              <td className="px-3 tabular-nums hidden sm:table-cell">{e.result.categoryScores?.objectiveAchievement}</td>
              <td className="px-3 tabular-nums hidden sm:table-cell">{e.result.categoryScores?.understanding}</td>
              <td className="px-3 tabular-nums hidden md:table-cell">{e.result.categoryScores?.motivationAttitude}</td>
              <td className="px-3 text-mute whitespace-nowrap">{fmtDateTime(e.createdAt)}</td>
            </tr>
          ))}</tbody>
        </table></Card>
      )}
    </div>
  );
}
