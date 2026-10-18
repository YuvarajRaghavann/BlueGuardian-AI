import { motion, useReducedMotion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import type { Evidence, TrustState } from '../intel/engine';
import { EVIDENCE_LABEL } from './trust';

/** Trust over time. Dots mark each change; the shaded band is how unsure the score was. */
export function TrustHistory({ trust }: { trust?: TrustState }) {
  const reduce = useReducedMotion();
  const points = [...(trust?.history ?? [])].sort((a, b) => a.at - b.at);
  if (points.length < 2) {
    return <p className="rounded-2xl bg-[var(--surface)] px-4 py-5 text-center text-sm text-[var(--text-muted)]">History appears after a few scans.</p>;
  }
  const w = 320;
  const h = 96;
  const t0 = points[0].at;
  const t1 = points[points.length - 1].at;
  const x = (at: number) => (t1 === t0 ? w : Math.min(w, Math.max(0, ((at - t0) / (t1 - t0)) * w)));
  const y = (p: number) => h - p * h;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(p.p).toFixed(1)}`).join(' ');
  const upper = points.map((p) => `${x(p.at).toFixed(1)},${y(Math.min(1, p.p + (1 - p.c) / 2)).toFixed(1)}`);
  const lower = [...points].reverse().map((p) => `${x(p.at).toFixed(1)},${y(Math.max(0, p.p - (1 - p.c) / 2)).toFixed(1)}`);
  const last = points[points.length - 1];

  return (
    <div className="rounded-2xl bg-[var(--surface)] p-4">
      <svg viewBox={`-4 -4 ${w + 8} ${h + 8}`} className="h-28 w-full overflow-visible" role="img" aria-label="Trust score over time">
        <line x1={0} x2={w} y1={y(0.8)} y2={y(0.8)} stroke="var(--success)" strokeOpacity={0.25} strokeDasharray="3 5" />
        <line x1={0} x2={w} y1={y(0.4)} y2={y(0.4)} stroke="var(--danger)" strokeOpacity={0.25} strokeDasharray="3 5" />
        <polygon points={[...upper, ...lower].join(' ')} fill="var(--accent)" fillOpacity={0.1} />
        <motion.path
          d={line} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round"
          initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        />
        <circle cx={x(last.at)} cy={y(last.p)} r={4.5} fill="var(--accent)" stroke="var(--bg-elevated)" strokeWidth={2} />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-[var(--text-muted)]">
        <span>{formatDistanceToNow(t0, { addSuffix: true })}</span>
        <span>now</span>
      </div>
    </div>
  );
}

/** Every piece of evidence behind the score, newest first. */
export function EvidenceLedger({ ledger, limit = 8 }: { ledger: Evidence[]; limit?: number }) {
  // Repeated identical evidence collapses into one row with a count and the summed effect.
  const grouped: Array<Evidence & { count: number }> = [];
  for (const e of [...ledger].reverse()) {
    const prev = grouped[grouped.length - 1];
    if (prev && prev.kind === e.kind && prev.note === e.note) {
      prev.count += 1;
      prev.delta += e.delta;
    } else {
      grouped.push({ ...e, count: 1 });
    }
  }
  const rows = grouped.slice(0, limit);
  if (rows.length === 0) return <p className="text-sm text-[var(--text-muted)]">No evidence yet. Scan to start building it.</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((e, i) => {
        const good = e.delta >= 0;
        return (
          <li key={`${e.at}-${i}`} className="flex items-center gap-3 rounded-xl bg-[var(--surface)] px-3 py-2.5">
            <span className={`grid h-7 min-w-[44px] place-items-center rounded-lg px-1.5 text-xs font-bold ${good ? 'bg-[var(--success)]/12 text-[var(--success)]' : 'bg-[var(--danger)]/12 text-[var(--danger)]'}`}>
              {good ? '+' : '−'}{Math.abs(e.delta).toFixed(Math.abs(e.delta) < 1 ? 1 : 0)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-[var(--text)]">{e.note}{e.count > 1 ? ` (${e.count}×)` : ''}</span>
              <span className="block text-[11px] text-[var(--text-muted)]">{EVIDENCE_LABEL[e.kind]}, {formatDistanceToNow(e.at, { addSuffix: true })}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
