import { useEffect, useState, type FormEvent } from 'react';
import {
  Settings,
  Brain,
  Shield,
  Bell,
  Eye,
  RefreshCw,
  Cpu,
  Lock,
} from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge';
import { getModelStatus, getCurrentModelMetadata, availableModels } from '../ml/mlService';
import { useSecurity } from '../context/SecurityContext';
import { api } from '../services/api';
import { localDatabase } from '../services/localDatabase';
import { getApiBaseConfig, setApiBaseUrl, type ApiBaseConfig } from '../services/apiBase';

export function SettingsPage() {
  const modelStatus = getModelStatus();
  const modelMetadata = getCurrentModelMetadata();
  const models = availableModels();
  const [backendHealth, setBackendHealth] = useState<{ status: string; database: string } | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [backendCheckVersion, setBackendCheckVersion] = useState(0);
  const [apiBaseConfig, setApiBaseConfigState] = useState<ApiBaseConfig>(() => getApiBaseConfig());
  const [apiBaseDraft, setApiBaseDraft] = useState(() => {
    const config = getApiBaseConfig();
    return config.source === 'same-origin' || (config.source === 'build' && config.baseUrl.startsWith('/'))
      ? ''
      : config.baseUrl;
  });
  const [apiBaseBusy, setApiBaseBusy] = useState(false);
  const [apiBaseMessage, setApiBaseMessage] = useState<string | null>(null);
  const [localStorageAvailable, setLocalStorageAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.health()
      .then(result => {
        if (!cancelled) {
          setBackendHealth(result);
          setBackendError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setBackendHealth(null);
          setBackendError(error instanceof Error ? error.message : 'Backend health check failed.');
        }
      });
    return () => { cancelled = true; };
  }, [backendCheckVersion]);

  useEffect(() => {
    let cancelled = false;
    localDatabase.listDevices()
      .then(() => {
        if (!cancelled) setLocalStorageAvailable(true);
      })
      .catch(() => {
        if (!cancelled) setLocalStorageAvailable(false);
      });
    return () => { cancelled = true; };
  }, []);

  const { state: securityState, dispatch } = useSecurity();
  const policy = securityState.policy;

  const togglePolicy = (key: keyof typeof policy) => {
    dispatch({
      type: 'SET_POLICY',
      payload: { [key]: !policy[key] },
    });
  };

  const handleSaveApiBase = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setApiBaseBusy(true);
    setApiBaseMessage(null);
    try {
      const next = setApiBaseUrl(apiBaseDraft.trim() || null);
      setApiBaseConfigState(next);
      setApiBaseDraft(next.source === 'same-origin' || (next.source === 'build' && next.baseUrl.startsWith('/'))
        ? ''
        : next.baseUrl);
      setApiBaseMessage(next.configured
        ? 'Backend URL saved on this device. Checking the health endpoint…'
        : next.error || 'No remote backend URL is configured.');
      setBackendCheckVersion((version) => version + 1);
    } catch (error: unknown) {
      setApiBaseMessage(error instanceof Error ? error.message : 'The backend URL could not be saved.');
    } finally {
      setApiBaseBusy(false);
    }
  };

  const handleResetApiBase = () => {
    setApiBaseBusy(true);
    setApiBaseMessage(null);
    try {
      const next = setApiBaseUrl(null);
      setApiBaseConfigState(next);
      setApiBaseDraft(next.source === 'same-origin' || (next.source === 'build' && next.baseUrl.startsWith('/'))
        ? ''
        : next.baseUrl);
      setApiBaseMessage(next.configured
        ? 'Using the default backend configuration. Checking connectivity…'
        : 'The Android app has no default remote endpoint. Enter your deployed HTTPS backend URL.');
      setBackendCheckVersion((version) => version + 1);
    } catch (error: unknown) {
      setApiBaseMessage(error instanceof Error ? error.message : 'The backend URL could not be reset.');
    } finally {
      setApiBaseBusy(false);
    }
  };

  const policyItems = [
    {
      key: 'confirmBlock' as const,
      available: true,
      icon: Shield,
      title: 'Confirm before blocking device',
      description: 'Require explicit confirmation for BLOCK actions.',
    },
    {
      key: 'confirmTrust' as const,
      available: true,
      icon: Shield,
      title: 'Confirm before trusting device',
      description: 'Require explicit confirmation for TRUST actions.',
    },
    {
      key: 'requireConnectionApproval' as const,
      available: false,
      icon: Lock,
      title: 'Require connection approval',
      description: 'Unknown and medium-risk devices must be explicitly approved before pairing.',
    },
    {
      key: 'enforceFastPairApproval' as const,
      available: false,
      icon: Bell,
      title: 'Protect Fast Pair / quick-connect',
      description: 'Disable silent auto-approval for nearby devices with weak trust or risky profiles.',
    },
    {
      key: 'blockUnknownFileTransfers' as const,
      available: false,
      icon: Eye,
      title: 'Block unknown file transfers',
      description: 'Reject file exchanges from untrusted devices or suspicious payload types.',
    },
    {
      key: 'enableRssiGuard' as const,
      available: false,
      icon: RefreshCw,
      title: 'Enable RSSI anomaly guard',
      description: 'Flag sudden proximity spikes or unusual signal patterns as suspicious.',
    },
    {
      key: 'restrictWearablesToAudio' as const,
      available: false,
      icon: Cpu,
      title: 'Restrict wearables to audio-only mode',
      description: 'Limit headphones and wearables to the safest profile unless explicitly trusted.',
    },
    {
      key: 'showLowConfidenceWarnings' as const,
      available: true,
      icon: Eye,
      title: 'Show low-confidence AI warnings',
      description: 'Display warnings when model confidence is below threshold.',
    },
    {
      key: 'showSimulatedEvents' as const,
      available: true,
      icon: Bell,
      title: 'Show simulated security events',
      description: 'Mark simulated events in the audit log and timeline.',
    },
  ];

  return (
    <div className="relative space-y-6 sm:space-y-7">
      {/* Header */}
      <header className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--surface)] via-[var(--surface)] to-[var(--surface-raised)] p-5 shadow-[0_12px_32px_rgba(0,0,0,0.14)] sm:p-6">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
          <Settings className="h-3.5 w-3.5" />
          System configuration
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)] sm:text-3xl">
          Settings
        </h1>

        <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
          Configure BlueGuardian protection policies and review the
          current analysis environment.
        </p>
      </header>

      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_8px_28px_rgba(0,0,0,0.12)] transition-all duration-200 hover:border-[var(--accent)]/25">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-[var(--text)]">Backend endpoint</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--text-muted)]">
            Configure where this app sends health, device, threat, action, event and recovery API requests. The endpoint is saved on this device and is not a secret. For the Android APK, use the deployed backend’s HTTPS URL. If you omit the trailing <code>/api</code>, BlueGuardian adds it automatically.
          </p>
        </div>
        <form onSubmit={handleSaveApiBase} className="space-y-3">
          <label className="block text-sm text-[var(--text-secondary)]">
            Backend API base URL
            <input
              type="url"
              inputMode="url"
              value={apiBaseDraft}
              onChange={(event) => setApiBaseDraft(event.target.value)}
              placeholder="https://your-backend.example.com/api"
              disabled={apiBaseBusy}
              className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
              aria-describedby="backend-url-help"
            />
          </label>
          <p id="backend-url-help" className="text-xs leading-5 text-[var(--text-muted)]">
            Active endpoint: <span className="break-all font-mono">{apiBaseConfig.baseUrl || 'Not configured for this Android build'}</span>
            {' · '}
            {apiBaseConfig.source === 'device' ? 'Saved on this device' : apiBaseConfig.source === 'build' ? 'Build configuration' : apiBaseConfig.source === 'same-origin' ? 'Browser same-origin /api proxy' : 'Configuration required'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={apiBaseBusy}
              className="min-h-10 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-slate-950 disabled:opacity-50"
            >
              {apiBaseBusy ? 'Saving…' : 'Save and test backend'}
            </button>
            <button
              type="button"
              onClick={handleResetApiBase}
              disabled={apiBaseBusy}
              className="min-h-10 rounded-lg border border-[var(--border)] px-4 text-sm font-semibold text-[var(--text)] disabled:opacity-50"
            >
              Use default
            </button>
          </div>
          {apiBaseMessage && <p role="status" className="text-xs leading-5 text-[var(--text-secondary)]">{apiBaseMessage}</p>}
          <p className="text-xs leading-5 text-[var(--text-muted)]">
            The server must allow the Capacitor Android WebView origin <code>https://localhost</code> in <code>BLUEGUARDIAN_CORS_ORIGINS</code>. The current owner-token backend is for development only; protected APIs deliberately fail closed in production until OIDC/JWKS identity verification is configured.
          </p>
        </form>
      </section>

      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_8px_28px_rgba(0,0,0,0.12)] transition-all duration-200 hover:border-[var(--accent)]/25">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text)]">Backend and database</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Live result from the configured, unauthenticated `/api/health` endpoint.</p>
          </div>
          <StatusBadge
            label={!apiBaseConfig.configured ? 'SETUP REQUIRED' : backendError ? 'UNAVAILABLE' : backendHealth?.status.toUpperCase() ?? 'CHECKING'}
            variant={!apiBaseConfig.configured ? 'warning' : backendError ? 'danger' : backendHealth?.status === 'ok' ? 'success' : 'warning'}
          />
        </div>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          Database: {backendHealth?.database ?? (backendError ? 'unknown' : 'checking')}
        </p>
        {backendError && <p role="alert" className="mt-2 text-xs text-[var(--danger)]">{backendError}</p>}
      </section>

      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_8px_28px_rgba(0,0,0,0.12)] transition-all duration-200 hover:border-[var(--accent)]/25">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text)]">Browser-local records</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">
              Device observations and development assessments remain available in IndexedDB. After an owner token is successfully verified on the Device Recovery page, supported device, threat and security-action workflows can also synchronize through the configured owner-scoped backend. Local data remains available if the remote service is unavailable.
            </p>
          </div>
          <StatusBadge
            label={localStorageAvailable === null ? 'CHECKING' : localStorageAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}
            variant={localStorageAvailable === null ? 'warning' : localStorageAvailable ? 'success' : 'danger'}
          />
        </div>
      </section>

      {/* Model configuration */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_8px_28px_rgba(0,0,0,0.12)] transition-all duration-200 hover:border-[var(--accent)]/25 shadow-[0_8px_28px_rgba(0,0,0,0.12)] transition-all duration-200 hover:border-[var(--accent)]/25 sm:p-6">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)]">
                <Brain className="h-5 w-5 text-[var(--accent)]" />
              </div>

              <div>
                <h2 className="text-sm font-semibold text-[var(--text)]">
                  AI / ML Configuration
                </h2>

                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Current threat-analysis integration
                </p>
              </div>
            </div>

            <StatusBadge
              label="DEVELOPMENT MODEL"
              variant="warning"
            />
          </div>

          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2">
            <div className="bg-[var(--surface)] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Model
              </p>
              <p className="mt-1 text-sm font-medium text-[var(--text)]">
                BlueGuardian Development Classifier
              </p>
            </div>

            <div className="bg-[var(--surface)] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Version
              </p>
              <p className="mt-1 text-sm font-medium text-[var(--text)]">
                0.1.0-demo
              </p>
            </div>

            <div className="bg-[var(--surface)] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Status
              </p>
              <div className="mt-1">
                <StatusBadge
                  label={modelStatus.status}
                  variant={
                    modelStatus.status === 'READY'
                      ? 'success'
                      : modelStatus.status === 'LOADING'
                        ? 'warning'
                        : modelStatus.status === 'ERROR'
                          ? 'danger'
                          : 'info'
                  }
                />
              </div>
            </div>

            <div className="bg-[var(--surface)] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Feature count
              </p>
              <p className="mt-1 text-sm font-medium text-[var(--text)]">
                11
              </p>
            </div>

            <div className="bg-[var(--surface)] p-4 sm:col-span-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Classification classes
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                BENIGN · SUSPICIOUS · POTENTIAL_SPOOFING ·
                POTENTIAL_UNAUTHORIZED_ACCESS · ANOMALOUS_BEHAVIOR ·
                HIGH_RISK_DEVICE
              </p>
            </div>

            <div className="bg-[var(--surface)] p-4 sm:col-span-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Registered models
              </p>
              <p className="mt-1 text-sm font-medium text-[var(--text)]">
                {models.join(', ')}
              </p>
            </div>
          </div>

          <div className="flex gap-3 rounded-[var(--radius-md)] border border-[var(--warning)]/20 bg-[var(--warning)]/5 p-4">
            <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" />

            <p className="text-xs leading-5 text-[var(--text-secondary)]">
              This is a deterministic development model for
              integration testing. It is not a production-trained
              threat detection model.
            </p>
          </div>
        </div>
      </section>

      {/* Security policy */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_8px_28px_rgba(0,0,0,0.12)] transition-all duration-200 hover:border-[var(--accent)]/25 shadow-[0_8px_28px_rgba(0,0,0,0.12)] transition-all duration-200 hover:border-[var(--accent)]/25 sm:p-6">
        <div className="mb-5 flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)]">
            <Lock className="h-5 w-5 text-[var(--accent)]" />
          </div>

          <div>
            <h2 className="text-sm font-semibold text-[var(--text)]">
              Security Policy
            </h2>

            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Active controls affect browser UI behavior. Bluetooth pairing and file-transfer enforcement require native platform support and are not available in this web client.
            </p>
          </div>
        </div>

        <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {policyItems.map(item => {
            const Icon = item.icon;
            const enabled = policy[item.key];

            return (
              <label
                key={item.key}
                className={`flex items-center justify-between gap-4 py-4 ${item.available ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />

                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text)]">
                      {item.title}
                    </p>

                    <p className="mt-0.5 text-xs leading-5 text-[var(--text-muted)]">
                      {item.description}
                    </p>
                    {!item.available && (
                      <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-[var(--warning)]">
                        Not enforced in this browser
                      </p>
                    )}
                  </div>
                </div>

                <input
                  type="checkbox"
                  checked={item.available && enabled}
                  disabled={!item.available}
                  onChange={() => togglePolicy(item.key)}
                  className="h-5 w-5 shrink-0 accent-[var(--accent)]"
                />
              </label>
            );
          })}
        </div>
      </section>

      {/* General */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_8px_28px_rgba(0,0,0,0.12)] transition-all duration-200 hover:border-[var(--accent)]/25 shadow-[0_8px_28px_rgba(0,0,0,0.12)] transition-all duration-200 hover:border-[var(--accent)]/25 sm:p-6">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)]">
            <Settings className="h-5 w-5 text-[var(--accent)]" />
          </div>

          <div>
            <h2 className="text-sm font-semibold text-[var(--text)]">
              General
            </h2>

            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
              Additional configuration for monitoring, notifications
              and account management can be added here as the platform
              expands.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
