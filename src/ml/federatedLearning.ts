/**
 * Privacy-preserving federated-update primitives for a future trainable model.
 * These utilities do not train the current deterministic development heuristic.
 * Raw traffic/features must remain on-device; transport and secure aggregation
 * must be implemented by the authenticated backend before deployment.
 */
export interface LocalModelUpdate {
  clientId: string;
  modelVersion: string;
  sampleCount: number;
  deltas: number[];
  createdAt: number;
}
export interface FederatedAggregationPolicy {
  minimumClients: number;
  maximumClients: number;
  maximumSamplesPerClient: number;
  clipNorm: number;
  gaussianNoiseStdDev: number;
}
export interface FederatedAggregationResult {
  accepted: boolean;
  modelVersion: string;
  clientCount: number;
  aggregate?: number[];
  reason: string;
  privacy: { rawSamplesIncluded: false; clippingApplied: boolean; noiseApplied: boolean };
}

function l2Norm(values: number[]): number {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
}
function secureUniform(): number {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) throw new Error('Cryptographic randomness is unavailable; refusing to generate privacy noise.');
  const data = new Uint32Array(1);
  cryptoApi.getRandomValues(data);
  return (data[0] + 1) / (0x100000000 + 1);
}
function gaussianNoise(stdDev: number): number {
  if (stdDev <= 0) return 0;
  const u1 = secureUniform();
  const u2 = secureUniform();
  return stdDev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function clip(values: number[], maxNorm: number): number[] {
  const norm = l2Norm(values);
  if (!norm || norm <= maxNorm) return [...values];
  const factor = maxNorm / norm;
  return values.map(value => value * factor);
}

/** Aggregate updates only when the cohort threshold and schema checks pass. */
export function aggregateFederatedUpdates(
  updates: LocalModelUpdate[],
  policy: FederatedAggregationPolicy,
): FederatedAggregationResult {
  const fail = (reason: string): FederatedAggregationResult => ({
    accepted: false, modelVersion: updates[0]?.modelVersion ?? 'unknown', clientCount: 0, reason,
    privacy: { rawSamplesIncluded: false, clippingApplied: false, noiseApplied: false },
  });
  if (!Number.isInteger(policy.minimumClients) || policy.minimumClients < 2) return fail('Minimum cohort must be at least two clients.');
  if (updates.length < policy.minimumClients) return fail('Insufficient clients; aggregation withheld to reduce single-client disclosure.');
  if (updates.length > policy.maximumClients) return fail('Cohort exceeds configured maximum; split into bounded cohorts.');
  const version = updates[0].modelVersion;
  const width = updates[0].deltas.length;
  if (!width || updates.some(u => u.modelVersion !== version || u.deltas.length !== width ||
      !Number.isInteger(u.sampleCount) || u.sampleCount < 1 || u.sampleCount > policy.maximumSamplesPerClient ||
      u.deltas.some(v => !Number.isFinite(v)))) {
    return fail('Update schema, model version, or per-client sample bounds are invalid.');
  }
  if (new Set(updates.map(u => u.clientId)).size !== updates.length) return fail('Duplicate client updates are not allowed.');
  if (!(policy.clipNorm > 0) || policy.gaussianNoiseStdDev < 0) return fail('Invalid clipping or noise policy.');
  const clipped = updates.map(u => clip(u.deltas, policy.clipNorm));
  const aggregate = Array.from({ length: width }, (_, i) =>
    clipped.reduce((sum, delta) => sum + delta[i], 0) / clipped.length + gaussianNoise(policy.gaussianNoiseStdDev));
  return {
    accepted: true, modelVersion: version, clientCount: updates.length, aggregate,
    reason: 'Clipped cohort update aggregated; raw examples are not part of the payload. Configure noise and a formal privacy accountant before making differential-privacy claims.',
    privacy: { rawSamplesIncluded: false, clippingApplied: true, noiseApplied: policy.gaussianNoiseStdDev > 0 },
  };
}
