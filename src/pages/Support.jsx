import { useMemo, useState } from 'react';
import { LifeBuoy, Search, ChevronDown, Mail, Send, Building2, HeartHandshake, ShieldCheck, ArrowLeft, Keyboard } from 'lucide-react';
import { useConfig, api } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { href } from '../lib/router.js';
import { FAQ, SUPPORT_EMAIL, LEGAL, SPECIAL_NEEDS_GUIDES } from '../lib/content.js';
import { PLANS } from '../lib/options.js';
import { mdToHtml, cx } from '../lib/util.js';
import { Button, Card, CardHead, Input, Textarea, Select, Field, PageHeader, Notice, toast, BulletList } from '../ui.jsx';

export function Help() {
  const cfg = useConfig();
  const profile = useStore((s) => s.profile);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [f, setF] = useState({ name: profile?.name || '', email: '', subject: '', message: '' });
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => FAQ.filter((x) => !q || `${x.q}${x.a}`.includes(q)), [q]);
  const cats = [...new Set(list.map((x) => x.cat))];
  const send = async () => {
    setBusy(true);
    try { await api('help.add', f); toast('お問い合わせを受け付けました'); setF({ ...f, subject: '', message: '' }); }
    catch (e) { toast(e.message === 'PII_NOT_CONFIGURED' || e.message === 'STORE_NOT_CONFIGURED' ? 'フォームは未設定です。メールでお問い合わせください。' : e.message, 'bad'); } finally { setBusy(false); }
  };
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(f.subject || '授業スタジオへのお問い合わせ')}&body=${encodeURIComponent(f.message)}`;
  const formReady = cfg.store && cfg.pii;
  return (
    <div>
      <PageHeader icon={LifeBuoy} title="ヘルプ" desc="よくある質問とお問い合わせ" />
      <div className="grid lg:grid-cols-[1.3fr_1fr] gap-5 items-start">
        <div className="space-y-4">
          <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-mute" /><Input className="pl-9 h-12" value={q} onChange={(e) => setQ(e.target.value)} placeholder="質問を検索" /></div>
          {cats.map((c) => (
            <div key={c}><h3 className="text-sm font-bold text-mute mb-2">{c}</h3>
              <Card className="divide-y divide-line">{list.filter((x) => x.cat === c).map((x) => (
                <div key={x.q}>
                  <button onClick={() => setOpen(open === x.q ? null : x.q)} className="w-full flex items-center gap-3 px-5 py-4 text-left" aria-expanded={open === x.q}><span className="flex-1 font-medium">{x.q}</span><ChevronDown className={cx('size-4 text-mute transition', open === x.q && 'rotate-180')} /></button>
                  {open === x.q && <p className="px-5 pb-4 text-sm text-mute leading-relaxed">{x.a}</p>}
                </div>
              ))}</Card>
            </div>
          ))}
          <Card className="p-5"><h3 className="font-bold mb-3 flex items-center gap-2"><Keyboard className="size-4" />キーボードショートカット</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">{[['Ctrl / ⌘ + K', 'どこからでも検索・画面移動'], ['/', '検索を開く'], ['N', '新しい指導案'], ['Esc', 'ダイアログを閉じる']].map(([k, d]) => <div key={k} className="contents"><dt><kbd className="border border-line rounded px-1.5 py-0.5 text-xs">{k}</kbd></dt><dd>{d}</dd></div>)}</dl>
          </Card>
        </div>
        <Card>
          <CardHead icon={Mail} title="お問い合わせ" desc={formReady ? '内容は暗号化して保存されます' : 'メールでお問い合わせください'} />
          <div className="px-5 pb-5 space-y-3">
            <Field label="お名前" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            {formReady && <Field label="返信先メールアドレス" required><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>}
            <Field label="件名" required><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
            <Field label="内容" required><Textarea rows={5} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
            {formReady ? <Button className="w-full" icon={Send} loading={busy} disabled={!f.name || !f.email || !f.subject || !f.message} onClick={send}>送信</Button>
              : <a href={mailto} className="flex items-center justify-center gap-2 h-10 rounded-xl bg-brand text-on-brand text-sm font-medium"><Mail className="size-4" />メールアプリで送る</a>}
            <p className="text-xs text-mute">宛先：{SUPPORT_EMAIL}</p>
            <a href={href('/contact')} className="flex items-center gap-2 text-sm text-brand"><Building2 className="size-4" />学校・教育委員会での導入はこちら</a>
          </div>
        </Card>
      </div>
    </div>
  );
}

export function Contact() {
  const cfg = useConfig();
  const [f, setF] = useState({ organizationType: '学校', organizationName: '', department: '', contactName: '', contactEmail: '', contactPhone: '', estimatedUsers: '', interestedPlan: 'school', message: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const ready = cfg.store && cfg.pii;
  const send = async () => { setBusy(true); try { await api('inquiry.add', f); setDone(true); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`【導入相談】${f.organizationName}`)}&body=${encodeURIComponent(`組織種別：${f.organizationType}\n組織名：${f.organizationName}\n部署：${f.department}\n利用予定人数：${f.estimatedUsers}\n関心のあるプラン：${f.interestedPlan}\n\n${f.message}`)}`;
  return (
    <div className="max-w-3xl">
      <PageHeader icon={Building2} title="学校・教育委員会のお問い合わせ" desc="複数教員での導入や、行政機関での利用のご相談" />
      {done ? <Card className="p-8 text-center"><p className="text-lg font-bold">お問い合わせを受け付けました</p><p className="text-mute mt-2">担当者よりご連絡いたします。</p></Card> : (
        <Card className="p-5 sm:p-6">
          {!ready && <Notice tone="mute" className="mb-4">フォームの保存先が未設定のため、入力内容をメールアプリで送る形になります（連絡先はメールの差出人として届きます）。</Notice>}
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="組織の種類"><Select value={f.organizationType} onChange={set('organizationType')} options={['学校', '学校法人', '教育委員会', '自治体', '塾・教育事業者', 'その他']} /></Field>
            <Field label="組織名" required><Input value={f.organizationName} onChange={set('organizationName')} /></Field>
            <Field label="部署"><Input value={f.department} onChange={set('department')} /></Field>
            <Field label="利用予定人数"><Input type="number" value={f.estimatedUsers} onChange={set('estimatedUsers')} /></Field>
            {ready && <><Field label="ご担当者名" required><Input value={f.contactName} onChange={set('contactName')} /></Field>
              <Field label="メールアドレス" required><Input type="email" value={f.contactEmail} onChange={set('contactEmail')} /></Field>
              <Field label="電話番号"><Input type="tel" value={f.contactPhone} onChange={set('contactPhone')} /></Field></>}
            <Field label="関心のあるプラン"><Select value={f.interestedPlan} onChange={set('interestedPlan')} options={PLANS.filter((p) => p.price).map((p) => ({ value: p.code, label: p.name }))} /></Field>
            <Field label="ご相談内容" className="sm:col-span-2"><Textarea rows={5} value={f.message} onChange={set('message')} /></Field>
          </div>
          <div className="mt-5">{ready ? <Button icon={Send} loading={busy} disabled={!f.organizationName || !f.contactName || !f.contactEmail} onClick={send}>送信</Button>
            : <a href={mailto} className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-brand text-on-brand text-sm font-medium"><Mail className="size-4" />メールアプリで送る</a>}</div>
          {ready && <p className="text-xs text-mute mt-3 flex items-center gap-1"><ShieldCheck className="size-3.5" />お名前・メール・電話番号は暗号化して保存し、管理画面でもマスク表示されます。</p>}
        </Card>
      )}
    </div>
  );
}

