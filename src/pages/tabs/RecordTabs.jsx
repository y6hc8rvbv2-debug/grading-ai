import { useEffect, useRef, useState } from 'react';
import { Video, Mic, Square, Download, Trash2, Play, Upload, Sparkles, MessagesSquare, FileText, Pause } from 'lucide-react';
import { useStore, db, blobs, getDisplay } from '../../lib/store.js';
import { runAi } from '../../lib/ai.js';
import { download, fmtDateTime, planForAi, makeAliases, cx } from '../../lib/util.js';
import { safeName } from '../../lib/exporters.js';
import { Button, Card, CardHead, Field, Input, Textarea, AiProgress, Notice, toast, confirmDialog, Badge, Empty, ScoreRing, Section, BulletList, DemoNote } from '../../ui.jsx';

// ── 音声入力（ブラウザの音声認識。Chrome・Edge・Safari で利用可） ──
export function useDictation(onFinal) {
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const [on, setOn] = useState(false);
  const [interim, setInterim] = useState('');
  const rec = useRef(null); const want = useRef(false); const cb = useRef(onFinal);
  cb.current = onFinal;
  const start = () => {
    if (!SR) return;
    const r = new SR(); r.lang = getDisplay().language === 'en' ? 'en-US' : 'ja-JP'; r.continuous = true; r.interimResults = true;
    r.onresult = (e) => {
      let fin = ''; let mid = '';
      for (let i = e.resultIndex; i < e.results.length; i++) (e.results[i].isFinal ? (fin += e.results[i][0].transcript) : (mid += e.results[i][0].transcript));
      if (fin) cb.current(`${fin}\n`);
      setInterim(mid);
    };
    r.onerror = (e) => { if (e.error === 'not-allowed') { want.current = false; setOn(false); toast('マイクの使用が許可されていません', 'bad'); } };
    r.onend = () => { if (want.current) { try { r.start(); } catch { /* 再開できない時は停止 */ } } else { setOn(false); setInterim(''); } };
    rec.current = r; want.current = true; r.start(); setOn(true);
  };
  const stop = () => { want.current = false; rec.current?.stop(); setOn(false); };
  useEffect(() => () => { want.current = false; rec.current?.stop(); }, []);
  return { supported: Boolean(SR), on, interim, toggle: () => (on ? stop() : start()), stop };
}

