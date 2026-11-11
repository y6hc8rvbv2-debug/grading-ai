// アプリの骨組み：サイドメニュー、上部バー、コマンドパレット（Ctrl+K）、画面の切り替え
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutDashboard, FilePlus2, Files, CalendarDays, Video, MessagesSquare, BarChart3, HeartHandshake, Library, BookOpen, LayoutTemplate,
  Users, Timer, Star, Lightbulb, LifeBuoy, CreditCard, Settings as SettingsIcon, Search, Menu, X, Sun, Moon, Command, Shield, Loader2,
} from 'lucide-react';
import { useStore, useDisplay, setDisplay } from './lib/store.js';
import { useRoute, navigate, match, href } from './lib/router.js';
import { useConfig } from './lib/api.js';
import { useT } from './lib/i18n.js';
import { cx } from './lib/util.js';
import { Toaster, ConfirmHost, Badge } from './ui.jsx';

import { Welcome, Dashboard } from './pages/Home.jsx';
import CreatePlan from './pages/Create.jsx';
import { PlanList } from './pages/Plans.jsx';
import PlanDetail from './pages/Detail.jsx';
import PlanEdit from './pages/Edit.jsx';
import LibraryPage from './pages/Library.jsx';
import { Recordings, Reflections, Evaluations } from './pages/Records.jsx';
import { CalendarPage, Roster, Templates, TimerPage } from './pages/Tools.jsx';
import Papers from './pages/Papers.jsx';
import { Testimonials, Suggestions } from './pages/Community.jsx';
import { Help, Contact, Legal, SpecialNeedsGuide } from './pages/Support.jsx';
import { Settings, Subscription, Admin } from './pages/Account.jsx';
import StudentUpload from './pages/Student.jsx';
import Shared from './pages/Shared.jsx';

const NAV = [
  ['つくる', [['/', 'ダッシュボード', LayoutDashboard], ['/create', '新しい指導案', FilePlus2], ['/plans', '指導案一覧', Files], ['/calendar', 'カレンダー', CalendarDays]]],
  ['記録と評価', [['/recordings', '録画・録音', Video], ['/reflections', '振り返り会議', MessagesSquare], ['/evaluations', '評価レポート', BarChart3], ['/special-needs', '特別支援ガイド', HeartHandshake]]],
  ['資料とツール', [['/library', '指導案ライブラリ', Library], ['/papers', '教育論文', BookOpen], ['/templates', 'テンプレート', LayoutTemplate], ['/roster', '名簿', Users], ['/timer', '授業タイマー', Timer]]],
  ['みんなで', [['/testimonials', '利用者の声', Star], ['/suggestions', '機能提案', Lightbulb]]],
  ['サポート', [['/help', 'ヘルプ', LifeBuoy], ['/subscription', 'プラン', CreditCard], ['/settings', '設定', SettingsIcon]]],
];

const ROUTES = [
  ['/', Dashboard], ['/create', CreatePlan], ['/plans', PlanList], ['/plans/:id', PlanDetail], ['/plans/:id/edit', PlanEdit],
  ['/library', LibraryPage], ['/recordings', Recordings], ['/reflections', Reflections], ['/evaluations', Evaluations],
  ['/calendar', CalendarPage], ['/roster', Roster], ['/templates', Templates], ['/timer', TimerPage], ['/papers', Papers],
  ['/testimonials', Testimonials], ['/suggestions', Suggestions], ['/help', Help], ['/contact', Contact], ['/legal/:doc', Legal],
  ['/special-needs', SpecialNeedsGuide], ['/settings', Settings], ['/subscription', Subscription], ['/admin', Admin],
];

export default function App() {
  const ready = useStore((s) => s.ready);
  const profile = useStore((s) => s.profile);
  const { path, query } = useRoute();

  // 児童生徒の提出ページ・共有ページ・規約は、登録なしで開ける
  const up = match('/upload/:code', path);
  if (up) return <><StudentUpload code={up.code} /><Toaster /></>;
  if (path === '/shared') return <><Shared data={query.d} /><Toaster /></>;
  const legal = match('/legal/:doc', path);
  if (!ready) return <div className="min-h-screen grid place-items-center text-mute"><Loader2 className="size-6 animate-spin" /></div>;
  if (!profile && !legal) return <><Welcome /><Toaster /><ConfirmHost /></>;
  return <Shell path={path} query={query} />;
}

