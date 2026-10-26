import { describe, expect, it } from 'vitest';
import { normalizeBluetoothName, resolveBluetoothDisplayName } from './bluetoothService';

describe('Bluetooth device display names', () => {
  it('keeps a usable advertised name', () => {
    expect(resolveBluetoothDisplayName('OnePlus Nord Buds 4', undefined, 'OnePlus')).toBe('OnePlus Nord Buds 4');
  });

  it('falls back to the readable GATT Device Name when the advertised name is blank or a native placeholder', () => {
    expect(resolveBluetoothDisplayName('Unknown or Unsupported Device (08:A8:7F:B7:5A:1E)', 'Nord Buds 4', 'OnePlus')).toBe('Nord Buds 4');
    expect(resolveBluetoothDisplayName('', 'Living Room Speaker', undefined)).toBe('Living Room Speaker');
  });

  it('uses manufacturer as a transparent fallback and never displays a raw address as the name', () => {
    expect(resolveBluetoothDisplayName(undefined, undefined, 'Sony')).toBe('Sony Bluetooth device');
    expect(resolveBluetoothDisplayName('08:A8:7F:B7:5A:1E', undefined, undefined)).toBe('Bluetooth device (name unavailable)');
  });

  it('rejects placeholder names from legacy records', () => {
    expect(normalizeBluetoothName('Unknown Bluetooth Device')).toBeUndefined();
    expect(normalizeBluetoothName('Name not found')).toBeUndefined();
    expect(normalizeBluetoothName('Bluetooth device (name unavailable)')).toBeUndefined();
    expect(normalizeBluetoothName('  Desktop-Office  ')).toBe('Desktop-Office');
  });
});
