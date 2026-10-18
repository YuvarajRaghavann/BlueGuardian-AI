import { describe, expect, it } from 'vitest';
import { aggregateFederatedUpdates, type LocalModelUpdate } from './federatedLearning.js';

const policy = { minimumClients: 3, maximumClients: 10, maximumSamplesPerClient: 500, clipNorm: 2, gaussianNoiseStdDev: 0 };

function update(clientId: string, deltas = [0.5, -0.25]): LocalModelUpdate {
  return { clientId, modelVersion: 'v1', sampleCount: 20, deltas, createdAt: Date.now() };
}

describe('BTGuard federated update primitives', () => {
  it('withholds aggregation below the minimum cohort size', () => {
    const result = aggregateFederatedUpdates([update('a'), update('b')], policy);
    expect(result.accepted).toBe(false);
    expect(result.aggregate).toBeUndefined();
  });

  it('aggregates bounded, same-version updates without including raw samples', () => {
    const result = aggregateFederatedUpdates([update('a'), update('b'), update('c')], policy);
    expect(result.accepted).toBe(true);
    expect(result.aggregate).toEqual([0.5, -0.25]);
    expect(result.privacy.rawSamplesIncluded).toBe(false);
  });

  it('rejects duplicate clients and mismatched update schemas', () => {
    expect(aggregateFederatedUpdates([update('a'), update('a'), update('c')], policy).accepted).toBe(false);
    expect(aggregateFederatedUpdates([update('a'), update('b', [1]), update('c')], policy).accepted).toBe(false);
  });
});
