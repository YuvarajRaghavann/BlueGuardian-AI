import { ChevronRight, Cpu, Headphones, HelpCircle, Laptop, MapPin, ShieldAlert, Smartphone, Watch } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { BluetoothDevice, DeviceType } from '../types';
import { useIntel } from '../intel/store';
import { standingOf } from '../intel/engine';
import { cn } from '../utils/cn';

const icons: Record<DeviceType, typeof Cpu> = {
  smartphone: Smartphone,
  earbuds: Headphones,
  headphones: Headphones,
  smartwatch: Watch,
  laptop: Laptop,
  iot: Cpu,
  unknown: HelpCircle,
};

/** One compact row: name, what it is, whether it's yours, and an alert dot only when there is evidence. */
export function DeviceCard({ device, onClick }: { device: BluetoothDevice; onClick?: () => void }) {
  const engine = useIntel();
  const profile = device.address ? engine.profile(device.address) : undefined;
  const { standing } = standingOf(profile, Boolean(device.paired), device.trusted);
  const findings = engine.findingsFor(device.address);
  const alert = findings[0];
  const Icon = device.tracker ? MapPin : icons[device.type] ?? HelpCircle;
  const status = device.connectionStatus === 'connected' ? 'Connected' : device.paired ? 'Paired' : standing === 'familiar' ? 'Familiar' : 'New';

  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-raised)]">
      <div className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl',
        alert ? 'bg-[var(--danger)]/15 text-[var(--danger)]'
          : device.connectionStatus === 'connected' ? 'bg-[var(--success)]/15 text-[var(--success)]'
            : 'bg-[var(--surface-hover)] text-[var(--text-secondary)]')}>
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[var(--text)]">{device.name}</p>
        <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
          {alert ? <span className="font-medium text-[var(--danger)]">{alert.title}</span> : (
            <>
              <span className={device.connectionStatus === 'connected' ? 'text-[var(--success)]' : undefined}>{status}</span>
              {device.familyLabel ? ` · ${device.familyLabel}` : ''}
              {typeof device.rssi === 'number' ? ` · ${device.rssi} dBm` : ''}
              {` · ${formatDistanceToNow(new Date(device.lastSeen), { addSuffix: true })}`}
            </>
          )}
        </p>
      </div>
      {alert ? <ShieldAlert className="h-4 w-4 shrink-0 text-[var(--danger)]" /> : <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />}
    </button>
  );
}
