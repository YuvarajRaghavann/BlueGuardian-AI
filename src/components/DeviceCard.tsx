import { Cpu, Headphones, HelpCircle, Laptop, MapPin, Smartphone, Watch } from 'lucide-react';
import type { BluetoothDevice, DeviceType } from '../types';
import { useIntel } from '../intel/store';
import { estimateDistanceM, formatDistance } from '../intel/distance';
import { TrustRing } from '../ui/TrustDial';
import { LEVEL, score } from '../ui/trust';

const icons: Record<DeviceType, typeof Cpu> = {
  smartphone: Smartphone, earbuds: Headphones, headphones: Headphones, smartwatch: Watch, laptop: Laptop, iot: Cpu, unknown: HelpCircle,
};

/** One device: trust ring, name, what it's doing, and its score. */
export function DeviceCard({ device, onClick }: { device: BluetoothDevice; onClick?: () => void }) {
  const engine = useIntel();
  const opinion = engine.trustOf(device.address);
  const alert = engine.findingsFor(device.address)[0];
  const Icon = device.tracker ? MapPin : icons[device.type] ?? HelpCircle;
  const distance = formatDistance(estimateDistanceM(device.rssi, device.txPower));
  const status = alert ? alert.title
    : device.connectionStatus === 'connected' ? 'Connected'
      : device.paired ? 'Paired' : typeof device.rssi === 'number' ? distance : (device.familyLabel ?? 'Nearby');
  const unverified = opinion.level === 'unverified';

  return (
    <button type="button" onClick={onClick} className="tap flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--surface-raised)]">
      <TrustRing opinion={opinion} size={44}>
        <Icon className="h-[18px] w-[18px] text-[var(--text-secondary)]" />
      </TrustRing>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-[var(--text)]">{device.name}</p>
        <p className="truncate text-xs" style={{ color: alert ? 'var(--danger)' : device.connectionStatus === 'connected' ? 'var(--success)' : 'var(--text-muted)' }}>
          {status}
        </p>
      </div>
      <div className="text-right">
        <p className="text-lg font-bold leading-none" style={{ color: LEVEL[opinion.level].color }}>{unverified ? '—' : score(opinion)}</p>
        <p className="mt-1 text-[10px] text-[var(--text-muted)]">{LEVEL[opinion.level].short}</p>
      </div>
    </button>
  );
}
