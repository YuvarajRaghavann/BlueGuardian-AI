import type { ThreatClassificationModel } from './model.js';
import { DevelopmentModel } from './developmentModel.js';

type ModelConstructor = new () => ThreatClassificationModel;

const registry = new Map<string, ModelConstructor>();

/**
 * Register a model constructor under a key.
 */
export function registerModel(key: string, ctor: ModelConstructor): void {
  registry.set(key, ctor);
}

/**
 * Get a model instance by key.
 */
export function getModel(key: string): ThreatClassificationModel | undefined {
  const ctor = registry.get(key);
  if (!ctor) return undefined;
  return new ctor();
}

/**
 * List registered model keys.
 */
export function listModels(): string[] {
  return Array.from(registry.keys());
}

// Register default development model
registerModel('development', DevelopmentModel);