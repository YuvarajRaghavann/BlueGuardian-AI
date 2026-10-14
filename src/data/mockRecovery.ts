import type { RecoveryInfo } from '../types';

export const mockRecovery: RecoveryInfo = {
  deviceId: '1',
  deviceName: 'My CMF Buds',
  lastKnownLocation: {
    lat: 37.7749,
    lng: -122.4194,
    address: 'San Francisco, CA, USA',
  },
  lastDetected: new Date(Date.now() - 3 * 60 * 60 * 1000),
  status: 'searching',
  communityReports: 2,
  simulated: true,
};