import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Download, Users, Plus, Trash2, Upload, LayoutTemplate, Timer, Play, Pause, RotateCcw, SkipForward, Maximize, FilePlus2, Pencil } from 'lucide-react';
import { useStore, db } from '../lib/store.js';
import { href, navigate } from '../lib/router.js';
import { download, schoolLabel, fmtDate, cx } from '../lib/util.js';
import { planToIcs } from '../lib/exporters.js';
import { Button, Card, Input, Textarea, PageHeader, Empty, Badge, Select, toast, confirmDialog, Modal, Field, Notice } from '../ui.jsx';

// ── カレンダー ──
export function CalendarPage() {
  const plans = useStore((s) => s.plans);
  const [cur, setCur] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const days = useMemo(() => {
    const first = new Date(cur); const start = new Date(first); start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [cur]);
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const byDay = plans.reduce((m, p) => { if (p.lessonDate) (m[p.lessonDate] ||= []).push(p); return m; }, {});
  const today = key(new Date());
  const exportAll = () => {
    const ev = plans.filter((p) => p.lessonDate).map((p) => planToIcs(p, { start: `${p.lessonDate}T09:00`, minutes: (p.schoolType === 'elementary' ? 45 : 50) * (Number(p.teachingHours) || 1) }).split('\r\n').filter((l) => !/^(BEGIN|END):VCALENDAR|^VERSION|^PRODID/.test(l)).join('\r\n'));
    if (!ev.length) { toast('実施日が入った指導案がありません', 'bad'); return; }
    download(new Blob([['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//jugyo-studio//JA', ...ev, 'END:VCALENDAR'].join('\r\n')], { type: 'text/calendar' }), '授業予定.ics');
  };
  return (
    <div>
      <PageHeader icon={CalendarDays} title="カレンダー" desc="実施日を入れた指導案を月ごとに表示" actions={<Button variant="outline" icon={Download} onClick={exportAll}>まとめて .ics に書き出し</Button>} />
      <Card className="p-3 sm:p-5">
        <div className="flex items-center gap-2 mb-4">
          <Button variant="outline" size="sm" icon={ChevronLeft} aria-label="前の月" onClick={() => setCur(new Date(cur.getFullYear(), cur.getMonth() - 1, 1))} />
          <h2 className="text-lg font-bold flex-1 text-center">{cur.getFullYear()}年 {cur.getMonth() + 1}月</h2>
          <Button variant="ghost" size="sm" onClick={() => { const d = new Date(); setCur(new Date(d.getFullYear(), d.getMonth(), 1)); }}>今月</Button>
          <Button variant="outline" size="sm" icon={ChevronRight} aria-label="次の月" onClick={() => setCur(new Date(cur.getFullYear(), cur.getMonth() + 1, 1))} />
        </div>
        <div className="grid grid-cols-7 text-center text-xs text-mute mb-1">{['日', '月', '火', '水', '木', '金', '土'].map((d, i) => <span key={d} className={i === 0 ? 'text-bad' : i === 6 ? 'text-brand' : ''}>{d}</span>)}</div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((d) => { const k = key(d); const list = byDay[k] || []; const out = d.getMonth() !== cur.getMonth(); return (
            <div key={k} className={cx('min-h-[84px] sm:min-h-[104px] rounded-xl border p-1.5 flex flex-col', out ? 'border-transparent bg-sunken/40 text-mute' : 'border-line bg-surface', k === today && 'ring-2 ring-brand')}>
              <div className="flex items-center"><span className="text-xs font-bold">{d.getDate()}</span>{!out && <a href={href(`/create?date=${k}`)} aria-label={`${k}に指導案を作る`} className="ml-auto text-mute hover:text-brand opacity-40 hover:opacity-100"><Plus className="size-3.5" /></a>}</div>
              <div className="space-y-1 mt-1 overflow-hidden">{list.slice(0, 3).map((p) => <a key={p.id} href={href(`/plans/${p.id}`)} className="block text-[0.68rem] leading-tight rounded-md bg-brand-soft text-brand-strong px-1.5 py-1 truncate hover:bg-brand hover:text-on-brand">{p.subject}｜{p.title}</a>)}{list.length > 3 && <span className="text-[0.65rem] text-mute">ほか{list.length - 3}件</span>}</div>
            </div>
          ); })}
        </div>
      </Card>
    </div>
  );
}

