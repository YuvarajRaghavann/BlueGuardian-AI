import { useRef, useState, type ReactNode } from 'react';
import {
  Activity, Ban, CheckCircle, Database, Link, LoaderCircle, Lock, LockKeyhole, Radio, RefreshCw,
  Search, Shield, ShieldAlert, ShieldCheck, Signal, Smartphone, Trash2, Unlink, X,
} from 'lucide-react';
import { useSecureLink, type PendingOffer } from '../context/SecureLinkContext';
import { fromBase64 } from '../secure/crypto/bytes';
import { fingerprint } from '../secure/peerStore';
import type { TransferProgress } from '../secure/session';
import type { TrustLevel } from '../secure/trustEngine';
import { cn } from '../utils/cn';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const LEVEL_STYLE: Record<TrustLevel, { label: string; color: string; note: string }> = {
  FULL: { label: 'Full access', color: 'var(--success)', note: 'Chat and file sharing allowed.' },
  RESTRICTED: { label: 'Restricted', color: 'var(--warning)', note: 'File sharing paused; chat only. Keys were rotated.' },
  ISOLATED: { label: 'Isolated', color: 'var(--danger)', note: 'Link closed and pairing revoked. Re-pair face to face.' },
};

function Card({ title, icon, children, action }: { title: string; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
          <span className="text-[var(--accent)]">{icon}</span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Button({ children, onClick, tone = 'primary', disabled, className, type = 'button' }: {
  children: ReactNode;
  type?: 'button' | 'submit';
  onClick?: () => void;
  tone?: 'primary' | 'ghost' | 'danger' | 'success';
  disabled?: boolean;
  className?: string;
}) {
  const tones = {
    primary: 'bg-[var(--accent)] text-[#041016] hover:bg-[var(--accent-strong)]',
    ghost: 'border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-white',
    danger: 'border border-[var(--danger)]/50 text-[var(--danger)] hover:bg-[var(--danger)]/10',
    success: 'bg-[var(--success)] text-[#041016] hover:opacity-90',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn('inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50', tones[tone], className)}
    >
      {children}
    </button>
  );
}

function TrustSparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 240;
  const h = 48;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / 100) * h}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-12 w-full" role="img" aria-label="Trust score over the last minute">
      <line x1="0" x2={w} y1={h - 0.7 * h} y2={h - 0.7 * h} stroke="var(--warning)" strokeOpacity="0.35" strokeDasharray="3 4" />
      <line x1="0" x2={w} y1={h - 0.4 * h} y2={h - 0.4 * h} stroke="var(--danger)" strokeOpacity="0.35" strokeDasharray="3 4" />
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function TransferRow({ t }: { t: TransferProgress }) {
  const pct = t.size ? Math.round((t.bytes / t.size) * 100) : 100;
  const bad = t.state === 'failed' || t.state === 'rejected' || t.state === 'cancelled';
  return (
    <li className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="min-w-0 truncate font-medium text-[var(--text)]">{t.direction === 'send' ? '↑' : '↓'} {t.name}</span>
        <span className={cn('shrink-0 text-xs', bad ? 'text-[var(--danger)]' : t.state === 'done' ? 'text-[var(--success)]' : 'text-[var(--text-muted)]')}>
          {t.state.replace('_', ' ')}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-hover)]">
        <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
        {formatBytes(t.bytes)} of {formatBytes(t.size)}
        {t.resumedFrom ? ` · resumed from ${formatBytes(t.resumedFrom)}` : ''}
        {t.reason ? ` · ${t.reason}` : ''}
      </p>
    </li>
  );
}

function OfferCard({ offer, onAnswer }: { offer: PendingOffer; onAnswer: (accept: boolean) => void }) {
  const m = offer.manifest;
  return (
    <div className="rounded-xl border border-[var(--accent)]/40 bg-[var(--accent-soft)] p-3">
      <p className="text-sm font-semibold text-[var(--text)]">Incoming file: {m.name}</p>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        {formatBytes(m.size)} · SHA-256 {m.sha256.slice(0, 12)}…
        {offer.resumeFromBytes > 0 ? ` · resumes from ${formatBytes(offer.resumeFromBytes)}` : ''}
      </p>
      <p className="mt-1 text-[11px] text-[var(--text-muted)]">It goes into quarantine first, is checked, and is never opened automatically.</p>
      <div className="mt-3 flex gap-2">
        <Button tone="success" onClick={() => onAnswer(true)}><CheckCircle className="h-4 w-4" /> Accept</Button>
        <Button tone="ghost" onClick={() => onAnswer(false)}><Ban className="h-4 w-4" /> Decline</Button>
      </div>
    </div>
  );
}

