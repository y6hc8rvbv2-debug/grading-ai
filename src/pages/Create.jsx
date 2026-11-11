import { useEffect, useMemo, useState } from 'react';
import { FilePlus2, Sparkles, ChevronLeft, ChevronRight, Wand2, Save, PenLine, Check, BookOpen, HeartHandshake, RotateCcw } from 'lucide-react';
import { useStore, db, getDisplay } from '../lib/store.js';
import { navigate, href } from '../lib/router.js';
import { runAi } from '../lib/ai.js';
import { quota, countUsage } from '../lib/quota.js';
import { cx } from '../lib/util.js';
import { detectNeeds } from '../lib/content.js';
import { SCHOOL_TYPES, GRADES, SUBJECTS, CLASS_FORMATS, THEORIES, THEORY_NAMES, MATERIALS, TOOLS, EVALUATIONS, EXPERIENTIAL, COMMUNICATION, EMPTY_FORM, PRESETS, LANGUAGES } from '../lib/options.js';
import { Button, Card, Field, Input, Textarea, Select, Chips, PageHeader, Notice, AiProgress, toast, Modal, Badge } from '../ui.jsx';

const STEPS = ['基本情報', '単元とねらい', '授業の進め方', '児童生徒と環境', '詳細と仕上げ'];
const DRAFT = 'js-create-draft';

