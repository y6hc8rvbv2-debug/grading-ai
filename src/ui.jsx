// 画面の共通部品（ボタン・カード・入力欄・タブ・ダイアログ・通知など）
import { forwardRef, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { X, Loader2, Check, Copy, Sparkles, Info } from 'lucide-react';
import { cx } from './lib/util.js';

export function Button({ variant = 'primary', size = 'md', icon: Icon, loading, className, children, ...rest }) {
  const v = {
    primary: 'bg-brand text-on-brand hover:bg-brand-strong shadow-sm',
    soft: 'bg-brand-soft text-brand-strong hover:brightness-95',
    outline: 'border border-line bg-surface text-ink hover:bg-sunken',
    ghost: 'text-ink hover:bg-sunken',
    danger: 'bg-bad-soft text-bad hover:brightness-95',
  }[variant];
  const s = { sm: 'h-8 px-3 text-sm gap-1.5 rounded-lg', md: 'h-10 px-4 text-sm gap-2 rounded-xl', lg: 'h-12 px-6 text-base gap-2 rounded-xl' }[size];
  return (
    <button className={cx('inline-flex items-center justify-center font-medium transition disabled:opacity-50 whitespace-nowrap', v, s, className)} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className="size-4 shrink-0" /> : null}
      {children}
    </button>
  );
}
export const IconButton = ({ icon: Icon, label, className, ...rest }) => (
  <button aria-label={label} title={label} className={cx('inline-grid place-items-center size-9 rounded-lg text-mute hover:text-ink hover:bg-sunken transition', className)} {...rest}><Icon className="size-[18px]" /></button>
);

export const Card = forwardRef(({ className, children, ...rest }, ref) => <div ref={ref} className={cx('bg-surface border border-line rounded-2xl', className)} {...rest}>{children}</div>);
export const CardHead = ({ title, desc, icon: Icon, right }) => (
  <div className="flex items-start gap-3 px-5 pt-5 pb-3">
    {Icon && <div className="grid place-items-center size-9 rounded-xl bg-brand-soft text-brand-strong shrink-0"><Icon className="size-[18px]" /></div>}
    <div className="min-w-0 flex-1"><h3 className="font-bold text-[1.02rem] leading-snug">{title}</h3>{desc && <p className="text-sm text-mute mt-0.5">{desc}</p>}</div>
    {right}
  </div>
);

export function PageHeader({ title, desc, icon: Icon, actions }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-6">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {Icon && <div className="hidden sm:grid place-items-center size-11 rounded-2xl bg-brand-soft text-brand-strong shrink-0"><Icon className="size-5" /></div>}
        <div className="min-w-0"><h1 className="text-2xl font-bold tracking-tight">{title}</h1>{desc && <p className="text-mute text-sm mt-1">{desc}</p>}</div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const inputCls = 'w-full rounded-xl border border-line bg-surface px-3 py-2 text-[0.95rem] text-ink placeholder:text-mute/70 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft transition';
export const Input = ({ className, ...rest }) => <input className={cx(inputCls, 'h-10', className)} {...rest} />;
export const Textarea = ({ className, rows = 3, ...rest }) => <textarea rows={rows} className={cx(inputCls, 'leading-relaxed', className)} {...rest} />;
export const Select = ({ className, options = [], placeholder, ...rest }) => (
  <select className={cx(inputCls, 'h-10 pr-8', className)} {...rest}>
    {placeholder !== undefined && <option value="">{placeholder}</option>}
    {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
  </select>
);
export const Field = ({ label, hint, required, children, className }) => (
  <label className={cx('block', className)}>
    <span className="block text-sm font-medium mb-1.5">{label}{required && <span className="text-bad ml-1">*</span>}</span>
    {children}
    {hint && <span className="block text-xs text-mute mt-1">{hint}</span>}
  </label>
);

// 複数選択のチップ
export function Chips({ options, value = [], onChange, max }) {
  const toggle = (o) => onChange(value.includes(o) ? value.filter((x) => x !== o) : max && value.length >= max ? value : [...value, o]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button type="button" key={o} onClick={() => toggle(o)} aria-pressed={on}
            className={cx('h-8 px-3 rounded-full text-sm border transition', on ? 'bg-brand text-on-brand border-brand' : 'bg-surface border-line text-ink hover:border-brand/60')}>
            {on && <Check className="inline size-3.5 mr-1 -mt-0.5" />}{o}
          </button>
        );
      })}
    </div>
  );
}

