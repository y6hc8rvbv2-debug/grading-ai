// 児童生徒がスマホから開く提出画面（登録不要。氏名は送らず、出席番号だけ）
import { useEffect, useState } from 'react';
import { Camera, Send, CheckCircle2, X, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { shrinkImage } from '../lib/util.js';
import { Button, Card, Input, Textarea, Field, Notice } from '../ui.jsx';

export default function StudentUpload({ code }) {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [number, setNumber] = useState('');
  const [image, setImage] = useState('');
  const [speech, setSpeech] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => { api('up.info', { code }).then(setInfo).catch((e) => setErr(e.message === 'SESSION_NOT_FOUND' ? '受付が終了しているか、コードが正しくありません。先生に確認してください。' : e.message)); }, [code]);
  const pick = async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { try { setImage(await shrinkImage(f, 1100, 0.7)); } catch (x) { setErr(x.message); } } };
  const send = async () => {
    setBusy(true); setErr('');
    try { await api('up.submit', { code, number, image, speech }); setDone(true); } catch (e) { setErr(e.message === 'SESSION_NOT_FOUND' ? '受付が終了しました。' : e.message); } finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen px-4 py-8 flex justify-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-6"><span className="inline-grid place-items-center size-12 rounded-2xl bg-brand text-on-brand mb-3"><Camera className="size-6" /></span><h1 className="text-2xl font-bold">ノートを提出</h1>{info && <p className="text-mute mt-1">{[info.grade && `${info.grade}年`, info.subject, info.unit].filter(Boolean).join('・')}</p>}</div>
        {!info && !err && <div className="text-center text-mute"><Loader2 className="size-6 animate-spin mx-auto" /></div>}
        {err && <Notice tone="bad" className="mb-4">{err}</Notice>}
        {done ? (
          <Card className="p-8 text-center"><CheckCircle2 className="size-14 text-good mx-auto" /><p className="text-xl font-bold mt-3">提出できました！</p><p className="text-mute mt-1">先生に届きました。</p><Button variant="outline" className="mt-6" onClick={() => { setDone(false); setImage(''); setSpeech(''); }}>もう1枚送る</Button></Card>
        ) : info && (
          <Card className="p-5 space-y-4">
            <Field label="出席番号" required hint="名前は書かなくて大丈夫です"><Input inputMode="numeric" pattern="[0-9]*" value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, '').slice(0, 3))} className="text-2xl h-14 text-center tracking-widest" placeholder="12" /></Field>
            {image ? <div className="relative"><img src={image} alt="ノートの写真" className="w-full rounded-xl" /><button aria-label="撮り直す" onClick={() => setImage('')} className="absolute top-2 right-2 grid place-items-center size-9 rounded-full bg-black/60 text-white"><X className="size-5" /></button></div>
              : <label className="flex flex-col items-center justify-center gap-2 h-44 rounded-2xl border-2 border-dashed border-brand/50 bg-brand-soft/40 text-brand-strong cursor-pointer"><Camera className="size-9" /><span className="font-bold">ノートを撮影する</span><input type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} /></label>}
            <Field label="ひとこと（任意）"><Textarea rows={2} value={speech} onChange={(e) => setSpeech(e.target.value)} placeholder="考えたこと、わからなかったこと" maxLength={500} /></Field>
            <Button size="lg" className="w-full" icon={Send} loading={busy} disabled={!number || !image} onClick={send}>提出する</Button>
          </Card>
        )}
        <p className="text-center text-xs text-mute mt-6">送った写真は先生の端末に届いた後、サーバーから消えます。</p>
      </div>
    </div>
  );
}
