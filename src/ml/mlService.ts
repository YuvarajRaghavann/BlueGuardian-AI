import type { BluetoothDevice, MLPrediction, MLModelStatus } from '../types/index.js';
import { extractDeviceFeatures } from './featureExtractor.js';
import { getModel, listModels } from './modelRegistry.js';

let currentModelKey = 'development';
let modelStatus: MLModelStatus = 'READY';
let modelError: string | null = null;

/**
 * Initialize the ML model (async for future real models).
 */
export async function initializeModel(key = 'development'): Promise<void> {
  modelStatus = 'LOADING';
  modelError = null;
  try {
    const model = getModel(key);
    if (!model) throw new Error(`Model '${key}' not registered`);
    // For development model, synchronous; future models may load weights here.
    currentModelKey = key;
    modelStatus = 'READY';
  } catch (e: any) {
    modelStatus = 'ERROR';
    modelError = e?.message ?? 'Unknown error';
    throw e;
  }
}

/**
 * Get current model status.
 */
export function getModelStatus(): { status: MLModelStatus; error?: string; currentModel: string } {
  return {
    status: modelStatus,
    error: modelError ?? undefined,
    currentModel: currentModelKey,
  };
}

/**
 * Classify a single device.
 */
export function classifyDevice(device: BluetoothDevice): MLPrediction {
  if (modelStatus !== 'READY') {
    // Return a placeholder prediction indicating unavailable
    return {
      label: 'BENIGN',
      confidence: 0,
      modelName: 'unavailable',
      modelVersion: '0.0.0',
      predictedAt: new Date(),
      featuresUsed: [],
      explanation: 'ML model not ready',
    };
  }
  const model = getModel(currentModelKey);
  if (!model) {
    return {
      label: 'BENIGN',
      confidence: 0,
      modelName: 'missing',
      modelVersion: '0.0.0',
      predictedAt: new Date(),
      featuresUsed: [],
      explanation: 'Model not found',
    };
  }
  const { values } = extractDeviceFeatures(device);
  return model.predict(values);
}

/**
 * Classify multiple devices.
 */
export function classifyDevices(devices: BluetoothDevice[]): MLPrediction[] {
  return devices.map(classifyDevice);
}

/**
 * List available models.
 */
export function availableModels(): string[] {
  return listModels();
}

/** Return the concrete model metadata rather than a UI hard-coded label/version. */
export function getCurrentModelMetadata(): { key: string; name: string; version: string } {
  const model = getModel(currentModelKey);
  return {
    key: currentModelKey,
    name: model?.name ?? 'Unavailable',
    version: model?.version ?? 'unknown',
  };
}