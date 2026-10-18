import { useState } from 'react';
import { Bluetooth, LoaderCircle, Settings } from 'lucide-react';
import { myDevices, type ConnectOutcome } from '../services/myDevices';

interface NativeConnectPanelProps {
  address: string;
  paired: boolean;
  connected: boolean;
  onDone?: () => void;
}

/** Pair or connect a device from the app; falls back to Android Bluetooth settings in one tap. */
export function NativeConnectPanel({ address, paired, connected, onDone }: NativeConnectPanelProps) {
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
  const showSettings = outcome?.result === 'settings' || outcome?.result === 'requested' || Boolean(error);

  return (
    <div className="mb-4 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-[var(--text)]">
        <Bluetooth className="h-4 w-4 text-[var(--accent)]" />
        {isConnected ? 'Connected to this phone' : paired ? 'Paired, not connected' : 'Not paired with this phone'}
      </p>
      {!isConnected && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run()}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
          {busy ? 'Working…' : paired ? 'Connect' : 'Pair & connect'}
        </button>
      )}
      {outcome && <p role="status" className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">{outcome.message}</p>}
      {error && <p role="alert" className="mt-2 text-xs leading-5 text-[var(--danger)]">{error}</p>}
      {showSettings && (
        <button
          type="button"
          onClick={() => void myDevices.openBluetoothSettings().catch(() => undefined)}
          className="mt-2 inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)]"
        >
          <Settings className="h-3.5 w-3.5" /> Open Bluetooth settings
        </button>
      )}
    </div>
  );
}
