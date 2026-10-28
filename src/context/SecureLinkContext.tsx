import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { fromBase64, toBase64 } from '../secure/crypto/bytes';
import type { KeyPair } from '../secure/crypto/x25519';
import { ForensicLog, localStorageForensicStorage, type ForensicEntry } from '../secure/forensicLog';
import {
  fingerprint, loadOrCreateIdentity, PersistentPeerDirectory, plainWrapper, safeLocalStorage,
  type PeerRecord, type SecretWrapper,
} from '../secure/peerStore';
import type { FileManifest } from '../secure/protocol';
import {
  SecureSession, type ChatMessage, type SessionPhase, type TransferProgress, type VerifyInfo,
} from '../secure/session';
import { TrustEngine, type TrustDecision } from '../secure/trustEngine';
import {
  createKeystoreWrapper, getSecureLinkCapabilities, isSecureLinkSupported, NativeQuarantineSink, newHostCode,
  secureLinkPlugin, type DiscoveredHost, type QuarantineEntry, type SecureLinkCapabilities,
} from '../services/secureLinkNative';

export type LinkMode = 'idle' | 'hosting' | 'discovering' | 'connecting' | 'session';

export interface SecureNotice {
  id: number;
  text: string;
  tone: 'info' | 'warning' | 'danger' | 'success';
  at: number;
}

export interface PendingOffer {
  manifest: FileManifest;
  resumeFromBytes: number;
}

interface SecureLinkState {
  supported: boolean;
  ready: boolean;
  initError: string | null;
  capabilities: SecureLinkCapabilities | null;
  keyProtection: 'strongbox' | 'keystore' | 'software';
  myFingerprint: string;
  localName: string;
  mode: LinkMode;
  hostCode: string | null;
  hosts: DiscoveredHost[];
  phase: SessionPhase | null;
  verify: VerifyInfo | null;
  trust: TrustDecision | null;
  trustHistory: number[];
  chats: ChatMessage[];
  transfers: TransferProgress[];
  offers: PendingOffer[];
  notices: SecureNotice[];
  peers: PeerRecord[];
  quarantine: QuarantineEntry[];
  log: ForensicEntry[];
  logValid: boolean;
}

interface SecureLinkActions {
  setLocalName(name: string): void;
  startHosting(): Promise<void>;
  stopHosting(): Promise<void>;
  discover(): Promise<void>;
  stopDiscovery(): Promise<void>;
  connectTo(host: DiscoveredHost): Promise<void>;
  confirmCode(match: boolean): Promise<void>;
  sendChat(text: string): Promise<void>;
  sendFile(file: File): Promise<void>;
  respondToOffer(id: string, accept: boolean): Promise<void>;
  disconnect(): Promise<void>;
  forgetPeer(id: string): Promise<void>;
  refreshQuarantine(): Promise<void>;
  exportFile(key: string): Promise<string>;
  deleteFile(key: string): Promise<void>;
  dismissNotice(id: number): void;
  exportLog(): string;
}

const SecureLinkContext = createContext<(SecureLinkState & SecureLinkActions) | null>(null);

const NAME_KEY = 'blueguardian.secure-name.v1';
const engine = new TrustEngine();

interface Boot {
  identity: KeyPair & { created: boolean };
  peers: PersistentPeerDirectory;
  log: ForensicLog;
  protection: 'strongbox' | 'keystore' | 'software';
}

let bootPromise: Promise<Boot> | null = null;

/** Load keys once per app run (React StrictMode mounts effects twice in development). */
function boot(supported: boolean): Promise<Boot> {
  if (!bootPromise) {
    bootPromise = (async () => {
      let wrapper: SecretWrapper = plainWrapper;
      let protection: Boot['protection'] = 'software';
      if (supported) {
        wrapper = await createKeystoreWrapper();
        protection = wrapper.strongBox ? 'strongbox' : 'keystore';
      }
      const store = safeLocalStorage();
      const identity = await loadOrCreateIdentity(store, wrapper);
      const peers = await PersistentPeerDirectory.open(store, wrapper);
      const log = new ForensicLog({ storage: localStorageForensicStorage() });
      if (identity.created) log.add('identity_created', 'local', { fingerprint: fingerprint(identity.publicKey), protection });
      return { identity, peers, log, protection };
    })();
    bootPromise.catch(() => { bootPromise = null; });
  }
  return bootPromise;
}

