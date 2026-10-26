import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ThreatCard } from '../components/ThreatCard';
import { DeviceDetailModal } from '../components/DeviceDetailModal';
import { useBluetoothDevices } from '../context/DeviceContext';
import { useThreats } from '../context/ThreatContext';
import { isNativeAndroidApp } from '../services/nativeBluetoothService';
import { useIntel } from '../intel/store';
import type { BluetoothDevice } from '../types';
import { Radar } from '../ui/Radar';
import { TrustRing } from '../ui/TrustDial';
import { LEVEL, score } from '../ui/trust';
import { VERDICT_STYLE, type Verdict } from '../intel/guardian';
import { guardianFor, useGuardianVersion } from '../intel/guardianStore';
import { BottomSheet } from '../ui/BottomSheet';

const ORDER: Verdict[] = ['safe', 'clear', 'caution', 'unsafe'];
const seen = (d: BluetoothDevice) => new Date(d.lastSeen).getTime();

function SectionTitle({ children, to }: { children: ReactNode; to?: string }) {
  return (
    <div className="mb-2.5 flex items-center justify-between px-1">
      <h2 className="text-[15px] font-bold">{children}</h2>
      {to && <Link to={to} className="flex items-center text-xs font-semibold text-[var(--accent)]">See all<ChevronRight className="h-3.5 w-3.5" /></Link>}
    </div>
  );
}

