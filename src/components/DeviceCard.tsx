import type {
  BluetoothDevice,
  DeviceType,
  ConnectionStatus,
} from '../types';
import { TrustScore } from './TrustScore';
import { StatusBadge } from './StatusBadge';
import { formatDistanceToNow } from 'date-fns';
import {
  Headphones,
  Smartphone,
  Watch,
  HelpCircle,
  ShieldCheck,
  AlertTriangle,
  Laptop,
  Cpu,
  Radio,
} from 'lucide-react';
import {
  calculateProtectionStatus,
  getProtectionStatusLabel,
  getProtectionStatusColor,
} from '../utils/protectionStatus';
import { needsManualApproval } from '../utils/connectionPolicy';

const typeIcons: Record<DeviceType, typeof Headphones> = {
  smartphone: Smartphone,
  earbuds: Headphones,
  headphones: Headphones,
  smartwatch: Watch,
  laptop: Laptop,
  iot: Cpu,
  unknown: HelpCircle,
};

const riskColors: Record<
  'trusted' | 'low' | 'medium' | 'high',
  'success' | 'warning' | 'danger' | 'info'
> = {
  trusted: 'success',
  low: 'info',
  medium: 'warning',
  high: 'danger',
};

const connectionColors: Record<
  ConnectionStatus,
  'success' | 'warning' | 'danger' | 'info'
> = {
  connected: 'success',
  connecting: 'warning',
  disconnected: 'info',
  unknown: 'info',
};

export function DeviceCard({
  device,
  onClick,
}: {
  device: BluetoothDevice;
  onClick?: () => void;
}) {
  const Icon = typeIcons[device.type];
  const riskVariant = riskColors[device.riskLevel];
  const connVariant = connectionColors[device.connectionStatus];

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
    [],
  );

  const needsApproval = needsManualApproval(device);
  const protectionLabel = getProtectionStatusLabel(protection);
  const protectionColor = getProtectionStatusColor(protection);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group block w-full text-left"
    >
      <div className="p-4 transition-colors hover:bg-[var(--surface-raised)] sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--accent)]">
              <Icon className="h-5 w-5" />
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-semibold text-white">
                  {device.name}
                </h3>

                <StatusBadge
                  label={device.discoverySource}
                  variant={
                    device.discoverySource === 'REAL'
                      ? 'info'
                      : 'warning'
                  }
                />
                {(device.discoveryTransport === 'CLASSIC' || device.discoveryTransport === 'PAIRED') && (
                  <StatusBadge label={device.paired ? 'PAIRED' : 'CLASSIC'} variant={device.paired ? 'success' : 'info'} />
                )}
              </div>

              <p className="mt-1 truncate text-xs capitalize text-[var(--text-secondary)]">
                {device.type} · {device.manufacturer ?? 'Unknown manufacturer'}
              </p>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
                <span>
                  Last seen{' '}
                  {formatDistanceToNow(device.lastSeen, {
                    addSuffix: true,
                  })}
                </span>

                <span className="flex items-center gap-1">
                  <Radio className="h-3 w-3" />
                  {device.rssi ?? 'N/A'} dBm
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 lg:justify-end">
            <div className="hidden items-center gap-2 sm:flex">
              {device.trusted ? (
                <ShieldCheck className="h-3.5 w-3.5 text-[var(--success)]" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 text-[var(--warning)]" />
              )}

              <span className="text-[11px] text-[var(--text-muted)]">
                {device.trusted ? 'Known device' : 'Unknown device'}
              </span>
            </div>

            <TrustScore score={device.trustScore} size="sm" />

            <div className="hidden min-w-[150px] flex-col items-end gap-1.5 md:flex">
              <StatusBadge
                label={`App status: ${protectionLabel}`}
                variant={protectionColor.replace('text-', '') as any}
              />

              <div className="flex items-center gap-1.5">
                {needsApproval && (
                  <StatusBadge
                    label="REVIEW"
                    variant="warning"
                  />
                )}

                <StatusBadge
                  label={
                    device.riskLevel === 'trusted'
                      ? 'SAFE'
                      : device.riskLevel.toUpperCase()
                  }
                  variant={
                    device.riskLevel === 'trusted'
                      ? 'success'
                      : riskVariant
                  }
                />

                <StatusBadge
                  label={device.connectionStatus}
                  variant={connVariant}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-[var(--border)] pt-3 text-[10px] text-[var(--text-muted)] sm:grid-cols-3">
          <span>
            Services{' '}
            <strong className="font-medium text-[var(--text-secondary)]">
              {device.services.length}
            </strong>
          </span>

          <span className="hidden sm:block">
            Connection{' '}
            <strong className="font-medium text-[var(--text-secondary)]">
              {device.connectionStatus}
            </strong>
          </span>

          <span className="text-right">
            Source{' '}
            <strong className="font-medium text-[var(--text-secondary)]">
              {device.discoverySource}
            </strong>
          </span>
        </div>
      </div>
    </button>
  );
}