// ── 名簿（この端末の中だけに保存。AIには仮名で送る） ──
export function Roster() {
  const roster = useStore((s) => s.roster);
  const [num, setNum] = useState('');
  const [name, setName] = useState('');
  const [bulk, setBulk] = useState(false);
  const [text, setText] = useState('');
  const sorted = [...roster].sort((a, b) => a.number - b.number);
  const add = () => {
    const n = Number(num) || (Math.max(0, ...roster.map((r) => r.number)) + 1);
    if (!name.trim()) return;
    if (roster.some((r) => r.number === n)) { toast(`${n}番はすでに登録されています`, 'bad'); return; }
    db.add('roster', { number: n, name: name.trim().slice(0, 40) }); setName(''); setNum('');
  };
  const importText = () => {
    let next = Math.max(0, ...roster.map((r) => r.number)); let added = 0;
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim(); if (!t) continue;
      const m = /^(\d{1,3})[\s,，、.\t]+(.+)$/.exec(t);
      const n = m ? Number(m[1]) : ++next; const nm = (m ? m[2] : t).replace(/^"|"$/g, '').trim();
      if (!nm || roster.some((r) => r.number === n)) continue;
      db.add('roster', { number: n, name: nm.slice(0, 40) }); added++; next = Math.max(next, n);
    }
    toast(`${added}名を登録しました`); setBulk(false); setText('');
  };
  return (
    <div>
      <PageHeader icon={Users} title="名簿" desc="出席番号と名前。ノート・観察・評価で使います" actions={<>
        <Button variant="outline" icon={Upload} onClick={() => setBulk(true)}>まとめて登録</Button>
        {roster.length > 0 && <Button variant="ghost" icon={Trash2} onClick={async () => { if (await confirmDialog('名簿をすべて削除しますか？', { ok: '削除', danger: true })) db.removeWhere('roster', () => true); }}>全削除</Button>}
      </>} />
      <Notice className="mb-4">名簿はこの端末の中だけに保存されます。AIに送る時は「生徒1」などの仮名に置き換え、結果を受け取った後に名前へ戻します。</Notice>
      <Card className="p-4 mb-4 flex flex-wrap gap-2 items-end">
        <Field label="番号" className="w-24"><Input type="number" min="1" value={num} onChange={(e) => setNum(e.target.value)} placeholder="自動" /></Field>
        <Field label="名前" className="flex-1 min-w-48"><Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="例：山田 花子" /></Field>
        <Button icon={Plus} onClick={add}>追加</Button>
      </Card>
      {sorted.length === 0 ? <Card><Empty icon={Users} title="名簿が空です" desc="1人ずつ追加するか、「まとめて登録」で表計算ソフトからコピーして貼り付けられます。" /></Card> : (
        <Card className="grid sm:grid-cols-2 lg:grid-cols-3 divide-y sm:divide-y-0 divide-line p-2">
          {sorted.map((r) => (
            <div key={r.id} className="group flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-sunken">
              <span className="grid place-items-center size-8 rounded-lg bg-sunken text-sm font-bold tabular-nums">{r.number}</span>
              <input className="flex-1 bg-transparent outline-none text-sm" value={r.name} onChange={(e) => db.update('roster', r.id, { name: e.target.value })} aria-label={`${r.number}番の名前`} />
              <button aria-label="削除" className="opacity-0 group-hover:opacity-100 text-mute hover:text-bad" onClick={() => db.remove('roster', r.id)}><Trash2 className="size-4" /></button>
            </div>
          ))}
        </Card>
      )}
      <Modal open={bulk} onClose={() => setBulk(false)} title="まとめて登録" footer={<Button onClick={importText}>登録</Button>}>
        <p className="text-sm text-mute mb-2">1行に1人。「番号 名前」または名前だけ（番号は自動）。Excel から2列をコピーして貼り付けられます。</p>
        <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'1 青木 太郎\n2 井上 花子\n3 上田 次郎'} />
        <label className="mt-2 inline-flex items-center gap-2 text-sm text-brand cursor-pointer"><Upload className="size-4" />CSVファイルを読み込む<input type="file" accept=".csv,.txt" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} /></label>
      </Modal>
    </div>
  );
}