export function Legal({ doc }) {
  const d = LEGAL[doc] || LEGAL.terms;
  const profile = useStore((s) => s.profile);
  return (
    <div className={cx('max-w-3xl', !profile && 'mx-auto px-5 py-10')}>
      {!profile && <a href={href('/')} className="inline-flex items-center gap-1 text-sm text-mute mb-4"><ArrowLeft className="size-4" />戻る</a>}
      <div className="flex gap-2 mb-5">{Object.entries(LEGAL).map(([k, v]) => <a key={k} href={href(`/legal/${k}`)} className={cx('h-9 px-3 inline-flex items-center rounded-xl text-sm border', k === doc ? 'bg-brand text-on-brand border-brand' : 'border-line')}>{v.title}</a>)}</div>
      <Card className="p-6 sm:p-8"><h1 className="text-2xl font-bold mb-4">{d.title}</h1><div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(d.body) }} /></Card>
    </div>
  );
}

export function SpecialNeedsGuide() {
  const [open, setOpen] = useState(SPECIAL_NEEDS_GUIDES[0].id);
  const g = SPECIAL_NEEDS_GUIDES.find((x) => x.id === open);
  return (
    <div>
      <PageHeader icon={HeartHandshake} title="特別支援ガイド" desc="授業でできる配慮と手立ての例" />
      <Notice tone="mute" className="mb-5">一般的な手立ての例です。診断や個別の支援計画は、特別支援教育コーディネーター・保護者・専門機関と連携して検討してください。</Notice>
      <div className="grid md:grid-cols-[260px_1fr] gap-5 items-start">
        <Card className="p-2">{SPECIAL_NEEDS_GUIDES.map((x) => <button key={x.id} onClick={() => setOpen(x.id)} className={cx('w-full text-left px-3 py-2.5 rounded-xl text-sm', open === x.id ? 'bg-brand-soft text-brand-strong font-bold' : 'hover:bg-sunken')}>{x.label}</button>)}</Card>
        <Card className="p-6"><h2 className="text-xl font-bold">{g.label}</h2><p className="text-mute mt-1 mb-5">{g.summary}</p><h3 className="font-bold text-brand-strong mb-2">授業での手立て</h3><BulletList items={g.tips} />
          <p className="text-sm text-mute mt-6">指導案の作成画面で「特別な支援を要する児童生徒」に特性を書くと、これらの手立てが指導案に織り込まれます。個別の見立ては、指導案の「特別支援」タブで作成できます。</p></Card>
      </div>
    </div>
  );
}
