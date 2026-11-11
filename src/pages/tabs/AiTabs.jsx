import { useEffect, useRef, useState } from 'react';
import { Wand2, Printer, Download, Trash2, Send, Sparkles, User, Bot, Eraser, Mic } from 'lucide-react';
import { useStore, db } from '../../lib/store.js';
import { runAi } from '../../lib/ai.js';
import { MATERIAL_KINDS } from '../../lib/options.js';
import { download, fmtDateTime, mdToHtml, planForAi, cx } from '../../lib/util.js';
import { printHtml, safeName } from '../../lib/exporters.js';
import { Button, Card, CardHead, Textarea, AiProgress, toast, confirmDialog, CopyButton, Badge, Empty } from '../../ui.jsx';
import { useDictation } from './RecordTabs.jsx';

export function MaterialsTab({ plan }) {
  const s = useStore();
  const list = s.materials.filter((m) => m.planId === plan.id);
  const [kind, setKind] = useState('worksheet');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState('');
  const [open, setOpen] = useState(list[0]?.id);
  const current = list.find((m) => m.id === open);

  const make = async () => {
    setBusy(true); setStream('');
    try {
      const { result, demo } = await runAi('material', { plan: planForAi(plan), kind, note }, { onText: setStream });
      const row = db.add('materials', { planId: plan.id, kind, content: result, demo, note });
      setOpen(row.id); toast('教材ができました');
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  const kindName = (k) => MATERIAL_KINDS.find((x) => x.kind === k)?.name || k;

  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-5 items-start">
      <div className="space-y-4">
        <Card>
          <CardHead icon={Wand2} title="教材をつくる" desc="指導案の内容に合わせてAIが作成します" />
          <div className="px-5 pb-5 space-y-3">
            <div className="grid grid-cols-2 gap-2">{MATERIAL_KINDS.map((k) => (
              <button key={k.kind} onClick={() => setKind(k.kind)} className={cx('text-left rounded-xl border px-3 py-2.5 transition', kind === k.kind ? 'border-brand bg-brand-soft' : 'border-line hover:border-brand/50')}>
                <span className="block text-sm font-bold">{k.name}</span><span className="block text-[0.7rem] text-mute leading-snug mt-0.5">{k.desc}</span>
              </button>
            ))}</div>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="追加の希望（任意）例：ふりがなを付けて、問題は5問に" />
            <Button className="w-full" icon={Sparkles} loading={busy} onClick={make}>{kindName(kind)}を作成</Button>
          </div>
        </Card>
        {list.length > 0 && (
          <Card className="p-2">{list.map((m) => (
            <button key={m.id} onClick={() => setOpen(m.id)} className={cx('w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-left', open === m.id ? 'bg-brand-soft' : 'hover:bg-sunken')}>
              <span className="text-sm font-medium flex-1">{kindName(m.kind)}</span>{m.demo && <Badge tone="warn">見本</Badge>}<span className="text-xs text-mute">{fmtDateTime(m.createdAt)}</span>
            </button>
          ))}</Card>
        )}
      </div>
      <div className="min-w-0">
        {busy && <AiProgress text={stream} label="教材を作成しています" />}
        {!busy && current && (
          <Card>
            <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-line">
              <h3 className="font-bold flex-1">{kindName(current.kind)}</h3>
              <CopyButton text={current.content} />
              <Button size="sm" variant="outline" icon={Printer} onClick={() => { try { printHtml(kindName(current.kind), mdToHtml(current.content)); } catch (e) { toast(e.message, 'bad'); } }}>印刷</Button>
              <Button size="sm" variant="outline" icon={Download} onClick={() => download(new Blob([current.content], { type: 'text/markdown' }), `${safeName(plan.title)}_${kindName(current.kind)}.md`)}>保存</Button>
              <Button size="sm" variant="ghost" icon={Trash2} aria-label="削除" onClick={async () => { if (await confirmDialog('この教材を削除しますか？', { ok: '削除', danger: true })) { db.remove('materials', current.id); setOpen(null); } }} />
            </div>
            <div className="md p-5 sm:p-7" dangerouslySetInnerHTML={{ __html: mdToHtml(current.content) }} />
          </Card>
        )}
        {!busy && !current && <Card><Empty icon={Wand2} title="教材はまだありません" desc="左から種類を選んで作成してください。作った教材は印刷・コピー・保存できます。" /></Card>}
      </div>
    </div>
  );
}

const SUGGEST = ['この指導案の改善点を3つ教えて', '導入をもっと引きつける工夫は？', '時間配分は適切？', '発問を磨きたい', '早く終わった子への発展課題は？', '支援が必要な子への手立てを増やしたい'];

export function AssistantTab({ plan }) {
  const s = useStore();
  const chat = s.chats.find((c) => c.planId === plan.id);
  const messages = chat?.messages || [];
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState('');
  const end = useRef(null);
  const dict = useDictation((t) => setV((x) => `${x}${t}`));
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [messages.length, stream]);

  const send = async (text) => {
    const q = (text ?? v).trim(); if (!q || busy) return;
    const next = [...messages, { role: 'user', content: q }];
    let id = chat?.id;
    if (!id) id = db.add('chats', { planId: plan.id, messages: next }).id; else db.update('chats', id, { messages: next });
    setV(''); setBusy(true); setStream('');
    try {
      const { result } = await runAi('assistant', { plan: planForAi(plan), messages: next }, { onText: setStream });
      db.update('chats', id, { messages: [...next, { role: 'assistant', content: result }] });
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); setStream(''); }
  };

  return (
    <Card className="flex flex-col h-[70vh] min-h-[480px]">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-line">
        <Bot className="size-5 text-brand" /><h3 className="font-bold flex-1">AI相談</h3>
        {messages.length > 0 && <Button size="sm" variant="ghost" icon={Eraser} onClick={() => db.update('chats', chat.id, { messages: [] })}>会話を消す</Button>}
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin px-4 sm:px-6 py-5 space-y-4">
        {messages.length === 0 && !busy && (
          <div className="text-center py-6">
            <p className="font-bold">この指導案について、何でも相談できます</p>
            <p className="text-sm text-mute mt-1">指導者名・学校名はAIに送りません。</p>
            <div className="flex flex-wrap justify-center gap-2 mt-5">{SUGGEST.map((x) => <button key={x} onClick={() => send(x)} className="h-9 px-3 rounded-full border border-line text-sm hover:border-brand hover:text-brand">{x}</button>)}</div>
          </div>
        )}
        {messages.map((m, i) => <Bubble key={i} m={m} />)}
        {busy && <Bubble m={{ role: 'assistant', content: stream || '考えています…' }} />}
        <div ref={end} />
      </div>
      <div className="p-3 border-t border-line flex gap-2 items-end">
        <Textarea rows={2} value={v} onChange={(e) => setV(e.target.value)} placeholder="質問を入力（Enterで送信、Shift+Enterで改行）"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
        {dict.supported && <Button variant={dict.on ? 'danger' : 'outline'} icon={Mic} aria-label="音声入力" onClick={dict.toggle} />}
        <Button icon={Send} loading={busy} onClick={() => send()} disabled={!v.trim()} aria-label="送信" />
      </div>
    </Card>
  );
}

function Bubble({ m }) {
  const me = m.role === 'user';
  return (
    <div className={cx('flex gap-3', me && 'flex-row-reverse')}>
      <span className={cx('grid place-items-center size-8 rounded-full shrink-0', me ? 'bg-sunken text-mute' : 'bg-brand text-on-brand')}>{me ? <User className="size-4" /> : <Bot className="size-4" />}</span>
      <div className={cx('max-w-[85%] rounded-2xl px-4 py-3 text-[0.93rem]', me ? 'bg-brand-soft' : 'bg-sunken')}>
        {me ? <p className="whitespace-pre-wrap">{m.content}</p> : <div className="md [&>*:first-child]:mt-0" dangerouslySetInnerHTML={{ __html: mdToHtml(m.content) }} />}
      </div>
    </div>
  );
}