export const Badge = ({ tone = 'mute', className, children }) => {
  const t = { mute: 'bg-sunken text-mute', brand: 'bg-brand-soft text-brand-strong', good: 'bg-good-soft text-good', warn: 'bg-warn-soft text-warn', bad: 'bg-bad-soft text-bad' }[tone];
  return <span className={cx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap', t, className)}>{children}</span>;
};

export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div className={cx('flex gap-1 overflow-x-auto scroll-thin border-b border-line no-print', className)} role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx('relative flex items-center gap-1.5 px-3.5 h-11 text-sm whitespace-nowrap transition', value === t.id ? 'text-brand-strong font-bold' : 'text-mute hover:text-ink')}>
          {t.icon && <t.icon className="size-4" />}{t.label}{t.count ? <span className="text-xs text-mute">({t.count})</span> : null}
          {value === t.id && <span className="absolute left-2 right-2 -bottom-px h-0.5 rounded bg-brand" />}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide, footer }) {
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div role="dialog" aria-modal="true" className={cx('rise bg-surface w-full rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-line">
          <h2 className="font-bold text-lg flex-1">{title}</h2>
          <IconButton icon={X} label="閉じる" onClick={onClose} />
        </div>
        <div className="p-5 overflow-y-auto scroll-thin">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

// ── 通知（右下に数秒表示） ──
let toasts = []; const tl = new Set();
export function toast(message, tone = 'good') {
  const id = Math.random();
  toasts = [...toasts, { id, message, tone }]; tl.forEach((l) => l());
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); tl.forEach((l) => l()); }, tone === 'bad' ? 6000 : 3200);
}
export function Toaster() {
  const list = useSyncExternalStore((l) => { tl.add(l); return () => tl.delete(l); }, () => toasts);
  return (
    <div className="fixed z-[60] bottom-4 right-4 left-4 sm:left-auto flex flex-col gap-2 items-end pointer-events-none no-print" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={cx('rise pointer-events-auto max-w-sm rounded-xl px-4 py-3 text-sm shadow-lg border', t.tone === 'bad' ? 'bg-bad-soft text-bad border-bad/30' : 'bg-ink text-bg border-transparent')}>{t.message}</div>
      ))}
    </div>
  );
}

