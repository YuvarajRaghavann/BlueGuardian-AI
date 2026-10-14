import type { SecurityEvent } from '../types';

export const mockEvents: SecurityEvent[] = [
  {
    id: 'e1',
    type: 'scan',
    message: 'Bluetooth scan completed – 4 devices found',
    severity: 'info',
    timestamp: new Date(Date.now() - 1 * 60 * 1000),
    simulated: true,
  },
  {
    id: 'e2',
    type: 'connect',
    message: 'Connected to My CMF Buds',
    deviceId: '1',
    severity: 'info',
    timestamp: new Date(Date.now() - 5 * 60 * 1000),
    simulated: true,
  },
  {
    id: 'e3',
    type: 'alert',
    message: 'High‑risk device detected: Unknown Bluetooth Device',
    deviceId: '3',
    severity: 'error',
    timestamp: new Date(Date.now() - 10 * 60 * 1000),
    simulated: true,
  },
  {
    id: 'e4',
    type: 'pair',
    message: 'Paired with Samsung Galaxy S24',
    deviceId: '2',
    severity: 'info',
    timestamp: new Date(Date.now() - 30 * 60 * 1000),
    simulated: true,
  },
  {
    id: 'e5',
    type: 'disconnect',
    message: 'Disconnected from Smart Watch',
    deviceId: '4',
    severity: 'warning',
    timestamp: new Date(Date.now() - 45 * 60 * 1000),
    simulated: true,
  },
];