// ── テンプレート ──
export function Templates() {
  const list = useStore((s) => s.templates);
  const [edit, setEdit] = useState(null);
  return (
    <div>
      <PageHeader icon={LayoutTemplate} title="テンプレート" desc="よく使う条件を保存して、指導案づくりをすばやく" actions={<Button icon={FilePlus2} onClick={() => navigate('/create')}>作成画面へ</Button>} />
      {list.length === 0 ? <Card><Empty icon={LayoutTemplate} title="テンプレートはまだありません" desc="作成画面の「テンプレート保存」で、入力した条件を保存できます。" /></Card> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{list.map((t) => (
          <Card key={t.id} className="p-5 flex flex-col">
            <h3 className="font-bold">{t.name}</h3>
            <p className="text-sm text-mute mt-1 flex-1">{[schoolLabel(t.form.schoolType), t.form.grade && `${t.form.grade}年`, t.form.subject, t.form.unit].filter(Boolean).join('・')}</p>
            <div className="flex flex-wrap gap-1 mt-2">{(t.form.teachingTheory || []).map((x) => <Badge key={x}>{x.replace(/（.*）/, '')}</Badge>)}</div>
            <div className="flex gap-2 mt-4"><Button size="sm" className="flex-1" onClick={() => navigate(`/create?template=${t.id}`)}>使う</Button><Button size="sm" variant="ghost" icon={Pencil} aria-label="名前を変更" onClick={() => setEdit(t)} /><Button size="sm" variant="ghost" icon={Trash2} aria-label="削除" onClick={async () => { if (await confirmDialog(`「${t.name}」を削除しますか？`, { ok: '削除', danger: true })) db.remove('templates', t.id); }} /></div>
          </Card>
        ))}</div>
      )}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title="名前を変更" footer={<Button onClick={() => { db.update('templates', edit.id, { name: edit.name }); setEdit(null); }}>保存</Button>}>
        {edit && <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />}
      </Modal>
    </div>
  );
}

// ── 授業タイマー（指導案の学習過程に沿って進める「授業モード」つき） ──
const parseMinutes = (t) => { const m = /(\d+)\s*[-〜~ー]\s*(\d+)/.exec(t || ''); return m ? Math.max(1, Number(m[2]) - Number(m[1])) : Number((/(\d+)/.exec(t || '') || [])[1]) || 5; };
function beep() { try { const a = new AudioContext(); [0, 0.35, 0.7].forEach((t) => { const o = a.createOscillator(); const g = a.createGain(); o.frequency.value = 880; o.connect(g); g.connect(a.destination); g.gain.setValueAtTime(0.25, a.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + t + 0.3); o.start(a.currentTime + t); o.stop(a.currentTime + t + 0.3); }); } catch { /* 音が出せない環境 */ } }

