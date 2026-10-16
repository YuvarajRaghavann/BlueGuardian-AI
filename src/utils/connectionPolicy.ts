import type { BluetoothDevice } from '../types';

export type ConnectionDecision = 'ALLOW' | 'REQUIRE_APPROVAL' | 'BLOCK';
export type WearableMode = 'AUDIO_ONLY' | 'RESTRICTED' | 'BLOCKED' | 'FULL_ACCESS';
export type RssiRisk = 'NORMAL' | 'WARNING' | 'BLOCK';

export interface ConnectionRequestContext {
  isFastPair?: boolean;
  isQuickConnect?: boolean;
  rssi?: number;
  fileName?: string;
  deviceType?: BluetoothDevice['type'];
}

const suspiciousNamePattern = /unknown|free\s*wifi|hack|attack|spoof|bt[-_]?\d+/i;
const suspiciousFilePattern = /\.(exe|bat|cmd|ps1|scr|js|vbs|jar|msi|dll|apk)$/i;

export function evaluateRssiRisk(rssi?: number): RssiRisk {
  if (typeof rssi !== 'number') return 'NORMAL';
  if (rssi > -35) return 'BLOCK';
  if (rssi < -85) return 'WARNING';
  return 'NORMAL';
}

export function evaluateWearableProfile(device: BluetoothDevice): WearableMode {
  if (device.blocked) return 'BLOCKED';

  const wearableTypes = new Set<BluetoothDevice['type']>(['headphones', 'earbuds', 'smartwatch']);
  if (!wearableTypes.has(device.type)) return 'FULL_ACCESS';

  if (!device.trusted || !device.isKnown || device.trustScore < 60) {
    return 'RESTRICTED';
  }

  return 'AUDIO_ONLY';
}

export function needsManualApproval(
  device: BluetoothDevice,
  context: ConnectionRequestContext = {},
): boolean {
  if (device.blocked) return false;
  const decision = evaluateBluetoothConnection(device, context);
  return decision === 'REQUIRE_APPROVAL' || Boolean(device.approvalRequired);
}

export function evaluateBluetoothConnection(
  device: BluetoothDevice,
  context: ConnectionRequestContext = {},
): ConnectionDecision {
  if (device.blocked) return 'BLOCK';

  const suspiciousName = suspiciousNamePattern.test(device.name);
  const rssiRisk = evaluateRssiRisk(context.rssi ?? device.rssi);
  const fastPairFlow = Boolean(context.isFastPair || context.isQuickConnect);

  // Derived risk and a single strong RSSI sample are review signals, not a verified block.
  if (device.riskLevel === 'high' || device.trustScore <= 25 || rssiRisk === 'BLOCK') {
    return 'REQUIRE_APPROVAL';
  }

  if (device.trusted && device.isKnown && device.trustScore >= 60 && !suspiciousName) {
    return 'ALLOW';
  }

  if (fastPairFlow && (!device.trusted || !device.isKnown)) {
    return 'REQUIRE_APPROVAL';
  }

  if (!device.isKnown || device.trustScore < 60 || suspiciousName || device.riskLevel === 'medium' || rssiRisk === 'WARNING') {
    return 'REQUIRE_APPROVAL';
  }

  return 'ALLOW';
}

export function evaluateFileTransferSafety(
  device: BluetoothDevice,
  fileName = '',
  context: ConnectionRequestContext = {},
): ConnectionDecision {
  if (device.blocked) return 'BLOCK';

  const suspiciousFile = suspiciousFilePattern.test(fileName);
  if (suspiciousFile) {
    if (!device.trusted || !device.isKnown) return 'BLOCK';
    return 'REQUIRE_APPROVAL';
  }

  const connectionDecision = evaluateBluetoothConnection(device, context);
  if (connectionDecision === 'BLOCK') return 'BLOCK';
  if (connectionDecision === 'REQUIRE_APPROVAL') return 'REQUIRE_APPROVAL';

  return 'ALLOW';
}

export function evaluateSecureBluetoothProfile(
  device: BluetoothDevice,
  context: ConnectionRequestContext = {},
): {
  connectionDecision: ConnectionDecision;
  fileTransferDecision: ConnectionDecision;
  wearableMode: WearableMode;
  rssiRisk: RssiRisk;
  approvalRequired: boolean;
} {
  const connectionDecision = evaluateBluetoothConnection(device, context);

  return {
    connectionDecision,
    fileTransferDecision: evaluateFileTransferSafety(device, context.fileName ?? '', context),
    wearableMode: evaluateWearableProfile(device),
    rssiRisk: evaluateRssiRisk(context.rssi ?? device.rssi),
    approvalRequired: needsManualApproval(device, context),
  };
}