export function Dashboard() {
  const { state, scanRealDevices, scanCombinedDevices } = useBluetoothDevices();
  const { state: threatState } = useThreats();
  const engine = useIntel();
  useGuardianVersion();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [selected, setSelected] = useState<BluetoothDevice | null>(null);
  const [howOpen, setHowOpen] = useState(false);
  const scanning = state.scan.state === 'scanning';

  const real = useMemo(() => state.devices.filter((d) => d.discoverySource === 'REAL'), [state.devices]);
  const lastScan = real.length ? Math.max(...real.map(seen)) : null;
  const around = real.filter((d) => lastScan !== null && lastScan - seen(d) < 5 * 60_000);
  const yours = real.filter((d) => d.paired || d.trusted)
    .sort((a, b) => (b.connectionStatus === 'connected' ? 1 : 0) - (a.connectionStatus === 'connected' ? 1 : 0));
  const alerts = threatState.threats.filter((t) => t.status === 'ACTIVE' || t.status === 'INVESTIGATING');

  // Every device gets an instant Guardian verdict from what it broadcasts; history only refines it.
  const verdicts = new Map(around.map((d) => [d.id, guardianFor(d).verdict]));
  const counts = ORDER.map((v) => ({ verdict: v, n: [...verdicts.values()].filter((x) => x === v).length }));
  const unsafe = counts.find((c) => c.verdict === 'unsafe')?.n ?? 0;
  const safe = (counts.find((c) => c.verdict === 'safe')?.n ?? 0) + (counts.find((c) => c.verdict === 'clear')?.n ?? 0);

  const scan = () => (isNativeAndroidApp() ? void scanCombinedDevices() : void scanRealDevices());
  const dots = around.slice(0, 60).map((d) => {
    const v = verdicts.get(d.id) ?? 'clear';
    return {
      id: d.id, address: d.address, name: d.name, rssi: d.rssi, txPower: d.txPower,
      color: VERDICT_STYLE[v].color, alert: v === 'unsafe',
    };
  });

  return (
    <div className="space-y-7">
      <section className="pt-2">
        <Radar dots={dots} scanning={scanning} onScan={scan} onSelect={(id) => setSelected(real.find((d) => d.id === id) ?? null)} />
        <motion.div className="mt-4 text-center" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <h2 className="text-[26px] font-extrabold leading-tight">
            {scanning ? 'Checking…' : unsafe ? `${unsafe} unsafe device${unsafe === 1 ? '' : 's'} near you` : alerts.length ? `${alerts.length} alert${alerts.length === 1 ? '' : 's'} near you` : around.length ? 'All clear around you' : 'Tap to scan'}
          </h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {lastScan
              ? `${around.length} devices checked, ${safe} safe. Scanned ${formatDistanceToNow(lastScan, { addSuffix: true })}.`
              : 'Check every Bluetooth device near you before you connect.'}
          </p>
        </motion.div>
      </section>

      {around.length > 0 && (
        <section>
          <SectionTitle to="/devices">Safety around you</SectionTitle>
          <button type="button" onClick={() => navigate('/devices')} className="tap block w-full rounded-3xl bg-[var(--surface)] p-4 text-left">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--surface-hover)]">
              {counts.filter((c) => c.n > 0).map((c, i) => (
                <motion.span key={c.verdict} className="h-full" style={{ background: VERDICT_STYLE[c.verdict].color }}
                  initial={reduce ? false : { width: 0 }} animate={{ width: `${(c.n / around.length) * 100}%` }}
                  transition={{ duration: 0.8, delay: 0.1 + i * 0.08, ease: [0.22, 1, 0.36, 1] }} />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {counts.filter((c) => c.n > 0).map((c) => (
                <span key={c.verdict} className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                  <span className="h-2 w-2 rounded-full" style={{ background: VERDICT_STYLE[c.verdict].color }} />
                  {c.n} {VERDICT_STYLE[c.verdict].label.toLowerCase()}
                </span>
              ))}
            </div>
          </button>
          <button type="button" onClick={() => setHowOpen(true)} className="mt-2 px-1 text-xs font-semibold text-[var(--accent)]">How devices are checked</button>
        </section>
      )}

      {alerts.length > 0 && (
        <section>
          <SectionTitle to="/threats">Alerts</SectionTitle>
          <div className="divide-y divide-[var(--border)] overflow-hidden rounded-3xl bg-[var(--surface)]">
            {alerts.slice(0, 3).map((t) => <ThreatCard key={t.id} threat={t} onClick={() => navigate('/threats')} />)}
          </div>
        </section>
      )}

      {yours.length > 0 && (
        <section>
          <SectionTitle to="/recovery">Your devices</SectionTitle>
          <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">
            {yours.map((d, i) => {
              const o = engine.trustOf(d.address);
              return (
                <motion.button key={d.id} type="button" onClick={() => setSelected(d)}
                  className="tap w-[148px] shrink-0 snap-start rounded-3xl bg-[var(--surface)] p-4 text-left"
                  initial={reduce ? false : { opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}>
                  <TrustRing opinion={o} size={52}>
                    <span className="font-display text-sm font-semibold" style={{ color: LEVEL[o.level].color }}>{o.level === 'unverified' ? '—' : score(o)}</span>
                  </TrustRing>
                  <p className="mt-3 truncate text-sm font-semibold">{d.name}</p>
                  <p className="text-xs" style={{ color: d.connectionStatus === 'connected' ? 'var(--success)' : 'var(--text-muted)' }}>
                    {d.connectionStatus === 'connected' ? 'Connected' : 'Paired'}
                  </p>
                </motion.button>
              );
            })}
          </div>
        </section>
      )}

      <DeviceDetailModal device={selected} onClose={() => setSelected(null)} />

      <BottomSheet open={howOpen} onClose={() => setHowOpen(false)} label="How devices are checked">
        <div className="space-y-3 px-5 pb-8 pt-2 text-sm leading-6 text-[var(--text-secondary)]">
          <h2 className="text-lg font-bold text-[var(--text)]">How devices are checked</h2>
          <p>Every device is checked the moment it's seen, before you connect, from what it broadcasts:</p>
          <ul className="space-y-1.5">
            <li>• <b className="text-[var(--text)]">Identity:</b> its maker ID, registered with the Bluetooth SIG, must match the brand in its name. A fake "AirPods" without Apple's ID is caught.</li>
            <li>• <b className="text-[var(--text)]">Disguise:</b> hidden characters or look-alike letters in the name.</li>
            <li>• <b className="text-[var(--text)]">Keyboard control:</b> keyboards and input devices, especially ones pretending to be earbuds.</li>
            <li>• <b className="text-[var(--text)]">Known attacks:</b> pairing-popup spam, trackers following you, copies of your devices.</li>
            <li>• <b className="text-[var(--text)]">Deep check</b> (optional): reads its Device Information without pairing and tests if it protects its data.</li>
          </ul>
          <p>Any failed check makes it <b className="text-[var(--danger)]">Unsafe</b>, a warning makes it <b className="text-[var(--warning)]">Caution</b>. <b className="text-[var(--success)]">Safe</b> means its maker was verified or you paired it; <b className="text-[var(--text)]">Looks safe</b> means nothing risky was found but the maker couldn't be confirmed.</p>
          <p>The trust score adds behaviour over time on top: how consistently the device has behaved across your scans.</p>
        </div>
      </BottomSheet>
    </div>
  );
}
