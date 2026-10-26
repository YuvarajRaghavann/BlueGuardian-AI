import { useCallback, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Bell, Bluetooth, CheckCircle, ChevronRight, Clock, HandHeart, Headphones, LockKeyhole, LogOut, MapPin,
  Plus, Radar, RefreshCw, Search, ShieldCheck, Smartphone, Users,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { api, type RecoveryDeviceRecord, type RecoveryEncounterRecord, type RecoveryInfoRecord } from '../services/api';
import { setOwnerToken } from '../services/ownerSession';
import { requestBluetoothDevice, type BluetoothDeviceInfo } from '../services/bluetoothService';
import { getFreshFirebaseIdToken, sendFirebasePasswordResetEmail } from '../services/firebaseAuth';
import { signIn as accountSignIn, signOut as accountSignOut, useAccount } from '../services/accountSession';
import { isNativeAndroidApp, listNativeAndroidPairedDevices, scanNativeAndroidBle, scanNativeAndroidClassic } from '../services/nativeBluetoothService';
import { myDevices } from '../services/myDevices';
import { BottomSheet } from '../ui/BottomSheet';
import { Button, Card, Empty, Field, Notice, Pill, SectionTitle, StepTrack, Toggle, errorText, type NoticeTone } from '../ui/kit';
import { cn } from '../utils/cn';

type CaseState = RecoveryDeviceRecord['recoveryState'];
const STEPS: CaseState[] = ['lost', 'searching', 'found', 'recovered'];
const STEP_LABEL: Record<CaseState, string> = { lost: 'Lost', searching: 'Searching', found: 'Found', recovered: 'Recovered' };
const STEP_COLOR: Record<CaseState, string> = { lost: 'var(--danger)', searching: 'var(--warning)', found: 'var(--accent)', recovered: 'var(--success)' };

export interface CommunityPrefill {
  address: string;
  name?: string;
}

/**
 * One location fix for an explicitly opted-in report. In the Android app the native
 * fused/network provider is used (WebView geolocation often times out indoors).
 */
async function currentPosition(): Promise<{ lat: number; lng: number }> {
  if (isNativeAndroidApp()) {
    try {
      const status = await myDevices.requestLocation();
      if (status.location) {
        const fix = await myDevices.getLocation();
        return { lat: fix.lat, lng: fix.lng };
      }
    } catch {
      // fall back to the WebView below
    }
  }
  if (typeof navigator === 'undefined' || !navigator.geolocation) throw new Error('Location isn’t available on this device.');
  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  });
  return { lat: position.coords.latitude, lng: position.coords.longitude };
}

async function token(): Promise<string> {
  const t = await getFreshFirebaseIdToken();
  if (!t) throw new Error('Your session expired. Sign in again.');
  setOwnerToken(t);
  return t;
}

const mapsUrl = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
const when = (iso?: string | null) => (iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : null);

