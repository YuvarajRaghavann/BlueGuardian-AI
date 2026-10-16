import {
  predictBleFloodWindow,
  type BleObservationWindowFeatures,
} from './bleFloodInference';

export interface BleFloodAlertDetail {
  windowEndMs: number;
  voteScore: number;
  modelName: string;
  modelVersion: string;
  observationCount: number;
  observationsPerSecond: number;
  uniqueAddresses: number;
}

const history: Array<{ at: number; positive: boolean; score: number }> = [];
let lastAlertAt = 0;
const WINDOW_HISTORY_SIZE = 3;
const MIN_POSITIVE_WINDOWS = 2;
const ALERT_COOLDOWN_MS = 60_000;

/**
 * Feed actual native scan-window aggregates into the separately trained detector.
 * No device address is persisted or included in the emitted alert.
 */
export function processBleObservationWindow(features: BleObservationWindowFeatures): void {
  if (features.telemetrySource !== 'ANDROID_SCAN_CALLBACKS') return;
  const prediction = predictBleFloodWindow(features);
  if (!prediction.available || prediction.voteScore === null) {
    history.length = 0;
    return;
  }

  const now = features.windowEndMs || Date.now();
  history.push({
    at: now,
    positive: prediction.label === 'BLE_FLOOD',
    score: prediction.voteScore,
  });
  while (history.length > WINDOW_HISTORY_SIZE) history.shift();

  const currentPositiveCount = history.filter(item => item.positive).length;
  if (currentPositiveCount < MIN_POSITIVE_WINDOWS || now - lastAlertAt < ALERT_COOLDOWN_MS) return;
  if (typeof window === 'undefined') return;

  lastAlertAt = now;
  const detail: BleFloodAlertDetail = {
    windowEndMs: now,
    voteScore: prediction.voteScore,
    modelName: prediction.modelName,
    modelVersion: prediction.modelVersion,
    observationCount: features.observationCount,
    observationsPerSecond: features.observationsPerSecond,
    uniqueAddresses: features.uniqueAddresses,
  };
  window.dispatchEvent(new CustomEvent<BleFloodAlertDetail>('blueguardian:ble-flood-alert', { detail }));
}

export function resetBleFloodWindowHistoryForTests(): void {
  history.length = 0;
  lastAlertAt = 0;
}
