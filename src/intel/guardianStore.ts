/** Builds the Guardian check for a device from its scan data, history and any deep inspection. */
import { useEffect, useState } from 'react';
import type { BluetoothDevice } from '../types';
import { assessDevice, type GattInspection, type GuardianResult } from './guardian';
import { intel } from './store';
import { sd } from './engine';
import { myDevices } from '../services/myDevices';

const KEY = 'blueguardian.inspections.v1';
let inspections: Record<string, GattInspection> = (() => {
  try { return JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') as Record<string, GattInspection>; } catch { return {}; }
})();
const listeners = new Set<() => void>();

function saveInspections() {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(inspections)); } catch { /* storage full */ }
  for (const l of listeners) l();
}

export function inspectionFor(address?: string): GattInspection | undefined {
  return address ? inspections[address.toUpperCase()] : undefined;
}

/** Connects without pairing, reads Device Information and probes data protection, then disconnects. */
export async function runDeepInspection(address: string): Promise<GattInspection> {
  const r = await myDevices.inspectGatt({ address });
  const result: GattInspection = { ...r, services: r.services ?? [], info: r.info ?? {}, at: Date.now() };
  inspections = { ...inspections, [address.toUpperCase()]: result };
  saveInspections();
  return result;
}

export function guardianFor(device: BluetoothDevice): GuardianResult {
  const address = device.address?.toUpperCase();
  const profile = address ? intel.profile(address) : undefined;
  const findings = intel.findingsFor(address);
  const spamActive = intel.activeFindings().some((f) => f.kind === 'popup_spam');
  return assessDevice({
    name: device.name,
    address,
    paired: device.paired,
    trusted: device.trusted,
    blockedByUser: Boolean(device.blocked && device.blockedByUser),
    mine: Boolean(address && intel.snapshot.mine.includes(address)),
    manufacturerData: device.manufacturerData,
    serviceUuids: device.services.map((s) => s.uuid),
    rawAdvert: device.rawAdvert,
    addressType: device.addressType,
    deviceClass: device.deviceClass,
    majorClass: device.majorClass,
    connectable: device.connectable,
    tracker: device.tracker ?? profile?.tracker,
    separated: device.separated ?? profile?.separated,
    popupAdvertiser: device.popupAdvertiser,
    findings,
    spamActive,
    opinion: intel.trustOf(address),
    scans: profile?.scans,
    inspection: inspectionFor(address),
    rssi: device.rssi,
    txPower: device.txPower,
    rssiSd: profile?.rssi ? sd(profile.rssi) : undefined,
    rssiSamples: profile?.rssi?.n,
  });
}

/** Re-renders when scans, history or inspections change. */
export function useGuardianVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV((x) => x + 1);
    listeners.add(bump);
    const off = intel.subscribe(bump);
    return () => { listeners.delete(bump); off(); };
  }, []);
  return v;
}
