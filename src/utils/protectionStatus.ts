import type { BluetoothDevice, SecurityAssessment, Threat, DeviceProtectionStatus } from '../types';

export function calculateProtectionStatus(
  device: BluetoothDevice,
  assessment: SecurityAssessment,
  activeThreats: Threat[]
): DeviceProtectionStatus {
  void assessment.finalSeverity;

  if (device.blocked) return 'BLOCKED';

  // Protected: trusted and no active high/critical threats
  if (device.trusted && device.isKnown) {
    const hasHighThreat = activeThreats.some(
      t => (t.severity === 'high' || t.severity === 'critical') && t.status === 'ACTIVE'
    );
    if (!hasHighThreat) return 'PROTECTED';
  }

  // At risk: active high/critical threats and not blocked
  const hasHighThreat = activeThreats.some(
    t => (t.severity === 'high' || t.severity === 'critical') && t.status === 'ACTIVE'
  );
  if (hasHighThreat) return 'AT_RISK';

  // Monitoring: unknown or suspicious but no immediate critical risk
  if (!device.trusted || !device.isKnown) {
    return 'MONITORING';
  }

  return 'UNKNOWN';
}

export function getProtectionStatusLabel(status: DeviceProtectionStatus): string {
  switch (status) {
    case 'PROTECTED': return 'Trusted in app';
    case 'MONITORING': return 'Review needed';
    case 'AT_RISK': return 'Elevated risk';
    case 'BLOCKED': return 'Blocked in app';
    default: return 'Unknown';
  }
}

export function getProtectionStatusColor(status: DeviceProtectionStatus): string {
  switch (status) {
    case 'PROTECTED': return 'text-green-400';
    case 'MONITORING': return 'text-blue-400';
    case 'AT_RISK': return 'text-orange-400';
    case 'BLOCKED': return 'text-red-400';
    default: return 'text-gray-400';
  }
}