import type { BluetoothDevice, SecurityAssessment, Threat, SecurityActionType } from '../types';

export interface SecurityRecommendation {
  recommendation: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  suggestedAction: SecurityActionType;
  explanation: string;
}

export function getSecurityRecommendation(
  device: BluetoothDevice,
  assessment: SecurityAssessment,
  _activeThreats: Threat[]
): SecurityRecommendation {
  // Trusted low risk
  if (device.trusted && device.isKnown && assessment.finalSeverity === 'low') {
    return {
      recommendation: 'Device appears low risk. Continue normal monitoring.',
      priority: 'low',
      suggestedAction: 'IGNORE_DEVICE',
      explanation: 'Trusted device with no active threats.',
    };
  }

  // Unknown device medium risk
  if (!device.isKnown && (assessment.finalSeverity === 'medium' || assessment.finalSeverity === 'high')) {
    return {
      recommendation: 'Review the device before trusting it.',
      priority: 'medium',
      suggestedAction: 'INVESTIGATE',
      explanation: 'Device is unknown and has elevated threat indicators.',
    };
  }

  // High risk / suspicious
  if (assessment.finalSeverity === 'high') {
    return {
      recommendation: 'Do not trust this device until it has been verified.',
      priority: 'high',
      suggestedAction: 'BLOCK',
      explanation: 'High threat score with multiple risk indicators.',
    };
  }

  // Critical risk
  if (assessment.finalSeverity === 'critical') {
    return {
      recommendation: 'High-risk indicators detected. Review and consider blocking the device.',
      priority: 'critical',
      suggestedAction: 'BLOCK',
      explanation: 'Critical threat level from rule-based and ML analysis.',
    };
  }

  // Default fallback
  return {
    recommendation: 'Monitor the device and reassess periodically.',
    priority: 'low',
    suggestedAction: 'IGNORE_DEVICE',
    explanation: 'No specific recommendation at this time.',
  };
}