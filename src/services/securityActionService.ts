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

  next.approvalRequired = needsManualApproval({ ...next, approvalRequired: false });
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
        ? { ...device, trusted: true, isKnown: true }
        : { ...device, trusted: false, isKnown: false };
      const trust = calculateTrustScore(updated);
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
      if (device.trusted && !device.approvalRequired && device.isKnown) return { valid: false, reason: 'Device already trusted' };
      if (protection === 'BLOCKED') return { valid: false, reason: 'Cannot trust a blocked device without unblocking first' };
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