const fmtSec = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const fmtSize = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)}MB` : `${Math.round(b / 1e3)}KB`);

export function RecordTab({ plan }) {
  const s = useStore();
  const list = s.recordings.filter((r) => r.planId === plan.id);
  return (
    <div className="grid lg:grid-cols-[380px_1fr] gap-5 items-start">
      <Recorder planId={plan.id} />
      <div className="space-y-3 min-w-0">
        {list.length === 0 ? <Card><Empty icon={Video} title="録画・録音はまだありません" desc="授業や協議会を記録しておくと、振り返りに使えます。データはこの端末の中だけに保存されます。" /></Card>
          : list.map((r) => <RecordingItem key={r.id} r={r} />)}
      </div>
    </div>
  );
}

export function Recorder({ planId }) {
  const [mode, setMode] = useState('video');
  const [rec, setRec] = useState(null);
  const [sec, setSec] = useState(0);
  const [paused, setPaused] = useState(false);
  const preview = useRef(null); const chunks = useRef([]); const stream = useRef(null); const secRef = useRef(0);
  secRef.current = sec;
  useEffect(() => { if (!rec || paused) return undefined; const t = setInterval(() => setSec((x) => x + 1), 1000); return () => clearInterval(t); }, [rec, paused]);
  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);
  const supported = typeof MediaRecorder !== 'undefined' && navigator.mediaDevices?.getUserMedia;

  const start = async () => {
    try {
      const st = await navigator.mediaDevices.getUserMedia(mode === 'video' ? { video: { width: 1280, height: 720 }, audio: true } : { audio: true });
      stream.current = st;
      if (preview.current && mode === 'video') { preview.current.srcObject = st; preview.current.play(); }
      const r = new MediaRecorder(st); chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = async () => {
        const blob = new Blob(chunks.current, { type: r.mimeType || (mode === 'video' ? 'video/webm' : 'audio/webm') });
        st.getTracks().forEach((t) => t.stop());
        if (preview.current) preview.current.srcObject = null;
        await save(blob, mode, secRef.current);
      };
      r.start(1000); setRec(r); setSec(0); setPaused(false);
    } catch { toast('カメラ・マイクを使えませんでした。ブラウザの許可設定をご確認ください。', 'bad'); }
  };
  const save = async (blob, kind, duration) => {
    const row = db.add('recordings', { planId, kind, mime: blob.type, size: blob.size, duration, title: `${kind === 'video' ? '録画' : '録音'} ${new Date().toLocaleString('ja-JP')}` });
    try { await blobs.put(row.id, blob); toast('保存しました'); } catch (e) { db.remove('recordings', row.id); toast(e.message, 'bad'); }
  };
  const stop = () => { rec?.stop(); setRec(null); };
  const importFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    if (!/^(audio|video)\//.test(f.type)) { toast('音声または動画のファイルを選んでください', 'bad'); return; }
    await save(f, f.type.startsWith('video') ? 'video' : 'audio', 0);
  };

  return (
    <Card>
      <CardHead icon={Video} title="録画・録音する" desc="この端末の中だけに保存します" />
      <div className="px-5 pb-5 space-y-3">
        {!supported && <Notice tone="warn">このブラウザは録画・録音に対応していません。</Notice>}
        <div className="grid grid-cols-2 gap-2">
          {[['video', '録画', Video], ['audio', '録音', Mic]].map(([m, l, I]) => <button key={m} disabled={Boolean(rec)} onClick={() => setMode(m)} className={cx('h-10 rounded-xl border text-sm flex items-center justify-center gap-2', mode === m ? 'border-brand bg-brand-soft text-brand-strong font-bold' : 'border-line')}><I className="size-4" />{l}</button>)}
        </div>
        {mode === 'video' && <video ref={preview} muted playsInline className={cx('w-full aspect-video rounded-xl bg-black', !rec && 'hidden')} />}
        {rec && <div className="flex items-center justify-center gap-2 text-2xl font-bold tabular-nums"><span className={cx('size-3 rounded-full bg-bad', !paused && 'animate-pulse')} />{fmtSec(sec)}</div>}
        {!rec ? <Button className="w-full" icon={mode === 'video' ? Video : Mic} disabled={!supported} onClick={start}>{mode === 'video' ? '録画を開始' : '録音を開始'}</Button> : (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" icon={paused ? Play : Pause} onClick={() => { if (paused) rec.resume(); else rec.pause(); setPaused(!paused); }}>{paused ? '再開' : '一時停止'}</Button>
            <Button variant="danger" icon={Square} onClick={stop}>停止して保存</Button>
          </div>
        )}
        <label className="flex items-center justify-center gap-2 h-10 rounded-xl border border-dashed border-line text-sm text-mute hover:border-brand cursor-pointer"><Upload className="size-4" />ファイルから追加<input type="file" accept="audio/*,video/*" className="hidden" onChange={importFile} /></label>
      </div>
    </Card>
  );
}

export function RecordingItem({ r, showPlan }) {
  const [url, setUrl] = useState('');
  const plans = useStore((st) => st.plans);
  useEffect(() => () => url && URL.revokeObjectURL(url), [url]);
  const load = async () => { const b = await blobs.get(r.id); if (!b) { toast('データが見つかりません', 'bad'); return null; } const u = URL.createObjectURL(b); setUrl(u); return b; };
  const dl = async () => { const b = await blobs.get(r.id); if (b) download(b, `${safeName(r.title)}.${(r.mime || '').includes('mp4') ? 'mp4' : 'webm'}`); };
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <span className="grid place-items-center size-10 rounded-xl bg-brand-soft text-brand-strong">{r.kind === 'video' ? <Video className="size-5" /> : <Mic className="size-5" />}</span>
        <div className="flex-1 min-w-0"><p className="font-medium truncate">{r.title}</p><p className="text-xs text-mute">{[r.duration ? fmtSec(r.duration) : '', fmtSize(r.size || 0), showPlan && plans.find((p) => p.id === r.planId)?.title].filter(Boolean).join('・')}</p></div>
        {!url && <Button size="sm" variant="soft" icon={Play} onClick={load}>再生</Button>}
        <Button size="sm" variant="outline" icon={Download} onClick={dl} aria-label="ダウンロード" />
        <Button size="sm" variant="ghost" icon={Trash2} aria-label="削除" onClick={async () => { if (await confirmDialog('この記録を削除しますか？', { ok: '削除', danger: true })) { blobs.del(r.id); db.remove('recordings', r.id); } }} />
      </div>
      {url && (r.kind === 'video' ? <video src={url} controls autoPlay className="w-full mt-3 rounded-xl bg-black" /> : <audio src={url} controls autoPlay className="w-full mt-3" />)}
    </Card>
  );
}

// ── 振り返り会議 ──
export function ReflectionTab({ plan }) {
  const s = useStore();
  const list = s.reflections.filter((r) => r.planId === plan.id);
  const [count, setCount] = useState(4);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState('');
  const [open, setOpen] = useState(list[0]?.id);
  const dict = useDictation((t) => setText((x) => x + t));
  const current = list.find((r) => r.id === open);
  const roster = s.roster.map((r) => r.name);

  const analyze = async () => {
    if (text.trim().length < 30) { toast('文字起こしをもう少し入力してください（30文字以上）', 'bad'); return; }
    dict.stop(); setBusy(true); setStream('');
    try {
      const a = makeAliases(roster); // 発言内の児童生徒名を仮名にしてから送る
      const { result, demo } = await runAi('reflection', { plan: planForAi(plan), participantCount: count, transcript: a.hide(text) }, { onText: setStream });
      const row = db.add('reflections', { planId: plan.id, participantCount: count, transcript: text, result: a.restoreDeep(result), demo });
      setOpen(row.id); setText(''); toast('振り返りをまとめました');
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  const importText = async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { const t = await f.text(); setText((x) => x + t); } };

  return (
    <div className="grid lg:grid-cols-[400px_1fr] gap-5 items-start">
      <div className="space-y-4">
        <Card>
          <CardHead icon={MessagesSquare} title="協議会の記録" desc="話しながら文字起こし、または貼り付け" />
          <div className="px-5 pb-5 space-y-3">
            <Field label="参加者数"><Input type="number" min="1" value={count} onChange={(e) => setCount(e.target.value)} /></Field>
            <div className="flex gap-2">
              <Button variant={dict.on ? 'danger' : 'soft'} icon={dict.on ? Square : Mic} disabled={!dict.supported} onClick={dict.toggle} className="flex-1">{dict.on ? '文字起こしを停止' : '音声で文字起こし'}</Button>
              <label className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl border border-line text-sm cursor-pointer hover:bg-sunken"><FileText className="size-4" />テキスト読込<input type="file" accept=".txt,.vtt,.srt,text/*" className="hidden" onChange={importText} /></label>
            </div>
            {!dict.supported && <p className="text-xs text-mute">このブラウザは音声入力に対応していません（Chrome・Edge・Safariで利用できます）。</p>}
            <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="協議会での発言を入力・貼り付け。オンライン会議の文字起こしファイル（.txt / .vtt）も読み込めます。" />
            {dict.on && <p className="text-xs text-brand animate-pulse">● 聞き取り中… {dict.interim}</p>}
            <p className="text-xs text-mute">{text.length.toLocaleString()}文字・名簿の名前は仮名に置き換えてAIに送ります</p>
            <Button className="w-full" icon={Sparkles} loading={busy} onClick={analyze}>AIで要約・分析</Button>
          </div>
        </Card>
        {list.length > 0 && <Card className="p-2">{list.map((r) => (
          <button key={r.id} onClick={() => setOpen(r.id)} className={cx('w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-left', open === r.id ? 'bg-brand-soft' : 'hover:bg-sunken')}>
            <span className="text-sm flex-1 truncate">{r.result?.meetingTitle || '振り返り'}</span>{r.demo && <Badge tone="warn">見本</Badge>}<span className="text-xs text-mute">{fmtDateTime(r.createdAt)}</span>
          </button>
        ))}</Card>}
      </div>
      <div className="min-w-0">
        {busy && <AiProgress text={stream} label="協議の内容をまとめています" />}
        {!busy && current && <ReflectionView r={current} />}
        {!busy && !current && <Card><Empty icon={MessagesSquare} title="振り返りはまだありません" desc="授業後の協議会の発言を記録すると、要点・良かった点・改善点・次の行動をAIが整理します。" /></Card>}
      </div>
    </div>
  );
}

export function ReflectionView({ r }) {
  const x = r.result || {}; const ai = x.aiAdvice || {};
  return (
    <Card className="p-5 sm:p-6">
      <DemoNote show={r.demo} />
      <div className="flex items-start gap-4 mb-5">
        <div className="flex-1"><h3 className="text-xl font-bold">{x.meetingTitle}</h3><p className="text-sm text-mute mt-1">{fmtDateTime(r.createdAt)}・参加者{r.participantCount}名</p><p className="mt-3 leading-relaxed">{x.overallSummary}</p></div>
        <ScoreRing value={ai.score} label="達成度" />
      </div>
      <div className="grid md:grid-cols-2 gap-x-6">
        <Section title="協議の要点"><BulletList items={x.keyPoints} /></Section>
        <Section title="次への行動"><BulletList items={x.actionItems} /></Section>
        <Section title="良かった点"><BulletList items={x.positives} tone="good" /></Section>
        <Section title="改善点"><BulletList items={x.improvements} tone="warn" /></Section>
      </div>
      <div className="rounded-2xl bg-brand-soft/50 p-5 mt-2">
        <h4 className="font-bold text-brand-strong mb-2">AIからの助言</h4>
        <p className="leading-relaxed text-[0.95rem]">{ai.overallFeedback}</p>
        <div className="grid md:grid-cols-3 gap-4 mt-4 text-sm">
          <div><p className="font-bold mb-1">強み</p><BulletList items={ai.teacherStrengths} tone="good" /></div>
          <div><p className="font-bold mb-1">提案</p><BulletList items={ai.improvementSuggestions} /></div>
          <div><p className="font-bold mb-1">次のステップ</p><BulletList items={ai.nextSteps} /></div>
        </div>
        {ai.scoreReason && <p className="text-xs text-mute mt-4">点数の理由：{ai.scoreReason}</p>}
      </div>
      {r.transcript && <details className="mt-5"><summary className="cursor-pointer text-sm text-mute">文字起こしを表示</summary><p className="prose-ja text-sm mt-2 bg-sunken rounded-xl p-4 max-h-80 overflow-y-auto scroll-thin">{r.transcript}</p></details>}
      <div className="mt-4 flex justify-end"><Button size="sm" variant="ghost" icon={Trash2} onClick={async () => { if (await confirmDialog('この振り返りを削除しますか？', { ok: '削除', danger: true })) db.remove('reflections', r.id); }}>削除</Button></div>
    </Card>
  );
}
