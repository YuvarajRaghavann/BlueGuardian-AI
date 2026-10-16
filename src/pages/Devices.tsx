import { useState, useMemo, useEffect } from 'react';
import {
  Bluetooth,
  FlaskConical,
  Search,
  Cpu,
  AlertTriangle,
  SlidersHorizontal,
  Radar,
  Radio,
  List,
  Bug,
  Database,
} from 'lucide-react';
import { DeviceCard } from '../components/DeviceCard';
import { DeviceDetailModal } from '../components/DeviceDetailModal';
import { NativeBleResultsModal } from '../components/NativeBleResultsModal';
import { NativeClassicResultsModal } from '../components/NativeClassicResultsModal';
import { EmptyState } from '../components/EmptyState';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useBluetoothDevices } from '../context/DeviceContext';
import { cn } from '../utils/cn';
import { needsManualApproval } from '../utils/connectionPolicy';
import { diagnoseBluetoothEnvironment, type BluetoothEnvironmentDiagnostics } from '../services/bluetoothService';
import { isNativeAndroidApp } from '../services/nativeBluetoothService';

export function Devices() {
  const {
    state,
    dispatch,
    scanSimulatedDevices,
    scanRealDevices,
    scanClassicDevices,
    loadPairedDevices,
    startWatchingPermittedBleDevices,
    stopWatchingPermittedBleDevices,
    clearSimulatedDevices,
  } = useBluetoothDevices();
  const [selectedDevice, setSelectedDevice] =
    useState<null | import('../types').BluetoothDevice>(null);
  const [nativeResultsOpen, setNativeResultsOpen] = useState(false);
  const [nativeScanStartedAt, setNativeScanStartedAt] = useState<number | null>(null);
  const [classicResultsOpen, setClassicResultsOpen] = useState(false);
  const [pairedResultsOpen, setPairedResultsOpen] = useState(false);
  const [pairedDevicesLoading, setPairedDevicesLoading] = useState(false);
  const [classicScanStartedAt, setClassicScanStartedAt] = useState<number | null>(null);
  const [localSearch, setLocalSearch] = useState(state.search);
  const [advertisementWatch, setAdvertisementWatch] = useState<{ active: boolean; message: string }>({ active: false, message: '' });
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
        if (device.discoverySource !== 'REAL' || (device.discoveryTransport === 'CLASSIC' || device.discoveryTransport === 'PAIRED')) return false;
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

  
  const nativeClassicDevices = useMemo(() => state.devices
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
    }), [state.devices, classicScanStartedAt]);

  const nativePairedDevices = useMemo(() => nativeClassicDevices.filter((device) => device.paired), [nativeClassicDevices]);

  useEffect(() => {
    dispatch({ type: 'SET_SEARCH', payload: localSearch });
  }, [localSearch, dispatch]);

  const realDeviceCount = state.devices.filter(device => device.discoverySource !== 'SIMULATED').length;
  const simulatedDeviceCount = state.devices.filter(device => device.discoverySource === 'SIMULATED').length;

  // Never mix demo records into the default real-hardware view. Simulation data
  // is visible only when the user explicitly selects Simulated or All records.
  const sourceFilteredDevices = useMemo(() => {
    if (sourceView === 'simulated') return state.devices.filter(device => device.discoverySource === 'SIMULATED');
    if (sourceView === 'real') return state.devices.filter(device => device.discoverySource !== 'SIMULATED');
    return [...state.devices];
  }, [state.devices, sourceView]);

  const filteredDevices = useMemo(() => {
    let arr = [...sourceFilteredDevices];

    if (localSearch) {
      const q = localSearch.toLowerCase();
      arr = arr.filter(
        d =>
          d.name.toLowerCase().includes(q) ||
          d.manufacturer?.toLowerCase().includes(q) ||
          d.type.includes(q)
      );
    }

    switch (state.filter) {
      case 'trusted':
        arr = arr.filter(d => d.trusted);
        break;
      case 'unknown':
        arr = arr.filter(d => !d.trusted);
        break;
      case 'review':
        arr = arr.filter(d => needsManualApproval(d));
        break;
      case 'high-risk':
        arr = arr.filter(d => d.riskLevel === 'high');
        break;
      case 'connected':
        arr = arr.filter(d => d.connectionStatus === 'connected');
        break;
      case 'nearby':
        arr = arr.filter(d => typeof d.rssi === 'number' && d.rssi > -70);
        break;
    }

    arr.sort((a, b) => {
      switch (state.sort) {
        case 'trust':
          return b.trustScore - a.trustScore;
        case 'signal':
          if (a.rssi === undefined) return b.rssi === undefined ? 0 : 1;
          if (b.rssi === undefined) return -1;
          return b.rssi - a.rssi;
        case 'lastSeen':
          return b.lastSeen.getTime() - a.lastSeen.getTime();
        case 'risk': {
          const riskOrder = { high: 3, medium: 2, low: 1, trusted: 0 };
          return riskOrder[b.riskLevel] - riskOrder[a.riskLevel];
        }
        default:
          return 0;
      }
    });

    return arr;
  }, [sourceFilteredDevices, localSearch, state.filter, state.sort]);

  // Keep real Bluetooth and demo data as two explicit actions. This avoids
  // accidentally showing only sample data when the old Simulation Mode toggle
  // was left enabled from an earlier session.
  const handleScan = async () => {
    setClassicResultsOpen(false);
    setPairedResultsOpen(false);
    setSourceView('real');
    dispatch({ type: 'TOGGLE_SIMULATION', payload: false });
    if (nativeAndroid) {
      setNativeScanStartedAt(Date.now());
      // Show live results immediately. This also gives the user an explicit
      // success/empty/error outcome instead of expecting a browser chooser.
      setNativeResultsOpen(true);
    }
    await scanRealDevices(pickerMode);
  };

  const handleClassicScan = async () => {
    setNativeResultsOpen(false);
    setPairedResultsOpen(false);
    setSourceView('real');
    dispatch({ type: 'TOGGLE_SIMULATION', payload: false });
    setClassicScanStartedAt(Date.now());
    setPairedResultsOpen(false);
    setClassicResultsOpen(true);
    await scanClassicDevices();
  };

  const handleLoadPairedDevices = async () => {
    setNativeResultsOpen(false);
    setClassicResultsOpen(false);
    setSourceView('real');
    dispatch({ type: 'TOGGLE_SIMULATION', payload: false });
    setPairedResultsOpen(true);
    setClassicResultsOpen(false);
    setPairedDevicesLoading(true);
    try {
      // Paired devices are read from Android's bonded-device registry, not scanned.
      await loadPairedDevices();
    } finally {
      setPairedDevicesLoading(false);
    }
  };

  const handleGenerateSimulated = async () => {
    setSourceView('simulated');
    // Keep the general-purpose scan entry point in real mode. Demo generation
    // is explicit and must not switch future scans elsewhere in the app to fake data.
    dispatch({ type: 'TOGGLE_SIMULATION', payload: false });
    await scanSimulatedDevices();
  };

  const handleClearSimulated = () => {
    clearSimulatedDevices();
    setSourceView('real');
    dispatch({ type: 'TOGGLE_SIMULATION', payload: false });
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

  const handleToggleAdvertisementWatch = async () => {
    if (advertisementWatch.active) {
      stopWatchingPermittedBleDevices();
      setAdvertisementWatch({ active: false, message: 'Advertisement watch stopped.' });
      return;
    }
    const result = await startWatchingPermittedBleDevices();
    setAdvertisementWatch({ active: result.ok, message: result.message });
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

          <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
            Discover nearby Bluetooth Low Energy (BLE) devices, review their actual reported names, and assess available connection details.
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
              <option value="all">All BLE devices, including unnamed</option>
            </select>
          </label>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={handleScan}
              disabled={isScanning}
              className={cn(
                'inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] px-4 text-sm font-semibold transition-all',
                isScanning
                  ? 'cursor-not-allowed bg-[var(--surface-raised)] text-[var(--text-muted)]'
                  : 'bg-[var(--accent)] text-white shadow-[0_8px_24px_rgba(59,156,255,0.18)] hover:-translate-y-0.5 hover:bg-[var(--accent-strong)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40'
              )}
            >
              <Bluetooth className={cn('h-4 w-4', isScanning && 'animate-spin')} />
              {isScanning
                ? nativeAndroid
                  ? state.scan.transport === 'ANDROID_CLASSIC_SCAN' ? 'Classic discovery running…' : 'Scanning nearby BLE advertisements…'
                  : 'Opening Bluetooth chooser…'
                : nativeAndroid ? 'Scan nearby BLE devices' : pickerMode === 'known' ? 'Select named BLE device' : 'Select BLE device'}
            </button>

            {nativeAndroid && (
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
                  {state.scan.transport === 'ANDROID_CLASSIC_SCAN' && isScanning ? 'Discovering classic…' : 'Scan classic'}
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

            <button
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
            </button>
          </div>
        </div>
      </header>

      <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)]/80 p-4">
        <div className="flex items-start gap-3">
          <Bluetooth className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-semibold text-[var(--text)]">{nativeAndroid ? 'Native Android Bluetooth discovery' : 'Browser Bluetooth capability'}</p>
            <p className="text-xs leading-5 text-[var(--text-secondary)]">
              {nativeAndroid
                ? 'The Android APK uses Android BluetoothLeScanner for a separate foreground BLE scan. Phase 4 also offers a separate classic Bluetooth discovery action and a system paired-device list. Classic discovery finds only currently discoverable classic devices; it does not find every BLE advertiser or connect to devices. Combined scanning is reserved for Phase 5.'
                : "The real scan path uses Chrome's Web Bluetooth chooser, which returns one selected BLE peripheral per click, not a complete nearby-device list. BlueGuardian then attempts GATT connection and service inspection. Stored real records may be from earlier selections; they are not proof that a device is currently nearby. The diagnostics help identify the stage where access failed. Simulated examples are kept separate and are no longer written into the physical-device database."}
            </p>
          </div>
        </div>

        <div className={cn("rounded-lg border border-[var(--border)] bg-[var(--bg)]/60 p-3", nativeAndroid && 'hidden')}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Bug className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
              <div>
                <p className="text-sm font-semibold text-[var(--text)]">Bluetooth troubleshooting</p>
                <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                  Check whether this browser exposes Web Bluetooth, is running in a secure context, and supports the optional permission/watch APIs.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleRunDiagnostics()}
              className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-2 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/15"
            >
              <Bug className="h-3.5 w-3.5" /> Run browser check
            </button>
          </div>
          {diagnosticError && <p role="alert" className="mt-3 text-xs text-[var(--danger)]">{diagnosticError}</p>}
          {diagnostics && (
            <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-md border border-[var(--border)] p-2.5">
                <span className="text-[var(--text-muted)]">Secure context</span>
                <p className="mt-1 font-semibold text-[var(--text)]">{diagnostics.secureContext ? 'Yes' : 'No'}</p>
              </div>
              <div className="rounded-md border border-[var(--border)] p-2.5">
                <span className="text-[var(--text-muted)]">Web Bluetooth API</span>
                <p className="mt-1 font-semibold text-[var(--text)]">{diagnostics.requestDeviceApi ? 'Available' : 'Not available'}</p>
              </div>
              <div className="rounded-md border border-[var(--border)] p-2.5">
                <span className="text-[var(--text-muted)]">Bluetooth availability</span>
                <p className="mt-1 font-semibold text-[var(--text)]">{diagnostics.bluetoothAvailability === 'available' ? 'Available' : diagnostics.bluetoothAvailability === 'unavailable' ? 'Unavailable' : 'Unknown'}</p>
              </div>
              <div className="rounded-md border border-[var(--border)] p-2.5">
                <span className="text-[var(--text-muted)]">Previously granted device list</span>
                <p className="mt-1 font-semibold text-[var(--text)]">{diagnostics.grantedDeviceListApi ? 'Supported' : 'Not exposed'}</p>
              </div>
              <div className="rounded-md border border-[var(--border)] p-2.5">
                <span className="text-[var(--text-muted)]">Advertisement watch API</span>
                <p className="mt-1 font-semibold text-[var(--text)]">{diagnostics.advertisementWatchApi ? 'Exposed' : 'Not exposed'}</p>
              </div>
              <div className="rounded-md border border-[var(--border)] p-2.5">
                <span className="text-[var(--text-muted)]">API object</span>
                <p className="mt-1 font-semibold text-[var(--text)]">{diagnostics.webBluetoothApi ? 'Present' : 'Missing'}</p>
              </div>
              {diagnostics.availabilityNote && <p className="sm:col-span-2 lg:col-span-3 leading-5 text-[var(--text-secondary)]">{diagnostics.availabilityNote}</p>}
            </div>
          )}
          <p className="mt-3 text-[11px] leading-5 text-[var(--text-muted)]">
            For detailed scan-stage messages, open Chrome DevTools with F12 → Console and search for <code>[BlueGuardian][BLE]</code>. No device ID or address is intentionally logged.
          </p>
        </div>

        <div className={cn("flex flex-col gap-3 rounded-lg border border-[var(--warning)]/25 bg-[var(--warning)]/5 p-3 sm:flex-row sm:items-center sm:justify-between", nativeAndroid && 'hidden')}>
          <div className="flex-1">
            <p className="text-sm font-semibold text-[var(--text)]">Previously authorized BLE watch</p>
            <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
              Starts listening for real advertisement packets from previously authorized devices only. It cannot discover new devices, and support varies by browser/device.
            </p>
            {advertisementWatch.message && (
              <p role="status" className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">{advertisementWatch.message}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void handleToggleAdvertisementWatch()}
            disabled={isScanning}
            className={cn(
              'inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-md)] border px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              advertisementWatch.active
                ? 'border-[var(--danger)]/30 bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/15'
                : 'border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/15'
            )}
          >
            <Radar className={cn('h-4 w-4', advertisementWatch.active && 'animate-pulse')} />
            {advertisementWatch.active ? 'Stop BLE watch' : 'Watch permitted BLE devices'}
          </button>
        </div>

        <div className={cn("flex items-start gap-3 rounded-lg border border-[var(--warning)]/25 bg-[var(--warning)]/5 px-3 py-3", nativeAndroid && 'hidden')}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" />
          <p className="text-xs leading-5 text-[var(--text-secondary)]">
            <strong>Classic Bluetooth limitation:</strong> browser JavaScript cannot enumerate or scan classic Bluetooth devices, control Windows pairing, or perform full audio pairing. Use Windows Settings → Bluetooth &amp; devices for AirPods audio pairing. A native Windows/Android application is required for broader BLE and classic Bluetooth discovery. <strong>Generate simulated data</strong> creates sample records only.
          </p>
        </div>
        {nativeAndroid && (
          <div className="flex items-start gap-3 rounded-lg border border-[var(--accent)]/25 bg-[var(--accent)]/5 px-3 py-3">
            <Bluetooth className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
            <p className="text-xs leading-5 text-[var(--text-secondary)]">
              <strong>Android native BLE discovery:</strong> scans run only while the app is in the foreground and require Nearby Devices permission. Classic Bluetooth and combined scanning are planned for later phases. Normal AirPods audio pairing remains controlled by Android Settings.
            </p>
          </div>
        )}
      </section>

      {/* Scan state */}
      {state.scan.state !== 'idle' && (
        <div
          className={cn(
            'flex flex-col gap-3 rounded-[var(--radius-md)] border p-4 sm:flex-row sm:items-center sm:justify-between',
            state.scan.state === 'scanning' &&
              'border-[var(--accent)]/30 bg-[var(--accent-soft)]',
            state.scan.state === 'complete' &&
              'border-[var(--success)]/30 bg-[var(--success)]/10',
            (state.scan.state === 'unsupported' ||
              state.scan.state === 'permission-denied') &&
              'border-[var(--warning)]/30 bg-[var(--warning)]/10',
            state.scan.state === 'error' &&
              'border-[var(--danger)]/30 bg-[var(--danger)]/10'
          )}
        >
          <div className="flex items-center gap-3">
            {state.scan.state === 'scanning' && <LoadingSpinner size="sm" />}
            {state.scan.state === 'complete' && (
              <Bluetooth className="h-5 w-5 text-[var(--success)]" />
            )}
            {state.scan.state === 'unsupported' && (
              <Cpu className="h-5 w-5 text-[var(--warning)]" />
            )}
            {state.scan.state === 'permission-denied' && (
              <AlertTriangle className="h-5 w-5 text-[var(--warning)]" />
            )}
            {state.scan.state === 'error' && (
              <AlertTriangle className="h-5 w-5 text-[var(--danger)]" />
            )}

            <div>
              <p className="text-sm font-medium text-[var(--text)]">
                {state.scan.state === 'scanning' &&
                  (nativeAndroid
                    ? state.scan.transport === 'ANDROID_CLASSIC_SCAN'
                      ? `Discovering classic Bluetooth devices… ${(state.scan.elapsedMs / 1000).toFixed(1)}s`
                      : `Scanning nearby BLE advertisements… ${(state.scan.elapsedMs / 1000).toFixed(1)}s`
                    : `Opening Bluetooth chooser… ${(state.scan.elapsedMs / 1000).toFixed(1)}s`)}
                {state.scan.state === 'complete' &&
                  (state.scan.source === 'SIMULATED'
                    ? `Simulated sample data generated · ${state.scan.devicesFound} sample device(s) · no hardware scan performed`
                    : state.scan.transport === 'ANDROID_BLE_SCAN'
                      ? `Android BLE scan complete · ${state.scan.devicesFound} device(s) observed${state.scan.error ? ` · ${state.scan.error}` : ''}`
                      : state.scan.transport === 'ANDROID_CLASSIC_SCAN'
                        ? `Classic Bluetooth discovery complete · ${state.scan.devicesFound} device(s) found${state.scan.error ? ` · ${state.scan.error}` : ''}`
                        : state.scan.transport === 'ANDROID_PAIRED_DEVICES'
                          ? `Paired-device list loaded · ${state.scan.devicesFound} paired device(s)${state.scan.error ? ` · ${state.scan.error}` : ''}`
                          : state.scan.error
                        ? `Real device selected · ${state.scan.error}`
                        : `Real BLE selection complete · ${state.scan.devicesFound} device(s) selected`)}
                {state.scan.state === 'unsupported' &&
                  `Web Bluetooth not supported: ${state.scan.error}`}
                {state.scan.state === 'permission-denied' &&
                  (/cancel|abort|dismiss/i.test(state.scan.error ?? '')
                    ? 'Bluetooth device picker cancelled. No device was added. Use Generate simulated data to test without Bluetooth.'
                    : `Bluetooth permission denied: ${state.scan.error}`)}
                {state.scan.state === 'error' &&
                  `Scan failed: ${state.scan.error}`}
              </p>
            </div>
          </div>

          {state.scan.state === 'complete' && (
            <button
              onClick={() =>
                dispatch({
                  type: 'SET_SCAN_STATE',
                  payload: { state: 'idle' },
                })
              }
              className="text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text)]"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* Controls */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[0_8px_28px_rgba(0,0,0,0.12)] transition-all duration-200 hover:border-[var(--accent)]/25 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder="Search by device, manufacturer or type…"
              value={localSearch}
              onChange={e => setLocalSearch(e.target.value)}
              className="h-11 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] pl-10 pr-4 text-sm text-[var(--text)] outline-none transition-all duration-200 placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]/60 focus:ring-2 focus:ring-[var(--accent)]/15"
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
            </div>

            <select
              value={state.filter}
              onChange={e =>
                dispatch({
                  type: 'SET_FILTER',
                  payload: e.target.value as any,
                })
              }
              className="h-11 min-w-36 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-3 text-sm text-[var(--text)] outline-none transition-all duration-200 focus:border-[var(--accent)]/60 focus:ring-2 focus:ring-[var(--accent)]/15"
            >
              <option value="all">All devices</option>
              <option value="trusted">Trusted</option>
              <option value="unknown">Unknown</option>
              <option value="review">Needs review</option>
              <option value="high-risk">High risk</option>
              <option value="connected">Connected</option>
              <option value="nearby">Nearby</option>
            </select>

            <select
              value={state.sort}
              onChange={e =>
                dispatch({
                  type: 'SET_SORT',
                  payload: e.target.value as any,
                })
              }
              className="h-11 min-w-40 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-3 text-sm text-[var(--text)] outline-none transition-all duration-200 focus:border-[var(--accent)]/60 focus:ring-2 focus:ring-[var(--accent)]/15"
            >
              <option value="trust">Trust score ↓</option>
              <option value="signal">Signal strength ↓</option>
              <option value="lastSeen">Last seen ↓</option>
              <option value="risk">Risk level ↓</option>
            </select>
          </div>
        </div>
      </section>

      {/* Results and source isolation */}
      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--text)]">
              {filteredDevices.length} {sourceView === 'simulated' ? 'simulated ' : sourceView === 'real' ? 'real ' : ''}device{filteredDevices.length === 1 ? '' : 's'} shown
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              {realDeviceCount} real hardware record(s) · {simulatedDeviceCount} simulated sample record(s) in this session
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setSourceView('real')} aria-pressed={sourceView === 'real'} className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors', sourceView === 'real' ? 'border-[var(--accent)]/50 bg-[var(--accent)]/15 text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-raised)]')}>
              Real devices ({realDeviceCount})
            </button>
            <button type="button" onClick={() => setSourceView('simulated')} aria-pressed={sourceView === 'simulated'} className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors', sourceView === 'simulated' ? 'border-[var(--warning)]/50 bg-[var(--warning)]/10 text-[var(--warning)]' : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-raised)]')}>
              Simulated ({simulatedDeviceCount})
            </button>
            <button type="button" onClick={() => setSourceView('all')} aria-pressed={sourceView === 'all'} className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors', sourceView === 'all' ? 'border-[var(--accent)]/50 bg-[var(--accent)]/15 text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-raised)]')}>
              All records ({state.devices.length})
            </button>
            {simulatedDeviceCount > 0 && (
              <button type="button" onClick={handleClearSimulated} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-raised)]">
                <Database className="h-3.5 w-3.5" /> Clear simulated
              </button>
            )}
          </div>
        </div>
        {sourceView === 'simulated' && simulatedDeviceCount > 0 && (
          <p className="rounded-lg border border-[var(--warning)]/25 bg-[var(--warning)]/5 px-3 py-2 text-xs leading-5 text-[var(--text-secondary)]">
            These are generated examples, not nearby hardware. They are kept in memory only and are not saved as physical device observations.
          </p>
        )}
      </section>

      {filteredDevices.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredDevices.map(device => (
            <DeviceCard
              key={device.id}
              device={device}
              onClick={() => setSelectedDevice(device)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Bluetooth}
          title={
            sourceFilteredDevices.length === 0
              ? sourceView === 'simulated' ? 'No simulated records' : sourceView === 'real' ? 'No real hardware records yet' : 'No devices discovered'
              : 'No devices match the current filters'
          }
          description={
            sourceFilteredDevices.length === 0
              ? sourceView === 'simulated'
                ? 'Click Generate simulated data to create clearly labelled demo examples. They do not represent nearby hardware.'
                : sourceView === 'real'
                  ? nativeAndroid
                    ? 'Tap Scan nearby BLE devices to open the native results dialog. Only actively advertised BLE devices can appear; selecting a result opens its details.'
                    : 'Click Find all BLE devices and select a real peripheral in Chrome. The chooser returns one selected BLE device per click. Phones and AirPods may not expose a compatible BLE interface to websites.'
                  : 'Choose Find all BLE devices to select a compatible BLE peripheral, or generate simulated examples for UI testing.'
              : 'Adjust your search, filter, or source selection to see other records.'
          }
        />
      )}

      <NativeBleResultsModal
        open={nativeAndroid && nativeResultsOpen}
        scan={state.scan}
        devices={nativeScanDevices}
        onClose={() => setNativeResultsOpen(false)}
        onSelect={(device) => {
          setNativeResultsOpen(false);
          setSelectedDevice(device);
        }}
      />

      <NativeClassicResultsModal
        open={nativeAndroid && (classicResultsOpen || pairedResultsOpen)}
        view={pairedResultsOpen ? 'paired' : 'scan'}
        scan={state.scan}
        loadingPaired={pairedResultsOpen && pairedDevicesLoading}
        devices={pairedResultsOpen ? nativePairedDevices : nativeClassicDevices}
        onClose={() => {
          setClassicResultsOpen(false);
          setPairedResultsOpen(false);
        }}
        onSelect={(device) => {
          setClassicResultsOpen(false);
          setPairedResultsOpen(false);
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
