import type { BluetoothDevice, DeviceType } from '../types/index.js';

export interface FeatureVector {
  values: number[];
  featureNames: string[];
}

/**
 * Extract a deterministic numerical feature vector from a BluetoothDevice.
 * Feature order (must match model expectations):
 * 0. normalizedTrustScore (0-1)
 * 1. normalizedRSSI (0-1) where -30dBm -> 1, -100dBm -> 0
 * 2. knownFlag (0 or 1)
 * 3. trustedFlag (0 or 1)
 * 4. blockedFlag (0 or 1)  // riskLevel === 'high' && !trusted
 * 5. serviceCountNorm (0-1)  // services count / 10 capped
 * 6. securityFlagCountNorm (0-1) // simple heuristic count / 5 capped
 * 7. suspiciousNameFlag (0 or 1)
 * 8. connectionStatusFlag (0-1) // connected=1, connecting=0.5, others=0
 * 9. deviceTypeRisk (0-1) // mapping per type
 * 10. discoverySourceFlag (0 or 1) // REAL=1, SIMULATED=0
 */
export function extractDeviceFeatures(device: BluetoothDevice): FeatureVector {
  const trustNorm = Math.max(0, Math.min(1, device.trustScore / 100));

  // RSSI normalization: assume usable range -30 .. -100 dBm
  const rssi = device.rssi ?? -65;
  const rssiNorm = Math.max(0, Math.min(1, (rssi + 100) / 70)); // -30 => 1, -100 => 0

  const knownFlag = device.isKnown ? 1 : 0;
  const trustedFlag = device.trusted ? 1 : 0;
  const blockedFlag = (!device.trusted && device.riskLevel === 'high') ? 1 : 0;

  const serviceCountNorm = Math.min(1, device.services.length / 10);

  // simple security flag count: unknown + high risk + no address + unknown connection
  let secFlags = 0;
  if (!device.isKnown) secFlags++;
  if (device.riskLevel === 'high') secFlags++;
  if (!device.address) secFlags++;
  if (device.connectionStatus === 'unknown') secFlags++;
  const securityFlagCountNorm = Math.min(1, secFlags / 5);

  const suspiciousNameFlag = isSuspiciousName(device.name) ? 1 : 0;

  const connectionMap: Record<string, number> = {
    connected: 1,
    connecting: 0.5,
    disconnected: 0,
    unknown: 0,
  };
  const connectionStatusFlag = connectionMap[device.connectionStatus] ?? 0;

  const deviceTypeRiskMap: Record<DeviceType, number> = {
    smartphone: 0.1,
    earbuds: 0.15,
    headphones: 0.15,
    smartwatch: 0.1,
    laptop: 0.05,
    iot: 0.6,
    unknown: 0.8,
  };
  const deviceTypeRisk = deviceTypeRiskMap[device.type] ?? 0.5;

  const discoverySourceFlag = device.discoverySource === 'REAL' ? 1 : 0;

  const values = [
    trustNorm,
    rssiNorm,
    knownFlag,
    trustedFlag,
    blockedFlag,
    serviceCountNorm,
    securityFlagCountNorm,
    suspiciousNameFlag,
    connectionStatusFlag,
    deviceTypeRisk,
    discoverySourceFlag,
  ];

  const featureNames = [
    'normalizedTrustScore',
    'normalizedRSSI',
    'knownFlag',
    'trustedFlag',
    'blockedFlag',
    'serviceCountNorm',
    'securityFlagCountNorm',
    'suspiciousNameFlag',
    'connectionStatusFlag',
    'deviceTypeRisk',
    'discoverySourceFlag',
  ];

  return { values, featureNames };
}

function isSuspiciousName(name: string): boolean {
  const patterns = [
    /unknown/i,
    /free\s*wifi/i,
    /hack/i,
    /attack/i,
    /spoof/i,
    /test/i,
    /^device\s*\d+$/i,
    /^bt[-_]?\d+$/i,
  ];
  return patterns.some((re) => re.test(name));
}