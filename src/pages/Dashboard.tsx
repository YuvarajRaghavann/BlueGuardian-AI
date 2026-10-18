import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, LoaderCircle, LockKeyhole, MapPin, ScanLine, ShieldAlert, ShieldCheck } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { DeviceCard } from '../components/DeviceCard';
import { ThreatCard } from '../components/ThreatCard';
import { DeviceDetailModal } from '../components/DeviceDetailModal';
import { NativeCombinedResultsModal } from '../components/NativeCombinedResultsModal';
import { useBluetoothDevices } from '../context/DeviceContext';
import { useThreats } from '../context/ThreatContext';
import { isNativeAndroidApp } from '../services/nativeBluetoothService';
import type { BluetoothDevice } from '../types';
import { cn } from '../utils/cn';

const seenAt = (d: BluetoothDevice) => new Date(d.lastSeen).getTime();

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'danger' | 'success' }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className={cn('text-2xl font-semibold tracking-tight',
        tone === 'danger' && value > 0 ? 'text-[var(--danger)]' : tone === 'success' ? 'text-[var(--success)]' : 'text-[var(--text)]')}>{value}</p>
      <p className="mt-0.5 text-xs text-[var(--text-muted)]">{label}</p>
    </div>
  );
}

function Section({ title, to, children }: { title: string; to?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-[var(--text)]">{title}</h2>
        {to && <Link to={to} className="flex items-center text-xs font-medium text-[var(--accent)]">See all <ChevronRight className="h-3.5 w-3.5" /></Link>}
      </div>
      <div className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">{children}</div>
    </section>
  );
}

export function Dashboard() {
  const { state, scanRealDevices, scanCombinedDevices } = useBluetoothDevices();
  const { state: threatState } = useThreats();
  const navigate = useNavigate();
  const [resultsOpen, setResultsOpen] = useState(false);
  const [selected, setSelected] = useState<BluetoothDevice | null>(null);
  const native = isNativeAndroidApp();
  const scanning = state.scan.state === 'scanning';

  const real = useMemo(() => state.devices.filter((d) => d.discoverySource === 'REAL'), [state.devices]);
  const lastScan = real.length ? Math.max(...real.map(seenAt)) : null;
  const nearby = real.filter((d) => lastScan !== null && lastScan - seenAt(d) < 5 * 60_000);
  const yours = real.filter((d) => d.paired || d.trusted).sort((a, b) => (b.connectionStatus === 'connected' ? 1 : 0) - (a.connectionStatus === 'connected' ? 1 : 0));
  const others = nearby.filter((d) => !d.paired && !d.trusted).sort((a, b) => (b.rssi ?? -200) - (a.rssi ?? -200));
  const alerts = threatState.threats.filter((t) => t.status === 'ACTIVE' || t.status === 'INVESTIGATING');
  const highAlerts = alerts.filter((t) => t.severity === 'high' || t.severity === 'critical');

  const scan = () => {
    if (native) {
      setResultsOpen(true);
      void scanCombinedDevices();
    } else {
      void scanRealDevices();
    }
  };

  const clear = alerts.length === 0;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <section className={cn('relative overflow-hidden rounded-3xl border p-5 sm:p-6',
        clear ? 'border-[var(--success)]/25 bg-gradient-to-br from-[var(--success)]/10 to-[var(--surface)]'
          : 'border-[var(--danger)]/30 bg-gradient-to-br from-[var(--danger)]/12 to-[var(--surface)]')}>
        <div className="flex items-center gap-3">
          <div className={cn('grid h-12 w-12 place-items-center rounded-2xl', clear ? 'bg-[var(--success)]/15 text-[var(--success)]' : 'bg-[var(--danger)]/15 text-[var(--danger)]')}>
            {clear ? <ShieldCheck className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-[var(--text)] sm:text-2xl">
              {clear ? 'All clear' : `${alerts.length} alert${alerts.length === 1 ? '' : 's'} need${alerts.length === 1 ? 's' : ''} attention`}
            </h1>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              {scanning ? 'Scanning nearby Bluetooth…'
                : lastScan ? `Last scan ${formatDistanceToNow(lastScan, { addSuffix: true })} · ${nearby.length} device${nearby.length === 1 ? '' : 's'} around you`
                  : 'Scan to check the Bluetooth devices around you.'}
            </p>
          </div>
        </div>
        <button type="button" onClick={scan} disabled={scanning}
          className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60 sm:w-auto sm:px-8">
          {scanning ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
          {scanning ? 'Scanning…' : 'Scan now'}
        </button>
      </section>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Around you" value={nearby.length} />
        <Stat label="Your devices" value={yours.length} tone="success" />
        <Stat label="Alerts" value={highAlerts.length || alerts.length} tone="danger" />
      </div>

      {alerts.length > 0 && (
        <Section title="Alerts" to="/threats">
          {alerts.slice(0, 3).map((t) => <ThreatCard key={t.id} threat={t} onClick={() => navigate('/threats')} />)}
        </Section>
      )}

      {yours.length > 0 && (
        <Section title="Your devices" to="/recovery">
          {yours.slice(0, 5).map((d) => <DeviceCard key={d.id} device={d} onClick={() => setSelected(d)} />)}
        </Section>
      )}

      {others.length > 0 && (
        <Section title="Around you now" to="/devices">
          {others.slice(0, 6).map((d) => <DeviceCard key={d.id} device={d} onClick={() => setSelected(d)} />)}
        </Section>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link to="/recovery" className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 hover:border-[var(--accent)]/40">
          <MapPin className="h-5 w-5 text-[var(--accent)]" />
          <span className="text-sm font-semibold text-[var(--text)]">Find my devices</span>
        </Link>
        <Link to="/secure-share" className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 hover:border-[var(--accent)]/40">
          <LockKeyhole className="h-5 w-5 text-[var(--accent)]" />
          <span className="text-sm font-semibold text-[var(--text)]">Secure Share</span>
        </Link>
      </div>

      <NativeCombinedResultsModal
        open={resultsOpen && native}
        scan={state.scan}
        devices={[...real].sort((a, b) => ((b.connectionStatus === 'connected' ? 2 : 0) + (b.paired ? 1 : 0)) - ((a.connectionStatus === 'connected' ? 2 : 0) + (a.paired ? 1 : 0)))}
        onClose={() => setResultsOpen(false)}
        onSelect={(device) => { setResultsOpen(false); setSelected(device); }}
      />
      <DeviceDetailModal device={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