function Shell({ path, query }) {
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);
  const t = useT();
  const profile = useStore((s) => s.profile);

  useEffect(() => {
    const k = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((v) => !v); }
      const typing = /input|textarea|select/i.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === '/') { e.preventDefault(); setPalette(true); }
        if (e.key === 'n' || e.key === 'N') { e.preventDefault(); navigate('/create'); }
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => setMenu(false), [path]);

  let page = null;
  for (const [pattern, C] of ROUTES) {
    const params = match(pattern, path);
    if (params) { page = <C {...params} query={query} />; break; }
  }
  if (!page) page = <div className="text-center py-20"><p className="text-lg font-bold">ページが見つかりません</p><a className="text-brand underline mt-3 inline-block" href={href('/')}>ダッシュボードへ戻る</a></div>;
  const active = (to) => (to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`));

  const nav = (
    <nav className="flex flex-col gap-5 px-3 py-4">
      {NAV.map(([group, items]) => (
        <div key={group}>
          <div className="px-3 mb-1 text-[0.7rem] font-bold tracking-wider text-mute/80 uppercase">{t(group)}</div>
          {items.map(([to, label, Icon]) => (
            <a key={to} href={href(to)} className={cx('flex items-center gap-3 h-9 px-3 rounded-lg text-sm transition', active(to) ? 'bg-brand-soft text-brand-strong font-bold' : 'text-ink/85 hover:bg-sunken')}>
              <Icon className="size-[18px] shrink-0" />{t(label)}
            </a>
          ))}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[256px_1fr]">
      <aside className="hidden lg:flex flex-col sticky top-0 h-screen border-r border-line bg-surface/60 no-print">
        <Brand />
        <div className="flex-1 overflow-y-auto scroll-thin">{nav}</div>
        <ProfileChip profile={profile} />
      </aside>
      {menu && (
        <div className="fixed inset-0 z-40 lg:hidden no-print" onClick={() => setMenu(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <aside className="rise absolute left-0 top-0 bottom-0 w-72 bg-surface flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center pr-2"><Brand /><button className="ml-auto p-2 text-mute" aria-label="閉じる" onClick={() => setMenu(false)}><X className="size-5" /></button></div>
            <div className="flex-1 overflow-y-auto scroll-thin">{nav}</div>
            <ProfileChip profile={profile} />
          </aside>
        </div>
      )}
      <div className="min-w-0 flex flex-col">
        <TopBar onMenu={() => setMenu(true)} onSearch={() => setPalette(true)} />
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 rise" key={path}>{page}</main>
        <footer className="no-print border-t border-line text-xs text-mute px-6 py-5 flex flex-wrap gap-x-5 gap-y-2 justify-center">
          <a href={href('/legal/terms')} className="hover:text-ink">利用規約</a>
          <a href={href('/legal/privacy')} className="hover:text-ink">プライバシーポリシー</a>
          <a href={href('/legal/security')} className="hover:text-ink">セキュリティ</a>
          <a href={href('/contact')} className="hover:text-ink">法人・学校のお問い合わせ</a>
          <span>AI: Claude（Anthropic）</span>
        </footer>
      </div>
      <Palette open={palette} onClose={() => setPalette(false)} />
      <Toaster /><ConfirmHost />
    </div>
  );
}

const Brand = () => (
  <a href={href('/')} className="flex items-center gap-2.5 px-5 h-16 shrink-0">
    <span className="grid place-items-center size-9 rounded-xl bg-brand text-on-brand shadow-sm">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"><path d="M5 18V8l7-3 7 3v10l-7 3z" /><path d="M12 11v10" /></svg>
    </span>
    <span className="leading-tight"><span className="block font-display font-bold text-[1.05rem]">授業スタジオ</span><span className="block text-[0.68rem] text-mute">Lesson Studio · with Claude</span></span>
  </a>
);

function ProfileChip({ profile }) {
  return (
    <a href={href('/settings')} className="m-3 flex items-center gap-3 rounded-xl p-2.5 hover:bg-sunken transition">
      <span className="grid place-items-center size-9 rounded-full bg-brand-soft text-brand-strong font-bold">{(profile?.name || '先')[0]}</span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-bold truncate">{profile?.name || '先生'}</span><span className="block text-xs text-mute">{({ free: '無料コース', mini: 'ミニコース', individual: '個人・塾コース', school: '学校コース', government: '行政コース' })[profile?.plan || 'free']}</span></span>
    </a>
  );
}

function TopBar({ onMenu, onSearch }) {
  const d = useDisplay();
  const cfg = useConfig();
  const t = useT();
  const dark = document.documentElement.classList.contains('dark');
  return (
    <header className="no-print sticky top-0 z-30 h-16 flex items-center gap-2 px-3 sm:px-6 border-b border-line bg-bg/85 backdrop-blur">
      <button className="lg:hidden p-2 text-mute" aria-label="メニュー" onClick={onMenu}><Menu className="size-5" /></button>
      <button onClick={onSearch} className="flex-1 max-w-md flex items-center gap-2 h-10 px-3 rounded-xl border border-line bg-surface text-mute text-sm hover:border-brand/50 transition">
        <Search className="size-4" /><span className="flex-1 text-left truncate">{t('検索・移動')}…</span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[0.7rem] border border-line rounded px-1.5 py-0.5"><Command className="size-3" />K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-1.5">
        {cfg.loaded && <Badge tone={cfg.ai ? 'good' : 'warn'} className="hidden sm:inline-flex">{cfg.ai ? 'AI接続中' : 'AI見本モード'}</Badge>}
        <button className="grid place-items-center size-10 rounded-xl text-mute hover:bg-sunken" aria-label="明るさの切り替え" title="ライト／ダーク"
          onClick={() => setDisplay({ theme: dark ? 'light' : 'dark' })}>{dark ? <Sun className="size-5" /> : <Moon className="size-5" />}</button>
        <span className="sr-only">{d.theme}</span>
      </div>
    </header>
  );
}

// ── コマンドパレット：画面移動・指導案の検索・よく使う操作 ──
function Palette({ open, onClose }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const plans = useStore((s) => s.plans);
  const ref = useRef(null);
  const t = useT();
  useEffect(() => { if (open) { setQ(''); setI(0); setTimeout(() => ref.current?.focus(), 10); } }, [open]);
  const items = useMemo(() => {
    const k = q.trim().toLowerCase();
    const pages = NAV.flatMap(([, list]) => list).map(([to, label, Icon]) => ({ kind: '画面', label: t(label), icon: Icon, run: () => navigate(to) }));
    const actions = [
      { kind: '操作', label: 'ダークモードに切り替え', icon: Moon, run: () => setDisplay({ theme: 'dark' }) },
      { kind: '操作', label: 'ライトモードに切り替え', icon: Sun, run: () => setDisplay({ theme: 'light' }) },
      { kind: '操作', label: 'データをバックアップ', icon: Shield, run: () => navigate('/settings?tab=data') },
    ];
    const ps = plans.filter((p) => !k || [p.title, p.subject, p.unit, ...(p.tags || [])].join(' ').toLowerCase().includes(k)).slice(0, 8)
      .map((p) => ({ kind: '指導案', label: p.title || '無題', sub: [p.subject, p.unit].filter(Boolean).join('・'), icon: Files, run: () => navigate(`/plans/${p.id}`) }));
    const filt = (arr) => arr.filter((x) => !k || x.label.toLowerCase().includes(k));
    return [...ps, ...filt(pages), ...filt(actions)].slice(0, 14);
  }, [q, plans, t]);
  if (!open) return null;
  const go = (it) => { onClose(); it?.run(); };
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-start justify-center pt-[12vh] px-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rise w-full max-w-xl bg-surface rounded-2xl shadow-2xl border border-line overflow-hidden">
        <div className="flex items-center gap-3 px-4 border-b border-line">
          <Search className="size-5 text-mute" />
          <input ref={ref} value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} placeholder="指導案・画面・操作を検索"
            className="flex-1 h-14 bg-transparent outline-none text-base"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
              if (e.key === 'Enter') go(items[i]);
              if (e.key === 'Escape') onClose();
            }} />
          <kbd className="text-xs text-mute border border-line rounded px-1.5">Esc</kbd>
        </div>
        <ul className="max-h-[55vh] overflow-y-auto scroll-thin p-2">
          {items.length === 0 && <li className="p-6 text-center text-sm text-mute">見つかりませんでした</li>}
          {items.map((it, n) => (
            <li key={`${it.kind}-${it.label}-${n}`}>
              <button onMouseEnter={() => setI(n)} onClick={() => go(it)} className={cx('w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left', n === i ? 'bg-brand-soft' : '')}>
                <it.icon className="size-4 text-mute shrink-0" />
                <span className="flex-1 min-w-0"><span className="block text-sm truncate">{it.label}</span>{it.sub && <span className="block text-xs text-mute truncate">{it.sub}</span>}</span>
                <span className="text-[0.7rem] text-mute">{it.kind}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="px-4 py-2 border-t border-line text-[0.72rem] text-mute flex gap-4"><span>↑↓ 選択</span><span>Enter 決定</span><span>N 新規作成</span><span>/ 検索</span></div>
      </div>
    </div>
  );
}
