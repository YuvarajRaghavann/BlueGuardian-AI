import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowDownToLine, ArrowUpFromLine, Check, Download, FileText, LoaderCircle, Lock, MessageSquare, Pencil, Radio,
  RefreshCw, Search, Send, ShieldAlert, ShieldCheck, Smartphone, Trash2, Unlink, X,
} from 'lucide-react';
import { useSecureLink, type PendingOffer } from '../context/SecureLinkContext';
import { fromBase64 } from '../secure/crypto/bytes';
import { fingerprint } from '../secure/peerStore';
import type { TransferProgress } from '../secure/session';
import type { TrustLevel } from '../secure/trustEngine';
import { Button, Card, Disclosure, Empty, Notice, Pill, StepTrack, errorText } from '../ui/kit';
import { cn } from '../utils/cn';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

const LEVEL: Record<TrustLevel, { label: string; color: string; note: string }> = {
  FULL: { label: 'Protected', color: 'var(--success)', note: 'Encrypted and verified. Files and messages are on.' },
  RESTRICTED: { label: 'Checking', color: 'var(--warning)', note: 'Unusual activity. Messages only until it settles.' },
  ISOLATED: { label: 'Blocked', color: 'var(--danger)', note: 'Disconnected for safety. Pair again in person.' },
};

function transferText(t: TransferProgress): { text: string; color: string } {
  const pct = t.size ? Math.round((t.bytes / t.size) * 100) : 100;
  switch (t.state) {
    case 'offered': return { text: 'Waiting for them to accept', color: 'var(--text-muted)' };
    case 'awaiting_approval': return { text: 'Waiting for you to accept', color: 'var(--warning)' };
    case 'transferring': return { text: `${t.direction === 'send' ? 'Sending' : 'Receiving'} · ${pct}%`, color: 'var(--accent)' };
    case 'verifying': return { text: 'Checking file…', color: 'var(--accent)' };
    case 'done': return { text: t.direction === 'send' ? 'Sent' : 'Received · saved to inbox', color: 'var(--success)' };
    case 'rejected': return { text: 'Declined', color: 'var(--text-muted)' };
    case 'cancelled': return { text: t.reason ? `Stopped · ${t.reason}` : 'Stopped', color: 'var(--warning)' };
    default: return { text: t.reason ? `Failed · ${t.reason}` : 'Failed', color: 'var(--danger)' };
  }
}

function TransferRow({ t }: { t: TransferProgress }) {
  const s = transferText(t);
  const pct = t.size ? Math.round((t.bytes / t.size) * 100) : 100;
  const Icon = t.direction === 'send' ? ArrowUpFromLine : ArrowDownToLine;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-raised)] text-[var(--text-secondary)]"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-semibold">{t.name}</p>
          <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{formatBytes(t.size)}</span>
        </div>
        {(t.state === 'transferring' || t.state === 'verifying') && (
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-hover)]">
            <motion.div className="h-full rounded-full bg-[var(--accent)]" animate={{ width: `${pct}%` }} transition={{ ease: 'easeOut' }} />
          </div>
        )}
        <p className="mt-1 truncate text-xs" style={{ color: s.color }}>{s.text}</p>
      </div>
    </li>
  );
}

function OfferCard({ offer, onAnswer, busy }: { offer: PendingOffer; onAnswer: (accept: boolean) => void; busy: boolean }) {
  const m = offer.manifest;
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl bg-[var(--accent-soft)] p-4 ring-1 ring-[var(--border-strong)]">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--bg-elevated)] text-[var(--accent)]"><FileText className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold">{m.name}</p>
          <p className="text-xs text-[var(--text-secondary)]">{formatBytes(m.size)}{offer.resumeFromBytes > 0 ? ` · resumes at ${formatBytes(offer.resumeFromBytes)}` : ''}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button tone="secondary" disabled={busy} onClick={() => onAnswer(false)}>Decline</Button>
        <Button tone="success" disabled={busy} icon={<Check className="h-4 w-4" />} onClick={() => onAnswer(true)}>Accept</Button>
      </div>
    </motion.div>
  );
}

