import { describe, expect, it } from 'vitest';
import { MerchantPreferencesCommandSchema, MerchantPreferencesViewSchema } from './merchant-preferences.js';

describe('merchant preferences wire boundary', () => {
  it('accepts distinct section CAS versions without a browser-selected tenant', () => {
    expect(
      MerchantPreferencesCommandSchema.parse({
        action: 'guidance',
        authority: 'a'.repeat(64),
        expectedVersion: '0',
        guidance: { dismissed: false, completedSteps: ['product', 'test'] },
      }).action,
    ).toBe('guidance');
    expect(
      MerchantPreferencesCommandSchema.safeParse({
        action: 'guidance',
        authority: 'a'.repeat(64),
        expectedVersion: '0',
        shop: 'other.myshopify.com',
        guidance: { dismissed: false, completedSteps: [] },
      }).success,
    ).toBe(false);
  });
  it('rejects duplicate guidance, malformed locale/form and oversized wording', () => {
    expect(
      MerchantPreferencesCommandSchema.safeParse({
        action: 'guidance',
        authority: 'a'.repeat(64),
        expectedVersion: '1',
        guidance: { dismissed: false, completedSteps: ['test', 'test'] },
      }).success,
    ).toBe(false);
    for (const messages of [
      { 'customer:steps.done': { html: 'No' } },
      { 'admin:title': { message: 'No' } },
      { 'customer:steps.done': { message: 'a'.repeat(4001) } },
    ])
      expect(
        MerchantPreferencesCommandSchema.safeParse({
          action: 'wording',
          authority: 'a'.repeat(64),
          expectedVersion: '0',
          overlays: { en: { locale: 'en', messages } },
        }).success,
      ).toBe(false);
  });
  it('validates the authoritative response and section versions', () => {
    const value = {
      version: 'merchant-preferences-v1',
      authority: 'a'.repeat(64),
      shop: 'example.myshopify.com',
      guidanceVersion: '0',
      wordingVersion: '4',
      guidance: { dismissed: false, completedSteps: [] },
      overlays: { en: { locale: 'en', messages: {} } },
    };
    expect(MerchantPreferencesViewSchema.parse(value)).toEqual(value);
    expect(MerchantPreferencesViewSchema.parse({ ...value, canReadPrivacy: true }).canReadPrivacy).toBe(true);
    expect(MerchantPreferencesViewSchema.safeParse({ ...value, canReadPrivacy: 'true' }).success).toBe(false);
    expect(MerchantPreferencesViewSchema.safeParse({ ...value, wordingVersion: '-1' }).success).toBe(false);
  });
});