export default function CreatePlan({ query }) {
  const s = useStore();
  const q = quota(s);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(() => {
    try { const d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); if (d) return { ...EMPTY_FORM, ...d }; } catch { /* 下書きなし */ }
    return { ...EMPTY_FORM, language: getDisplay().language || 'ja' };
  });
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState('');
  const [error, setError] = useState('');
  const [papers, setPapers] = useState([]);
  const [saveTpl, setSaveTpl] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  // テンプレートや既存の指導案の条件を読み込む
  useEffect(() => {
    const src = query.template ? s.templates.find((t) => t.id === query.template)?.form : query.copy ? s.plans.find((p) => p.id === query.copy) : null;
    if (src) { const pick = Object.fromEntries(Object.keys(EMPTY_FORM).map((k) => [k, src[k] ?? EMPTY_FORM[k]])); setForm({ ...pick, title: query.copy ? `${src.title}（コピー）` : pick.title }); toast('条件を読み込みました'); }
    else if (query.date) setForm((f) => ({ ...f, lessonDate: query.date }));
  }, [query.template, query.copy, query.date]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem(DRAFT, JSON.stringify(form)); } catch { /* 保存できなくても続ける */ } }, [form]);

  const needs = useMemo(() => detectNeeds(form.specialNeedsInfo), [form.specialNeedsInfo]);
  const canNext = [form.schoolType && form.grade && form.subject, form.unit, true, true, true][step];
  const valid = form.schoolType && form.grade && form.subject && form.unit;

  const generate = async () => {
    if (!valid) { toast('校種・学年・教科・単元は必須です', 'bad'); return; }
    if (q.left <= 0) { toast('今月の作成上限に達しました。プランをご確認ください。', 'bad'); return; }
    setBusy(true); setError(''); setStream('');
    try {
      const payload = {
        ...form,
        classFormat: form.classFormat.join('、'), teachingTheory: form.teachingTheory.join('、'), materials: form.materials.join('、'), teachingTools: form.teachingTools.join('、'),
        teachingTheories: form.teachingTheory.map((n) => ({ name: n, summary: THEORIES[n] })),
        detectedDisabilitySuggestions: needs.map((g) => ({ label: g.label, tips: g.tips })),
        adoptedPapers: s.papers.filter((p) => papers.includes(p.id)),
      };
      delete payload.instructorName; delete payload.schoolName; // 個人・所属の情報はAIに送らない
      const { result, demo } = await runAi('generatePlan', payload, { onText: setStream });
      const plan = db.add('plans', { ...form, title: form.title || result.title || `${form.subject}「${form.unit}」`, generatedContent: result, demo, tags: [], adoptedPapers: papers });
      db.add('versions', { planId: plan.id, label: '初版', content: result, reason: 'AIで作成' });
      if (!demo) countUsage();
      localStorage.removeItem(DRAFT);
      toast('指導案ができました');
      navigate(`/plans/${plan.id}`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const blank = () => {
    if (!valid) { toast('校種・学年・教科・単元は必須です', 'bad'); return; }
    const plan = db.add('plans', { ...form, title: form.title || `${form.subject}「${form.unit}」`, generatedContent: { title: form.title, introduction: '', development: '', conclusion: '', detailedPlan: [{ time: '0-5分', activity: '', teacherAction: '', studentAction: '', materials: '', notes: '' }], evaluationCriteria: [''], boardPlan: '' }, tags: [] });
    localStorage.removeItem(DRAFT);
    navigate(`/plans/${plan.id}/edit`);
  };

  return (
    <div>
      <PageHeader icon={FilePlus2} title="新しい指導案" desc="条件を入力すると、AIが学習指導案を作成します。入力は自動で下書き保存されます。"
        actions={<>
          <Select className="w-auto" value="" onChange={(e) => { const p = PRESETS[Number(e.target.value)]; if (p) { setForm({ ...EMPTY_FORM, ...p.form, language: form.language }); setStep(0); toast(`入力例「${p.name}」を読み込みました`); } }}
            options={PRESETS.map((p, i) => ({ value: String(i), label: p.name }))} placeholder="入力例を使う" />
          {s.templates.length > 0 && <Select className="w-auto" value="" onChange={(e) => e.target.value && navigate(`/create?template=${e.target.value}`)} options={s.templates.map((t) => ({ value: t.id, label: t.name }))} placeholder="テンプレート" />}
          <Button variant="ghost" icon={RotateCcw} onClick={() => { setForm({ ...EMPTY_FORM, language: form.language }); setStep(0); }}>クリア</Button>
        </>} />

      {q.left <= 0 && <Notice tone="bad" className="mb-4">今月のAI作成数の上限（{q.plan.name}：{q.limit}件）に達しました。<a href={href('/subscription')} className="underline font-bold">プランを変更</a>するか、「自分で書く」で手入力の指導案を作れます。</Notice>}

      <ol className="flex gap-1 sm:gap-2 mb-5 overflow-x-auto scroll-thin">
        {STEPS.map((label, i) => (
          <li key={label} className="flex-1 min-w-[96px]">
            <button onClick={() => setStep(i)} className={cx('w-full text-left rounded-xl px-3 py-2 border transition', i === step ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:border-brand/40')}>
              <span className={cx('text-[0.7rem] font-bold', i === step ? 'text-brand-strong' : 'text-mute')}>STEP {i + 1}</span>
              <span className="block text-sm font-medium truncate">{label}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="grid lg:grid-cols-[1fr_300px] gap-5 items-start">
        <Card className="p-5 sm:p-6">
          {step === 0 && (
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="授業タイトル" hint="空欄ならAIが付けます" className="sm:col-span-2"><Input value={form.title} onChange={set('title')} placeholder="例：分数のたし算を考えよう" /></Field>
              <Field label="校種" required><Select value={form.schoolType} onChange={(e) => setForm((f) => ({ ...f, schoolType: e.target.value, grade: '', subject: '' }))} options={SCHOOL_TYPES} placeholder="選んでください" /></Field>
              <Field label="学年" required><Select value={form.grade} onChange={set('grade')} options={(GRADES[form.schoolType] || []).map((g) => ({ value: g, label: `${g}年` }))} placeholder={form.schoolType ? '選んでください' : '先に校種を選択'} /></Field>
              <Field label="教科" required><Select value={form.subject} onChange={set('subject')} options={SUBJECTS[form.schoolType] || []} placeholder={form.schoolType ? '選んでください' : '先に校種を選択'} /></Field>
              <Field label="実施日"><Input type="date" value={form.lessonDate} onChange={set('lessonDate')} /></Field>
              <Field label="指導者名" hint="書き出し用。AIには送りません"><Input value={form.instructorName} onChange={set('instructorName')} /></Field>
              <Field label="学校名" hint="書き出し用。AIには送りません"><Input value={form.schoolName} onChange={set('schoolName')} /></Field>
              <Field label="指導案の言語" className="sm:col-span-2"><Select value={form.language} onChange={set('language')} options={LANGUAGES.map((l) => ({ value: l.code, label: l.name }))} /></Field>
            </div>
          )}
          {step === 1 && (
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="単元名" required className="sm:col-span-2"><Input value={form.unit} onChange={set('unit')} placeholder="例：分数のたし算とひき算" /></Field>
              <Field label="単元のねらい" className="sm:col-span-2"><Textarea value={form.unitObjective} onChange={set('unitObjective')} /></Field>
              <Field label="小単元"><Input value={form.subUnit} onChange={set('subUnit')} /></Field>
              <Field label="小単元のねらい"><Input value={form.subUnitObjective} onChange={set('subUnitObjective')} /></Field>
              <Field label="本時のねらい" className="sm:col-span-2" hint="ここが具体的なほど、指導案の質が上がります"><Textarea value={form.currentLessonObjective} onChange={set('currentLessonObjective')} /></Field>
              <Field label="次数（何時間目か）"><Input type="number" min="1" value={form.lessonNumber} onChange={set('lessonNumber')} /></Field>
              <Field label="指導時間数"><Input type="number" min="1" max="6" value={form.teachingHours} onChange={set('teachingHours')} /></Field>
              <Field label="既習事項" className="sm:col-span-2" hint="導入で想起させ、新しい内容へ橋渡しします"><Textarea rows={2} value={form.priorKnowledge} onChange={set('priorKnowledge')} /></Field>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-5">
              <Field label="授業形態（複数可）"><Chips options={CLASS_FORMATS} value={form.classFormat} onChange={set('classFormat')} /></Field>
              <div>
                <span className="block text-sm font-medium mb-1.5">指導理論（3つまで）</span>
                <Chips options={THEORY_NAMES} value={form.teachingTheory} onChange={set('teachingTheory')} max={3} />
                {form.teachingTheory.length > 0 && <div className="mt-3 space-y-2">{form.teachingTheory.map((n) => <Notice key={n} tone="mute"><strong className="text-ink">{n}</strong><br />{THEORIES[n]}</Notice>)}</div>}
              </div>
              <Field label="教材"><Chips options={MATERIALS} value={form.materials} onChange={set('materials')} /></Field>
              <Field label="教具"><Chips options={TOOLS} value={form.teachingTools} onChange={set('teachingTools')} /></Field>
            </div>
          )}
          {step === 3 && (
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="児童生徒数" hint={s.roster.length ? `名簿には${s.roster.length}名登録されています` : ''}><Input type="number" min="1" value={form.studentCount} onChange={set('studentCount')} /></Field>
              <div />
              <Field label="学校と地域の環境" className="sm:col-span-2"><Textarea rows={2} value={form.schoolEnvironment} onChange={set('schoolEnvironment')} /></Field>
              <Field label="児童生徒全体の特徴" className="sm:col-span-2"><Textarea rows={2} value={form.studentCharacteristics} onChange={set('studentCharacteristics')} /></Field>
              <Field label="特別な支援を要する児童生徒" className="sm:col-span-2" hint="名前は書かず、特性と人数で。例：ADHDの傾向がある児童が1名"><Textarea rows={2} value={form.specialNeedsInfo} onChange={set('specialNeedsInfo')} /></Field>
              {needs.length > 0 && (
                <div className="sm:col-span-2"><Notice icon={HeartHandshake}>次の支援の手立てを指導案に織り込みます：{needs.map((g) => <Badge key={g.id} tone="brand" className="ml-1">{g.label}</Badge>)}</Notice></div>
              )}
            </div>
          )}
          {step === 4 && (
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="主な発問"><Textarea value={form.questions} onChange={set('questions')} placeholder="空欄ならAIが設定" /></Field>
              <Field label="予想される反応"><Textarea value={form.expectedResponses} onChange={set('expectedResponses')} placeholder="空欄ならAIが設定" /></Field>
              <Field label="体験活動" className="sm:col-span-2"><Chips options={EXPERIENTIAL} value={form.experientialActivities ? form.experientialActivities.split('、') : []} onChange={(v) => setForm((f) => ({ ...f, experientialActivities: v.join('、') }))} /></Field>
              <Field label="コミュニケーション活動" className="sm:col-span-2"><Chips options={COMMUNICATION} value={form.communicationActivities ? form.communicationActivities.split('、') : []} onChange={(v) => setForm((f) => ({ ...f, communicationActivities: v.join('、') }))} /></Field>
              <Field label="評価の方法" className="sm:col-span-2"><Chips options={EVALUATIONS} value={form.evaluation ? form.evaluation.split('、') : []} onChange={(v) => setForm((f) => ({ ...f, evaluation: v.join('、') }))} /></Field>
              <Field label="注意事項"><Textarea rows={2} value={form.notes} onChange={set('notes')} /></Field>
              <Field label="その他の希望"><Textarea rows={2} value={form.otherInfo} onChange={set('otherInfo')} /></Field>
              {s.papers.length > 0 && (
                <div className="sm:col-span-2">
                  <span className="block text-sm font-medium mb-1.5 flex items-center gap-1.5"><BookOpen className="size-4" />授業に生かす研究（保存した論文から）</span>
                  <Chips options={s.papers.map((p) => p.title)} value={s.papers.filter((p) => papers.includes(p.id)).map((p) => p.title)} onChange={(titles) => setPapers(s.papers.filter((p) => titles.includes(p.title)).map((p) => p.id))} />
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 mt-6 pt-5 border-t border-line">
            <Button variant="outline" icon={ChevronLeft} disabled={step === 0} onClick={() => setStep(step - 1)}>戻る</Button>
            {step < STEPS.length - 1 && <Button variant="soft" disabled={!canNext} onClick={() => setStep(step + 1)}>次へ<ChevronRight className="size-4" /></Button>}
            <span className="flex-1" />
            <Button variant="ghost" icon={Save} onClick={() => setSaveTpl(true)} className="hidden sm:inline-flex">テンプレート保存</Button>
          </div>
        </Card>

        <div className="lg:sticky lg:top-24 space-y-3">
          <Card className="p-5">
            <h3 className="font-bold mb-3">入力の確認</h3>
            <ul className="text-sm space-y-1.5">
              {[['校種・学年', form.schoolType && form.grade], ['教科', form.subject], ['単元', form.unit], ['本時のねらい', form.currentLessonObjective], ['指導理論', form.teachingTheory.length]].map(([l, ok]) => (
                <li key={l} className="flex items-center gap-2"><span className={cx('grid place-items-center size-5 rounded-full text-[0.65rem]', ok ? 'bg-good text-white' : 'bg-sunken text-mute')}>{ok ? <Check className="size-3" /> : ''}</span>{l}</li>
              ))}
            </ul>
            <div className="mt-5 space-y-2">
              <Button size="lg" className="w-full" icon={Sparkles} loading={busy} disabled={!valid || q.left <= 0} onClick={generate}>AIで作成する</Button>
              <Button variant="outline" className="w-full" icon={PenLine} disabled={busy} onClick={blank}>自分で書く（AIを使わない）</Button>
            </div>
            <p className="text-xs text-mute mt-3">今月の残り：{q.left === Infinity ? '無制限' : `${q.left}件`}（{q.plan.name}）</p>
          </Card>
          {busy && <AiProgress text={stream} label="指導案を作成しています（30秒〜2分）" />}
          {error && <Notice tone="bad">{error}</Notice>}
          <Notice tone="mute" icon={Wand2}>指導者名・学校名はAIに送りません。完成後は直接編集や、AIへの改善依頼ができます。</Notice>
        </div>
      </div>

      <TemplateModal open={saveTpl} onClose={() => setSaveTpl(false)} form={form} />
    </div>
  );
}

function TemplateModal({ open, onClose, form }) {
  const [name, setName] = useState('');
  useEffect(() => { if (open) setName([form.subject, form.unit].filter(Boolean).join('・') || '新しいテンプレート'); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => { const { instructorName, schoolName, lessonDate, ...rest } = form; db.add('templates', { name: name.trim() || 'テンプレート', form: rest }); toast('テンプレートを保存しました'); onClose(); };
  return (
    <Modal open={open} onClose={onClose} title="テンプレートとして保存" footer={<><Button variant="outline" onClick={onClose}>キャンセル</Button><Button icon={Save} onClick={save}>保存</Button></>}>
      <p className="text-sm text-mute mb-3">いまの入力条件（指導者名・学校名・実施日を除く）を保存し、次回すぐに呼び出せます。</p>
      <Field label="テンプレート名"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
    </Modal>
  );
}
