import modelSource from './generated/bleFloodModel.json?raw';

export interface BleObservationWindowFeatures {
  windowStartMs: number;
  windowEndMs: number;
  windowDurationMs: number;
  observationCount: number;
  observationsPerSecond: number;
  uniqueAddresses: number;
  uniqueAddressFraction: number;
  maxAddressFraction: number;
  rssiMean: number;
  rssiStd: number;
  rssiObservationFraction: number;
  advertisedNameFraction?: number;
  serviceUuidFraction?: number;
  telemetrySource: 'ANDROID_SCAN_CALLBACKS' | 'PCAP';
}

interface ExportedTreeNode {
  feature: number;
  threshold: number;
  left: number;
  right: number;
  benignProbability: number;
  bleFloodProbability: number;
}

interface ExportedTree {
  nodes: ExportedTreeNode[];
}

interface BleFloodArtifact {
  status?: string;
  modelName?: string;
  modelVersion?: string;
  featureNames?: string[];
  imputationValues?: Record<string, number>;
  decisionThreshold?: number;
  trees?: ExportedTree[];
  evaluationSummary?: {
    preliminaryGatesPassed?: boolean;
    benignFalsePositiveRate?: number;
    bleFloodRecall?: number;
  } | null;
  deploymentStatus?: string;
  validationReview?: {
    reviewedAt?: string;
    reviewedBy?: string;
    hardwareSmokeTest?: boolean;
  } | null;
}

export interface BleFloodModelStatus {
  available: boolean;
  status: 'untrained' | 'candidate' | 'disabled' | 'validated' | 'invalid';
  modelName: string;
  modelVersion: string;
  reason: string;
}

export interface BleFloodPrediction {
  available: boolean;
  label: 'BENIGN' | 'BLE_FLOOD' | 'UNAVAILABLE';
  voteScore: number | null;
  modelName: string;
  modelVersion: string;
  reason: string;
}

const REQUIRED_FEATURES = [
  'observation_count',
  'observations_per_second',
  'unique_addresses',
  'unique_address_fraction',
  'max_address_fraction',
  'rssi_mean',
  'rssi_std',
  'rssi_observation_fraction',
] as const;

function loadArtifact(): BleFloodArtifact | null {
  try {
    return JSON.parse(modelSource) as BleFloodArtifact;
  } catch {
    return null;
  }
}

const artifact = loadArtifact();

function isReviewApproved(model: BleFloodArtifact | null): boolean {
  const review = model?.validationReview;
  return Boolean(
    model
    && model.status === 'validated'
    && model.deploymentStatus === 'enabled_after_review'
    && model.evaluationSummary?.preliminaryGatesPassed === true
    && typeof review?.reviewedAt === 'string'
    && review.reviewedAt.trim()
    && typeof review.reviewedBy === 'string'
    && review.reviewedBy.trim()
    && review.hardwareSmokeTest === true,
  );
}

export function getBleFloodModelStatus(): BleFloodModelStatus {
  if (!artifact) {
    return {
      available: false,
      status: 'invalid',
      modelName: 'BlueGuardian BLE Flood Random Forest',
      modelVersion: 'unknown',
      reason: 'The generated model file is not valid JSON.',
    };
  }

  const modelName = artifact.modelName ?? 'BlueGuardian BLE Flood Random Forest';
  const modelVersion = artifact.modelVersion ?? 'unknown';

  if (!artifact.trees?.length || !artifact.featureNames?.length) {
    return {
      available: false,
      status: 'untrained',
      modelName,
      modelVersion,
      reason: 'No trained tree ensemble is installed.',
    };
  }
  if (
    artifact.featureNames.length !== REQUIRED_FEATURES.length
    || artifact.featureNames.some((name, index) => name !== REQUIRED_FEATURES[index])
  ) {
    return {
      available: false,
      status: 'invalid',
      modelName,
      modelVersion,
      reason: 'The model feature schema does not match the Android scan-window schema.',
    };
  }
  if (artifact.status === 'candidate' || artifact.deploymentStatus === 'disabled_until_explicit_review') {
    return {
      available: false,
      status: 'candidate',
      modelName,
      modelVersion,
      reason: 'A candidate model must pass review and Android collection-parity checks before activation.',
    };
  }
  if (!isReviewApproved(artifact)) {
    return {
      available: false,
      status: 'disabled',
      modelName,
      modelVersion,
      reason: 'The model lacks the required evaluation gates or recorded deployment review.',
    };
  }

  return {
    available: true,
    status: 'validated',
    modelName,
    modelVersion,
    reason: 'Model is enabled after documented evaluation and Android smoke-test review.',
  };
}

