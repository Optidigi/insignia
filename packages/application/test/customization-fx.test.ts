import { describe, expect, it } from 'vitest';
import {
  type CustomizationFxSnapshot,
  CustomizationFxUnavailable,
  requireUsableCustomizationFx,
} from '../src/pricing/customization-fx.js';

const rate: CustomizationFxSnapshot = {
  version: 'm4-customization-fx-v1',
  shopId: 'shop-1',
  installationGeneration: '7',
  shopCurrency: 'EUR',
  presentmentCurrency: 'USD',
  rateDecimal: '1.1234567890123456789',
  source: 'synthetic-provider',
  sourceVersion: 'fixture-1',
  provenance: 'synthetic-rate-42',
  observedAt: '2026-09-29T12:00:00.000Z',
  effectiveAt: '2026-09-29T11:00:00.000Z',
  expiresAt: '2026-09-29T13:00:00.000Z',
};
const request = {
  shopId: 'shop-1',
  installationGeneration: '7',
  shopCurrency: 'EUR',
  presentmentCurrency: 'USD',
  now: '2026-09-29T12:30:00.000Z',
  maxAgeMs: 2 * 60 * 60 * 1000,
};

describe('customization FX authority', () => {
  it('preserves an exact provider decimal and frozen provenance', () => {
    expect(requireUsableCustomizationFx(rate, request)).toEqual(rate);
  });
  it('fails closed on missing, stale, and wrong-installation evidence', () => {
    expect(() => requireUsableCustomizationFx(null, request)).toThrow(new CustomizationFxUnavailable('missing'));
    expect(() => requireUsableCustomizationFx(rate, { ...request, now: rate.expiresAt })).toThrow(
      new CustomizationFxUnavailable('stale'),
    );
    expect(() => requireUsableCustomizationFx(rate, { ...request, maxAgeMs: 30 * 60 * 1000 })).toThrow(
      new CustomizationFxUnavailable('stale'),
    );
    expect(() => requireUsableCustomizationFx(rate, { ...request, installationGeneration: '8' })).toThrow(
      new CustomizationFxUnavailable('wrong_identity'),
    );
  });
  it('rejects zero, exponent notation and malformed timestamps', () => {
    for (const rateDecimal of ['0.000', '1e3', '-1.2'])
      expect(() => requireUsableCustomizationFx({ ...rate, rateDecimal }, request)).toThrow(
        new CustomizationFxUnavailable('invalid'),
      );
    expect(() => requireUsableCustomizationFx({ ...rate, observedAt: '2026-02-30T12:00:00.000Z' }, request)).toThrow(
      new CustomizationFxUnavailable('invalid'),
    );
  });
});
