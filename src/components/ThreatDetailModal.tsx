import { X, ShieldCheck, AlertTriangle, Ban, Clock, Target, Brain } from 'lucide-react';
import type { Threat } from '../types';
import { StatusBadge } from './StatusBadge';
import { formatDistanceToNow } from 'date-fns';
import { useThreats } from '../context/ThreatContext';
import { useSecurity } from '../context/SecurityContext';

interface ThreatDetailModalProps {
  threat: Threat | null;
  onClose: () => void;
}

export function ThreatDetailModal({ threat, onClose }: ThreatDetailModalProps) {
  const { dispatch } = useThreats();
  const { state: securityState } = useSecurity();
  if (!threat) return null;

  const severityColors = {
    low: 'bg-blue-900/30 text-blue-400',
    medium: 'bg-yellow-900/30 text-yellow-400',
    high: 'bg-orange-900/30 text-orange-400',
    critical: 'bg-red-900/30 text-red-400',
  };

  const confidenceLabel = (c: number) => {
    if (c >= 0.8) return 'High confidence';
    if (c >= 0.6) return 'Moderate confidence';
    return 'Low confidence';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-700 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-gray-800">
          <div>
            <h2 className="text-xl font-bold text-white">{threat.title}</h2>
            <p className="text-muted text-sm">{threat.deviceName} • {threat.category.replace(/_/g, ' ')}</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Severity & Score */}
          <div className="flex items-center gap-6">
            <div className={`px-4 py-2 rounded-lg ${severityColors[threat.severity]}`}>
              <p className="text-sm font-medium">{threat.severity.toUpperCase()}</p>
            </div>
            <div>
              <p className="text-sm text-muted">Threat Score</p>
              <p className="text-3xl font-bold text-white">{threat.score}/100</p>
            </div>
            <div>
              <p className="text-sm text-muted">Status</p>
              <StatusBadge label={threat.status} variant={threat.status === 'RESOLVED' ? 'success' : threat.status === 'DISMISSED' ? 'default' : threat.status === 'INVESTIGATING' ? 'warning' : 'danger'} />
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid gap-4 md:grid-cols-2">
            <section className="bg-gray-800/50 rounded-xl p-4">
              <h3 className="font-semibold text-white mb-3 flex items-center gap-2"><Target className="w-5 h-5" />Detection Info</h3>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted">Category</dt><dd className="font-medium capitalize">{threat.category.replace(/_/g, ' ')}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Device ID</dt><dd className="font-mono text-xs">{threat.deviceId}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Detected</dt><dd>{formatDistanceToNow(threat.detectedAt, { addSuffix: true })}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Last Updated</dt><dd>{formatDistanceToNow(threat.updatedAt, { addSuffix: true })}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Source</dt><dd><StatusBadge label={threat.discoverySource} variant={threat.discoverySource==='REAL'?'info':'warning'} /></dd></div>
              </dl>
            </section>

            <section className="bg-gray-800/50 rounded-xl p-4">
              <h3 className="font-semibold text-white mb-3 flex items-center gap-2"><Clock className="w-5 h-5" />Description</h3>
              <p className="text-sm text-white">{threat.description}</p>
            </section>
          </div>

          {/* AI/ML Analysis Section */}
          {threat.mlPrediction && (
            <section className="bg-gray-800/50 rounded-xl p-4 border border-accent/30">
              <h3 className="font-semibold text-white mb-3 flex items-center gap-2"><Brain className="w-5 h-5 text-accent" />AI/ML Analysis (Development Model)</h3>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted">Model</dt><dd className="font-medium">{threat.modelName ?? threat.mlPrediction.modelName}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Version</dt><dd className="font-medium">{threat.modelVersion ?? threat.mlPrediction.modelVersion}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Classification</dt><dd className="font-medium capitalize">{threat.finalClassification ?? threat.mlPrediction.label.replace(/_/g, ' ')}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Confidence</dt><dd className="font-medium">
                  {Math.round((threat.confidence ?? threat.mlPrediction.confidence) * 100)}%
                  {((threat.confidence ?? threat.mlPrediction.confidence) >= 0.6 || securityState.policy.showLowConfidenceWarnings) &&
                    ` — ${confidenceLabel(threat.confidence ?? threat.mlPrediction.confidence)}`}
                </dd></div>
                <div className="flex justify-between"><dt className="text-muted">Features used</dt><dd className="text-muted text-xs">{threat.mlPrediction.featuresUsed.join(', ')}</dd></div>
              </dl>
              <p className="mt-2 text-xs text-muted"><strong>Explanation:</strong> {threat.mlPrediction.explanation}</p>
              <p className="mt-2 text-xs text-muted italic">Development model — not a production-trained threat detection model.</p>
            </section>
          )}

          {/* Reasons */}
          <section className="bg-gray-800/50 rounded-xl p-4">
            <h3 className="font-semibold text-white mb-3 flex items-center gap-2"><AlertTriangle className="w-5 h-5" />Detection Reasons</h3>
            <ul className="list-disc list-inside space-y-1 text-sm text-white">
              {threat.reasons.map((r, i) => (
                <li key={i}>{r.message}</li>
              ))}
            </ul>
          </section>

          {/* Recommended Action */}
          <section className="bg-gray-800/50 rounded-xl p-4 border border-accent/30">
            <h3 className="font-semibold text-white mb-2 flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-accent" />Recommended Action</h3>
            <p className="text-sm text-white">{threat.recommendedAction}</p>
          </section>

          {/* Actions */}
          <div className="flex flex-wrap gap-3 pt-4 border-t border-gray-800">
            {threat.status !== 'RESOLVED' && threat.status !== 'DISMISSED' && (
              <>
                <button
                  onClick={() => dispatch({ type: 'INVESTIGATE_THREAT', payload: threat.id })}
                  className="px-4 py-2 bg-yellow-900/30 text-yellow-400 rounded-lg hover:bg-yellow-900/50 transition-colors flex items-center gap-2"
                >
                  <Target className="w-4 h-4" /> Mark Investigating
                </button>
                <button
                  onClick={() => dispatch({ type: 'RESOLVE_THREAT', payload: threat.id })}
                  className="px-4 py-2 bg-green-900/30 text-green-400 rounded-lg hover:bg-green-900/50 transition-colors flex items-center gap-2"
                >
                  <ShieldCheck className="w-4 h-4" /> Resolve
                </button>
                <button
                  onClick={() => dispatch({ type: 'DISMISS_THREAT', payload: threat.id })}
                  className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors flex items-center gap-2"
                >
                  <Ban className="w-4 h-4" /> Dismiss
                </button>
              </>
            )}
            {(threat.status === 'RESOLVED' || threat.status === 'DISMISSED') && (
              <button
                onClick={() => dispatch({ type: 'INVESTIGATE_THREAT', payload: threat.id })} // reopen sets to INVESTIGATING
                className="px-4 py-2 bg-accent/20 text-accent rounded-lg hover:bg-accent/30 transition-colors flex items-center gap-2"
              >
                <ShieldCheck className="w-4 h-4" /> Reopen
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}