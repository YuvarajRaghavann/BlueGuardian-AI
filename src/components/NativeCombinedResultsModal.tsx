import { AlertTriangle, Bluetooth, ChevronRight, LoaderCircle, Radio, X } from 'lucide-react';
import type { BluetoothDevice, BluetoothScanState } from '../types';

interface NativeCombinedResultsModalProps {
  open: boolean;
  scan: BluetoothScanState;
  devices: BluetoothDevice[];
  onClose: () => void;
  onSelect: (device: BluetoothDevice) => void;
}

/**
 * Single results surface for a sequential BLE + classic discovery pass.
 * Same normalized Android-reported addresses are merged by DeviceContext.
 */
export function NativeCombinedResultsModal({
  open,
  scan,
  devices,
  onClose,
  onSelect,
}: NativeCombinedResultsModalProps) {
  if (!open) return null;

  const scanning = scan.state === 'scanning' && scan.transport === 'ANDROID_COMBINED_SCAN';
  const failed = scan.state === 'error'
    || scan.state === 'permission-denied'
    || scan.state === 'unsupported';

  const summary = scanning
    ? scan.scanStage === 'CLASSIC'
      ? 'Classic discovery running… ' + devices.length + ' unique device(s) observed so far'
      : 'BLE discovery running… ' + devices.length + ' unique device(s) observed so far'
    : failed
      ? scan.error || 'Combined Bluetooth discovery failed.'
      : devices.length > 0
        ? 'Combined discovery finished. ' + devices.length + ' unique device(s) shown.'
        : scan.error || 'No devices were reported during the combined scan.';

  const transportLabel = (device: BluetoothDevice) => {
    const transports = device.discoveryTransports ?? [];
    if (transports.includes('BLE') && transports.includes('CLASSIC')) return 'BLE + CLASSIC';
    if (transports.includes('BLE')) return 'BLE';
    if (transports.includes('CLASSIC')) return 'CLASSIC';
    return 'COMBINED';
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="native-combined-results-title"
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
              <h2 id="native-combined-results-title" className="text-base font-semibold text-[var(--text)]">
                Combined Bluetooth discovery
              </h2>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                BLE followed by classic discovery · foreground only
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close combined Bluetooth results"
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
                BlueGuardian runs BLE first, then classic discovery to avoid competing permission prompts and adapter sessions. Results with the same Android-reported address merge into one record. BLE privacy addresses may differ from classic addresses, so Android may not always reveal that two reports belong to the same physical device. Discovery does not connect to or trust devices.
              </p>
              {scan.error && !scanning && (
                <p role={failed ? 'alert' : 'status'} className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
                  {scan.error}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto p-3 sm:p-4">
          {devices.length > 0 ? (
            <ul className="space-y-2">
              {devices.map((device) => {
                const label = transportLabel(device);
                const dualObserved = label === 'BLE + CLASSIC';
                return (
                  <li key={device.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(device)}
                      className="flex w-full items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition hover:border-[var(--accent)]/40 hover:bg-[var(--surface-hover)]"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-raised)] text-[var(--accent)]">
                        {dualObserved ? <Bluetooth className="h-5 w-5" /> : label === 'CLASSIC' ? <Radio className="h-5 w-5" /> : <Bluetooth className="h-5 w-5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-[var(--text)]">{device.name || 'Unknown Bluetooth device'}</p>
                        <p className="mt-1 truncate text-xs text-[var(--text-muted)]">{device.address || device.id}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                          <span className="rounded-md border border-[var(--border)] px-1.5 py-0.5 font-semibold">{label}</span>
                          <span>{typeof device.rssi === 'number' ? String(device.rssi) + ' dBm' : 'RSSI unavailable'}</span>
                          <span>{device.paired ? 'Paired in Android' : 'Not connected'}</span>
                          {device.services.length > 0 && <span>{device.services.length} advertised service UUID(s)</span>}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <Bluetooth className="h-8 w-8 text-[var(--text-muted)]" />
              <p className="text-sm font-medium text-[var(--text)]">
                {scanning
                  ? scan.scanStage === 'CLASSIC' ? 'Waiting for discoverable classic devices' : 'Waiting for BLE advertisements'
                  : failed ? 'Combined scan did not complete' : 'No devices found in this scan'}
              </p>
              <p className="max-w-md text-xs leading-5 text-[var(--text-muted)]">
                {scanning
                  ? 'Keep BlueGuardian in the foreground. BLE targets must advertise; classic targets must be discoverable during the classic scan.'
                  : failed
                    ? 'Check the reported permission or Bluetooth error, fix it in Android Settings if needed, then retry.'
                    : 'A completed empty scan is possible when no compatible devices respond. Try an actively advertising BLE device and a classic device in discoverable or pairing mode.'}
              </p>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3">
          <span className="text-xs text-[var(--text-muted)]">Combined Bluetooth discovery</span>
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
