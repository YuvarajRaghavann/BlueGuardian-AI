import { useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { ThreatCard } from '../components/ThreatCard';
import { ThreatDetailModal } from '../components/ThreatDetailModal';
import { useThreats } from '../context/ThreatContext';
import type { Threat } from '../types';
import { cn } from '../utils/cn';

const RANK = { critical: 3, high: 2, medium: 1, low: 0 } as const;

const CHECKS = [
  ['Trackers following you', 'AirTag, SmartTag, Tile and Find My tags that move with you'],
  ['Pairing-popup spam', 'Bursts of fake pairing popups, compared with your normal'],
  ['Look-alike devices', 'Unpaired devices copying your paired device\'s name'],
] as const;

export function Threats() {
  const { state } = useThreats();
  const [selected, setSelected] = useState<Threat | null>(null);
  const [view, setView] = useState<'open' | 'closed'>('open');

  const list = useMemo(() => state.threats
    .filter((t) => (view === 'open' ? t.status === 'ACTIVE' || t.status === 'INVESTIGATING' : t.status === 'RESOLVED' || t.status === 'DISMISSED'))
    .sort((a, b) => RANK[b.severity] - RANK[a.severity] || b.detectedAt.getTime() - a.detectedAt.getTime()), [state.threats, view]);
  const openCount = state.threats.filter((t) => t.status === 'ACTIVE' || t.status === 'INVESTIGATING').length;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <p className="text-sm text-[var(--text-secondary)]">Raised only when a scan finds real evidence of a known attack pattern.</p>
      </header>

      <div className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1">
        {(['open', 'closed'] as const).map((v) => (
          <button key={v} type="button" onClick={() => setView(v)}
            className={cn('rounded-lg px-4 py-1.5 text-sm font-medium', view === v ? 'bg-[var(--accent-soft)] text-[var(--text)]' : 'text-[var(--text-muted)]')}>
            {v === 'open' ? `Open${openCount ? ` (${openCount})` : ''}` : 'Closed'}
          </button>
        ))}
      </div>

      {list.length > 0 ? (
        <div className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          {list.map((t) => <ThreatCard key={t.id} threat={t} onClick={() => setSelected(t)} />)}
        </div>
      ) : (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-[var(--success)]" />
          <p className="mt-2 text-base font-semibold text-[var(--text)]">{view === 'open' ? 'No alerts' : 'Nothing closed yet'}</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Unknown devices are normal and are not treated as threats.</p>
        </div>
      )}

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">What every scan checks</p>
        <ul className="mt-3 space-y-2.5">
          {CHECKS.map(([title, sub]) => (
            <li key={title} className="flex gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
              <span>
                <span className="block text-sm font-medium text-[var(--text)]">{title}</span>
                <span className="block text-xs text-[var(--text-muted)]">{sub}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <ThreatDetailModal threat={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
