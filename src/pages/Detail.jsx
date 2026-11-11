import { useState } from 'react';
import LZString from 'lz-string';
import {
  FileText, Wand2, MessageSquare, Video, MessagesSquare, NotebookPen, Eye, HeartHandshake, BarChart3, History, Star, Pencil, Printer, Download, Share2,
  CalendarPlus, Upload, Trash2, Copy, Timer, Youtube, GraduationCap, Tag, X, Plus, Send, ArrowLeft, Cloud, Library,
} from 'lucide-react';
import { useStore, db } from '../lib/store.js';
import { href, navigate } from '../lib/router.js';
import { useConfig, api } from '../lib/api.js';
import { exportPlan, FORMATS, printPlan, planToIcs, googleCalendarLink, safeName } from '../lib/exporters.js';
import { addToGoogleCalendar, uploadToDrive } from '../lib/google.js';
import { download, fmtDate, fmtDateTime, schoolLabel } from '../lib/util.js';
import { Button, Card, Badge, Tabs, Modal, Field, Input, Textarea, toast, confirmDialog, Notice, CopyButton, Empty } from '../ui.jsx';
import { PlanMeta, PlanBody } from './PlanView.jsx';
import { MaterialsTab, AssistantTab } from './tabs/AiTabs.jsx';
import { RecordTab, ReflectionTab } from './tabs/RecordTabs.jsx';
import { NotesTab, ObserveTab, SpecialTab } from './tabs/StudentTabs.jsx';
import { EvaluationTab, VersionsTab } from './tabs/EvalTabs.jsx';

const REACTIONS = [['good', '👍', 'いいね'], ['idea', '💡', '参考になる'], ['love', '❤️', 'すてき']];

export default function PlanDetail({ id, query }) {
  const s = useStore();
  const p = s.plans.find((x) => x.id === id);
  const tab = query.tab || 'plan';
  const setTab = (t) => navigate(`/plans/${id}?tab=${t}`, { replace: true });
  if (!p) return <Card><Empty title="指導案が見つかりません" desc="削除されたか、別の端末で作成された指導案です。" action={<Button onClick={() => navigate('/plans')}>一覧へ</Button>} /></Card>;
  const n = (c) => s[c].filter((x) => x.planId === id).length;
  const tabs = [
    { id: 'plan', label: '指導案', icon: FileText }, { id: 'materials', label: '教材AI', icon: Wand2, count: n('materials') }, { id: 'assistant', label: 'AI相談', icon: MessageSquare },
    { id: 'record', label: '録画・録音', icon: Video, count: n('recordings') }, { id: 'reflection', label: '振り返り会議', icon: MessagesSquare, count: n('reflections') },
    { id: 'notes', label: 'ノート', icon: NotebookPen, count: n('notes') }, { id: 'observe', label: '授業観察', icon: Eye, count: n('behaviors') },
    { id: 'special', label: '特別支援', icon: HeartHandshake, count: n('specialNeeds') }, { id: 'evaluation', label: '総合評価', icon: BarChart3, count: n('evaluations') },
    { id: 'versions', label: '改善・版', icon: History, count: n('versions') },
  ];
  const T = { plan: PlanTab, materials: MaterialsTab, assistant: AssistantTab, record: RecordTab, reflection: ReflectionTab, notes: NotesTab, observe: ObserveTab, special: SpecialTab, evaluation: EvaluationTab, versions: VersionsTab }[tab] || PlanTab;

  return (
    <div>
      <a href={href('/plans')} className="no-print inline-flex items-center gap-1 text-sm text-mute hover:text-ink mb-3"><ArrowLeft className="size-4" />指導案一覧</a>
      <div className="flex flex-col md:flex-row md:items-start gap-4 mb-5">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <Badge tone="brand">{p.subject}</Badge><Badge>{[schoolLabel(p.schoolType), p.grade && `${p.grade}年`].filter(Boolean).join(' ')}</Badge>
            {p.lessonDate && <Badge>実施日 {fmtDate(p.lessonDate)}</Badge>}{p.demo && <Badge tone="warn">見本で作成</Badge>}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold leading-tight">{p.title}</h1>
          <p className="text-mute text-sm mt-1.5">{p.unit}{p.currentLessonObjective && `｜${p.currentLessonObjective}`}</p>
        </div>
        <div className="flex gap-2 no-print">
          <Button variant="outline" icon={Star} onClick={() => db.update('plans', id, { bookmarked: !p.bookmarked })} className={p.bookmarked ? 'text-warn' : ''}>{p.bookmarked ? 'お気に入り済' : 'お気に入り'}</Button>
          <Button variant="outline" icon={Timer} onClick={() => navigate(`/timer?plan=${id}`)}>授業モード</Button>
          <Button icon={Pencil} onClick={() => navigate(`/plans/${id}/edit`)}>編集</Button>
        </div>
      </div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} className="mb-6" />
      <T plan={p} />
    </div>
  );
}

