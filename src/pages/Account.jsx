import { useEffect, useState } from 'react';
import { Settings as SettingsIcon, User, Palette, Database, Cpu, Plug, Download, Upload, Trash2, Check, CreditCard, Shield, Sun, Moon, Monitor, KeyRound, Eye, ExternalLink, Crown } from 'lucide-react';
import { useStore, db, useDisplay, setDisplay, trialInfo } from '../lib/store.js';
import { useConfig, api } from '../lib/api.js';
import { navigate, href } from '../lib/router.js';
import { PLANS, planOf, CURRENCIES, formatPrice, CANCEL_REASONS } from '../lib/options.js';
import { quota } from '../lib/quota.js';
import { download, fmtDate, fmtDateTime, cx } from '../lib/util.js';
import { Button, Card, CardHead, Input, Textarea, Select, Field, PageHeader, Notice, Badge, Tabs, Modal, toast, confirmDialog, Stat, Empty } from '../ui.jsx';

const ACCENTS = [['teal', '#0f766e', 'ティール'], ['indigo', '#4338ca', 'インディゴ'], ['coral', '#c2472a', 'コーラル'], ['violet', '#7c3aed', 'バイオレット'], ['navy', '#1e4b8f', 'ネイビー']];

export function Settings({ query }) {
  const [tab, setTab] = useState(query.tab || 'account');
  return (
    <div>
      <PageHeader icon={SettingsIcon} title="設定" />
      <Tabs className="mb-6" value={tab} onChange={setTab} tabs={[{ id: 'account', label: 'アカウント', icon: User }, { id: 'display', label: '表示', icon: Palette }, { id: 'data', label: 'データ', icon: Database }, { id: 'ai', label: 'AI接続', icon: Cpu }, { id: 'integrations', label: '連携・管理', icon: Plug }]} />
      {tab === 'account' && <AccountTab />}{tab === 'display' && <DisplayTab />}{tab === 'data' && <DataTab />}{tab === 'ai' && <AiTab />}{tab === 'integrations' && <IntegrationsTab />}
    </div>
  );
}

function AccountTab() {
  const s = useStore();
  const p = s.profile; const t = trialInfo(p); const q = quota(s);
  const [name, setName] = useState(p.name);
  return (
    <div className="grid lg:grid-cols-2 gap-5 items-start">
      <Card><CardHead icon={User} title="アカウント" desc="この端末に保存されています" />
        <div className="px-5 pb-5 space-y-3">
          <Field label="お名前"><div className="flex gap-2"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /><Button variant="soft" disabled={!name.trim() || name === p.name} onClick={() => { db.set('profile', { ...p, name: name.trim() }); toast('変更しました'); }}>保存</Button></div></Field>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm"><dt className="text-mute">登録日</dt><dd>{fmtDate(p.createdAt)}</dd><dt className="text-mute">規約への同意</dt><dd>{fmtDateTime(p.termsAcceptedAt)}</dd><dt className="text-mute">利用者ID</dt><dd className="font-mono text-xs truncate">{p.id}</dd></dl>
        </div>
      </Card>
      <Card><CardHead icon={CreditCard} title="ご利用中のプラン" right={<Button size="sm" variant="soft" onClick={() => navigate('/subscription')}>変更</Button>} />
        <div className="px-5 pb-5"><p className="text-xl font-bold">{q.plan.name}</p><p className="text-sm text-mute mt-1">今月のAI作成：{q.used}件 ／ 上限 {q.limit === Infinity ? '無制限' : `${q.limit}件`}</p>
          {t.isFree && <p className={cx('text-sm mt-2', t.expired ? 'text-bad' : 'text-mute')}>{t.expired ? '無料期間は終了しました' : `無料期間の残り：${t.daysRemaining}日`}</p>}</div>
      </Card>
    </div>
  );
}

