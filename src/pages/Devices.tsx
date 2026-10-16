import { useState, useMemo, useEffect, type ReactNode } from 'react';
import {
  Bluetooth,
  Search,
  Cpu,
  AlertTriangle,
  SlidersHorizontal,
  Radar,
  ScanLine,
  ShieldCheck,
  CircleHelp,
  CheckCircle2,
} from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { DeviceCard } from '../components/DeviceCard';
import { DeviceDetailModal } from '../components/DeviceDetailModal';
import { EmptyState } from '../components/EmptyState';
import { useBluetoothDevices } from '../context/DeviceContext';
import { cn } from '../utils/cn';
import { needsManualApproval } from '../utils/connectionPolicy';

export function Devices() {
  const { state, dispatch, scanDevices } = useBluetoothDevices();
  const [selectedDevice, setSelectedDevice] =
    useState<null | import('../types').BluetoothDevice>(null);
  const [localSearch, setLocalSearch] = useState(state.search);
  const reduceMotion = useReducedMotion();

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
      {/* Discovery hero: one obvious scan action, supporting controls stay out of the way. */}
      <motion.section
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
        className="relative isolate overflow-hidden rounded-[28px] border border-white/[0.09] bg-[linear-gradient(135deg,rgba(24,42,65,0.98),rgba(11,17,28,0.96)_56%,rgba(13,26,43,0.98))] p-5 shadow-[0_24px_90px_rgba(0,0,0,0.2)] sm:p-7"
      >
        <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-20 h-64 w-64 rounded-full bg-[var(--accent)]/15 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute bottom-0 right-1/4 h-24 w-48 rounded-full bg-cyan-400/[0.07] blur-3xl" />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-center">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-sky-300/15 bg-sky-300/[0.07] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-200">
              <span className={cn("h-1.5 w-1.5 rounded-full bg-sky-300", isScanning && "animate-pulse")} />
              Nearby device intelligence
            </div>
            <h1 className="max-w-xl text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
              Your Bluetooth, <span className="bg-gradient-to-r from-sky-300 via-blue-400 to-cyan-200 bg-clip-text text-transparent">under your control.</span>
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">
              Discover devices, inspect their security signals, and decide which ones deserve your trust.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <motion.button
                type="button"
                onClick={handleScan}
                disabled={isScanning}
                whileHover={reduceMotion ? undefined : { y: -2, scale: 1.01 }}
                whileTap={reduceMotion ? undefined : { scale: 0.985 }}
                className={cn(
                  "group inline-flex min-h-12 items-center justify-center gap-2.5 rounded-2xl px-5 text-sm font-semibold text-white shadow-[0_10px_35px_rgba(42,145,255,0.24)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
                  isScanning ? "cursor-wait bg-slate-700" : "bg-gradient-to-r from-blue-500 via-blue-500 to-sky-400 hover:from-blue-400 hover:to-cyan-300"
                )}
              >
                <span className="relative flex h-5 w-5 items-center justify-center">
                  {isScanning ? <Radar className="h-5 w-5 animate-spin" /> : <ScanLine className="h-5 w-5 transition-transform duration-300 group-hover:rotate-12" />}
                  {isScanning && <span className="absolute inset-0 animate-ping rounded-full border border-white/60" />}
                </span>
                {isScanning ? 'Searching nearby…' : 'Find nearby devices'}
              </motion.button>
              <p className="flex items-center gap-2 text-xs text-slate-400">
                <ShieldCheck className="h-4 w-4 text-emerald-300" />
                No device is trusted automatically
              </p>
            </div>
          </div>
          <div className="relative mx-auto flex aspect-square w-full max-w-[220px] items-center justify-center lg:mx-0">
            <div className={cn("absolute inset-3 rounded-full border border-sky-300/15", isScanning && "animate-pulse")} />
            <div className={cn("absolute inset-7 rounded-full border border-sky-300/20", isScanning && "discovery-orbit")} />
            <div className={cn("absolute inset-12 rounded-full border border-blue-300/20", isScanning && "discovery-orbit discovery-orbit-delayed")} />
            <div className="absolute inset-5 rounded-full bg-sky-400/[0.06] blur-2xl" />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-[26px] border border-sky-200/20 bg-gradient-to-br from-sky-300/20 to-blue-500/10 shadow-[0_0_70px_rgba(56,189,248,0.16)]">
              <Bluetooth className="h-9 w-9 text-sky-200" strokeWidth={1.6} />
            </div>
            <span className="absolute right-3 top-8 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-slate-900/90 text-cyan-200 shadow-lg"><RadioIcon /></span>
            <span className="absolute bottom-8 left-3 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-slate-900/90 text-emerald-200 shadow-lg"><ShieldCheck className="h-4 w-4" /></span>
          </div>
        </div>
        <div className="relative mt-6 grid grid-cols-3 gap-2 border-t border-white/[0.08] pt-5 sm:gap-4">
          <QuickStat label="Discovered" value={state.devices.length} icon={<Bluetooth className="h-4 w-4" />} />
          <QuickStat label="Trusted" value={state.devices.filter((device) => device.trusted && !device.blocked).length} icon={<CheckCircle2 className="h-4 w-4" />} />
          <QuickStat label="Needs review" value={state.devices.filter((device) => !device.blocked && needsManualApproval(device)).length} icon={<CircleHelp className="h-4 w-4" />} />
        </div>
      </motion.section>

      <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-white">Your devices</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Select a device to explore its details and security status.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)]/80 px-3 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)]">
            <input
              type="checkbox"
              checked={state.simulationMode}
              onChange={e => dispatch({ type: 'TOGGLE_SIMULATION', payload: e.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            Demo data
          </label>
          {state.simulationMode && <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-amber-300">Simulated</span>}
        </div>
      </section>

      <AnimatePresence initial={false}>
        {state.scan.state !== 'idle' && (
          <motion.section
            initial={reduceMotion ? false : { opacity: 0, y: 8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -6, height: 0 }}
            className={cn(
              "overflow-hidden rounded-2xl border p-4",
              state.scan.state === 'scanning' && "border-sky-300/20 bg-sky-300/[0.06]",
              state.scan.state === 'complete' && "border-emerald-300/20 bg-emerald-300/[0.06]",
              (state.scan.state === 'unsupported' || state.scan.state === 'permission-denied') && "border-amber-300/20 bg-amber-300/[0.06]",
              state.scan.state === 'error' && "border-rose-300/20 bg-rose-300/[0.06]"
            )}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/15">
                {state.scan.state === 'scanning' && <Radar className="h-4 w-4 animate-spin text-sky-200" />}
                {state.scan.state === 'complete' && <CheckCircle2 className="h-4 w-4 text-emerald-200" />}
                {(state.scan.state === 'unsupported' || state.scan.state === 'permission-denied') && <CircleHelp className="h-4 w-4 text-amber-200" />}
                {state.scan.state === 'error' && <AlertTriangle className="h-4 w-4 text-rose-200" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">
                  {state.scan.state === 'scanning' && 'Looking for nearby devices'}
                  {state.scan.state === 'complete' && `Search complete · ${state.scan.devicesFound} device(s) found`}
                  {state.scan.state === 'unsupported' && 'This browser cannot scan Bluetooth'}
                  {state.scan.state === 'permission-denied' && 'Bluetooth permission was not granted'}
                  {state.scan.state === 'error' && 'The scan could not be completed'}
                </p>
                <p className="mt-1 break-words text-xs leading-5 text-[var(--text-secondary)]">
                  {state.scan.state === 'scanning' && `Keep this screen open while discovery runs · ${(state.scan.elapsedMs / 1000).toFixed(1)}s`}
                  {(state.scan.state === 'unsupported' || state.scan.state === 'permission-denied' || state.scan.state === 'error') && state.scan.error}
                  {state.scan.state === 'complete' && (state.scan.devicesFound > 0 ? 'Choose any device below to review its details and security signals.' : 'No devices were returned. Try again or check Bluetooth permissions and device visibility.')}
                </p>
              </div>
              <button type="button" onClick={() => dispatch({ type: 'SET_SCAN_STATE', payload: { state: 'idle' } })} aria-label="Dismiss scan status" className="rounded-lg p-1.5 text-[var(--text-muted)] transition hover:bg-white/[0.06] hover:text-white">
                <span aria-hidden="true">×</span>
              </button>
            </div>
            {state.scan.state === 'scanning' && <div className="mt-4 h-1 overflow-hidden rounded-full bg-slate-700/60"><div className="discovery-progress h-full w-2/5 rounded-full bg-gradient-to-r from-sky-400 to-blue-400" /></div>}
          </motion.section>
        )}
      </AnimatePresence>

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
        <motion.div
          layout
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          <AnimatePresence mode="popLayout">
            {filteredDevices.map((device, index) => (
              <motion.div
                key={device.id}
                layout
                initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduceMotion ? undefined : { opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.28, delay: reduceMotion ? 0 : Math.min(index * 0.035, 0.2) }}
              >
                <DeviceCard device={device} onClick={() => setSelectedDevice(device)} />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
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


function QuickStat({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/[0.07] bg-black/10 p-3 sm:gap-3 sm:px-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-sky-200">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xl font-semibold tracking-tight text-white tabular-nums">{value}</span>
        <span className="block truncate text-[10px] font-medium uppercase tracking-wider text-slate-400 sm:text-[11px]">{label}</span>
      </span>
    </div>
  );
}

function RadioIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="12" r="2.2" />
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.8 4.8a10.2 10.2 0 0 0 0 14.4M19.2 4.8a10.2 10.2 0 0 1 0 14.4" strokeLinecap="round" />
    </svg>
  );
}
