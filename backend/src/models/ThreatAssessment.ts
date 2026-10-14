import mongoose, { Document, Schema } from 'mongoose';

export interface IThreatAssessment extends Document {
  deviceId: string;
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
  timestamp: Date;
}

const ThreatAssessmentSchema = new Schema<IThreatAssessment>({
  deviceId: { type: String, required: true, index: true },
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
  timestamp: { type: Date, default: Date.now },
});

export default mongoose.model<IThreatAssessment>('ThreatAssessment', ThreatAssessmentSchema);