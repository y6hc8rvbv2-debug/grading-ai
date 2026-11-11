import { useState } from 'react';
import { BarChart3, Sparkles, Trash2, History, RotateCcw, Wand2, FileText, Printer, Check } from 'lucide-react';
import { useStore, db, getState } from '../../lib/store.js';
import { runAi } from '../../lib/ai.js';
import { navigate } from '../../lib/router.js';
import { makeAliases, planForAi, fmtDateTime, esc, cx } from '../../lib/util.js';
import { printHtml } from '../../lib/exporters.js';
import { Button, Card, CardHead, Textarea, AiProgress, Notice, toast, confirmDialog, Badge, Empty, ScoreRing, Section, BulletList, DemoNote, Bar } from '../../ui.jsx';
import { PlanBody } from '../PlanView.jsx';

const CATS = [['objectiveAchievement', 'ねらいの達成'], ['understanding', '理解度'], ['problemSolving', '問題解決'], ['communication', '表現・交流'], ['motivationAttitude', '意欲・態度']];

// 指導案の改善（AI）。改善前の内容も版として残す
export async function improvePlan(plan, feedback, label, onText) {
  const { result, demo } = await runAi('improvePlan', { plan: planForAi(plan), feedback }, { onText });
  const { improvementSummary, ...content } = result;
  if (!getState().versions.some((v) => v.planId === plan.id)) db.add('versions', { planId: plan.id, label: '初版', content: plan.generatedContent, reason: '改善前の内容' });
  db.add('versions', { planId: plan.id, label, content, reason: improvementSummary || feedback.slice(0, 200), demo });
  db.update('plans', plan.id, { generatedContent: content });
  return improvementSummary;
}

