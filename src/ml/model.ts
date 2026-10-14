import type { MLPrediction } from '../types/index.js';

export interface ThreatClassificationModel {
  name: string;
  version: string;
  predict(features: number[]): MLPrediction;
}