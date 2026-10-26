import mongoose, { Document, Schema } from 'mongoose';

export type ActionType = 'TRUST' | 'MARK_UNKNOWN' | 'BLOCK' | 'UNBLOCK' | 'FORGET' | 'INVESTIGATE' | 'RESOLVE_THREAT' | 'DISMISS_THREAT' | 'IGNORE_DEVICE';

export interface ISecurityAction extends Document {
  deviceId: string;
  ownerId?: string;
  deviceName?: string;
  action: ActionType;
  previousState?: any;
  newState?: any;
  source: 'USER' | 'SYSTEM';
  timestamp: Date;
  simulated: boolean;
  reason?: string;
  threatId?: string;
}

const SecurityActionSchema = new Schema<ISecurityAction>({
  deviceId: { type: String, required: true, index: true },
  ownerId: { type: String, index: true },
  deviceName: String,
  action: { type: String, enum: ['TRUST','MARK_UNKNOWN','BLOCK','UNBLOCK','FORGET','INVESTIGATE','RESOLVE_THREAT','DISMISS_THREAT','IGNORE_DEVICE'], required: true },
  previousState: Schema.Types.Mixed,
  newState: Schema.Types.Mixed,
  source: { type: String, enum: ['USER','SYSTEM'], default: 'USER' },
  timestamp: { type: Date, default: Date.now },
  simulated: Boolean,
  reason: String,
  threatId: String,
});

SecurityActionSchema.index({ ownerId: 1, timestamp: -1 });
SecurityActionSchema.index({ ownerId: 1, deviceId: 1, timestamp: -1 });

export default mongoose.model<ISecurityAction>('SecurityAction', SecurityActionSchema);
