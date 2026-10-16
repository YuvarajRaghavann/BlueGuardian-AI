import { AlertTriangle, Bluetooth, ChevronRight, LoaderCircle, Radio, X } from 'lucide-react';
import type { BluetoothDevice, BluetoothScanState } from '../types';

interface NativeClassicResultsModalProps {
  open: boolean;
  view: 'scan' | 'paired';
  loadingPaired?: boolean;
  scan: BluetoothScanState;
  devices: BluetoothDevice[];
  onClose: () => void;
  onSelect: (device: BluetoothDevice) => void;
}

/** Classic discovery and the Android bonded-device list, deliberately separate from BLE. */
export function NativeClassicResultsModal({
  open,
  view,
  loadingPaired = false,
  scan,
  devices,
  onClose,
  onSelect,
}: NativeClassicResultsModalProps) {
  if (!open) return null;

  const pairedView = view === 'paired';
  const scanning = !pairedView && scan.state === 'scanning';
  const loading = pairedView && loadingPaired;
  const failed = scan.state === 'error'
    || scan.state === 'permission-denied'
    || scan.state === 'unsupported';

  const summary = pairedView
    ? loading
      ? 'Reading Android’s paired-device list…'
      : devices.length > 0
      ? `Android returned ${devices.length} paired device(s).`
      : scan.error || 'No paired Bluetooth devices were returned.'
    : scanning
      ? `Discovering classic Bluetooth devices… ${devices.length} device(s) found`
      : failed
        ? scan.error || 'Classic Bluetooth discovery failed.'
        : devices.length > 0
          ? `Discovery finished. ${devices.length} classic device(s) found.`
          : scan.error || 'No classic Bluetooth devices were discovered.';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="native-classic-results-title"
      onClick={onClose}
    >
      <section
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--accent)]/25 bg-[var(--accent-soft)] text-[var(--accent)]">
              {pairedView ? <Bluetooth className="h-5 w-5" /> : <Radio className="h-5 w-5" />}
            </div>
            <div>
              <h2 id="native-classic-results-title" className="text-base font-semibold text-[var(--text)]">
                {pairedView ? 'Paired Bluetooth devices' : 'Classic Bluetooth discovery'}
              </h2>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                {pairedView ? 'Android system bonded-device list' : 'Foreground classic discovery · separate from BLE'}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close classic Bluetooth results"
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="border-b border-[var(--border)] px-5 py-3">
          <div className="flex items-start gap-2">
            {(scanning || loading) ? (
              <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[var(--accent)]" />
            ) : failed ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]" />
            ) : (
              <Bluetooth className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--text)]">{summary}</p>
              <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                {pairedView
                  ? 'These are devices already paired in Android Settings. This list does not mean they are currently connected or nearby.'
                  : 'Classic discovery only returns devices that respond while discoverable. BLE-only advertisers will not necessarily appear here, and detection does not establish a connection.'}
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
                      {device.paired ? <Bluetooth className="h-5 w-5" /> : <Radio className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[var(--text)]">{device.name || 'Unknown classic Bluetooth device'}</p>
                      <p className="mt-1 truncate text-xs text-[var(--text-muted)]">{device.address || device.id}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                        <span>{device.paired ? 'Paired in Android' : 'Discovered nearby'}</span>
                        <span>{typeof device.rssi === 'number' ? `${device.rssi} dBm` : 'RSSI unavailable'}</span>
                        <span>{device.connectionStatus === 'connected' ? 'Connected' : device.connectionStatus === 'disconnected' ? 'Not connected' : 'Connection not checked'}</span>
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
                {loading ? 'Loading paired devices…' : scanning ? 'Waiting for discoverable devices' : failed ? (pairedView ? 'Could not load paired devices' : 'Classic discovery could not start') : pairedView ? 'No paired devices to show' : 'No classic devices found'}
              </p>
              <p className="max-w-md text-xs leading-5 text-[var(--text-muted)]">
                {loading
                  ? 'Android is checking its system paired-device registry. The permission prompt may need your approval.'
                  : failed
                    ? pairedView
                      ? 'Grant Nearby Devices permission to BlueGuardian in Android Settings, then retry loading the paired-device list.'
                      : 'Grant Nearby Devices and Location permission for classic discovery. On Android 12+, allow precise location if prompted. Confirm Bluetooth is enabled, wait for any system scan to finish, and retry. BlueGuardian does not collect GPS coordinates from this permission.'
                    : pairedView
                      ? 'Pair an eligible Bluetooth device in Android Settings, then refresh this list.'
                      : 'Make the other classic Bluetooth device discoverable or place it in pairing mode before retrying. Devices that only advertise over BLE belong in the separate BLE scan.'}
              </p>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3">
          <span className="text-xs text-[var(--text-muted)]">Classic Bluetooth discovery</span>
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
