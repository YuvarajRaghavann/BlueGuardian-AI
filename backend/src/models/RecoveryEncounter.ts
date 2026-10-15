import mongoose, { Document, Schema } from 'mongoose';

export interface IRecoveryEncounter extends Document {
  deviceId: string;
  ownerId?: string;
  source: 'REAL' | 'SIMULATED';
  confidence?: number;
  observedAt: Date;
  location?: {
    lat: number;
    lng: number;
    address?: string;
  };
  manufacturer?: string;
  description?: string;
  deduplicationKey?: string;
  simulated: boolean;
  isTestFixture: boolean;
  createdAt: Date;
}

const RecoveryEncounterSchema = new Schema<IRecoveryEncounter>({
  deviceId: { type: String, required: true, index: true },
  ownerId: { type: String, index: true },
  source: { type: String, enum: ['REAL', 'SIMULATED'], required: true },
  confidence: { type: Number, min: 0, max: 1 },
  observedAt: { type: Date, default: Date.now },
  location: {
    lat: Number,
    lng: Number,
    address: String,
  },
  manufacturer: String,
  description: String,
  deduplicationKey: String,
  simulated: { type: Boolean, default: false },
  isTestFixture: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

RecoveryEncounterSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
RecoveryEncounterSchema.index(
  { ownerId: 1, deviceId: 1, deduplicationKey: 1 },
  { unique: true, partialFilterExpression: { deduplicationKey: { $type: 'string' } } },
);
RecoveryEncounterSchema.index({ ownerId: 1, deviceId: 1, observedAt: -1 });

export default mongoose.model<IRecoveryEncounter>('RecoveryEncounter', RecoveryEncounterSchema);
