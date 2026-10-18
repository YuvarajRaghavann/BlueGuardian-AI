import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Ban, CheckCircle, ChevronRight, MapPin, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { BluetoothDevice, SecurityActionType } from '../types';
import { useSecurity } from '../context/SecurityContext';
import { useBluetoothDevices } from '../context/DeviceContext';
import { NativeConnectPanel } from './NativeConnectPanel';
import { isNativeAndroidApp } from '../services/nativeBluetoothService';
import { useIntel } from '../intel/store';
import { TRUST, opinionFrom } from '../intel/engine';
import { estimateDistanceM, formatDistance } from '../intel/distance';
import { BottomSheet } from '../ui/BottomSheet';
import { TrustDial } from '../ui/TrustDial';
import { EvidenceLedger, TrustHistory } from '../ui/TrustHistory';
import { LEVEL, score } from '../ui/trust';
import { cn } from '../utils/cn';

interface DeviceDetailModalProps {
  device: BluetoothDevice | null;
  onClose: () => void;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[var(--surface)] px-3 py-2.5">
      <p className="text-[11px] text-[var(--text-muted)]">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-[var(--text)]">{value}</p>
    </div>
  );
}

/** How the number was produced, using this device's actual evidence. */
function HowCalculated({ r, s }: { r: number; s: number }) {
  const o = opinionFrom(r, s);
  const W = TRUST.W;
  const a = TRUST.baseRate;
  return (
    <div className="space-y-3 text-sm leading-6 text-[var(--text-secondary)]">
      <p>
        BlueGuardian uses a Beta reputation model (subjective logic, Jøsang). Every real observation is evidence:
        good behaviour adds to <b className="text-[var(--success)]">r</b>, warning signs add to <b className="text-[var(--danger)]">s</b>.
        Evidence loses half its weight every 14 days, so trust has to keep being earned.
      </p>
      <div className="rounded-2xl bg-[var(--surface)] p-3 text-[13px] text-[var(--text)]">
        <p>Good evidence r = {r.toFixed(2)}, warning evidence s = {s.toFixed(2)}</p>
        <p className="mt-1">Score = (r + {a} × {W}) ÷ (r + s + {W}) = ({r.toFixed(2)} + {a * W}) ÷ {(r + s + W).toFixed(2)} = <b>{score(o)}</b></p>
        <p className="mt-1">Certainty = (r + s) ÷ (r + s + {W}) = <b>{Math.round(o.confidence * 100)}%</b></p>
      </div>
      <p>
        “Trusted” also needs your consent (pairing or tapping Trust); without it the best level is “Likely safe”.
        A new device starts at 50 with 0% certainty, which means unknown, not risky. Pairing (+3), your trust (+5) and
        consistent sightings (+0.3 each, at most +1 a day) raise it. Alerts (−5, −2 or −0.75), identity changes (−1.5),
        unusual signal (−0.4) and blocking (−10) lower it.
      </p>
    </div>
  );
}

