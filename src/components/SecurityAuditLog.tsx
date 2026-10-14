import { formatDistanceToNow } from 'date-fns';
import type { SecurityAction } from '../types';
import { StatusBadge } from './StatusBadge';
import { cn } from '../utils/cn';

interface SecurityAuditLogProps {
  actions: SecurityAction[];
  title?: string;
}

export function SecurityAuditLog({ actions, title = 'Security Audit Log' }: SecurityAuditLogProps) {
  if (actions.length === 0) {
    return (
      <div className="bg-card/80 backdrop-blur-sm rounded-xl p-6 border border-gray-800">
        <h3 className="font-semibold text-white mb-4">{title}</h3>
        <p className="text-muted text-center py-8">No browser actions are recorded. Local approvals, app-level blocks, and dismissals appear here when made.</p>
      </div>
    );
  }

  return (
    <div className="bg-card/80 backdrop-blur-sm rounded-xl p-6 border border-gray-800">
      <h3 className="font-semibold text-white mb-4">{title}</h3>
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {actions.map((action, idx) => (
          <div key={action.id} className={cn('flex items-start gap-4 relative', idx < actions.length - 1 && 'pb-3')}>
            <div className="relative flex-shrink-0">
              <div className="w-2 h-2 rounded-full mt-2 bg-gray-600" />
              {idx < actions.length - 1 && (
                <div className="absolute left-1 top-4 bottom-0 w-0.5 bg-gray-700" />
              )}
            </div>
            <div className="flex-1 min-w-0 pl-3">
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge label={action.type} variant="info" />
                <StatusBadge label={action.source} variant={action.source === 'USER' ? 'success' : 'warning'} />
                {action.simulated && <StatusBadge label="SIMULATED" variant="warning" />}
              </div>
              <p className="text-sm text-white mt-1">
                <strong>{action.deviceName}</strong> · {action.reason}
              </p>
              <p className="text-xs text-muted mt-1">
                Outcome: {action.type === 'BLOCK' ? 'Blocked from future app-level access' : action.type === 'TRUST' ? 'Approved and treated as a trusted device candidate' : action.type === 'MARK_UNKNOWN' ? 'Device identity reset to unknown' : 'Security decision recorded'}
              </p>
              <p className="text-xs text-muted mt-1 ml-8">
                {formatDistanceToNow(action.timestamp, { addSuffix: true })}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}