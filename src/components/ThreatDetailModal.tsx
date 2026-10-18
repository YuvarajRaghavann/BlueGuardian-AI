import { CheckCircle, ShieldAlert, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { Threat } from '../types';
import { useThreats } from '../context/ThreatContext';
import { intel } from '../intel/store';
import { cn } from '../utils/cn';

interface ThreatDetailModalProps {
  threat: Threat | null;
  onClose: () => void;
}

/** Alert detail: the evidence, and the one thing to do about it. */
export function ThreatDetailModal({ threat, onClose }: ThreatDetailModalProps) {
  const { updateThreatStatus } = useThreats();
  if (!threat) return null;
  const high = threat.severity === 'high' || threat.severity === 'critical';
  const findingId = threat.id.startsWith('intel:') ? threat.id.slice(6) : null;
  const open = threat.status === 'ACTIVE' || threat.status === 'INVESTIGATING';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={threat.title}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 sm:rounded-3xl">
        <div className="flex items-start gap-3">
          <div className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl', high ? 'bg-[var(--danger)]/15 text-[var(--danger)]' : 'bg-[var(--warning)]/15 text-[var(--warning)]')}>
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-[var(--text)]">{threat.title}</h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {threat.deviceName} · {formatDistanceToNow(threat.detectedAt, { addSuffix: true })}
              {threat.finalClassification ? ` · ${threat.finalClassification}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-[var(--text-muted)]"><X className="h-5 w-5" /></button>
        </div>

        <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">{threat.description}</p>

        {threat.reasons.length > 0 && (
          <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Evidence</p>
            <ul className="mt-1.5 space-y-1 text-sm text-[var(--text)]">
              {threat.reasons.map((r) => <li key={r.message}>• {r.message}</li>)}
            </ul>
          </div>
        )}

        {threat.recommendedAction && (
          <div className={cn('mt-3 rounded-xl p-3 text-sm font-medium', high ? 'bg-[var(--danger)]/10 text-[var(--text)]' : 'bg-[var(--warning)]/10 text-[var(--text)]')}>
            {threat.recommendedAction}
          </div>
        )}

        {open && (
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => { updateThreatStatus(threat.id, 'RESOLVED'); onClose(); }}
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--success)] text-sm font-semibold text-[#04110c]">
              <CheckCircle className="h-4 w-4" /> Resolved
            </button>
            <button type="button"
              onClick={() => { if (findingId) intel.dismiss(findingId); updateThreatStatus(threat.id, 'DISMISSED'); onClose(); }}
              className="min-h-11 rounded-xl border border-[var(--border)] text-sm font-semibold text-[var(--text-secondary)]">
              Not a problem
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
