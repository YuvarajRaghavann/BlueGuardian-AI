export type DeviceType =
  | 'smartphone'
  | 'earbuds'
  | 'headphones'
  | 'smartwatch'
  | 'laptop'
  | 'iot'
  | 'unknown';

export type DiscoverySource = 'REAL' | 'SIMULATED';

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'unknown';

export type RiskLevel = 'trusted' | 'low' | 'medium' | 'high';

export type ScanState = 'idle' | 'scanning' | 'complete' | 'unsupported' | 'permission-denied' | 'error';

export interface BluetoothServiceInfo {
  uuid: string;
  name?: string;
}

export interface GattCharacteristicInfo {
  uuid: string;
  name?: string;
  properties: any; // BluetoothCharacteristicProperties
}

export interface GattServiceInfo {
  uuid: string;
  name?: string;
  characteristics: GattCharacteristicInfo[];
}

export type ConnectionHealth = 'GOOD' | 'DEGRADED' | 'UNSTABLE' | 'UNAVAILABLE';

export interface TrustAssessment {
  score: number; // 0-100
  riskLevel: RiskLevel;
  factors: {
    knownDevice: boolean;
    manufacturerReputation: number; // 0-100
    connectionHistory: number; // 0-100
    suspiciousBehavior: number; // 0-100
    signalConsistency: number; // 0-100
    deviceTypeTrust: number; // 0-100
  };
}

export interface BluetoothDevice {
  id: string;
  name: string;
  type: DeviceType;
  address?: string; // may be unavailable in Web Bluetooth
  rssi?: number; // signal strength dBm (unavailable in browser)
  trusted: boolean;
  blocked?: boolean;
  trustScore: number; // 0-100
  riskLevel: RiskLevel;
  connectionStatus: ConnectionStatus;
  firstSeen: Date;
  lastSeen: Date;
  isKnown: boolean;
  manufacturer?: string;
  services: GattServiceInfo[];
  discoverySource: DiscoverySource;
  /** Physical discovery transport; discovery never implies connection. */
  discoveryTransport?: 'BLE' | 'CLASSIC' | 'PAIRED' | 'COMBINED';
  /** Observed transports during a Phase 5 combined scan, deduplicated by Android-reported identity. */
  discoveryTransports?: Array<'BLE' | 'CLASSIC'>;
  /** True only when Android reports the device is bonded/paired. */
  paired?: boolean;
  gattConnected?: boolean;
  connectionHealth?: ConnectionHealth;
  approvalRequired?: boolean;
}

export interface ScanResult {
  devices: BluetoothDevice[];
  timestamp: Date;
  source: DiscoverySource;
}

export interface BluetoothScanState {
  state: ScanState;
  elapsedMs: number;
  devicesFound: number;
  /** Distinguishes genuine browser observations from generated demo records in UI status. */
  source?: DiscoverySource;
  /** Identifies the scanner implementation used for this scan. */
  transport?: 'WEB_BLE_SELECTION' | 'ANDROID_BLE_SCAN' | 'ANDROID_CLASSIC_SCAN' | 'ANDROID_PAIRED_DEVICES' | 'ANDROID_COMBINED_SCAN';
  /** Current half of the sequential combined Android discovery pass. */
  scanStage?: 'BLE' | 'CLASSIC';
  error?: string;
}

// ===== PHASE 3: Threat Model =====

export type ThreatSeverity = 'low' | 'medium' | 'high' | 'critical';

export type ThreatCategory =
  | 'UNKNOWN_DEVICE'
  | 'LOW_TRUST'
  | 'SUSPICIOUS_NAME'
  | 'WEAK_SECURITY'
  | 'RAPID_DEVICE_APPEARANCE'
  | 'UNUSUAL_SIGNAL'
  | 'REPEATED_CONNECTION'
  | 'UNSTABLE_CONNECTION'
  | 'BLOCKED_DEVICE'
  | 'SPOOFING_SUSPECTED'
  | 'OTHER';

export type ThreatStatus = 'ACTIVE' | 'INVESTIGATING' | 'RESOLVED' | 'DISMISSED';

export interface ThreatReason {
  code: string;
  message: string;
}

export interface ThreatAnalysis {
  deviceId: string;
  deviceName: string;
  threatScore: number; // 0-100
  severity: ThreatSeverity;
  category: ThreatCategory;
  reasons: ThreatReason[];
  recommendedAction: string;
  analyzedAt: Date;
  discoverySource: DiscoverySource;
}

