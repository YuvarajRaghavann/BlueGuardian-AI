import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { LoaderCircle, ScanLine } from 'lucide-react';
import { DeviceCard } from '../components/DeviceCard';
import { DeviceDetailModal } from '../components/DeviceDetailModal';
import { useBluetoothDevices } from '../context/DeviceContext';
import { isNativeAndroidApp } from '../services/nativeBluetoothService';
import { useIntel } from '../intel/store';
import type { BluetoothDevice } from '../types';
import { Radar } from '../ui/Radar';
import { LEVEL } from '../ui/trust';
import { cn } from '../utils/cn';

type Filter = 'all' | 'trusted' | 'new' | 'watch';
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'trusted', label: 'Trusted' },
  { id: 'new', label: 'New' },
  { id: 'watch', label: 'Watch' },
];

const seen = (d: BluetoothDevice) => new Date(d.lastSeen).getTime();

export function AroundYou() {
  const { state, scanCombinedDevices, scanRealDevices } = useBluetoothDevices();
  const engine = useIntel();
  const reduce = useReducedMotion();
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<BluetoothDevice | null>(null);
  const native = isNativeAndroidApp();
  const scanning = state.scan.state === 'scanning';

  const real = useMemo(() => state.devices.filter((d) => d.discoverySource === 'REAL'), [state.devices]);
  const lastScan = real.length ? Math.max(...real.map(seen)) : null;
  const around = real.filter((d) => d.paired || (lastScan !== null && lastScan - seen(d) < 10 * 60_000));

  const tagged = around.map((d) => {
    const o = engine.trustOf(d.address);
    const alert = engine.findingsFor(d.address).length > 0;
    const group: Filter = alert || o.level === 'untrusted' || o.level === 'uncertain' ? 'watch'
      : o.level === 'trusted' || o.level === 'likely_safe' ? 'trusted' : 'new';
    return { d, o, alert, group };
  });
  const shown = tagged
    .filter((t) => filter === 'all' || t.group === filter)
    .sort((a, b) => Number(b.alert) - Number(a.alert) || (b.d.connectionStatus === 'connected' ? 1 : 0) - (a.d.connectionStatus === 'connected' ? 1 : 0) || (b.d.rssi ?? -200) - (a.d.rssi ?? -200));
  const count = (f: Filter) => (f === 'all' ? tagged.length : tagged.filter((t) => t.group === f).length);
  const scan = () => (native ? void scanCombinedDevices() : void scanRealDevices());

  return (
    <div className="space-y-5">
      <Radar
        scanning={scanning}
        onScan={scan}
        onSelect={(id) => setSelected(real.find((d) => d.id === id) ?? null)}
        dots={tagged.slice(0, 60).map(({ d, o, alert }) => ({ id: d.id, address: d.address, name: d.name, rssi: d.rssi, txPower: d.txPower, color: LEVEL[o.level].color, alert }))}
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
            {around.length ? 'Try another filter.' : native ? 'Scan to see every Bluetooth device near you, including your connected earbuds.' : 'Choose a Bluetooth device to check it.'}
          </p>
        </div>
      )}

      <button type="button" onClick={scan} disabled={scanning}
        className="tap flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] text-[15px] font-bold text-white shadow-[0_12px_32px_rgba(140,124,255,0.35)] disabled:opacity-60">
        {scanning ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <ScanLine className="h-5 w-5" />}
        {scanning ? 'Scanning…' : native ? 'Scan again' : 'Choose a device'}
      </button>
      {state.scan.state === 'error' && state.scan.error && <p className="text-center text-sm text-[var(--danger)]">{state.scan.error}</p>}

      <DeviceDetailModal device={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