export function TimerPage({ query }) {
  const plans = useStore((s) => s.plans);
  const plan = plans.find((p) => p.id === query.plan);
  const blocks = useMemo(() => (plan?.generatedContent?.detailedPlan || []).map((b) => ({ ...b, minutes: parseMinutes(b.time) })), [plan]);
  const [idx, setIdx] = useState(0);
  const [custom, setCustom] = useState(5);
  const total = (blocks.length ? blocks[idx]?.minutes : custom) * 60;
  const [left, setLeft] = useState(total);
  const [run, setRun] = useState(false);
  const box = useRef(null);
  useEffect(() => { setLeft(total); setRun(false); }, [total, idx]);
  useEffect(() => {
    if (!run) return undefined;
    const t = setInterval(() => setLeft((x) => { if (x <= 1) { beep(); setRun(false); return 0; } return x - 1; }), 1000);
    return () => clearInterval(t);
  }, [run]);
  const mm = String(Math.floor(left / 60)).padStart(2, '0'); const ss = String(left % 60).padStart(2, '0');
  const ratio = total ? left / total : 0;
  const b = blocks[idx];
  return (
    <div>
      <PageHeader icon={Timer} title={plan ? '授業モード' : '授業タイマー'} desc={plan ? plan.title : '活動ごとの時間を大きく表示。終了時に音でお知らせします'}
        actions={<><Select className="w-auto" value={query.plan || ''} onChange={(e) => navigate(e.target.value ? `/timer?plan=${e.target.value}` : '/timer', { replace: true })} options={plans.map((p) => ({ value: p.id, label: p.title }))} placeholder="指導案を選ばない" />
          <Button variant="outline" icon={Maximize} onClick={() => box.current?.requestFullscreen?.()}>全画面</Button></>} />
      <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
        <Card ref={box} className="p-6 sm:p-10 text-center bg-surface flex flex-col items-center justify-center min-h-[420px]">
          {b && <><Badge tone="brand" className="mb-3">{idx + 1} / {blocks.length}・{b.time}</Badge><h2 className="text-2xl sm:text-3xl font-bold max-w-2xl">{b.activity}</h2></>}
          <div className={cx('font-bold tabular-nums leading-none my-8 text-[clamp(4.5rem,16vw,10rem)]', left === 0 ? 'text-bad' : left <= 60 ? 'text-warn' : 'text-ink')}>{mm}:{ss}</div>
          <div className="w-full max-w-xl h-3 rounded-full bg-sunken overflow-hidden mb-8"><div className="h-full bg-brand transition-all duration-1000" style={{ width: `${ratio * 100}%` }} /></div>
          <div className="flex gap-3">
            <Button size="lg" icon={run ? Pause : Play} onClick={() => setRun(!run)}>{run ? '一時停止' : left === 0 ? '終了' : 'スタート'}</Button>
            <Button size="lg" variant="outline" icon={RotateCcw} onClick={() => { setLeft(total); setRun(false); }}>リセット</Button>
            {blocks.length > 0 && <Button size="lg" variant="soft" icon={SkipForward} disabled={idx >= blocks.length - 1} onClick={() => setIdx(idx + 1)}>次へ</Button>}
          </div>
          {b && <div className="grid sm:grid-cols-2 gap-4 text-left mt-8 w-full max-w-3xl text-sm"><div className="rounded-xl bg-sunken p-4"><p className="text-xs text-mute mb-1">教師の働きかけ</p>{b.teacherAction}</div><div className="rounded-xl bg-sunken p-4"><p className="text-xs text-mute mb-1">児童生徒の活動</p>{b.studentAction}</div></div>}
        </Card>
        <div className="space-y-3">
          {blocks.length ? (
            <Card className="p-2">{blocks.map((x, i) => (
              <button key={i} onClick={() => setIdx(i)} className={cx('w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left', i === idx ? 'bg-brand-soft' : 'hover:bg-sunken')}>
                <span className={cx('grid place-items-center size-6 rounded-full text-xs font-bold', i < idx ? 'bg-good text-white' : i === idx ? 'bg-brand text-on-brand' : 'bg-sunken text-mute')}>{i + 1}</span>
                <span className="flex-1 min-w-0 text-sm truncate">{x.activity}</span><span className="text-xs text-mute">{x.minutes}分</span>
              </button>
            ))}</Card>
          ) : (
            <Card className="p-4">
              <p className="text-sm font-bold mb-2">時間を選ぶ</p>
              <div className="grid grid-cols-3 gap-2">{[1, 3, 5, 10, 15, 20].map((m) => <Button key={m} variant={custom === m ? 'primary' : 'outline'} size="sm" onClick={() => setCustom(m)}>{m}分</Button>)}</div>
              <Field label="任意の分数" className="mt-3"><Input type="number" min="1" max="120" value={custom} onChange={(e) => setCustom(Math.max(1, Math.min(120, Number(e.target.value) || 1)))} /></Field>
              <p className="text-xs text-mute mt-3">指導案を選ぶと、学習過程の時間配分どおりに進められます。</p>
            </Card>
          )}
          {plan && <a className="block text-center text-sm text-brand" href={href(`/plans/${plan.id}`)}>指導案に戻る</a>}
          <p className="text-xs text-mute text-center">{plan?.lessonDate ? `実施日：${fmtDate(plan.lessonDate)}` : ''}</p>
        </div>
      </div>
    </div>
  );
}
