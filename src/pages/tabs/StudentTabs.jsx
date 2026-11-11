import { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { NotebookPen, Camera, Sparkles, Trash2, QrCode, Eye, HeartHandshake, Mic, Square, Users, ImagePlus, X, RefreshCw } from 'lucide-react';
import { useStore, db } from '../../lib/store.js';
import { runAi } from '../../lib/ai.js';
import { api, useConfig } from '../../lib/api.js';
import { href } from '../../lib/router.js';
import { shrinkImage, makeAliases, planForAi, fmtDateTime, avg, cx } from '../../lib/util.js';
import { SPECIAL_NEEDS_GUIDES } from '../../lib/content.js';
import { Button, Card, CardHead, Field, Input, Select, Textarea, AiProgress, Notice, toast, confirmDialog, Badge, Empty, ScoreRing, Section, BulletList, DemoNote, Modal, Bar } from '../../ui.jsx';
import { useDictation } from './RecordTabs.jsx';

const STEP_TONE = { understanding: ['理解', 'bg-brand-soft text-brand-strong'], application: ['応用', 'bg-good-soft text-good'], analysis: ['分析', 'bg-brand-soft text-brand-strong'], creation: ['創造', 'bg-good-soft text-good'], confusion: ['迷い', 'bg-warn-soft text-warn'] };
const LEVEL = { high: '高い', medium: 'ふつう', low: '支援が必要' };

// 名簿から選ぶ／自由に入力する、どちらにも対応した児童生徒の選択欄
function StudentPicker({ value, onChange }) {
  const roster = useStore((s) => s.roster);
  if (!roster.length) return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="例：3番 または 山田" />;
  return <Select value={value} onChange={(e) => onChange(e.target.value)} options={[...roster].sort((a, b) => a.number - b.number).map((r) => ({ value: r.name, label: `${r.number}. ${r.name}` }))} placeholder="名簿から選ぶ" />;
}

export function NotesTab({ plan }) {
  const s = useStore();
  const notes = s.notes.filter((n) => n.planId === plan.id);
  const [who, setWho] = useState('');
  const [image, setImage] = useState('');
  const [speech, setSpeech] = useState('');
  const [busy, setBusy] = useState('');
  const [stream, setStream] = useState('');
  const [open, setOpen] = useState(null);
  const [qr, setQr] = useState(false);
  const dict = useDictation((t) => setSpeech((x) => x + t));
  const names = s.roster.map((r) => r.name);
  const reflection = s.reflections.find((r) => r.planId === plan.id);

  const pick = async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { try { setImage(await shrinkImage(f)); } catch (err) { toast(err.message, 'bad'); } } };
  const analyze = async (note) => {
    setBusy(note.id); setStream('');
    try {
      const a = makeAliases([...names, note.studentName]);
      const { result, demo } = await runAi('analyzeNote', { plan: planForAi(plan), studentLabel: a.alias(note.studentName), speech: a.hide(note.speech), image: note.image, transcript: reflection ? a.hide(reflection.transcript).slice(0, 6000) : '' }, { onText: setStream });
      db.update('notes', note.id, { result: a.restoreDeep(result), demo });
      setOpen(note.id);
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(''); }
  };
  const add = async (andAnalyze) => {
    if (!who.trim() || !image) { toast('児童生徒とノートの写真を選んでください', 'bad'); return; }
    dict.stop();
    const row = db.add('notes', { planId: plan.id, studentName: who.trim(), image, speech, result: null });
    setImage(''); setSpeech(''); setWho('');
    if (andAnalyze) await analyze(row); else toast('ノートを保存しました');
  };
  const analyzeAll = async () => { for (const n of notes.filter((x) => !x.result)) await analyze(n); };
  const current = notes.find((n) => n.id === open);
  const pending = notes.filter((n) => !n.result).length;
  const scores = notes.map((n) => n.result?.score).filter((x) => typeof x === 'number');

  return (
    <div className="grid lg:grid-cols-[360px_1fr] gap-5 items-start">
      <div className="space-y-4">
        <Card>
          <CardHead icon={NotebookPen} title="ノートを追加" desc="写真から思考の流れと理解度を分析" />
          <div className="px-5 pb-5 space-y-3">
            <Field label="児童生徒"><StudentPicker value={who} onChange={setWho} /></Field>
            {image ? (
              <div className="relative"><img src={image} alt="ノートの写真" className="w-full rounded-xl border border-line" /><button aria-label="写真を外す" onClick={() => setImage('')} className="absolute top-2 right-2 grid place-items-center size-8 rounded-full bg-black/60 text-white"><X className="size-4" /></button></div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-2 h-36 rounded-xl border-2 border-dashed border-line text-mute hover:border-brand hover:text-brand cursor-pointer"><Camera className="size-7" /><span className="text-sm">写真を撮る・選ぶ</span><input type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} /></label>
            )}
            <Field label="発言の記録（任意）"><div className="flex gap-2"><Textarea rows={2} value={speech} onChange={(e) => setSpeech(e.target.value)} placeholder="授業中の発言など" />{dict.supported && <Button variant={dict.on ? 'danger' : 'outline'} icon={dict.on ? Square : Mic} aria-label="音声入力" onClick={dict.toggle} className="self-start" />}</div></Field>
            <div className="grid grid-cols-2 gap-2"><Button variant="outline" onClick={() => add(false)}>保存のみ</Button><Button icon={Sparkles} loading={Boolean(busy)} onClick={() => add(true)}>保存して分析</Button></div>
            <p className="text-xs text-mute">名前は「生徒1」などの仮名に置き換えてAIに送ります。写真は端末で縮小します。</p>
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="font-bold text-sm mb-1 flex items-center gap-1.5"><QrCode className="size-4" />児童生徒のスマホから提出</h3>
          <p className="text-xs text-mute mb-3">QRコードを読み取ると、出席番号と写真だけを送れる画面が開きます。</p>
          <Button variant="soft" className="w-full" icon={QrCode} onClick={() => setQr(true)}>提出の受付</Button>
        </Card>
      </div>
      <div className="min-w-0 space-y-4">
        {notes.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="brand">{notes.length}件</Badge>{scores.length > 0 && <Badge>平均 {avg(scores)}点</Badge>}
            <span className="flex-1" />{pending > 0 && <Button size="sm" variant="soft" icon={Sparkles} loading={Boolean(busy)} onClick={analyzeAll}>未分析の{pending}件をまとめて分析</Button>}
          </div>
        )}
        {busy && <AiProgress text={stream} label="ノートを読み取っています" />}
        {notes.length === 0 && !busy && <Card><Empty icon={NotebookPen} title="ノートはまだありません" desc="ノートの写真を追加すると、AIが記述から思考の流れを読み取り、理解度とフィードバックを返します。" /></Card>}
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {notes.map((n) => (
            <button key={n.id} onClick={() => (n.result ? setOpen(n.id) : analyze(n))} className={cx('text-left rounded-2xl border bg-surface overflow-hidden hover:shadow-md transition', open === n.id ? 'border-brand' : 'border-line')}>
              <img src={n.image} alt="" className="w-full h-32 object-cover bg-sunken" />
              <div className="p-3 flex items-center gap-2">
                <span className="flex-1 min-w-0"><span className="block font-medium truncate">{n.studentName}</span><span className="block text-xs text-mute">{n.fromUpload ? 'スマホから提出・' : ''}{fmtDateTime(n.createdAt)}</span></span>
                {n.result ? <Badge tone={n.result.score >= 80 ? 'good' : n.result.score >= 60 ? 'brand' : 'warn'}>{n.result.score}点</Badge> : <Badge>未分析</Badge>}
              </div>
            </button>
          ))}
        </div>
        {current?.result && <NoteView n={current} onClose={() => setOpen(null)} />}
      </div>
      <UploadSession open={qr} onClose={() => setQr(false)} plan={plan} />
    </div>
  );
}