export function DeviceDetailModal({ device, onClose }: DeviceDetailModalProps) {
  const { executeAction, getAllowedActions } = useSecurity();
  const { state: deviceState } = useBluetoothDevices();
  const engine = useIntel();
  const [confirm, setConfirm] = useState<SecurityActionType | null>(null);
  const [showHow, setShowHow] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const current = device ? deviceState.devices.find((d) => d.id === device.id) ?? device : null;

  const profile = current?.address ? engine.profile(current.address) : undefined;
  const trust = profile?.trust;
  const opinion = engine.trustOf(current?.address);
  const findings = engine.findingsFor(current?.address);
  const actions = current ? getAllowedActions(current).filter((a) => ['TRUST', 'MARK_UNKNOWN', 'BLOCK', 'UNBLOCK', 'FORGET'].includes(a)) : [];
  const isTracker = Boolean(current?.tracker || profile?.tracker);
  const owned = Boolean(current?.address && engine.snapshot.mine.includes(current.address.toUpperCase()));
  const distance = estimateDistanceM(current?.rssi, current?.txPower);

  const run = (type: SecurityActionType) => {
    if (!current) return;
    if (type === 'BLOCK' || type === 'FORGET') { setConfirm(type); return; }
    executeAction(type, current, 'Changed by the owner.');
  };

  return (
    <BottomSheet open={Boolean(current)} onClose={onClose} label={current?.name ?? 'Device'}>
      {current && (
        <div className="space-y-5 px-5 pb-8 pt-2">
          <div className="text-center">
            <h2 className="text-xl font-bold">{current.name}</h2>
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">
              {current.familyLabel ?? (current.paired ? 'Paired with this phone' : 'Bluetooth device')}
            </p>
          </div>

          <div className="flex flex-col items-center">
            <TrustDial opinion={opinion} />
            <p className="mt-3 text-base font-semibold" style={{ color: LEVEL[opinion.level].color }}>{LEVEL[opinion.level].label}</p>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              From {trust?.ledger.length ?? 0} piece{trust?.ledger.length === 1 ? '' : 's'} of evidence
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Fact label="Status" value={current.connectionStatus === 'connected' ? 'Connected' : current.paired ? 'Paired' : current.blocked ? 'Blocked' : 'Nearby'} />
            <Fact label="Distance" value={formatDistance(distance)} />
            <Fact label="Seen" value={profile ? `${profile.scans} time${profile.scans === 1 ? '' : 's'}` : 'Once'} />
          </div>

          {findings.map((f) => (
            <div key={f.id} className={cn('rounded-2xl p-4', f.severity === 'high' ? 'bg-[var(--danger)]/12' : 'bg-[var(--warning)]/12')}>
              <p className="flex items-center gap-2 font-semibold"><ShieldAlert className="h-4 w-4" style={{ color: f.severity === 'high' ? 'var(--danger)' : 'var(--warning)' }} />{f.title}</p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{f.summary}</p>
              <p className="mt-2 text-sm font-medium">{f.action}</p>
            </div>
          ))}

          <section>
            <h3 className="mb-2 text-sm font-semibold">Trust over time</h3>
            <TrustHistory trust={trust} />
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Why this score</h3>
              {(trust?.ledger.length ?? 0) > 6 && (
                <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs font-semibold text-[var(--accent)]">{showAll ? 'Show less' : 'Show all'}</button>
              )}
            </div>
            <EvidenceLedger ledger={trust?.ledger ?? []} limit={showAll ? 40 : 6} />
          </section>

          <button type="button" onClick={() => setShowHow((v) => !v)} className="tap flex w-full items-center justify-between rounded-2xl bg-[var(--surface)] px-4 py-3 text-left text-sm font-semibold">
            How this score is calculated
            <ChevronRight className={cn('h-4 w-4 transition-transform', showHow && 'rotate-90')} />
          </button>
          <AnimatePresence initial={false}>
            {showHow && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <HowCalculated r={opinion.positive} s={opinion.negative} />
              </motion.div>
            )}
          </AnimatePresence>

          {isTracker && !current.paired && current.address && (
            <button type="button" disabled={owned} onClick={() => current.address && engine.markMine(current.address)}
              className="tap flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--surface)] py-3 text-sm font-semibold disabled:opacity-50">
              <MapPin className="h-4 w-4" /> {owned ? 'Marked as your tracker' : 'This tracker is mine'}
            </button>
          )}

          {isNativeAndroidApp() && current.address && !current.blocked && (
            <NativeConnectPanel address={current.address} paired={Boolean(current.paired)} connected={current.connectionStatus === 'connected'} />
          )}

          {actions.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {actions.map((a) => (
                <button key={a} type="button" onClick={() => run(a)}
                  className={cn('tap flex min-h-12 items-center justify-center gap-2 rounded-2xl text-sm font-semibold',
                    a === 'TRUST' ? 'bg-[var(--success)] text-[#06231a]'
                      : a === 'BLOCK' ? 'bg-[var(--danger)]/15 text-[var(--danger)]'
                        : 'bg-[var(--surface)] text-[var(--text-secondary)]')}>
                  {a === 'TRUST' && <CheckCircle className="h-4 w-4" />}
                  {a === 'BLOCK' && <Ban className="h-4 w-4" />}
                  {a === 'UNBLOCK' && <RotateCcw className="h-4 w-4" />}
                  {a === 'FORGET' && <Trash2 className="h-4 w-4" />}
                  {a === 'TRUST' ? 'Trust' : a === 'MARK_UNKNOWN' ? 'Remove trust' : a === 'BLOCK' ? 'Block' : a === 'UNBLOCK' ? 'Unblock' : 'Forget'}
                </button>
              ))}
            </div>
          )}

          <p className="text-center text-[11px] text-[var(--text-muted)]">
            {current.address ?? 'Address hidden'}, last seen {formatDistanceToNow(new Date(current.lastSeen), { addSuffix: true })}
          </p>

          <AnimatePresence>
            {confirm && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
                className="rounded-2xl border border-[var(--danger)]/30 bg-[var(--surface)] p-4">
                <p className="font-semibold">{confirm === 'BLOCK' ? `Block ${current.name}?` : `Forget ${current.name}?`}</p>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">{confirm === 'BLOCK' ? 'Its trust drops to untrusted and BlueGuardian will refuse to connect to it.' : 'Its history and trust record in BlueGuardian are removed.'}</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setConfirm(null)} className="tap rounded-xl bg-[var(--surface-raised)] py-2.5 text-sm">Cancel</button>
                  <button type="button" onClick={() => { executeAction(confirm, current, 'Confirmed by the owner.'); setConfirm(null); if (confirm === 'FORGET') onClose(); }}
                    className="tap rounded-xl bg-[var(--danger)] py-2.5 text-sm font-semibold text-[#1a0d08]">{confirm === 'BLOCK' ? 'Block' : 'Forget'}</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </BottomSheet>
  );
}
