import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useIntel } from '../intel/store';
import { sd, type TrustLevel } from '../intel/engine';
import { LEVEL, score } from '../ui/trust';
import { TrustRing } from '../ui/TrustDial';
import { DeviceDetailModal } from '../components/DeviceDetailModal';
import { useBluetoothDevices } from '../context/DeviceContext';
import type { BluetoothDevice } from '../types';

const ORDER: TrustLevel[] = ['trusted', 'likely_safe', 'uncertain', 'untrusted', 'unverified'];

/** Insights from what this phone has actually observed. */
export function Analytics() {
  const engine = useIntel();
  const reduce = useReducedMotion();
  const { state } = useBluetoothDevices();
  const [selected, setSelected] = useState<BluetoothDevice | null>(null);
  const snap = engine.snapshot;
  const profiles = Object.values(snap.profiles);

  const levels = useMemo(() => {
    const counts = new Map<TrustLevel, number>(ORDER.map((l) => [l, 0]));
    for (const p of profiles) {
      const l = engine.trustOf(p.address).level;
      counts.set(l, (counts.get(l) ?? 0) + 1);
    }
    return ORDER.map((l) => ({ level: l, n: counts.get(l) ?? 0 }));
  }, [profiles, engine]);
  const maxLevel = Math.max(1, ...levels.map((l) => l.n));

  const regulars = [...profiles].sort((a, b) => b.scans - a.scans).slice(0, 6);
  const typical = snap.env.total;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const recentAlerts = snap.findings.filter((f) => f.detectedAt >= weekAgo).length;

  if (snap.env.scans === 0) {
    return (
      <div className="rounded-3xl bg-[var(--surface)] px-6 py-12 text-center">
        <p className="text-lg font-bold">No insights yet</p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Scan a few times and BlueGuardian will learn what's normal around you.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        {[
          [snap.env.scans, 'Scans'],
          [profiles.length, 'Devices learned'],
          [`${typical.mean.toFixed(0)} ± ${sd(typical).toFixed(0)}`, 'Usually around you'],
          [recentAlerts, 'Alerts this week'],
        ].map(([value, label], i) => (
          <motion.div key={String(label)} className="rounded-3xl bg-[var(--surface)] p-4"
            initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <p className="font-display text-2xl font-semibold">{value}</p>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">{label}</p>
          </motion.div>
        ))}
      </div>

      <section className="rounded-3xl bg-[var(--surface)] p-5">
        <h2 className="text-[15px] font-bold">Trust across every device you've met</h2>
        <div className="mt-4 space-y-3">
          {levels.map((l, i) => (
            <div key={l.level} className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-sm text-[var(--text-secondary)]">{l.level === 'unverified' ? 'New' : LEVEL[l.level].short}</span>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-[var(--surface-hover)]">
                <motion.div className="h-full rounded-full" style={{ background: LEVEL[l.level].color }}
                  initial={reduce ? false : { width: 0 }} animate={{ width: `${(l.n / maxLevel) * 100}%` }}
                  transition={{ duration: 0.8, delay: 0.1 + i * 0.06, ease: [0.22, 1, 0.36, 1] }} />
              </div>
              <span className="font-display w-8 text-right text-sm font-semibold">{l.n}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2.5 px-1 text-[15px] font-bold">Your regulars</h2>
        <div className="divide-y divide-[var(--border)] overflow-hidden rounded-3xl bg-[var(--surface)]">
          {regulars.map((p) => {
            const o = engine.trustOf(p.address);
            const device = state.devices.find((d) => d.address?.toUpperCase() === p.address);
            return (
              <button key={p.address} type="button" disabled={!device} onClick={() => device && setSelected(device)}
                className="tap flex w-full items-center gap-3 px-4 py-3 text-left">
                <TrustRing opinion={o} size={40}>
                  <span className="font-display text-xs font-semibold" style={{ color: LEVEL[o.level].color }}>{o.level === 'unverified' ? '—' : score(o)}</span>
                </TrustRing>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{p.name || p.address}</span>
                  <span className="block text-xs text-[var(--text-muted)]">Seen {p.scans} times over {p.days.length} day{p.days.length === 1 ? '' : 's'}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <DeviceDetailModal device={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
