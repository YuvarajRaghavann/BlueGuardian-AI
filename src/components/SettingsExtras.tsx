import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bluetooth, MapPin, RefreshCw, Trash2 } from 'lucide-react';
import { intel, useIntel } from '../intel/store';
import { emptySnapshot } from '../intel/engine';
import { myDevices, myDevicesSupported } from '../services/myDevices';
import { LogoMark } from '../ui/Logo';

/** What the detection engine has learned on this phone, with a reset. */
export function IntelSettings() {
  const engine = useIntel();
  const [confirm, setConfirm] = useState(false);
  const snap = engine.snapshot;
  const devices = Object.keys(snap.profiles).length;
  return (
    <section className="rounded-3xl bg-[var(--surface)] p-5">
      <h2 className="text-base font-semibold">Detection and trust</h2>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">Learned on this phone from your own scans. Nothing is uploaded.</p>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[[snap.env.scans, 'scans'], [devices, 'devices'], [snap.findings.length, 'alerts']].map(([n, l]) => (
          <div key={String(l)} className="rounded-2xl bg-[var(--bg-elevated)] py-3">
            <p className="font-display text-xl font-semibold">{n}</p>
            <p className="text-[11px] text-[var(--text-muted)]">{l}</p>
          </div>
        ))}
      </div>
      {confirm ? (
        <div className="mt-4 rounded-2xl bg-[var(--danger)]/10 p-3">
          <p className="text-sm">Erase all trust scores, history and alerts? Your paired devices stay paired.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setConfirm(false)} className="tap rounded-xl bg-[var(--surface-raised)] py-2.5 text-sm">Cancel</button>
            <button type="button" onClick={() => { intel.replace(emptySnapshot()); setConfirm(false); }} className="tap rounded-xl bg-[var(--danger)] py-2.5 text-sm font-semibold text-[#1a0d08]">Erase</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirm(true)} className="tap mt-4 flex items-center gap-2 text-sm font-semibold text-[var(--danger)]">
          <Trash2 className="h-4 w-4" /> Reset learned data
        </button>
      )}
    </section>
  );
}

/** Permissions and app info. */
export function AppSettings() {
  const navigate = useNavigate();
  const native = myDevicesSupported();
  const [bt, setBt] = useState<boolean | null>(null);
  const [loc, setLoc] = useState<{ location: boolean; background: boolean } | null>(null);

  const refresh = () => {
    if (!native) return;
    void myDevices.bluetoothStatus().then((r) => setBt(r.granted)).catch(() => setBt(null));
    void myDevices.locationStatus().then(setLoc).catch(() => setLoc(null));
  };
  useEffect(refresh, [native]);

  const Row = ({ icon: Icon, title, ok, action, onClick }: { icon: typeof Bluetooth; title: string; ok: boolean | null; action: string; onClick: () => void }) => (
    <div className="flex items-center gap-3 py-2.5">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"><Icon className="h-5 w-5" /></span>
      <span className="flex-1 text-[15px] font-medium">{title}</span>
      {ok ? <span className="text-sm font-semibold text-[var(--success)]">Allowed</span> : (
        <button type="button" onClick={onClick} className="tap rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-bold text-white">{action}</button>
      )}
    </div>
  );

  return (
    <>
      {native && (
        <section className="rounded-3xl bg-[var(--surface)] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Permissions</h2>
            <button type="button" onClick={refresh} aria-label="Refresh" className="tap rounded-full p-2 text-[var(--text-muted)]"><RefreshCw className="h-4 w-4" /></button>
          </div>
          <Row icon={Bluetooth} title="Nearby devices" ok={bt} action="Allow" onClick={() => void myDevices.requestBluetooth().then(refresh).catch(refresh)} />
          <Row icon={MapPin} title="Location" ok={loc?.location ?? null} action="Allow" onClick={() => void myDevices.requestLocation().then(refresh).catch(refresh)} />
          <Row icon={MapPin} title="Location when closed" ok={loc?.background ?? null} action="Allow" onClick={() => void myDevices.requestBackgroundLocation().then(refresh).catch(refresh)} />
        </section>
      )}
      <section className="flex items-center gap-4 rounded-3xl bg-[var(--surface)] p-5">
        <LogoMark className="h-12 w-12" />
        <div className="flex-1">
          <p className="font-display text-base font-semibold">BlueGuardian</p>
          <p className="text-xs text-[var(--text-muted)]">Version 1.0 · Bluetooth trust and protection</p>
        </div>
        <button type="button" onClick={() => navigate('/welcome')} className="tap rounded-full bg-[var(--surface-raised)] px-4 py-2 text-sm font-semibold">Replay intro</button>
      </section>
    </>
  );
}
