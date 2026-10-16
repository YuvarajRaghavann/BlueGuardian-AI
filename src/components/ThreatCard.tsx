import type { Threat, ThreatCategory } from '../types';
import { StatusBadge } from './StatusBadge';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertCircle,
  ShieldAlert,
  WifiOff,
  Link,
  AlertTriangle,
  Shield,
  Cpu,
  Wifi,
  UserX,
  Brain,
  Clock3,
  Radio,
} from 'lucide-react';

const categoryIcons: Record<ThreatCategory, typeof AlertCircle> = {
  UNKNOWN_DEVICE: UserX,
  LOW_TRUST: ShieldAlert,
  SUSPICIOUS_NAME: AlertTriangle,
  WEAK_SECURITY: Shield,
  RAPID_DEVICE_APPEARANCE: Cpu,
  UNUSUAL_SIGNAL: Wifi,
  REPEATED_CONNECTION: Link,
  UNSTABLE_CONNECTION: WifiOff,
  BLOCKED_DEVICE: UserX,
  SPOOFING_SUSPECTED: WifiOff,
  BLE_ADVERTISING_FLOOD: Radio,
  OTHER: AlertCircle,
};

const severityStyles = {
  low: {
    icon: 'text-[var(--accent)]',
    bg: 'bg-[var(--accent-soft)]',
    border: 'border-[rgba(59,156,255,0.18)]',
    label: 'info' as const,
  },
  medium: {
    icon: 'text-[var(--warning)]',
    bg: 'bg-[rgba(242,184,75,0.08)]',
    border: 'border-[rgba(242,184,75,0.18)]',
    label: 'warning' as const,
  },
  high: {
    icon: 'text-[var(--danger)]',
    bg: 'bg-[rgba(239,98,98,0.08)]',
    border: 'border-[rgba(239,98,98,0.18)]',
    label: 'danger' as const,
  },
  critical: {
    icon: 'text-[var(--danger)]',
    bg: 'bg-[rgba(239,98,98,0.12)]',
    border: 'border-[rgba(239,98,98,0.28)]',
    label: 'danger' as const,
  },
} as const;

function confidenceLabel(confidence: number) {
  if (confidence >= 0.8) return 'High';
  if (confidence >= 0.6) return 'Moderate';
  return 'Low';
}

export function ThreatCard({
  threat,
  onClick,
}: {
  threat: Threat;
  onClick?: () => void;
}) {
  const Icon = categoryIcons[threat.category] || AlertCircle;
  const style = severityStyles[threat.severity];

  const confidence =
    threat.confidence ?? threat.mlPrediction?.confidence ?? 0;

  const classification =
    threat.finalClassification ??
    threat.mlPrediction?.label.replace(/_/g, ' ');

  return (
    <button
      type="button"
      onClick={onClick}
      className="group block w-full text-left"
    >
      <div className="p-4 transition-colors hover:bg-[var(--surface-raised)] sm:p-5">
        <div className="flex gap-3.5">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${style.border} ${style.bg}`}
          >
            <Icon className={`h-[18px] w-[18px] ${style.icon}`} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="truncate text-sm font-semibold text-white">
                    {threat.title}
                  </h4>

                  <StatusBadge
                    label={threat.severity}
                    variant={style.label}
                  />
                </div>

                <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                  {threat.description}
                </p>
              </div>

              <StatusBadge
                label={threat.status}
                variant={
                  threat.status === 'RESOLVED'
                    ? 'success'
                    : threat.status === 'DISMISSED'
                      ? 'default'
                      : threat.status === 'INVESTIGATING'
                        ? 'warning'
                        : 'danger'
                }
              />
            </div>

            {threat.mlPrediction && (
              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2">
                <Brain className="h-3.5 w-3.5 text-[var(--accent)]" />

                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">
                  AI signal
                </span>

                <span className="text-xs font-medium text-white">
                  {classification}
                </span>

                <span className="text-[10px] text-[var(--text-muted)]">
                  {Math.round(confidence * 100)}%{' '}
                  {confidenceLabel(confidence)} confidence
                </span>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-[var(--text-muted)]">
              <span className="flex items-center gap-1.5">
                <AlertCircle className="h-3 w-3" />
                {threat.category.replace(/_/g, ' ')}
              </span>

              <span className="flex items-center gap-1.5">
                <Clock3 className="h-3 w-3" />
                {formatDistanceToNow(threat.detectedAt, {
                  addSuffix: true,
                })}
              </span>
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}