export function SecureShare() {
  const link = useSecureLink();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [nameDraft, setNameDraft] = useState(link.localName);
  const [showLog, setShowLog] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const run = async (label: string, task: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const level = link.trust?.level ?? null;
  const caps = link.trust?.capabilities ?? [];
  const canSendFiles = link.phase === 'active' && (level === null || caps.includes('file_send'));

  return (
    <div className="relative space-y-5 sm:space-y-6">
      <header className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--surface)] via-[var(--surface)] to-[var(--surface-raised)] p-5 sm:p-6">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
          <LockKeyhole className="h-3.5 w-3.5" />
          Secure Share
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)] sm:text-3xl">Phone-to-phone, verified and encrypted</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
          Pair once by comparing a 6-digit code. Every message and file is end-to-end encrypted, and the link is
          re-checked every second: if the other phone starts behaving suspiciously it loses file access first, then is cut off.
        </p>
        {link.ready && (
          <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[var(--text-secondary)]">This phone: <span className="font-mono text-[var(--text)]">{link.myFingerprint}</span></span>
            <span className={cn('rounded-full border px-2.5 py-1', link.keyProtection === 'software' ? 'border-[var(--warning)]/50 text-[var(--warning)]' : 'border-[var(--success)]/50 text-[var(--success)]')}>
              Keys: {link.keyProtection === 'strongbox' ? 'StrongBox hardware' : link.keyProtection === 'keystore' ? 'Android Keystore' : 'software only (browser preview)'}
            </span>
          </div>
        )}
      </header>

      {link.notices.length > 0 && (
        <div className="space-y-2" aria-live="polite">
          {link.notices.map((n) => (
            <div key={n.id} className={cn('flex items-start justify-between gap-3 rounded-xl border p-3 text-sm',
              n.tone === 'danger' ? 'border-[var(--danger)]/50 text-[var(--danger)]'
                : n.tone === 'warning' ? 'border-[var(--warning)]/50 text-[var(--warning)]'
                  : n.tone === 'success' ? 'border-[var(--success)]/50 text-[var(--success)]'
                    : 'border-[var(--border)] text-[var(--text-secondary)]')}
            >
              <span>{n.text}</span>
              <button type="button" aria-label="Dismiss" onClick={() => link.dismissNotice(n.id)} className="shrink-0 p-1"><X className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-[var(--danger)]/50 p-3 text-sm text-[var(--danger)]">
          <span>{error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setError(null)} className="shrink-0 p-1"><X className="h-4 w-4" /></button>
        </div>
      )}

      {!link.supported && (
        <Card title="Open the Android app" icon={<Smartphone className="h-4 w-4" />}>
          <p className="text-sm text-[var(--text-secondary)]">
            Secure Share uses Bluetooth LE channels that only the BlueGuardian Android app (Android 10 or newer) can open.
            Install the APK on two phones, open Secure Share on both, and follow the steps.
          </p>
        </Card>
      )}

      {link.initError && (
        <Card title="Secure Share could not start" icon={<ShieldAlert className="h-4 w-4" />}>
          <p className="text-sm text-[var(--danger)]">{link.initError}</p>
        </Card>
      )}

      {link.supported && link.ready && link.mode === 'idle' && (
        <Card title="Start a secure link" icon={<Link className="h-4 w-4" />}>
          <label className="block text-xs text-[var(--text-muted)]" htmlFor="secure-name">Name shown to the other phone</label>
          <div className="mt-1 flex gap-2">
            <input
              id="secure-name"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => link.setLocalName(nameDraft)}
              maxLength={40}
              className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button type="button" disabled={!!busy} onClick={() => run('host', link.startHosting)}
              className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 text-left transition-colors hover:border-[var(--accent)] disabled:opacity-50">
              <Radio className="h-5 w-5 text-[var(--accent)]" />
              <p className="mt-2 text-sm font-semibold text-[var(--text)]">Receive on this phone</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Makes this phone visible and shows a 4-digit code.</p>
            </button>
            <button type="button" disabled={!!busy} onClick={() => run('discover', link.discover)}
              className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 text-left transition-colors hover:border-[var(--accent)] disabled:opacity-50">
              <Search className="h-5 w-5 text-[var(--accent)]" />
              <p className="mt-2 text-sm font-semibold text-[var(--text)]">Connect to a phone</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Finds a phone that is receiving and connects to it.</p>
            </button>
          </div>
          {link.capabilities && !link.capabilities.l2cap && (
            <p className="mt-3 text-xs text-[var(--warning)]">Secure Share needs Android 10 or newer; this phone reports API level {link.capabilities.sdk}.</p>
          )}
        </Card>
      )}

      {link.mode === 'hosting' && (
        <Card title="Waiting for the other phone" icon={<Radio className="h-4 w-4" />}>
          <p className="text-sm text-[var(--text-secondary)]">On the other phone, open Secure Share → Connect to a phone, and pick the one with this code:</p>
          <p className="mt-3 font-mono text-5xl font-semibold tracking-[0.3em] text-[var(--text)]">{link.hostCode}</p>
          <div className="mt-4 flex items-center gap-3">
            <LoaderCircle className="h-4 w-4 animate-spin text-[var(--accent)]" />
            <span className="text-xs text-[var(--text-muted)]">Visible over Bluetooth while this screen is open.</span>
          </div>
          <Button tone="ghost" className="mt-4" onClick={() => run('stop', link.stopHosting)}>Stop</Button>
        </Card>
      )}

      {(link.mode === 'discovering' || (link.mode === 'idle' && link.hosts.length > 0)) && (
        <Card
          title={link.mode === 'discovering' ? 'Looking for phones…' : 'Phones found'}
          icon={<Search className="h-4 w-4" />}
          action={link.mode === 'idle' ? <Button tone="ghost" onClick={() => run('discover', link.discover)}><RefreshCw className="h-4 w-4" /> Search again</Button> : <LoaderCircle className="h-4 w-4 animate-spin text-[var(--accent)]" />}
        >
          {link.hosts.length === 0 && <p className="text-sm text-[var(--text-muted)]">Make sure the other phone tapped “Receive on this phone”.</p>}
          <ul className="space-y-2">
            {link.hosts.map((h) => (
              <li key={h.address}>
                <button type="button" disabled={!!busy} onClick={() => run('connect', () => link.connectTo(h))}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-left hover:border-[var(--accent)] disabled:opacity-50">
                  <span>
                    <span className="block text-sm font-semibold text-[var(--text)]">Code <span className="font-mono tracking-widest">{h.code}</span></span>
                    <span className="block text-[11px] text-[var(--text-muted)]">{h.address}</span>
                  </span>
                  <span className="flex items-center gap-1 text-xs text-[var(--text-secondary)]"><Signal className="h-3.5 w-3.5" />{h.rssi} dBm</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {link.mode === 'connecting' && (
        <Card title="Connecting…" icon={<LoaderCircle className="h-4 w-4 animate-spin" />}>
          <p className="text-sm text-[var(--text-secondary)]">Opening an encrypted channel to the other phone.</p>
        </Card>
      )}

      {link.mode === 'session' && link.phase === 'handshaking' && (
        <Card title="Exchanging keys…" icon={<LoaderCircle className="h-4 w-4 animate-spin" />}>
          <p className="text-sm text-[var(--text-secondary)]">Running the X25519 / Noise handshake.</p>
        </Card>
      )}

      {link.phase === 'verifying' && link.verify && (
        <Card title={link.verify.repair ? 'Re-pair a revoked device' : link.verify.known ? 'Recognised device' : 'Check the code'} icon={<ShieldCheck className="h-4 w-4" />}>
          {link.verify.known ? (
            <p className="text-sm text-[var(--text-secondary)]">{link.verify.peerName} was paired before; its key matches. Verifying automatically…</p>
          ) : (
            <>
              <p className="text-sm text-[var(--text-secondary)]">
                {link.verify.repair
                  ? `${link.verify.peerName} was isolated earlier. Stand next to it and compare codes; it must also prove the secret from your first pairing.`
                  : `Connected to “${link.verify.peerName}”. Both phones must show exactly the same code.`}
              </p>
              <p className="mt-4 text-center font-mono text-5xl font-semibold tracking-[0.25em] text-[var(--text)]">
                {link.verify.sas.slice(0, 3)} {link.verify.sas.slice(3)}
              </p>
              <p className="mt-2 text-center text-[11px] text-[var(--text-muted)]">Their key fingerprint: {link.verify.peerFingerprint}</p>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <Button tone="success" disabled={!!busy} onClick={() => run('confirm', () => link.confirmCode(true))}><CheckCircle className="h-4 w-4" /> Codes match</Button>
                <Button tone="danger" disabled={!!busy} onClick={() => run('confirm', () => link.confirmCode(false))}><Ban className="h-4 w-4" /> Different</Button>
              </div>
              <p className="mt-3 text-[11px] text-[var(--text-muted)]">Different codes mean someone may be intercepting the connection. Tap “Different” and try again elsewhere.</p>
            </>
          )}
        </Card>
      )}

      {link.phase === 'active' && (
        <>
          <Card
            title={`Secure link with ${link.verify?.peerName ?? 'peer'}`}
            icon={<Lock className="h-4 w-4" />}
            action={<Button tone="ghost" onClick={() => run('disconnect', link.disconnect)}><Unlink className="h-4 w-4" /> Disconnect</Button>}
          >
            <div className="grid gap-4 sm:grid-cols-[auto,1fr] sm:items-center">
              <div className="flex items-center gap-3">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 text-xl font-semibold"
                  style={{ borderColor: level ? LEVEL_STYLE[level].color : 'var(--border)', color: level ? LEVEL_STYLE[level].color : 'var(--text-muted)' }}>
                  {link.trust ? Math.round(link.trust.trust) : '—'}
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: level ? LEVEL_STYLE[level].color : 'var(--text)' }}>{level ? LEVEL_STYLE[level].label : 'Scoring…'}</p>
                  <p className="text-xs text-[var(--text-muted)]">{level ? LEVEL_STYLE[level].note : 'First trust check runs within a second.'}</p>
                </div>
              </div>
              <TrustSparkline values={link.trustHistory} />
            </div>
            {link.trust && (
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
                {([['Crypto', link.trust.risks.crypto], ['Physical', link.trust.risks.proximity], ['Behaviour', link.trust.risks.ml]] as const).map(([label, risk]) => (
                  <div key={label} className="rounded-lg border border-[var(--border)] p-2">
                    <p className="text-[var(--text-muted)]">{label} risk</p>
                    <p className={cn('mt-0.5 font-semibold', risk > 0.3 ? 'text-[var(--danger)]' : 'text-[var(--text)]')}>{Math.round(risk * 100)}%</p>
                  </div>
                ))}
              </div>
            )}
            {link.trust && link.trust.reasons.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-[var(--warning)]">
                {link.trust.reasons.slice(0, 3).map((r) => <li key={r}>• {r}</li>)}
              </ul>
            )}
          </Card>

          {link.offers.map((offer) => (
            <OfferCard key={offer.manifest.id} offer={offer} onAnswer={(accept) => void run('offer', () => link.respondToOffer(offer.manifest.id, accept))} />
          ))}

          <Card title="Send a file" icon={<Shield className="h-4 w-4" />}>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void run('send', () => link.sendFile(file));
              }}
            />
            <Button disabled={!canSendFiles || busy === 'send'} onClick={() => fileInput.current?.click()}>
              {busy === 'send' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Choose file to send
            </Button>
            <p className="mt-2 text-[11px] text-[var(--text-muted)]">
              {canSendFiles
                ? 'Photos, PDFs, documents, audio, video and text up to 100 MB. Apps and scripts are blocked.'
                : 'File sharing is paused while this device is below full trust.'}
            </p>
          </Card>

          <Card title="Messages" icon={<Activity className="h-4 w-4" />}>
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {link.chats.length === 0 && <li className="text-xs text-[var(--text-muted)]">No messages yet.</li>}
              {link.chats.map((m) => (
                <li key={m.id} className={cn('max-w-[85%] rounded-xl px-3 py-2 text-sm', m.from === 'me' ? 'ml-auto bg-[var(--accent-soft)] text-[var(--text)]' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]')}>
                  {m.text}
                </li>
              ))}
            </ul>
            <form className="mt-3 flex gap-2" onSubmit={(e) => {
              e.preventDefault();
              const text = chatDraft.trim();
              if (!text) return;
              setChatDraft('');
              void run('chat', () => link.sendChat(text));
            }}>
              <input value={chatDraft} onChange={(e) => setChatDraft(e.target.value)} placeholder="Encrypted message"
                className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]" />
              <Button type="submit">Send</Button>
            </form>
          </Card>
        </>
      )}

      {link.transfers.length > 0 && (
        <Card title="Transfers" icon={<Activity className="h-4 w-4" />}>
          <ul className="space-y-2">{link.transfers.map((t) => <TransferRow key={t.id} t={t} />)}</ul>
        </Card>
      )}

      {link.supported && link.ready && (
        <Card title="Quarantine (received files)" icon={<Database className="h-4 w-4" />}
          action={<Button tone="ghost" onClick={() => run('refresh', link.refreshQuarantine)}><RefreshCw className="h-4 w-4" /></Button>}>
          <p className="mb-3 text-[11px] text-[var(--text-muted)]">Verified files stay in app-private storage. Nothing is opened automatically; save a file to Downloads only if you expected it.</p>
          {link.quarantine.length === 0 && <p className="text-sm text-[var(--text-muted)]">No received files.</p>}
          <ul className="space-y-2">
            {link.quarantine.map((f) => (
              <li key={f.key} className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
                <p className="truncate text-sm font-medium text-[var(--text)]">{f.name}</p>
                <p className="text-[11px] text-[var(--text-muted)]">{formatBytes(f.size)} · {f.kind} · from {f.from || 'unknown'} · {new Date(f.receivedAt).toLocaleString()}</p>
                <div className="mt-2 flex gap-2">
                  <Button tone="ghost" onClick={() => run('export', async () => { const where = await link.exportFile(f.key); setError(null); window.alert(`Saved to ${where}`); })}>Save to Downloads</Button>
                  <Button tone="danger" onClick={() => run('delete', () => link.deleteFile(f.key))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {link.ready && (
        <Card title="Paired phones" icon={<Smartphone className="h-4 w-4" />}>
          {link.peers.length === 0 && <p className="text-sm text-[var(--text-muted)]">No paired phones yet.</p>}
          <ul className="space-y-2">
            {link.peers.map((p) => {
              let fp = '';
              try { fp = fingerprint(fromBase64(p.staticKey)); } catch { fp = ''; }
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-[var(--text)]">
                      {p.status === 'trusted' ? <ShieldCheck className="h-4 w-4 text-[var(--success)]" /> : <ShieldAlert className="h-4 w-4 text-[var(--danger)]" />}
                      <span className="truncate">{p.name}</span>
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {fp} · {p.status === 'trusted' ? 'trusted' : `revoked: ${p.revokedReason ?? 'needs re-pair'}`}
                      {p.keyEpoch > 0 ? ` · re-paired ${p.keyEpoch}×` : ''}
                    </p>
                  </div>
                  <Button tone="ghost" onClick={() => run('forget', () => link.forgetPeer(p.id))}><Trash2 className="h-4 w-4" /></Button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {link.ready && (
        <Card title="Forensic log" icon={<Activity className="h-4 w-4" />}
          action={<span className={cn('text-[11px] font-medium', link.logValid ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{link.logValid ? 'Hash chain intact' : 'Hash chain BROKEN'}</span>}>
          <p className="text-[11px] text-[var(--text-muted)]">Every security event is chained with SHA-256, so edits or deletions are detectable.</p>
          <div className="mt-3 flex gap-2">
            <Button tone="ghost" onClick={() => setShowLog((v) => !v)}>{showLog ? 'Hide events' : `Show events (${link.log.length})`}</Button>
            <Button tone="ghost" onClick={() => run('copy', async () => { await navigator.clipboard.writeText(link.exportLog()); })}>Copy log</Button>
          </div>
          {showLog && (
            <ul className="mt-3 max-h-80 space-y-1.5 overflow-y-auto font-mono text-[11px]">
              {link.log.map((e) => (
                <li key={e.hash} className="rounded-lg border border-[var(--border)] p-2 text-[var(--text-secondary)]">
                  <span className="text-[var(--text)]">{new Date(e.t).toLocaleTimeString()} {e.event}</span>
                  <span className="text-[var(--text-muted)]"> · {e.peer} · {e.hash.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
