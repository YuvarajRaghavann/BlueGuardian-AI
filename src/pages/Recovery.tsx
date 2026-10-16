import { useState } from 'react';
import { Bluetooth, LockKeyhole, MapPin, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, type RecoveryDeviceRecord, type RecoveryEncounterRecord, type RecoveryInfoRecord } from '../services/api';
import { setOwnerToken as setActiveOwnerToken } from '../services/ownerSession';
import { requestBluetoothDevice, type BluetoothDeviceInfo } from '../services/bluetoothService';
import { createFirebaseAccount, getFreshFirebaseIdToken, sendFirebasePasswordResetEmail, signInWithEmailPassword, signOutFirebase } from '../services/firebaseAuth';
import { isNativeAndroidApp, listNativeAndroidPairedDevices, scanNativeAndroidBle, scanNativeAndroidClassic } from '../services/nativeBluetoothService';

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
  const [availableNativeDevices, setAvailableNativeDevices] = useState<BluetoothDeviceInfo[]>([]);
  const [devices, setDevices] = useState<RecoveryDeviceRecord[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<RecoveryDeviceRecord | null>(null);
  const [recoveryInfo, setRecoveryInfo] = useState<RecoveryInfoRecord | null>(null);
  const [encounters, setEncounters] = useState<RecoveryEncounterRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [shareLocation, setShareLocation] = useState(false);
  const [communityShareLocation, setCommunityShareLocation] = useState(false);
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

  const handleFirebasePasswordReset = async () => {
    if (!email.trim()) {
      setError('Enter your email address first, then tap Forgot password.');
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const targetEmail = await sendFirebasePasswordResetEmail(email);
      setNotice(`If a BlueGuardian Firebase account exists for ${targetEmail}, a password-reset email has been requested. Check Inbox and Spam, follow the link, then return here and sign in with the new password.`);
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
    setSelectedBluetoothDevice(null);
    setAvailableNativeDevices([]);

    if (isNativeAndroidApp()) {
      setBusy(true);
      try {
        const records = new Map<string, BluetoothDeviceInfo>();
        const addRecord = (record: BluetoothDeviceInfo) => {
          const id = String(record.address || record.id || '').trim();
          if (!id) return;
          const key = id.toLowerCase();
          const existing = records.get(key);
          records.set(key, {
            ...existing,
            ...record,
            id,
            address: id,
            name: record.name?.trim() || existing?.name,
            rssi: typeof record.rssi === 'number' ? record.rssi : existing?.rssi,
            uuids: record.uuids ?? existing?.uuids ?? [],
            source: 'native',
            paired: Boolean(record.paired || existing?.paired),
            transport: record.transport ?? existing?.transport ?? 'BLE',
          });
        };

        let pairedListError: string | undefined;
        try {
          const paired = await listNativeAndroidPairedDevices();
          for (const device of paired) {
            addRecord({
              id: device.address || device.id,
              address: device.address || device.id,
              name: device.name,
              rssi: device.rssi,
              uuids: [],
              source: 'native',
              transport: 'PAIRED',
              paired: true,
            });
          }
        } catch (caught) {
          pairedListError = errorMessage(caught);
        }

        const scan = await scanNativeAndroidBle((observation) => {
          const id = String(observation.address || observation.id || '').trim();
          if (!id) return;
          addRecord({
            id,
            address: id,
            name: observation.name,
            rssi: observation.rssi,
            uuids: observation.serviceUuids ?? [],
            source: 'native',
            transport: 'BLE',
            paired: records.get(id.toLowerCase())?.paired ?? false,
          });
        }, 8000);

        const available = Array.from(records.values()).sort((a, b) => {
          if (Boolean(a.paired) !== Boolean(b.paired)) return a.paired ? -1 : 1;
          if (typeof a.name === 'string' && typeof b.name === 'string') return a.name.localeCompare(b.name);
          return a.id.localeCompare(b.id);
        });
        setAvailableNativeDevices(available);

        if (available.length === 0) {
          const details = [scan.ok ? scan.message : scan.error, pairedListError].filter(Boolean).join(' ');
          setError(details || 'No Bluetooth devices were found. Keep the target nearby and advertising, and check Android Bluetooth permissions.');
        } else {
          const scanSummary = scan.ok
            ? `BLE scan completed with ${scan.devicesFound} advertisement source(s).`
            : `BLE scan could not complete: ${scan.error}`;
          setNotice(`Found ${available.length} available or paired Bluetooth device(s). Choose one below. ${scanSummary} ${pairedListError ? 'The paired-device list was unavailable.' : ''}`);
        }
      } catch (caught) {
        setError(`Native Android Bluetooth selection failed: ${errorMessage(caught)}`);
      } finally {
        setBusy(false);
      }
      return;
    }

    const result = await requestBluetoothDevice();
    if (result.ok === false) {
      setError(result.error);
      return;
    }
    setSelectedBluetoothDevice({ ...result.device, source: 'web', transport: 'WEB' });
    setDeviceName(result.device.name ?? '');
    setNotice(`Selected ${result.device.name ?? 'Bluetooth device'} in the browser picker. Browser IDs are origin-scoped and do not provide location or background scan access.`);
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
      const identifier = selectedBluetoothDevice.address || selectedBluetoothDevice.id;
      const registered = await api.recovery.registerDevice(token, {
        deviceId: identifier,
        deviceIdentifier: identifier,
        deviceName: name,
        type: 'unknown',
        discoverySource: 'REAL',
        recoveryState: 'lost',
        ...(selectedBluetoothDevice.name && (selectedBluetoothDevice.uuids?.length ?? 0) > 0
          ? { recoveryFingerprint: { name: selectedBluetoothDevice.name, serviceUuids: selectedBluetoothDevice.uuids } }
          : {}),
      });
      setSelectedDevice(registered);
      setDevices(current => [registered, ...current.filter(item => item.deviceId !== registered.deviceId)]);
      setDevicesLoaded(true);
      setSelectedBluetoothDevice(null);
      setRecoveryInfo(null);
      setEncounters([]);
      const fingerprintReady = Boolean(selectedBluetoothDevice.name && (selectedBluetoothDevice.uuids?.length ?? 0) > 0);
      setNotice(`${selectedBluetoothDevice.source === 'native'
        ? 'Device registration was saved by the backend using the Android-reported Bluetooth address. Addresses may be randomized and are not guaranteed to be a universal hardware identity.'
        : 'Device registration was saved by the backend using a browser-scoped identifier, which is not a universal hardware identity.'} ${fingerprintReady
          ? 'A name + BLE service fingerprint was registered for privacy-preserving community candidate matching; it is not a unique hardware identity, so sightings remain unverified leads.'
          : 'Community matching is not enabled for this device because its advertisement did not expose both a name and service UUIDs.'}`);
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
      const registeredIdentifier = selectedDevice.deviceIdentifier.trim().toLowerCase();
      let observedIdentifier: string | null = null;
      let observationDescription = 'Device selected by the owner in the Web Bluetooth picker.';

      if (isNativeAndroidApp()) {
        const observed = new Set<string>();
        const bleOutcome = await scanNativeAndroidBle((observation) => {
          const id = String(observation.address || observation.id || '').trim().toLowerCase();
          if (id) observed.add(id);
        }, 5000);

        const classicOutcome = await scanNativeAndroidClassic((observation) => {
          const id = String(observation.address || observation.id || '').trim().toLowerCase();
          if (id) observed.add(id);
        }, 5000);

        observedIdentifier = observed.has(registeredIdentifier) ? registeredIdentifier : null;
        observationDescription = 'Device address was observed during a foreground Android BLE/classic scan. No GPS coordinates were collected.';

        if (!observedIdentifier) {
          const reasons = [
            !bleOutcome.ok ? bleOutcome.error : bleOutcome.message,
            !classicOutcome.ok ? classicOutcome.error : classicOutcome.message,
          ].filter(Boolean);
          setError(
            reasons.join(' ')
              || 'The registered device was not detected in the foreground BLE or classic scan. Keep it nearby and discoverable, then retry. No encounter was submitted.',
          );
          return;
        }
      } else {
        const result = await requestBluetoothDevice();
        if (result.ok === false) {
          setError(result.error);
          return;
        }
        if (result.device.id.trim().toLowerCase() !== registeredIdentifier) {
          setError('The selected browser device identifier does not match this registration. No encounter was submitted.');
          return;
        }
        observedIdentifier = result.device.id;
      }

      let location: { lat: number; lng: number } | undefined;
      if (shareLocation) {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
          setError('This device does not expose location services. No encounter was submitted; turn off location sharing to record a Bluetooth-only sighting.');
          return;
        }
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 12000,
              maximumAge: 0,
            });
          });
          location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
        } catch (locationError: unknown) {
          const reason = locationError instanceof Error
            ? locationError.message
            : 'Location permission was denied or unavailable.';
          setError(`Bluetooth presence was verified, but location could not be obtained (${reason}). No encounter was submitted. Allow location access or turn off optional location sharing and retry.`);
          return;
        }
      }

      await api.recovery.submitEncounter(token, selectedDevice.deviceId, {
        source: 'REAL',
        simulated: false,
        isTestFixture: false,
        description: observationDescription,
        ...(location ? { location } : {}),
      });
      setNotice(location
        ? 'Bluetooth encounter saved with the location you explicitly chose to share.'
        : 'Bluetooth encounter saved without GPS. No location was inferred or submitted.');
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

  const scanForCommunitySightings = async () => {
    const token = await getFreshFirebaseIdToken() ?? ownerToken.trim();
    if (!token) {
      setError('Sign in with your Firebase account before submitting a community sighting.');
      return;
    }
    if (!isNativeAndroidApp()) {
      setError('Community discovery requires the native Android app. Browser Web Bluetooth cannot passively scan nearby devices.');
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const candidates = new Map<string, { name: string; serviceUuids: string[] }>();
      const outcome = await scanNativeAndroidBle((observation) => {
        const name = observation.name?.normalize('NFKC').replace(/\s+/g, ' ').trim();
        const serviceUuids = [...new Set((observation.serviceUuids ?? []).map(uuid => uuid.trim().toLowerCase()).filter(Boolean))].sort();
        if (!name || serviceUuids.length === 0) return;
        const key = JSON.stringify({ name: name.toLowerCase(), serviceUuids });
        if (!candidates.has(key)) candidates.set(key, { name, serviceUuids });
      }, 12000);

      const observations = Array.from(candidates.values()).slice(0, 30);
      if (observations.length === 0) {
        setError(outcome.ok
          ? 'The scan found no BLE advertisements with both a usable name and service UUIDs. No community report was sent. Many earbuds do not advertise enough stable information for safe matching.'
          : outcome.error);
        return;
      }

      let location: { lat: number; lng: number } | undefined;
      if (communityShareLocation) {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
          setError('Location is unavailable on this device. Turn off optional location sharing to submit Bluetooth-only candidates.');
          return;
        }
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true, timeout: 12000, maximumAge: 0,
            });
          });
          location = { lat: position.coords.latitude, lng: position.coords.longitude };
        } catch (caught) {
          setError(`Location was not obtained (${errorMessage(caught)}). No report was sent. Allow location access or disable optional location sharing.`);
          return;
        }
      }

      const result = await api.recovery.submitCommunitySightings(token, {
        observations,
        shareLocation: communityShareLocation,
        ...(location ? { location } : {}),
      });
      setOwnerToken(token);
      setActiveOwnerToken(token);
      setNotice(`Community scan submitted ${result.observationsReceived} eligible BLE fingerprint candidate(s). Matching reports, if any, are private to device owners. These are candidate leads, not proof that a lost device was found.`);
    } catch (caught) {
      setError(errorMessage(caught));
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
          Register and manage recovery cases through the authenticated backend. Android uses foreground native BLE/classic discovery with system permissions. Browser builds use Web Bluetooth when available; neither mode provides continuous background community scanning.
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
          <button
            type="button"
            onClick={() => void handleFirebasePasswordReset()}
            disabled={busy}
            className="min-h-10 rounded-lg border border-[var(--border)] px-4 text-sm font-semibold text-[var(--text)] disabled:opacity-50"
          >
            Forgot password?
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
          BlueGuardian uses Firebase email/password authentication. If you created this user in Firebase Console, sign in with the exact password you assigned there. Use Forgot password? to request a reset email. ID tokens are verified by the backend and scoped to your Firebase user ID; credentials and refresh tokens stay in memory only. Reloading requires sign-in again.
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
            Android uses BlueGuardian's native foreground Bluetooth scanner and paired-device list. Browser builds use the browser BLE picker. Neither mode collects GPS coordinates or continuously scans in the background.
          </p>
          <button
            type="button"
            onClick={selectBluetoothDevice}
            disabled={busy}
            className="mt-4 min-h-10 rounded-lg border border-[var(--border)] px-4 text-sm font-semibold text-[var(--text)] disabled:opacity-50"
          >
            {busy ? 'Searching Bluetooth…' : isNativeAndroidApp() ? 'Find native Android devices' : 'Select real device'}
          </button>
          {isNativeAndroidApp() && availableNativeDevices.length > 0 && (
            <div className="mt-4 space-y-2" aria-label="Available Android Bluetooth devices">
              <p className="text-xs text-[var(--text-muted)]">Select a device found in the foreground BLE scan or Android paired-device list.</p>
              {availableNativeDevices.map(device => (
                <button
                  key={device.id}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setSelectedBluetoothDevice(device);
                    setDeviceName(device.name ?? '');
                    setAvailableNativeDevices([]);
                    setNotice(`Selected native Android ${device.transport ?? 'Bluetooth'} device ${device.name || 'with no advertised name'}. The app has not connected to or tracked it in the background.`);
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--border)] p-3 text-left disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-medium text-[var(--text)]">{device.name || 'Bluetooth device name unavailable'}</span>
                    <span className="mt-1 block break-all text-xs text-[var(--text-muted)]">{device.transport ?? 'BLE'} · {device.paired ? 'Paired' : 'Nearby'} · {device.address || device.id}</span>
                  </span>
                  {typeof device.rssi === 'number' && <span className="shrink-0 text-xs text-[var(--text-secondary)]">{device.rssi} dBm</span>}
                </button>
              ))}
            </div>
          )}
          {selectedBluetoothDevice && (
            <div className="mt-4 space-y-3">
              <p className="break-all text-xs text-[var(--text-muted)]">
                Selected: {selectedBluetoothDevice.name ?? 'Unnamed Bluetooth device'} · {selectedBluetoothDevice.source === 'native' ? `Native Android ${selectedBluetoothDevice.transport ?? 'Bluetooth'} address` : 'Browser-scoped identifier'} · {selectedBluetoothDevice.address || selectedBluetoothDevice.id}
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

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex items-center gap-2">
          <Bluetooth className="h-4 w-4 text-[var(--accent)]" />
          <h2 className="text-lg font-semibold text-[var(--text)]">Community recovery scan</h2>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">
          Help owners by scanning nearby BLE advertisements while this screen is open. BlueGuardian sends only advertised names and service UUIDs needed for candidate matching, not Bluetooth MAC addresses. A match is stored as an unverified lead and never marks a device recovered automatically. Background scanning is not supported.
        </p>
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
          <input type="checkbox" checked={communityShareLocation} onChange={event => setCommunityShareLocation(event.target.checked)} disabled={busy} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]" />
          <span>
            <span className="block text-sm font-medium text-[var(--text)]">Share this phone's location with matched owners (optional)</span>
            <span className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">GPS is requested only after the scan and only when this box is checked. Without it, reports contain no location.</span>
          </span>
        </label>
        <button type="button" onClick={() => void scanForCommunitySightings()} disabled={busy || !ownerToken.trim()} className="mt-4 min-h-10 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-slate-950 disabled:opacity-50">
          {busy ? 'Scanning and submitting…' : 'Scan and help nearby owners'}
        </button>
        {!isNativeAndroidApp() && <p className="mt-2 text-xs text-[var(--text-muted)]">Native Android APK required for nearby BLE scanning. The browser cannot scan passively.</p>}
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

          <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={shareLocation}
                onChange={event => setShareLocation(event.target.checked)}
                disabled={busy}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
              />
              <span>
                <span className="block text-sm font-medium text-[var(--text)]">Attach this phone's location to the sighting (optional)</span>
                <span className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">Only requested after Bluetooth verification, only when checked, and sent with this owner-authorized encounter. If location cannot be obtained, the encounter is not submitted until you retry without location sharing.</span>
              </span>
            </label>
          </div>

          <div className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              <MapPin className="h-3.5 w-3.5" />
              Last observation
            </div>
            {recoveryInfo.lastObservationAt ? (
              <div className="mt-2 space-y-1">
                <p className="text-sm text-[var(--text)]">
                  {formatDate(recoveryInfo.lastObservationAt)}
                  {recoveryInfo.simulated ? ' · SIMULATED' : ' · REAL Bluetooth observation'}
                </p>
                {recoveryInfo.lastKnownLocation ? (
                  <p className="text-sm text-[var(--success)]">
                    {recoveryInfo.lastKnownLocation.address
                      ?? `${recoveryInfo.lastKnownLocation.lat}, ${recoveryInfo.lastKnownLocation.lng}`}
                  </p>
                ) : (
                  <p className="text-xs leading-5 text-[var(--text-muted)]">
                    Location unavailable. This observation confirms Bluetooth presence only; GPS is not collected by the current recovery workflow.
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-2 text-sm text-[var(--text-muted)]">No encounter recorded yet. A location will appear only when a real, consented location is actually collected and saved.</p>
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
