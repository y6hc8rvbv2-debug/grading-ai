// 指導案の本文表示（詳細・共有リンク・ライブラリで共通）
import { schoolLabel } from '../lib/util.js';
import { Card } from '../ui.jsx';

const list = (v) => (Array.isArray(v) ? v.join('、') : v);

export function PlanMeta({ p }) {
  const rows = [
    ['校種・学年', [schoolLabel(p.schoolType), p.grade && `${p.grade}年`].filter(Boolean).join(' ')], ['教科', p.subject], ['単元', p.unit],
    ['単元のねらい', p.unitObjective], ['本時のねらい', p.currentLessonObjective], ['次数／時間数', `${p.lessonNumber || 1}次／${p.teachingHours || 1}時間`],
    ['授業形態', list(p.classFormat)], ['指導理論', list(p.teachingTheory)], ['教材・教具', [list(p.materials), list(p.teachingTools)].filter(Boolean).join('／')],
  ].filter(([, v]) => v);
  return (
    <dl className="grid sm:grid-cols-[8.5rem_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-mute">{k}</dt><dd className="leading-relaxed">{v}</dd></div>)}
    </dl>
  );
}

export function PlanBody({ c = {} }) {
  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-3 gap-3">
        {[['introduction', '導入', '1'], ['development', '展開', '2'], ['conclusion', 'まとめ', '3']].map(([k, l, n]) => (
          <Card key={k} className="p-4 bg-sunken/40">
            <div className="flex items-center gap-2 mb-2"><span className="grid place-items-center size-6 rounded-full bg-brand text-on-brand text-xs font-bold">{n}</span><h3 className="font-bold">{l}</h3></div>
            <p className="prose-ja text-[0.93rem]">{c[k] || '—'}</p>
          </Card>
        ))}
      </div>
      <div>
        <h3 className="font-bold mb-3">学習過程</h3>
        <div className="space-y-0">
          {(c.detailedPlan || []).map((r, i) => (
            <div key={i} className="grid sm:grid-cols-[88px_1fr] gap-x-4">
              <div className="flex sm:flex-col items-center sm:items-end gap-2 sm:gap-0 pt-1">
                <span className="text-xs font-bold text-brand-strong bg-brand-soft rounded-full px-2 py-0.5 whitespace-nowrap">{r.time}</span>
              </div>
              <div className="relative border-l-2 border-brand-soft pl-5 pb-5 mt-2 sm:mt-0">
                <span className="absolute -left-[7px] top-2 size-3 rounded-full bg-brand ring-4 ring-bg" />
                <p className="font-bold">{r.activity}</p>
                <div className="grid md:grid-cols-2 gap-x-6 gap-y-1.5 mt-1.5 text-sm">
                  <p><span className="text-mute text-xs block">教師の働きかけ</span>{r.teacherAction}</p>
                  <p><span className="text-mute text-xs block">児童生徒の活動</span>{r.studentAction}</p>
                  {r.materials && <p><span className="text-mute text-xs block">教材・教具</span>{r.materials}</p>}
                  {r.notes && <p><span className="text-mute text-xs block">留意点</span>{r.notes}</p>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4"><h3 className="font-bold mb-2">評価規準</h3><ul className="space-y-1.5 text-[0.93rem]">{(c.evaluationCriteria || []).filter(Boolean).map((x, i) => <li key={i} className="flex gap-2"><span className="text-brand font-bold">{i + 1}.</span><span>{x}</span></li>)}</ul></Card>
        <Card className="p-4"><h3 className="font-bold mb-2">板書計画</h3><p className="prose-ja text-[0.93rem]">{c.boardPlan || '—'}</p></Card>
      </div>
    </div>
  );
}
