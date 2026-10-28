import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, Info, LoaderCircle, Search, ShieldAlert, ShieldCheck, AlertTriangle, X } from 'lucide-react';
import type { BluetoothDevice } from '../types';
import { VERDICT_STYLE, type CheckStatus, type GuardianResult } from '../intel/guardian';
import { inspectionFor, runDeepInspection } from '../intel/guardianStore';
import { isNativeAndroidApp } from '../services/nativeBluetoothService';
import { formatDistanceToNow } from 'date-fns';
import { METHOD_LABEL, type BtguardMethod } from '../intel/btguardScan';

const STATUS: Record<CheckStatus, { icon: typeof Check; color: string }> = {
  pass: { icon: Check, color: 'var(--success)' },
  warn: { icon: AlertTriangle, color: 'var(--warning)' },
  fail: { icon: X, color: 'var(--danger)' },
  info: { icon: Info, color: 'var(--text-muted)' },
};

/** The Guardian's pre-connection verdict for one device, with every check it ran. */
export function GuardianPanel({ device, result }: { device: BluetoothDevice; result: GuardianResult }) {
  const reduce = useReducedMotion();
  const style = VERDICT_STYLE[result.verdict];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inspected = inspectionFor(device.address);
  const canDeepCheck = isNativeAndroidApp() && Boolean(device.address) && device.connectable !== false
    && (device.discoveryTransports?.includes('BLE') || device.rawAdvert || device.manufacturerData);
  const Shield = result.verdict === 'unsafe' || result.verdict === 'caution' ? ShieldAlert : ShieldCheck;

  const deepCheck = async () => {
    if (!device.address) return;
    setBusy(true);
    setError(null);
    try {
      await runDeepInspection(device.address);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deep check failed.');
    } finally {
      setBusy(false);
    }
  };

  const ordered = [...result.checks].sort((a, b) => ['fail', 'warn', 'pass', 'info'].indexOf(a.status) - ['fail', 'warn', 'pass', 'info'].indexOf(b.status));

  return (
    <section className="space-y-3">
      <motion.div
        className="flex items-center gap-4 rounded-3xl p-4"
        style={{ background: `color-mix(in srgb, ${style.color} 13%, var(--surface))` }}
        initial={reduce ? false : { opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      >
        <motion.span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl" style={{ background: `color-mix(in srgb, ${style.color} 22%, transparent)`, color: style.color }}
          initial={reduce ? false : { rotate: -12, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 0.1 }}>
          <Shield className="h-7 w-7" />
        </motion.span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Guardian check</p>
          <p className="font-display text-2xl font-semibold leading-tight" style={{ color: style.color }}>{style.label}</p>
          <p className="truncate text-sm text-[var(--text-secondary)]">{result.summary}</p>
        </div>
      </motion.div>

      <BtguardBreakdown result={result} />

      <ul className="space-y-1.5">
        {ordered.map((c, i) => {
          const s = STATUS[c.status];
          return (
            <motion.li key={c.id} className="flex gap-3 rounded-2xl bg-[var(--surface)] px-3 py-2.5"
              initial={reduce ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}>
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${s.color} 18%, transparent)`, color: s.color }}>
                <s.icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[var(--text)]">{c.title}</span>
                <span className="block text-xs leading-5 text-[var(--text-muted)]">{c.detail}</span>
              </span>
            </motion.li>
          );
        })}
      </ul>

      {canDeepCheck && (
        <div>
          <button type="button" onClick={() => void deepCheck()} disabled={busy}
            className="tap flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--surface)] py-3 text-sm font-semibold text-[var(--accent)] disabled:opacity-60">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {busy ? 'Inspecting without pairing…' : inspected ? 'Run deep check again' : 'Deep check before connecting'}
          </button>
          <p className="mt-1.5 text-center text-[11px] text-[var(--text-muted)]">
            {inspected ? `Last deep check ${formatDistanceToNow(inspected.at, { addSuffix: true })}. ` : ''}Reads its Device Information and tests its data protection. Never pairs.
          </p>
          {error && <p role="alert" className="mt-1 text-center text-xs text-[var(--danger)]">{error}</p>}
        </div>
      )}
    </section>
  );
}

const METHODS: BtguardMethod[] = ['protocol', 'physical', 'behaviour'];

/** BTGuard: the three independent methods behind the verdict, fused into one trust score. */
function BtguardBreakdown({ result }: { result: GuardianResult }) {
  const reduce = useReducedMotion();
  const { btguard } = result;
  const tone = (risk: number) => (risk >= 0.85 ? 'var(--danger)' : risk >= 0.3 ? 'var(--warning)' : 'var(--success)');
  return (
    <div className="rounded-3xl bg-[var(--surface)] p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">BTGuard score</p>
        <p className="font-display text-xl font-semibold" style={{ color: tone(1 - btguard.trust / 100) }}>
          {btguard.trust}<span className="text-xs text-[var(--text-muted)]"> / 100</span>
        </p>
      </div>
      <div className="mt-3 space-y-2.5">
        {METHODS.map((m, i) => {
          const score = btguard.methods[m];
          const safety = Math.round(100 * (1 - score.risk));
          return (
            <div key={m}>
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[var(--text-secondary)]">{METHOD_LABEL[m]}</span>
                <span className="text-[var(--text-muted)]">{score.reasons[0] ?? 'Nothing unusual'}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                <motion.div className="h-full rounded-full" style={{ background: tone(score.risk) }}
                  initial={reduce ? false : { width: 0 }} animate={{ width: `${Math.max(4, safety)}%` }} transition={{ delay: 0.08 * i, duration: 0.5 }} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] leading-4 text-[var(--text-muted)]">
        {btguard.hard
          ? 'Decided by hard evidence.'
          : btguard.corroborated
            ? 'Two independent methods agree.'
            : 'Unsafe needs hard evidence or two methods agreeing; one weak signal alone is never enough.'}
      </p>
    </div>
  );
}
