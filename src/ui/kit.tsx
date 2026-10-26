/**
 * BlueGuardian UI kit: the few building blocks every screen shares, so cards,
 * buttons, notices and status pills look and read the same everywhere.
 *
 * Copy rules used across the app:
 *  - Sentence case. Titles are 1–4 words; buttons are a verb plus an object ("Save file").
 *  - One short helper line under a title at most; details live behind "Details".
 *  - No engineering terms on main screens (BLE, GATT, token, backend, IndexedDB).
 */
import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle, ChevronDown, Info, LoaderCircle, X, AlertCircle } from 'lucide-react';
import { cn } from '../utils/cn';

export function Card({ title, subtitle, icon, action, children, className, tone }: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  tone?: 'accent' | 'danger';
}) {
  return (
    <section className={cn(
      'rounded-3xl p-5',
      tone === 'accent' ? 'bg-[var(--accent-soft)] ring-1 ring-[var(--border-strong)]'
        : tone === 'danger' ? 'bg-[var(--danger)]/10 ring-1 ring-[var(--danger)]/30'
          : 'bg-[var(--surface)]',
      className,
    )}>
      {(title || action) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {icon && <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">{icon}</span>}
            <div className="min-w-0">
              {title && <h2 className="text-[15px] font-bold text-[var(--text)]">{title}</h2>}
              {subtitle && <p className="mt-0.5 text-[13px] leading-5 text-[var(--text-muted)]">{subtitle}</p>}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between px-1">
      <h2 className="text-[15px] font-bold">{children}</h2>
      {action}
    </div>
  );
}

type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

export function Button({ children, onClick, tone = 'primary', disabled, busy, className, type = 'button', icon, size = 'md' }: {
  children: ReactNode;
  onClick?: () => void;
  tone?: ButtonTone;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
  type?: 'button' | 'submit';
  icon?: ReactNode;
  size?: 'md' | 'lg' | 'sm';
}) {
  const tones: Record<ButtonTone, string> = {
    primary: 'bg-[var(--accent)] text-white shadow-[0_10px_28px_rgba(140,124,255,0.28)]',
    secondary: 'bg-[var(--surface-raised)] text-[var(--text)]',
    ghost: 'text-[var(--accent)]',
    danger: 'bg-[var(--danger)]/10 text-[var(--danger)]',
    success: 'bg-[var(--success)] text-[#04110c]',
  };
  const sizes = { sm: 'min-h-9 px-3 text-[13px]', md: 'min-h-11 px-4 text-sm', lg: 'min-h-14 px-5 text-[15px]' };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      className={cn('tap inline-flex items-center justify-center gap-2 rounded-2xl font-semibold disabled:cursor-not-allowed disabled:opacity-50', sizes[size], tones[tone], className)}
    >
      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

const NOTICE = {
  info: { icon: Info, color: 'var(--accent)' },
  success: { icon: CheckCircle, color: 'var(--success)' },
  warning: { icon: AlertTriangle, color: 'var(--warning)' },
  danger: { icon: AlertCircle, color: 'var(--danger)' },
} as const;

export type NoticeTone = keyof typeof NOTICE;

export function Notice({ tone = 'info', children, onDismiss, className }: { tone?: NoticeTone; children: ReactNode; onDismiss?: () => void; className?: string }) {
  const n = NOTICE[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-[13px] leading-5 text-[var(--text)]', className)}
      style={{ background: `color-mix(in srgb, ${n.color} 12%, transparent)` }}>
      <n.icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: n.color }} />
      <span className="min-w-0 flex-1">{children}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-m-1 shrink-0 rounded-full p-1 text-[var(--text-muted)]"><X className="h-4 w-4" /></button>
      )}
    </div>
  );
}

export function Pill({ children, color = 'var(--text-muted)', className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold', className)}
      style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}>
      {children}
    </span>
  );
}

export function Field({ label, value, onChange, type = 'text', placeholder, disabled, autoComplete, onEnter, maxLength, inputMode }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  autoComplete?: string;
  onEnter?: () => void;
  maxLength?: number;
  inputMode?: 'text' | 'email' | 'url' | 'numeric';
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={autoComplete}
        maxLength={maxLength}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter(); }}
        className="min-h-12 w-full rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3.5 text-[15px] text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] disabled:opacity-60"
      />
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className="tap flex w-full items-center gap-3 rounded-2xl bg-[var(--bg-elevated)] px-4 py-3 text-left disabled:opacity-60">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[var(--text)]">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-5 text-[var(--text-muted)]">{hint}</span>}
      </span>
      <span className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors', checked ? 'bg-[var(--accent)]' : 'bg-[var(--surface-hover)]')}>
        <motion.span className="absolute top-1 h-5 w-5 rounded-full bg-white shadow" animate={{ left: checked ? 24 : 4 }} transition={{ type: 'spring', stiffness: 500, damping: 34 }} />
      </span>
    </button>
  );
}

/** Collapsible "Details" area for secondary information. */
export function Disclosure({ label, children, defaultOpen = false }: { label: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-3xl bg-[var(--surface)]">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="tap flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
        <span className="text-[15px] font-bold">{label}</span>
        <ChevronDown className={cn('h-5 w-5 text-[var(--text-muted)] transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-3 px-5 pb-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Segmented control used for in-page tabs. */
export function Segmented<T extends string>({ value, onChange, options, layoutId }: { value: T; onChange: (v: T) => void; options: Array<{ id: T; label: ReactNode }>; layoutId: string }) {
  return (
    <div className="flex rounded-2xl bg-[var(--surface)] p-1">
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)}
          className={cn('tap relative flex-1 rounded-xl py-2.5 text-sm font-semibold', value === o.id ? 'text-[var(--text)]' : 'text-[var(--text-muted)]')}>
          {value === o.id && <motion.span layoutId={layoutId} className="absolute inset-0 rounded-xl bg-[var(--accent-soft)] ring-1 ring-[var(--border-strong)]" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Horizontal progress through named steps (e.g. Lost → Searching → Found → Recovered). */
export function StepTrack({ steps, current, color = 'var(--accent)' }: { steps: string[]; current: number; color?: string }) {
  return (
    <div className="flex items-start">
      {steps.map((s, i) => {
        const done = i <= current;
        return (
          <div key={s} className="flex flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              <span className={cn('h-0.5 flex-1', i === 0 ? 'opacity-0' : '')} style={{ background: i <= current ? color : 'var(--surface-hover)' }} />
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold"
                style={{ background: done ? color : 'var(--surface-hover)', color: done ? '#0e1424' : 'var(--text-muted)' }}>
                {i < current ? '✓' : i + 1}
              </span>
              <span className={cn('h-0.5 flex-1', i === steps.length - 1 ? 'opacity-0' : '')} style={{ background: i < current ? color : 'var(--surface-hover)' }} />
            </div>
            <span className={cn('mt-1.5 text-[11px] font-semibold', i === current ? 'text-[var(--text)]' : 'text-[var(--text-muted)]')}>{s}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-3xl bg-[var(--surface)] px-6 py-9 text-center">
      {icon && <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">{icon}</span>}
      <p className="text-base font-bold">{title}</p>
      {children && <p className="mt-1 max-w-xs text-sm leading-6 text-[var(--text-muted)]">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Turn any thrown value into one readable sentence. */
export function errorText(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' && message ? message : fallback;
}
