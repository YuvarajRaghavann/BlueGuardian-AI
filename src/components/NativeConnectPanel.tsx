import { useState } from 'react';
import { Bluetooth, LoaderCircle, Settings, ShieldAlert } from 'lucide-react';
import { VERDICT_STYLE, type GuardianResult } from '../intel/guardian';
import { myDevices, type ConnectOutcome } from '../services/myDevices';

interface NativeConnectPanelProps {
  address: string;
  paired: boolean;
  connected: boolean;
  onDone?: () => void;
  /** Pre-connection verdict; Caution and Unsafe devices need an explicit second tap. */
  guardian?: GuardianResult | null;
}

/** Pair or connect a device from the app; falls back to Android Bluetooth settings in one tap. */
export function NativeConnectPanel({ address, paired, connected, onDone, guardian }: NativeConnectPanelProps) {
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ConnectOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const result = await myDevices.connect({ address });
      setOutcome(result);
      onDone?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not connect.');
    } finally {
      setBusy(false);
    }
  };

  const isConnected = connected || outcome?.result === 'connected';
  const isPaired = paired || outcome?.result === 'paired' || outcome?.result === 'requested' || isConnected;
  const risky = !isPaired && guardian && (guardian.verdict === 'unsafe' || guardian.verdict === 'caution');
  const gate = risky && !override && !isConnected;
  const showSettings = outcome?.result === 'settings' || outcome?.result === 'requested' || Boolean(error);

  return (
    <div className="rounded-3xl bg-[var(--surface)] p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
        <Bluetooth className="h-4 w-4 text-[var(--accent)]" />
        {isConnected ? 'Connected to this phone' : isPaired ? 'Paired, not connected' : 'Not paired with this phone'}
      </p>
      {gate && guardian && (
        <div className="mt-3 rounded-lg p-3" style={{ background: `color-mix(in srgb, ${VERDICT_STYLE[guardian.verdict].color} 14%, transparent)` }}>
          <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: VERDICT_STYLE[guardian.verdict].color }}>
            <ShieldAlert className="h-4 w-4" /> {guardian.verdict === 'unsafe' ? 'Not recommended' : 'Be careful'}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{guardian.summary}. Only connect if this is your device.</p>
          <button type="button" onClick={() => setOverride(true)}
            className="mt-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)]">
            Connect anyway
          </button>
        </div>
      )}
      {!isConnected && !gate && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run()}
          className="tap mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
          {busy ? (isPaired ? 'Connecting…' : 'Accept the pairing request…') : isPaired ? 'Connect' : 'Pair and connect'}
        </button>
      )}
      {outcome && <p role="status" className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">{outcome.message}</p>}
      {error && <p role="alert" className="mt-2 text-xs leading-5 text-[var(--danger)]">{error}</p>}
      {showSettings && (
        <button
          type="button"
          onClick={() => void myDevices.openBluetoothSettings().catch(() => undefined)}
          className="tap mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--surface-raised)] px-4 text-sm font-semibold text-[var(--text)]"
        >
          <Settings className="h-3.5 w-3.5" /> Open Bluetooth settings
        </button>
      )}
    </div>
  );
}