/** Community recovery: report a lost device, follow sightings, and help others. */
export function RecoveryCloud({ prefill, onPrefillUsed }: { prefill?: CommunityPrefill | null; onPrefillUsed?: () => void }) {
  const account = useAccount();
  const signedIn = account.status === 'signed-in' && Boolean(account.email);
  const [cases, setCases] = useState<RecoveryDeviceRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [openCase, setOpenCase] = useState<RecoveryDeviceRecord | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportPrefill, setReportPrefill] = useState<CommunityPrefill | null>(null);

  const loadCases = useCallback(async () => {
    setLoading(true);
    try {
      setCases(await api.recovery.listDevices(await token()));
      setLoaded(true);
    } catch (e) {
      setMessage({ tone: 'danger', text: errorText(e, 'Couldn’t load your lost devices.') });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (signedIn) void loadCases();
    else { setCases([]); setLoaded(false); }
  }, [signedIn, loadCases]);

  // "Ask the community" from My devices opens the report sheet with that device chosen.
  useEffect(() => {
    if (!prefill || !signedIn) return;
    setReportPrefill(prefill);
    setReportOpen(true);
    onPrefillUsed?.();
  }, [prefill, signedIn, onPrefillUsed]);

  const active = cases.filter((c) => c.recoveryState !== 'recovered');
  const closed = cases.filter((c) => c.recoveryState === 'recovered');
  const openReport = () => { setReportPrefill(null); setReportOpen(true); };

  return (
    <div className="space-y-5">
      <HowItWorks />

      {message && <Notice tone={message.tone} onDismiss={() => setMessage(null)}>{message.text}</Notice>}

      {!signedIn ? (
        <SignInCard restoring={account.status === 'restoring'} />
      ) : (
        <>
          <section>
            <SectionTitle action={
              <button type="button" onClick={() => void loadCases()} aria-label="Refresh" className="tap rounded-full p-2 text-[var(--text-muted)]">
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              </button>
            }>Your lost devices</SectionTitle>
            {active.length === 0 ? (
              <Empty icon={<ShieldCheck className="h-6 w-6" />} title={loaded ? 'Nothing reported' : 'Loading…'}
                action={<Button icon={<Plus className="h-4 w-4" />} onClick={openReport}>Report a lost device</Button>}>
                {loaded ? 'Lose something? Report it here and nearby BlueGuardian phones will look for it.' : undefined}
              </Empty>
            ) : (
              <div className="space-y-3">
                {active.map((c) => <CaseCard key={c.deviceId} record={c} onOpen={() => setOpenCase(c)} />)}
                <Button tone="secondary" className="w-full" icon={<Plus className="h-4 w-4" />} onClick={openReport}>Report another device</Button>
              </div>
            )}
            {closed.length > 0 && (
              <div className="mt-3 divide-y divide-[var(--border)] overflow-hidden rounded-3xl bg-[var(--surface)]">
                {closed.map((c) => (
                  <button key={c.deviceId} type="button" onClick={() => setOpenCase(c)} className="tap flex w-full items-center gap-3 px-4 py-3 text-left">
                    <CheckCircle className="h-5 w-5 text-[var(--success)]" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</span>
                    <span className="text-xs text-[var(--text-muted)]">Recovered</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <HelpOthersCard onResult={setMessage} />

          <div className="flex items-center justify-between rounded-2xl bg-[var(--surface)] px-4 py-3">
            <span className="flex min-w-0 items-center gap-2 text-sm text-[var(--text-secondary)]">
              <LockKeyhole className="h-4 w-4 shrink-0 text-[var(--accent)]" />
              <span className="truncate">{account.email}</span>
            </span>
            <button type="button" onClick={() => accountSignOut()} className="tap flex items-center gap-1.5 text-sm font-semibold text-[var(--text-muted)]">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </>
      )}

      <ReportSheet
        open={reportOpen}
        prefill={reportPrefill}
        onClose={() => setReportOpen(false)}
        onReported={(record) => {
          setCases((current) => [record, ...current.filter((c) => c.deviceId !== record.deviceId)]);
          setReportOpen(false);
          setMessage({ tone: 'success', text: `${record.name} is reported lost. Sightings will appear here.` });
        }}
      />

      <CaseSheet
        record={openCase}
        onClose={() => setOpenCase(null)}
        onChanged={(record) => {
          setCases((current) => current.map((c) => (c.deviceId === record.deviceId ? record : c)));
          setOpenCase(record);
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ pieces

function HowItWorks() {
  const reduce = useReducedMotion();
  const steps = [
    { icon: Bell, title: 'Report', text: 'Mark your device lost' },
    { icon: Users, title: 'Search', text: 'Nearby phones look for it' },
    { icon: MapPin, title: 'Get alerted', text: 'See when and where' },
  ];
  return (
    <Card tone="accent">
      <p className="text-[15px] font-bold">Community search</p>
      <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">Other BlueGuardian users help find your device. Only you see the results.</p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {steps.map((s, i) => (
          <motion.div key={s.title} className="relative flex flex-col items-center text-center"
            initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 * i }}>
            {i > 0 && <span className="absolute right-1/2 top-5 mr-5 h-0.5 w-[calc(100%-2.5rem)] bg-[var(--border-strong)]" />}
            <span className="relative grid h-10 w-10 place-items-center rounded-2xl bg-[var(--bg-elevated)] text-[var(--accent)]"><s.icon className="h-5 w-5" /></span>
            <span className="mt-2 text-[13px] font-bold">{s.title}</span>
            <span className="text-[11px] leading-4 text-[var(--text-muted)]">{s.text}</span>
          </motion.div>
        ))}
      </div>
    </Card>
  );
}

function SignInCard({ restoring }: { restoring: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<null | 'sign-in' | 'sign-up' | 'reset'>(null);
  const [message, setMessage] = useState<{ tone: NoticeTone; text: string } | null>(null);

  const submit = async (mode: 'sign-in' | 'sign-up') => {
    if (!email.trim() || !password) { setMessage({ tone: 'warning', text: 'Enter your email and password.' }); return; }
    setBusy(mode);
    setMessage(null);
    try {
      await accountSignIn(mode, email, password);
      setPassword('');
    } catch (e) {
      setMessage({ tone: 'danger', text: errorText(e, 'Sign-in failed.') });
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    if (!email.trim()) { setMessage({ tone: 'warning', text: 'Enter your email first.' }); return; }
    setBusy('reset');
    try {
      await sendFirebasePasswordResetEmail(email);
      setMessage({ tone: 'success', text: 'If that email has an account, a reset link is on its way.' });
    } catch (e) {
      setMessage({ tone: 'danger', text: errorText(e, 'Couldn’t send the email.') });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="Sign in to continue" subtitle="Your account keeps your reports private." icon={<LockKeyhole className="h-5 w-5" />}>
      {restoring ? (
        <Notice>Signing you in…</Notice>
      ) : (
        <div className="space-y-3">
          <Field label="Email" type="email" inputMode="email" autoComplete="email" value={email} onChange={setEmail} disabled={Boolean(busy)} />
          <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={setPassword} disabled={Boolean(busy)} onEnter={() => void submit('sign-in')} />
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          <div className="grid grid-cols-2 gap-2">
            <Button busy={busy === 'sign-in'} disabled={Boolean(busy)} onClick={() => void submit('sign-in')}>Sign in</Button>
            <Button tone="secondary" busy={busy === 'sign-up'} disabled={Boolean(busy)} onClick={() => void submit('sign-up')}>Create account</Button>
          </div>
          <button type="button" onClick={() => void reset()} disabled={Boolean(busy)} className="w-full text-center text-sm font-semibold text-[var(--accent)]">Forgot password?</button>
        </div>
      )}
    </Card>
  );
}

function CaseCard({ record, onOpen }: { record: RecoveryDeviceRecord; onOpen: () => void }) {
  const step = STEPS.indexOf(record.recoveryState);
  const color = STEP_COLOR[record.recoveryState];
  return (
    <button type="button" onClick={onOpen} className="tap block w-full rounded-3xl bg-[var(--surface)] p-4 text-left">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
          <Headphones className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-bold">{record.name}</span>
          <span className="block text-xs text-[var(--text-muted)]">{record.registeredAt ? `Reported ${when(record.registeredAt)}` : 'Reported'}</span>
        </span>
        <Pill color={color}>{STEP_LABEL[record.recoveryState]}</Pill>
        <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
      </div>
      <div className="mt-4">
        <StepTrack steps={STEPS.map((s) => STEP_LABEL[s])} current={step < 0 ? 0 : step} color={color} />
      </div>
    </button>
  );
}

function HelpOthersCard({ onResult }: { onResult: (m: { tone: NoticeTone; text: string }) => void }) {
  const [shareLocation, setShareLocation] = useState(false);
  const [busy, setBusy] = useState(false);
  const native = isNativeAndroidApp();

  const scan = async () => {
    setBusy(true);
    try {
      const candidates = new Map<string, { name: string; serviceUuids: string[] }>();
      const ble = await scanNativeAndroidBle((o) => {
        const name = o.name?.normalize('NFKC').replace(/\s+/g, ' ').trim();
        if (!name) return;
        const serviceUuids = [...new Set((o.serviceUuids ?? []).map((u) => u.trim().toLowerCase()).filter(Boolean))].sort();
        const key = JSON.stringify({ name: name.toLowerCase(), serviceUuids });
        if (!candidates.has(key)) candidates.set(key, { name, serviceUuids });
      }, 10000);
      // Many earbuds and speakers only appear in classic discovery.
      const classic = await scanNativeAndroidClassic((o) => {
        const name = o.name?.normalize('NFKC').replace(/\s+/g, ' ').trim();
        if (!name) return;
        const key = JSON.stringify({ name: name.toLowerCase(), serviceUuids: [] });
        if (!candidates.has(key)) candidates.set(key, { name, serviceUuids: [] });
      }, 10000);
      const observations = Array.from(candidates.values()).slice(0, 30);
      if (observations.length === 0) {
        onResult(ble.ok || classic.ok
          ? { tone: 'info', text: 'No named devices nearby right now. Nothing was sent.' }
          : { tone: 'danger', text: (ble.ok ? '' : ble.error) || (classic.ok ? '' : classic.error) || 'The scan failed.' });
        return;
      }
      let location: { lat: number; lng: number } | undefined;
      if (shareLocation) {
        try {
          location = await currentPosition();
        } catch (e) {
          onResult({ tone: 'warning', text: `Couldn’t get your location (${errorText(e)}). Nothing was sent.` });
          return;
        }
      }
      const result = await api.recovery.submitCommunitySightings(await token(), { observations, shareLocation, ...(location ? { location } : {}) });
      const n = result.observationsReceived;
      onResult({ tone: 'success', text: `Thanks for helping. ${n} nearby device${n === 1 ? '' : 's'} checked against lost reports.` });
    } catch (e) {
      onResult({ tone: 'danger', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Help others" subtitle="Check nearby devices against lost reports. Owners stay anonymous." icon={<HandHeart className="h-5 w-5" />}>
      <div className="space-y-3">
        <Toggle checked={shareLocation} onChange={setShareLocation} disabled={busy} label="Include my location" hint="Helps the owner find the spot." />
        <Button className="w-full" busy={busy} disabled={!native} icon={<Radar className="h-4 w-4" />} onClick={() => void scan()}>
          {busy ? 'Scanning…' : 'Scan and help'}
        </Button>
        {!native && <p className="text-center text-xs text-[var(--text-muted)]">Available in the Android app.</p>}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------ report sheet

function mergeOption(map: Map<string, BluetoothDeviceInfo>, record: BluetoothDeviceInfo) {
  const id = String(record.address || record.id || '').trim();
  if (!id) return;
  const prev = map.get(id.toLowerCase());
  map.set(id.toLowerCase(), {
    ...prev, ...record, id, address: id, source: 'native',
    name: record.name?.trim() || prev?.name,
    rssi: typeof record.rssi === 'number' ? record.rssi : prev?.rssi,
    uuids: record.uuids?.length ? record.uuids : prev?.uuids ?? [],
    paired: Boolean(record.paired || prev?.paired),
    transport: prev?.transport === 'PAIRED' ? 'PAIRED' : record.transport,
  });
}

function ReportSheet({ open, prefill, onClose, onReported }: {
  open: boolean;
  prefill: CommunityPrefill | null;
  onClose: () => void;
  onReported: (record: RecoveryDeviceRecord) => void;
}) {
  const native = isNativeAndroidApp();
  const [options, setOptions] = useState<BluetoothDeviceInfo[]>([]);
  const [selected, setSelected] = useState<BluetoothDeviceInfo | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<null | 'paired' | 'scan' | 'save'>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPaired = useCallback(async () => {
    if (!native) return;
    setBusy('paired');
    setError(null);
    try {
      const map = new Map<string, BluetoothDeviceInfo>();
      for (const d of await listNativeAndroidPairedDevices()) {
        mergeOption(map, { id: d.address, address: d.address, name: d.name, uuids: [], transport: 'PAIRED', paired: true });
      }
      setOptions(Array.from(map.values()));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }, [native]);

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setLabel('');
    setError(null);
    if (prefill) {
      setSelected({ id: prefill.address, address: prefill.address, name: prefill.name, uuids: [], transport: 'PAIRED', paired: true, source: 'native' });
      setLabel(prefill.name ?? '');
    }
    void loadPaired();
  }, [open, prefill, loadPaired]);

  const searchNearby = async () => {
    setError(null);
    if (!native) {
      const result = await requestBluetoothDevice();
      if (result.ok === false) { setError(result.error); return; }
      const picked: BluetoothDeviceInfo = { ...result.device, source: 'web', transport: 'WEB' };
      setSelected(picked);
      setLabel(picked.name ?? '');
      return;
    }
    setBusy('scan');
    try {
      const map = new Map(options.map((o) => [String(o.address || o.id).toLowerCase(), o]));
      const outcome = await scanNativeAndroidBle((o) => {
        mergeOption(map, { id: o.address || o.id, address: o.address || o.id, name: o.name, rssi: o.rssi, uuids: o.serviceUuids ?? [], transport: 'BLE', paired: false });
      }, 8000);
      setOptions(Array.from(map.values()));
      if (!outcome.ok) setError(outcome.error);
      else if (outcome.warning) setError(outcome.warning);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const report = async () => {
    if (!selected) return;
    const name = label.trim() || selected.name?.trim();
    if (!name) { setError('Give the device a name.'); return; }
    setBusy('save');
    setError(null);
    try {
      const identifier = selected.address || selected.id;
      const record = await api.recovery.registerDevice(await token(), {
        deviceId: identifier,
        deviceIdentifier: identifier,
        deviceName: name,
        type: 'unknown',
        discoverySource: 'REAL',
        recoveryState: 'lost',
        ...(selected.name ? { recoveryFingerprint: { name: selected.name, serviceUuids: selected.uuids ?? [] } } : {}),
      });
      onReported(record);
    } catch (e) {
      setError(errorText(e, 'Couldn’t report the device.'));
    } finally {
      setBusy(null);
    }
  };

  const named = options
    .filter((o) => o.name)
    .sort((a, b) => Number(Boolean(b.paired)) - Number(Boolean(a.paired)) || (b.rssi ?? -200) - (a.rssi ?? -200));

  return (
    <BottomSheet open={open} onClose={onClose} label="Report a lost device">
      <div className="space-y-4 px-5 pb-8 pt-1">
        <div>
          <h2 className="text-lg font-bold">Report a lost device</h2>
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">{selected ? 'Check the name, then report it.' : 'Choose the device you lost.'}</p>
        </div>

        {!selected ? (
          <>
            {busy === 'paired' ? (
              <Notice>Loading your devices…</Notice>
            ) : named.length > 0 ? (
              <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-3xl bg-[var(--surface)]">
                {named.map((o) => (
                  <li key={o.id}>
                    <button type="button" onClick={() => { setSelected(o); setLabel(o.name ?? ''); }} className="tap flex w-full items-center gap-3 px-4 py-3 text-left">
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                        {o.paired ? <Bluetooth className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">{o.name}</span>
                        <span className="block text-xs text-[var(--text-muted)]">{o.paired ? 'Paired with this phone' : 'Nearby now'}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-[var(--text-muted)]" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon={<Bluetooth className="h-6 w-6" />} title="No devices yet">Pair the device first, or search nearby.</Empty>
            )}
            <Button tone="secondary" className="w-full" busy={busy === 'scan'} icon={<Search className="h-4 w-4" />} onClick={() => void searchNearby()}>
              {busy === 'scan' ? 'Searching…' : native ? 'Search nearby' : 'Choose a device'}
            </Button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-3xl bg-[var(--surface)] p-4">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]"><Headphones className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{selected.name ?? 'Unnamed device'}</span>
                <span className="block text-xs text-[var(--text-muted)]">{selected.paired ? 'Paired with this phone' : 'Found nearby'}</span>
              </span>
              <button type="button" onClick={() => setSelected(null)} className="text-sm font-semibold text-[var(--accent)]">Change</button>
            </div>
            <Field label="Name for your report" value={label} onChange={setLabel} maxLength={100} placeholder="e.g. My earbuds" />
            {!selected.name && <Notice tone="warning">This device doesn’t broadcast a name, so other phones can’t recognise it. You can still track it yourself.</Notice>}
            <Button size="lg" className="w-full" busy={busy === 'save'} onClick={() => void report()}>Report as lost</Button>
          </>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </BottomSheet>
  );
}

// -------------------------------------------------------------- case sheet

function CaseSheet({ record, onClose, onChanged }: { record: RecoveryDeviceRecord | null; onClose: () => void; onChanged: (r: RecoveryDeviceRecord) => void }) {
  const [info, setInfo] = useState<RecoveryInfoRecord | null>(null);
  const [sightings, setSightings] = useState<RecoveryEncounterRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [shareLocation, setShareLocation] = useState(false);
  const [message, setMessage] = useState<{ tone: NoticeTone; text: string } | null>(null);

  const load = useCallback(async (r: RecoveryDeviceRecord) => {
    setBusy('load');
    try {
      const t = await token();
      const [i, s] = await Promise.all([api.recovery.getRecoveryInfo(t, r.deviceId), api.recovery.listEncounters(t, r.deviceId)]);
      setInfo(i);
      setSightings(s);
    } catch (e) {
      setMessage({ tone: 'danger', text: errorText(e, 'Couldn’t load sightings.') });
    } finally {
      setBusy(null);
    }
  }, []);

  const recordId = record?.deviceId;
  useEffect(() => {
    setInfo(null);
    setSightings([]);
    setMessage(null);
    if (record) void load(record);
    // Reload only when a different device is opened, not on every state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, load]);

  if (!record) return null;
  const state = info?.recoveryState ?? record.recoveryState;
  const step = STEPS.indexOf(state);

  const setState = async (next: CaseState) => {
    setBusy(next);
    setMessage(null);
    try {
      const updated = await api.recovery.updateState(await token(), record.deviceId, next);
      onChanged(updated);
      await load(updated);
      setMessage({ tone: 'success', text: `Marked as ${STEP_LABEL[next].toLowerCase()}.` });
    } catch (e) {
      setMessage({ tone: 'danger', text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  /** "I'm near it": confirm the device is nearby with a Bluetooth scan, then log a sighting. */
  const confirmNearby = async () => {
    setBusy('verify');
    setMessage(null);
    try {
      const target = record.deviceIdentifier.trim().toLowerCase();
      if (isNativeAndroidApp()) {
        const seen = new Set<string>();
        const collect = (o: { address?: string; id?: string }) => { const id = String(o.address || o.id || '').trim().toLowerCase(); if (id) seen.add(id); };
        await scanNativeAndroidBle(collect, 5000);
        if (!seen.has(target)) await scanNativeAndroidClassic(collect, 5000);
        if (!seen.has(target)) {
          setMessage({ tone: 'warning', text: 'Not detected nearby. Earbuds must be out of the case or in pairing mode. Nothing was logged.' });
          return;
        }
      } else {
        const picked = await requestBluetoothDevice();
        if (picked.ok === false) { setMessage({ tone: 'danger', text: picked.error }); return; }
        if (picked.device.id.trim().toLowerCase() !== target) { setMessage({ tone: 'warning', text: 'That’s a different device. Nothing was logged.' }); return; }
      }
      let location: { lat: number; lng: number } | undefined;
      if (shareLocation) {
        try {
          location = await currentPosition();
        } catch (e) {
          setMessage({ tone: 'warning', text: `Found it, but couldn’t get your location (${errorText(e)}). Try again or turn off location.` });
          return;
        }
      }
      await api.recovery.submitEncounter(await token(), record.deviceId, {
        source: 'REAL', simulated: false, isTestFixture: false,
        description: 'Confirmed nearby by the owner with Bluetooth.',
        ...(location ? { location } : {}),
      });
      setMessage({ tone: 'success', text: 'Found nearby. Sighting saved.' });
      await load(record);
    } catch (e) {
      setMessage({ tone: 'danger', text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const last = info?.lastKnownLocation ?? null;

  return (
    <BottomSheet open onClose={onClose} label={record.name}>
      <div className="space-y-4 px-5 pb-8 pt-1">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">{record.name}</h2>
            <p className="text-sm text-[var(--text-muted)]">{info ? `${info.encounterCount} sighting${info.encounterCount === 1 ? '' : 's'}` : 'Loading…'}</p>
          </div>
          <Pill color={STEP_COLOR[state]}>{STEP_LABEL[state]}</Pill>
        </div>

        <div className="rounded-3xl bg-[var(--surface)] p-4">
          <StepTrack steps={STEPS.map((s) => STEP_LABEL[s])} current={step < 0 ? 0 : step} color={STEP_COLOR[state]} />
        </div>

        <div className="rounded-3xl bg-[var(--surface)] p-4">
          <p className="flex items-center gap-2 text-sm font-bold"><MapPin className="h-4 w-4 text-[var(--accent)]" /> Last sighting</p>
          {info?.lastObservationAt ? (
            <>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{when(info.lastObservationAt)}{last ? '' : ' · no location shared'}</p>
              {last && (
                <a href={mapsUrl(last.lat, last.lng)} target="_blank" rel="noreferrer"
                  className="tap mt-3 flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] text-sm font-semibold text-white">
                  <MapPin className="h-4 w-4" /> Open in Maps
                </a>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-[var(--text-muted)]">No sightings yet. They’ll appear here as soon as a phone spots it.</p>
          )}
        </div>

        {message && <Notice tone={message.tone} onDismiss={() => setMessage(null)}>{message.text}</Notice>}

        {state !== 'recovered' && (
          <div className="space-y-2">
            <Toggle checked={shareLocation} onChange={setShareLocation} disabled={Boolean(busy)} label="Save my location with it" />
            <Button className="w-full" busy={busy === 'verify'} disabled={Boolean(busy)} icon={<Radar className="h-4 w-4" />} onClick={() => void confirmNearby()}>
              {busy === 'verify' ? 'Looking…' : 'I’m near it, confirm'}
            </Button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {state === 'recovered' || state === 'found' ? (
            <Button tone="secondary" busy={busy === 'lost'} disabled={Boolean(busy)} onClick={() => void setState('lost')}>Still lost</Button>
          ) : (
            <Button tone="secondary" busy={busy === 'found'} disabled={Boolean(busy)} onClick={() => void setState('found')}>I found it</Button>
          )}
          {state !== 'recovered' ? (
            <Button tone="success" busy={busy === 'recovered'} disabled={Boolean(busy)} onClick={() => void setState('recovered')}>It’s back with me</Button>
          ) : (
            <Button tone="secondary" busy={busy === 'load'} disabled={Boolean(busy)} icon={<RefreshCw className="h-4 w-4" />} onClick={() => void load(record)}>Refresh</Button>
          )}
        </div>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold">Sightings</h3>
            {state !== 'recovered' && (
              <button type="button" onClick={() => void load(record)} disabled={Boolean(busy)} className="flex items-center gap-1 text-xs font-semibold text-[var(--accent)]">
                <RefreshCw className={cn('h-3.5 w-3.5', busy === 'load' && 'animate-spin')} /> Refresh
              </button>
            )}
          </div>
          {sightings.length === 0 ? (
            <p className="rounded-2xl bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-muted)]">None yet.</p>
          ) : (
            <ol className="relative space-y-3 pl-5">
              <span className="absolute bottom-2 left-[7px] top-2 w-0.5 bg-[var(--border)]" />
              {sightings.map((s) => {
                const community = (s.description ?? '').toLowerCase().includes('community');
                const strong = typeof s.confidence === 'number' && s.confidence >= 0.4;
                const dot = community ? (strong ? 'var(--accent)' : 'var(--warning)') : 'var(--success)';
                return (
                  <li key={s._id} className="relative">
                    <span className="absolute -left-5 top-1.5 h-3.5 w-3.5 rounded-full border-2 border-[var(--bg-elevated)]" style={{ background: dot }} />
                    <div className="rounded-2xl bg-[var(--surface)] px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{community ? 'Spotted by the community' : 'Confirmed by you'}</span>
                        {community && <Pill color={dot}>{strong ? 'Strong match' : 'Possible match'}</Pill>}
                      </div>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-muted)]">
                        <Clock className="h-3 w-3" /> {when(s.observedAt)}
                        {s.location && (
                          <a href={mapsUrl(s.location.lat, s.location.lng)} target="_blank" rel="noreferrer" className="ml-2 font-semibold text-[var(--accent)]">View on map</a>
                        )}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">Community matches are based on the device’s name. Confirm before marking it found.</p>
        </section>
      </div>
    </BottomSheet>
  );
}
