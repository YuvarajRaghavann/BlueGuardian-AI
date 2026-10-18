import { useState, useMemo, useEffect } from 'react';
import {
  Bluetooth,
  FlaskConical,
  Search,
  Radar,
  Radio,
  List,
  Bug,
  Database,
  ShieldCheck,
} from 'lucide-react';
import { DeviceCard } from '../components/DeviceCard';
import { DeviceDetailModal } from '../components/DeviceDetailModal';
import { NativeBleResultsModal } from '../components/NativeBleResultsModal';
import { NativeClassicResultsModal } from '../components/NativeClassicResultsModal';
import { NativeCombinedResultsModal } from '../components/NativeCombinedResultsModal';
import { EmptyState } from '../components/EmptyState';
import { useBluetoothDevices } from '../context/DeviceContext';
import { cn } from '../utils/cn';
import { diagnoseBluetoothEnvironment, type BluetoothEnvironmentDiagnostics } from '../services/bluetoothService';
import { isNativeAndroidApp } from '../services/nativeBluetoothService';
import { SIMULATOR_ENABLED } from '../config/buildFlags';

export function Devices() {
  const {
    state,
    dispatch,
    scanSimulatedDevices,
    scanRealDevices,
    scanClassicDevices,
    scanCombinedDevices,
    loadPairedDevices,
    clearSimulatedDevices,
  } = useBluetoothDevices();
  const [selectedDevice, setSelectedDevice] =
    useState<null | import('../types').BluetoothDevice>(null);
  const [nativeResultsOpen, setNativeResultsOpen] = useState(false);
  const [nativeScanStartedAt, setNativeScanStartedAt] = useState<number | null>(null);
  const [classicResultsOpen, setClassicResultsOpen] = useState(false);
  const [combinedResultsOpen, setCombinedResultsOpen] = useState(false);
  const [combinedScanStartedAt, setCombinedScanStartedAt] = useState<number | null>(null);
  const [pairedResultsOpen, setPairedResultsOpen] = useState(false);
  const [pairedDevicesLoading, setPairedDevicesLoading] = useState(false);
  const [classicScanStartedAt, setClassicScanStartedAt] = useState<number | null>(null);
  const [localSearch, setLocalSearch] = useState(state.search);
  const [sourceView, setSourceView] = useState<'real' | 'simulated' | 'all'>('real');
  const [diagnostics, setDiagnostics] = useState<BluetoothEnvironmentDiagnostics | null>(null);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  // Default to the broad chooser for troubleshooting phones/audio accessories.
  // The name-filtered option is available when the broad native list is noisy.
  const [pickerMode, setPickerMode] = useState<'known' | 'all'>('all');
  const nativeAndroid = isNativeAndroidApp();


  // The native Android scanner does not open Chrome's device chooser. Keep a
  // dedicated results list limited to observations received during this scan.
  const nativeScanDevices = useMemo(() => {
    return state.devices
      .filter((device) => {
        if (device.discoverySource !== 'REAL' || (device.discoveryTransport === 'CLASSIC' || device.discoveryTransport === 'PAIRED' || device.discoveryTransport === 'COMBINED')) return false;
        if (nativeScanStartedAt === null) return true;
        const seenAt = device.lastSeen instanceof Date
          ? device.lastSeen.getTime()
          : Date.parse(String(device.lastSeen));
        return Number.isFinite(seenAt) && seenAt >= nativeScanStartedAt - 2000;
      })
      .sort((a, b) => {
        const aSeen = a.lastSeen instanceof Date ? a.lastSeen.getTime() : Date.parse(String(a.lastSeen));
        const bSeen = b.lastSeen instanceof Date ? b.lastSeen.getTime() : Date.parse(String(b.lastSeen));
        return bSeen - aSeen;
      });
  }, [state.devices, nativeScanStartedAt]);

  const classicScanDevices = useMemo(() => {
    return state.devices
      .filter((device) => {
        if (device.discoverySource !== 'REAL' || (device.discoveryTransport !== 'CLASSIC' && device.discoveryTransport !== 'PAIRED')) return false;
        if (classicScanStartedAt === null) return true;
        const seenAt = device.lastSeen instanceof Date
          ? device.lastSeen.getTime()
          : Date.parse(String(device.lastSeen));
        return Number.isFinite(seenAt) && seenAt >= classicScanStartedAt - 2000;
      })
      .sort((a, b) => {
        const aSeen = a.lastSeen instanceof Date ? a.lastSeen.getTime() : Date.parse(String(a.lastSeen));
        const bSeen = b.lastSeen instanceof Date ? b.lastSeen.getTime() : Date.parse(String(b.lastSeen));
        return bSeen - aSeen;
      });
  }, [state.devices, classicScanStartedAt]);

  const combinedScanDevices = useMemo(() => {
    return state.devices
      .filter((device) => {
        if (device.discoverySource !== 'REAL') return false;
        if (combinedScanStartedAt === null) return true;
        const seenAt = device.lastSeen instanceof Date
          ? device.lastSeen.getTime()
          : Date.parse(String(device.lastSeen));
        return Number.isFinite(seenAt) && seenAt >= combinedScanStartedAt - 2000;
      })
      .sort((a, b) => {
        const aSeen = a.lastSeen instanceof Date ? a.lastSeen.getTime() : Date.parse(String(a.lastSeen));
        const bSeen = b.lastSeen instanceof Date ? b.lastSeen.getTime() : Date.parse(String(b.lastSeen));
        return bSeen - aSeen;
      });
  }, [state.devices, combinedScanStartedAt]);

  useEffect(() => {
    dispatch({ type: 'SET_SEARCH', payload: localSearch });
  }, [localSearch, dispatch]);

  const visibleDevices = useMemo(() => {
    const sourceFiltered = state.devices.filter(device => {
      if (sourceView === 'real') return device.discoverySource === 'REAL';
      if (sourceView === 'simulated') return device.discoverySource === 'SIMULATED';
      return true;
    });
    const q = localSearch.trim().toLowerCase();
    if (!q) return sourceFiltered;
    return sourceFiltered.filter(device =>
      device.name.toLowerCase().includes(q)
      || (device.address ?? '').toLowerCase().includes(q)
      || device.type.toLowerCase().includes(q)
    );
  }, [state.devices, sourceView, localSearch]);

  const handleScan = async () => {
    setNativeScanStartedAt(Date.now());
    setNativeResultsOpen(nativeAndroid);
    await scanRealDevices(pickerMode);
  };

  const handleClassicScan = async () => {
    setClassicScanStartedAt(Date.now());
    setClassicResultsOpen(true);
    await scanClassicDevices();
  };

  const handleCombinedScan = async () => {
    setCombinedScanStartedAt(Date.now());
    setCombinedResultsOpen(true);
    await scanCombinedDevices();
  };

  const handleLoadPairedDevices = async () => {
    setPairedDevicesLoading(true);
    setPairedResultsOpen(true);
    try {
      await loadPairedDevices();
    } finally {
      setPairedDevicesLoading(false);
    }
  };

  const handleGenerateSimulated = async () => {
    await scanSimulatedDevices();
  };

  const handleRunDiagnostics = async () => {
    setDiagnosticError(null);
    try {
      const report = await diagnoseBluetoothEnvironment();
      setDiagnostics(report);
      console.info('[BlueGuardian][BLE] Browser environment diagnostic report:', report);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'The browser diagnostic check failed.';
      setDiagnosticError(message);
      console.error('[BlueGuardian][BLE] Browser environment diagnostics failed:', error);
    }
  };

  const isScanning = state.scan.state === 'scanning';

  return (
    <div className="relative space-y-6 sm:space-y-7">
      {/* Page header */}
      <header className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--surface)] via-[var(--surface)] to-[var(--surface-raised)] p-5 shadow-[0_12px_32px_rgba(0,0,0,0.14)] sm:p-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-accent">
            <Radar className="h-3.5 w-3.5" />
            Bluetooth intelligence
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)] sm:text-3xl">
            Devices
          </h1>

          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
            Find nearby devices, check their trust status, and keep the devices you care about close at hand.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className={cn('flex min-h-10 flex-col justify-center gap-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-secondary)]', nativeAndroid && 'hidden')}>
            <span className="font-medium">Bluetooth picker results</span>
            <select
              value={pickerMode}
              onChange={e => setPickerMode(e.target.value as 'known' | 'all')}
              disabled={isScanning}
              aria-label="Bluetooth picker results"
              className="min-w-44 bg-transparent text-sm text-[var(--text)] outline-none disabled:opacity-60"
            >
              <option value="known">Recognizable names first</option>
              <option value="all">All available devices</option>
            </select>
          </label>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={nativeAndroid ? handleCombinedScan : handleScan}
              disabled={isScanning}
              className={cn(
                'inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] px-4 text-sm font-semibold transition-all',
                isScanning
                  ? 'cursor-not-allowed bg-[var(--surface-raised)] text-[var(--text-muted)]'
                  : 'bg-[var(--accent)] text-white shadow-[0_8px_24px_rgba(59,156,255,0.18)] hover:-translate-y-0.5 hover:bg-[var(--accent-strong)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40'
              )}
            >
              <Bluetooth className={cn('h-4 w-4', isScanning && 'animate-spin')} />
              {isScanning ? 'Searching nearby devices…' : nativeAndroid ? 'Find nearby devices' : pickerMode === 'known' ? 'Choose a named device' : 'Choose a device'}
            </button>

            {nativeAndroid && false && (
              <>
                <button
                  type="button"
                  onClick={() => void handleClassicScan()}
                  disabled={isScanning}
                  className={cn(
                    'inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] border px-4 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40',
                    isScanning
                      ? 'cursor-not-allowed border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)]'
                      : 'border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/15'
                  )}
                >
                  <Radio className={cn('h-4 w-4', state.scan.transport === 'ANDROID_CLASSIC_SCAN' && isScanning && 'animate-pulse')} />
                  {state.scan.transport === 'ANDROID_CLASSIC_SCAN' && isScanning ? 'Searching nearby…' : 'Search nearby'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCombinedScan()}
                  disabled={isScanning}
                  className={cn(
                    'inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] border px-4 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40',
                    isScanning
                      ? 'cursor-not-allowed border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)]'
                      : 'border-[var(--accent)]/40 bg-[var(--accent)]/15 text-[var(--accent)] hover:bg-[var(--accent)]/20'
                  )}
                >
                  <Bluetooth className={cn('h-4 w-4', state.scan.transport === 'ANDROID_COMBINED_SCAN' && isScanning && 'animate-pulse')} />
                  {state.scan.transport === 'ANDROID_COMBINED_SCAN' && isScanning ? 'Combined scan running…' : 'Find nearby devices'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleLoadPairedDevices()}
                  disabled={isScanning}
                  className={cn(
                    'inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] border px-4 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40',
                    isScanning
                      ? 'cursor-not-allowed border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)]'
                      : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-raised)]'
                  )}
                >
                  <List className="h-4 w-4" />
                  Paired devices
                </button>
              </>
            )}

            {SIMULATOR_ENABLED && (<button
              type="button"
              onClick={() => void handleGenerateSimulated()}
              disabled={isScanning}
              className={cn(
                'inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] border px-4 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40',
                isScanning
                  ? 'cursor-not-allowed border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)]'
                  : 'border-[var(--success)]/30 bg-[var(--success)]/10 text-[var(--success)] hover:bg-[var(--success)]/15'
              )}
            >
              <FlaskConical className="h-4 w-4" />
              Generate simulated data
            </button>)}
          </div>
        </div>
      </header>

      <section className="overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] p-5 shadow-[0_20px_50px_rgba(0,0,0,.25)] sm:p-6">
        <div className="mx-auto flex max-w-xl flex-col items-center text-center">
          <div className={cn("relative mb-5 grid h-44 w-44 place-items-center rounded-full border border-[var(--accent)]/50 bg-[radial-gradient(circle,rgba(82,103,255,.15),rgba(82,103,255,.025)_62%,transparent_64%)] sm:h-52 sm:w-52", isScanning && "animate-pulse")}>
            <div className={cn("absolute inset-3 rounded-full border border-[var(--accent)]/25", isScanning && "animate-spin")} style={{ animationDuration: '7s' }} />
            <div className={cn("absolute inset-7 rounded-full border border-[var(--accent)]/15", isScanning && "animate-ping")} />
            <Bluetooth className="h-14 w-14 text-[var(--text)] drop-shadow-[0_0_18px_rgba(82,103,255,.5)]" strokeWidth={1.5} />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[.24em] text-[var(--accent)]">Device finder</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text)] sm:text-3xl">{isScanning ? 'Searching nearby devices…' : visibleDevices.length ? 'Your devices, at a glance' : 'Find your nearby devices'}</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-[var(--text-secondary)]">{isScanning ? 'Keep Bluetooth on and bring the device you need nearby.' : visibleDevices.length ? 'Select any device below to see its details and security status.' : 'Make sure Bluetooth is turned on and your device is nearby, then start a scan.'}</p>
          <button type="button" onClick={() => void (nativeAndroid ? handleCombinedScan() : handleScan())} disabled={isScanning} className="mt-5 inline-flex min-h-12 w-full max-w-sm items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-6 text-sm font-semibold text-white shadow-[0_10px_28px_rgba(82,103,255,.28)] transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60">
            <Bluetooth className={cn("h-4 w-4", isScanning && "animate-pulse")} />{isScanning ? 'Searching…' : visibleDevices.length ? 'Search again' : 'Scan for devices'}
          </button>
        </div>
        {!nativeAndroid && (
          <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <Bug className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
                <div><p className="text-sm font-semibold text-[var(--text)]">Bluetooth help</p><p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">Check availability and permissions if a scan cannot start.</p></div>
              </div>
              <button type="button" onClick={() => void handleRunDiagnostics()} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-2 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/15"><Bug className="h-3.5 w-3.5" /> Check Bluetooth</button>
            </div>
            {diagnosticError && <p role="alert" className="mt-3 text-xs text-[var(--danger)]">{diagnosticError}</p>}
            {diagnostics && <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--border)] p-2.5"><span className="text-[var(--text-muted)]">Secure context</span><p className="mt-1 font-semibold text-[var(--text)]">{diagnostics.secureContext ? 'Ready' : 'Unavailable'}</p></div>
              <div className="rounded-lg border border-[var(--border)] p-2.5"><span className="text-[var(--text-muted)]">Bluetooth access</span><p className="mt-1 font-semibold text-[var(--text)]">{diagnostics.requestDeviceApi ? 'Available' : 'Unavailable'}</p></div>
              <div className="rounded-lg border border-[var(--border)] p-2.5"><span className="text-[var(--text-muted)]">Adapter</span><p className="mt-1 font-semibold text-[var(--text)]">{diagnostics.bluetoothAvailability === 'available' ? 'Available' : diagnostics.bluetoothAvailability === 'unavailable' ? 'Unavailable' : 'Unknown'}</p></div>
            </div>}
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Search className="h-4 w-4 text-[var(--accent)]" />
            <div>
              <h2 className="text-lg font-semibold text-[var(--text)]">Discovered devices</h2>
              <p className="text-xs text-[var(--text-secondary)]">{visibleDevices.length} device(s) in your current view</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="search"
              value={localSearch}
              onChange={event => setLocalSearch(event.target.value)}
              placeholder="Search device name, address, or type"
              aria-label="Search devices"
              className="min-h-10 min-w-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] sm:min-w-64"
            />
            <select
              value={sourceView}
              onChange={event => setSourceView(event.target.value as 'real' | 'simulated' | 'all')}
              aria-label="Device source"
              className="min-h-10 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            >
              <option value="real">Real observations</option>
              {SIMULATOR_ENABLED && <option value="simulated">Simulated examples</option>}
              <option value="all">All devices</option>
            </select>
          </div>
        </div>

        {state.scan.state === 'error' && (
          <div role="alert" className="rounded-lg border border-[var(--danger)]/25 bg-[var(--danger)]/10 p-3 text-sm text-[var(--danger)]">
            {state.scan.error ?? 'The Bluetooth scan failed. Check permissions and try again.'}
          </div>
        )}

        {state.scan.state === 'permission-denied' && (
          <div role="alert" className="rounded-lg border border-[var(--warning)]/25 bg-[var(--warning)]/10 p-3 text-sm text-[var(--warning)]">
            Bluetooth permission was not granted. Allow the requested permission in Android settings, then try again.
          </div>
        )}

        {visibleDevices.length === 0 ? (
          <EmptyState
            icon={Bluetooth}
            title={state.scan.state === 'scanning' ? 'Searching nearby devices' : 'No devices found'}
            description={state.scan.state === 'scanning'
              ? 'Keep Bluetooth turned on and stay close to the device you want to find.'
              : sourceView === 'simulated'
                ? 'Generate simulated examples to preview the interface. These are not physical devices.'
                : 'Turn Bluetooth on, make the device discoverable, and search again.'}
            action={state.scan.state === 'scanning' ? undefined : (
              <button
                type="button"
                onClick={() => { if (nativeAndroid) void handleCombinedScan(); else void handleScan(); }}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--accent)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)]"
              >
                {nativeAndroid ? 'Search again' : 'Choose a device'}
              </button>
            )}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleDevices.map(device => (
              <DeviceCard key={device.id} device={device} onClick={() => setSelectedDevice(device)} />
            ))}
          </div>
        )}

        {visibleDevices.some(device => device.discoverySource === 'SIMULATED') && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--warning)]/20 bg-[var(--warning)]/5 p-3">
            <p className="text-xs text-[var(--text-secondary)]">Sample devices are only for preview and never represent a confirmed physical device.</p>
            <button type="button" onClick={() => clearSimulatedDevices()} className="text-xs font-semibold text-[var(--warning)]">Clear sample data</button>
          </div>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[var(--success)]" /><h2 className="font-semibold text-[var(--text)]">Trust and safety</h2></div>
          <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">Review each device before trusting it. Security indicators are guidance based on the information available, not a guarantee that a device is safe.</p>
        </article>
        <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-2"><Radio className="h-4 w-4 text-[var(--accent)]" /><h2 className="font-semibold text-[var(--text)]">Connection control</h2></div>
          <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">Choosing a device opens its details. You remain in control of pairing, connecting, and approving trusted devices.</p>
        </article>
        <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-2"><Database className="h-4 w-4 text-[var(--accent)]" /><h2 className="font-semibold text-[var(--text)]">Device history</h2></div>
          <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">Review recent observations and trust decisions to understand what changed over time.</p>
        </article>
      </section>

      <NativeBleResultsModal
        open={nativeResultsOpen}
        scan={state.scan}
        devices={nativeScanDevices}
        onClose={() => setNativeResultsOpen(false)}
        onSelect={device => {
          setNativeResultsOpen(false);
          setSelectedDevice(device);
        }}
      />

      <NativeClassicResultsModal
        open={classicResultsOpen || pairedResultsOpen}
        view={pairedResultsOpen ? 'paired' : 'scan'}
        loadingPaired={pairedDevicesLoading}
        scan={state.scan}
        devices={pairedResultsOpen ? state.devices.filter(device => device.discoveryTransport === 'PAIRED') : classicScanDevices}
        onClose={() => {
          setClassicResultsOpen(false);
          setPairedResultsOpen(false);
        }}
        onSelect={device => {
          setClassicResultsOpen(false);
          setPairedResultsOpen(false);
          setSelectedDevice(device);
        }}
      />

      <NativeCombinedResultsModal
        open={combinedResultsOpen}
        scan={state.scan}
        devices={combinedScanDevices}
        onClose={() => setCombinedResultsOpen(false)}
        onSelect={device => {
          setCombinedResultsOpen(false);
          setSelectedDevice(device);
        }}
      />

      <DeviceDetailModal
        device={selectedDevice}
        onClose={() => setSelectedDevice(null)}
      />
    </div>
  );
}
