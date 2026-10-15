import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Brain,
  Bluetooth,
  Cpu,
  ScanLine,
  ShieldCheck,
  Target,
} from 'lucide-react';

import { StatusBadge } from '../components/StatusBadge';
import { StatCard } from '../components/StatCard';
import { DeviceCard } from '../components/DeviceCard';
import { ThreatCard } from '../components/ThreatCard';
import { SecurityTimeline } from '../components/SecurityTimeline';
import { StaggerGroup, StaggerItem } from '../components/motion/MotionPrimitives';

import { useBluetoothDevices } from '../context/DeviceContext';
import { useThreats } from '../context/ThreatContext';
import { useSecurity } from '../context/SecurityContext';
import type { BluetoothDevice } from '../types';
import { needsManualApproval } from '../utils/connectionPolicy';
import { visibleEvents } from '../utils/visibleEvents';
import { useWorkflowEvents } from '../hooks/useWorkflowEvents';

export function Dashboard() {
  const { state, scanDevices } = useBluetoothDevices();
  const workflowEvents = useWorkflowEvents();
  const { state: threatState } = useThreats();
  const { state: securityState, executeAction } = useSecurity();
  const [pendingApproval, setPendingApproval] = useState<BluetoothDevice | null>(null);
  const [pendingAction, setPendingAction] = useState<'TRUST' | 'BLOCK' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const totalDevices = state.devices.length;
  const trustedCount = state.devices.filter((d) => d.trusted).length;
  const unknownCount = state.devices.filter((d) => !d.trusted).length;
  const highRiskCount = state.devices.filter((d) => d.riskLevel === 'high').length;
  const connectedCount = state.devices.filter(
    (d) => d.connectionStatus === 'connected',
  ).length;

  const activeThreats = threatState.threats.filter(
    (t) => t.status === 'ACTIVE' || t.status === 'INVESTIGATING',
  ).length;

  const avgTrustScore =
    state.devices.length > 0
      ? Math.round(
          state.devices.reduce((sum, d) => sum + d.trustScore, 0) /
            state.devices.length,
        )
      : 0;

  const devicesNeedingReview = state.devices.filter((d) =>
    needsManualApproval(d),
  ).length;

  const mlThreats = threatState.threats.filter((t) => t.mlPrediction);
  const mlClassified = mlThreats.length;

  const highRiskML = mlThreats.filter(
    (t) =>
      (t.confidence ?? 0) >= 0.6 &&
      (t.finalClassification === 'HIGH_RISK_DEVICE' ||
        t.finalClassification === 'POTENTIAL_SPOOFING' ||
        t.finalClassification === 'POTENTIAL_UNAUTHORIZED_ACCESS'),
  ).length;

  const avgMLConfidence =
    mlClassified > 0
      ? Math.round(
          (mlThreats.reduce((s, t) => s + (t.confidence ?? 0), 0) /
            mlClassified) *
            100,
        )
      : 0;

  const recentDevices = [...state.devices]
    .sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime())
    .slice(0, 4);

  const recentThreats = [...threatState.threats]
    .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime())
    .slice(0, 5);

  const threatEvents = recentThreats.map((t) => ({
    id: t.id,
    type: 'alert' as const,
    message: `${t.title} on ${t.deviceName}`,
    severity:
      t.severity === 'critical' || t.severity === 'high'
        ? ('error' as const)
        : t.severity === 'medium'
          ? ('warning' as const)
          : ('info' as const),
    timestamp: t.detectedAt,
    simulated: t.discoverySource === 'SIMULATED',
  }));
  const visibleWorkflowEvents = visibleEvents(workflowEvents, securityState.policy.showSimulatedEvents);
  const timelineSource = visibleWorkflowEvents.length > 0 ? visibleWorkflowEvents : threatEvents;
  const timelineEvents = visibleEvents(timelineSource, securityState.policy.showSimulatedEvents).slice(0, 5);

  const scanActive = state.scan.state === 'scanning';

  const approvalTargets = state.devices
    .filter((device) => !device.blocked && needsManualApproval(device))
    .slice(0, 3);

  const describeReviewReason = (device: BluetoothDevice) => {
    const reasons: string[] = [];

    if (!device.isKnown) reasons.push('identity is not confirmed');
    if (device.riskLevel === 'high') reasons.push('risk classification is high');
    if (device.riskLevel === 'medium') reasons.push('risk level requires a manual check');
    if (device.type === 'earbuds' || device.type === 'headphones' || device.type === 'smartwatch') {
      reasons.push('wearable behavior requires explicit trust review');
    }
    if (device.trustScore < 60) reasons.push('trust score is below the secure threshold');

    if (reasons.length === 0) {
      return 'BlueGuardian is requiring user review before allowing the connection.';
    }

    return `BlueGuardian recommends review because ${reasons.join(', ')}.`;
  };

  const confirmApproval = () => {
    if (!pendingApproval || !pendingAction) return;

    const completed = executeAction(
      pendingAction,
      pendingApproval,
      pendingAction === 'TRUST'
        ? 'User approved a newly discovered device after a security review.'
        : 'User blocked a newly discovered device due to elevated risk.',
    );

    if (!completed) {
      setActionError('This action was rejected by the current security policy.');
      return;
    }

    setActionError(null);
    setPendingApproval(null);
    setPendingAction(null);
  };

  const requestApprovalAction = (device: BluetoothDevice, type: 'TRUST' | 'BLOCK') => {
    const requiresConfirmation = type === 'TRUST'
      ? securityState.policy.confirmTrust
      : securityState.policy.confirmBlock;

    if (requiresConfirmation) {
      setPendingApproval(device);
      setPendingAction(type);
      setActionError(null);
      return;
    }

    const completed = executeAction(
      type,
      device,
      type === 'TRUST'
        ? 'User approved a newly discovered device after a security review.'
        : 'User blocked a newly discovered device due to elevated risk.',
    );
    setActionError(completed ? null : 'This action was rejected by the current security policy.');
  };

  return (
    <div className="space-y-6">
      {/* Page heading */}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
            <Activity className="h-3.5 w-3.5 text-[var(--accent)]" />
            Bluetooth observations
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Bluetooth security overview
          </h1>

          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
            Review browser-selected device observations, inspect development risk assessments,
            and manage owner recovery cases.
          </p>
        </div>

        <button
          type="button"
          onClick={scanDevices}
          disabled={scanActive}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(59,156,255,0.16)] transition-all hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ScanLine className={`h-4 w-4 ${scanActive ? 'animate-pulse' : ''}`} />
          {scanActive ? 'Scanning...' : 'Run Bluetooth scan'}
        </button>
      </section>

      {approvalTargets.length > 0 && (
        <section className="rounded-2xl border border-[var(--warning)]/25 bg-[var(--warning)]/10 p-4 sm:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--warning)]/25 bg-[var(--warning)]/15 text-[var(--warning)]">
                <AlertTriangle className="h-4 w-4" />
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--warning)]">
                  Review recommended
                </p>
                <h2 className="mt-1 text-base font-semibold text-white">
                  {approvalTargets.length === 1
                    ? 'One device needs review before it is marked trusted.'
                    : `${approvalTargets.length} devices need review before they are marked trusted.`}
                </h2>
                {approvalTargets[0] && (
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
                    {describeReviewReason(approvalTargets[0])}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {approvalTargets.map((device) => (
              <div
                key={device.id}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/80 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">{device.name}</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {device.type} · {device.riskLevel} risk
                    </p>
                  </div>
                  <StatusBadge
                    label={device.trustScore.toString()}
                    variant={
                      device.riskLevel === 'high'
                        ? 'danger'
                        : device.riskLevel === 'medium'
                          ? 'warning'
                          : 'info'
                    }
                  />
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => requestApprovalAction(device, 'TRUST')}
                    className="flex-1 rounded-lg border border-[var(--success)]/25 bg-[var(--success)]/10 px-3 py-2 text-xs font-semibold text-[var(--success)] transition hover:bg-[var(--success)]/15"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => requestApprovalAction(device, 'BLOCK')}
                    className="flex-1 rounded-lg border border-[var(--danger)]/25 bg-[var(--danger)]/10 px-3 py-2 text-xs font-semibold text-[var(--danger)] transition hover:bg-[var(--danger)]/15"
                  >
                    Block
                  </button>
                </div>
              </div>
            ))}
          </div>
          {actionError && <p role="alert" className="mt-3 text-xs text-[var(--danger)]">{actionError}</p>}
        </section>
      )}

      {/* Primary posture */}
      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr_1fr]">
        <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
          <div className="absolute right-0 top-0 h-40 w-40 translate-x-1/3 -translate-y-1/3 rounded-full bg-[rgba(59,156,255,0.08)] blur-3xl" />

          <div className="relative">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  Local review summary
                </p>
                <h2 className="mt-2 text-xl font-semibold text-white">
                  {activeThreats > 0
                    ? 'Review app indicators'
                    : totalDevices === 0
                      ? 'No scan data yet'
                      : threatState.threats.length === 0
                        ? 'Assessment unavailable'
                        : 'No open app indicators'}
                </h2>
              </div>

              <div className={`flex h-11 w-11 items-center justify-center rounded-xl border ${activeThreats > 0 ? 'border-[var(--warning)]/25 bg-[var(--warning)]/10' : 'border-[var(--border)] bg-[var(--surface)]'}`}>
                <ShieldCheck className={`h-5 w-5 ${activeThreats > 0 ? 'text-[var(--warning)]' : 'text-[var(--text-muted)]'}`} />
              </div>
            </div>

            <div className="mt-6 flex items-end gap-3">
              <span className="text-4xl font-semibold tracking-tight text-white">
                {totalDevices > 0 ? avgTrustScore : '—'}
              </span>
              <span className="mb-1 text-sm text-[var(--text-muted)]">
                average app trust score
              </span>
            </div>

            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
              <div
                className="h-full rounded-full bg-[var(--success)] transition-all"
                style={{ width: `${Math.min(100, avgTrustScore)}%` }}
              />
            </div>

            <div className="mt-3 flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)]">
                {trustedCount} trusted in app
              </span>
              <span
                className={
                  devicesNeedingReview > 0
                    ? 'text-[var(--warning)]'
                    : 'text-[var(--success)]'
                }
              >
                {devicesNeedingReview} need review
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-soft)]">
              <Bluetooth className="h-5 w-5 text-[var(--accent)]" />
            </div>

            <span className={`flex items-center gap-1.5 text-[11px] font-medium ${scanActive ? 'text-[var(--success)]' : 'text-[var(--text-muted)]'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${scanActive ? 'bg-[var(--success)]' : 'bg-[var(--text-muted)]'}`} />
              {scanActive
                ? 'Scanning'
                : state.scan.state === 'complete'
                  ? 'Scan complete'
                  : state.devices.length > 0
                    ? 'Observations loaded'
                    : 'Awaiting scan'}
            </span>
          </div>

          <p className="mt-5 text-3xl font-semibold text-white">
            {totalDevices}
          </p>

          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Browser records
          </p>

          <div className="mt-5 flex gap-4 border-t border-[var(--border)] pt-4 text-xs">
            <span className="text-[var(--text-muted)]">
              <strong className="text-white">{connectedCount}</strong> connected
            </span>
            <span className="text-[var(--text-muted)]">
              <strong className="text-white">{unknownCount}</strong> unknown
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(239,98,98,0.08)]">
              <AlertTriangle className="h-5 w-5 text-[var(--danger)]" />
            </div>

            <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
              Current session
            </span>
          </div>

          <p className="mt-5 text-3xl font-semibold text-white">
            {activeThreats}
          </p>

          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Open risk assessments
          </p>

          <div className="mt-5 flex items-center gap-2 border-t border-[var(--border)] pt-4 text-xs">
            <span className="text-[var(--danger)]">{highRiskCount}</span>
            <span className="text-[var(--text-muted)]">devices labelled high risk</span>
          </div>
        </div>
      </section>

      {/* Secondary metrics */}
      <StaggerGroup
        label="Security metrics"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <StaggerItem>
          <StatCard title="Trusted Devices" value={trustedCount} icon={ShieldCheck} />
        </StaggerItem>
        <StaggerItem>
          <StatCard title="Connected" value={connectedCount} icon={Bluetooth} />
        </StaggerItem>
        <StaggerItem>
          <StatCard title="High Risk" value={highRiskCount} icon={AlertTriangle} />
        </StaggerItem>
        <StaggerItem>
          <StatCard title="Need Review" value={devicesNeedingReview} icon={Target} />
        </StaggerItem>
      </StaggerGroup>

      {pendingApproval && pendingAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--warning)]/25 bg-[var(--warning)]/10 text-[var(--warning)]">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">
                  Confirm {pendingAction === 'TRUST' ? 'approval' : 'block'}
                </h3>
                <p className="text-sm text-[var(--text-muted)]">
                  {pendingApproval.name}
                </p>
              </div>
            </div>

            <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">
              {pendingAction === 'TRUST'
                ? `Approve ${pendingApproval.name} and allow it to be treated as a trusted connection candidate after review.`
                : `Mark ${pendingApproval.name} as blocked in BlueGuardian. This web app cannot prevent operating-system Bluetooth connections.`}
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingApproval(null);
                  setPendingAction(null);
                }}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmApproval}
                className={
                  pendingAction === 'TRUST'
                    ? 'rounded-lg border border-[var(--success)]/25 bg-[var(--success)]/10 px-3.5 py-2 text-sm font-medium text-[var(--success)] transition hover:bg-[var(--success)]/15'
                    : 'rounded-lg border border-[var(--danger)]/25 bg-[var(--danger)]/10 px-3.5 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--danger)]/15'
                }
              >
                {pendingAction === 'TRUST' ? 'Approve device' : 'Block device'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main monitoring grid */}
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.75fr)]">
        <div className="space-y-6">
          {/* Device monitoring */}
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex flex-col gap-3 border-b border-[var(--border)] p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Bluetooth className="h-4 w-4 text-[var(--accent)]" />
                  <h2 className="text-sm font-semibold text-white">
                    Local device observations
                  </h2>
                </div>

                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Observations selected or simulated in this browser
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
                {state.scan.state === 'complete'
                  ? `Scan completed in ${(state.scan.elapsedMs / 1000).toFixed(1)}s`
                  : state.scan.state === 'error'
                    ? 'Last scan failed'
                    : state.devices.length > 0
                      ? 'Saved browser observations'
                      : 'No scan in this session'}
              </div>
            </div>

            <div className="divide-y divide-[var(--border)]">
              {recentDevices.length > 0 ? (
                recentDevices.map((device) => (
                  <DeviceCard key={device.id} device={device} />
                ))
              ) : (
                <div className="px-5 py-12 text-center">
                  <Bluetooth className="mx-auto h-8 w-8 text-[var(--text-muted)]" />
                  <p className="mt-3 text-sm text-[var(--text-secondary)]">
                    No Bluetooth devices detected yet.
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Run a scan to begin monitoring.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Threats */}
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] p-5">
              <div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-[var(--warning)]" />
                  <h2 className="text-sm font-semibold text-white">
                    Threat detection
                  </h2>
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Current security findings
                </p>
              </div>

              <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {activeThreats} active
              </span>
            </div>

            <div className="divide-y divide-[var(--border)]">
              {threatState.threats
                .filter(
                  (t) =>
                    t.status === 'ACTIVE' || t.status === 'INVESTIGATING',
                )
                .slice(0, 3)
                .map((threat) => (
                  <ThreatCard key={threat.id} threat={threat} />
                ))}

              {activeThreats === 0 && (
                <div className="px-5 py-10 text-center">
                  <ShieldCheck className="mx-auto h-8 w-8 text-[var(--success)]" />
                  <p className="mt-3 text-sm font-medium text-white">
                    {totalDevices === 0 ? 'No device analysis available' : 'No active threats in this session'}
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {totalDevices === 0
                      ? 'Run a Bluetooth scan to create a development assessment.'
                      : 'BlueGuardian has no current findings requiring attention.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right rail */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Device recovery</p>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Recovery records and owner-authorized sightings are shown in the Recovery workspace. No sample sighting is presented here as live data.
            </p>
            <Link to="/recovery" className="mt-4 inline-flex min-h-10 items-center rounded-lg border border-[var(--border)] px-3 text-sm font-semibold text-[var(--text)] hover:border-[var(--accent)]">
              Open recovery
            </Link>
          </div>

          {/* ML analysis */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="border-b border-[var(--border)] p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Brain className="h-4 w-4 text-[var(--accent)]" />
                  <h2 className="text-sm font-semibold text-white">
                    AI security analysis
                  </h2>
                </div>

                <StatusBadge label="DEMO" variant="warning" />
              </div>

              <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                Deterministic development classifier used for integration
                testing. This is not a production-trained threat model.
              </p>
            </div>

            <div className="space-y-4 p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)]">Model</span>
                <span className="max-w-[180px] text-right text-xs font-medium text-white">
                  BlueGuardian Development Classifier
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)]">Version</span>
                <span className="text-xs font-medium text-white">0.1.0-demo</span>
              </div>

              <div className="grid grid-cols-3 gap-2 border-t border-[var(--border)] pt-4">
                <Metric value={mlClassified} label="Classified" />
                <Metric value={highRiskML} label="High risk" />
                <Metric value={mlClassified > 0 ? `${avgMLConfidence}%` : '—'} label="Confidence" />
              </div>

              <div className="flex items-center gap-2 rounded-lg bg-[var(--bg-elevated)] px-3 py-2.5">
                <Cpu className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                <span className="text-[10px] leading-4 text-[var(--text-muted)]">
                  Model output is currently an integration-stage signal.
                </span>
              </div>
            </div>
          </div>

          <SecurityTimeline
            events={timelineEvents}
            title="Recent security events"
          />
        </div>
      </section>
    </div>
  );
}

function Metric({
  value,
  label,
}: {
  value: string | number;
  label: string;
}) {
  return (
    <div className="rounded-lg bg-[var(--bg-elevated)] p-3">
      <p className="text-lg font-semibold text-white">{value}</p>
      <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">{label}</p>
    </div>
  );
}
