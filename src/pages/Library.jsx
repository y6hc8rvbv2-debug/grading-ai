import { useEffect, useMemo, useState } from 'react';
import { Library as LibIcon, Search, ShoppingCart, Download, Coins, RefreshCw, Gift, Upload, Trash2 } from 'lucide-react';
import { useStore, db, useDisplay } from '../lib/store.js';
import { api, useConfig } from '../lib/api.js';
import { navigate, href } from '../lib/router.js';
import { formatPrice } from '../lib/options.js';
import { fmtDate, schoolLabel } from '../lib/util.js';
import { Button, Card, Input, Select, PageHeader, Empty, Badge, Notice, Modal, Tabs, toast, Stat, ScoreRing, confirmDialog } from '../ui.jsx';
import { PlanMeta, PlanBody } from './PlanView.jsx';

export default function LibraryPage({ query }) {
  const cfg = useConfig();
  const s = useStore();
  const { currency } = useDisplay();
  const [tab, setTab] = useState('browse');
  const [items, setItems] = useState(null);
  const [q, setQ] = useState('');
  const [price, setPrice] = useState('');
  const [subject, setSubject] = useState('');
  const [view, setView] = useState(null);
  const [earn, setEarn] = useState(null);

  const load = async () => { try { setItems(await api('lib.list')); } catch (e) { setItems([]); if (e.message !== 'STORE_NOT_CONFIGURED') toast(e.message, 'bad'); } };
  useEffect(() => { if (cfg.loaded && cfg.store) load(); }, [cfg.loaded, cfg.store]);
  useEffect(() => { if (tab === 'mine' && cfg.store) api('lib.earnings').then(setEarn).catch(() => setEarn(null)); }, [tab, cfg.store]);
  // 決済から戻ってきた時に購入を確認する
  useEffect(() => {
    if (!query.session || !cfg.stripe) return;
    api('stripe.verify', { sessionId: query.session }).then((r) => {
      if (r.paid && r.type === 'purchase') { if (!s.purchases.some((p) => p.remoteId === r.itemId)) db.add('purchases', { remoteId: r.itemId, amount: r.amount }); toast('購入が完了しました'); }
      navigate('/library', { replace: true });
    }).catch((e) => toast(e.message, 'bad'));
  }, [query.session, cfg.stripe]); // eslint-disable-line react-hooks/exhaustive-deps

  const subjects = [...new Set((items || []).map((i) => i.plan?.subject).filter(Boolean))];
  const list = useMemo(() => (items || []).filter((i) => {
    const k = q.trim().toLowerCase();
    return (!k || [i.plan?.title, i.plan?.unit, i.plan?.subject, i.summary, i.publisherName].join(' ').toLowerCase().includes(k)) && (!price || (price === 'free' ? i.price === 0 : i.price > 0)) && (!subject || i.plan?.subject === subject);
  }), [items, q, price, subject]);
  const owned = (i) => i.price === 0 || s.purchases.some((p) => p.remoteId === i.id) || s.library.some((l) => l.remoteId === i.id);

  if (cfg.loaded && !cfg.store) {
    return (<div><PageHeader icon={LibIcon} title="指導案ライブラリ" desc="先生どうしで指導案を共有・販売できます" />
      <Card className="p-6"><Notice tone="warn">ライブラリは、管理者が共有データの置き場（Upstash Redis）を設定すると使えるようになります。設定方法は「設定 → 連携」をご覧ください。</Notice>
        <div className="grid sm:grid-cols-3 gap-4 mt-5 text-sm">{[['探す', '教科・単元・価格で絞り込み。無料の指導案はすぐに取り込めます。'], ['公開する', '自分の指導案を無料または有料で公開。氏名・学校名は自動で除去。'], ['収益', '有料の指導案が売れると、販売実績と収益を確認できます。']].map(([t, d]) => <div key={t} className="rounded-xl bg-sunken p-4"><p className="font-bold mb-1">{t}</p><p className="text-mute">{d}</p></div>)}</div>
      </Card></div>);
  }

  return (
    <div>
      <PageHeader icon={LibIcon} title="指導案ライブラリ" desc="先生どうしで指導案を共有・販売" actions={<Button variant="outline" icon={RefreshCw} onClick={load}>更新</Button>} />
      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[{ id: 'browse', label: '探す', icon: Search }, { id: 'bought', label: '入手済み', icon: Download, count: s.purchases.length }, { id: 'mine', label: '公開中・収益', icon: Coins, count: s.library.length }]} />
      {tab === 'browse' && (<>
        <Card className="p-3 mb-4 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-mute" /><Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="タイトル・単元・教科で検索" /></div>
          <Select className="sm:w-36" value={price} onChange={(e) => setPrice(e.target.value)} options={[{ value: 'free', label: '無料' }, { value: 'paid', label: '有料' }]} placeholder="価格" />
          <Select className="sm:w-36" value={subject} onChange={(e) => setSubject(e.target.value)} options={subjects} placeholder="教科" />
        </Card>
        {items === null ? <p className="text-mute text-sm">読み込み中…</p> : list.length === 0 ? <Card><Empty icon={LibIcon} title="まだ公開された指導案がありません" desc="指導案の詳細画面から「ライブラリに公開」で最初の1件を公開できます。" /></Card> : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">{list.map((i) => (
            <Card key={i.id} className="p-5 flex flex-col hover:shadow-lg hover:shadow-black/5 transition">
              <div className="flex items-center gap-2 mb-2"><Badge tone="brand">{i.plan?.subject}</Badge><Badge>{[schoolLabel(i.plan?.schoolType), i.plan?.grade && `${i.plan.grade}年`].filter(Boolean).join(' ')}</Badge><span className="flex-1" /><span className={`font-bold ${i.price ? 'text-ink' : 'text-good'}`}>{i.price ? formatPrice(i.price, currency) : '無料'}</span></div>
              <h3 className="font-bold leading-snug">{i.plan?.title}</h3>
              <p className="text-sm text-mute mt-1 line-clamp-3 flex-1">{i.summary || i.plan?.currentLessonObjective}</p>
              <div className="flex items-center gap-2 text-xs text-mute mt-3 pt-3 border-t border-line"><span>{i.publisherName}</span><span>・{fmtDate(i.createdAt)}</span>{i.evaluation?.overallScore != null && <Badge tone="good" className="ml-auto">評価 {i.evaluation.overallScore}</Badge>}</div>
              <Button className="mt-3" variant={owned(i) ? 'soft' : 'primary'} icon={owned(i) ? Download : ShoppingCart} onClick={() => setView(i)}>{owned(i) ? '内容を見る' : '詳細・購入'}</Button>
            </Card>
          ))}</div>
        )}
      </>)}
      {tab === 'bought' && (s.purchases.length === 0 ? <Card><Empty icon={Download} title="入手した指導案はありません" desc="無料の指導案を取り込んだり、有料の指導案を購入するとここに並びます。" /></Card> : (
        <Card className="divide-y divide-line">{s.purchases.map((p) => { const i = (items || []).find((x) => x.id === p.remoteId); return (
          <div key={p.id} className="flex items-center gap-3 px-4 py-3"><span className="flex-1 min-w-0 truncate">{i?.plan?.title || p.title || '（公開が取り消された指導案）'}</span><span className="text-xs text-mute">{fmtDate(p.createdAt)}</span>{i && <Button size="sm" variant="soft" onClick={() => setView(i)}>開く</Button>}</div>
        ); })}</Card>
      ))}
      {tab === 'mine' && (<div className="space-y-4">
        <div className="grid grid-cols-3 gap-3"><Stat label="公開中" value={s.library.length} icon={Upload} /><Stat label="販売数" value={earn?.count ?? '—'} icon={ShoppingCart} /><Stat label="売上（参考）" value={earn ? formatPrice(earn.total, currency) : '—'} icon={Coins} hint="決済手数料を差し引く前の金額" /></div>
        {s.library.length === 0 ? <Card><Empty icon={Upload} title="公開中の指導案はありません" desc="指導案の詳細画面の「ライブラリに公開」から公開できます。" action={<Button onClick={() => navigate('/plans')}>指導案一覧へ</Button>} /></Card> : (
          <Card className="divide-y divide-line">{s.library.map((l) => (
            <div key={l.id} className="flex items-center gap-3 px-4 py-3">
              <a href={href(`/plans/${l.planId}`)} className="flex-1 min-w-0 truncate hover:text-brand">{l.title}</a>
              <Badge>{l.price ? formatPrice(l.price, currency) : '無料'}</Badge>
              <Button size="sm" variant="ghost" icon={Trash2} onClick={async () => { if (!(await confirmDialog('公開を取り消しますか？', { ok: '取り消す', danger: true }))) return; try { await api('lib.unpublish', { id: l.remoteId }); } catch (e) { if (!/見つかりません/.test(e.message)) { toast(e.message, 'bad'); return; } } db.remove('library', l.id); toast('取り消しました'); load(); }}>取消</Button>
            </div>
          ))}</Card>
        )}
        <Notice tone="mute">有料の指導案の売上は、運営者のStripeアカウントで受け取ります。収益の分配方法は運営者の規約に従います。</Notice>
      </div>)}
      <ItemModal item={view} onClose={() => setView(null)} owned={view && owned(view)} currency={currency} />
    </div>
  );
}

