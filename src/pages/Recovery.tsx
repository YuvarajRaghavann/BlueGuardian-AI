import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bluetooth, ChevronRight, Clock, Headphones, LoaderCircle, MapPin, Radar, RefreshCw, Settings, ShieldAlert, Smartphone, Watch, X,
} from 'lucide-react';
import { RecoveryCloud } from './RecoveryCloud';
import { BottomSheet } from '../ui/BottomSheet';
import {
  buildShareText, deviceLabel, lastPlace, myDevices, myDevicesSupported, proximityBand, timeAgo,
  type KnownDevice,
} from '../services/myDevices';
import { cn } from '../utils/cn';

const LOST_KEY = 'blueguardian.lost-devices.v1';
const CONTACT_KEY = 'blueguardian.share-contact.v1';
const AUTOSAVE_KEY = 'blueguardian.location-autosave.v1';
const AUTOSAVE_EVERY_MS = 5 * 60 * 1000;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: the in-memory state still works
  }
}

function DeviceIcon({ device, className }: { device: KnownDevice; className?: string }) {
  if (device.category === 'audio') return <Headphones className={className} />;
  if (device.category === 'wearable') return <Watch className={className} />;
  if (device.category === 'phone') return <Smartphone className={className} />;
  return <Bluetooth className={className} />;
}

/** A short beep train through the phone's current audio output (i.e. the earbuds, if connected). */
function playFindingSound(seconds = 10): () => void {
  const AudioCtx = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return () => undefined;
  const ctx = new AudioCtx();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = 2400;
  osc.connect(gain);
  const t0 = ctx.currentTime;
  for (let i = 0; i < seconds * 2; i++) {
    const t = t0 + i * 0.5;
    gain.gain.setValueAtTime(0.6, t);
    gain.gain.setValueAtTime(0, t + 0.25);
  }
  osc.start();
  osc.stop(t0 + seconds);
  const timer = setTimeout(() => void ctx.close().catch(() => undefined), seconds * 1000 + 200);
  return () => {
    clearTimeout(timer);
    try { osc.stop(); } catch { /* already stopped */ }
    void ctx.close().catch(() => undefined);
  };
}

function FindItSheet({ device, onClose }: { device: KnownDevice; onClose: () => void }) {
  const [rssi, setRssi] = useState<number | null>(null);
  const [via, setVia] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [connected, setConnected] = useState(device.connected);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(true);
  const [now, setNow] = useState(Date.now());
  const stopSound = useRef<() => void>(() => undefined);
  const [sounding, setSounding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const handles = [
      myDevices.addListener('proximity', (e) => {
        if (cancelled) return;
        setRssi((prev) => (prev === null ? e.rssi : Math.round(prev * 0.5 + e.rssi * 0.5)));
        setVia(e.via);
        setLastAt(e.at);
      }),
      myDevices.addListener('proximityState', () => { if (!cancelled) setRunning(false); }),
    ];
    myDevices.startProximity({ address: device.address, name: device.name, durationMs: 120000 })
      .then((r) => { if (!cancelled) { setConnected(r.connected); if (r.warning) setError(r.warning); } })
      .catch((e: unknown) => { if (!cancelled) { setError(e instanceof Error ? e.message : 'Could not start searching.'); setRunning(false); } });
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearInterval(tick);
      stopSound.current();
      void myDevices.stopProximity().catch(() => undefined);
      for (const h of handles) void h.then((x) => x.remove()).catch(() => undefined);
    };
  }, [device.address, device.name]);

  const fresh = lastAt !== null && now - lastAt < 8000;
  const band = proximityBand(fresh ? rssi : null);

  return (
    <BottomSheet open onClose={onClose} label={`Find ${deviceLabel(device)}`}>
      <div className="px-5 pb-6 pt-1">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text)]">Find {deviceLabel(device)}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-[var(--text-muted)]"><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-6 flex flex-col items-center">
          <div className="flex h-12 items-end gap-2" aria-hidden="true">
            {[1, 2, 3, 4].map((l) => (
              <div key={l} className={cn('w-6 rounded-t-md transition-all', band.level >= l ? 'bg-[var(--accent)]' : 'bg-[var(--surface-hover)]')} style={{ height: `${l * 25}%` }} />
            ))}
          </div>
          <p className="mt-4 text-xl font-semibold text-[var(--text)]">{connected && !fresh ? 'Connected — within about 10 m' : band.label}</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {fresh ? `${rssi} dBm via ${via === 'BLE' ? 'Bluetooth LE' : 'classic Bluetooth'} · move around and watch the bars` : running ? 'Listening for its signal…' : 'Search stopped.'}
          </p>
        </div>

        <ul className="mt-5 space-y-2 text-xs leading-5 text-[var(--text-secondary)]">
          {connected ? (
            <li>• It's connected to your phone, so it is nearby. Play a sound through it and listen:</li>
          ) : (
            <li>• Earbuds are only visible when they're <b>out of the case</b> or in pairing mode. In a closed case they can't be detected.</li>
          )}
          <li>• More bars = closer. Walk slowly and turn around; walls and bodies weaken the signal.</li>
        </ul>

        {connected && (
          <button
            type="button"
            onClick={() => {
              if (sounding) { stopSound.current(); setSounding(false); return; }
              stopSound.current = playFindingSound(10);
              setSounding(true);
              setTimeout(() => setSounding(false), 10000);
            }}
            className="mt-4 w-full rounded-xl bg-[var(--accent)] py-3 text-sm font-semibold text-white"
          >
            {sounding ? 'Stop sound' : 'Play finding sound (10 s)'}
          </button>
        )}
        {error && <p role="alert" className="mt-3 text-xs text-[var(--danger)]">{error}</p>}
        {!running && !error && (
          <button type="button" onClick={onClose} className="mt-3 w-full rounded-xl border border-[var(--border)] py-3 text-sm font-semibold text-[var(--text)]">Done</button>
        )}
      </div>
    </BottomSheet>
  );
}

