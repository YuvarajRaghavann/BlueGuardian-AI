import { Bell, Bluetooth, LockKeyhole, User } from 'lucide-react';
import { cn } from '../utils/cn';
import { useBluetoothDevices } from '../context/DeviceContext';

interface TopbarProps {
  title: string;
}

export function Topbar({
  title,
}: TopbarProps) {
  const { state } = useBluetoothDevices();
  const scanActive = state.scan.state === 'scanning';
  const scanStatus = scanActive
    ? 'User-initiated scan in progress'
    : state.scan.state === 'complete'
      ? 'Last scan completed'
      : state.scan.state === 'error'
        ? 'Last scan failed'
        : 'No active scan';

  return (
    <header className="hidden h-[73px] border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur-xl lg:block">
      <div className="flex h-full items-center justify-between px-8">
        <div>
          <p className="text-[15px] font-semibold text-white">{title}</p>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Browser-local device review and recovery
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2',
              scanActive
                ? 'border-[rgba(53,201,138,0.2)] bg-[rgba(53,201,138,0.06)]'
                : 'border-[var(--border)] bg-[var(--surface)]',
            )}
          >
            <Bluetooth
              className={cn(
                'h-4 w-4',
                scanActive
                  ? 'text-[var(--success)]'
                  : 'text-[var(--text-muted)]',
              )}
            />

            <div className="hidden xl:block">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Bluetooth
              </p>
              <p className="text-xs font-medium text-white">
                {scanStatus}
              </p>
            </div>
          </div>

          <div className="hidden items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-[var(--text-muted)] xl:flex">
            <Bell className="h-4 w-4" />
            <span className="text-xs">Notifications unavailable</span>
          </div>

          <div className="ml-1 flex items-center gap-2.5 border-l border-[var(--border)] pl-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <User className="h-4 w-4 text-[var(--text-secondary)]" />
            </div>

            <div className="hidden xl:block">
              <p className="text-xs font-semibold text-white">Browser session</p>
              <div className="mt-0.5 flex items-center gap-1">
                <LockKeyhole className="h-3 w-3 text-[var(--text-muted)]" />
                <span className="text-[10px] text-[var(--text-muted)]">
                  Local session · recovery requires a separate owner token
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
