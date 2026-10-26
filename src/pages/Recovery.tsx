import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bluetooth, Clock, Headphones, LoaderCircle, MapPin, Radar, RefreshCw, Share2, Smartphone, Users, Watch, X,
} from 'lucide-react';
import { RecoveryCloud, type CommunityPrefill } from './RecoveryCloud';
import { Button, Card, Empty, Notice, Segmented } from '../ui/kit';
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
        setLastAt(e.at);
      }),
      myDevices.addListener('proximityState', () => { if (!cancelled) setRunning(false); }),
    ];
    myDevices.startProximity({ address: device.address, name: device.name, durationMs: 120000 })
      .then((r) => { if (!cancelled) { setConnected(r.connected); if (r.warning) setError(r.warning); } })
      .catch((e: unknown) => { if (!cancelled) { setError(e instanceof Error ? e.message : 'Couldn’t start searching.'); setRunning(false); } });
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
          <p className="mt-4 text-xl font-semibold text-[var(--text)]">{connected && !fresh ? 'Connected · within about 10 m' : band.label}</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {fresh ? `Signal ${rssi} dBm · walk around and watch the bars` : running ? 'Listening for its signal…' : 'Search stopped.'}
          </p>
        </div>

        <ul className="mt-5 space-y-2 text-xs leading-5 text-[var(--text-secondary)]">
          {connected ? (
            <li>• It’s connected, so it’s close. Play a sound and listen for it.</li>
          ) : (
            <li>• Earbuds can only be found <b>out of the case</b> or in pairing mode.</li>
          )}
          <li>• More bars means closer. Walls and people weaken the signal.</li>
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
            {sounding ? 'Stop sound' : 'Play a sound'}
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

type Tab = 'mine' | 'community';

