import { useMemo } from 'react';
import { Activity, AlertTriangle, Bluetooth, CircleHelp, LockKeyhole, Radio, Shield, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useBluetoothDevices } from '../context/DeviceContext';
import { assessBtGuard, btGuardRegistry, type BtGuardLevel } from '../ml/btguard';
import { StatusBadge } from '../components/StatusBadge';

const levelStyle: Record<BtGuardLevel, string> = {
  FULL: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  RESTRICTED: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  ISOLATED: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
};

export function BTGuard() {
  const { state } = useBluetoothDevices();
  const assessments = useMemo(() => state.devices.map(device => ({
    device,
    snapshot: btGuardRegistry.observe(device),
    initial: assessBtGuard(device),
  })), [state.devices]);
  const restricted = assessments.filter(item => item.snapshot.level !== 'FULL').length;
  const signalCount = assessments.length ? Math.round(assessments.reduce((sum, item) => sum + item.snapshot.telemetryCoverage.length, 0) / assessments.length) : 0;

  return <div className="space-y-6">
    <header className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--surface)] via-[var(--surface)] to-[var(--surface-raised)] p-5 sm:p-6">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-[var(--accent)]"><Shield className="h-4 w-4" /> Continuous Trust Binding</div>
      <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">BTGuard</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">Evidence-based Bluetooth trust policy. BTGuard combines owner trust, connection health and optional controller telemetry, then recommends graduated capabilities with an explanation for each decision.</p>
      <div className="mt-4 flex flex-wrap gap-2"><StatusBadge label="Evidence fusion" variant="info" /><StatusBadge label="Explainable policy" variant="success" /><StatusBadge label="Hardware telemetry optional" variant="warning" /></div>
    </header>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric icon={Bluetooth} label="Tracked devices" value={String(assessments.length)} hint="Current device registry" />
      <Metric icon={ShieldAlert} label="Restricted or isolated" value={String(restricted)} hint="Requires owner review" />
      <Metric icon={Activity} label="Available signal types" value={String(signalCount)} hint="Average per device" />
      <Metric icon={LockKeyhole} label="Hardware security" value="Telemetry-gated" hint="Unknown is never assumed safe" />
    </section>
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-5 py-4"><h2 className="text-base font-semibold text-white">Device trust ledger</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Scores are policy signals, not calibrated probabilities of attack.</p></div>
      {assessments.length === 0 ? <div className="px-6 py-12 text-center"><Bluetooth className="mx-auto h-8 w-8 text-[var(--text-muted)]" /><h3 className="mt-3 text-sm font-semibold text-white">No devices to assess yet</h3><p className="mx-auto mt-1 max-w-md text-sm text-[var(--text-secondary)]">Open Nearby Devices and run a real scan. Simulated records cannot establish physical radio trust.</p></div> :
        <div className="divide-y divide-[var(--border)]">{assessments.map(({ device, snapshot }) => <article key={device.id} className="p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-semibold text-white">{device.name}</h3><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${levelStyle[snapshot.level]}`}>{snapshot.level}</span>{device.blocked && <StatusBadge label="Owner blocked" variant="danger" />}{device.discoverySource !== 'REAL' && <StatusBadge label="Simulated" variant="warning" />}</div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]"><span>Trust: <strong className="text-white">{snapshot.trustScore}/100</strong></span><span>RSSI: {typeof device.rssi === 'number' ? device.rssi + ' dBm' : 'Unavailable'}</span><span>Connection: {device.connectionHealth ?? 'Unknown'}</span></div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--surface-raised)]"><div className={`h-full rounded-full ${snapshot.level === 'FULL' ? 'bg-emerald-400' : snapshot.level === 'RESTRICTED' ? 'bg-amber-400' : 'bg-rose-400'}`} style={{ width: snapshot.trustScore + '%' }} /></div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3"><p className="mb-2 flex items-center gap-2 text-xs font-semibold text-white"><ShieldCheck className="h-3.5 w-3.5 text-[var(--accent)]" />Recommended capabilities</p>{snapshot.capabilities.length ? <div className="flex flex-wrap gap-1.5">{snapshot.capabilities.map(cap => <span key={cap} className="rounded-md bg-[var(--surface)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">{cap.replace('_', ' ')}</span>)}</div> : <p className="text-xs text-rose-300">No capabilities recommended by policy.</p>}</div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3"><p className="mb-2 flex items-center gap-2 text-xs font-semibold text-white"><Radio className="h-3.5 w-3.5 text-[var(--accent)]" />Telemetry coverage</p><div className="flex flex-wrap gap-1.5">{snapshot.telemetryCoverage.map(signal => <span key={signal} className="rounded-md bg-[var(--surface)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">{signal}</span>)}</div>{snapshot.requiresManualReview && <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-5 text-amber-300"><CircleHelp className="mt-0.5 h-3 w-3 shrink-0" />More evidence is needed for a high-confidence decision.</p>}</div>
              </div>
              <ul className="mt-3 space-y-1.5">{snapshot.reasons.map((reason, index) => <li key={index} className="flex items-start gap-2 text-xs leading-5 text-[var(--text-secondary)]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />{reason}</li>)}</ul>
            </div>
          </div>
        </article>)}</div>}
    </section>
    <section className="grid gap-4 lg:grid-cols-3">
      <Method icon={LockKeyhole} number="01" title="Cryptographic base" status="Needs native evidence" body="Secure Connections, encryption, authentication and negotiated key-size checks run only when a native controller adapter supplies those facts. Discovery does not prove secure pairing." />
      <Method icon={Radio} number="02" title="Proximity and identity" status="Needs supported hardware" body="Channel Sounding cross-checks and multi-sample CFO fingerprints are extension points. RSSI alone is not proof of distance or identity." />
      <Method icon={Activity} number="03" title="Behaviour and response" status="Policy engine available" body="Connection health and supplied behaviour counters can lower trust. A trained TinyML model requires labelled data, validation and target-hardware measurements." />
    </section>
    <aside className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4"><p className="flex items-center gap-2 text-sm font-semibold text-amber-200"><CircleHelp className="h-4 w-4" />Enforcement boundary</p><p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">Capability levels are app-level recommendations until checked at every privileged action boundary. A normal Android app cannot promise controller key rotation, global bond revocation, universal GATT restrictions, or interception of every system file transfer through the public discovery API.</p></aside>
  </div>;
}

function Metric({ icon: Icon, label, value, hint }: { icon: typeof Shield; label: string; value: string; hint: string }) {
  return <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><div className="flex items-center justify-between"><span className="text-xs text-[var(--text-muted)]">{label}</span><Icon className="h-4 w-4 text-[var(--accent)]" /></div><p className="mt-3 text-xl font-semibold text-white">{value}</p><p className="mt-1 text-[11px] text-[var(--text-muted)]">{hint}</p></div>;
}
function Method({ icon: Icon, number, title, status, body }: { icon: typeof Shield; number: string; title: string; status: string; body: string }) {
  return <article className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><div className="flex items-center justify-between"><span className="text-[10px] font-semibold tracking-[0.16em] text-[var(--accent)]">{number} / METHOD</span><Icon className="h-4 w-4 text-[var(--accent)]" /></div><h3 className="mt-3 text-sm font-semibold text-white">{title}</h3><p className="mt-1 text-[10px] font-medium text-[var(--text-muted)]">{status}</p><p className="mt-3 text-xs leading-5 text-[var(--text-secondary)]">{body}</p></article>;
}
