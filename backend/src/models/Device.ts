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
  /** Set by the server from the authenticated principal, never accepted as authority from request JSON. */
  ownerId?: string;
  recoveryEnabled?: boolean;
  recoveryState?: 'lost' | 'searching' | 'found' | 'recovered';
  /** SHA-256 of canonical advertised name + service UUIDs; never stores raw MAC as a community lookup key. */
  recoveryFingerprintHash?: string;
  registeredAt?: Date;
  firstSeen: Date;
  lastSeen: Date;
}

const DeviceSchema = new Schema<IDevice>({
  // Kept globally unique for compatibility with the existing database's current unique index.
  // Changing this index requires a reviewed MongoDB migration, not an implicit schema-only edit.
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
  // Optional at schema level so legacy records can be migrated deliberately; API writes always set ownerId.
  ownerId: { type: String, index: true },
  // Optional to preserve legacy records; new normal-device API writes set false explicitly.
  recoveryEnabled: { type: Boolean },
  recoveryState: { type: String, enum: ['lost', 'searching', 'found', 'recovered'], default: 'lost' },
  recoveryFingerprintHash: { type: String, index: true, select: false },
  registeredAt: { type: Date, default: Date.now },
  firstSeen: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },
});

DeviceSchema.index({ ownerId: 1, deviceIdentifier: 1 }, { unique: true });
DeviceSchema.index({ ownerId: 1, lastSeen: -1 });

export default mongoose.model<IDevice>('Device', DeviceSchema);
