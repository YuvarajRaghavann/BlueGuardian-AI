import { Cpu, Headphones, HelpCircle, Laptop, MapPin, Smartphone, Watch } from 'lucide-react';
import type { BluetoothDevice, DeviceType } from '../types';
import { useIntel } from '../intel/store';
import { estimateDistanceM, formatDistance } from '../intel/distance';
import { VERDICT_STYLE } from '../intel/guardian';
import { guardianFor, useGuardianVersion } from '../intel/guardianStore';
import { score } from '../ui/trust';

const icons: Record<DeviceType, typeof Cpu> = {
  smartphone: Smartphone, earbuds: Headphones, headphones: Headphones, smartwatch: Watch, laptop: Laptop, iot: Cpu, unknown: HelpCircle,
};

/** One device: Guardian verdict first (checked before connecting), behaviour trust second. */
export function DeviceCard({ device, onClick }: { device: BluetoothDevice; onClick?: () => void }) {
  const engine = useIntel();
  useGuardianVersion();
  const guardian = guardianFor(device);
  const style = VERDICT_STYLE[guardian.verdict];
  const opinion = engine.trustOf(device.address);
  const Icon = device.tracker ? MapPin : icons[device.type] ?? HelpCircle;
  const distance = formatDistance(estimateDistanceM(device.rssi, device.txPower));
  const risky = guardian.verdict === 'unsafe' || guardian.verdict === 'caution';
  const status = risky ? guardian.summary
    : device.connectionStatus === 'connected' ? 'Connected'
      : device.paired ? 'Paired' : guardian.maker ? guardian.maker : typeof device.rssi === 'number' ? distance : (device.familyLabel ?? 'Nearby');

  return (
    <button type="button" onClick={onClick} className="tap flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--surface-raised)]">
      <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: `color-mix(in srgb, ${style.color} 16%, transparent)`, color: style.color }}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-[var(--text)]">{device.name}</p>
        <p className="truncate text-xs" style={{ color: risky ? style.color : device.connectionStatus === 'connected' ? 'var(--success)' : 'var(--text-muted)' }}>
          {status}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <span className="inline-block rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ color: style.color, background: `color-mix(in srgb, ${style.color} 14%, transparent)` }}>
          {style.label}
        </span>
        {opinion.level !== 'unverified' && <p className="mt-1 text-[10px] text-[var(--text-muted)]">Trust {score(opinion)}</p>}
      </div>
    </button>
  );
}
