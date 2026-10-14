import {
  BarChart3,
  Brain,
  AlertTriangle,
  Cpu,
  ShieldCheck,
  Activity,
} from 'lucide-react';
import { StatCard } from '../components/StatCard';
import { useThreats } from '../context/ThreatContext';
import { useBluetoothDevices } from '../context/DeviceContext';

export function Analytics() {
  const { state: threatState } = useThreats();
  const { state: deviceState } = useBluetoothDevices();

  const predictions = threatState.threats.filter(t => t.mlPrediction);

  const totalPredictions = predictions.length;

  const classificationDist = predictions.reduce(
    (acc, t) => {
      const cls =
        t.finalClassification ??
        t.mlPrediction?.label ??
        'UNKNOWN';

      acc[cls] = (acc[cls] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const avgConfidence =
    totalPredictions > 0
      ? Math.round(
          (predictions.reduce(
            (sum, t) => sum + (t.confidence ?? 0),
            0
          ) /
            totalPredictions) *
            100
        )
      : 0;

  const highRiskPredictions = predictions.filter(
    t =>
      (t.confidence ?? 0) >= 0.6 &&
      [
        'HIGH_RISK_DEVICE',
        'POTENTIAL_SPOOFING',
        'POTENTIAL_UNAUTHORIZED_ACCESS',
      ].includes(
        t.finalClassification ?? t.mlPrediction?.label ?? ''
      )
  ).length;

  const lowConfidencePredictions = predictions.filter(
    t => (t.confidence ?? 0) < 0.6
  ).length;

  const severityCounts = {
    critical: threatState.threats.filter(
      t => t.severity === 'critical'
    ).length,
    high: threatState.threats.filter(
      t => t.severity === 'high'
    ).length,
    medium: threatState.threats.filter(
      t => t.severity === 'medium'
    ).length,
    low: threatState.threats.filter(
      t => t.severity === 'low'
    ).length,
  };

  const maxClassification =
    Math.max(...Object.values(classificationDist), 1);

  const maxSeverity =
    Math.max(...Object.values(severityCounts), 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <header>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
          <Activity className="h-3.5 w-3.5" />
          Security intelligence
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)] sm:text-3xl">
              Analytics
            </h1>

            <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
              Operational metrics from the current BlueGuardian
              security-analysis session.
            </p>
          </div>

          <span className="w-fit rounded-full border border-[var(--warning)]/25 bg-[var(--warning)]/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--warning)]">
            Development model
          </span>
        </div>
      </header>

      {/* Metrics */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          title="Predictions"
          value={totalPredictions}
          icon={Brain}
        />

        <StatCard
          title="Avg Confidence"
          value={`${avgConfidence}%`}
          icon={Cpu}
        />

        <StatCard
          title="High Risk"
          value={highRiskPredictions}
          icon={AlertTriangle}
        />

        <StatCard
          title="Low Confidence"
          value={lowConfidencePredictions}
          icon={AlertTriangle}
        />

        <StatCard
          title="Devices"
          value={deviceState.devices.length}
          icon={BarChart3}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Classification */}
        <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-soft)]">
                <Brain className="h-4 w-4 text-[var(--accent)]" />
              </div>

              <h2 className="text-sm font-semibold text-[var(--text)]">
                Classification Distribution
              </h2>

              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Current development-model classifications
              </p>
            </div>

            <span className="text-xs font-medium text-[var(--text-muted)]">
              {totalPredictions} total
            </span>
          </div>

          {Object.entries(classificationDist).length > 0 ? (
            <div className="space-y-4">
              {Object.entries(classificationDist).map(
                ([cls, count]) => {
                  const percentage = Math.round(
                    (count / totalPredictions) * 100
                  );

                  return (
                    <div key={cls}>
                      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                        <span className="truncate font-medium text-[var(--text-secondary)]">
                          {cls.replace(/_/g, ' ')}
                        </span>

                        <span className="shrink-0 text-[var(--text-muted)]">
                          {count} · {percentage}%
                        </span>
                      </div>

                      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-raised)]">
                        <div
                          className="h-full rounded-full bg-[var(--accent)] transition-all"
                          style={{
                            width: `${Math.max(
                              4,
                              (count / maxClassification) * 100
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          ) : (
            <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--border)] py-10 text-center">
              <Brain className="mx-auto mb-3 h-6 w-6 text-[var(--text-muted)]" />
              <p className="text-sm font-medium text-[var(--text-secondary)]">
                No predictions yet
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Run a device scan to generate analysis data.
              </p>
            </div>
          )}
        </section>

        {/* Severity */}
        <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-soft)]">
                <AlertTriangle className="h-4 w-4 text-[var(--accent)]" />
              </div>

              <h2 className="text-sm font-semibold text-[var(--text)]">
                Threat Severity
              </h2>

              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Distribution across detected security events
              </p>
            </div>

            <ShieldCheck className="h-4 w-4 text-[var(--text-muted)]" />
          </div>

          <div className="space-y-4">
            {(
              Object.entries(severityCounts) as [
                keyof typeof severityCounts,
                number
              ][]
            ).map(([severity, count]) => {
              const percentage =
                threatState.threats.length > 0
                  ? Math.round(
                      (count / threatState.threats.length) * 100
                    )
                  : 0;

              return (
                <div key={severity}>
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="capitalize font-medium text-[var(--text-secondary)]">
                      {severity}
                    </span>

                    <span className="text-[var(--text-muted)]">
                      {count} · {percentage}%
                    </span>
                  </div>

                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-raised)]">
                    <div
                      className="h-full rounded-full bg-[var(--accent)]"
                      style={{
                        width: `${Math.max(
                          count > 0 ? 4 : 0,
                          (count / maxSeverity) * 100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Methodology note */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--warning)]/10">
            <Cpu className="h-4 w-4 text-[var(--warning)]" />
          </div>

          <div>
            <h2 className="text-sm font-semibold text-[var(--text)]">
              Model interpretation
            </h2>

            <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--text-secondary)]">
              These analytics describe the deterministic development
              classifier currently integrated into BlueGuardian. They
              are intended for integration testing and interface
              validation, not as evidence of production model
              performance.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
