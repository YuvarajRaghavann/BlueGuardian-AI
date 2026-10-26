import type { Threat, ThreatCategory } from '../types';
import { formatDistanceToNow } from 'date-fns';
import { AlertCircle, AlertTriangle, ChevronRight, MapPin, Radio, UserX, WifiOff } from 'lucide-react';

const categoryIcons: Partial<Record<ThreatCategory, typeof AlertCircle>> = {
  TRACKER_FOLLOWING: MapPin,
  POPUP_SPAM: Radio,
  LOOKALIKE_DEVICE: UserX,
  SPOOFING_SUSPECTED: WifiOff,
  SUSPICIOUS_NAME: AlertTriangle,
};

const tone = {
  low: { dot: 'bg-[var(--accent)]', icon: 'text-[var(--accent)]', bg: 'bg-[var(--accent-soft)]', label: 'Notice' },
  medium: { dot: 'bg-[var(--warning)]', icon: 'text-[var(--warning)]', bg: 'bg-[var(--warning)]/10', label: 'Warning' },
  high: { dot: 'bg-[var(--danger)]', icon: 'text-[var(--danger)]', bg: 'bg-[var(--danger)]/10', label: 'Alert' },
  critical: { dot: 'bg-[var(--danger)]', icon: 'text-[var(--danger)]', bg: 'bg-[var(--danger)]/15', label: 'Alert' },
} as const;

/** One alert: what happened, on which device, when. Details live in the detail view. */
export function ThreatCard({ threat, onClick }: { threat: Threat; onClick?: () => void }) {
  const Icon = categoryIcons[threat.category] ?? AlertCircle;
  const t = tone[threat.severity];
  const closed = threat.status === 'RESOLVED' || threat.status === 'DISMISSED';
  return (
    <button type="button" onClick={onClick} className="group block w-full text-left">
      <div className={`flex items-center gap-3 p-4 transition-colors hover:bg-[var(--surface-raised)] ${closed ? 'opacity-60' : ''}`}>
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${t.bg}`}>
          <Icon className={`h-[18px] w-[18px] ${t.icon}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--text)]">{threat.title}</p>
          <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">{threat.description}</p>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
            <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
            {closed ? threat.status.toLowerCase() : t.label} · {threat.deviceName} · {formatDistanceToNow(threat.detectedAt, { addSuffix: true })}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
      </div>
    </button>
  );
}
