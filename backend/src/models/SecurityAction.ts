import mongoose, { Document, Schema } from 'mongoose';

export type ActionType = 'TRUST' | 'MARK_UNKNOWN' | 'BLOCK' | 'UNBLOCK' | 'FORGET' | 'INVESTIGATE' | 'RESOLVE_THREAT' | 'DISMISS_THREAT' | 'IGNORE_DEVICE';

export interface ISecurityAction extends Document {
  deviceId: string;
  deviceName?: string;
  action: ActionType;
  previousState?: any;
  newState?: any;
  source: 'USER' | 'SYSTEM';
  timestamp: Date;
  simulated: boolean;
  reason?: string;
}

const SecurityActionSchema = new Schema<ISecurityAction>({
  deviceId: { type: String, required: true, index: true },
  deviceName: String,
  action: { type: String, enum: ['TRUST','MARK_UNKNOWN','BLOCK','UNBLOCK','FORGET','INVESTIGATE','RESOLVE_THREAT','DISMISS_THREAT','IGNORE_DEVICE'], required: true },
  previousState: Schema.Types.Mixed,
  newState: Schema.Types.Mixed,
  source: { type: String, enum: ['USER','SYSTEM'], default: 'USER' },
  timestamp: { type: Date, default: Date.now },
  simulated: Boolean,
  reason: String,
});

export default mongoose.model<ISecurityAction>('SecurityAction', SecurityActionSchema);