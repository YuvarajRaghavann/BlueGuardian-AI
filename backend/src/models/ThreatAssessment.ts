import mongoose, { Document, Schema } from 'mongoose';

export type ThreatStatus = 'active' | 'investigating' | 'resolved' | 'dismissed';

export interface IThreatAssessment extends Document {
  deviceId: string;
  ownerId?: string;
  trustScore: number;
  trustRiskLevel: string;
  ruleBasedThreatScore: number;
  mlRiskScore: number;
  finalThreatScore: number;
  severity: string;
  primaryCategory: string;
  reasons: Array<{ code: string; message: string }>;
  mlClassification?: string;
  mlConfidence?: number;
  modelName?: string;
  modelVersion?: string;
  modelValidationStatus?: string;
  /** Existing assessment data remains readable; new assessments default to active. */
  status?: ThreatStatus;
  timestamp: Date;
}

const ThreatAssessmentSchema = new Schema<IThreatAssessment>({
  deviceId: { type: String, required: true, index: true },
  ownerId: { type: String, index: true },
  trustScore: Number,
  trustRiskLevel: String,
  ruleBasedThreatScore: Number,
  mlRiskScore: Number,
  finalThreatScore: Number,
  severity: String,
  primaryCategory: String,
  reasons: [{ code: String, message: String }],
  mlClassification: String,
  mlConfidence: Number,
  modelName: String,
  modelVersion: String,
  modelValidationStatus: { type: String, default: 'development-not-validated' },
  status: { type: String, enum: ['active', 'investigating', 'resolved', 'dismissed'], default: 'active' },
  timestamp: { type: Date, default: Date.now },
});

ThreatAssessmentSchema.index({ ownerId: 1, deviceId: 1, timestamp: -1 });

export default mongoose.model<IThreatAssessment>('ThreatAssessment', ThreatAssessmentSchema);
