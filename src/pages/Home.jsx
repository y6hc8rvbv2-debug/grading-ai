import { useMemo, useState } from 'react';
import { FilePlus2, Files, Sparkles, ClipboardCheck, NotebookPen, Video, BarChart3, BookOpen, Library, ShieldCheck, Wand2, CalendarDays, ArrowRight, Keyboard, Moon, Sun, Timer, Users } from 'lucide-react';
import { useStore, db, uid, setDisplay } from '../lib/store.js';
import { href, navigate } from '../lib/router.js';
import { useConfig } from '../lib/api.js';
import { quota } from '../lib/quota.js';
import { fmtDate, schoolLabel, avg } from '../lib/util.js';
import { Button, Card, CardHead, Input, Badge, Notice, Stat, Empty } from '../ui.jsx';

const FEATURES = [
  [Sparkles, 'AIで指導案を作成', '単元・ねらい・指導理論を選ぶだけ。学習過程・評価規準・板書計画まで一度に。'],
  [Wand2, '教材もAIで', 'ワークシート・小テスト・ルーブリック・発問集・学級通信をワンタップで。'],
  [Video, '授業を記録', '録画・録音、児童生徒のノート写真、QRコードでの提出受付。'],
  [ClipboardCheck, '振り返りと評価', '協議会の文字起こしを要約し、ノート・観察と合わせて総合評価。'],
  [NotebookPen, '改善版を自動作成', '評価結果から次の授業の指導案を作り直し、版として保存。'],
  [ShieldCheck, '個人情報に配慮', 'データは端末に保存。児童生徒名は仮名に置き換えてからAIへ。'],
];

export function Welcome() {
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const start = (e) => {
    e.preventDefault();
    if (!name.trim() || !agree) return;
    const now = new Date().toISOString();
    db.set('profile', { id: uid(), deviceKey: uid(), name: name.trim().slice(0, 40), plan: 'free', createdAt: now, termsAcceptedAt: now });
    navigate('/');
  };
  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <header className="h-16 flex items-center gap-2.5">
          <span className="grid place-items-center size-9 rounded-xl bg-brand text-on-brand"><svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"><path d="M5 18V8l7-3 7 3v10l-7 3z" /><path d="M12 11v10" /></svg></span>
          <span className="font-display font-bold text-lg">授業スタジオ</span>
          <Badge tone="brand" className="ml-1">with Claude</Badge>
        </header>
        <section className="grid lg:grid-cols-[1.15fr_1fr] gap-10 items-center py-10 sm:py-16">
          <div>
            <p className="text-brand-strong font-bold text-sm mb-3">先生のための授業づくりアプリ</p>
            <h1 className="text-4xl sm:text-5xl font-bold leading-[1.2] tracking-tight">指導案づくりから、<br />授業の振り返りまで<br /><span className="text-brand">ひとつの場所で。</span></h1>
            <p className="mt-5 text-mute leading-relaxed max-w-xl">条件を選ぶだけで、学習指導要領に沿った学習指導案をAI（Claude）が作成。授業の記録・評価・改善までを一つのサイクルとして支えます。</p>
            <div className="mt-6 flex flex-wrap gap-2 text-sm text-mute">
              {['登録はお名前だけ', 'データは端末に保存', 'Word・Excel・PowerPoint出力'].map((x) => <span key={x} className="px-3 py-1 rounded-full bg-surface border border-line">✓ {x}</span>)}
            </div>
          </div>
          <Card className="p-6 sm:p-8 shadow-xl shadow-black/5">
            <h2 className="text-xl font-bold">さっそく始める</h2>
            <p className="text-sm text-mute mt-1">お名前（ニックネーム可）を入力してください。</p>
            <form onSubmit={start} className="mt-5 space-y-4">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：山田先生" aria-label="お名前" maxLength={40} />
              <label className="flex items-start gap-2.5 text-sm leading-relaxed">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 size-4 accent-[var(--brand)]" />
                <span><a className="text-brand underline" href={href('/legal/terms')} target="_blank" rel="noreferrer">利用規約</a>と<a className="text-brand underline" href={href('/legal/privacy')} target="_blank" rel="noreferrer">プライバシーポリシー</a>に同意します</span>
              </label>
              <Button type="submit" size="lg" className="w-full" disabled={!name.trim() || !agree} icon={ArrowRight}>無料ではじめる</Button>
              <p className="text-xs text-mute">無料コース：登録から3か月間、毎月1件までAIで指導案を作成できます。</p>
            </form>
          </Card>
        </section>
        <section className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-16">
          {FEATURES.map(([Icon, t, d]) => (
            <Card key={t} className="p-5"><div className="grid place-items-center size-10 rounded-xl bg-brand-soft text-brand-strong mb-3"><Icon className="size-5" /></div><h3 className="font-bold">{t}</h3><p className="text-sm text-mute mt-1 leading-relaxed">{d}</p></Card>
          ))}
        </section>
      </div>
    </div>
  );
}

