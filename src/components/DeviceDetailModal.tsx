import { useState } from 'react';
import {
  Ban, Bluetooth, CheckCircle, Cpu, Headphones, HelpCircle, Laptop, MapPin, RotateCcw, ShieldAlert, ShieldCheck, Smartphone, Trash2, Watch, X,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { BluetoothDevice, DeviceType, SecurityActionType } from '../types';
import { useSecurity } from '../context/SecurityContext';
import { useBluetoothDevices } from '../context/DeviceContext';
import { NativeConnectPanel } from './NativeConnectPanel';
import { isNativeAndroidApp } from '../services/nativeBluetoothService';
import { useIntel } from '../intel/store';
import { standingOf } from '../intel/engine';
import { proximityBand } from '../services/myDevices';
import { cn } from '../utils/cn';

interface DeviceDetailModalProps {
  device: BluetoothDevice | null;
  onClose: () => void;
}

const typeIcons: Record<DeviceType, typeof Bluetooth> = {
  smartphone: Smartphone,
  earbuds: Headphones,
  headphones: Headphones,
  smartwatch: Watch,
  laptop: Laptop,
  iot: Cpu,
  unknown: HelpCircle,
};

const STANDING = {
  yours: { label: 'Yours', className: 'bg-[var(--success)]/15 text-[var(--success)]' },
  familiar: { label: 'Familiar', className: 'bg-[var(--accent-soft)] text-[var(--accent)]' },
  new: { label: 'New', className: 'bg-[var(--surface-hover)] text-[var(--text-secondary)]' },
} as const;

const ACTION_LABEL: Record<SecurityActionType, string> = {
  TRUST: 'Trust',
  MARK_UNKNOWN: 'Untrust',
  BLOCK: 'Block',
  UNBLOCK: 'Unblock',
  FORGET: 'Forget',
  INVESTIGATE: 'Investigate',
  RESOLVE_THREAT: 'Resolve',
  DISMISS_THREAT: 'Dismiss',
} as Record<SecurityActionType, string>;

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 text-sm font-semibold text-[var(--text)]">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{sub}</p>}
    </div>
  );
}

