import { useState } from 'react';
import { Bluetooth, LockKeyhole, MapPin, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, type RecoveryDeviceRecord, type RecoveryEncounterRecord, type RecoveryInfoRecord } from '../services/api';
import { setOwnerToken as setActiveOwnerToken } from '../services/ownerSession';
import { requestBluetoothDevice, type BluetoothDeviceInfo } from '../services/bluetoothService';
import { createFirebaseAccount, getFreshFirebaseIdToken, signInWithEmailPassword, signOutFirebase } from '../services/firebaseAuth';

function formatDate(value?: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString();
}

export function Recovery() {
  const [ownerToken, setOwnerToken] = useState(''); // Current Firebase ID token, never rendered in the UI.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firebaseSignedInEmail, setFirebaseSignedInEmail] = useState<string | null>(null);
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
      setError('Sign in to BlueGuardian with your Firebase email and password first.');
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
      const freshToken = await getFreshFirebaseIdToken() ?? token;
      const loadedDevices = await api.recovery.listDevices(freshToken);
      // Only publish the credential to the rest of the app after a protected
      // owner request succeeds. The session helper holds it in memory only.
      setOwnerToken(freshToken);
      setActiveOwnerToken(freshToken);
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

  const authenticateWithFirebase = async (mode: 'sign-in' | 'sign-up') => {
    if (!email.trim() || !password) {
      setError('Enter your email address and password.');
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    setActiveOwnerToken(null);
    try {
      const session = mode === 'sign-in'
        ? await signInWithEmailPassword(email, password)
        : await createFirebaseAccount(email, password);

      setOwnerToken(session.idToken);
      setFirebaseSignedInEmail(session.email);
      setPassword('');

      try {
        const freshToken = await getFreshFirebaseIdToken() ?? session.idToken;
        const loadedDevices = await api.recovery.listDevices(freshToken);
        setOwnerToken(freshToken);
        setActiveOwnerToken(freshToken);
        setDevices(loadedDevices);
        setDevicesLoaded(true);
        setSelectedDevice(null);
        setRecoveryInfo(null);
        setEncounters([]);
        setNotice(`Signed in as ${session.email}. Your owner-authorized recovery records loaded successfully.`);
      } catch (caught) {
        setError(`Firebase sign-in succeeded, but the backend request failed: ${errorMessage(caught)}`);
        setNotice('Firebase accepted your account sign-in. The Render backend must also be deployed with Firebase token verification enabled.');
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleFirebaseSignOut = () => {
    signOutFirebase();
    setActiveOwnerToken(null);
    setOwnerToken('');
    setFirebaseSignedInEmail(null);
    setPassword('');
    setDevices([]);
    setDevicesLoaded(false);
    setSelectedDevice(null);
    setRecoveryInfo(null);
    setEncounters([]);
    setError(null);
    setNotice('You have signed out of BlueGuardian.');
  };

  const selectBluetoothDevice = async () => {
    setError(null);
    setNotice(null);
    const result = await requestBluetoothDevice();
    if (result.ok === false) {
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
      if (result.ok === false) {
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
      setNotice('The backend accepted the encounter and recorded its receive time. No coordinates or signal measurements were available or submitted.');
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
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-[var(--text-secondary)]">
            Email address
            <input
              type="email"
              autoComplete="email"
              value={email}
              disabled={busy}
              onChange={event => setEmail(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="block text-sm text-[var(--text-secondary)]">
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={busy}
              onChange={event => setPassword(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') void authenticateWithFirebase('sign-in');
              }}
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void authenticateWithFirebase('sign-in')}
            disabled={busy}
            className="min-h-10 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-slate-950 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Sign in'}
          </button>
          <button
            type="button"
            onClick={() => void authenticateWithFirebase('sign-up')}
            disabled={busy}
            className="min-h-10 rounded-lg border border-[var(--border)] px-4 text-sm font-semibold text-[var(--text)] disabled:opacity-50"
          >
            Create account
          </button>
          {firebaseSignedInEmail && (
            <button
              type="button"
              onClick={handleFirebaseSignOut}
              disabled={busy}
              className="min-h-10 rounded-lg border border-[var(--border)] px-4 text-sm font-semibold text-[var(--text)] disabled:opacity-50"
            >
              Sign out
            </button>
          )}
        </div>
        <p id="recovery-auth-note" className="mt-3 text-xs text-[var(--text-muted)]">
          BlueGuardian uses Firebase email/password authentication. ID tokens are verified by the backend and scoped to your Firebase user ID. Credentials and refresh tokens are held in application memory only, not browser storage. Reloading the app requires you to sign in again.
        </p>
        {firebaseSignedInEmail && (
          <p className="mt-2 text-xs text-[var(--text-muted)]">Firebase account: {firebaseSignedInEmail}</p>
        )}
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
              {recoveryInfo.recoveryState !== 'lost' && (
                <button type="button" disabled={busy} onClick={() => updateState('lost')} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] disabled:opacity-50">Mark lost</button>
              )}
              {recoveryInfo.recoveryState !== 'recovered' && (
                <button type="button" disabled={busy} onClick={() => updateState('recovered')} className="rounded-lg bg-[var(--success)] px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50">Mark recovered</button>
              )}
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
