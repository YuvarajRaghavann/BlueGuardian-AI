import mongoose, { Document, Schema } from 'mongoose';

export interface IDevice extends Document {
  deviceId: string;
  deviceIdentifier: string;
  name?: string;
  type?: string;
  discoverySource: 'REAL' | 'SIMULATED';
  address?: string;
  rssi?: number;
  connectionStatus?: string;
  gattConnected?: boolean;
  services?: Array<{ uuid: string; name?: string }>;
  characteristics?: Array<{ uuid: string; name?: string; properties?: string[] }>;
  batteryLevel?: number;
  manufacturer?: string;
  trustScore?: number;
  riskLevel?: string;
  isKnown?: boolean;
  trusted?: boolean;
  blocked?: boolean;
  connectionHealth?: string;
  ownerId?: string;
  recoveryState?: 'lost' | 'searching' | 'found' | 'recovered';
  registeredAt?: Date;
  firstSeen: Date;
  lastSeen: Date;
}

const DeviceSchema = new Schema<IDevice>({
  deviceId: { type: String, required: true, unique: true },
  deviceIdentifier: { type: String, required: true, index: true },
  name: String,
  type: String,
  discoverySource: { type: String, enum: ['REAL', 'SIMULATED'], required: true },
  address: String,
  rssi: Number,
  connectionStatus: String,
  gattConnected: Boolean,
  services: [{ uuid: String, name: String }],
  characteristics: [{ uuid: String, name: String, properties: [String] }],
  batteryLevel: Number,
  manufacturer: String,
  trustScore: Number,
  riskLevel: String,
  isKnown: Boolean,
  trusted: Boolean,
  blocked: Boolean,
  connectionHealth: String,
  ownerId: { type: String, index: true },
  recoveryState: { type: String, enum: ['lost', 'searching', 'found', 'recovered'], default: 'lost' },
  registeredAt: { type: Date, default: Date.now },
  firstSeen: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },
});

DeviceSchema.index({ ownerId: 1, deviceIdentifier: 1 }, { unique: true });

export default mongoose.model<IDevice>('Device', DeviceSchema);