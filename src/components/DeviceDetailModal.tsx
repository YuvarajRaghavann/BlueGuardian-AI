import { useState, useEffect } from 'react';
import {
  X,
  ShieldCheck,
  AlertTriangle,
  Ban,
  Trash2,
  Wifi,
  Cpu,
  Shield,
  Smartphone,
  Headphones,
  Watch,
  HelpCircle,
  Laptop,
  Brain,
  RotateCcw,
} from 'lucide-react';
import type { BluetoothDevice, DeviceType, SecurityActionType } from '../types';
import { TrustScore } from './TrustScore';
import { StatusBadge } from './StatusBadge';
import { formatDistanceToNow } from 'date-fns';
import { calculateTrustScore } from '../utils/trustScore';
import {
  calculateProtectionStatus,
  getProtectionStatusLabel,
  getProtectionStatusColor,
} from '../utils/protectionStatus';
import { getSecurityRecommendation } from '../utils/securityRecommendation';
import { evaluateSecureBluetoothProfile } from '../utils/connectionPolicy';
import { useThreats } from '../context/ThreatContext';
import { useSecurity } from '../context/SecurityContext';
import { useBluetoothDevices } from '../context/DeviceContext';

interface DeviceDetailModalProps {
  device: BluetoothDevice | null;
  onClose: () => void;
}

const typeIcons: Record<
  DeviceType,
  React.ComponentType<{ className?: string }>
> = {
  smartphone: ({ className }) => <Smartphone className={className} />,
  earbuds: ({ className }) => <Headphones className={className} />,
  headphones: ({ className }) => <Headphones className={className} />,
  smartwatch: ({ className }) => <Watch className={className} />,
  laptop: ({ className }) => <Laptop className={className} />,
  iot: ({ className }) => <Cpu className={className} />,
  unknown: ({ className }) => <HelpCircle className={className} />,
};

function confidenceLabel(c: number) {
  if (c >= 0.8) return 'High confidence';
  if (c >= 0.6) return 'Moderate confidence';
  return 'Low confidence';
}

function actionClass(action: SecurityActionType) {
  switch (action) {
    case 'TRUST':
      return 'border-[var(--success)]/25 bg-[var(--success)]/10 text-[var(--success)] hover:bg-[var(--success)]/15';
    case 'MARK_UNKNOWN':
      return 'border-[var(--warning)]/25 bg-[var(--warning)]/10 text-[var(--warning)] hover:bg-[var(--warning)]/15';
    case 'BLOCK':
      return 'border-[var(--danger)]/25 bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/15';
    case 'UNBLOCK':
      return 'border-[var(--accent)]/25 bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/15';
    case 'FORGET':
      return 'border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]';
    default:
      return 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]';
  }
}

