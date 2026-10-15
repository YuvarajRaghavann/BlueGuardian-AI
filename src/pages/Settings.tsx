import { useEffect, useState } from 'react';
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
import { getModelStatus, availableModels } from '../ml/mlService';
import { useSecurity } from '../context/SecurityContext';
import { api } from '../services/api';
import { localDatabase } from '../services/localDatabase';
import { useBackendSession } from '../context/BackendSessionContext';

export function SettingsPage() {
  const modelStatus = getModelStatus();
  const models = availableModels();
  const [backendHealth, setBackendHealth] = useState<{ status: string; database: string } | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [localStorageAvailable, setLocalStorageAvailable] = useState<boolean | null>(null);
  const { ownerToken } = useBackendSession();
  const [ownerApiStatus, setOwnerApiStatus] = useState<'idle' | 'checking' | 'connected' | 'error'>('idle');
  const [ownerApiError, setOwnerApiError] = useState<string | null>(null);

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
  }, []);

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

  useEffect(() => {
    setOwnerApiStatus('idle');
    setOwnerApiError(null);
  }, [ownerToken]);

  const verifyOwnerApiAccess = async () => {
    setOwnerApiStatus('checking');
    setOwnerApiError(null);
    try {
      // This protected request validates the session against the configured owner API,
      // unlike the public health endpoint above.
      await api.devices.list();
      setOwnerApiStatus('connected');
    } catch (caught) {
      setOwnerApiStatus('error');
      setOwnerApiError(caught instanceof Error ? caught.message : 'Could not verify owner API access.');
    }
  };

  const { state: securityState, dispatch } = useSecurity();
  const policy = securityState.policy;

  const togglePolicy = (key: keyof typeof policy) => {
    dispatch({
      type: 'SET_POLICY',
      payload: { [key]: !policy[key] },
    });
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
    <div className="space-y-6">
      {/* Header */}
      <header>
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

      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text)]">Backend and database</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Live result from the unauthenticated `/api/health` endpoint.</p>
          </div>
          <StatusBadge
            label={backendError ? 'UNAVAILABLE' : backendHealth?.status.toUpperCase() ?? 'CHECKING'}
            variant={backendError ? 'danger' : backendHealth?.status === 'ok' ? 'success' : 'warning'}
          />
        </div>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          Database: {backendHealth?.database ?? (backendError ? 'unknown' : 'checking')}
        </p>
        {backendError && <p role="alert" className="mt-2 text-xs text-[var(--danger)]">{backendError}</p>}
      </section>

      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text)]">Browser-local records</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">
              Device observations, development assessments, and security action history are stored in this browser's IndexedDB. They are not synchronized to the backend or shared across browsers.
            </p>
          </div>
          <StatusBadge
            label={localStorageAvailable === null ? 'CHECKING' : localStorageAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}
            variant={localStorageAvailable === null ? 'warning' : localStorageAvailable ? 'success' : 'danger'}
          />
        </div>
      </section>



      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)]">
              <Lock className="h-5 w-5 text-[var(--accent)]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--text)]">Protected API access</h2>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">
                Device, threat, action and audit endpoints require an owner token. Sign in on Device Recovery to share the token with the rest of this app. The token stays in memory and is cleared when you sign out or reload.
              </p>
              <p className="mt-2 text-xs text-[var(--text-secondary)]">
                {ownerToken.trim()
                  ? 'An owner session is available in this browser tab.'
                  : 'No owner session is active. Use the development token only for local development, or configure the identity provider for production.'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <StatusBadge
              label={ownerApiStatus === 'checking' ? 'CHECKING' : ownerApiStatus === 'connected' ? 'AUTHORIZED' : ownerApiStatus === 'error' ? 'DENIED' : ownerToken.trim() ? 'SESSION READY' : 'NOT SIGNED IN'}
              variant={ownerApiStatus === 'connected' ? 'success' : ownerApiStatus === 'error' ? 'danger' : 'warning'}
            />
            <button
              type="button"
              onClick={verifyOwnerApiAccess}
              disabled={!ownerToken.trim() || ownerApiStatus === 'checking'}
              className="min-h-10 rounded-lg border border-[var(--border)] px-4 text-sm font-semibold text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {ownerApiStatus === 'checking' ? 'Verifying…' : 'Test protected API'}
            </button>
          </div>
        </div>
        {ownerApiError && <p role="alert" className="mt-3 text-xs text-[var(--danger)]">{ownerApiError}</p>}
      </section>

      {/* Model configuration */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
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
      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
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
      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
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