export function EvaluationTab({ plan }) {
  const s = useStore();
  const list = s.evaluations.filter((e) => e.planId === plan.id);
  const [busy, setBusy] = useState('');
  const [stream, setStream] = useState('');
  const [open, setOpen] = useState(list[0]?.id);
  const current = list.find((e) => e.id === open);
  const data = {
    notes: s.notes.filter((n) => n.planId === plan.id && n.result), behaviors: s.behaviors.filter((b) => b.planId === plan.id),
    special: s.specialNeeds.filter((x) => x.planId === plan.id), reflection: s.reflections.filter((r) => r.planId === plan.id),
  };
  const any = data.notes.length + data.behaviors.length + data.special.length + data.reflection.length > 0;

  const run = async () => {
    setBusy('eval'); setStream('');
    try {
      const names = [...s.roster.map((r) => r.name), ...data.notes.map((n) => n.studentName), ...data.special.map((x) => x.studentName), ...data.behaviors.flatMap((b) => b.students)];
      const a = makeAliases(names);
      const notes = data.notes.map((n) => `${a.alias(n.studentName)}（${n.result.score}点）：${n.result.thinkingProcess?.summary}／強み:${(n.result.analysis?.strengths || []).join('、')}／課題:${(n.result.analysis?.weaknesses || []).join('、')}`).join('\n');
      const behaviors = data.behaviors.map((b) => `${b.result.overallFeedback}\n${b.result.evaluations.map((e) => `${a.alias(e.studentName)} 意欲${e.motivationScore} 態度${e.attitudeScore}：${e.observations}`).join('\n')}`).join('\n');
      const special = data.special.map((x) => `${a.alias(x.studentName)}（理解${x.result.comprehensionScore}）：${x.result.comprehensionAssessment}`).join('\n');
      const reflection = data.reflection.map((r) => `${r.result.overallSummary}\n良かった点:${(r.result.positives || []).join('、')}\n改善点:${(r.result.improvements || []).join('、')}`).join('\n');
      const { result, demo } = await runAi('comprehensive', { plan: planForAi(plan), notes: a.hide(notes), behaviors: a.hide(behaviors), specialNeeds: a.hide(special), reflection: a.hide(reflection) }, { onText: setStream });
      const row = db.add('evaluations', { planId: plan.id, result: a.restoreDeep(result), demo, sources: { notes: data.notes.length, behaviors: data.behaviors.length, special: data.special.length, reflection: data.reflection.length } });
      setOpen(row.id); toast('総合評価ができました');
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(''); }
  };
  const improve = async (ev) => {
    const r = ev.result; const ip = r.improvementPlanSuggestions || {};
    const feedback = [`総合評価 ${r.overallScore}点`, `改善点：${(r.improvements || []).join('、')}`, `改善が必要な働きかけ：${(r.ineffectiveInterventions || []).join('、')}`,
      ...[['introductionChanges', '導入'], ['developmentChanges', '展開'], ['conclusionChanges', 'まとめ'], ['questioningChanges', '発問'], ['supportChanges', '個別支援'], ['materialChanges', '教材・教具']].map(([k, l]) => ip[k] && `${l}：${ip[k]}`)].filter(Boolean).join('\n');
    setBusy('improve'); setStream('');
    try { await improvePlan(plan, feedback, `改善版（総合評価 ${fmtDateTime(ev.createdAt)}）`, setStream); toast('改善版を作成し、指導案を更新しました'); navigate(`/plans/${plan.id}?tab=versions`, { replace: true }); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(''); }
  };

  return (
    <div className="grid lg:grid-cols-[320px_1fr] gap-5 items-start">
      <div className="space-y-4">
        <Card>
          <CardHead icon={BarChart3} title="総合評価" desc="集めた記録をもとに授業を評価" />
          <div className="px-5 pb-5 space-y-2 text-sm">
            {[['ノート分析', data.notes.length, 'notes'], ['授業観察', data.behaviors.length, 'observe'], ['特別支援', data.special.length, 'special'], ['振り返り会議', data.reflection.length, 'reflection']].map(([l, n, t]) => (
              <button key={l} onClick={() => navigate(`/plans/${plan.id}?tab=${t}`, { replace: true })} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-sunken hover:bg-brand-soft">
                <span className={cx('grid place-items-center size-5 rounded-full text-[0.65rem]', n ? 'bg-good text-white' : 'bg-line text-mute')}>{n ? <Check className="size-3" /> : ''}</span><span className="flex-1 text-left">{l}</span><span className="text-mute">{n}件</span>
              </button>
            ))}
            {!any && <Notice tone="warn" className="mt-2">記録がない観点は「データなし」として評価されます。</Notice>}
            <Button className="w-full mt-2" icon={Sparkles} loading={busy === 'eval'} disabled={Boolean(busy)} onClick={run}>総合評価を作成</Button>
          </div>
        </Card>
        {list.length > 0 && <Card className="p-2">{list.map((e) => (
          <button key={e.id} onClick={() => setOpen(e.id)} className={cx('w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-left', open === e.id ? 'bg-brand-soft' : 'hover:bg-sunken')}><span className="text-sm font-bold tabular-nums w-10">{e.result.overallScore}</span><span className="text-sm flex-1">総合評価</span>{e.demo && <Badge tone="warn">見本</Badge>}<span className="text-xs text-mute">{fmtDateTime(e.createdAt)}</span></button>
        ))}</Card>}
      </div>
      <div className="min-w-0">
        {busy && <AiProgress text={stream} label={busy === 'improve' ? '改善版の指導案を作成しています' : '総合評価を作成しています'} />}
        {!busy && current && <EvaluationView ev={current} plan={plan} onImprove={() => improve(current)} />}
        {!busy && !current && <Card><Empty icon={BarChart3} title="総合評価はまだありません" desc="ノート・観察・振り返りを記録してから作成すると、根拠のある評価になります。評価から改善版の指導案も作れます。" /></Card>}
      </div>
    </div>
  );
}

