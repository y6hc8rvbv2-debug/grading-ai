import { useEffect, useState } from 'react';
import { Star, Heart, Send, Trash2, Lightbulb, RefreshCw } from 'lucide-react';
import { useStore, db } from '../lib/store.js';
import { api, useConfig } from '../lib/api.js';
import { fmtDate } from '../lib/util.js';
import { SUGGEST_CATEGORIES, SUGGEST_STATUS } from '../lib/options.js';
import { Button, Card, Input, Textarea, Select, Field, PageHeader, Empty, Badge, Notice, toast, confirmDialog } from '../ui.jsx';

export function Testimonials() {
  const cfg = useConfig();
  const s = useStore();
  const [list, setList] = useState(null);
  const [text, setText] = useState('');
  const [name, setName] = useState(s.profile?.name || '');
  const [busy, setBusy] = useState(false);
  const shared = cfg.store;
  const load = async () => { if (!shared) return; try { setList(await api('testi.list')); } catch (e) { toast(e.message, 'bad'); setList([]); } };
  useEffect(() => { load(); }, [shared]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = shared ? list || [] : s.testimonials;
  const post = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      if (shared) { await api('testi.add', { content: text, userName: name }); await load(); } else db.add('testimonials', { userId: s.profile.id, userName: name || '匿名ユーザー', content: text.trim().slice(0, 1000), likes: [] });
      setText(''); toast('投稿しました。ありがとうございます！');
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  const like = async (t) => {
    if (shared) { try { const u = await api('testi.like', { id: t.id }); setList((l) => l.map((x) => (x.id === u.id ? u : x))); } catch (e) { toast(e.message, 'bad'); } }
    else db.update('testimonials', t.id, { likes: t.likes.includes(s.profile.id) ? t.likes.filter((x) => x !== s.profile.id) : [...t.likes, s.profile.id] });
  };
  const del = async (t) => {
    if (!(await confirmDialog('この投稿を削除しますか？', { ok: '削除', danger: true }))) return;
    if (shared) { try { await api('testi.delete', { id: t.id }); await load(); } catch (e) { toast(e.message, 'bad'); } } else db.remove('testimonials', t.id);
  };
  return (
    <div>
      <PageHeader icon={Star} title="利用者の声" desc="使ってみた感想をお寄せください" actions={shared && <Button variant="outline" icon={RefreshCw} onClick={load}>更新</Button>} />
      {!shared && <Notice tone="mute" className="mb-4">いまは共有データの置き場が未設定のため、投稿はこの端末の中だけに保存されます。</Notice>}
      <Card className="p-5 mb-5">
        <div className="grid sm:grid-cols-[200px_1fr] gap-3">
          <Field label="表示名"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></Field>
          <Field label="感想"><Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="どんな場面で役立ったか、改善してほしい点など" /></Field>
        </div>
        <div className="flex justify-end mt-3"><Button icon={Send} loading={busy} disabled={!text.trim()} onClick={post}>投稿する</Button></div>
      </Card>
      {items.length === 0 ? <Card><Empty icon={Star} title="まだ投稿がありません" desc="最初の感想をお寄せください。" /></Card> : (
        <div className="columns-1 md:columns-2 gap-4 [&>*]:mb-4">{items.map((t) => {
          const mine = t.userId === s.profile?.id; const liked = t.likes?.includes(s.profile?.id);
          return (
            <Card key={t.id} className="p-5 break-inside-avoid">
              <p className="leading-relaxed whitespace-pre-wrap">「{t.content}」</p>
              <div className="flex items-center gap-2 mt-4 text-sm">
                <span className="grid place-items-center size-7 rounded-full bg-brand-soft text-brand-strong text-xs font-bold">{(t.userName || '匿')[0]}</span>
                <span className="font-medium">{t.userName}</span><span className="text-xs text-mute">{fmtDate(t.createdAt)}</span><span className="flex-1" />
                <button onClick={() => like(t)} className={`inline-flex items-center gap-1 ${liked ? 'text-bad' : 'text-mute hover:text-bad'}`} aria-pressed={liked}><Heart className={`size-4 ${liked ? 'fill-current' : ''}`} />{t.likes?.length || 0}</button>
                {mine && <button aria-label="削除" onClick={() => del(t)} className="text-mute hover:text-bad"><Trash2 className="size-4" /></button>}
              </div>
            </Card>
          );
        })}</div>
      )}
    </div>
  );
}

export function Suggestions() {
  const cfg = useConfig();
  const s = useStore();
  const [f, setF] = useState({ category: SUGGEST_CATEGORIES[0], title: '', description: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!cfg.store) return;
    api('suggest.mine').then((remote) => remote.forEach((r) => { const local = s.suggestions.find((x) => x.remoteId === r.id); if (local && local.status !== r.status) db.update('suggestions', local.id, { status: r.status }); })).catch(() => {});
  }, [cfg.store]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    if (!f.title.trim() || !f.description.trim()) { toast('タイトルと内容を入力してください', 'bad'); return; }
    setBusy(true);
    try {
      let remoteId = null;
      if (cfg.store) remoteId = (await api('suggest.add', f)).id;
      db.add('suggestions', { ...f, status: 'new', remoteId, sent: Boolean(remoteId) });
      setF({ ...f, title: '', description: '' }); toast(remoteId ? '提案を送信しました。ありがとうございます！' : '提案を保存しました');
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <div>
      <PageHeader icon={Lightbulb} title="機能提案" desc="「こんな機能がほしい」をお聞かせください" />
      {!cfg.store && <Notice tone="mute" className="mb-4">共有データの置き場が未設定のため、提案はこの端末に保存されます。運営者に直接届けたい場合は<a className="underline" href="#/help">ヘルプ</a>の問い合わせからお送りください。</Notice>}
      <div className="grid lg:grid-cols-[1fr_1fr] gap-5 items-start">
        <Card className="p-5 space-y-3">
          <Field label="分類"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={SUGGEST_CATEGORIES} /></Field>
          <Field label="タイトル" required><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} /></Field>
          <Field label="内容" required hint="どんな場面で、何に困っていて、どうなると嬉しいか"><Textarea rows={6} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={3000} /></Field>
          <Button icon={Send} loading={busy} onClick={send}>送信する</Button>
        </Card>
        <div className="space-y-3">
          <h3 className="font-bold">あなたの提案</h3>
          {s.suggestions.length === 0 ? <Card><Empty icon={Lightbulb} title="まだ提案はありません" /></Card> : s.suggestions.map((x) => (
            <Card key={x.id} className="p-4"><div className="flex items-center gap-2 mb-1"><Badge>{x.category}</Badge><Badge tone={x.status === 'completed' ? 'good' : x.status === 'declined' ? 'bad' : 'brand'}>{SUGGEST_STATUS[x.status] || x.status}</Badge><span className="flex-1" /><span className="text-xs text-mute">{fmtDate(x.createdAt)}</span></div><p className="font-bold">{x.title}</p><p className="text-sm text-mute mt-1 line-clamp-3">{x.description}</p></Card>
          ))}
        </div>
      </div>
    </div>
  );
}