export function Recovery() {
  const supported = myDevicesSupported();
  const [devices, setDevices] = useState<KnownDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [perm, setPerm] = useState<{ location: boolean; background: boolean } | null>(null);
  const [lost, setLost] = useState<Record<string, boolean>>(() => readJson(LOST_KEY, {}));
  const [contact, setContact] = useState<string>(() => readJson(CONTACT_KEY, ''));
  const [finding, setFinding] = useState<KnownDevice | null>(null);
  const [busyAddress, setBusyAddress] = useState<string | null>(null);
  const [showCloud, setShowCloud] = useState(false);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async (quiet = false) => {
    if (!supported) return;
    if (!quiet) setLoading(true);
    try {
      const [{ devices: list }, status] = await Promise.all([myDevices.listKnownDevices(), myDevices.locationStatus()]);
      setDevices(list);
      setPerm(status);
      setError(null);
      // While a device is connected, keep its "last seen" place fresh (at most every 5 minutes).
      if (status.location) {
        const saved = readJson<Record<string, number>>(AUTOSAVE_KEY, {});
        const due = list.filter((d) => d.connected && Date.now() - (saved[d.address] ?? 0) > AUTOSAVE_EVERY_MS);
        for (const d of due) {
          saved[d.address] = Date.now();
          writeJson(AUTOSAVE_KEY, saved);
          void myDevices.saveCurrentLocationFor({ address: d.address, name: d.name, source: 'connected' })
            .then(() => myDevices.listKnownDevices().then((r) => setDevices(r.devices)))
            .catch(() => undefined);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read your Bluetooth devices.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [supported]);

  useEffect(() => {
    if (!supported) return;
    void refresh();
    const timer = setInterval(() => { setNow(Date.now()); void refresh(true); }, 30000);
    const presence = myDevices.addListener('presence', (e) => {
      // A device just disconnected while the app is open: save the exact spot right now.
      if (!e.connected) {
        void myDevices.saveCurrentLocationFor({ address: e.address, name: e.name, source: 'disconnected' })
          .catch(() => undefined)
          .finally(() => void refresh(true));
      } else {
        void refresh(true);
      }
    });
    return () => {
      clearInterval(timer);
      void presence.then((h) => h.remove()).catch(() => undefined);
    };
  }, [refresh, supported]);

  const toggleLost = (address: string) => {
    setLost((current) => {
      const next = { ...current, [address]: !current[address] };
      if (!next[address]) delete next[address];
      writeJson(LOST_KEY, next);
      return next;
    });
  };

  const act = async (address: string, task: () => Promise<unknown>) => {
    setBusyAddress(address);
    setError(null);
    setNotice(null);
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusyAddress(null);
    }
  };

  const enableLocation = () => act('perm', async () => {
    const status = await myDevices.requestLocation();
    setPerm(status);
    if (status.location) {
      setNotice('Location memory is on. Each time a device disconnects, BlueGuardian saves where your phone was.');
      await refresh(true);
    }
  });

  const enableBackground = () => act('perm', async () => {
    const status = await myDevices.requestBackgroundLocation();
    setPerm(status);
    if (!status.background) setNotice('On the next screen choose "Allow all the time" so places are saved even when BlueGuardian is closed.');
  });

  const sorted = [...devices].sort((a, b) => {
    const rank = (d: KnownDevice) => (lost[d.address] ? 4 : 0) + (d.connected ? 2 : 0) + (d.category === 'audio' || d.category === 'wearable' ? 1 : 0);
    if (rank(a) !== rank(b)) return rank(b) - rank(a);
    return (b.lastSeen?.lastSeenAt ?? 0) - (a.lastSeen?.lastSeenAt ?? 0);
  });

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-[26px] font-extrabold leading-tight text-[var(--text)]">Where did I leave it?</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
          BlueGuardian notes the time and place each time a device disconnects from this phone. That's usually where your earbuds fell out
          or got left behind. You can open the spot in Maps, share it, or use the signal meter to find the device.
        </p>
      </header>

      {!supported && (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 text-sm text-[var(--text-secondary)]">
          Find my devices works in the BlueGuardian Android app, because it needs your phone's Bluetooth and location.
        </section>
      )}

      {supported && perm && !perm.location && (
        <section className="rounded-2xl border border-[var(--accent)]/40 bg-[var(--accent-soft)] p-5">
          <h2 className="text-base font-semibold text-[var(--text)]">Turn on location memory</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
            Lets BlueGuardian save where your phone was when a device disconnects. Places stay on this phone unless you share them.
          </p>
          <button type="button" onClick={() => void enableLocation()} disabled={busyAddress === 'perm'}
            className="mt-3 min-h-11 rounded-xl bg-[var(--accent)] px-5 text-sm font-semibold text-white disabled:opacity-50">
            Turn on
          </button>
        </section>
      )}
      {supported && perm?.location && !perm.background && (
        <section className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--text-secondary)]">
            <b className="text-[var(--text)]">Places are saved only while BlueGuardian is open.</b> Allow location “all the time” to also save them when the app is closed.
          </p>
          <button type="button" onClick={() => void enableBackground()} disabled={busyAddress === 'perm'}
            className="min-h-10 shrink-0 rounded-xl border border-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent)] disabled:opacity-50">
            Allow all the time
          </button>
        </section>
      )}

      {supported && (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-[var(--text)]">My devices</h2>
            <button type="button" onClick={() => void refresh()} aria-label="Refresh" className="rounded-lg border border-[var(--border)] p-2 text-[var(--text-secondary)]">
              {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </button>
          </div>
          {devices.length === 0 && !loading && (
            <p className="text-sm text-[var(--text-muted)]">
              No paired devices yet. Pair your earbuds or watch in Android Bluetooth settings and they'll appear here automatically.
              <button type="button" onClick={() => void myDevices.openBluetoothSettings()} className="ml-1 font-semibold text-[var(--accent)] underline underline-offset-2">Open Bluetooth settings</button>
            </p>
          )}
          <ul className="space-y-3">
            {sorted.map((d) => {
              const seen = d.lastSeen;
              const place = lastPlace(seen);
              const isLost = Boolean(lost[d.address]);
              const lastConnected = seen?.lastDisconnectedAt ?? seen?.lastSeenAt;
              const busy = busyAddress === d.address;
              return (
                <li key={d.address} className={cn('rounded-2xl border p-4', isLost ? 'border-[var(--danger)]/60 bg-[var(--danger)]/5' : 'border-[var(--border)] bg-[var(--bg-elevated)]')}>
                  <div className="flex items-start gap-3">
                    <div className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl', d.connected ? 'bg-[var(--success)]/15 text-[var(--success)]' : 'bg-[var(--surface-hover)] text-[var(--text-secondary)]')}>
                      <DeviceIcon device={d} className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-[var(--text)]">{deviceLabel(d)}</p>
                      <p className={cn('mt-0.5 text-xs font-medium', d.connected ? 'text-[var(--success)]' : isLost ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]')}>
                        {d.connected
                          ? `Connected now${d.profiles.length ? ' · ' + d.profiles.join(', ') : ''}`
                          : isLost ? 'Marked as lost' : lastConnected ? `Last with your phone ${timeAgo(lastConnected, now)}` : 'Not seen yet'}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs leading-5">
                    {place ? (
                      <>
                        <p className="flex items-center gap-1.5 font-medium text-[var(--text)]"><MapPin className="h-3.5 w-3.5 text-[var(--accent)]" /> Last seen here</p>
                        <p className="text-[var(--text-secondary)]">
                          {place.lat.toFixed(5)}, {place.lng.toFixed(5)} · ±{Math.max(5, Math.round(place.accuracy))} m · {timeAgo(place.at, now)}
                        </p>
                      </>
                    ) : (
                      <p className="text-[var(--text-muted)]">
                        <Clock className="mr-1 inline h-3.5 w-3.5" />
                        {perm?.location ? 'No place saved yet. One is saved automatically the next time it connects or disconnects.' : 'Turn on location memory to save where it was last seen.'}
                      </p>
                    )}
                    {seen?.lastDisconnectedAt && (
                      <p className="mt-1 text-[var(--text-muted)]">Disconnected {new Date(seen.lastDisconnectedAt).toLocaleString()}</p>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <button type="button" onClick={() => setFinding(d)}
                      className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 text-sm font-semibold text-white">
                      <Radar className="h-4 w-4" /> Find it
                    </button>
                    <button type="button" disabled={busy}
                      onClick={() => void act(d.address, () => myDevices.share({ title: `Share where my ${deviceLabel(d)} was`, text: buildShareText(d, seen, contact) }))}
                      className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[var(--border)] px-3 text-sm font-semibold text-[var(--text)] disabled:opacity-50">
                      Share location
                    </button>
                    <button type="button" disabled={!place || busy}
                      onClick={() => place && void act(d.address, () => myDevices.openMap({ lat: place.lat, lng: place.lng, label: deviceLabel(d) }))}
                      className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[var(--border)] px-3 text-sm font-semibold text-[var(--text)] disabled:opacity-40">
                      <MapPin className="h-4 w-4" /> Open map
                    </button>
                    {d.connected ? (
                      <button type="button" disabled={busy || !perm?.location}
                        onClick={() => void act(d.address, async () => { await myDevices.saveCurrentLocationFor({ address: d.address, name: d.name, source: 'app' }); setNotice(`Saved this spot for ${deviceLabel(d)}.`); await refresh(true); })}
                        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[var(--border)] px-3 text-sm font-semibold text-[var(--text)] disabled:opacity-40">
                        Save spot now
                      </button>
                    ) : (
                      <button type="button" disabled={busy}
                        onClick={() => void act(d.address, async () => {
                          const r = await myDevices.connect({ address: d.address });
                          setNotice(r.message);
                          if (r.result === 'settings') await myDevices.openBluetoothSettings();
                          await refresh(true);
                        })}
                        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[var(--border)] px-3 text-sm font-semibold text-[var(--text)] disabled:opacity-50">
                        {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Bluetooth className="h-4 w-4" />} Connect
                      </button>
                    )}
                  </div>
                  <button type="button" onClick={() => toggleLost(d.address)}
                    className={cn('mt-2 text-xs font-semibold underline underline-offset-2', isLost ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>
                    {isLost ? 'I found it' : 'I lost this'}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {supported && (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <label htmlFor="share-contact" className="block text-sm font-semibold text-[var(--text)]">Contact in share messages (optional)</label>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">Added to “Share location” so whoever finds your device can reach you.</p>
          <input id="share-contact" value={contact} maxLength={80} placeholder="e.g. +91 98xxxxxx or your name"
            onChange={(e) => { setContact(e.target.value); writeJson(CONTACT_KEY, e.target.value); }}
            className="mt-2 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]" />
        </section>
      )}

      {error && <p role="alert" className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-3 text-sm text-[var(--danger)]">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-[var(--success)]/30 bg-[var(--success)]/10 p-3 text-sm text-[var(--success)]">{notice}</p>}

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        <button type="button" onClick={() => setShowCloud((v) => !v)} className="flex w-full items-center justify-between gap-3 p-4 text-left sm:p-5">
          <span>
            <span className="flex items-center gap-2 text-base font-semibold text-[var(--text)]"><ShieldAlert className="h-4 w-4 text-[var(--accent)]" /> Ask the community for help (optional)</span>
            <span className="mt-1 block text-xs text-[var(--text-muted)]">Needs a BlueGuardian account. Other users' phones can report sightings of your registered device.</span>
          </span>
          <ChevronRight className={cn('h-5 w-5 shrink-0 text-[var(--text-muted)] transition-transform', showCloud && 'rotate-90')} />
        </button>
        {showCloud && <div className="border-t border-[var(--border)] p-4 sm:p-5"><RecoveryCloud /></div>}
      </section>

      {supported && (
        <p className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <Settings className="h-3 w-3" /> Earbuds in a closed case can't be detected by any phone. Open the case near the saved spot and use Find it.
        </p>
      )}

      {finding && <FindItSheet device={finding} onClose={() => { setFinding(null); void refresh(true); }} />}
    </div>
  );
}
