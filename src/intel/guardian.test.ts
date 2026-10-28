import { describe, expect, it } from 'vitest';
import { assessDevice, claimedBrand, companyName, nameDisguise, parseAdvert } from './guardian';
import { opinionFrom } from './engine';

// Real-format advertisement: flags, appearance (HID keyboard 0x03C1), 16-bit UUID 0x1812, Apple manufacturer data.
const ADV_KEYBOARD = '020106' + '0319c103' + '03031218';
const ADV_APPLE = '020106' + '07ff4c0012020000';

describe('advertisement parsing', () => {
  it('reads flags, appearance, services and company IDs from raw AD structures', () => {
    const p = parseAdvert(ADV_KEYBOARD + '05ff7500aabb' + '0000');
    expect(p.flags).toBe(6);
    expect(p.appearance).toBe(0x03c1);
    expect(p.services16).toEqual(['1812']);
    expect(p.companyIds).toEqual([0x0075]);
  });

  it('knows real Bluetooth SIG company names', () => {
    expect(companyName(76)).toBe('Apple, Inc.');
    expect(companyName(3281)).toBe('Imagine Marketing Limited');
    expect(claimedBrand('boAt Rockerz 255')?.name).toBe('boAt');
    expect(claimedBrand('TWS')).toBeUndefined();
  });
});

describe('Guardian verdict before connecting', () => {
  it('flags a fake AirPods that does not broadcast Apple\'s company ID', () => {
    const r = assessDevice({ name: 'AirPods Pro', rawAdvert: '020106' + '05ff99990102', connectable: true });
    expect(r.verdict).toBe('unsafe');
    expect(r.summary).toContain('Not a real Apple');
  });

  it('verifies a genuine Apple device from its company ID', () => {
    const r = assessDevice({ name: 'AirPods Pro', rawAdvert: ADV_APPLE, connectable: true });
    expect(r.verdict).toBe('safe');
    expect(r.identityVerified).toBe(true);
  });

  it('warns about an unknown keyboard and fails a keyboard pretending to be earbuds', () => {
    expect(assessDevice({ name: 'Keyboard K380', rawAdvert: ADV_KEYBOARD }).verdict).toBe('caution');
    const disguised = assessDevice({ name: 'TWS Earbuds', rawAdvert: ADV_KEYBOARD });
    expect(disguised.verdict).toBe('unsafe');
    expect(disguised.summary).toBe('Audio name, keyboard inside');
    expect(assessDevice({ name: 'Keyboard K380', rawAdvert: ADV_KEYBOARD, paired: true }).verdict).toBe('safe');
  });

  it('flags classic Bluetooth keyboards by Class of Device', () => {
    expect(assessDevice({ name: 'Speaker', majorClass: 0x0500, deviceClass: 0x0540 }).verdict).toBe('unsafe');
    expect(assessDevice({ name: 'SoundDrum 1', majorClass: 0x0400, deviceClass: 0x0414 }).verdict).toBe('clear');
  });

  it('catches hidden characters and look-alike letters in names', () => {
    expect(nameDisguise('Air​Pods')).toContain('hidden');
    expect(nameDisguise('AirPоds')).toContain('look-alike'); // Cyrillic о
    expect(assessDevice({ name: 'AirPоds' }).verdict).toBe('unsafe');
    expect(nameDisguise('boAt Rockerz')).toBeNull();
  });

  it('says "Looks safe" for an ordinary device with nothing to verify, and never invents risk', () => {
    const r = assessDevice({ name: 'SN6 24G', opinion: opinionFrom(0, 0) });
    expect(r.verdict).toBe('clear');
    expect(r.checks.some((c) => c.status === 'fail' || c.status === 'warn')).toBe(false);
  });

  it('uses deep inspection: device information can verify or contradict the name', () => {
    const insp = { connected: true, services: [], info: { manufacturer: 'Imagine Marketing Pvt Ltd' }, protectedReads: 1, openReads: 0, at: 0 };
    const ok = assessDevice({ name: 'boAt Airdopes 141', inspection: insp });
    expect(ok.verdict).toBe('safe');
    const bad = assessDevice({ name: 'boAt Airdopes 141', inspection: { ...insp, info: { manufacturer: 'Generic Corp' } } });
    expect(bad.verdict).toBe('caution');
  });

  it('a bad behaviour history makes the device unsafe even with a verified maker', () => {
    expect(assessDevice({ name: 'AirPods', rawAdvert: ADV_APPLE, opinion: opinionFrom(0, 6) }).verdict).toBe('unsafe');
  });
});

describe('BTGuard three-method fusion before connecting', () => {
  it('flags a signal stronger than the device transmits (relay or amplifier) as Caution, not Unsafe', () => {
    const r = assessDevice({ name: 'SoundDrum 1', majorClass: 0x0400, rssi: -20, txPower: -40 + 1 });
    expect(r.checks.find((c) => c.id === 'physical')?.status).toBe('warn');
    expect(r.verdict).toBe('caution');
    expect(r.btguard.methods.physical.risk).toBeGreaterThan(0.3);
    expect(r.btguard.corroborated).toBe(false);
  });

  it('accepts a signal consistent with the advertised transmit power', () => {
    const r = assessDevice({ name: 'SoundDrum 1', majorClass: 0x0400, rssi: -70, txPower: 0 });
    expect(r.checks.find((c) => c.id === 'physical')?.status).toBe('pass');
    expect(r.verdict).toBe('clear');
    expect(r.btguard.trust).toBeGreaterThan(80);
  });

  it('marks impersonation as hard evidence with a low fused trust score', () => {
    const r = assessDevice({ name: 'AirPods Pro', rawAdvert: '0201060aff0f00010203040506070809' });
    expect(r.verdict).toBe('unsafe');
    expect(r.btguard.hard).toBe(true);
    expect(r.btguard.trust).toBeLessThan(20);
  });
});
