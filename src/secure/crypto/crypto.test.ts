/// <reference types="node" />
import { createCipheriv, createHash, createHmac, hkdfSync, randomBytes as nodeRandom } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fromBase64, fromHex, toBase64, toHex, utf8 } from './bytes';
import { aeadDecrypt, aeadEncrypt, poly1305 } from './chacha20poly1305';
import { hkdfSha256, hmacSha256, sha256, Sha256 } from './sha256';
import { x25519, x25519PublicKey } from './x25519';

describe('X25519 (RFC 7748)', () => {
  it('matches the section 5.2 scalar multiplication vector', () => {
    const out = x25519(
      fromHex('a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4'),
      fromHex('e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c'),
    );
    expect(toHex(out)).toBe('c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552');
  });

  it('matches the section 6.1 Diffie-Hellman vector', () => {
    const alice = fromHex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
    const bob = fromHex('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
    expect(toHex(x25519PublicKey(alice))).toBe('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a');
    expect(toHex(x25519PublicKey(bob))).toBe('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f');
    const shared = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742';
    expect(toHex(x25519(alice, x25519PublicKey(bob)))).toBe(shared);
    expect(toHex(x25519(bob, x25519PublicKey(alice)))).toBe(shared);
  });

  it('rejects a low-order (all-zero) peer key', () => {
    expect(() => x25519(new Uint8Array(32).fill(7), new Uint8Array(32))).toThrow('all-zero');
  });
});

describe('ChaCha20-Poly1305 (RFC 8439)', () => {
  it('matches the section 2.5.2 Poly1305 vector', () => {
    const tag = poly1305(
      fromHex('85d6be7857556d337f4452fe42d506a80103808afb0db2fd4abff6af4149f51b'),
      utf8('Cryptographic Forum Research Group'),
    );
    expect(toHex(tag)).toBe('a8061dc1305136c6c22b8baf0c0127a9');
  });

  it('matches the section 2.8.2 AEAD vector and Node.js', () => {
    const key = fromHex('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f');
    const nonce = fromHex('070000004041424344454647');
    const aad = fromHex('50515253c0c1c2c3c4c5c6c7');
    const plaintext = utf8("Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.");
    const sealed = aeadEncrypt(key, nonce, plaintext, aad);
    expect(toHex(sealed.subarray(sealed.length - 16))).toBe('1ae10b594f09e26a7e902ecbd0600691');
    expect(toHex(sealed.subarray(0, 16))).toBe('d31a8d34648e60db7b86afbc53ef7ec2');

    const cipher = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
    cipher.setAAD(aad, { plaintextLength: plaintext.length });
    const nodeCt = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    expect(toHex(sealed)).toBe(nodeCt.toString('hex'));
    expect(toHex(aeadDecrypt(key, nonce, sealed, aad))).toBe(toHex(plaintext));
  });

  it('agrees with Node.js on random sizes and rejects any flipped bit', () => {
    for (const size of [0, 1, 15, 16, 17, 63, 64, 65, 1000, 16384]) {
      const key = new Uint8Array(nodeRandom(32));
      const nonce = new Uint8Array(nodeRandom(12));
      const data = new Uint8Array(nodeRandom(size));
      const cipher = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
      const nodeCt = Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
      const sealed = aeadEncrypt(key, nonce, data);
      expect(toHex(sealed)).toBe(nodeCt.toString('hex'));
      const tampered = sealed.slice();
      tampered[Math.floor(tampered.length / 2)] ^= 1;
      expect(() => aeadDecrypt(key, nonce, tampered)).toThrow('authentication');
    }
  });
});

describe('SHA-256, HMAC, HKDF', () => {
  it('matches Node.js for one-shot and incremental hashing', () => {
    for (const size of [0, 3, 55, 56, 63, 64, 65, 119, 120, 1000, 100000]) {
      const data = new Uint8Array(nodeRandom(size));
      const expected = createHash('sha256').update(data).digest('hex');
      expect(toHex(sha256(data))).toBe(expected);
      const inc = new Sha256();
      for (let i = 0; i < data.length; i += 37) inc.update(data.subarray(i, i + 37));
      expect(toHex(inc.digest())).toBe(expected);
    }
  });

  it('matches Node.js HMAC and HKDF', () => {
    const key = new Uint8Array(nodeRandom(80));
    const msg = new Uint8Array(nodeRandom(300));
    expect(toHex(hmacSha256(key, msg))).toBe(createHmac('sha256', key).update(msg).digest('hex'));
    const ikm = new Uint8Array(nodeRandom(32));
    const salt = new Uint8Array(nodeRandom(16));
    const info = utf8('blueguardian');
    const expected = Buffer.from(hkdfSync('sha256', ikm, salt, info, 42)).toString('hex');
    expect(toHex(hkdfSha256(ikm, salt, info, 42))).toBe(expected);
  });

  it('round-trips base64 for all tail lengths', () => {
    for (const size of [0, 1, 2, 3, 4, 5, 100]) {
      const data = new Uint8Array(nodeRandom(size));
      const encoded = toBase64(data);
      expect(encoded).toBe(Buffer.from(data).toString('base64'));
      expect(toHex(fromBase64(encoded))).toBe(toHex(data));
    }
  });
});