function DisplayTab() {
  const d = useDisplay();
  const Opt = ({ on, onClick, children }) => <button onClick={onClick} className={cx('flex items-center justify-center gap-2 h-11 rounded-xl border text-sm', on ? 'border-brand bg-brand-soft text-brand-strong font-bold' : 'border-line hover:bg-sunken')}>{children}</button>;
  return (
    <div className="grid lg:grid-cols-2 gap-5 items-start">
      <Card className="p-5 space-y-5">
        <div><p className="text-sm font-medium mb-2">明るさ</p><div className="grid grid-cols-3 gap-2">{[['light', 'ライト', Sun], ['dark', 'ダーク', Moon], ['system', '端末に合わせる', Monitor]].map(([v, l, I]) => <Opt key={v} on={d.theme === v} onClick={() => setDisplay({ theme: v })}><I className="size-4" />{l}</Opt>)}</div></div>
        <div><p className="text-sm font-medium mb-2">テーマカラー</p><div className="flex flex-wrap gap-3">{ACCENTS.map(([v, c, l]) => <button key={v} onClick={() => setDisplay({ accent: v })} className="flex flex-col items-center gap-1 text-xs" aria-pressed={d.accent === v}><span className={cx('grid place-items-center size-11 rounded-full ring-offset-2 ring-offset-surface', d.accent === v && 'ring-2 ring-ink')} style={{ background: c }}>{d.accent === v && <Check className="size-5 text-white" />}</span>{l}</button>)}</div></div>
        <div><p className="text-sm font-medium mb-2">文字の大きさ</p><div className="grid grid-cols-3 gap-2">{[['sm', '小'], ['md', '標準'], ['lg', '大']].map(([v, l]) => <Opt key={v} on={d.size === v} onClick={() => setDisplay({ size: v })}>{l}</Opt>)}</div></div>
      </Card>
      <Card className="p-5 space-y-4">
        <Field label="メニューの言語" hint="指導案そのものは、作成画面で選んだ言語（約100言語）で生成されます"><Select value={d.language === 'en' ? 'en' : 'ja'} onChange={(e) => setDisplay({ language: e.target.value })} options={[{ value: 'ja', label: '日本語' }, { value: 'en', label: 'English（メニューのみ）' }]} /></Field>
        <Field label="価格の表示通貨" hint="参考の換算です。お支払いは日本円です"><Select value={d.currency} onChange={(e) => setDisplay({ currency: e.target.value })} options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.code}｜${c.name}` }))} /></Field>
        <p className="text-sm text-mute">例：個人・塾コース {formatPrice(1980, d.currency)}／月</p>
      </Card>
    </div>
  );
}

function DataTab() {
  const s = useStore();
  const [est, setEst] = useState(null);
  useEffect(() => { navigator.storage?.estimate?.().then(setEst).catch(() => {}); }, []);
  const backup = () => { download(new Blob([JSON.stringify(db.exportAll())], { type: 'application/json' }), `授業スタジオ_バックアップ_${new Date().toISOString().slice(0, 10)}.json`); toast('バックアップを保存しました'); };
  const restore = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    try { const data = JSON.parse(await f.text()); if (!(await confirmDialog('バックアップの内容で、この端末のデータを置き換えます（録画・録音は含まれません）。よろしいですか？', { ok: '復元する' }))) return; db.importAll(data); toast('復元しました'); } catch (err) { toast(err.message || 'ファイルを読み込めませんでした', 'bad'); }
  };
  const wipe = async () => { if (await confirmDialog('この端末に保存した指導案・記録・名簿・録画などをすべて削除します。元に戻せません。', { ok: 'すべて削除', danger: true })) { await db.wipe(); toast('削除しました'); navigate('/'); } };
  const counts = [['plans', '指導案'], ['notes', 'ノート'], ['behaviors', '観察'], ['reflections', '振り返り'], ['evaluations', '総合評価'], ['materials', '教材'], ['recordings', '録画・録音'], ['roster', '名簿']];
  return (
    <div className="grid lg:grid-cols-2 gap-5 items-start">
      <Card><CardHead icon={Database} title="保存しているデータ" desc="すべてこの端末のブラウザの中にあります" />
        <div className="px-5 pb-5"><div className="grid grid-cols-2 gap-2 text-sm">{counts.map(([k, l]) => <div key={k} className="flex justify-between rounded-lg bg-sunken px-3 py-2"><span>{l}</span><span className="font-bold tabular-nums">{s[k].length}</span></div>)}</div>
          {est && <p className="text-xs text-mute mt-3">使用量：約{Math.round((est.usage || 0) / 1e6)}MB ／ 上限の目安 {Math.round((est.quota || 0) / 1e9)}GB</p>}</div>
      </Card>
      <div className="space-y-4">
        <Card className="p-5 space-y-3">
          <h3 className="font-bold">バックアップと復元</h3>
          <p className="text-sm text-mute">別の端末へ移す時や、万一に備えて定期的に保存してください。録画・録音は容量が大きいため含まれません（個別にダウンロードしてください）。</p>
          <div className="flex flex-wrap gap-2"><Button icon={Download} onClick={backup}>バックアップを保存</Button><label className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-line text-sm cursor-pointer hover:bg-sunken"><Upload className="size-4" />復元する<input type="file" accept="application/json,.json" className="hidden" onChange={restore} /></label></div>
        </Card>
        <Card className="p-5 space-y-3 border-bad/30"><h3 className="font-bold text-bad">データの削除</h3><p className="text-sm text-mute">共用の端末で使った後などに。</p><Button variant="danger" icon={Trash2} onClick={wipe}>すべてのデータを削除</Button></Card>
      </div>
    </div>
  );
}

function AiTab() {
  const cfg = useConfig(); const d = useDisplay();
  const [code, setCode] = useState(d.accessCode);
  return (
    <div className="grid lg:grid-cols-2 gap-5 items-start">
      <Card><CardHead icon={Cpu} title="AI（Claude）の接続状態" />
        <div className="px-5 pb-5 space-y-3">
          <div className="flex items-center gap-2"><Badge tone={cfg.ai ? 'good' : 'warn'}>{cfg.ai ? '接続済み' : '未接続（見本モード）'}</Badge>{cfg.ai && <span className="text-sm text-mute">モデル：{cfg.model}</span>}</div>
          {!cfg.ai && <Notice tone="warn">サーバー（Vercel）の環境変数に <code>ANTHROPIC_API_KEY</code> を設定すると、Claude による本番の生成に切り替わります。設定するまでは、入力内容を当てはめた見本を表示します。</Notice>}
          <p className="text-sm text-mute leading-relaxed">AIに送るのは、作業に必要な情報だけです。児童生徒の名前は仮名に置き換え、指導者名・学校名は送りません。APIキーはサーバーにだけ置かれ、この画面からは見えません。</p>
        </div>
      </Card>
      {cfg.accessCode && <Card><CardHead icon={KeyRound} title="アクセスコード" desc="管理者が利用者を限定しています" />
        <div className="px-5 pb-5 flex gap-2"><Input type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="管理者から受け取ったコード" /><Button onClick={() => { setDisplay({ accessCode: code }); toast('保存しました'); }}>保存</Button></div>
      </Card>}
    </div>
  );
}

function IntegrationsTab() {
  const cfg = useConfig();
  const rows = [
    ['AI（Claude）', cfg.ai, 'ANTHROPIC_API_KEY', '指導案・分析・教材などの生成'],
    ['共有データの置き場', cfg.store, 'KV_REST_API_URL / KV_REST_API_TOKEN', 'ライブラリ・利用者の声・機能提案・QR提出（VercelのUpstash for Redis連携で自動設定）'],
    ['個人情報の暗号化（PII Shield）', cfg.pii, 'PII_KEY_V1 / PII_INDEX_KEY', 'お問い合わせフォームの氏名・メール・電話の暗号化保存'],
    ['決済（Stripe）', cfg.stripe, 'STRIPE_SECRET_KEY', '有料プラン・指導案の購入'],
    ['Google連携', Boolean(cfg.googleClientId), 'GOOGLE_CLIENT_ID', 'Googleカレンダーへの直接登録・Googleドライブへの保存'],
    ['管理者', cfg.admin, 'ADMIN_KEY', '管理者画面（売上・問い合わせ・公開物の管理）'],
  ];
  return (
    <div className="space-y-4">
      <Card className="divide-y divide-line">{rows.map(([l, ok, env, d]) => (
        <div key={l} className="flex flex-col sm:flex-row sm:items-center gap-2 px-5 py-4">
          <div className="flex-1"><p className="font-medium flex items-center gap-2">{l}<Badge tone={ok ? 'good' : 'mute'}>{ok ? '有効' : '未設定'}</Badge></p><p className="text-sm text-mute">{d}</p></div>
          <code className="text-xs bg-sunken rounded px-2 py-1 self-start sm:self-auto">{env}</code>
        </div>
      ))}</Card>
      <Notice tone="mute">これらは Vercel のプロジェクト設定 →「Environment Variables」で設定します。未設定の機能は「この端末だけ」で動くか、利用できない旨を表示します。</Notice>
      {cfg.admin && <Button variant="outline" icon={Shield} onClick={() => navigate('/admin')}>管理者画面を開く</Button>}
    </div>
  );
}

// ── プラン（サブスクリプション） ──
export function Subscription({ query }) {
  const cfg = useConfig();
  const s = useStore();
  const { currency } = useDisplay();
  const p = s.profile; const cur = planOf(p.plan); const q = quota(s);
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState(null);
  const [cancel, setCancel] = useState(false);

  useEffect(() => {
    if (!query.session || !cfg.stripe) return;
    api('stripe.verify', { sessionId: query.session }).then((r) => {
      if (r.paid && r.type === 'subscription') { db.set('profile', { ...p, plan: r.planCode, stripe: { customerId: r.customerId, subscriptionId: r.subscriptionId } }); toast(`${planOf(r.planCode).name}にお申し込みいただきました`); }
      navigate('/subscription', { replace: true });
    }).catch((e) => toast(e.message, 'bad'));
  }, [query.session, cfg.stripe]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (cfg.stripe && p.stripe?.subscriptionId) api('stripe.status', { subscriptionId: p.stripe.subscriptionId }).then(setStatus).catch(() => {}); }, [cfg.stripe, p.stripe?.subscriptionId]);

  const choose = async (plan) => {
    if (plan.code === 'free') { if (p.stripe?.subscriptionId) { setCancel(true); return; } return; }
    setBusy(plan.code);
    try { const { url } = await api('stripe.checkout', { kind: 'subscription', planCode: plan.code, customerId: p.stripe?.customerId }); location.href = url; } catch (e) { toast(e.message, 'bad'); setBusy(''); }
  };
  const portal = async () => { setBusy('portal'); try { const { url } = await api('stripe.portal', { customerId: p.stripe.customerId }); location.href = url; } catch (e) { toast(e.message, 'bad'); setBusy(''); } };

  return (
    <div>
      <PageHeader icon={CreditCard} title="プラン" desc="すべてのプランで全機能を使えます。違いは毎月AIで作成できる指導案の数です" />
      {!cfg.stripe && cfg.loaded && <Notice tone="warn" className="mb-5">決済（Stripe）が未設定のため、いまは有料プランへの申し込みはできません。管理者が <code>STRIPE_SECRET_KEY</code> を設定すると利用できます。</Notice>}
      <div className="grid sm:grid-cols-3 gap-3 mb-6">
        <Stat label="現在のプラン" value={cur.name} icon={Crown} hint={status ? (status.cancelAtPeriodEnd ? `解約予定（${fmtDate(status.currentPeriodEnd * 1000)}まで利用可）` : `次回更新 ${fmtDate(status.currentPeriodEnd * 1000)}`) : ''} />
        <Stat label="今月のAI作成" value={`${q.used}件`} hint={`上限 ${q.limit === Infinity ? '無制限' : `${q.limit}件`}`} />
        <Stat label="残り" value={q.left === Infinity ? '無制限' : `${q.left}件`} hint={q.trial.isFree ? (q.trial.expired ? '無料期間終了' : `無料期間 残り${q.trial.daysRemaining}日`) : ''} />
      </div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-4">{PLANS.map((pl) => {
        const mine = pl.code === cur.code;
        return (
          <Card key={pl.code} className={cx('p-5 flex flex-col relative', pl.popular && 'ring-2 ring-brand', mine && 'bg-brand-soft/30')}>
            {pl.popular && <Badge tone="brand" className="absolute -top-2.5 left-5">おすすめ</Badge>}
            <h3 className="font-bold">{pl.name}</h3>
            <p className="mt-2"><span className="text-3xl font-bold">{pl.price ? formatPrice(pl.price, currency) : '0円'}</span>{pl.price > 0 && <span className="text-sm text-mute">／月</span>}</p>
            <p className="text-sm text-mute mt-1">{pl.desc}</p>
            <ul className="mt-4 space-y-2 text-sm flex-1">{pl.features.map((f) => <li key={f} className="flex gap-2"><Check className="size-4 text-good shrink-0 mt-0.5" />{f}</li>)}</ul>
            <Button className="mt-5" variant={mine ? 'soft' : pl.popular ? 'primary' : 'outline'} disabled={mine || (pl.price > 0 && !cfg.stripe) || (pl.code === 'free' && !p.stripe?.subscriptionId)} loading={busy === pl.code} onClick={() => choose(pl)}>{mine ? 'ご利用中' : pl.price ? '申し込む' : '無料に戻す'}</Button>
          </Card>
        );
      })}</div>
      {p.stripe?.customerId && cfg.stripe && (
        <Card className="p-5 mt-6 flex flex-wrap items-center gap-3"><p className="flex-1 text-sm">お支払い方法の変更・領収書の確認は、Stripeの管理画面から行えます。</p><Button variant="outline" icon={ExternalLink} loading={busy === 'portal'} onClick={portal}>お支払い情報の管理</Button>{!status?.cancelAtPeriodEnd && <Button variant="danger" onClick={() => setCancel(true)}>解約する</Button>}</Card>
      )}
      <p className="text-xs text-mute mt-4">表示価格は税込です。通貨の換算は参考値で、お支払いは日本円です。<a className="underline" href={href('/contact')}>学校・教育委員会での導入のご相談</a></p>
      <CancelModal open={cancel} onClose={() => setCancel(false)} onDone={(st) => setStatus(st)} />
    </div>
  );
}

function CancelModal({ open, onClose, onDone }) {
  const p = useStore((s) => s.profile);
  const [reason, setReason] = useState(CANCEL_REASONS[0]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await api('stripe.cancel', { subscriptionId: p.stripe.subscriptionId, reason, comment }); const st = await api('stripe.status', { subscriptionId: p.stripe.subscriptionId }); onDone(st); toast('解約を受け付けました。期間の終わりまでご利用いただけます'); onClose(); } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="解約の手続き" footer={<><Button variant="outline" onClick={onClose}>やめる</Button><Button variant="danger" loading={busy} onClick={go}>解約する</Button></>}>
      <p className="text-sm text-mute mb-4">解約しても、現在の期間の終わりまでは今のプランでご利用いただけます。よろしければ理由をお聞かせください。</p>
      <Field label="理由"><Select value={reason} onChange={(e) => setReason(e.target.value)} options={CANCEL_REASONS} /></Field>
      <Field label="ご意見（任意）" className="mt-3"><Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={400} /></Field>
    </Modal>
  );
}

// ── 管理者 ──
export function Admin() {
  const cfg = useConfig();
  const [key, setKey] = useState(() => sessionStorage.getItem('js-admin') || '');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState({});
  const load = async (k = key) => {
    setBusy(true);
    try { const d = await api('admin.overview', { adminKey: k }); setData(d); sessionStorage.setItem('js-admin', k); } catch (e) { toast(e.message, 'bad'); setData(null); } finally { setBusy(false); }
  };
  useEffect(() => { if (key && cfg.admin) load(); }, [cfg.admin]); // eslint-disable-line react-hooks/exhaustive-deps
  const reveal = async (id) => { try { const r = await api('admin.reveal', { adminKey: key, id }); setRevealed((x) => ({ ...x, [id]: r })); } catch (e) { toast(e.message, 'bad'); } };
  const yen = (arr) => (arr || []).filter((b) => b.currency === 'jpy').reduce((n, b) => n + b.amount, 0);
  if (!cfg.admin) return <div><PageHeader icon={Shield} title="管理者" /><Card><Empty icon={Shield} title="管理者機能は未設定です" desc="サーバーの環境変数に ADMIN_KEY を設定すると使えます。" /></Card></div>;
  return (
    <div>
      <PageHeader icon={Shield} title="管理者" desc="売上・公開物・問い合わせ・提案の管理" actions={data && <Button variant="outline" onClick={() => { sessionStorage.removeItem('js-admin'); setKey(''); setData(null); }}>ログアウト</Button>} />
      {!data ? (
        <Card className="p-5 max-w-md"><Field label="管理者キー"><div className="flex gap-2"><Input type="password" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} /><Button loading={busy} onClick={() => load()}>開く</Button></div></Field><p className="text-xs text-mute mt-2">キーはこのタブを閉じると消えます。</p></Card>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="有効な契約" value={data.revenue?.activeSubscriptions ?? '—'} />
            <Stat label="月間の定期収入" value={data.revenue ? `¥${data.revenue.monthlyRecurring.toLocaleString()}` : '—'} />
            <Stat label="残高（利用可能）" value={data.revenue ? `¥${yen(data.revenue.available).toLocaleString()}` : '—'} hint={data.revenue ? `保留中 ¥${yen(data.revenue.pending).toLocaleString()}` : '決済未設定'} />
            <Stat label="公開指導案 / 利用者の声" value={`${data.library.length} / ${data.testimonials}`} />
          </div>
          <Card><CardHead title="お問い合わせ" desc="一覧はマスク表示。「開示」は1件ずつ、記録付きで平文を表示します" />
            {data.inquiries.length === 0 ? <p className="px-5 pb-5 text-sm text-mute">{cfg.pii ? 'お問い合わせはありません' : '個人情報の暗号化（PII Shield）の鍵が未設定です'}</p> : (
              <div className="divide-y divide-line">{data.inquiries.map((r) => { const v = revealed[r.id] || r; return (
                <div key={r.id} className="px-5 py-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2 mb-1"><Badge tone={r.kind === 'help' ? 'brand' : 'good'}>{r.kind === 'help' ? 'ヘルプ' : '導入相談'}</Badge><span className="font-bold">{r.subject || r.organizationName}</span><span className="text-xs text-mute">{fmtDateTime(r.createdAt)}</span><span className="flex-1" />{!revealed[r.id] && <Button size="sm" variant="outline" icon={Eye} onClick={() => reveal(r.id)}>開示</Button>}</div>
                  <p className="text-mute">{v.name}・{v.email}{v.phone ? `・${v.phone}` : ''}</p>
                  <p className="mt-1 whitespace-pre-wrap">{r.message}</p>
                </div>
              ); })}</div>
            )}
          </Card>
          <Card><CardHead title="公開中の指導案" />
            {data.library.length === 0 ? <p className="px-5 pb-5 text-sm text-mute">ありません</p> : <div className="divide-y divide-line">{data.library.map((l) => (
              <div key={l.id} className="flex items-center gap-3 px-5 py-3 text-sm"><span className="flex-1 min-w-0 truncate">{l.title}（{l.subject}）</span><span className="text-mute">{l.publisherName}</span><Badge>{l.price ? `¥${l.price}` : '無料'}</Badge><span className="text-mute">販売{l.sales || 0}</span>
                <Button size="sm" variant="ghost" icon={Trash2} onClick={async () => { if (await confirmDialog('この指導案の公開を取り消しますか？', { ok: '取り消す', danger: true })) { try { await api('lib.unpublish', { id: l.id, adminKey: key }); load(); } catch (e) { toast(e.message, 'bad'); } } }} /></div>
            ))}</div>}
          </Card>
          <Card><CardHead title="機能提案" />
            {data.suggestions.length === 0 ? <p className="px-5 pb-5 text-sm text-mute">ありません</p> : <div className="divide-y divide-line">{data.suggestions.map((x) => <div key={x.id} className="px-5 py-3 text-sm"><div className="flex gap-2 items-center"><Badge>{x.category}</Badge><span className="font-bold">{x.title}</span><span className="text-xs text-mute ml-auto">{fmtDate(x.createdAt)}</span></div><p className="text-mute mt-1">{x.description}</p></div>)}</div>}
          </Card>
        </div>
      )}
    </div>
  );
}