export function DeviceDetailModal({
  device,
  onClose,
}: DeviceDetailModalProps) {
  const { state: threatState } = useThreats();
  const { state: securityState, executeAction, getAllowedActions } = useSecurity();
  const { canConnectSelectedDevice, connectSelectedDevice } = useBluetoothDevices();
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);

  const [assessment, setAssessment] = useState(() =>
    device ? calculateTrustScore(device) : null,
  );
  const [confirmAction, setConfirmAction] =
    useState<SecurityActionType | null>(null);

  useEffect(() => {
    if (device) setAssessment(calculateTrustScore(device));
  }, [device]);

  if (!device) return null;

  const deviceThreats = threatState.threats.filter(
    (t) => t.deviceId === device.id,
  );
  const activeThreats = deviceThreats.filter(
    (t) => t.status === 'ACTIVE' || t.status === 'INVESTIGATING',
  );
  const mlThreat = deviceThreats.find((t) => t.mlPrediction);

  const simpleAssessment = {
    trustScore: device.trustScore,
    trustRiskLevel: device.riskLevel,
    ruleBasedThreatScore: 0,
    ruleBasedSeverity: 'low' as const,
    ruleBasedCategory: 'OTHER' as const,
    ruleBasedReasons: [],
    mlPrediction: undefined,
    finalThreatScore:
      device.riskLevel === 'high'
        ? 80
        : device.riskLevel === 'medium'
          ? 50
          : device.riskLevel === 'low'
            ? 20
            : 0,
    finalSeverity:
      device.riskLevel === 'high'
        ? 'high'
        : device.riskLevel === 'medium'
          ? 'medium'
          : 'low',
    finalClassification: '',
    confidence: 0,
    reasons: [],
    recommendedAction: '',
  } as any;

  const protection = calculateProtectionStatus(
    device,
    simpleAssessment,
    activeThreats,
  );
  const protectionLabel = getProtectionStatusLabel(protection);
  const protectionColor = getProtectionStatusColor(protection);

  const recommendation = getSecurityRecommendation(
    device,
    simpleAssessment,
    activeThreats,
  );
  const securityProfile = evaluateSecureBluetoothProfile(device, {
    rssi: device.rssi,
    fileName: device.name,
    deviceType: device.type,
  }, securityState.policy);
  const allowedActions = getAllowedActions(device);

  const handleAction = (type: SecurityActionType) => {
    const requiresConfirmation =
      (type === 'BLOCK' && securityState.policy.confirmBlock) ||
      (type === 'TRUST' && securityState.policy.confirmTrust) ||
      type === 'FORGET' ||
      type === 'UNBLOCK';

    if (requiresConfirmation) {
      setConfirmAction(type);
      return;
    }

    executeAction(type, device, recommendation.explanation);
  };

  const confirmExecute = () => {
    if (confirmAction) {
      executeAction(confirmAction, device, recommendation.explanation);
      setConfirmAction(null);
    }
  };

  const IconComp =
    typeIcons[device.type] ||
    (({ className }) => <HelpCircle className={className} />);

  const sectionClass =
    'rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4';

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-5">
        <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-2xl">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--accent)]/20 bg-[var(--accent-soft)] text-[var(--accent)]">
                <IconComp className="h-5 w-5" />
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-base font-semibold text-[var(--text)] sm:text-lg">
                    {device.name}
                  </h2>
                  <StatusBadge
                    label={device.riskLevel}
                    variant={
                      device.riskLevel === 'trusted'
                        ? 'success'
                        : device.riskLevel === 'low'
                          ? 'info'
                          : device.riskLevel === 'medium'
                            ? 'warning'
                            : 'danger'
                    }
                  />
                </div>
                <p className="mt-0.5 text-xs capitalize text-[var(--text-muted)]">
                  {device.type} · {device.manufacturer ?? 'Unknown manufacturer'}
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              aria-label="Close device details"
              className="shrink-0 rounded-lg border border-transparent p-2 text-[var(--text-muted)] transition hover:border-[var(--border)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="overflow-y-auto px-5 py-5 sm:px-6">
            <div className="space-y-5">
              {/* Trust hero */}
              <section className="grid gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-[auto_1fr] sm:items-center">
                <div className="flex justify-center sm:justify-start">
                  <TrustScore score={device.trustScore} size="lg" />
                </div>

                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    Device trust
                  </p>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-3xl font-semibold text-[var(--text)]">
                      {device.trustScore}
                    </span>
                    <span className="text-sm text-[var(--text-muted)]">
                      / 100
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    {device.isKnown
                      ? 'Recognized device with established trust history.'
                      : 'Device has not been previously established as trusted.'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {Boolean(device.approvalRequired) && (
                      <StatusBadge
                        label="Pending approval"
                        variant="warning"
                      />
                    )}
                    <StatusBadge
                      label={`Connection gate: ${securityProfile.connectionDecision}`}
                      variant={
                        securityProfile.connectionDecision === 'BLOCK'
                          ? 'danger'
                          : securityProfile.connectionDecision === 'REQUIRE_APPROVAL'
                            ? 'warning'
                            : 'success'
                      }
                    />
                    <StatusBadge
                      label={`Transfer: ${securityProfile.fileTransferDecision}`}
                      variant={
                        securityProfile.fileTransferDecision === 'BLOCK'
                          ? 'danger'
                          : securityProfile.fileTransferDecision === 'REQUIRE_APPROVAL'
                            ? 'warning'
                            : 'success'
                      }
                    />
                    <StatusBadge
                      label={`RSSI: ${securityProfile.rssiRisk}`}
                      variant={
                        securityProfile.rssiRisk === 'BLOCK'
                          ? 'danger'
                          : securityProfile.rssiRisk === 'WARNING'
                            ? 'warning'
                            : 'success'
                      }
                    />
                  </div>
                </div>
              </section>

              {/* Protection status */}
              <section className="rounded-xl border border-[var(--accent)]/20 bg-[var(--accent-soft)]/40 p-4">
                <div className="mb-4 flex items-center gap-2">
                  <Shield className="h-4 w-4 text-[var(--accent)]" />
                  <h3 className="text-sm font-semibold text-[var(--text)]">
                    BlueGuardian app status
                  </h3>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-[var(--text-muted)]">
                      Status
                    </p>
                    <div className="mt-1">
                      <StatusBadge
                        label={protectionLabel}
                        variant={protectionColor.replace(
                          'text-',
                          '',
                        ) as any}
                      />
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-[var(--text-muted)]">
                      Trust score
                    </p>
                    <p className="mt-1 text-lg font-semibold text-[var(--text)]">
                      {device.trustScore}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-[var(--text-muted)]">
                      Threat level
                    </p>
                    <p className="mt-1 text-lg font-semibold uppercase text-[var(--text)]">
                      {recommendation.priority}
                    </p>
                  </div>
                </div>

                <p className="mt-4 border-t border-[var(--border)] pt-3 text-sm leading-6 text-[var(--text-secondary)]">
                  {recommendation.recommendation}
                </p>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  These are local assessment and trust records. This browser app cannot enforce operating-system Bluetooth pairing or file-transfer controls.
                </p>
              </section>

              {/* AI/ML */}
              {mlThreat && (
                <section className={sectionClass}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Brain className="h-4 w-4 text-[var(--accent)]" />
                      <h3 className="text-sm font-semibold text-[var(--text)]">
                        AI security analysis
                      </h3>
                    </div>
                    <span className="rounded-full border border-[var(--warning)]/20 bg-[var(--warning)]/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--warning)]">
                      Development model
                    </span>
                  </div>

                  <dl className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
                    <div className="flex justify-between gap-4 px-3 py-2.5 text-sm">
                      <dt className="text-[var(--text-muted)]">Model</dt>
                      <dd className="text-right font-medium text-[var(--text)]">
                        {mlThreat.modelName ??
                          mlThreat.mlPrediction?.modelName}
                      </dd>
                    </div>

                    <div className="flex justify-between gap-4 px-3 py-2.5 text-sm">
                      <dt className="text-[var(--text-muted)]">Version</dt>
                      <dd className="text-[var(--text)]">
                        {mlThreat.modelVersion ??
                          mlThreat.mlPrediction?.modelVersion}
                      </dd>
                    </div>

                    <div className="flex justify-between gap-4 px-3 py-2.5 text-sm">
                      <dt className="text-[var(--text-muted)]">
                        Classification
                      </dt>
                      <dd className="text-right font-medium capitalize text-[var(--text)]">
                        {mlThreat.finalClassification ??
                          mlThreat.mlPrediction?.label.replace(/_/g, ' ')}
                      </dd>
                    </div>

                    <div className="flex justify-between gap-4 px-3 py-2.5 text-sm">
                      <dt className="text-[var(--text-muted)]">Confidence</dt>
                      <dd className="text-right font-medium text-[var(--text)]">
                        {Math.round(
                          (mlThreat.confidence ??
                            mlThreat.mlPrediction?.confidence ??
                            0) * 100,
                        )}
                        %{' '}
                        {((mlThreat.confidence ?? mlThreat.mlPrediction?.confidence ?? 0) >= 0.6 ||
                          securityState.policy.showLowConfidenceWarnings) && (
                          <span className="font-normal text-[var(--text-muted)]">
                            · {confidenceLabel(
                              mlThreat.confidence ??
                                mlThreat.mlPrediction?.confidence ??
                                0,
                            )}
                          </span>
                        )}
                      </dd>
                    </div>
                  </dl>

                  <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">
                    <strong className="text-[var(--text-secondary)]">
                      Explanation:
                    </strong>{' '}
                    {mlThreat.mlPrediction?.explanation}
                  </p>

                  <p className="mt-2 text-[11px] italic text-[var(--text-muted)]">
                    This deterministic development model is for integration
                    testing and is not a production-trained threat model.
                  </p>
                </section>
              )}

              {/* Recommendation */}
              <section className="rounded-xl border border-[var(--warning)]/20 bg-[var(--warning)]/5 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" />
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text)]">
                      Recommended action
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                      {recommendation.recommendation}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                      {recommendation.explanation}
                    </p>
                  </div>
                </div>
              </section>

              {/* Detail grid */}
              <div className="grid gap-4 md:grid-cols-2">
                <section className={sectionClass}>
                  <div className="mb-4 flex items-center gap-2">
                    <Shield className="h-4 w-4 text-[var(--accent)]" />
                    <h3 className="text-sm font-semibold text-[var(--text)]">
                      Overview
                    </h3>
                  </div>

                  <dl className="space-y-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-[var(--text-muted)]">
                        Discovery source
                      </dt>
                      <dd>
                        <StatusBadge
                          label={device.discoverySource}
                          variant={
                            device.discoverySource === 'REAL'
                              ? 'info'
                              : 'warning'
                          }
                        />
                      </dd>
                    </div>

                    <div className="flex justify-between gap-3">
                      <dt className="text-[var(--text-muted)]">First seen</dt>
                      <dd className="text-right text-[var(--text-secondary)]">
                        {formatDistanceToNow(device.firstSeen, {
                          addSuffix: true,
                        })}
                      </dd>
                    </div>

                    <div className="flex justify-between gap-3">
                      <dt className="text-[var(--text-muted)]">Last seen</dt>
                      <dd className="text-right text-[var(--text-secondary)]">
                        {formatDistanceToNow(device.lastSeen, {
                          addSuffix: true,
                        })}
                      </dd>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-[var(--text-muted)]">Connection</dt>
                      <dd>
                        <StatusBadge
                          label={device.connectionStatus}
                          variant={
                            device.connectionStatus === 'connected'
                              ? 'success'
                              : device.connectionStatus === 'connecting'
                                ? 'warning'
                                : 'info'
                          }
                        />
                      </dd>
                    </div>

                    <div className="flex justify-between gap-3">
                      <dt className="text-[var(--text-muted)]">
                        Known device
                      </dt>
                      <dd className="text-[var(--text-secondary)]">
                        {device.isKnown ? 'Yes' : 'No'}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className={sectionClass}>
                  <div className="mb-4 flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-[var(--success)]" />
                    <h3 className="text-sm font-semibold text-[var(--text)]">
                      Trust analysis
                    </h3>
                  </div>

                  {assessment && (
                    <dl className="space-y-3 text-sm">
                      {[
                        ['Known device', assessment.factors.knownDevice ? 'Yes' : 'No'],
                        ['Manufacturer reputation', `${assessment.factors.manufacturerReputation}/100`],
                        ['Connection history', `${assessment.factors.connectionHistory}/100`],
                        ['Suspicious behavior', `${assessment.factors.suspiciousBehavior}/100`],
                        ['Signal consistency', `${assessment.factors.signalConsistency}/100`],
                        ['Device type trust', `${assessment.factors.deviceTypeTrust}/100`],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          className="flex justify-between gap-3"
                        >
                          <dt className="text-[var(--text-muted)]">{label}</dt>
                          <dd className="font-medium text-[var(--text-secondary)]">
                            {value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </section>

                <section className={`${sectionClass} md:col-span-2`}>
                  <div className="mb-4 flex items-center gap-2">
                    <Wifi className="h-4 w-4 text-[var(--accent)]" />
                    <h3 className="text-sm font-semibold text-[var(--text)]">
                      Bluetooth information
                    </h3>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-[var(--text-muted)]">
                        Signal strength
                      </p>
                      <p className="mt-1 font-mono text-sm text-[var(--text-secondary)]">
                        {device.rssi ?? 'N/A'} dBm
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-[var(--text-muted)]">
                        MAC address
                      </p>
                      <p className="mt-1 break-all font-mono text-sm text-[var(--text-secondary)]">
                        {device.address ?? 'N/A'}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-[var(--text-muted)]">
                        Services
                      </p>
                      <p className="mt-1 text-sm text-[var(--text-secondary)]">
                        {device.services.length}
                      </p>
                    </div>
                  </div>

                  {device.services.length > 0 && (
                    <div className="mt-4 space-y-1.5 border-t border-[var(--border)] pt-3">
                      {device.services.map((s, i) => (
                        <div
                          key={i}
                          className="break-all rounded-md bg-[var(--bg)] px-2.5 py-2 font-mono text-[11px] text-[var(--text-muted)]"
                        >
                          {s.uuid}
                          {s.name ? ` · ${s.name}` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className={`${sectionClass} md:col-span-2`}>
                  <div className="mb-4 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-[var(--warning)]" />
                    <h3 className="text-sm font-semibold text-[var(--text)]">
                      Security assessment
                    </h3>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex justify-between gap-3">
                      <span className="text-sm text-[var(--text-muted)]">
                        Known device
                      </span>
                      <span className="text-sm text-[var(--text-secondary)]">
                        {device.isKnown ? 'Yes' : 'No'}
                      </span>
                    </div>

                    <div className="flex justify-between gap-3">
                      <span className="text-sm text-[var(--text-muted)]">
                        Suspicious activity
                      </span>
                      <span
                        className={`text-sm ${
                          device.riskLevel === 'high'
                            ? 'text-[var(--danger)]'
                            : 'text-[var(--text-secondary)]'
                        }`}
                      >
                        {device.riskLevel === 'high' ? 'Detected' : 'Not detected'}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                      Risk factors
                    </p>

                    <ul className="space-y-1.5 text-sm text-[var(--text-secondary)]">
                      {!device.isKnown && (
                        <li>• Device not previously seen</li>
                      )}
                      {device.riskLevel === 'high' && (
                        <li>• High risk classification</li>
                      )}
                      {device.connectionStatus === 'unknown' && (
                        <li>• Connection state unknown</li>
                      )}
                      {!device.address && <li>• No MAC address available</li>}
                      {device.isKnown &&
                        device.riskLevel !== 'high' &&
                        device.connectionStatus !== 'unknown' &&
                        device.address && (
                          <li className="text-[var(--success)]">
                            • No immediate risk factors identified
                          </li>
                        )}
                    </ul>
                  </div>
                </section>
              </div>

              {/* Actions */}
              <div className="border-t border-[var(--border)] pt-4">
                {canConnectSelectedDevice(device.id) && !device.gattConnected && !device.blocked && (
                  <div className="mb-4 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-3">
                    <p className="text-sm font-medium text-[var(--text)]">Bluetooth connection approval</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">Selecting a device does not connect it. Approve here to let BlueGuardian open a browser GATT connection and inspect services. Android system pairing remains controlled by Android Settings.</p>
                    <button
                      type="button"
                      disabled={connectionBusy}
                      onClick={() => {
                        setConnectionBusy(true);
                        setConnectionMessage(null);
                        void connectSelectedDevice(device.id)
                          .then(result => setConnectionMessage(result.message))
                          .catch(error => setConnectionMessage(error instanceof Error ? error.message : 'Bluetooth connection failed.'))
                          .finally(() => setConnectionBusy(false));
                      }}
                      className="mt-3 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50"
                    >{connectionBusy ? 'Connecting…' : 'Approve & inspect services'}</button>
                    {connectionMessage && <p role="status" className="mt-2 text-xs text-[var(--text-secondary)]">{connectionMessage}</p>}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {allowedActions.map((act) => (
                    <button
                      key={act}
                      onClick={() => handleAction(act)}
                      className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition ${actionClass(
                        act,
                      )}`}
                    >
                      {act === 'TRUST' && <ShieldCheck className="h-4 w-4" />}
                      {act === 'MARK_UNKNOWN' && (
                        <AlertTriangle className="h-4 w-4" />
                      )}
                      {act === 'BLOCK' && <Ban className="h-4 w-4" />}
                      {act === 'UNBLOCK' && <RotateCcw className="h-4 w-4" />}
                      {act === 'FORGET' && <Trash2 className="h-4 w-4" />}
                      {act === 'INVESTIGATE' && (
                        <AlertTriangle className="h-4 w-4" />
                      )}
                      {act}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation dialog */}
      {confirmAction && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-2xl">
            <div className="border-b border-[var(--border)] px-5 py-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-[var(--warning)]" />
                <h3 className="text-base font-semibold text-[var(--text)]">
                  Confirm {confirmAction}
                </h3>
              </div>
            </div>

            <div className="p-5">
              <p className="text-sm leading-6 text-[var(--text-secondary)]">
                {confirmAction === 'BLOCK' &&
                  `Blocking ${device.name} will mark it as blocked in BlueGuardian. This is an application-level decision; browser Web Bluetooth cannot enforce OS-level blocking.`}
                {confirmAction === 'FORGET' &&
                  `Forgetting ${device.name} will remove it from BlueGuardian permanently. This action cannot be undone.`}
                {confirmAction === 'TRUST' &&
                  `Marking ${device.name} as trusted will lower its threat level. Ensure you recognize this device.`}
                {confirmAction === 'UNBLOCK' &&
                  `Unblocking ${device.name} will remove its BlueGuardian application-level block. This does not change its trust status or enforce an operating-system block.`}
              </p>

              <div className="mt-5 flex justify-end gap-2">
                <button
                  onClick={() => setConfirmAction(null)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                >
                  Cancel
                </button>

                <button
                  onClick={confirmExecute}
                  className="rounded-lg border border-[var(--danger)]/25 bg-[var(--danger)]/10 px-4 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--danger)]/15"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
