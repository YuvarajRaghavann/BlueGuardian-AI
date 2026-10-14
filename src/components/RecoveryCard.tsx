import type { RecoveryInfo } from '../types';
import { StatusBadge } from './StatusBadge';
import { formatDistanceToNow } from 'date-fns';
import {
  MapPin,
  Wifi,
  Users,
  Search,
  CheckCircle,
  AlertCircle,
  Radio,
} from 'lucide-react';

const statusIcons = {
  searching: Search,
  found: CheckCircle,
  lost: AlertCircle,
  recovered: CheckCircle,
} as const;

const statusLabels = {
  searching: 'Searching',
  found: 'Found',
  lost: 'Lost',
  recovered: 'Recovered',
} as const;

export function RecoveryCard({
  recovery,
}: {
  recovery: RecoveryInfo;
}) {
  const Icon = statusIcons[recovery.status];
  const label = statusLabels[recovery.status];

  const statusVariant =
    recovery.status === 'searching'
      ? 'warning'
      : recovery.status === 'found' || recovery.status === 'recovered'
        ? 'success'
        : 'danger';

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--accent)]">
              <Icon className="h-[18px] w-[18px]" />
            </div>

            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                Device recovery
              </p>

              <h3 className="mt-1 truncate text-sm font-semibold text-white">
                {recovery.deviceName}
              </h3>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {recovery.simulated && <StatusBadge label="SIMULATED" variant="warning" />}
            <StatusBadge label={label} variant={statusVariant} />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
          <Radio className="h-3 w-3 text-[var(--accent)]" />
          Last detected{' '}
          {formatDistanceToNow(recovery.lastDetected, {
            addSuffix: true,
          })}
        </div>
      </div>

      {recovery.simulated && (
        <p className="border-b border-[var(--border)] px-5 py-3 text-xs leading-5 text-[var(--text-muted)]">
          Demo data only. Community sightings and location updates are not connected.
        </p>
      )}

      {recovery.lastKnownLocation && (
        <div className="grid gap-px bg-[var(--border)] sm:grid-cols-2">
          <div className="bg-[var(--surface)] p-4">
            <div className="flex gap-2.5">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />

              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  Last known location
                </p>

                <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                  {recovery.lastKnownLocation.address ||
                    `${recovery.lastKnownLocation.lat.toFixed(4)}, ${recovery.lastKnownLocation.lng.toFixed(4)}`}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-[var(--surface)] p-4">
            <div className="flex gap-2.5">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />

              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  Community reports
                </p>

                <p className="mt-1 text-xs font-medium text-white">
                  {recovery.communityReports} report
                  {recovery.communityReports === 1 ? '' : 's'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2 p-4">
        <button
          type="button"
          disabled
          title="Recovery scanning is not connected in this demo."
          className="flex min-h-10 flex-1 cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-xs font-semibold text-[var(--text-muted)] opacity-70"
        >
          <Wifi className="h-3.5 w-3.5" />
          Start BLE scan
        </button>

        <button
          type="button"
          disabled
          title="A recovery map is not connected in this demo."
          className="flex min-h-10 cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 text-xs font-medium text-[var(--text-muted)] opacity-70"
        >
          <MapPin className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">View map</span>
          <span className="sm:hidden">Map</span>
        </button>
      </div>
    </div>
  );
}
