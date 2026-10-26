import type { BluetoothDevice, DeviceType } from '../types/index.js';

export interface FeatureVector {
  values: number[];
  featureNames: string[];
}

/**
 * Stable 11-feature vector for the development heuristic.
 * Missing address/manufacturer, unknown status and one RSSI measurement are
 * not independent evidence of malicious behaviour.
 */
export function extractDeviceFeatures(device: BluetoothDevice): FeatureVector {
  const trustNorm = Math.max(0, Math.min(1, device.trustScore / 100));
  const rssi = device.rssi;
  const rssiNorm = typeof rssi === 'number'
    ? Math.max(0, Math.min(1, (rssi + 100) / 70))
    : 0.5;

  const knownFlag = device.isKnown ? 1 : 0;
  const trustedFlag = device.trusted ? 1 : 0;
  const blockedFlag = device.blocked ? 1 : 0;
  const serviceCountNorm = Math.min(1, device.services.length / 10);
  const suspiciousNameFlag = isSuspiciousName(device.name);

  const independentIndicators = [
    suspiciousNameFlag,
    device.connectionHealth === 'UNSTABLE',
    device.connectionHealth === 'DEGRADED',
  ];
  const securityFlagCountNorm = independentIndicators.filter(Boolean).length / independentIndicators.length;

  const connectionMap: Record<string, number> = {
    connected: 1,
    connecting: 0.5,
    disconnected: 0.25,
    unknown: 0.5,
  };
  const connectionStatusFlag = connectionMap[device.connectionStatus] ?? 0.5;

  const deviceTypeRiskMap: Record<DeviceType, number> = {
    smartphone: 0.1,
    earbuds: 0.15,
    headphones: 0.15,
    smartwatch: 0.1,
    laptop: 0.05,
    iot: 0.4,
    unknown: 0.35,
  };
  const deviceTypeRisk = deviceTypeRiskMap[device.type] ?? 0.35;
  const discoverySourceFlag = device.discoverySource === 'REAL' ? 1 : 0;

  return {
    values: [
      trustNorm, rssiNorm, knownFlag, trustedFlag, blockedFlag,
      serviceCountNorm, securityFlagCountNorm, suspiciousNameFlag ? 1 : 0,
      connectionStatusFlag, deviceTypeRisk, discoverySourceFlag,
    ],
    featureNames: [
      'normalizedTrustScore',
      'normalizedRSSI',
      'knownFlag',
      'trustedFlag',
      'explicitlyBlockedFlag',
      'serviceCountNorm',
      'independentSecurityIndicatorCountNorm',
      'suspiciousNameFlag',
      'connectionStatusFlag',
      'deviceTypeRisk',
      'discoverySourceFlag',
    ],
  };
}

function isSuspiciousName(name: string): boolean {
  return /free\s*wifi|hack|attack|spoof|malware|phishing/i.test(name);
}