export function EvaluationView({ ev, plan, onImprove }) {
  const r = ev.result; const ip = r.improvementPlanSuggestions || {};
  const print = () => {
    try {
      printHtml(`総合評価 ${plan?.title || ''}`, `<h1>総合評価：${esc(plan?.title)}</h1><p>総合スコア <strong>${r.overallScore}</strong>点</p><h2>総合所見</h2><p>${esc(r.overallAssessment)}</p><h2>ねらいの達成度</h2><p>${esc(r.objectiveAchievement)}</p><h2>教師の働きかけ</h2><p>${esc(r.teacherInterventionAnalysis)}</p><h2>強み</h2><ul>${(r.strengths || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul><h2>改善点</h2><ul>${(r.improvements || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul><h2>推奨アクション</h2><ul>${(r.recommendations || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);
    } catch (e) { toast(e.message, 'bad'); }
  };
  return (
    <Card className="p-5 sm:p-6">
      <DemoNote show={ev.demo} />
      <div className="flex flex-col sm:flex-row gap-5 mb-6">
        <ScoreRing value={r.overallScore} size={110} label="総合スコア" />
        <div className="flex-1 grid gap-2.5">{CATS.map(([k, l]) => <Bar key={k} label={l} value={r.categoryScores?.[k]} />)}</div>
      </div>
      <div className="flex flex-wrap gap-2 mb-5">
        {[['notesScore', 'ノート'], ['behaviorScore', '観察'], ['reflectionScore', '振り返り']].map(([k, l]) => <Badge key={k} tone={r.scoreBreakdown?.[k] == null ? 'mute' : 'brand'}>{l}：{r.scoreBreakdown?.[k] ?? 'データなし'}</Badge>)}
      </div>
      <Section title="総合所見"><p className="leading-relaxed">{r.overallAssessment}</p></Section>
      <Section title="ねらいの達成度"><p className="leading-relaxed">{r.objectiveAchievement}</p></Section>
      <Section title="教師の働きかけ"><p className="leading-relaxed">{r.teacherInterventionAnalysis}</p></Section>
      <div className="grid md:grid-cols-2 gap-x-6">
        <Section title="有効だった働きかけ"><BulletList items={r.effectiveInterventions} tone="good" /></Section>
        <Section title="見直したい働きかけ"><BulletList items={r.ineffectiveInterventions} tone="warn" /></Section>
        <Section title="授業の強み"><BulletList items={r.strengths} tone="good" /></Section>
        <Section title="今後の改善点"><BulletList items={r.improvements} tone="warn" /></Section>
      </div>
      <div className="grid md:grid-cols-3 gap-3 mb-5">{[['studentEngagement', '意欲・態度'], ['thinkingQuality', '思考力・理解度'], ['teachingEffectiveness', '指導の効果']].map(([k, l]) => <div key={k} className="rounded-xl bg-sunken p-4"><p className="text-xs font-bold text-brand-strong mb-1">{l}</p><p className="text-sm leading-relaxed">{r[k]}</p></div>)}</div>
      <Section title="推奨アクション"><BulletList items={r.recommendations} /></Section>
      {(r.studentHighlights || []).length > 0 && <Section title="児童生徒の特筆事項"><ul className="text-sm space-y-1">{r.studentHighlights.map((h, i) => <li key={i}><strong>{h.studentName}</strong>：{h.highlight}</li>)}</ul></Section>}
      <div className="rounded-2xl border border-brand/30 bg-brand-soft/40 p-5 mt-2">
        <h4 className="font-bold text-brand-strong mb-3 flex items-center gap-2"><Wand2 className="size-4" />次の授業への改善案</h4>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">{[['introductionChanges', '導入'], ['developmentChanges', '展開'], ['conclusionChanges', 'まとめ'], ['questioningChanges', '発問'], ['supportChanges', '個別支援'], ['materialChanges', '教材・教具']].map(([k, l]) => ip[k] && <p key={k}><span className="font-bold">{l}：</span>{ip[k]}</p>)}</div>
        {onImprove && <Button className="mt-4" icon={Sparkles} onClick={onImprove}>この改善案で指導案を作り直す</Button>}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button size="sm" variant="outline" icon={Printer} onClick={print}>印刷</Button>
        <Button size="sm" variant="ghost" icon={Trash2} onClick={async () => { if (await confirmDialog('この総合評価を削除しますか？', { ok: '削除', danger: true })) db.remove('evaluations', ev.id); }}>削除</Button>
      </div>
    </Card>
  );
}

export function VersionsTab({ plan }) {
  const s = useStore();
  const list = s.versions.filter((v) => v.planId === plan.id);
  const [fb, setFb] = useState('');
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState('');
  const [view, setView] = useState(null);
  const shown = list.find((v) => v.id === view);
  const isCurrent = (v) => JSON.stringify(v.content) === JSON.stringify(plan.generatedContent);

  const improve = async () => {
    if (!fb.trim()) { toast('どう直したいかを入力してください', 'bad'); return; }
    setBusy(true); setStream('');
    try { const sum = await improvePlan(plan, fb, `改善版（${new Date().toLocaleDateString('ja-JP')}）`, setStream); setFb(''); toast('改善版を作成しました'); if (sum) toast(sum.slice(0, 120)); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  const restore = async (v) => {
    if (!(await confirmDialog(`「${v.label}」の内容に戻します。いまの内容も版として残ります。`, { ok: '戻す' }))) return;
    if (!list.some(isCurrent)) db.add('versions', { planId: plan.id, label: `復元前の内容（${new Date().toLocaleString('ja-JP')}）`, content: plan.generatedContent, reason: '復元前に自動保存' });
    db.update('plans', plan.id, { generatedContent: v.content }); toast('元に戻しました');
  };

  return (
    <div className="grid lg:grid-cols-[360px_1fr] gap-5 items-start">
      <div className="space-y-4">
        <Card>
          <CardHead icon={Wand2} title="AIで改善する" desc="直したい点を伝えると、改善版を作成" />
          <div className="px-5 pb-5 space-y-3">
            <Textarea rows={4} value={fb} onChange={(e) => setFb(e.target.value)} placeholder="例：展開の話し合いの時間を増やし、まとめは児童の言葉でまとめる形にしたい" />
            <div className="flex flex-wrap gap-1.5">{['時間配分を見直して', 'ICTの活用を増やして', '発問をもっと具体的に', '支援が必要な子への手立てを追加'].map((x) => <button key={x} onClick={() => setFb((f) => (f ? `${f}\n${x}` : x))} className="text-xs h-7 px-2.5 rounded-full border border-line hover:border-brand">{x}</button>)}</div>
            <Button className="w-full" icon={Sparkles} loading={busy} onClick={improve}>改善版をつくる</Button>
            <p className="text-xs text-mute">総合評価の画面からも、評価結果をもとに改善版を作れます。</p>
          </div>
        </Card>
        <Card className="p-2">
          <p className="px-3 pt-2 pb-1 text-xs font-bold text-mute">版の履歴</p>
          {list.length === 0 && <p className="px-3 pb-3 text-sm text-mute">まだ履歴はありません。</p>}
          {list.map((v) => (
            <div key={v.id} className={cx('flex items-center gap-2 px-3 py-2.5 rounded-xl', view === v.id ? 'bg-brand-soft' : 'hover:bg-sunken')}>
              <button className="flex-1 min-w-0 text-left" onClick={() => setView(v.id)}><span className="block text-sm font-medium truncate">{v.label}</span><span className="block text-xs text-mute">{fmtDateTime(v.createdAt)}</span></button>
              {isCurrent(v) ? <Badge tone="good">現在</Badge> : <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => restore(v)}>戻す</Button>}
            </div>
          ))}
        </Card>
      </div>
      <div className="min-w-0">
        {busy && <AiProgress text={stream} label="改善版を作成しています" />}
        {!busy && shown ? (
          <Card className="p-5 sm:p-6">
            <div className="flex items-start gap-3 mb-4"><History className="size-5 text-brand mt-1" /><div className="flex-1"><h3 className="font-bold text-lg">{shown.label}</h3>{shown.reason && <p className="text-sm text-mute mt-1">{shown.reason}</p>}</div>{shown.demo && <Badge tone="warn">見本</Badge>}</div>
            <PlanBody c={shown.content} />
          </Card>
        ) : !busy && <Card><Empty icon={FileText} title="版を選ぶと内容を確認できます" desc="改善のたびに版が残るので、いつでも前の内容に戻せます。" /></Card>}
      </div>
    </div>
  );
}

