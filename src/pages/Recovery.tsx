import { useState } from 'react';
import { Bluetooth, LockKeyhole, MapPin, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, type RecoveryDeviceRecord, type RecoveryEncounterRecord, type RecoveryInfoRecord } from '../services/api';
import { requestBluetoothDevice, type BluetoothDeviceInfo } from '../services/bluetoothService';
import { recordWorkflowEvent } from '../services/workflowEventService';

const recoveryTransitions: Record<RecoveryDeviceRecord['recoveryState'], Array<{ status: RecoveryDeviceRecord['recoveryState']; label: string }>> = {
  lost: [
    { status: 'searching', label: 'Start searching' },
    { status: 'found', label: 'Mark found' },
    { status: 'recovered', label: 'Mark recovered' },
  ],
  searching: [
    { status: 'found', label: 'Mark found' },
    { status: 'recovered', label: 'Mark recovered' },
    { status: 'lost', label: 'Pause search / mark lost' },
  ],
  found: [
    { status: 'recovered', label: 'Mark recovered' },
    { status: 'searching', label: 'Resume searching' },
    { status: 'lost', label: 'Mark lost again' },
  ],
  recovered: [{ status: 'lost', label: 'Reopen as lost' }],
};

function formatDate(value?: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString();
}

export function Recovery() {
  const [ownerToken, setOwnerToken] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [selectedBluetoothDevice, setSelectedBluetoothDevice] = useState<BluetoothDeviceInfo | null>(null);
  const [devices, setDevices] = useState<RecoveryDeviceRecord[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<RecoveryDeviceRecord | null>(null);
  const [recoveryInfo, setRecoveryInfo] = useState<RecoveryInfoRecord | null>(null);
  const [encounters, setEncounters] = useState<RecoveryEncounterRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const requireToken = () => {
    if (!ownerToken.trim()) {
      setError('Enter the owner bearer token configured on the backend.');
      return false;
    }
    return true;
  };

  const loadDevices = async () => {
    if (!requireToken()) return;
    const token = ownerToken.trim();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const loadedDevices = await api.recovery.listDevices(token);
      setDevices(loadedDevices);
      setDevicesLoaded(true);
      if (selectedDevice) {
        const refreshedSelection = loadedDevices.find(device => device.deviceId === selectedDevice.deviceId);
        if (refreshedSelection) {
          setSelectedDevice(refreshedSelection);
        } else {
          setSelectedDevice(null);
          setRecoveryInfo(null);
          setEncounters([]);
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load the owner device list.');
    } finally {
      setBusy(false);
    }
  };

  const selectBluetoothDevice = async () => {
    setError(null);
    setNotice(null);
    const result = await requestBluetoothDevice();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSelectedBluetoothDevice(result.device);
    setDeviceName(result.device.name ?? '');
    setNotice(`Selected ${result.device.name ?? 'Bluetooth device'} in the browser picker. This does not provide a location or background scan.`);
  };

  const registerDevice = async () => {
    if (!requireToken()) return;
    const token = ownerToken.trim();
    if (!selectedBluetoothDevice) {
      setError('Select a real device with the browser Bluetooth picker before registering it.');
      return;
    }

    const name = deviceName.trim() || selectedBluetoothDevice.name?.trim();
    if (!name) {
      setError('Enter a name for this device.');
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const registered = await api.recovery.registerDevice(token, {
        deviceId: selectedBluetoothDevice.id,
        deviceIdentifier: selectedBluetoothDevice.id,
        deviceName: name,
        type: 'unknown',
        discoverySource: 'REAL',
        recoveryState: 'lost',
      });
      setSelectedDevice(registered);
      setDevices(current => [registered, ...current.filter(item => item.deviceId !== registered.deviceId)]);
      setDevicesLoaded(true);
      setSelectedBluetoothDevice(null);
      setRecoveryInfo(null);
      setEncounters([]);
      setNotice('Device registration was saved by the backend. Its browser-scoped identifier is not a universal hardware identity.');
      recordWorkflowEvent({ type: 'recovery', message: `Registered ${name} in the cloud-backed owner recovery workflow as lost.`, severity: 'info', simulated: false, deviceId: registered.deviceId });
      try {
        await loadRecoveryInfo(registered, token);
      } catch (refreshError) {
        setError(`Registration succeeded, but its recovery details could not be loaded: ${errorMessage(refreshError)}`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to register the device.');
    } finally {
      setBusy(false);
    }
  };

  const loadRecoveryInfo = async (device: RecoveryDeviceRecord, token = ownerToken.trim()) => {
    const [info, reports] = await Promise.all([
      api.recovery.getRecoveryInfo(token, device.deviceId),
      api.recovery.listEncounters(token, device.deviceId),
    ]);
    setSelectedDevice(device);
    setRecoveryInfo(info);
    setEncounters(reports);
  };

  const refreshRecoveryInfo = async (device = selectedDevice) => {
    if (!requireToken() || !device) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await loadRecoveryInfo(device);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to refresh recovery information.');
    } finally {
      setBusy(false);
    }
  };

  const updateState = async (status: RecoveryDeviceRecord['recoveryState']) => {
    if (!requireToken() || !selectedDevice) return;
    const token = ownerToken.trim();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.recovery.updateState(token, selectedDevice.deviceId, status);
      setSelectedDevice(updated);
      setDevices(current => current.map(item => item.deviceId === updated.deviceId ? updated : item));
      setRecoveryInfo(current => current ? { ...current, recoveryState: updated.recoveryState } : null);
      setNotice(`Recovery state saved as ${status}.`);
      recordWorkflowEvent({ type: 'recovery', message: `Recovery case ${updated.name} changed to ${status} in the backend.`, severity: status === 'recovered' ? 'info' : status === 'lost' ? 'warning' : 'info', simulated: false, deviceId: updated.deviceId });
      try {
        await loadRecoveryInfo(updated, token);
      } catch (refreshError) {
        setError(`Recovery state was saved, but details could not be refreshed: ${errorMessage(refreshError)}`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update the recovery state.');
    } finally {
      setBusy(false);
    }
  };

  const submitPresenceObservation = async () => {
    if (!requireToken() || !selectedDevice) return;
    const token = ownerToken.trim();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await requestBluetoothDevice();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.device.id !== selectedDevice.deviceIdentifier) {
        setError('The selected browser device identifier does not match this registration. No encounter was submitted.');
        return;
      }

      await api.recovery.submitEncounter(token, selectedDevice.deviceId, {
        source: 'REAL',
        simulated: false,
        isTestFixture: false,
        description: 'Device selected by its owner in the Web Bluetooth picker.',
      });
      setNotice('The backend accepted the manual owner-side observation and recorded its receive time. No coordinates or signal measurements were available or submitted; this is not a community sighting.');
      recordWorkflowEvent({ type: 'recovery', message: `Owner manually selected ${selectedDevice.name} in the Web Bluetooth picker. This is not a community sighting.`, severity: 'info', simulated: false, deviceId: selectedDevice.deviceId });
      try {
        await loadRecoveryInfo(selectedDevice, token);
      } catch (refreshError) {
        setError(`The encounter was accepted, but recovery details could not be refreshed: ${errorMessage(refreshError)}`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to submit this observation.');
    } finally {
      setBusy(false);
    }
  };

  const errorMessage = (caught: unknown) =>
    caught instanceof Error ? caught.message : 'The backend request failed.';

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
          <Bluetooth className="h-3.5 w-3.5" />
          Owner recovery
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)] sm:text-3xl">Device Recovery</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
          Register and manage recovery cases through the authenticated backend. Web Bluetooth requires a user gesture and does not provide continuous community scanning.
        </p>
      </header>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="mb-4 flex items-center gap-2">
          <LockKeyhole className="h-4 w-4 text-[var(--accent)]" />
          <h2 className="text-sm font-semibold text-[var(--text)]">Backend owner access</h2>
        </div>
        <label className="block text-sm text-[var(--text-secondary)]">
          Owner bearer token
          <input
            type="password"
            autoComplete="off"
            value={ownerToken}
            disabled={busy}
            onChange={event => {
              setOwnerToken(event.target.value);
              setDevices([]);
              setDevicesLoaded(false);
              setSelectedDevice(null);
              setRecoveryInfo(null);
              setEncounters([]);
              setError(null);
              setNotice(null);
            }}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            aria-describedby="recovery-auth-note"
          />
        </label>
        <p id="recovery-auth-note" className="mt-2 text-xs text-[var(--text-muted)]">
          The token is held only in this page's memory and is never written to browser storage. The current backend token is a development integration, not production identity management.
        </p>
        <button
          type="button"
          onClick={loadDevices}
          disabled={busy}
          className="mt-4 min-h-10 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-slate-950 disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Load my registered devices'}
        </button>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-lg font-semibold text-[var(--text)]">Register a Bluetooth device</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            The browser returns an origin-scoped identifier and device name when available. It does not expose a universal hardware ID, RSSI, or location.
          </p>
          <button
            type="button"
            onClick={selectBluetoothDevice}
            disabled={busy}
            className="mt-4 min-h-10 rounded-lg border border-[var(--border)] px-4 text-sm font-semibold text-[var(--text)] disabled:opacity-50"
          >
            Select real device
          </button>
          {selectedBluetoothDevice && (
            <div className="mt-4 space-y-3">
              <p className="break-all text-xs text-[var(--text-muted)]">
                Selected: {selectedBluetoothDevice.name ?? 'Unnamed Bluetooth device'} · {selectedBluetoothDevice.id}
              </p>
              <label className="block text-sm text-[var(--text-secondary)]">
                Display name
                <input
                  value={deviceName}
                  onChange={event => setDeviceName(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
              </label>
              <button
                type="button"
                onClick={registerDevice}
                disabled={busy || !ownerToken.trim()}
                className="min-h-10 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-slate-950 disabled:opacity-50"
              >
                Register as lost
              </button>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[var(--text)]">My recovery cases</h2>
            <button
              type="button"
              onClick={loadDevices}
              disabled={busy || !ownerToken.trim()}
              aria-label="Refresh registered devices"
              className="rounded-lg border border-[var(--border)] p-2 text-[var(--text-secondary)] disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          {devices.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--text-muted)]">
              {devicesLoaded
                ? 'No registered devices were found for this owner.'
                : 'No devices loaded. Authenticate with the backend to view owner-authorized records.'}
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {devices.map(device => (
                <li key={device.deviceId}>
                  <button
                    type="button"
                    onClick={() => void refreshRecoveryInfo(device)}
                    className={`w-full rounded-lg border p-3 text-left ${selectedDevice?.deviceId === device.deviceId ? 'border-[var(--accent)]' : 'border-[var(--border)]'}`}
                  >
                    <span className="block text-sm font-medium text-[var(--text)]">{device.name}</span>
                    <span className="mt-1 block text-xs text-[var(--text-muted)]">{device.recoveryState} · {device.discoverySource}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {selectedDevice && recoveryInfo && (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5" aria-live="polite">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-[var(--accent)]" />
                <h2 className="text-lg font-semibold text-[var(--text)]">{recoveryInfo.deviceName}</h2>
              </div>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                State: <strong>{recoveryInfo.recoveryState}</strong> · {recoveryInfo.encounterCount} encounter(s)
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Registered {formatDate(recoveryInfo.registeredAt)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => void refreshRecoveryInfo()} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] disabled:opacity-50">Refresh sightings</button>
              <button type="button" disabled={busy} onClick={submitPresenceObservation} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] disabled:opacity-50">Verify present with Bluetooth</button>
              {recoveryTransitions[recoveryInfo.recoveryState].map(transition => (
                <button
                  key={transition.status}
                  type="button"
                  disabled={busy}
                  onClick={() => void updateState(transition.status)}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${transition.status === 'recovered' ? 'border-[var(--success)] bg-[var(--success)] text-slate-950' : 'border-[var(--border)] text-[var(--text)]'}`}
                >
                  {transition.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              <MapPin className="h-3.5 w-3.5" />
              Last observation
            </div>
            {recoveryInfo.lastObservationAt ? (
              <p className="mt-2 text-sm text-[var(--text)]">
                {formatDate(recoveryInfo.lastObservationAt)}
                {recoveryInfo.simulated ? ' · SIMULATED' : ' · REAL browser selection'}
              </p>
            ) : (
              <p className="mt-2 text-sm text-[var(--text-muted)]">No encounter recorded. No location has been inferred.</p>
            )}
          </div>

          <div className="mt-5">
            <h3 className="text-sm font-semibold text-[var(--text)]">Encounter history</h3>
            {encounters.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--text-muted)]">No sightings are available for this device.</p>
            ) : (
              <ul className="mt-2 divide-y divide-[var(--border)]">
                {encounters.map(encounter => (
                  <li key={encounter._id} className="py-3">
                    <p className="text-sm text-[var(--text)]">
                      {formatDate(encounter.observedAt)} · {encounter.source}
                      {encounter.simulated || encounter.isTestFixture ? ' · SIMULATED TEST DATA' : ''}
                    </p>
                    {encounter.location && (
                      <p className="mt-1 text-xs text-[var(--text-muted)]">
                        {encounter.location.address ?? `${encounter.location.lat}, ${encounter.location.lng}`}
                      </p>
                    )}
                    {encounter.description && <p className="mt-1 text-xs text-[var(--text-secondary)]">{encounter.description}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {error && <p role="alert" className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-3 text-sm text-[var(--danger)]">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-[var(--success)]/30 bg-[var(--success)]/10 p-3 text-sm text-[var(--success)]">{notice}</p>}
    </div>
  );
}