function PlanTab({ plan: p }) {
  const cfg = useConfig();
  const [share, setShare] = useState(false);
  const [cal, setCal] = useState(false);
  const [pub, setPub] = useState(false);
  const [busy, setBusy] = useState('');
  const doExport = async (f) => { setBusy(f); try { await exportPlan(p, f); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(''); } };
  const toDrive = async () => {
    setBusy('drive');
    try { const f = FORMATS[0]; const r = await uploadToDrive(await f.make(p), `${safeName(p.title)}.docx`); toast('Googleドライブに保存しました'); if (r.webViewLink) window.open(r.webViewLink, '_blank'); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(''); }
  };
  const remove = async () => { if (await confirmDialog('この指導案と、ひも付く記録（ノート・評価・録画など）をすべて削除します。元に戻せません。', { ok: '削除する', danger: true })) { db.removePlan(p.id); toast('削除しました'); navigate('/plans'); } };

  return (
    <div className="grid xl:grid-cols-[1fr_300px] gap-6 items-start">
      <div className="space-y-6 min-w-0">
        <Card className="p-5"><PlanMeta p={p} /></Card>
        <PlanBody c={p.generatedContent} />
        <Related p={p} />
        <Comments p={p} />
      </div>
      <div className="space-y-4 xl:sticky xl:top-24 no-print">
        <Card className="p-4">
          <h3 className="font-bold text-sm mb-3 flex items-center gap-1.5"><Download className="size-4" />書き出し</h3>
          <div className="grid grid-cols-2 gap-2">{FORMATS.map((f) => <Button key={f.id} variant="outline" size="sm" loading={busy === f.id} onClick={() => doExport(f.id)}>{f.label}</Button>)}</div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Button variant="soft" size="sm" icon={Printer} onClick={() => { try { printPlan(p); } catch (e) { toast(e.message, 'bad'); } }}>印刷・PDF</Button>
            <Button variant="soft" size="sm" icon={Cloud} loading={busy === 'drive'} disabled={!cfg.googleClientId} title={cfg.googleClientId ? '' : '管理者の設定が必要です'} onClick={toDrive}>ドライブ</Button>
          </div>
        </Card>
        <Card className="p-4 space-y-2">
          <h3 className="font-bold text-sm mb-1">便利な操作</h3>
          <Button variant="outline" className="w-full justify-start" icon={Share2} onClick={() => setShare(true)}>共有リンクをつくる</Button>
          <Button variant="outline" className="w-full justify-start" icon={CalendarPlus} onClick={() => setCal(true)}>カレンダーに登録</Button>
          <Button variant="outline" className="w-full justify-start" icon={Library} onClick={() => setPub(true)}>ライブラリに公開</Button>
          <Button variant="outline" className="w-full justify-start" icon={Copy} onClick={() => navigate(`/create?copy=${p.id}`)}>条件を複製して新規作成</Button>
          <Button variant="ghost" className="w-full justify-start text-bad" icon={Trash2} onClick={remove}>削除</Button>
        </Card>
        <Reactions p={p} />
        <Tags p={p} />
      </div>
      <ShareModal open={share} onClose={() => setShare(false)} p={p} />
      <CalendarModal open={cal} onClose={() => setCal(false)} p={p} />
      <PublishModal open={pub} onClose={() => setPub(false)} p={p} />
    </div>
  );
}

