import type { BluetoothDevice, Threat, ThreatAnalysis } from '../types';
import { analyzeDeviceThreat } from '../utils/threatDetection';

function generateId(prefix = 'thr'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function analysisToThreat(analysis: ThreatAnalysis): Threat {
  return {
    id: generateId(),
    deviceId: analysis.deviceId,
    deviceName: analysis.deviceName,
    category: analysis.category,
    severity: analysis.severity,
    score: analysis.threatScore,
    title: `${analysis.category.replace(/_/g, ' ')} Detected`,
    description: analysis.reasons.map(r => r.message).join(' '),
    reasons: analysis.reasons,
    recommendedAction: analysis.recommendedAction,
    status: 'ACTIVE',
    detectedAt: analysis.analyzedAt,
    updatedAt: analysis.analyzedAt,
    discoverySource: analysis.discoverySource,
    resolved: false,
  };
}

export function analyzeDevice(device: BluetoothDevice): Threat {
  const analysis = analyzeDeviceThreat(device);
  return analysisToThreat(analysis);
}

export function analyzeDevices(devices: BluetoothDevice[]): Threat[] {
  return devices.map(analyzeDevice);
}

/**
 * Deduplicate threats: keep the most recent per device+category
 */
export function deduplicateThreats(threats: Threat[]): Threat[] {
  const map = new Map<string, Threat>();
  for (const t of threats) {
    const key = `${t.deviceId}|${t.category}`;
    const existing = map.get(key);
    if (!existing || t.detectedAt > existing.detectedAt) {
      map.set(key, t);
    }
  }
  return Array.from(map.values());
}

export function filterThreatsBySeverity(threats: Threat[], severity: Threat['severity']): Threat[] {
  return threats.filter(t => t.severity === severity);
}

export function filterThreatsByStatus(threats: Threat[], status: Threat['status']): Threat[] {
  return threats.filter(t => t.status === status);
}