/** Short, factual device view: who it is, what we know from real history, and any evidence-based alert. */
export function DeviceDetailModal({ device, onClose }: DeviceDetailModalProps) {
  const { executeAction, getAllowedActions } = useSecurity();
  const { state: deviceState } = useBluetoothDevices();
  const engine = useIntel();
  const [confirm, setConfirm] = useState<SecurityActionType | null>(null);
  const current = device ? deviceState.devices.find((d) => d.id === device.id) ?? device : null;
  if (!current) return null;

  const profile = current.address ? engine.profile(current.address) : undefined;
  const { standing, detail } = standingOf(profile, Boolean(current.paired), current.trusted);
  const findings = engine.findingsFor(current.address);
  const Icon = typeIcons[current.type] ?? HelpCircle;
  const band = proximityBand(typeof current.rssi === 'number' ? current.rssi : null);
  const connection = current.connectionStatus === 'connected' ? 'Connected' : current.paired ? 'Paired' : 'Nearby';
  const actions = getAllowedActions(current).filter((a) => ['TRUST', 'MARK_UNKNOWN', 'BLOCK', 'UNBLOCK', 'FORGET'].includes(a));
  const isTracker = Boolean(current.tracker || profile?.tracker);
  const owned = Boolean(current.address && engine.snapshot.mine.includes(current.address.toUpperCase()));

  const run = (type: SecurityActionType) => {
    if (type === 'BLOCK' || type === 'FORGET') {
      setConfirm(type);
      return;
    }
    executeAction(type, current, 'Changed by the owner from the device view.');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={current.name}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-[var(--border)] bg-[var(--bg-elevated)] sm:rounded-3xl">
        <div className="flex items-center gap-3 border-b border-[var(--border)] p-4">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-[var(--text)]">{current.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', STANDING[standing].className)}>{STANDING[standing].label}</span>
              {current.familyLabel && <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">{current.familyLabel}</span>}
              {current.blocked && <span className="rounded-full bg-[var(--danger)]/15 px-2 py-0.5 text-[11px] font-semibold text-[var(--danger)]">Blocked</span>}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--surface)]"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 p-4">
          <div className="grid grid-cols-3 gap-2">
            <Fact label="Status" value={connection} />
            <Fact label="Signal" value={typeof current.rssi === 'number' ? `${current.rssi} dBm` : '—'} sub={typeof current.rssi === 'number' ? band.label.split(' (')[0] : undefined} />
            <Fact label="History" value={standing === 'yours' ? 'Yours' : profile ? `${profile.scans} scan${profile.scans === 1 ? '' : 's'}` : 'New'} sub={detail} />
          </div>

          {findings.length > 0 ? (
            findings.map((f) => (
              <div key={f.id} className={cn('rounded-xl border p-3', f.severity === 'high' ? 'border-[var(--danger)]/40 bg-[var(--danger)]/10' : 'border-[var(--warning)]/40 bg-[var(--warning)]/10')}>
                <p className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
                  <ShieldAlert className={cn('h-4 w-4', f.severity === 'high' ? 'text-[var(--danger)]' : 'text-[var(--warning)]')} /> {f.title}
                </p>
                <ul className="mt-2 space-y-0.5 text-xs text-[var(--text-secondary)]">
                  {f.evidence.map((e) => <li key={e}>• {e}</li>)}
                </ul>
                <p className="mt-2 text-xs font-medium text-[var(--text)]">{f.action}</p>
              </div>
            ))
          ) : (
            <div className="flex items-start gap-2.5 rounded-xl border border-[var(--success)]/30 bg-[var(--success)]/10 p-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success)]" />
              <div>
                <p className="text-sm font-semibold text-[var(--text)]">No issues found</p>
                <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">Checked for tracking, impersonation and popup spam.</p>
              </div>
            </div>
          )}

          {isTracker && !current.paired && current.address && (
            <button type="button" disabled={owned}
              onClick={() => current.address && engine.markMine(current.address)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50">
              <MapPin className="h-4 w-4" /> {owned ? 'Marked as your tracker' : 'This tracker is mine'}
            </button>
          )}

          {isNativeAndroidApp() && current.address && !current.blocked && (
            <NativeConnectPanel address={current.address} paired={Boolean(current.paired)} connected={current.connectionStatus === 'connected'} />
          )}

          {actions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {actions.map((a) => (
                <button key={a} type="button" onClick={() => run(a)}
                  className={cn('inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-medium',
                    a === 'TRUST' ? 'border-[var(--success)]/30 text-[var(--success)]'
                      : a === 'BLOCK' ? 'border-[var(--danger)]/30 text-[var(--danger)]'
                        : 'border-[var(--border)] text-[var(--text-secondary)]')}>
                  {a === 'TRUST' && <CheckCircle className="h-4 w-4" />}
                  {a === 'BLOCK' && <Ban className="h-4 w-4" />}
                  {a === 'UNBLOCK' && <RotateCcw className="h-4 w-4" />}
                  {a === 'FORGET' && <Trash2 className="h-4 w-4" />}
                  {ACTION_LABEL[a] ?? a}
                </button>
              ))}
            </div>
          )}

          <p className="text-[11px] text-[var(--text-muted)]">
            {current.address ?? 'Address hidden by browser'} · last seen {formatDistanceToNow(new Date(current.lastSeen), { addSuffix: true })}
          </p>
        </div>
      </div>

      {confirm && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5">
            <p className="text-base font-semibold text-[var(--text)]">{confirm === 'BLOCK' ? `Block ${current.name}?` : `Forget ${current.name}?`}</p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {confirm === 'BLOCK' ? 'BlueGuardian will warn you and refuse to connect to it.' : 'Its history in BlueGuardian will be removed.'}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirm(null)} className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-secondary)]">Cancel</button>
              <button type="button"
                onClick={() => {
                  executeAction(confirm, current, 'Confirmed by the owner.');
                  setConfirm(null);
                  if (confirm === 'FORGET') onClose();
                }}
                className="rounded-xl bg-[var(--danger)] px-4 py-2 text-sm font-semibold text-white">
                {confirm === 'BLOCK' ? 'Block' : 'Forget'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