function Related({ p }) {
  const k = [p.subject, p.unit, p.grade && `${p.grade}年`].filter(Boolean).join(' ');
  const links = [
    [Youtube, 'YouTube で授業動画', `https://www.youtube.com/results?search_query=${encodeURIComponent(`${k} 授業`)}`],
    [Youtube, 'NHK for School', `https://www.nhk.or.jp/school/search/?keyword=${encodeURIComponent(p.unit || p.subject || '')}`],
    [GraduationCap, 'Google Scholar', `https://scholar.google.com/scholar?q=${encodeURIComponent(`${p.subject || ''} ${p.unit || ''} 授業`)}`],
    [GraduationCap, 'CiNii Research', `https://cir.nii.ac.jp/all?q=${encodeURIComponent(`${p.subject || ''} ${p.unit || ''}`)}`],
    [GraduationCap, 'J-STAGE', `https://www.jstage.jst.go.jp/result/global/-char/ja?globalSearchKey=${encodeURIComponent(`${p.subject || ''} ${p.unit || ''}`)}`],
  ];
  return (
    <Card className="p-5 no-print">
      <h3 className="font-bold mb-3">関連する動画・研究を探す</h3>
      <div className="flex flex-wrap gap-2">{links.map(([Icon, l, u]) => <a key={l} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-line text-sm hover:border-brand hover:text-brand"><Icon className="size-4" />{l}</a>)}</div>
      <p className="text-xs text-mute mt-2">外部サイトの検索結果を開きます。</p>
    </Card>
  );
}

function Reactions({ p }) {
  const r = p.reactions || {};
  return (
    <Card className="p-4">
      <h3 className="font-bold text-sm mb-2">リアクション</h3>
      <div className="flex gap-2">{REACTIONS.map(([k, e, l]) => (
        <button key={k} title={l} onClick={() => db.update('plans', p.id, { reactions: { ...r, [k]: (r[k] || 0) + 1 } })} className="flex-1 h-10 rounded-xl border border-line hover:bg-sunken text-sm"><span className="mr-1">{e}</span>{r[k] || 0}</button>
      ))}</div>
    </Card>
  );
}

function Tags({ p }) {
  const [v, setV] = useState('');
  const add = () => { const t = v.trim(); if (t && !(p.tags || []).includes(t)) db.update('plans', p.id, { tags: [...(p.tags || []), t].slice(0, 12) }); setV(''); };
  return (
    <Card className="p-4">
      <h3 className="font-bold text-sm mb-2 flex items-center gap-1.5"><Tag className="size-4" />タグ</h3>
      <div className="flex flex-wrap gap-1.5 mb-2">{(p.tags || []).map((t) => <Badge key={t} tone="brand">{t}<button aria-label={`${t}を外す`} onClick={() => db.update('plans', p.id, { tags: p.tags.filter((x) => x !== t) })}><X className="size-3" /></button></Badge>)}</div>
      <div className="flex gap-1.5"><Input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="例：研究授業" className="h-9" /><Button size="sm" variant="soft" icon={Plus} onClick={add} aria-label="追加" /></div>
    </Card>
  );
}

function Comments({ p }) {
  const [v, setV] = useState('');
  const list = p.comments || [];
  const add = () => { if (!v.trim()) return; db.update('plans', p.id, { comments: [...list, { id: Date.now(), text: v.trim().slice(0, 1000), at: new Date().toISOString() }] }); setV(''); };
  return (
    <Card className="p-5 no-print">
      <h3 className="font-bold mb-3">メモ・コメント</h3>
      {list.length === 0 && <p className="text-sm text-mute mb-3">授業の気付きや、次回への申し送りを残せます。</p>}
      <ul className="space-y-2 mb-3">{list.map((c) => (
        <li key={c.id} className="group flex gap-3 rounded-xl bg-sunken px-4 py-3">
          <div className="flex-1 min-w-0"><p className="text-sm whitespace-pre-wrap">{c.text}</p><p className="text-xs text-mute mt-1">{fmtDateTime(c.at)}</p></div>
          <button aria-label="削除" className="opacity-0 group-hover:opacity-100 text-mute hover:text-bad" onClick={() => db.update('plans', p.id, { comments: list.filter((x) => x.id !== c.id) })}><X className="size-4" /></button>
        </li>
      ))}</ul>
      <div className="flex gap-2"><Textarea rows={2} value={v} onChange={(e) => setV(e.target.value)} placeholder="コメントを書く" /><Button icon={Send} onClick={add} disabled={!v.trim()} aria-label="送信" className="self-end" /></div>
    </Card>
  );
}

function ShareModal({ open, onClose, p }) {
  if (!open) return null;
  const { instructorName, schoolName, schoolEnvironment, studentCharacteristics, specialNeedsInfo, comments, reactions, ...pub } = p;
  const d = LZString.compressToEncodedURIComponent(JSON.stringify(pub));
  const url = `${location.origin}${location.pathname}#/shared?d=${d}`;
  return (
    <Modal open={open} onClose={onClose} title="共有リンク">
      <p className="text-sm text-mute mb-3">指導案の内容をリンクに埋め込みます（サーバーには保存しません）。指導者名・学校名・児童生徒の特徴などは含みません。</p>
      <Textarea readOnly rows={3} value={url} className="text-xs font-mono" onFocus={(e) => e.target.select()} />
      <div className="flex gap-2 mt-3"><CopyButton text={url} label="リンクをコピー" /><Button variant="outline" size="sm" onClick={() => window.open(url, '_blank')}>開いて確認</Button></div>
      {url.length > 8000 && <Notice tone="warn" className="mt-3">リンクが長いため、一部のメールやチャットでは途中で切れることがあります。その場合はファイルで書き出して共有してください。</Notice>}
    </Modal>
  );
}

function CalendarModal({ open, onClose, p }) {
  const cfg = useConfig();
  const [date, setDate] = useState(p.lessonDate || new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('09:00');
  const [min, setMin] = useState(p.schoolType === 'elementary' ? 45 : 50);
  const start = new Date(`${date}T${time}`);
  const opts = { start, minutes: Number(min) * (Number(p.teachingHours) || 1) };
  return (
    <Modal open={open} onClose={onClose} title="カレンダーに登録">
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Field label="日付"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="開始"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        <Field label="1時間の分数"><Input type="number" value={min} onChange={(e) => setMin(e.target.value)} /></Field>
      </div>
      <div className="space-y-2">
        <Button className="w-full" icon={CalendarPlus} disabled={!cfg.googleClientId} onClick={async () => { try { await addToGoogleCalendar(p, opts); toast('Googleカレンダーに登録しました'); db.update('plans', p.id, { lessonDate: date }); onClose(); } catch (e) { toast(e.message, 'bad'); } }}>Googleカレンダーに直接登録</Button>
        {!cfg.googleClientId && <p className="text-xs text-mute">直接登録は管理者の設定（GOOGLE_CLIENT_ID）が必要です。下の方法なら設定なしで使えます。</p>}
        <Button variant="outline" className="w-full" onClick={() => { window.open(googleCalendarLink(p, opts), '_blank'); db.update('plans', p.id, { lessonDate: date }); }}>Googleカレンダーの登録画面を開く</Button>
        <Button variant="outline" className="w-full" icon={Download} onClick={() => { download(new Blob([planToIcs(p, opts)], { type: 'text/calendar' }), `${safeName(p.title)}.ics`); db.update('plans', p.id, { lessonDate: date }); }}>.ics ファイル（Outlook・iPhone など）</Button>
      </div>
    </Modal>
  );
}

function PublishModal({ open, onClose, p }) {
  const cfg = useConfig();
  const s = useStore();
  const [price, setPrice] = useState(0);
  const [summary, setSummary] = useState('');
  const [name, setName] = useState(s.profile?.name || '');
  const [busy, setBusy] = useState(false);
  const mine = s.library.find((x) => x.planId === p.id);
  const evaluation = s.evaluations.filter((e) => e.planId === p.id).at(0)?.result;
  const publish = async () => {
    setBusy(true);
    try {
      const item = await api('lib.publish', { plan: p, price, summary, publisherName: name, evaluation: evaluation ? { overallScore: evaluation.overallScore, overallAssessment: evaluation.overallAssessment } : null });
      db.add('library', { remoteId: item.id, planId: p.id, title: p.title, price });
      toast('ライブラリに公開しました'); onClose();
    } catch (e) { toast(e.message === 'STORE_NOT_CONFIGURED' ? '共有データの置き場が未設定のため公開できません' : e.message, 'bad'); } finally { setBusy(false); }
  };
  const unpublish = async () => {
    setBusy(true);
    try { await api('lib.unpublish', { id: mine.remoteId }); db.remove('library', mine.id); toast('公開を取り消しました'); onClose(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="指導案ライブラリに公開">
      {!cfg.store ? <Notice tone="warn">ライブラリは、管理者が共有データの置き場（Upstash Redis）を設定すると使えます。</Notice> : mine ? (
        <div className="space-y-3"><Notice tone="good">この指導案は公開中です（{mine.price ? `${mine.price.toLocaleString()}円` : '無料'}）。</Notice><Button variant="danger" loading={busy} onClick={unpublish}>公開を取り消す</Button></div>
      ) : (
        <div className="space-y-4">
          <Notice tone="mute">公開時、指導者名・学校名・学校環境・児童生徒の特徴・特別支援の記載は自動で取り除かれます。</Notice>
          <Field label="公開する名前"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></Field>
          <Field label="紹介文"><Textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="この指導案の特長や、使ってみた感想" /></Field>
          <Field label="価格（円）" hint="0円で無料公開。有料は決済（Stripe）の設定が必要です"><Input type="number" min="0" step="100" value={price} onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))} /></Field>
          <Button className="w-full" icon={Upload} loading={busy} disabled={price > 0 && !cfg.stripe} onClick={publish}>公開する</Button>
        </div>
      )}
    </Modal>
  );
}

