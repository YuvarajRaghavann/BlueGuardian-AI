import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { LoaderCircle, ScanLine } from 'lucide-react';
import { DeviceCard } from '../components/DeviceCard';
import { DeviceDetailModal } from '../components/DeviceDetailModal';
import { useBluetoothDevices } from '../context/DeviceContext';
import { isNativeAndroidApp } from '../services/nativeBluetoothService';
import { useIntel } from '../intel/store';
import type { BluetoothDevice } from '../types';
import { Radar } from '../ui/Radar';
import { VERDICT_STYLE } from '../intel/guardian';
import { guardianFor, useGuardianVersion } from '../intel/guardianStore';
import { cn } from '../utils/cn';
import { normalizeBluetoothName } from '../services/bluetoothService';
import { Notice } from '../ui/kit';

type Filter = 'all' | 'safe' | 'caution' | 'unsafe';
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'safe', label: 'Safe' },
  { id: 'caution', label: 'Caution' },
  { id: 'unsafe', label: 'Unsafe' },
];

const seen = (d: BluetoothDevice) => new Date(d.lastSeen).getTime();

export function AroundYou() {
  const { state, scanCombinedDevices, scanRealDevices, refreshKnownDevices } = useBluetoothDevices();
  useIntel();
  useGuardianVersion();
  const reduce = useReducedMotion();
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<BluetoothDevice | null>(null);
  const native = isNativeAndroidApp();
  const scanning = state.scan.state === 'scanning';
  const [showUnnamed, setShowUnnamed] = useState(false);
  const [dismissedMsg, setDismissedMsg] = useState<string | null>(null);

  // Like Android's Bluetooth screen: paired and connected devices appear as soon as you open it.
  useEffect(() => {
    if (native) void refreshKnownDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native]);

  const real = useMemo(() => {
    // Older builds stored one device under separate classic and combined records; show it once.
    const combined = new Set(state.devices.filter((d) => d.id.startsWith('android-combined:') && d.address).map((d) => String(d.address).toLowerCase()));
    return state.devices.filter((d) => d.discoverySource === 'REAL'
      && !(d.id.startsWith('android-classic:') && d.address && combined.has(d.address.toLowerCase())));
  }, [state.devices]);
  const lastScan = real.length ? Math.max(...real.map(seen)) : null;
  const recent = real.filter((d) => d.paired || (lastScan !== null && lastScan - seen(d) < 10 * 60_000));
  // Nameless advertisers (rotating phone/beacon addresses) are hidden like Android settings does,
  // unless they are risky, paired, connected or recognised.
  const isNamed = (d: BluetoothDevice) => Boolean(normalizeBluetoothName(d.name)) || Boolean(d.paired) || d.connectionStatus === 'connected' || Boolean(d.familyLabel);
  const unnamed = recent.filter((d) => !isNamed(d) && guardianFor(d).verdict !== 'unsafe');
  const around = showUnnamed ? recent : recent.filter((d) => !unnamed.includes(d));

  const tagged = around.map((d) => {
    const g = guardianFor(d);
    const group: Filter = g.verdict === 'unsafe' ? 'unsafe' : g.verdict === 'caution' ? 'caution' : 'safe';
    return { d, g, alert: g.verdict === 'unsafe', group };
  });
  const shown = tagged
    .filter((t) => filter === 'all' || t.group === filter)
    .sort((a, b) => VERDICT_STYLE[b.g.verdict].rank - VERDICT_STYLE[a.g.verdict].rank || (b.d.connectionStatus === 'connected' ? 1 : 0) - (a.d.connectionStatus === 'connected' ? 1 : 0) || (b.d.rssi ?? -200) - (a.d.rssi ?? -200));
  const count = (f: Filter) => (f === 'all' ? tagged.length : tagged.filter((t) => t.group === f).length);
  const scan = () => (native ? void scanCombinedDevices() : void scanRealDevices());

  return (
    <div className="space-y-5">
      <Radar
        scanning={scanning}
        onScan={scan}
        onSelect={(id) => setSelected(real.find((d) => d.id === id) ?? null)}
        dots={tagged.slice(0, 60).map(({ d, g, alert }) => ({ id: d.id, address: d.address, name: d.name, rssi: d.rssi, txPower: d.txPower, color: VERDICT_STYLE[g.verdict].color, alert }))}
      />

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" onClick={() => setFilter(f.id)}
            className={cn('tap relative shrink-0 rounded-full px-4 py-2 text-sm font-semibold', filter === f.id ? 'text-[var(--text)]' : 'text-[var(--text-muted)]')}>
            {filter === f.id && <motion.span layoutId="around-filter" className="absolute inset-0 rounded-full bg-[var(--accent-soft)] ring-1 ring-[var(--border-strong)]" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
            <span className="relative">{f.label} <span className="text-[var(--text-muted)]">{count(f.id)}</span></span>
          </button>
        ))}
      </div>

      {shown.length > 0 ? (
        <motion.div layout className="divide-y divide-[var(--border)] overflow-hidden rounded-3xl bg-[var(--surface)]">
          <AnimatePresence initial={false}>
            {shown.map(({ d }, i) => (
              <motion.div key={d.id} layout initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                transition={{ delay: reduce ? 0 : Math.min(i, 12) * 0.025 }}>
                <DeviceCard device={d} onClick={() => setSelected(d)} />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      ) : (
        <div className="rounded-3xl bg-[var(--surface)] px-6 py-10 text-center">
          <p className="text-lg font-bold">{around.length ? 'Nothing in this group' : 'No devices yet'}</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {around.length ? 'Try another filter.' : native ? 'Scan to check every Bluetooth device near you.' : 'Choose a Bluetooth device to check it.'}
          </p>
        </div>
      )}

      {unnamed.length > 0 && (
        <button type="button" onClick={() => setShowUnnamed((v) => !v)} className="w-full text-center text-sm font-semibold text-[var(--accent)]">
          {showUnnamed ? 'Hide devices without a name' : `Show ${unnamed.length} device${unnamed.length === 1 ? '' : 's'} without a name`}
        </button>
      )}

      <button type="button" onClick={scan} disabled={scanning}
        className="tap flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] text-[15px] font-bold text-white shadow-[0_12px_32px_rgba(140,124,255,0.35)] disabled:opacity-60">
        {scanning ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <ScanLine className="h-5 w-5" />}
        {scanning ? 'Scanning…' : native ? 'Scan again' : 'Choose a device'}
      </button>
      {!scanning && state.scan.error && state.scan.error !== dismissedMsg && (
        <Notice tone={state.scan.state === 'error' || state.scan.state === 'permission-denied' ? 'danger' : 'info'} onDismiss={() => setDismissedMsg(state.scan.error ?? null)}>
          {state.scan.state === 'permission-denied' ? 'Allow Nearby devices for BlueGuardian in Settings, then scan again.' : state.scan.error}
        </Notice>
      )}

      <DeviceDetailModal device={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
