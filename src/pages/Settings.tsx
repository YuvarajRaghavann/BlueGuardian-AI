import { useEffect, useState, type FormEvent } from 'react';
import { Server } from 'lucide-react';
import { AppSettings, IntelSettings } from '../components/SettingsExtras';
import { useSecurity } from '../context/SecurityContext';
import { api } from '../services/api';
import { localDatabase } from '../services/localDatabase';
import { getApiBaseConfig, setApiBaseUrl, type ApiBaseConfig } from '../services/apiBase';
import { Button, Card, Disclosure, Notice, Pill, Toggle } from '../ui/kit';
import { SIMULATOR_ENABLED } from '../config/buildFlags';

const draftFor = (config: ApiBaseConfig) =>
  config.source === 'same-origin' || (config.source === 'build' && config.baseUrl.startsWith('/')) ? '' : config.baseUrl;

export function SettingsPage() {
  const [health, setHealth] = useState<{ status: string; database: string } | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [checkVersion, setCheckVersion] = useState(0);
  const [config, setConfig] = useState<ApiBaseConfig>(() => getApiBaseConfig());
  const [draft, setDraft] = useState(() => draftFor(getApiBaseConfig()));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [storageOk, setStorageOk] = useState<boolean | null>(null);
  const { state: securityState, dispatch } = useSecurity();
  const policy = securityState.policy;

  useEffect(() => {
    let cancelled = false;
    setHealth(null);
    setHealthError(null);
    api.health()
      .then((result) => { if (!cancelled) setHealth(result); })
      .catch((error: unknown) => { if (!cancelled) setHealthError(error instanceof Error ? error.message : 'Server unreachable.'); });
    return () => { cancelled = true; };
  }, [checkVersion]);

  useEffect(() => {
    let cancelled = false;
    localDatabase.listDevices()
      .then(() => { if (!cancelled) setStorageOk(true); })
      .catch(() => { if (!cancelled) setStorageOk(false); });
    return () => { cancelled = true; };
  }, []);

  const toggle = (key: keyof typeof policy) => dispatch({ type: 'SET_POLICY', payload: { [key]: !policy[key] } });

  const applyUrl = (value: string | null, okText: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const next = setApiBaseUrl(value);
      setConfig(next);
      setDraft(draftFor(next));
      setMessage(next.configured ? okText : next.error || 'No server address set.');
      setCheckVersion((v) => v + 1);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Couldn’t save the address.');
    } finally {
      setBusy(false);
    }
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    applyUrl(draft.trim() || null, 'Saved. Checking the connection…');
  };

  const serverState = !config.configured ? { label: 'Not set', color: 'var(--warning)' }
    : healthError ? { label: 'Offline', color: 'var(--danger)' }
      : health?.status === 'ok' ? { label: 'Online', color: 'var(--success)' }
        : { label: 'Checking', color: 'var(--text-muted)' };

  return (
    <div className="space-y-4">
      <AppSettings />

      <Card title="Safety prompts" subtitle="Ask before decisions that change how a device is treated.">
        <div className="space-y-2">
          <Toggle checked={policy.confirmBlock} onChange={() => toggle('confirmBlock')} label="Confirm before blocking" />
          <Toggle checked={policy.confirmTrust} onChange={() => toggle('confirmTrust')} label="Confirm before trusting" />
          <Toggle checked={policy.requireConnectionApproval} onChange={() => toggle('requireConnectionApproval')} label="Approve new connections" hint="Ask before connecting to a device you haven’t trusted." />
          <Toggle checked={policy.showLowConfidenceWarnings} onChange={() => toggle('showLowConfidenceWarnings')} label="Show early warnings" hint="Include alerts that are still uncertain." />
          {SIMULATOR_ENABLED && (
            <Toggle checked={policy.showSimulatedEvents} onChange={() => toggle('showSimulatedEvents')} label="Show sample activity" hint="Demo builds only." />
          )}
        </div>
      </Card>

      <IntelSettings />

      <Disclosure label="Advanced">
        <div className="rounded-2xl bg-[var(--bg-elevated)] p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold"><Server className="h-4 w-4 text-[var(--accent)]" /> Server</p>
            <Pill color={serverState.color}>{serverState.label}</Pill>
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Used for your account and community search.</p>
          <form onSubmit={save} className="mt-3 space-y-2">
            <input
              type="url"
              inputMode="url"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="https://your-server.example.com/api"
              disabled={busy}
              aria-label="Server address"
              className="min-h-11 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
            <p className="break-all text-[11px] text-[var(--text-muted)]">In use: {config.baseUrl || 'none'}</p>
            <div className="flex gap-2">
              <Button size="sm" type="submit" busy={busy}>Save and test</Button>
              <Button size="sm" tone="secondary" disabled={busy} onClick={() => applyUrl(null, 'Using the default server. Checking…')}>Use default</Button>
            </div>
            {message && <p role="status" className="text-xs text-[var(--text-secondary)]">{message}</p>}
            {healthError && config.configured && <Notice tone="danger">{healthError}</Notice>}
            {health && <p className="text-xs text-[var(--text-muted)]">Database: {health.database}</p>}
          </form>
        </div>

        <div className="flex items-center justify-between rounded-2xl bg-[var(--bg-elevated)] px-4 py-3">
          <span className="text-sm font-semibold">On-device storage</span>
          <Pill color={storageOk === null ? 'var(--text-muted)' : storageOk ? 'var(--success)' : 'var(--danger)'}>
            {storageOk === null ? 'Checking' : storageOk ? 'Working' : 'Unavailable'}
          </Pill>
        </div>

        <div className="rounded-2xl bg-[var(--bg-elevated)] p-4">
          <p className="text-sm font-semibold">Managed by Android</p>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">Apps can’t change these system-wide, so BlueGuardian doesn’t pretend to.</p>
          <ul className="mt-2 space-y-1 text-xs text-[var(--text-secondary)]">
            <li>• Fast Pair pop-ups</li>
            <li>• Bluetooth file-transfer prompts</li>
            <li>• Which features earbuds and watches can use</li>
          </ul>
        </div>
      </Disclosure>
    </div>
  );
}
