import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  decodeAndVerifyToken, decodePayload, encodePayload, issueToken,
  privateKeyFromSeed, publicKeyFromHex, type Claims,
} from './authorization.ts';

interface Vector { name: string; claims: Claims; payloadHex: string; signatureHex: string; token: string; expectedAccept: true }
interface InvalidVector { name: string; token: string; publicKeyHex?: string; expectedAccept: false; reason: string }
interface Corpus { testSeedHex: string; publicKeyHex: string; valid: Vector[]; invalid: InvalidVector[] }
const fixture = JSON.parse(readFileSync(new URL('../fixtures/vectors.json', import.meta.url), 'utf8')) as Corpus;
const keys = new Map([[7, publicKeyFromHex(fixture.publicKeyHex)]]);

describe('independent immutable Python/cryptography golden corpus', () => {
  for (const vector of fixture.valid) {
    it(`matches all independent bytes for ${vector.name}`, () => {
      expect(encodePayload(vector.claims).toString('hex')).toBe(vector.payloadHex);
      const issued = issueToken(vector.claims, privateKeyFromSeed(fixture.testSeedHex), 20800);
      expect(issued).toBe(vector.token);
      expect(Buffer.from(issued, 'base64url').subarray(114).toString('hex')).toBe(vector.signatureHex);
      expect(decodeAndVerifyToken(vector.token, keys)).toEqual(vector.claims);
    });
  }
  for (const vector of fixture.invalid) {
    it(`rejects ${vector.name}`, () => {
      const caseKeys = vector.publicKeyHex === undefined
        ? keys : new Map([[7, publicKeyFromHex(vector.publicKeyHex)]]);
      if (vector.name.startsWith('highbit_magic_mask_')) {
        const raw = Buffer.from(vector.token, 'base64url');
        expect(() => decodePayload(raw.subarray(0, 114))).toThrow('bad payload length/magic');
        expect(() => decodeAndVerifyToken(vector.token, caseKeys)).toThrow('bad payload length/magic');
      } else if (vector.name === 'weak_identity_key_r_identity_s_zero') {
        expect(() => decodeAndVerifyToken(vector.token, caseKeys)).toThrow('invalid signature');
      } else {
        expect(() => decodeAndVerifyToken(vector.token, caseKeys)).toThrow();
      }
    });
  }
});