function Trend({ points }) {
  if (points.length < 2) return <p className="text-sm text-mute py-6 text-center">総合評価が2件以上たまると、点数の推移が表示されます。</p>;
  const w = 520; const h = 150; const pad = 24;
  const x = (i) => pad + (i * (w - pad * 2)) / (points.length - 1);
  const y = (v) => h - pad - (v / 100) * (h - pad * 2);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.v)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" role="img" aria-label="総合評価の推移">
      {[0, 50, 100].map((g) => <g key={g}><line x1={pad} x2={w - pad} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeDasharray="3 4" /><text x={4} y={y(g) + 4} fontSize="10" fill="var(--mute)">{g}</text></g>)}
      <path d={`${d} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill="var(--brand-soft)" opacity=".6" />
      <path d={d} fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinejoin="round" />
      {points.map((p, i) => <g key={i}><circle cx={x(i)} cy={y(p.v)} r="4" fill="var(--surface)" stroke="var(--brand)" strokeWidth="2" /><title>{`${p.label}: ${p.v}点`}</title></g>)}
    </svg>
  );
}

export function Dashboard() {
  const s = useStore();
  const cfg = useConfig();
  const q = quota(s);
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'おはようございます' : hour < 18 ? 'こんにちは' : 'おつかれさまです';
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = s.plans.filter((p) => p.lessonDate && p.lessonDate >= today).sort((a, b) => a.lessonDate.localeCompare(b.lessonDate)).slice(0, 4);
  const recent = [...s.plans].sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)).slice(0, 5);
  const evals = [...s.evaluations].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const points = evals.map((e) => ({ v: e.result?.overallScore ?? 0, label: s.plans.find((p) => p.id === e.planId)?.title || '' }));
  const avgScore = avg(evals.map((e) => e.result?.overallScore).filter((n) => typeof n === 'number'));
  const steps = useMemo(() => [
    ['指導案をつくる', s.plans.length > 0, '/create'],
    ['教材をAIでつくる', s.materials.length > 0, recent[0] ? `/plans/${recent[0].id}?tab=materials` : '/create'],
    ['授業を記録する（ノート・観察・録画）', s.notes.length + s.behaviors.length + s.recordings.length > 0, recent[0] ? `/plans/${recent[0].id}?tab=notes` : '/create'],
    ['総合評価を出す', s.evaluations.length > 0, recent[0] ? `/plans/${recent[0].id}?tab=evaluation` : '/create'],
    ['改善版をつくる', s.versions.length > 0, recent[0] ? `/plans/${recent[0].id}?tab=versions` : '/create'],
  ], [s, recent]);
  const done = steps.filter((x) => x[1]).length;

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-end gap-4 mb-6">
        <div className="flex-1"><p className="text-mute text-sm">{new Date().toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'long' })}</p><h1 className="text-2xl sm:text-3xl font-bold mt-1">{greet}、{s.profile?.name}さん</h1></div>
        <div className="flex gap-2"><Button variant="outline" icon={Files} onClick={() => navigate('/plans')}>一覧</Button><Button icon={FilePlus2} onClick={() => navigate('/create')}>新しい指導案</Button></div>
      </div>

      {cfg.loaded && !cfg.ai && <Notice tone="warn" className="mb-5">いまは<strong>AI見本モード</strong>です。画面や操作はすべて試せますが、AIの結果は見本の定型文です。管理者がサーバーに <code>ANTHROPIC_API_KEY</code> を設定すると、Claude による本番の生成に切り替わります。</Notice>}
      {q.trial.isFree && q.trial.expired && <Notice tone="bad" className="mb-5">無料期間（3か月）が終了しました。AIでの指導案作成を続けるには<a className="underline font-bold" href={href('/subscription')}>プラン</a>をお選びください。</Notice>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="指導案" value={s.plans.length} icon={Files} hint={`お気に入り ${s.plans.filter((p) => p.bookmarked).length}件`} />
        <Stat label="今月のAI作成" value={q.limit === Infinity ? `${q.used}件` : `${q.used} / ${q.limit}`} icon={Sparkles} hint={q.plan.name} />
        <Stat label="授業の記録" value={s.notes.length + s.behaviors.length + s.recordings.length + s.reflections.length} icon={NotebookPen} hint="ノート・観察・録画・会議" />
        <Stat label="平均スコア" value={avgScore ?? '—'} icon={BarChart3} hint={`総合評価 ${evals.length}件`} />
      </div>

      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-5">
        <div className="space-y-5 min-w-0">
          <Card>
            <CardHead icon={Files} title="最近の指導案" right={<a href={href('/plans')} className="text-sm text-brand hover:underline">すべて見る</a>} />
            {recent.length === 0 ? <Empty icon={FilePlus2} title="まだ指導案がありません" desc="最初の指導案をつくってみましょう。入力例を選べば1分で試せます。" action={<Button icon={FilePlus2} onClick={() => navigate('/create')}>指導案をつくる</Button>} /> : (
              <ul className="px-2 pb-2">
                {recent.map((p) => (
                  <li key={p.id}><a href={href(`/plans/${p.id}`)} className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-sunken transition">
                    <span className="grid place-items-center size-10 rounded-xl bg-sunken text-sm font-bold text-brand-strong shrink-0">{(p.subject || '授')[0]}</span>
                    <span className="min-w-0 flex-1"><span className="block font-medium truncate">{p.title}</span><span className="block text-xs text-mute truncate">{[schoolLabel(p.schoolType), p.grade && `${p.grade}年`, p.subject, p.unit].filter(Boolean).join('・')}</span></span>
                    <span className="text-xs text-mute shrink-0">{fmtDate(p.updatedAt || p.createdAt)}</span>
                  </a></li>
                ))}
              </ul>
            )}
          </Card>
          <Card><CardHead icon={BarChart3} title="総合評価の推移" desc="授業ごとの総合スコア" /><div className="px-5 pb-5"><Trend points={points} /></div></Card>
        </div>
        <div className="space-y-5 min-w-0">
          <Card>
            <CardHead icon={Sparkles} title="授業改善サイクル" desc={`${done} / ${steps.length} ステップ完了`} />
            <div className="px-5 pb-2"><div className="h-2 rounded-full bg-sunken overflow-hidden"><div className="h-full bg-brand rounded-full transition-all" style={{ width: `${(done / steps.length) * 100}%` }} /></div></div>
            <ol className="px-3 pb-3 pt-1">
              {steps.map(([label, ok, to], n) => (
                <li key={label}><a href={href(to)} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-sunken text-sm">
                  <span className={`grid place-items-center size-6 rounded-full text-xs font-bold ${ok ? 'bg-good text-white' : 'bg-sunken text-mute'}`}>{ok ? '✓' : n + 1}</span>
                  <span className={ok ? 'text-mute line-through' : ''}>{label}</span>
                </a></li>
              ))}
            </ol>
          </Card>
          <Card>
            <CardHead icon={CalendarDays} title="これからの授業" right={<a href={href('/calendar')} className="text-sm text-brand hover:underline">カレンダー</a>} />
            {upcoming.length === 0 ? <p className="px-5 pb-5 text-sm text-mute">実施日を入れた指導案がここに並びます。</p> : (
              <ul className="px-2 pb-2">{upcoming.map((p) => (
                <li key={p.id}><a href={href(`/plans/${p.id}`)} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-sunken">
                  <span className="text-center w-12 shrink-0"><span className="block text-[0.65rem] text-mute">{new Date(p.lessonDate).toLocaleDateString('ja-JP', { month: 'short' })}</span><span className="block text-lg font-bold leading-none">{new Date(p.lessonDate).getDate()}</span></span>
                  <span className="text-sm truncate">{p.title}</span>
                </a></li>
              ))}</ul>
            )}
          </Card>
          <Card className="p-5">
            <h3 className="font-bold mb-3 flex items-center gap-2"><Keyboard className="size-4" />便利な使い方</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <QuickLink icon={Library} to="/library" label="ライブラリ" />
              <QuickLink icon={BookOpen} to="/papers" label="教育論文" />
              <QuickLink icon={Timer} to="/timer" label="授業タイマー" />
              <QuickLink icon={Users} to="/roster" label="名簿" />
            </div>
            <p className="text-xs text-mute mt-4 leading-relaxed"><kbd className="border border-line rounded px-1">Ctrl</kbd>+<kbd className="border border-line rounded px-1">K</kbd> でどこからでも検索、<kbd className="border border-line rounded px-1">N</kbd> で新規作成。
              <button className="ml-1 text-brand underline" onClick={() => setDisplay({ theme: document.documentElement.classList.contains('dark') ? 'light' : 'dark' })}>{document.documentElement.classList.contains('dark') ? <Sun className="inline size-3" /> : <Moon className="inline size-3" />} 明るさ切替</button></p>
          </Card>
        </div>
      </div>
    </div>
  );
}
const QuickLink = ({ icon: Icon, to, label }) => <a href={href(to)} className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-sunken hover:bg-brand-soft hover:text-brand-strong transition"><Icon className="size-4" />{label}</a>;