export interface Threat {
  id: string;
  deviceId: string;
  deviceName: string;
  category: ThreatCategory;
  severity: ThreatSeverity;
  score: number; // 0-100
  title: string;
  description: string;
  reasons: ThreatReason[];
  recommendedAction: string;
  status: ThreatStatus;
  detectedAt: Date;
  updatedAt: Date;
  discoverySource: DiscoverySource;
  // legacy fields for backward compatibility
  resolved?: boolean;
}

export interface SecurityEvent {
  id: string;
  type: 'scan' | 'connect' | 'disconnect' | 'pair' | 'unpair' | 'alert';
  message: string;
  deviceId?: string;
  severity: 'info' | 'warning' | 'error';
  timestamp: Date;
  simulated?: boolean;
}

export interface RecoveryInfo {
  deviceId: string;
  deviceName: string;
  lastKnownLocation?: {
    lat: number;
    lng: number;
    address?: string;
  };
  lastDetected: Date;
  status: 'searching' | 'found' | 'lost' | 'recovered';
  communityReports: number;
  simulated?: boolean;
}

// ===== PHASE 4: AI/ML Types =====

export type MLThreatClass =
  | 'INSUFFICIENT_EVIDENCE'
  | 'BENIGN'
  | 'SUSPICIOUS'
  | 'POTENTIAL_SPOOFING'
  | 'POTENTIAL_UNAUTHORIZED_ACCESS'
  | 'ANOMALOUS_BEHAVIOR'
  | 'HIGH_RISK_DEVICE';

export type MLModelStatus = 'READY' | 'LOADING' | 'UNAVAILABLE' | 'ERROR' | 'DEMO';

export interface MLPrediction {
  label: MLThreatClass;
  confidence: number; // 0-1
  modelName: string;
  modelVersion: string;
  predictedAt: Date;
  featuresUsed: string[];
  explanation: string;
}

export interface MLModelInfo {
  name: string;
  version: string;
  status: MLModelStatus;
  classes: MLThreatClass[];
  featureCount: number;
}

export interface SecurityAssessment {
  trustScore: number;
  trustRiskLevel: RiskLevel;
  ruleBasedThreatScore: number;
  ruleBasedSeverity: ThreatSeverity;
  ruleBasedCategory: ThreatCategory;
  ruleBasedReasons: ThreatReason[];
  mlPrediction?: MLPrediction;
  finalThreatScore: number; // 0-100
  finalSeverity: ThreatSeverity;
  finalClassification: string; // e.g., "ANOMALOUS_BEHAVIOR"
  confidence: number; // 0-1
  reasons: ThreatReason[];
  recommendedAction: string;
}

// Extend Threat with optional ML info (backward compatible)
export interface Threat {
  id: string;
  deviceId: string;
  deviceName: string;
  category: ThreatCategory;
  severity: ThreatSeverity;
  score: number; // 0-100
  title: string;
  description: string;
  reasons: ThreatReason[];
  recommendedAction: string;
  status: ThreatStatus;
  detectedAt: Date;
  updatedAt: Date;
  discoverySource: DiscoverySource;
  // optional ML enrichment
  mlPrediction?: MLPrediction;
  finalClassification?: string;
  confidence?: number;
  modelName?: string;
  modelVersion?: string;
  // legacy fields for backward compatibility
  resolved?: boolean;
}

// ===== PHASE 5: Security Actions & Device Protection =====

export type SecurityActionType =
  | 'TRUST'
  | 'MARK_UNKNOWN'
  | 'BLOCK'
  | 'UNBLOCK'
  | 'FORGET'
  | 'INVESTIGATE'
  | 'RESOLVE_THREAT'
  | 'DISMISS_THREAT'
  | 'IGNORE_DEVICE';

export type DeviceProtectionStatus =
  | 'PROTECTED'
  | 'MONITORING'
  | 'AT_RISK'
  | 'BLOCKED'
  | 'UNKNOWN';

export interface SecurityAction {
  id: string;
  type: SecurityActionType;
  deviceId: string;
  deviceName: string;
  reason: string;
  source: 'USER' | 'SYSTEM';
  timestamp: Date;
  simulated: boolean;
  previousState?: Partial<BluetoothDevice>;
  newState?: Partial<BluetoothDevice>;
}

export interface SecurityPolicy {
  confirmBlock: boolean;
  confirmTrust: boolean;
  showLowConfidenceWarnings: boolean;
  showSimulatedEvents: boolean;
  requireConnectionApproval: boolean;
  blockUnknownFileTransfers: boolean;
  enforceFastPairApproval: boolean;
  enableRssiGuard: boolean;
  restrictWearablesToAudio: boolean;
}