import type { BluetoothDevice, SecurityAction, SecurityActionType, SecurityAssessment, Threat } from '../types';
import { calculateProtectionStatus } from '../utils/protectionStatus';
import { calculateTrustScore } from '../utils/trustScore';
import { needsManualApproval } from '../utils/connectionPolicy';

export interface ActionValidationResult {
  valid: boolean;
  reason?: string;
}

function reconcileApprovalState(device: BluetoothDevice): BluetoothDevice {
  const next: BluetoothDevice = {
    ...device,
    blocked: Boolean(device.blocked),
  };

  if (next.blocked) {
    next.approvalRequired = false;
    return next;
  }

  next.approvalRequired = needsManualApproval(next);
  return next;
}

export function applySecurityActionToDevice(
  device: BluetoothDevice,
  action: SecurityActionType,
): BluetoothDevice | null {
  switch (action) {
    case 'TRUST':
    case 'MARK_UNKNOWN': {
      const updated = action === 'TRUST'
        ? { ...device, trusted: true, isKnown: true, blocked: false }
        : { ...device, trusted: false, isKnown: false };
      const trust = calculateTrustScore(updated);
      if (action === 'TRUST') {
        // Preserve the explicit user decision. A separate connection attempt
        // must still pass the connection policy and may still be blocked.
        return {
          ...updated,
          trustScore: trust.score,
          riskLevel: trust.riskLevel,
          approvalRequired: false,
        };
      }
      return reconcileApprovalState({
        ...updated,
        trustScore: trust.score,
        riskLevel: trust.riskLevel,
      });
    }
    case 'BLOCK':
      return reconcileApprovalState({ ...device, blocked: true, approvalRequired: false });
    case 'UNBLOCK': {
      return reconcileApprovalState({ ...device, blocked: false });
    }
    case 'FORGET':
      return null;
    default:
      return reconcileApprovalState(device);
  }
}

export function validateAction(
  action: SecurityActionType,
  device: BluetoothDevice,
  assessment: SecurityAssessment,
  activeThreats: Threat[]
): ActionValidationResult {
  const protection = calculateProtectionStatus(device, assessment, activeThreats);

  switch (action) {
    case 'TRUST':
      if (device.trusted && device.isKnown) return { valid: false, reason: 'Device already trusted' };
      if (device.blocked) return { valid: false, reason: 'Unblock this device before approving it' };
      // A risk assessment may be high while review is pending. Trust approval is
      // a review decision, not a connection attempt, so only an explicit block
      // prevents recording that decision here.
      return { valid: true };
    case 'MARK_UNKNOWN':
      if (!device.trusted) return { valid: false, reason: 'Device already marked unknown' };
      return { valid: true };
    case 'BLOCK':
      if (protection === 'BLOCKED') return { valid: false, reason: 'Device already blocked' };
      return { valid: true };
    case 'UNBLOCK':
      if (protection !== 'BLOCKED') return { valid: false, reason: 'Device is not blocked' };
      return { valid: true };
    case 'FORGET':
      // always allowed but warn
      return { valid: true };
    case 'INVESTIGATE':
      return { valid: true };
    case 'RESOLVE_THREAT':
    case 'DISMISS_THREAT':
      return { valid: true };
    case 'IGNORE_DEVICE':
      return { valid: true };
    default:
      return { valid: false, reason: 'Unknown action' };
  }
}

export function getAllowedActions(
  device: BluetoothDevice,
  assessment: SecurityAssessment,
  activeThreats: Threat[]
): SecurityActionType[] {
  const all: SecurityActionType[] = [
    'TRUST',
    'MARK_UNKNOWN',
    'BLOCK',
    'UNBLOCK',
    'FORGET',
    'INVESTIGATE',
    'RESOLVE_THREAT',
    'DISMISS_THREAT',
    'IGNORE_DEVICE',
  ];
  return all.filter(a => validateAction(a, device, assessment, activeThreats).valid);
}

export function createSecurityAction(
  type: SecurityActionType,
  device: BluetoothDevice,
  reason: string,
  source: 'USER' | 'SYSTEM' = 'USER',
  simulated: boolean,
  previousState?: Partial<BluetoothDevice>,
  newState?: Partial<BluetoothDevice>
): SecurityAction {
  return {
    id: `sec-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    type,
    deviceId: device.id,
    deviceName: device.name,
    reason,
    source,
    timestamp: new Date(),
    simulated,
    previousState,
    newState,
  };
}