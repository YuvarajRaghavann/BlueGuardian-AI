import mongoose, { Document, Schema } from 'mongoose';

export interface IAuditEvent extends Document {
  deviceId?: string;
  eventType: string;
  description: string;
  source: 'USER' | 'SYSTEM';
  simulated: boolean;
  metadata?: any;
  timestamp: Date;
}

const AuditEventSchema = new Schema<IAuditEvent>({
  deviceId: { type: String, index: true },
  eventType: { type: String, required: true },
  description: String,
  source: { type: String, enum: ['USER','SYSTEM'], default: 'SYSTEM' },
  simulated: Boolean,
  metadata: Schema.Types.Mixed,
  timestamp: { type: Date, default: Date.now },
});

export default mongoose.model<IAuditEvent>('AuditEvent', AuditEventSchema);