function ItemModal({ item, onClose, owned, currency }) {
  const cfg = useConfig();
  const s = useStore();
  const [full, setFull] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setFull(null); if (item && owned) api('lib.get', { id: item.id }).then(setFull).catch((e) => toast(e.message, 'bad')); }, [item?.id, owned]);
  if (!item) return null;
  const claim = async () => {
    setBusy(true);
    try {
      if (item.price === 0) { await api('lib.claimFree', { id: item.id }); if (!s.purchases.some((p) => p.remoteId === item.id)) db.add('purchases', { remoteId: item.id, title: item.plan?.title, amount: 0 }); setFull(await api('lib.get', { id: item.id })); }
      else { const { url } = await api('stripe.checkout', { kind: 'purchase', id: item.id }); location.href = url; }
    } catch (e) { toast(e.message === 'STRIPE_NOT_CONFIGURED' ? '決済が未設定のため購入できません' : e.message, 'bad'); } finally { setBusy(false); }
  };
  const importPlan = () => {
    const { id, ownerId, createdAt, updatedAt, ...rest } = full.plan;
    const p = db.add('plans', { ...rest, title: `${rest.title}`, tags: [...(rest.tags || []), 'ライブラリ'], fromLibrary: item.id });
    toast('自分の指導案に取り込みました'); onClose(); navigate(`/plans/${p.id}`);
  };
  return (
    <Modal open onClose={onClose} title={item.plan?.title} wide
      footer={full ? <Button icon={Download} onClick={importPlan}>自分の指導案に取り込む</Button> : <Button icon={item.price ? ShoppingCart : Gift} loading={busy} disabled={item.price > 0 && !cfg.stripe} onClick={claim}>{item.price ? `${formatPrice(item.price, currency)}で購入` : '無料で入手'}</Button>}>
      <div className="flex items-start gap-4 mb-4"><div className="flex-1"><p className="text-sm text-mute">{item.publisherName}・{fmtDate(item.createdAt)}</p>{item.summary && <p className="mt-2 leading-relaxed">{item.summary}</p>}</div>{item.evaluation?.overallScore != null && <ScoreRing value={item.evaluation.overallScore} size={64} label="評価" />}</div>
      <Card className="p-4 mb-4"><PlanMeta p={item.plan} /></Card>
      {full ? <PlanBody c={full.plan.generatedContent} /> : <Notice tone="mute">{item.price ? '購入すると、学習過程・評価規準・板書計画を含む全文を見られます。' : '「無料で入手」を押すと全文を見られます。'}</Notice>}
    </Modal>
  );
}