function Pulse({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <div className="relative mx-auto grid h-36 w-36 place-items-center">
      {!reduce && [0, 1].map((i) => (
        <motion.span key={i} className="absolute inset-0 rounded-full border-2 border-[var(--accent)]"
          initial={{ scale: 0.6, opacity: 0.5 }} animate={{ scale: 1.25, opacity: 0 }}
          transition={{ duration: 2.2, repeat: Infinity, delay: i * 1.1, ease: 'easeOut' }} />
      ))}
      <span className="relative grid h-24 w-24 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">{children}</span>
    </div>
  );
}

export function SecureShare() {
  const link = useSecureLink();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(link.localName);
  const [queue, setQueue] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'nearest' }); }, [link.chats.length, chatOpen]);
  useEffect(() => { setNameDraft(link.localName); }, [link.localName]);

  // A search that ends with no phones gets a clear hint instead of silently resetting.
  const [noPhone, setNoPhone] = useState(false);
  const prevMode = useRef(link.mode);
  useEffect(() => {
    if (prevMode.current === 'discovering' && link.mode === 'idle' && link.hosts.length === 0) setNoPhone(true);
    if (link.mode !== 'idle') setNoPhone(false);
    prevMode.current = link.mode;
  }, [link.mode, link.hosts.length]);

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

  /** Sends the chosen files one after another; the screen stays usable meanwhile. */
  const sendFiles = async (files: File[]) => {
    setError(null);
    setQueue((n) => n + files.length);
    for (const file of files) {
      try {
        await link.sendFile(file);
      } catch (e) {
        setError(`${file.name}: ${errorText(e)}`);
      } finally {
        setQueue((n) => Math.max(0, n - 1));
      }
    }
  };

  const level = link.trust?.level ?? null;
  const canSendFiles = link.phase === 'active' && (level === null || (link.trust?.capabilities ?? []).includes('file_send'));
  const inSession = link.mode === 'session' || link.phase === 'verifying' || link.phase === 'active' || link.phase === 'handshaking';
  const stage = link.phase === 'active' ? 2 : link.phase === 'verifying' ? 1 : 0;
  const peer = link.verify?.peerName ?? 'the other phone';

  return (
    <div className="space-y-5">
      {/* Notices from the connection and this screen */}
      <AnimatePresence initial={false}>
        {link.notices.slice(0, 2).map((n) => (
          <motion.div key={n.id} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Notice tone={n.tone} onDismiss={() => link.dismissNotice(n.id)}>{n.text}</Notice>
          </motion.div>
        ))}
      </AnimatePresence>
      {error && <Notice tone="danger" onDismiss={() => setError(null)}>{error}</Notice>}
      {saved && <Notice tone="success" onDismiss={() => setSaved(null)}>Saved to {saved}</Notice>}

      {!link.supported && (
        <Empty icon={<Smartphone className="h-6 w-6" />} title="Available in the Android app">
          Install BlueGuardian on both phones (Android 10 or newer) to share files securely.
        </Empty>
      )}
      {link.initError && <Notice tone="danger">{link.initError}</Notice>}
      {link.capabilities && !link.capabilities.l2cap && (
        <Notice tone="warning">Secure Share needs Android 10 or newer.</Notice>
      )}

      {/* ------------------------------------------------------------ start */}
      {link.supported && link.ready && link.mode === 'idle' && !inSession && link.hosts.length === 0 && (
        <>
          <div className="text-center">
            <h2 className="text-[22px] font-extrabold">Share files privately</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Phone to phone over Bluetooth. Encrypted, no internet needed.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button type="button" disabled={Boolean(busy)} onClick={() => void run('discover', link.discover)}
              className="tap flex flex-col items-center gap-3 rounded-3xl bg-[var(--accent)] p-5 text-white shadow-[0_14px_36px_rgba(140,124,255,0.3)] disabled:opacity-60">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/15"><Send className="h-7 w-7" /></span>
              <span className="text-base font-bold">Send</span>
              <span className="text-xs text-white/80">Find the other phone</span>
            </button>
            <button type="button" disabled={Boolean(busy)} onClick={() => void run('host', link.startHosting)}
              className="tap flex flex-col items-center gap-3 rounded-3xl bg-[var(--surface)] p-5 disabled:opacity-60">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]"><ArrowDownToLine className="h-7 w-7" /></span>
              <span className="text-base font-bold">Receive</span>
              <span className="text-xs text-[var(--text-muted)]">Show a code to connect</span>
            </button>
          </div>
          <p className="text-center text-xs text-[var(--text-muted)]">Once connected, both phones can send.</p>

          <div className="flex items-center justify-between rounded-2xl bg-[var(--surface)] px-4 py-3">
            {editingName ? (
              <form className="flex w-full items-center gap-2" onSubmit={(e) => { e.preventDefault(); link.setLocalName(nameDraft); setEditingName(false); }}>
                <input autoFocus value={nameDraft} maxLength={40} onChange={(e) => setNameDraft(e.target.value)}
                  className="min-h-10 flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 text-sm outline-none focus:border-[var(--accent)]" />
                <Button size="sm" type="submit">Save</Button>
              </form>
            ) : (
              <>
                <span className="min-w-0 text-sm text-[var(--text-secondary)]">Shown as <b className="text-[var(--text)]">{link.localName}</b></span>
                <button type="button" onClick={() => setEditingName(true)} className="flex items-center gap-1 text-sm font-semibold text-[var(--accent)]"><Pencil className="h-3.5 w-3.5" /> Edit</button>
              </>
            )}
          </div>
        </>
      )}

      {/* ---------------------------------------------------------- receive */}
      {link.mode === 'hosting' && (
        <Card className="text-center">
          <Pulse><Radio className="h-9 w-9" /></Pulse>
          <p className="mt-4 text-sm text-[var(--text-secondary)]">On the other phone, tap <b className="text-[var(--text)]">Send</b> and choose</p>
          <p className="font-display mt-2 text-5xl font-semibold tracking-[0.3em]">{link.hostCode}</p>
          <p className="mt-3 text-xs text-[var(--text-muted)]">Keep this screen open.</p>
          <Button tone="secondary" className="mt-4" onClick={() => void run('stop', link.stopHosting)}>Cancel</Button>
        </Card>
      )}

      {/* ------------------------------------------------------------- send */}
      {(link.mode === 'discovering' || (link.mode === 'idle' && link.hosts.length > 0) || link.mode === 'connecting') && !inSession && (
        <Card
          title={link.mode === 'connecting' ? 'Connecting…' : link.mode === 'discovering' ? 'Looking for phones…' : 'Choose the phone'}
          subtitle={link.mode === 'connecting' ? 'This takes a few seconds.' : 'Pick the code shown on the other phone.'}
          action={link.mode === 'idle'
            ? <Button tone="ghost" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void run('discover', link.discover)}>Search again</Button>
            : <LoaderCircle className="h-5 w-5 animate-spin text-[var(--accent)]" />}
        >
          {link.hosts.length === 0 ? (
            link.mode === 'discovering' ? (
              <div className="py-4"><Pulse><Search className="h-9 w-9" /></Pulse></div>
            ) : null
          ) : (
            <ul className="grid grid-cols-2 gap-2">
              {link.hosts.map((h) => (
                <li key={h.address}>
                  <button type="button" disabled={Boolean(busy) || link.mode === 'connecting'} onClick={() => void run('connect', () => link.connectTo(h))}
                    className="tap flex w-full flex-col items-center rounded-2xl bg-[var(--bg-elevated)] p-4 ring-1 ring-[var(--border)] hover:ring-[var(--accent)] disabled:opacity-60">
                    <span className="font-display text-3xl font-semibold tracking-[0.2em]">{h.code}</span>
                    <span className="mt-1 text-[11px] text-[var(--text-muted)]">{h.rssi > -65 ? 'Very close' : h.rssi > -80 ? 'Nearby' : 'Far away'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {link.mode !== 'connecting' && (
            <Button tone="ghost" size="sm" className="mt-3 w-full" onClick={() => { prevMode.current = 'idle'; void link.stopDiscovery(); }}>Cancel</Button>
          )}
        </Card>
      )}
      {noPhone && link.mode === 'idle' && !inSession && (
        <Notice tone="info" onDismiss={() => setNoPhone(false)}>No phone found. Make sure the other phone tapped Receive and is close by, then tap Send again.</Notice>
      )}

      {/* ---------------------------------------------------------- session */}
      {inSession && (
        <div className="rounded-3xl bg-[var(--surface)] p-4">
          <StepTrack steps={['Connect', 'Confirm', 'Share']} current={stage} />
        </div>
      )}

      {link.mode === 'session' && link.phase === 'handshaking' && (
        <Card className="text-center">
          <Pulse><Lock className="h-9 w-9" /></Pulse>
          <p className="mt-3 font-semibold">Securing the connection…</p>
        </Card>
      )}

      {link.phase === 'verifying' && link.verify && (
        <Card className="text-center">
          {link.verify.known ? (
            <>
              <Pulse><ShieldCheck className="h-9 w-9" /></Pulse>
              <p className="mt-3 font-semibold">Reconnecting to {link.verify.peerName}…</p>
            </>
          ) : (
            <>
              <p className="text-sm text-[var(--text-secondary)]">
                {link.verify.repair ? `Pair ${link.verify.peerName} again. ` : ''}Check that <b className="text-[var(--text)]">{link.verify.peerName}</b> shows the same code
              </p>
              <p className="font-display my-5 text-5xl font-semibold tracking-[0.2em]">
                {link.verify.sas.slice(0, 3)} {link.verify.sas.slice(3)}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button tone="danger" disabled={Boolean(busy)} onClick={() => void run('confirm', () => link.confirmCode(false))}>Different</Button>
                <Button tone="success" disabled={Boolean(busy)} icon={<Check className="h-4 w-4" />} onClick={() => void run('confirm', () => link.confirmCode(true))}>Same code</Button>
              </div>
              <p className="mt-3 text-[11px] text-[var(--text-muted)]">You only do this once per phone.</p>
            </>
          )}
        </Card>
      )}

      {link.phase === 'active' && (
        <>
          <div className="flex items-center gap-3 rounded-3xl bg-[var(--surface)] p-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl" style={{ background: `color-mix(in srgb, ${level ? LEVEL[level].color : 'var(--accent)'} 16%, transparent)`, color: level ? LEVEL[level].color : 'var(--accent)' }}>
              {level === 'FULL' || level === null ? <ShieldCheck className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold">{peer}</p>
              <p className="text-xs text-[var(--text-muted)]">{level ? LEVEL[level].note : 'Encrypted and verified.'}</p>
            </div>
            <Pill color={level ? LEVEL[level].color : 'var(--success)'}>{level ? LEVEL[level].label : 'Protected'}</Pill>
          </div>

          {link.offers.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-[15px] font-bold">Incoming {link.offers.length === 1 ? 'file' : `files (${link.offers.length})`}</h2>
                {link.offers.length > 1 && (
                  <button type="button" disabled={Boolean(busy)} className="text-sm font-semibold text-[var(--accent)]"
                    onClick={() => void run('offer', async () => { for (const o of link.offers) await link.respondToOffer(o.manifest.id, true); })}>
                    Accept all
                  </button>
                )}
              </div>
              <AnimatePresence initial={false}>
                {link.offers.map((offer) => (
                  <OfferCard key={offer.manifest.id} offer={offer} busy={busy === 'offer'} onAnswer={(accept) => void run('offer', () => link.respondToOffer(offer.manifest.id, accept))} />
                ))}
              </AnimatePresence>
            </section>
          )}

          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length) void sendFiles(files);
            }}
          />
          <Button size="lg" className="w-full" disabled={!canSendFiles} icon={queue > 0 ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <ArrowUpFromLine className="h-5 w-5" />}
            onClick={() => fileInput.current?.click()}>
            {queue > 0 ? `Sending ${queue} file${queue === 1 ? '' : 's'}… add more` : 'Send files'}
          </Button>
          <p className="-mt-2 text-center text-xs text-[var(--text-muted)]">
            {canSendFiles ? 'Photos, documents, audio and video up to 100 MB each. Apps are blocked.' : 'File sharing resumes once the connection settles.'}
          </p>

          <div className="grid grid-cols-2 gap-2">
            <Button tone="secondary" icon={<MessageSquare className="h-4 w-4" />} onClick={() => setChatOpen((v) => !v)}>
              {chatOpen ? 'Hide messages' : `Messages${link.chats.length ? ` (${link.chats.length})` : ''}`}
            </Button>
            <Button tone="danger" icon={<Unlink className="h-4 w-4" />} onClick={() => void run('disconnect', link.disconnect)}>Disconnect</Button>
          </div>

          <AnimatePresence initial={false}>
            {chatOpen && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="rounded-3xl bg-[var(--surface)] p-4">
                  <ul className="max-h-64 space-y-2 overflow-y-auto">
                    {link.chats.length === 0 && <li className="py-4 text-center text-xs text-[var(--text-muted)]">No messages yet. Messages are encrypted too.</li>}
                    {link.chats.map((m) => (
                      <li key={m.id} className={cn('max-w-[85%] rounded-2xl px-3 py-2 text-sm', m.from === 'me' ? 'ml-auto bg-[var(--accent)] text-white' : 'bg-[var(--bg-elevated)] text-[var(--text)]')}>{m.text}</li>
                    ))}
                    <div ref={chatEnd} />
                  </ul>
                  <form className="mt-3 flex gap-2" onSubmit={(e) => {
                    e.preventDefault();
                    const text = chatDraft.trim();
                    if (!text) return;
                    setChatDraft('');
                    void run('chat', () => link.sendChat(text));
                  }}>
                    <input value={chatDraft} onChange={(e) => setChatDraft(e.target.value)} placeholder="Message"
                      className="min-h-11 w-full rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]" />
                    <Button type="submit" icon={<Send className="h-4 w-4" />}>Send</Button>
                  </form>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {inSession && link.phase !== 'active' && (
        <Button tone="ghost" className="w-full" onClick={() => void run('disconnect', link.disconnect)}>Cancel</Button>
      )}

      {/* -------------------------------------------------------- transfers */}
      {link.transfers.length > 0 && (
        <section>
          <h2 className="mb-2.5 px-1 text-[15px] font-bold">Transfers</h2>
          <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-3xl bg-[var(--surface)]">
            {link.transfers.map((t) => <TransferRow key={t.id} t={t} />)}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------------------ inbox */}
      {link.supported && link.ready && (
        <section>
          <div className="mb-2.5 flex items-center justify-between px-1">
            <h2 className="text-[15px] font-bold">Received files</h2>
            <button type="button" onClick={() => void link.refreshQuarantine()} aria-label="Refresh" className="tap rounded-full p-2 text-[var(--text-muted)]"><RefreshCw className="h-4 w-4" /></button>
          </div>
          {link.quarantine.length === 0 ? (
            <p className="rounded-3xl bg-[var(--surface)] px-4 py-4 text-sm text-[var(--text-muted)]">Files you receive are checked and kept here. Nothing opens automatically.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-3xl bg-[var(--surface)]">
              {link.quarantine.map((f) => (
                <li key={f.key} className="flex items-center gap-3 px-4 py-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--success)]/15 text-[var(--success)]"><FileText className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{f.name}</p>
                    <p className="truncate text-xs text-[var(--text-muted)]">{formatBytes(f.size)} · from {f.from || 'unknown'} · checked</p>
                  </div>
                  <button type="button" aria-label={`Save ${f.name} to Downloads`} disabled={Boolean(busy)}
                    onClick={() => void run(`save:${f.key}`, async () => { setSaved(await link.exportFile(f.key)); })}
                    className="tap grid h-10 w-10 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)] disabled:opacity-50">
                    {busy === `save:${f.key}` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  </button>
                  <button type="button" aria-label={`Delete ${f.name}`} disabled={Boolean(busy)}
                    onClick={() => void run(`delete:${f.key}`, () => link.deleteFile(f.key))}
                    className="tap grid h-10 w-10 place-items-center rounded-full text-[var(--text-muted)] disabled:opacity-50">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ---------------------------------------------------------- details */}
      {link.ready && (
        <Disclosure label="Details">
          {link.phase === 'active' && link.trust && (
            <div className="rounded-2xl bg-[var(--bg-elevated)] p-4">
              <p className="text-sm font-semibold">Connection check</p>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">Re-checked every second. Score {Math.round(link.trust.trust)}/100.</p>
              <TrustSparkline values={link.trustHistory} />
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px]">
                {([['Encryption', link.trust.risks.crypto], ['Signal', link.trust.risks.proximity], ['Behaviour', link.trust.risks.ml]] as const).map(([label, risk]) => (
                  <div key={label} className="rounded-xl bg-[var(--surface)] p-2">
                    <p className="text-[var(--text-muted)]">{label}</p>
                    <p className={cn('mt-0.5 font-semibold', risk > 0.3 ? 'text-[var(--danger)]' : 'text-[var(--success)]')}>{risk > 0.3 ? 'Check' : 'OK'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl bg-[var(--bg-elevated)] p-4 text-xs leading-5 text-[var(--text-secondary)]">
            <p>This phone’s ID: <span className="font-mono text-[var(--text)]">{link.myFingerprint}</span></p>
            <p className="mt-1">Keys protected by {link.keyProtection === 'strongbox' ? 'StrongBox hardware' : link.keyProtection === 'keystore' ? 'Android Keystore' : 'software (preview only)'}.</p>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold">Paired phones</p>
            {link.peers.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">None yet.</p>
            ) : (
              <ul className="space-y-2">
                {link.peers.map((p) => {
                  let fp = '';
                  try { fp = fingerprint(fromBase64(p.staticKey)); } catch { fp = ''; }
                  return (
                    <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-[var(--bg-elevated)] px-3 py-2.5">
                      {p.status === 'trusted' ? <ShieldCheck className="h-4 w-4 shrink-0 text-[var(--success)]" /> : <ShieldAlert className="h-4 w-4 shrink-0 text-[var(--danger)]" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block truncate text-[11px] text-[var(--text-muted)]">{p.status === 'trusted' ? fp : 'Needs pairing again in person'}</span>
                      </span>
                      <button type="button" aria-label={`Forget ${p.name}`} onClick={() => void run('forget', () => link.forgetPeer(p.id))} className="tap rounded-full p-2 text-[var(--text-muted)]"><X className="h-4 w-4" /></button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <SecurityLog />
        </Disclosure>
      )}
    </div>
  );
}

function TrustSparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 240;
  const h = 40;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / 100) * h}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-10 w-full" role="img" aria-label="Connection score over the last minute">
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function SecurityLog() {
  const link = useSecureLink();
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Security log</p>
        <Pill color={link.logValid ? 'var(--success)' : 'var(--danger)'}>{link.logValid ? 'Intact' : 'Tampered'}</Pill>
      </div>
      <p className="mt-0.5 text-xs text-[var(--text-muted)]">Every event is chained, so edits are detectable.</p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" tone="secondary" onClick={() => setShow((v) => !v)}>{show ? 'Hide' : `Show ${link.log.length} events`}</Button>
        <Button size="sm" tone="secondary" onClick={() => void navigator.clipboard.writeText(link.exportLog()).then(() => setCopied(true)).catch(() => undefined)}>{copied ? 'Copied' : 'Copy log'}</Button>
      </div>
      {show && (
        <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto font-mono text-[11px]">
          {link.log.map((e) => (
            <li key={e.hash} className="rounded-xl bg-[var(--bg-elevated)] px-2.5 py-1.5 text-[var(--text-secondary)]">
              <span className="text-[var(--text)]">{new Date(e.t).toLocaleTimeString()} {e.event.replace(/_/g, ' ')}</span>
              <span className="text-[var(--text-muted)]"> · {e.hash.slice(0, 8)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