function NoteView({ n, onClose }) {
  const r = n.result; const a = r.analysis || {};
  return (
    <Card className="p-5 sm:p-6 rise">
      <DemoNote show={n.demo} />
      <div className="flex items-start gap-4 mb-4">
        <div className="flex-1"><h3 className="text-xl font-bold">{n.studentName}さんのノート</h3><div className="flex gap-2 mt-2"><Badge tone="brand">理解度：{LEVEL[a.comprehensionLevel] || a.comprehensionLevel}</Badge><Badge>ノートの質：{a.noteQuality}</Badge></div></div>
        <ScoreRing value={r.score} label="理解度" />
      </div>
      <Section title="思考の流れ">
        <ol className="space-y-2">{(r.thinkingProcess?.steps || []).map((st) => (
          <li key={st.order} className="flex gap-3"><span className={cx('shrink-0 text-xs font-bold rounded-lg px-2 py-1 h-fit', STEP_TONE[st.type]?.[1] || 'bg-sunken')}>{st.order}. {STEP_TONE[st.type]?.[0] || st.type}</span><span className="text-sm"><strong>{st.label}</strong>：{st.description}</span></li>
        ))}</ol>
        <p className="text-sm text-mute mt-2">{r.thinkingProcess?.summary}</p>
      </Section>
      <div className="grid md:grid-cols-2 gap-x-6"><Section title="強み"><BulletList items={a.strengths} tone="good" /></Section><Section title="課題"><BulletList items={a.weaknesses} tone="warn" /></Section></div>
      <Section title="本人へのフィードバック"><p className="rounded-xl bg-brand-soft/50 p-4 leading-relaxed">{r.feedback}</p></Section>
      {a.keyObservations && <Section title="先生向けの観察"><p className="text-sm leading-relaxed">{a.keyObservations}</p></Section>}
      {n.speech && <Section title="発言の記録"><p className="text-sm prose-ja">{n.speech}</p></Section>}
      <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={onClose}>閉じる</Button><Button size="sm" variant="ghost" icon={Trash2} onClick={async () => { if (await confirmDialog('このノートを削除しますか？', { ok: '削除', danger: true })) { db.remove('notes', n.id); onClose(); } }}>削除</Button></div>
    </Card>
  );
}