function featuresToVector(features: BleObservationWindowFeatures): number[] {
  const rawValues: Record<string, number> = {
    observation_count: features.observationCount,
    observations_per_second: features.observationsPerSecond,
    unique_addresses: features.uniqueAddresses,
    unique_address_fraction: features.uniqueAddressFraction,
    max_address_fraction: features.maxAddressFraction,
    rssi_mean: features.rssiMean,
    rssi_std: features.rssiStd,
    rssi_observation_fraction: features.rssiObservationFraction,
  };

  return REQUIRED_FEATURES.map(name => {
    const value = rawValues[name];
    if (Number.isFinite(value)) return value;
    const fallback = artifact?.imputationValues?.[name];
    return typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : 0;
  });
}

function scoreTree(tree: ExportedTree, features: number[]): number | null {
  if (!Array.isArray(tree.nodes) || tree.nodes.length === 0) return null;
  let index = 0;
  let steps = 0;
  while (steps <= tree.nodes.length) {
    const node = tree.nodes[index];
    if (!node) return null;
    if (node.feature < 0 || (node.left < 0 && node.right < 0)) {
      return Number.isFinite(node.bleFloodProbability)
        ? Math.max(0, Math.min(1, node.bleFloodProbability))
        : null;
    }
    const featureValue = features[node.feature];
    if (featureValue === undefined || !Number.isFinite(featureValue)) return null;
    index = featureValue <= node.threshold ? node.left : node.right;
    steps++;
  }
  return null;
}

/**
 * Scores a single temporal window. The average tree vote is a raw ensemble score,
 * not a calibrated attack probability. Candidate/untrained artifacts are never run.
 */
export function predictBleFloodWindow(features: BleObservationWindowFeatures): BleFloodPrediction {
  const status = getBleFloodModelStatus();
  const unavailable = (reason: string): BleFloodPrediction => ({
    available: false,
    label: 'UNAVAILABLE',
    voteScore: null,
    modelName: status.modelName,
    modelVersion: status.modelVersion,
    reason,
  });

  if (!status.available || !artifact) return unavailable(status.reason);
  if (
    !Number.isFinite(features.windowDurationMs)
    || features.windowDurationMs < 1000
    || !Number.isFinite(features.observationCount)
    || features.observationCount <= 0
  ) {
    return unavailable('A usable BLE observation window of at least one second is required.');
  }

  const vector = featuresToVector(features);
  const votes = (artifact.trees ?? []).map(tree => scoreTree(tree, vector)).filter(
    (score): score is number => score !== null && Number.isFinite(score),
  );
  if (votes.length !== artifact.trees?.length || votes.length === 0) {
    return unavailable('The tree ensemble is incomplete or contains invalid nodes.');
  }
  const voteScore = votes.reduce((sum, score) => sum + score, 0) / votes.length;
  const threshold = typeof artifact.decisionThreshold === 'number'
    && Number.isFinite(artifact.decisionThreshold)
    ? artifact.decisionThreshold
    : 0.5;

  return {
    available: true,
    label: voteScore >= threshold ? 'BLE_FLOOD' : 'BENIGN',
    voteScore,
    modelName: status.modelName,
    modelVersion: status.modelVersion,
    reason: voteScore >= threshold
      ? 'A reviewed BLE-flood model crossed its configured ensemble-vote threshold.'
      : 'A reviewed BLE-flood model did not cross its configured ensemble-vote threshold.',
  };
}