function readName(): string {
  try {
    return globalThis.localStorage?.getItem(NAME_KEY) || 'My BlueGuardian phone';
  } catch {
    return 'My BlueGuardian phone';
  }
}

export function SecureLinkProvider({ children }: { children: ReactNode }) {
  const supported = isSecureLinkSupported();
  const [state, setState] = useState<SecureLinkState>(() => ({
    supported,
    ready: false,
    initError: null,
    capabilities: null,
    keyProtection: 'software',
    myFingerprint: '',
    localName: readName(),
    mode: 'idle',
    hostCode: null,
    hosts: [],
    phase: null,
    verify: null,
    trust: null,
    trustHistory: [],
    chats: [],
    transfers: [],
    offers: [],
    notices: [],
    peers: [],
    quarantine: [],
    log: [],
    logValid: true,
  }));

  const identityRef = useRef<KeyPair | null>(null);
  const peersRef = useRef<PersistentPeerDirectory | null>(null);
  const logRef = useRef<ForensicLog | null>(null);
  const sinkRef = useRef(new NativeQuarantineSink());
  const sessionRef = useRef<SecureSession | null>(null);
  const nameRef = useRef(state.localName);
  const noticeId = useRef(0);
  // Auto-reconnect after a radio drop: the host stays visible with the same code and the
  // sender finds it again (the address can rotate) and reconnects; the pinned peer is
  // verified automatically and an interrupted transfer resumes from its last chunk.
  const roleRef = useRef<'initiator' | 'responder' | null>(null);
  const wasActiveRef = useRef(false);
  const lastHostRef = useRef<DiscoveredHost | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const hostLingerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectRef = useRef<() => void>(() => undefined);

  const patch = useCallback((update: Partial<SecureLinkState> | ((s: SecureLinkState) => Partial<SecureLinkState>)) => {
    setState((s) => ({ ...s, ...(typeof update === 'function' ? update(s) : update) }));
  }, []);

  const notify = useCallback((text: string, tone: SecureNotice['tone'] = 'info') => {
    const id = ++noticeId.current;
    patch((s) => ({ notices: [{ id, text, tone, at: Date.now() }, ...s.notices].slice(0, 6) }));
  }, [patch]);

  const refreshPeers = useCallback(() => {
    patch({ peers: peersRef.current?.list() ?? [] });
  }, [patch]);

  const refreshQuarantine = useCallback(async () => {
    if (!supported) return;
    try {
      patch({ quarantine: await sinkRef.current.list() });
    } catch {
      // ignore; the list is advisory
    }
  }, [patch, supported]);

  // ---------------------------------------------------------------- startup
  useEffect(() => {
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];
    (async () => {
      try {
        const { identity, peers, log, protection } = await boot(supported);
        if (cancelled) return;
        identityRef.current = identity;
        peersRef.current = peers;
        logRef.current = log;
        unsubscribers.push(peers.subscribe(() => { if (!cancelled) refreshPeers(); }));
        unsubscribers.push(log.subscribe(() => { if (!cancelled) patch({ log: log.list().slice(-200).reverse(), logValid: log.verify() }); }));
        const capabilities = await getSecureLinkCapabilities();
        if (cancelled) return;
        patch({
          ready: true,
          capabilities,
          keyProtection: protection,
          myFingerprint: fingerprint(identity.publicKey),
          peers: peers.list(),
          log: log.list().slice(-200).reverse(),
          logValid: log.verify(),
        });
        void refreshQuarantine();
      } catch (error) {
        if (!cancelled) patch({ initError: error instanceof Error ? error.message : 'Secure Link could not start.' });
      }
    })();
    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [patch, refreshPeers, refreshQuarantine, supported]);

  // ------------------------------------------------------- session creation
  const createSession = useCallback((role: 'initiator' | 'responder') => {
    const identity = identityRef.current;
    const peers = peersRef.current;
    const log = logRef.current;
    if (!identity || !peers || !log) throw new Error('Secure Link is still starting.');
    const session = new SecureSession({
      role,
      identity,
      localName: nameRef.current,
      peers,
      engine,
      log,
      sink: sinkRef.current,
      transport: {
        send: (frame) => secureLinkPlugin.send({ data: toBase64(frame) }),
        close: () => secureLinkPlugin.disconnect(),
      },
      events: {
        onPhase: (phase, detail) => {
          if (phase === 'active') {
            wasActiveRef.current = true;
            reconnectAttemptsRef.current = 0;
            if (hostLingerRef.current) { clearTimeout(hostLingerRef.current); hostLingerRef.current = null; }
          }
          if (phase !== 'closed') {
            patch((s) => ({ phase, mode: 'session', hostCode: s.hostCode }));
            return;
          }
          refreshPeers();
          const dropped = Boolean(detail && /^connection lost/.test(detail)) && wasActiveRef.current;
          wasActiveRef.current = false;
          if (dropped && role === 'responder') {
            // Stay visible with the same code for a while so the other phone can come back.
            patch((s) => ({ phase, mode: 'hosting', hostCode: s.hostCode }));
            notify('Connection dropped. Waiting for the other phone to reconnect…', 'info');
            if (hostLingerRef.current) clearTimeout(hostLingerRef.current);
            hostLingerRef.current = setTimeout(() => {
              hostLingerRef.current = null;
              if (sessionRef.current && !sessionRef.current.isClosed) return;
              void secureLinkPlugin.stopHosting().catch(() => undefined);
              patch((s) => (s.mode === 'hosting' ? { mode: 'idle', hostCode: null } : {}));
            }, 45_000);
            return;
          }
          if (dropped && role === 'initiator' && lastHostRef.current && reconnectAttemptsRef.current < 3) {
            patch({ phase, mode: 'connecting' });
            notify('Connection dropped. Reconnecting…', 'info');
            reconnectRef.current();
            return;
          }
          patch({ phase, mode: 'idle', hostCode: null });
          if (detail && detail !== 'closed by user') notify(`Disconnected (${detail}).`, 'info');
          void secureLinkPlugin.stopHosting().catch(() => undefined);
        },
        onVerify: (info) => patch({ verify: info }),
        onTrust: (decision) => patch((s) => ({ trust: decision, trustHistory: [...s.trustHistory, Math.round(decision.trust)].slice(-60) })),
        onChat: (message) => patch((s) => ({ chats: [...s.chats, message].slice(-200) })),
        onOffer: (manifest, resumeFromBytes) => patch((s) => ({ offers: [...s.offers.filter((o) => o.manifest.id !== manifest.id), { manifest, resumeFromBytes }] })),
        onTransfer: (progress) => {
          patch((s) => {
            const others = s.transfers.filter((t) => t.id !== progress.id);
            return { transfers: [progress, ...others].slice(0, 30) };
          });
          if (progress.direction === 'receive' && progress.state === 'done') void refreshQuarantine();
        },
        onNotice: (text, tone) => notify(text, tone),
      },
    });
    sessionRef.current = session;
    roleRef.current = role;
    if (hostLingerRef.current) { clearTimeout(hostLingerRef.current); hostLingerRef.current = null; }
    patch({ phase: 'handshaking', verify: null, trust: null, trustHistory: [], chats: [], offers: [], mode: 'session' });
    return session;
  }, [notify, patch, refreshPeers, refreshQuarantine]);

  // ---------------------------------------------------------- native events
  useEffect(() => {
    if (!supported) return;
    const handles: Promise<PluginListenerHandle>[] = [
      secureLinkPlugin.addListener('linkState', (event) => {
        if (event.state === 'connected') {
          const role = event.role === 'host' ? 'responder' : 'initiator';
          try {
            const session = createSession(role);
            void session.start();
          } catch (error) {
            notify(error instanceof Error ? error.message : 'Couldn’t start the connection.', 'danger');
            void secureLinkPlugin.disconnect();
          }
        } else if (event.state === 'closed') {
          const session = sessionRef.current;
          if (session && !session.isClosed) void session.close(event.message || 'connection lost', false);
        }
      }),
      secureLinkPlugin.addListener('linkFrame', (event) => {
        const session = sessionRef.current;
        if (!session) return;
        try {
          void session.receiveFrame(fromBase64(event.data));
        } catch {
          session.notePairAttempt();
        }
      }),
      secureLinkPlugin.addListener('linkAttempt', () => {
        sessionRef.current?.notePairAttempt();
        logRef.current?.add('connection_attempt_refused', sessionRef.current?.peerId ?? 'unknown', {});
      }),
      secureLinkPlugin.addListener('peerRssi', (event) => {
        sessionRef.current?.setPeerRssi(event.rssi);
      }),
      secureLinkPlugin.addListener('hostFound', (host) => {
        patch((s) => {
          const others = s.hosts.filter((h) => h.address !== host.address);
          return { hosts: [...others, host].sort((a, b) => b.rssi - a.rssi) };
        });
      }),
      secureLinkPlugin.addListener('discoveryState', (event) => {
        if (event.state === 'complete' || event.state === 'error') {
          patch((s) => ({ mode: s.mode === 'discovering' ? 'idle' : s.mode }));
          if (event.message) notify(event.message, 'warning');
        }
      }),
    ];
    return () => {
      for (const handle of handles) void handle.then((h) => h.remove()).catch(() => undefined);
    };
  }, [createSession, notify, patch, supported]);

  // ------------------------------------------------------ auto-reconnect
  useEffect(() => {
    reconnectRef.current = () => {
      const target = lastHostRef.current;
      if (!target) return;
      reconnectAttemptsRef.current += 1;
      const attempt = reconnectAttemptsRef.current;
      void (async () => {
        await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
        let found: DiscoveredHost | null = null;
        let handle: PluginListenerHandle | undefined;
        try {
          // The host's advertising address can change when it becomes visible again,
          // so look for its code rather than its old address.
          const seen = new Promise<DiscoveredHost | null>((resolve) => {
            const timer = setTimeout(() => resolve(null), 12_000);
            void secureLinkPlugin.addListener('hostFound', (host) => {
              if (host.code === target.code) { clearTimeout(timer); resolve(host); }
            }).then((h) => { handle = h; });
          });
          await secureLinkPlugin.discoverHosts({ durationMs: 12_000 });
          found = await seen;
        } catch {
          found = null;
        } finally {
          void secureLinkPlugin.stopDiscovery().catch(() => undefined);
          void handle?.remove().catch(() => undefined);
        }
        try {
          if (!found) throw new Error('not found');
          lastHostRef.current = found;
          await secureLinkPlugin.connect({ address: found.address, psm: found.psm });
        } catch {
          if (reconnectAttemptsRef.current < 3) { reconnectRef.current(); return; }
          patch({ mode: 'idle', hosts: [] });
          notify('Couldn’t reconnect. Make sure the other phone is still on the Receive screen, then connect again.', 'warning');
        }
      })();
    };
  }, [notify, patch]);

  // ----------------------------------------------- continuous trust binding
  useEffect(() => {
    if (state.phase !== 'active') return;
    const timer = setInterval(() => {
      const session = sessionRef.current;
      if (session && !session.isClosed) void session.tick().catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, [state.phase]);

  // ----------------------------------------------------------------- actions
  const requireNative = useCallback(() => {
    if (!supported) throw new Error('Secure Share works in the BlueGuardian Android app (Android 8 or newer).');
  }, [supported]);

  const actions: SecureLinkActions = useMemo(() => ({
    setLocalName(name: string) {
      const clean = name.replace(/[\u0000-\u001f]/g, '').slice(0, 40) || 'My BlueGuardian phone';
      nameRef.current = clean;
      try { globalThis.localStorage?.setItem(NAME_KEY, clean); } catch { /* ignore */ }
      patch({ localName: clean });
    },
    async startHosting() {
      requireNative();
      const code = newHostCode();
      const result = await secureLinkPlugin.startHosting({ code });
      patch({ mode: 'hosting', hostCode: result.code, hosts: [] });
      logRef.current?.add('hosting_started', 'local', { code: result.code });
    },
    async stopHosting() {
      await secureLinkPlugin.stopHosting().catch(() => undefined);
      patch({ mode: 'idle', hostCode: null });
    },
    async discover() {
      requireNative();
      patch({ mode: 'discovering', hosts: [] });
      try {
        const started = await secureLinkPlugin.discoverHosts({ durationMs: 20000 });
        if (started.warning) notify(started.warning, 'warning');
      } catch (error) {
        patch({ mode: 'idle' });
        throw error;
      }
    },
    async stopDiscovery() {
      await secureLinkPlugin.stopDiscovery().catch(() => undefined);
      patch({ mode: 'idle', hosts: [] });
    },
    async connectTo(host: DiscoveredHost) {
      requireNative();
      lastHostRef.current = host;
      reconnectAttemptsRef.current = 0;
      patch({ mode: 'connecting' });
      try {
        await secureLinkPlugin.connect({ address: host.address, psm: host.psm });
      } catch (error) {
        patch({ mode: 'idle' });
        throw error;
      }
    },
    async confirmCode(match: boolean) {
      await sessionRef.current?.confirmVerification(match);
    },
    async sendChat(text: string) {
      const session = sessionRef.current;
      if (!session) throw new Error('No secure link is open.');
      const message = await session.sendChat(text);
      patch((s) => ({ chats: [...s.chats, message].slice(-200) }));
    },
    async sendFile(file: File) {
      const session = sessionRef.current;
      if (!session) throw new Error('No secure link is open.');
      await session.sendFile({
        name: file.name,
        size: file.size,
        type: file.type,
        read: async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
      });
    },
    async respondToOffer(id: string, accept: boolean) {
      patch((s) => ({ offers: s.offers.filter((o) => o.manifest.id !== id) }));
      await sessionRef.current?.respondToOffer(id, accept);
    },
    async disconnect() {
      lastHostRef.current = null;
      wasActiveRef.current = false;
      if (hostLingerRef.current) { clearTimeout(hostLingerRef.current); hostLingerRef.current = null; }
      const session = sessionRef.current;
      if (session && !session.isClosed) await session.close('closed by user', true);
      else await secureLinkPlugin.disconnect().catch(() => undefined);
      await secureLinkPlugin.stopHosting().catch(() => undefined);
      patch({ mode: 'idle', hostCode: null });
    },
    async forgetPeer(id: string) {
      await peersRef.current?.remove(id);
      engine.forget(id);
      logRef.current?.add('peer_forgotten', id, {});
      refreshPeers();
    },
    refreshQuarantine,
    async exportFile(key: string) {
      const location = await sinkRef.current.exportToDownloads(key);
      logRef.current?.add('file_exported', 'local', { key: key.slice(0, 16), location });
      return location;
    },
    async deleteFile(key: string) {
      await sinkRef.current.remove(key);
      logRef.current?.add('file_deleted', 'local', { key: key.slice(0, 16) });
      await refreshQuarantine();
    },
    dismissNotice(id: number) {
      patch((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
    },
    exportLog() {
      return logRef.current?.exportJson() ?? '{}';
    },
  }), [notify, patch, refreshPeers, refreshQuarantine, requireNative]);

  const value = useMemo(() => ({ ...state, ...actions }), [state, actions]);
  return <SecureLinkContext.Provider value={value}>{children}</SecureLinkContext.Provider>;
}

export function useSecureLink() {
  const value = useContext(SecureLinkContext);
  if (!value) throw new Error('useSecureLink must be used inside SecureLinkProvider.');
  return value;
}
