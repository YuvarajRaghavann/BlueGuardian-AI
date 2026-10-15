import { useState, useMemo } from 'react';
import {
  AlertTriangle,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  ShieldAlert,
} from 'lucide-react';
import { ThreatCard } from '../components/ThreatCard';
import { ThreatDetailModal } from '../components/ThreatDetailModal';
import { StatCard } from '../components/StatCard';
import { EmptyState } from '../components/EmptyState';
import { useThreats } from '../context/ThreatContext';
import type { ThreatSeverity, ThreatStatus } from '../types';

export function Threats() {
  const { state } = useThreats();

  const [selectedThreat, setSelectedThreat] =
    useState<import('../types').Threat | null>(null);

  const [localSearch, setLocalSearch] = useState(state.search);
  const [localSeverity, setLocalSeverity] =
    useState<ThreatSeverity | 'all'>(state.filterSeverity);
  const [localStatus, setLocalStatus] =
    useState<ThreatStatus | 'all'>(state.filterStatus);
  const [localSort, setLocalSort] = useState(state.sort);

  const filteredThreats = useMemo(() => {
    let arr = [...state.threats];

    if (localSearch) {
      const q = localSearch.toLowerCase();

      arr = arr.filter(
        t =>
          t.title.toLowerCase().includes(q) ||
          t.deviceName.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q)
      );
    }

    if (localSeverity !== 'all') {
      arr = arr.filter(t => t.severity === localSeverity);
    }

    if (localStatus !== 'all') {
      arr = arr.filter(t => t.status === localStatus);
    }

    arr.sort((a, b) => {
      switch (localSort) {
        case 'severity': {
          const order = {
            critical: 4,
            high: 3,
            medium: 2,
            low: 1,
          };

          return order[b.severity] - order[a.severity];
        }

        case 'score':
          return b.score - a.score;

        case 'newest':
          return b.detectedAt.getTime() - a.detectedAt.getTime();

        case 'oldest':
          return a.detectedAt.getTime() - b.detectedAt.getTime();

        default:
          return 0;
      }
    });

    return arr;
  }, [
    state.threats,
    localSearch,
    localSeverity,
    localStatus,
    localSort,
  ]);

  const active = state.threats.filter(
    t => t.status === 'ACTIVE'
  ).length;

  const critical = state.threats.filter(
    t => t.severity === 'critical'
  ).length;

  const high = state.threats.filter(
    t => t.severity === 'high'
  ).length;

  const medium = state.threats.filter(
    t => t.severity === 'medium'
  ).length;

  const low = state.threats.filter(
    t => t.severity === 'low'
  ).length;

  const resolved = state.threats.filter(
    t => t.status === 'RESOLVED'
  ).length;

  return (
    <div className="relative space-y-6 sm:space-y-7">
      {/* Header */}
      <header className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--surface)] via-[var(--surface)] to-[var(--surface-raised)] p-5 shadow-[0_12px_32px_rgba(0,0,0,0.14)] sm:p-6">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-[var(--danger)]">
          <ShieldAlert className="h-3.5 w-3.5" />
          Security intelligence
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)] sm:text-3xl">
          Threat Detection
        </h1>

        <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
          Review detected Bluetooth security events, risk levels and
          development-model assessments.
        </p>
      </header>

      {/* Threat overview */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          title="Active"
          value={active}
          icon={AlertTriangle}
        />

        <StatCard
          title="Critical"
          value={critical}
          icon={AlertTriangle}
        />

        <StatCard
          title="High"
          value={high}
          icon={AlertTriangle}
        />

        <StatCard
          title="Medium"
          value={medium}
          icon={AlertTriangle}
        />

        <StatCard
          title="Low"
          value={low}
          icon={AlertTriangle}
        />

        <StatCard
          title="Resolved"
          value={resolved}
          icon={ShieldCheck}
        />
      </section>

      {/* Controls */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[0_8px_28px_rgba(0,0,0,0.12)] transition-all duration-200 hover:border-[var(--accent)]/25 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />

            <input
              type="text"
              placeholder="Search threats, devices or categories…"
              value={localSearch}
              onChange={e => setLocalSearch(e.target.value)}
              className="h-11 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] pl-10 pr-4 text-sm text-[var(--text)] outline-none transition-all duration-200 placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]/60 focus:ring-2 focus:ring-[var(--accent)]/15"
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
            </div>

            <select
              value={localSeverity}
              onChange={e =>
                setLocalSeverity(e.target.value as ThreatSeverity | 'all')
              }
              className="h-11 min-w-40 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-3 text-sm text-[var(--text)] outline-none transition-all duration-200 focus:border-[var(--accent)]/60 focus:ring-2 focus:ring-[var(--accent)]/15"
            >
              <option value="all">All severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            <select
              value={localStatus}
              onChange={e =>
                setLocalStatus(e.target.value as ThreatStatus | 'all')
              }
              className="h-11 min-w-40 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-3 text-sm text-[var(--text)] outline-none transition-all duration-200 focus:border-[var(--accent)]/60 focus:ring-2 focus:ring-[var(--accent)]/15"
            >
              <option value="all">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="INVESTIGATING">Investigating</option>
              <option value="RESOLVED">Resolved</option>
              <option value="DISMISSED">Dismissed</option>
            </select>

            <select
              value={localSort}
              onChange={e => setLocalSort(e.target.value as any)}
              className="h-11 min-w-36 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-3 text-sm text-[var(--text)] outline-none transition-all duration-200 focus:border-[var(--accent)]/60 focus:ring-2 focus:ring-[var(--accent)]/15"
            >
              <option value="severity">Severity ↓</option>
              <option value="score">Score ↓</option>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
            </select>
          </div>
        </div>
      </section>

      {/* Results heading */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-[var(--text)]">
            {filteredThreats.length} threat
            {filteredThreats.length === 1 ? '' : 's'}
          </p>

          <p className="text-xs text-[var(--text-muted)]">
            {active} currently active
          </p>
        </div>

        <span className="rounded-full border border-[var(--danger)]/25 bg-[var(--danger)]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--danger)]">
          Development analysis
        </span>
      </div>

      {/* Threat list */}
      {filteredThreats.length > 0 ? (
        <div className="space-y-3">
          {filteredThreats.map(threat => (
            <ThreatCard
              key={threat.id}
              threat={threat}
              onClick={() => setSelectedThreat(threat)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={AlertTriangle}
          title={
            state.threats.length === 0
              ? 'No analysis results yet'
              : 'No threats match the current filters'
          }
          description={
            state.threats.length === 0
              ? 'Run a device scan to generate security analysis.'
              : 'Adjust your search or filters to see other security events.'
          }
        />
      )}

      <ThreatDetailModal
        threat={selectedThreat}
        onClose={() => setSelectedThreat(null)}
      />
    </div>
  );
}
