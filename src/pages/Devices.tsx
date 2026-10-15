import { useState, useMemo, useEffect } from 'react';
import {
  Bluetooth,
  Search,
  Cpu,
  AlertTriangle,
  SlidersHorizontal,
  Radar,
} from 'lucide-react';
import { DeviceCard } from '../components/DeviceCard';
import { DeviceDetailModal } from '../components/DeviceDetailModal';
import { EmptyState } from '../components/EmptyState';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useBluetoothDevices } from '../context/DeviceContext';
import { cn } from '../utils/cn';
import { needsManualApproval } from '../utils/connectionPolicy';

export function Devices() {
  const { state, dispatch, scanDevices } = useBluetoothDevices();
  const [selectedDevice, setSelectedDevice] =
    useState<null | import('../types').BluetoothDevice>(null);
  const [localSearch, setLocalSearch] = useState(state.search);

  useEffect(() => {
    dispatch({ type: 'SET_SEARCH', payload: localSearch });
  }, [localSearch, dispatch]);

  const filteredDevices = useMemo(() => {
    let arr = [...state.devices];

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
  }, [state.devices, localSearch, state.filter, state.sort]);

  const handleScan = async () => {
    await scanDevices();
  };

  const isScanning = state.scan.state === 'scanning';

  return (
    <div className="space-y-6">
      {/* Page header */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-accent">
            <Radar className="h-3.5 w-3.5" />
            Bluetooth intelligence
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)] sm:text-3xl">
            Devices
          </h1>

          <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
            Real mode opens the browser's Bluetooth picker for one supported device. Simulation mode creates demo records; this page does not passively scan every nearby device.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="flex min-h-10 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={state.simulationMode}
              disabled={isScanning}
              onChange={e =>
                dispatch({
                  type: 'TOGGLE_SIMULATION',
                  payload: e.target.checked,
                })
              }
              className="h-4 w-4 accent-[var(--accent)] disabled:opacity-50"
            />
            Simulation mode
          </label>

          <button
            onClick={handleScan}
            disabled={isScanning}
            className={cn(
              'inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] px-4 text-sm font-semibold transition-all',
              isScanning
                ? 'cursor-not-allowed bg-[var(--surface-raised)] text-[var(--text-muted)]'
                : 'bg-[var(--accent)] text-white shadow-[0_8px_24px_rgba(59,156,255,0.18)] hover:bg-[var(--accent-strong)] active:scale-[0.98]'
            )}
          >
            <Bluetooth className={cn('h-4 w-4', isScanning && 'animate-spin')} />
            {isScanning ? (state.simulationMode ? 'Preparing simulation…' : 'Waiting for device selection…') : state.simulationMode ? 'Run simulation scan' : 'Select Bluetooth device'}
          </button>
        </div>
      </header>

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
                {state.scan.state === 'scanning' && (state.simulationMode
                  ? `Preparing simulated devices… ${(state.scan.elapsedMs / 1000).toFixed(1)}s`
                  : `Waiting for the browser's Bluetooth picker… ${(state.scan.elapsedMs / 1000).toFixed(1)}s`)}
                {state.scan.state === 'complete' && `Workflow complete · ${state.scan.devicesFound} device(s) processed`}
                {state.scan.state === 'unsupported' &&
                  `Web Bluetooth not supported: ${state.scan.error}`}
                {state.scan.state === 'permission-denied' &&
                  `Permission denied: ${state.scan.error}`}
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
      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder="Search by device, manufacturer or type…"
              value={localSearch}
              onChange={e => setLocalSearch(e.target.value)}
              className="h-11 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] pl-10 pr-4 text-sm text-[var(--text)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]/60"
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
              className="h-11 min-w-36 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]/60"
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
              className="h-11 min-w-40 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]/60"
            >
              <option value="trust">Trust score ↓</option>
              <option value="signal">Signal strength ↓</option>
              <option value="lastSeen">Last seen ↓</option>
              <option value="risk">Risk level ↓</option>
            </select>
          </div>
        </div>
      </section>

      {/* Results */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-[var(--text)]">
            {filteredDevices.length} device
            {filteredDevices.length === 1 ? '' : 's'}
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            {state.devices.length} discovered in current session
          </p>
        </div>

        {state.simulationMode && (
          <span className="rounded-full border border-[var(--warning)]/25 bg-[var(--warning)]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--warning)]">
            Simulated data
          </span>
        )}
      </div>

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
            state.devices.length === 0
              ? 'No devices discovered'
              : 'No devices match the current filters'
          }
          description={
            state.devices.length === 0
              ? 'Start a Bluetooth scan or enable Simulation Mode to populate the device list.'
              : 'Adjust your search, filter or sort settings to see other devices.'
          }
        />
      )}

      <DeviceDetailModal
        device={selectedDevice}
        onClose={() => setSelectedDevice(null)}
      />
    </div>
  );
}