// 確認ダイアログ（Promise で結果を返す）
let confirmState = null; const cl = new Set();
export function confirmDialog(message, { title = '確認', ok = 'OK', danger } = {}) {
  return new Promise((resolve) => { confirmState = { message, title, ok, danger, resolve }; cl.forEach((l) => l()); });
}
export function ConfirmHost() {
  const st = useSyncExternalStore((l) => { cl.add(l); return () => cl.delete(l); }, () => confirmState);
  const close = (v) => { st?.resolve(v); confirmState = null; cl.forEach((l) => l()); };
  return (
    <Modal open={Boolean(st)} onClose={() => close(false)} title={st?.title}
      footer={<><Button variant="outline" onClick={() => close(false)}>キャンセル</Button><Button variant={st?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{st?.ok}</Button></>}>
      <p className="text-[0.95rem] leading-relaxed whitespace-pre-wrap">{st?.message}</p>
    </Modal>
  );
}

export const Empty = ({ icon: Icon = Info, title, desc, action }) => (
  <div className="text-center py-14 px-6">
    <div className="mx-auto grid place-items-center size-14 rounded-2xl bg-sunken text-mute mb-4"><Icon className="size-6" /></div>
    <p className="font-bold">{title}</p>
    {desc && <p className="text-sm text-mute mt-1 max-w-md mx-auto">{desc}</p>}
    {action && <div className="mt-5">{action}</div>}
  </div>
);

export const Notice = ({ tone = 'brand', icon: Icon = Info, children, className }) => {
  const t = { brand: 'bg-brand-soft text-brand-strong', warn: 'bg-warn-soft text-warn', bad: 'bg-bad-soft text-bad', good: 'bg-good-soft text-good', mute: 'bg-sunken text-mute' }[tone];
  return <div className={cx('flex gap-2.5 rounded-xl px-4 py-3 text-sm leading-relaxed', t, className)}><Icon className="size-4 shrink-0 mt-0.5" /><div className="min-w-0 flex-1">{children}</div></div>;
};

// 点数の丸いメーター
export function ScoreRing({ value, size = 76, label }) {
  const n = value === null || value === undefined ? null : Math.max(0, Math.min(100, Number(value)));
  const r = size / 2 - 6; const c = 2 * Math.PI * r;
  const color = n === null ? 'var(--line)' : n >= 80 ? 'var(--good)' : n >= 60 ? 'var(--brand)' : n >= 40 ? 'var(--warn)' : 'var(--bad)';
  return (
    <div className="inline-flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label || '点数'} ${n ?? 'なし'}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sunken)" strokeWidth="7" />
        {n !== null && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(c * n) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
        <text x="50%" y="52%" dominantBaseline="middle" textAnchor="middle" fontSize={size * 0.28} fontWeight="700" fill="var(--ink)">{n ?? '—'}</text>
      </svg>
      {label && <span className="text-xs text-mute">{label}</span>}
    </div>
  );
}
export const Bar = ({ value, label }) => (
  <div>
    <div className="flex justify-between text-sm mb-1"><span>{label}</span><span className="font-bold tabular-nums">{value ?? '—'}</span></div>
    <div className="h-2 rounded-full bg-sunken overflow-hidden"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} /></div>
  </div>
);

// AI生成中の表示（流れてくる文字の末尾を見せる）
export function AiProgress({ text, label = 'AIが作成しています…' }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [text]);
  return (
    <div className="rounded-2xl border border-brand/30 bg-brand-soft/40 p-4">
      <div className="flex items-center gap-2 text-brand-strong font-medium text-sm"><Sparkles className="size-4 animate-pulse" />{label}<span className="text-xs text-mute ml-auto tabular-nums">{text ? `${text.length.toLocaleString()}文字` : '考えています'}</span></div>
      {text ? <pre ref={ref} className="mt-3 max-h-40 overflow-y-auto scroll-thin text-xs text-mute whitespace-pre-wrap font-mono leading-relaxed">{text.slice(-2500)}</pre> : null}
    </div>
  );
}
export const DemoNote = ({ show }) => (show ? <Notice tone="warn" className="mb-3">これは画面確認用の<strong>見本</strong>です。AI（Claude）が接続されると、入力内容に合わせて実際に作成されます。</Notice> : null);

export function CopyButton({ text, label = 'コピー' }) {
  const [done, setDone] = useState(false);
  return (
    <Button variant="outline" size="sm" icon={done ? Check : Copy} onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { toast('コピーできませんでした', 'bad'); } }}>
      {done ? 'コピーしました' : label}
    </Button>
  );
}

export const Section = ({ title, children, className }) => (
  <section className={cx('mb-5', className)}>
    <h4 className="text-sm font-bold text-brand-strong mb-1.5">{title}</h4>
    {children}
  </section>
);
export const BulletList = ({ items = [], tone }) => (
  <ul className="space-y-1.5">{items.filter(Boolean).map((x, i) => (
    <li key={i} className="flex gap-2 text-[0.95rem] leading-relaxed"><span className={cx('mt-2 size-1.5 rounded-full shrink-0', tone === 'good' ? 'bg-good' : tone === 'warn' ? 'bg-warn' : 'bg-brand')} /><span>{typeof x === 'string' ? x : JSON.stringify(x)}</span></li>
  ))}</ul>
);

export const Stat = ({ label, value, icon: Icon, hint }) => (
  <Card className="p-4">
    <div className="flex items-center gap-2 text-mute text-sm">{Icon && <Icon className="size-4" />}{label}</div>
    <div className="text-2xl font-bold mt-1 tabular-nums">{value}</div>
    {hint && <div className="text-xs text-mute mt-0.5">{hint}</div>}
  </Card>
);