export function Recovery() {
  const supported = myDevicesSupported();
  const [tab, setTab] = useState<Tab>(() => (supported ? 'mine' : 'community'));
  const [prefill, setPrefill] = useState<CommunityPrefill | null>(null);
  const [devices, setDevices] = useState<KnownDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [perm, setPerm] = useState<{ location: boolean; background: boolean } | null>(null);
  const [lost, setLost] = useState<Record<string, boolean>>(() => readJson(LOST_KEY, {}));
  const [contact, setContact] = useState<string>(() => readJson(CONTACT_KEY, ''));
  const [finding, setFinding] = useState<KnownDevice | null>(null);
  const [busyAddress, setBusyAddress] = useState<string | null>(null);
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
      setError(e instanceof Error ? e.message : 'Couldn’t read your Bluetooth devices.');
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
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusyAddress(null);
    }
  };

  const enableLocation = () => act('perm', async () => {
    const status = await myDevices.requestLocation();
    setPerm(status);
    if (status.location) {
      setNotice('Location memory is on.');
      await refresh(true);
    }
  });

  const enableBackground = () => act('perm', async () => {
    const status = await myDevices.requestBackgroundLocation();
    setPerm(status);
    if (!status.background) setNotice('Choose “Allow all the time” on the next screen.');
  });

  const askCommunity = (d: KnownDevice) => {
    setPrefill({ address: d.address, name: d.name });
    setTab('community');
  };

  const sorted = [...devices].sort((a, b) => {
    const rank = (d: KnownDevice) => (lost[d.address] ? 4 : 0) + (d.connected ? 2 : 0) + (d.category === 'audio' || d.category === 'wearable' ? 1 : 0);
    if (rank(a) !== rank(b)) return rank(b) - rank(a);
    return (b.lastSeen?.lastSeenAt ?? 0) - (a.lastSeen?.lastSeenAt ?? 0);
  });

  return (
    <div className="space-y-5">
      <Segmented<Tab>
        layoutId="find-tab"
        value={tab}
        onChange={setTab}
        options={[
          { id: 'mine', label: <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" /> My devices</span> },
          { id: 'community', label: <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4" /> Community</span> },
        ]}
      />

      {tab === 'community' ? (
        <RecoveryCloud prefill={prefill} onPrefillUsed={() => setPrefill(null)} />
      ) : !supported ? (
        <Empty icon={<Smartphone className="h-6 w-6" />} title="Available in the Android app">Finding your devices needs your phone’s Bluetooth and location.</Empty>
      ) : (
        <>
          <p className="px-1 text-sm leading-6 text-[var(--text-secondary)]">
            We note where your phone was each time a device disconnects. That’s usually where you left it.
          </p>

          {perm && !perm.location && (
            <Card tone="accent" title="Turn on location memory" subtitle="Saves where a device was when it disconnected. Stays on this phone.">
              <Button busy={busyAddress === 'perm'} onClick={() => void enableLocation()}>Turn on</Button>
            </Card>
          )}
          {perm?.location && !perm.background && (
            <Card>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-[var(--text-secondary)]"><b className="text-[var(--text)]">Only while the app is open.</b> Allow location all the time to save places when it’s closed.</p>
                <Button tone="secondary" size="sm" busy={busyAddress === 'perm'} onClick={() => void enableBackground()}>Allow</Button>
              </div>
            </Card>
          )}

          {error && <Notice tone="danger" onDismiss={() => setError(null)}>{error}</Notice>}
          {notice && <Notice tone="success" onDismiss={() => setNotice(null)}>{notice}</Notice>}

          <section>
            <div className="mb-2.5 flex items-center justify-between px-1">
              <h2 className="text-[15px] font-bold">Your devices</h2>
              <button type="button" onClick={() => void refresh()} aria-label="Refresh" className="tap rounded-full p-2 text-[var(--text-muted)]">
                {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </button>
            </div>
            {devices.length === 0 && !loading ? (
              <Empty icon={<Bluetooth className="h-6 w-6" />} title="No paired devices"
                action={<Button tone="secondary" onClick={() => void myDevices.openBluetoothSettings()}>Open Bluetooth settings</Button>}>
                Pair your earbuds or watch and they’ll appear here.
              </Empty>
            ) : (
              <ul className="space-y-3">
                {sorted.map((d) => {
                  const seen = d.lastSeen;
                  const place = lastPlace(seen);
                  const isLost = Boolean(lost[d.address]);
                  const lastConnected = seen?.lastDisconnectedAt ?? seen?.lastSeenAt;
                  const busy = busyAddress === d.address;
                  return (
                    <li key={d.address} className={cn('rounded-3xl p-4', isLost ? 'bg-[var(--danger)]/10 ring-1 ring-[var(--danger)]/30' : 'bg-[var(--surface)]')}>
                      <div className="flex items-center gap-3">
                        <div className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-2xl', d.connected ? 'bg-[var(--success)]/15 text-[var(--success)]' : 'bg-[var(--surface-hover)] text-[var(--text-secondary)]')}>
                          <DeviceIcon device={d} className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[15px] font-bold text-[var(--text)]">{deviceLabel(d)}</p>
                          <p className={cn('mt-0.5 text-xs font-medium', d.connected ? 'text-[var(--success)]' : isLost ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]')}>
                            {d.connected ? 'Connected now' : isLost ? 'Marked as lost' : lastConnected ? `Last with you ${timeAgo(lastConnected, now)}` : 'Not seen yet'}
                          </p>
                        </div>
                        <button type="button" onClick={() => toggleLost(d.address)}
                          className={cn('tap shrink-0 rounded-full px-3 py-1.5 text-xs font-bold', isLost ? 'bg-[var(--success)]/15 text-[var(--success)]' : 'bg-[var(--surface-raised)] text-[var(--text-secondary)]')}>
                          {isLost ? 'Found it' : 'Lost it?'}
                        </button>
                      </div>

                      <div className="mt-3 flex items-center gap-2 rounded-2xl bg-[var(--bg-elevated)] px-3 py-2.5 text-xs">
                        {place ? (
                          <>
                            <MapPin className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                            <span className="min-w-0 flex-1 text-[var(--text-secondary)]">
                              <b className="text-[var(--text)]">Last seen here</b> · {timeAgo(place.at, now)} · ±{Math.max(5, Math.round(place.accuracy))} m
                            </span>
                          </>
                        ) : (
                          <>
                            <Clock className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                            <span className="text-[var(--text-muted)]">{perm?.location ? 'A place is saved next time it connects or disconnects.' : 'Turn on location memory to save places.'}</span>
                          </>
                        )}
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <Button size="sm" icon={<Radar className="h-4 w-4" />} onClick={() => setFinding(d)}>Find</Button>
                        <Button size="sm" tone="secondary" disabled={!place || busy} icon={<MapPin className="h-4 w-4" />}
                          onClick={() => place && void act(d.address, () => myDevices.openMap({ lat: place.lat, lng: place.lng, label: deviceLabel(d) }))}>
                          Map
                        </Button>
                        <Button size="sm" tone="secondary" disabled={busy} icon={<Share2 className="h-4 w-4" />}
                          onClick={() => void act(d.address, () => myDevices.share({ title: `Where my ${deviceLabel(d)} was`, text: buildShareText(d, seen, contact) }))}>
                          Share
                        </Button>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {d.connected ? (
                          <Button size="sm" tone="ghost" disabled={busy || !perm?.location}
                            onClick={() => void act(d.address, async () => { await myDevices.saveCurrentLocationFor({ address: d.address, name: d.name, source: 'app' }); setNotice(`Spot saved for ${deviceLabel(d)}.`); await refresh(true); })}>
                            Save this spot
                          </Button>
                        ) : (
                          <Button size="sm" tone="ghost" busy={busy} icon={<Bluetooth className="h-4 w-4" />}
                            onClick={() => void act(d.address, async () => {
                              const r = await myDevices.connect({ address: d.address });
                              setNotice(r.message);
                              if (r.result === 'settings') await myDevices.openBluetoothSettings();
                              await refresh(true);
                            })}>
                            Connect
                          </Button>
                        )}
                        {isLost && (
                          <Button size="sm" tone="ghost" icon={<Users className="h-4 w-4" />} onClick={() => askCommunity(d)}>Ask the community</Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <Card title="Your contact in shared messages" subtitle="Optional. Added when you share a device’s location.">
            <input id="share-contact" value={contact} maxLength={80} placeholder="Phone number or name"
              onChange={(e) => { setContact(e.target.value); writeJson(CONTACT_KEY, e.target.value); }}
              className="min-h-12 w-full rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3.5 text-[15px] text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]" />
          </Card>

          <p className="px-1 text-center text-[11px] text-[var(--text-muted)]">Earbuds in a closed case can’t be detected. Open the case near the saved spot, then tap Find.</p>
        </>
      )}

      {finding && <FindItSheet device={finding} onClose={() => { setFinding(null); void refresh(true); }} />}
    </div>
  );
}