// ── QRコードでの提出受付（先生の端末が定期的に受け取り、サーバーからは消える） ──
function UploadSession({ open, onClose, plan }) {
  const cfg = useConfig();
  const s = useStore();
  const session = s.sessions.find((x) => x.planId === plan.id && x.active && new Date(x.expiresAt) > new Date());
  const [busy, setBusy] = useState(false);
  const [got, setGot] = useState(0);
  const timer = useRef(null);
  const url = session ? `${location.origin}${location.pathname}#/upload/${session.code}` : '';

  const pull = async () => {
    if (!session) return;
    try {
      const { items } = await api('up.pull', { code: session.code });
      for (const it of items) {
        const r = s.roster.find((x) => String(x.number) === String(it.number));
        db.add('notes', { planId: plan.id, studentName: r ? r.name : `${it.number}番`, image: it.image, speech: it.speech, result: null, fromUpload: true });
      }
      if (items.length) { setGot((x) => x + items.length); toast(`${items.length}件の提出を受け取りました`); }
    } catch (e) { if (e.message === 'SESSION_NOT_FOUND') db.update('sessions', session.id, { active: false }); }
  };
  useEffect(() => {
    if (!session) return undefined;
    timer.current = setInterval(pull, 6000);
    return () => clearInterval(timer.current);
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setBusy(true);
    try {
      const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
      const meta = await api('up.create', { code, subject: plan.subject, unit: plan.unit, grade: plan.grade });
      db.add('sessions', { planId: plan.id, code, expiresAt: meta.expiresAt, active: true });
    } catch (e) { toast(e.message === 'STORE_NOT_CONFIGURED' ? '共有データの置き場が未設定です' : e.message, 'bad'); } finally { setBusy(false); }
  };
  const close = async () => { await pull(); try { await api('up.close', { code: session.code }); } catch { /* 期限切れ */ } db.update('sessions', session.id, { active: false }); toast('受付を終了しました'); };

  return (
    <Modal open={open} onClose={onClose} title="児童生徒からの提出">
      {!cfg.store ? <Notice tone="warn">この機能は、管理者が共有データの置き場（Upstash Redis）を設定すると使えます。それまでは先生の端末からノートを追加してください。</Notice> : !session ? (
        <div className="space-y-3 text-sm">
          <p>受付を始めるとQRコードが表示されます。児童生徒は読み取って、<strong>出席番号</strong>と<strong>ノートの写真</strong>を送ります。</p>
          <ul className="list-disc pl-5 text-mute space-y-1"><li>氏名は送りません（名簿の出席番号と、この端末の中で対応付けます）</li><li>受付は最長2時間。受け取った提出はサーバーから自動で消えます</li></ul>
          <Button className="w-full" icon={QrCode} loading={busy} onClick={start}>受付を開始</Button>
        </div>
      ) : (
        <div className="text-center space-y-3">
          <div className="inline-block bg-white p-4 rounded-2xl"><QRCodeSVG value={url} size={220} /></div>
          <p className="text-3xl font-bold tracking-[0.3em] font-mono">{session.code}</p>
          <p className="text-xs text-mute break-all">{url}</p>
          <p className="text-sm">受け取り済み：<strong>{got}</strong>件・{new Date(session.expiresAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}まで</p>
          <div className="flex gap-2 justify-center"><Button variant="outline" icon={RefreshCw} onClick={pull}>今すぐ受け取る</Button><a className="inline-flex items-center h-10 px-4 rounded-xl border border-line text-sm" href={href(`/upload/${session.code}`)} target="_blank" rel="noreferrer">提出画面を確認</a><Button variant="danger" onClick={close}>受付を終了</Button></div>
        </div>
      )}
    </Modal>
  );
}

// ── 授業観察 ──
export function ObserveTab({ plan }) {
  const s = useStore();
  const list = s.behaviors.filter((b) => b.planId === plan.id);
  const [images, setImages] = useState([]);
  const [names, setNames] = useState(() => s.roster.slice(0, 40).map((r) => r.name).join('\n'));
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState('');
  const [open, setOpen] = useState(list[0]?.id);
  const current = list.find((b) => b.id === open);

  const pick = async (e) => {
    const files = [...(e.target.files || [])].slice(0, 4 - images.length); e.target.value = '';
    for (const f of files) { try { const d = await shrinkImage(f, 1000, 0.7); setImages((x) => [...x, d].slice(0, 4)); } catch (err) { toast(err.message, 'bad'); } }
  };
  const analyze = async () => {
    const students = names.split(/\n|、|,/).map((x) => x.trim()).filter(Boolean).slice(0, 40);
    if (!images.length) { toast('教室の写真を1枚以上選んでください', 'bad'); return; }
    if (!students.length) { toast('対象の児童生徒を入力してください', 'bad'); return; }
    setBusy(true); setStream('');
    try {
      const a = makeAliases(students);
      const { result, demo } = await runAi('behavior', { plan: planForAi(plan), students: students.map(a.alias), images }, { onText: setStream });
      const row = db.add('behaviors', { planId: plan.id, students, images, result: a.restoreDeep(result), demo });
      setOpen(row.id); setImages([]); toast('観察結果をまとめました');
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };

  return (
    <div className="grid lg:grid-cols-[360px_1fr] gap-5 items-start">
      <div className="space-y-4">
        <Card>
          <CardHead icon={Eye} title="授業の様子を分析" desc="写真から意欲・態度を補助的に評価" />
          <div className="px-5 pb-5 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {images.map((src, i) => <div key={i} className="relative"><img src={src} alt="" className="w-full h-24 object-cover rounded-xl" /><button aria-label="外す" onClick={() => setImages(images.filter((_, j) => j !== i))} className="absolute top-1 right-1 grid place-items-center size-6 rounded-full bg-black/60 text-white"><X className="size-3" /></button></div>)}
              {images.length < 4 && <label className="flex flex-col items-center justify-center gap-1 h-24 rounded-xl border-2 border-dashed border-line text-mute hover:border-brand cursor-pointer text-xs"><ImagePlus className="size-5" />写真（最大4枚）<input type="file" accept="image/*" multiple className="hidden" onChange={pick} /></label>}
            </div>
            <Field label="対象の児童生徒（1行に1人）" hint={s.roster.length ? '名簿から読み込みました' : '名簿を登録すると自動で入ります'}><Textarea rows={5} value={names} onChange={(e) => setNames(e.target.value)} /></Field>
            <Button className="w-full" icon={Sparkles} loading={busy} onClick={analyze}>AIで分析</Button>
            <Notice tone="mute">写真から個人を特定することはしません。全体の様子からの参考評価です。名前は仮名に置き換えて送ります。</Notice>
          </div>
        </Card>
        {list.length > 0 && <Card className="p-2">{list.map((b) => (
          <button key={b.id} onClick={() => setOpen(b.id)} className={cx('w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-left', open === b.id ? 'bg-brand-soft' : 'hover:bg-sunken')}><span className="text-sm flex-1">観察 {b.students.length}名</span>{b.demo && <Badge tone="warn">見本</Badge>}<span className="text-xs text-mute">{fmtDateTime(b.createdAt)}</span></button>
        ))}</Card>}
      </div>
      <div className="min-w-0">
        {busy && <AiProgress text={stream} label="写真を読み取っています" />}
        {!busy && current && (
          <Card className="p-5 sm:p-6">
            <DemoNote show={current.demo} />
            <div className="flex gap-2 mb-4 overflow-x-auto">{current.images.map((src, i) => <img key={i} src={src} alt="" className="h-20 rounded-lg" />)}</div>
            <div className="grid sm:grid-cols-2 gap-4 mb-5">
              <Bar label="学習意欲（平均）" value={avg(current.result.evaluations.map((e) => e.motivationScore))} />
              <Bar label="学習態度（平均）" value={avg(current.result.evaluations.map((e) => e.attitudeScore))} />
            </div>
            <p className="rounded-xl bg-brand-soft/50 p-4 leading-relaxed mb-5">{current.result.overallFeedback}</p>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-mute border-b border-line"><th className="py-2 pr-3">名前</th><th className="pr-3">意欲</th><th className="pr-3">態度</th><th className="pr-3">観察</th><th>支援の方向</th></tr></thead>
              <tbody>{current.result.evaluations.map((e, i) => <tr key={i} className="border-b border-line align-top"><td className="py-2 pr-3 font-medium whitespace-nowrap">{e.studentName}</td><td className="pr-3 tabular-nums">{e.motivationScore}</td><td className="pr-3 tabular-nums">{e.attitudeScore}</td><td className="pr-3">{e.observations}</td><td>{e.improvements}</td></tr>)}</tbody>
            </table></div>
            <div className="flex justify-end mt-4"><Button size="sm" variant="ghost" icon={Trash2} onClick={async () => { if (await confirmDialog('この観察記録を削除しますか？', { ok: '削除', danger: true })) db.remove('behaviors', current.id); }}>削除</Button></div>
          </Card>
        )}
        {!busy && !current && <Card><Empty icon={Users} title="観察記録はまだありません" desc="授業中の教室の写真から、学習意欲・学習態度の傾向をAIがまとめます。" /></Card>}
      </div>
    </div>
  );
}

// ── 特別支援 ──
export function SpecialTab({ plan }) {
  const s = useStore();
  const list = s.specialNeeds.filter((x) => x.planId === plan.id);
  const [who, setWho] = useState('');
  const [type, setType] = useState('');
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState('');
  const [open, setOpen] = useState(list[0]?.id);
  const current = list.find((x) => x.id === open);
  const guide = SPECIAL_NEEDS_GUIDES.find((g) => g.label === type);
  const evidence = useMemo(() => {
    const n = s.notes.filter((x) => x.planId === plan.id && x.studentName === who && x.result);
    const b = s.behaviors.filter((x) => x.planId === plan.id).flatMap((x) => x.result?.evaluations || []).filter((e) => e.studentName === who);
    return { notes: n, behaviors: b };
  }, [s.notes, s.behaviors, plan.id, who]);

  const analyze = async () => {
    if (!who.trim()) { toast('対象の児童生徒を選んでください', 'bad'); return; }
    setBusy(true); setStream('');
    try {
      const a = makeAliases([...s.roster.map((r) => r.name), who]);
      const noteSummary = evidence.notes.map((n) => `理解度${n.result.score}点：${n.result.thinkingProcess?.summary}／${n.result.analysis?.keyObservations}`).join('\n');
      const behaviorSummary = evidence.behaviors.map((e) => `意欲${e.motivationScore}・態度${e.attitudeScore}：${e.observations}`).join('\n');
      const { result, demo } = await runAi('specialNeeds', { plan: planForAi(plan), studentLabel: a.alias(who), disabilityType: type, noteSummary: a.hide(noteSummary), behaviorSummary: a.hide(behaviorSummary) }, { onText: setStream });
      const row = db.add('specialNeeds', { planId: plan.id, studentName: who, disabilityType: type, result: a.restoreDeep(result), demo });
      setOpen(row.id);
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };

  return (
    <div className="grid lg:grid-cols-[360px_1fr] gap-5 items-start">
      <div className="space-y-4">
        <Card>
          <CardHead icon={HeartHandshake} title="個別の見立て" desc="ノート・観察の記録をもとに助言を作成" />
          <div className="px-5 pb-5 space-y-3">
            <Field label="児童生徒"><StudentPicker value={who} onChange={setWho} /></Field>
            <Field label="把握している特性"><Select value={type} onChange={(e) => setType(e.target.value)} options={[...SPECIAL_NEEDS_GUIDES.map((g) => g.label), 'その他・詳細不明']} placeholder="選んでください（任意）" /></Field>
            {who && <p className="text-xs text-mute">使える記録：ノート {evidence.notes.length}件・観察 {evidence.behaviors.length}件</p>}
            <Button className="w-full" icon={Sparkles} loading={busy} onClick={analyze}>AIで見立てを作成</Button>
            <Notice tone="mute">教育的な見立てであり、医学的な診断ではありません。</Notice>
          </div>
        </Card>
        {guide && <Card className="p-4"><h3 className="font-bold text-sm mb-2">{guide.label}への手立て</h3><BulletList items={guide.tips} /></Card>}
        {list.length > 0 && <Card className="p-2">{list.map((x) => (
          <button key={x.id} onClick={() => setOpen(x.id)} className={cx('w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-left', open === x.id ? 'bg-brand-soft' : 'hover:bg-sunken')}><span className="text-sm flex-1">{x.studentName}</span>{x.demo && <Badge tone="warn">見本</Badge>}<span className="text-xs text-mute">{fmtDateTime(x.createdAt)}</span></button>
        ))}</Card>}
      </div>
      <div className="min-w-0">
        {busy && <AiProgress text={stream} label="見立てを作成しています" />}
        {!busy && current && (() => { const r = current.result; const st = r.supportStrategies || {}; return (
          <Card className="p-5 sm:p-6">
            <DemoNote show={current.demo} />
            <div className="flex items-start gap-4 mb-4"><div className="flex-1"><h3 className="text-xl font-bold">{current.studentName}さん</h3><p className="text-sm text-mute">{current.disabilityType || '特性：未指定'}</p></div><ScoreRing value={r.comprehensionScore} label="理解度" /></div>
            <Section title="理解の状況"><p className="leading-relaxed">{r.comprehensionAssessment}</p></Section>
            <Section title="担任への助言"><p className="leading-relaxed">{r.teacherAdvice}</p></Section>
            <div className="grid sm:grid-cols-2 gap-3 mb-5">{[['environmentalSupport', '環境面'], ['instructionalSupport', '指導面'], ['socialSupport', '対人関係面'], ['emotionalSupport', '情緒面']].map(([k, l]) => <div key={k} className="rounded-xl bg-sunken p-4"><p className="text-xs font-bold text-brand-strong mb-1">{l}</p><p className="text-sm leading-relaxed">{st[k]}</p></div>)}</div>
            <Section title="本人へのフィードバック"><p className="rounded-xl bg-brand-soft/50 p-4">{r.feedback}</p></Section>
            <div className="flex justify-end"><Button size="sm" variant="ghost" icon={Trash2} onClick={async () => { if (await confirmDialog('この見立てを削除しますか？', { ok: '削除', danger: true })) db.remove('specialNeeds', current.id); }}>削除</Button></div>
          </Card>
        ); })()}
        {!busy && !current && <Card><Empty icon={HeartHandshake} title="個別の見立てはまだありません" desc="ノート分析や授業観察の記録があると、より根拠のある見立てになります。" /></Card>}
      </div>
    </div>
  );
}
