import { AlertTriangle, Bluetooth, ChevronRight, LoaderCircle, Signal, X } from 'lucide-react';
import type { BluetoothDevice, BluetoothScanState } from '../types';

interface NativeBleResultsModalProps {
  open: boolean;
  scan: BluetoothScanState;
  devices: BluetoothDevice[];
  onClose: () => void;
  onSelect: (device: BluetoothDevice) => void;
}

/**
 * Android foreground BLE uses advertisement scanning rather than Chrome's
 * browser-owned device chooser. This dialog makes the native scan results
 * visible while scanning and gives each observed device a clear details path.
 */
export function NativeBleResultsModal({
  open,
  scan,
  devices,
  onClose,
  onSelect,
}: NativeBleResultsModalProps) {
  if (!open) return null;

  const scanning = scan.state === 'scanning';
  const failed = scan.state === 'error'
    || scan.state === 'permission-denied'
    || scan.state === 'unsupported';

  const summary = scanning
    ? `Searching nearby… ${devices.length} device(s) found`
    : failed
      ? scan.error || 'The device search could not be completed.'
      : devices.length > 0
        ? `Found ${devices.length} device(s). Select one to view details.`
        : scan.error || 'No devices found. Keep Bluetooth on and try again.';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="native-ble-results-title"
      onClick={onClose}
    >
      <section
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--accent)]/25 bg-[var(--accent-soft)] text-[var(--accent)]">
              <Bluetooth className="h-5 w-5" />
            </div>
            <div>
              <h2 id="native-ble-results-title" className="text-base font-semibold text-[var(--text)]">
                Nearby devices
              </h2>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Live results · nearby devices only
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close BLE results"
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="border-b border-[var(--border)] px-5 py-3">
          <div className="flex items-start gap-2">
            {scanning ? (
              <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[var(--accent)]" />
            ) : failed ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]" />
            ) : (
              <Bluetooth className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--text)]">{summary}</p>
              <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                Only nearby devices detected during this scan appear here. Detection does not mean a device is connected, and some devices do not advertise continuously.
              </p>
            </div>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto p-3 sm:p-4">
          {devices.length > 0 ? (
            <ul className="space-y-2">
              {devices.map((device) => (
                <li key={device.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(device)}
                    className="flex w-full items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition hover:border-[var(--accent)]/40 hover:bg-[var(--surface-hover)]"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-raised)] text-[var(--accent)]">
                      <Bluetooth className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[var(--text)]">{device.name || 'Unknown Bluetooth device'}</p>
                      <p className="mt-1 truncate text-xs text-[var(--text-muted)]">
                        {device.type} · {device.address || device.id}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                        <span className="inline-flex items-center gap-1">
                          <Signal className="h-3 w-3" />
                          {typeof device.rssi === 'number' ? `${device.rssi} dBm` : 'RSSI unavailable'}
                        </span>
                        <span>{device.services.length} advertised service UUID(s)</span>
                        <span>{device.gattConnected ? 'Connected' : 'Not connected'}</span>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <Bluetooth className="h-8 w-8 text-[var(--text-muted)]" />
              <p className="text-sm font-medium text-[var(--text)]">
                {scanning ? 'Waiting for nearby devices' : 'No devices to display'}
              </p>
              <p className="max-w-md text-xs leading-5 text-[var(--text-muted)]">
                Keep the app open, bring your device nearby, and make sure Bluetooth is on. If the scan failed, review the message above and check your device permissions.
              </p>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3">
          <span className="text-xs text-[var(--text-muted)]">Nearby search</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)] transition hover:bg-[var(--surface-hover)]"
          >
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}
