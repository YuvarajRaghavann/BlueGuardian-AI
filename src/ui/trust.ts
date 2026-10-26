import type { EvidenceKind, TrustLevel, TrustOpinion } from '../intel/engine';

export const LEVEL: Record<TrustLevel, { label: string; color: string; short: string }> = {
  trusted: { label: 'Trusted', short: 'Trusted', color: 'var(--success)' },
  likely_safe: { label: 'Likely safe', short: 'Likely safe', color: '#a7e8a0' },
  uncertain: { label: 'Uncertain', short: 'Uncertain', color: 'var(--warning)' },
  untrusted: { label: 'Untrusted', short: 'Untrusted', color: 'var(--danger)' },
  unverified: { label: 'Not enough evidence yet', short: 'New', color: 'var(--text-muted)' },
};

export function score(o: TrustOpinion): number {
  return Math.round(o.p * 100);
}

export const EVIDENCE_LABEL: Record<EvidenceKind, string> = {
  paired: 'Paired',
  user_trust: 'Your decision',
  user_untrust: 'Your decision',
  user_block: 'Blocked',
  user_mine: 'Your decision',
  consistent: 'Consistent',
  connected: 'Connected',
  identity_change: 'Identity changed',
  signal_anomaly: 'Unusual signal',
  finding_high: 'Alert',
  finding_medium: 'Warning',
  finding_low: 'Notice',
};
