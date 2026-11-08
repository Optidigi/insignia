import { describe, expect, it } from 'vitest';
import { createAdminTranslator } from './admin.js';
import { SUPPORTED_LANGUAGES } from './core.js';
import {
  CUSTOMER_WORDING_MANIFEST,
  createCustomerLocaleController,
  createCustomerTranslator,
  customerWordingDefaultText,
  customerWordingSourceText,
  requiredCustomerWordingForms,
  validateCustomerWordingOverlay,
} from './customer.js';

function validOverlay(input: unknown) {
  const result = validateCustomerWordingOverlay(input);
  if (result.status !== 'valid') throw new Error(JSON.stringify(result.issues));
  return result.overlay;
}

describe('merchant-authored customer wording overlays', () => {
  it('keeps saved retired-host wording readable alongside active customer wording', () => {
    const overlay = validOverlay({
      locale: 'en',
      messages: {
        'customer:host.personalise': { message: 'Previously saved host wording' },
        'customer:steps.review': { message: 'Check my design' },
      },
    });
    expect(overlay.messages['customer:host.personalise']).toEqual({ message: 'Previously saved host wording' });
    expect(createCustomerTranslator('en', { wordingOverlay: overlay }).t('customer:steps.review')).toBe(
      'Check my design',
    );
  });

  it('restores built-in language defaults while keeping regional overrides exact and sparse', () => {
    const overlay = validOverlay({
      locale: 'nl-NL',
      messages: { 'customer:steps.addToCart': { message: 'Mijn eigen knop' } },
    });
    const custom = createCustomerTranslator('nl-NL', { wordingOverlay: overlay });
    const baseline = createCustomerTranslator('nl-NL');
    const otherRegion = createCustomerTranslator('nl-BE', { wordingOverlay: overlay });
    expect(custom.t('customer:steps.addToCart')).toBe('Mijn eigen knop');
    expect(custom.t('customer:steps.review')).toBe(baseline.t('customer:steps.review'));
    expect(otherRegion.wordingLocale).toBeNull();
    expect(otherRegion.t('customer:steps.addToCart')).toBe(baseline.t('customer:steps.addToCart'));
    const reset = createCustomerTranslator('nl-NL', {
      wordingOverlay: validOverlay({ locale: 'nl-NL', messages: {} }),
    });
    expect(reset.t('customer:steps.addToCart')).toBe(baseline.t('customer:steps.addToCart'));
    const entry = CUSTOMER_WORDING_MANIFEST.find((item) => item.key === 'customer:steps.addToCart');
    if (!entry) throw new Error('Missing cart action');
    expect(customerWordingDefaultText(entry, 'message', 'nl-NL')).toBe(baseline.t('customer:steps.addToCart'));
    expect(customerWordingSourceText(entry, 'message')).toBe('Add to cart');
    expect(customerWordingDefaultText(entry, 'message', 'ja-JP')).toBe('Add to cart');
  });

  it('uses the built-in plural grammar for absent override forms, including French zero and million', () => {
    const overlay = validOverlay({
      locale: 'fr-FR',
      messages: { 'customer:quantities.quantityCount': { other: '{{count}} choix personnalisés' } },
    });
    const custom = createCustomerTranslator('fr-FR', { wordingOverlay: overlay });
    const baseline = createCustomerTranslator('fr-FR');
    expect(custom.t('customer:quantities.quantityCount', { count: 2 })).toBe('2 choix personnalisés');
    for (const count of [0, 1, 1_000_000]) {
      expect(custom.t('customer:quantities.quantityCount', { count })).toBe(
        baseline.t('customer:quantities.quantityCount', { count }),
      );
    }
    expect(baseline.t('customer:quantities.quantityCount', { count: 0 })).not.toBe('0 items');
  });

  it('publishes a customer-only source manifest with readable labels and groups', () => {
    const save = CUSTOMER_WORDING_MANIFEST.find((entry) => entry.key === 'common:actions.save');
    const quantityCount = CUSTOMER_WORDING_MANIFEST.find((entry) => entry.key === 'customer:quantities.quantityCount');
    const uploadLimit = CUSTOMER_WORDING_MANIFEST.find((entry) => entry.key === 'customer:artwork.uploadTooLarge');

    expect(save).toMatchObject({
      label: 'Save',
      group: { id: 'common.actions', label: 'Shared actions' },
      sourceForms: { message: 'Save' },
      parameters: [],
    });
    expect(quantityCount).toMatchObject({
      label: 'Quantity count',
      group: { id: 'customer.quantities', label: 'Quantities' },
      sourceForms: { one: '{{count}} item', other: '{{count}} items' },
      parameters: [{ name: 'count', type: 'number' }],
    });
    expect(uploadLimit?.label).toBe('Upload too large');
    expect(CUSTOMER_WORDING_MANIFEST.every((entry) => entry.label.length > 0)).toBe(true);
    expect(CUSTOMER_WORDING_MANIFEST.some((entry) => entry.key.startsWith('admin-shell:'))).toBe(false);
    expect(Object.isFrozen(CUSTOMER_WORDING_MANIFEST)).toBe(true);
  });

  it('uses only the exact custom locale and keeps the shipped language registry unchanged', () => {
    const overlay = validOverlay({
      locale: 'en-US',
      messages: {
        'customer:steps.addToCart': { message: 'Start your order' },
      },
    });
    const translated = createCustomerTranslator('en-US', { wordingOverlay: overlay });
    const otherRegion = createCustomerTranslator('en-GB', { wordingOverlay: overlay });
    const admin = createAdminTranslator('en-US');

    expect(translated.t('customer:steps.addToCart')).toBe('Start your order');
    expect(translated.t('customer:steps.review')).toBe('Review');
    expect(translated).toMatchObject({
      activeLanguage: 'en',
      wordingLocale: 'en-US',
      formatLocale: 'en-US',
      lang: 'en-US',
      dir: 'ltr',
    });
    expect(otherRegion.t('customer:steps.addToCart')).toBe('Add to cart');
    expect(otherRegion.wordingLocale).toBeNull();
    expect((admin.t as unknown as (key: string) => string)('customer:steps.addToCart')).toBe('Unavailable');
    expect(SUPPORTED_LANGUAGES).toEqual(['en', 'nl', 'de', 'fr', 'es', 'it']);
  });

  it('uses target plural categories and source other text for missing forms', () => {
    const entry = CUSTOMER_WORDING_MANIFEST.find((item) => item.key === 'customer:quantities.quantityCount');
    if (!entry) throw new Error('Customer count message is missing');

    expect(requiredCustomerWordingForms(entry, 'ru-RU')).toEqual(['one', 'few', 'many', 'other']);
    expect(customerWordingSourceText(entry, 'few')).toBe('{{count}} items');
    const overlay = validOverlay({
      locale: 'ru-RU',
      messages: {
        'customer:quantities.quantityCount': {
          one: '{{count}} thing',
          few: '{{count}} things-ish',
        },
      },
    });
    const translator = createCustomerTranslator('ru-RU', { wordingOverlay: overlay });

    expect(translator.t('customer:quantities.quantityCount', { count: 1 })).toBe('1 thing');
    expect(translator.t('customer:quantities.quantityCount', { count: 2 })).toBe('2 things-ish');
    expect(translator.t('customer:quantities.quantityCount', { count: 5 })).toBe('5 items');
    expect(translator).toMatchObject({
      activeLanguage: 'en',
      wordingLocale: 'ru-RU',
      formatLocale: 'ru-RU',
      lang: 'ru-RU',
    });

    const missingTargetForms = createCustomerTranslator('ru-RU', {
      wordingOverlay: validOverlay({
        locale: 'ru-RU',
        messages: {
          'customer:quantities.quantityCount': { few: '{{count}} translated things' },
        },
      }),
    });
    expect(missingTargetForms.t('customer:quantities.quantityCount', { count: 2 })).toBe('2 translated things');
    expect(missingTargetForms.t('customer:quantities.quantityCount', { count: 21 })).toBe('21 items');

    const frenchZero = createCustomerTranslator('fr-FR', {
      wordingOverlay: validOverlay({ locale: 'fr-FR', messages: {} }),
    });
    expect(frenchZero.t('customer:quantities.quantityCount', { count: 0 })).toBe('0 article');
  });

  it('applies matching customer wording through the locale controller', async () => {
    const controller = createCustomerLocaleController('en-US', {
      wordingOverlay: validOverlay({
        locale: 'en-US',
        messages: { 'customer:steps.addToCart': { message: 'Place order' } },
      }),
    });

    expect(controller.getSnapshot().t('customer:steps.addToCart')).toBe('Place order');
    await controller.setLocale('en-GB');
    expect(controller.getSnapshot().t('customer:steps.addToCart')).toBe('Add to cart');
    expect(controller.getSnapshot().wordingLocale).toBeNull();
  });

  it('restores defaults by removing individual overrides without losing unrelated wording or modifying the catalog', async () => {
    const controller = createCustomerLocaleController('en', {
      wordingOverlay: validOverlay({
        locale: 'en',
        messages: {
          'customer:steps.artwork': { message: 'Your logo' },
          'customer:steps.review': { message: 'Check your design' },
        },
      }),
    });
    expect(controller.getSnapshot().t('customer:steps.artwork')).toBe('Your logo');
    await controller.setWordingOverlay(
      validOverlay({ locale: 'en', messages: { 'customer:steps.review': { message: 'Check your design' } } }),
    );
    expect(controller.getSnapshot().t('customer:steps.artwork')).toBe('Artwork');
    expect(controller.getSnapshot().t('customer:steps.review')).toBe('Check your design');
    await controller.setWordingOverlay(validOverlay({ locale: 'en', messages: {} }));
    expect(controller.getSnapshot().t('customer:steps.review')).toBe('Review');
    expect(createCustomerTranslator('en').t('customer:steps.artwork')).toBe('Artwork');
  });

  it('rejects unknown keys, forms, markup, and placeholder mismatches while allowing ampersands', () => {
    const result = validateCustomerWordingOverlay({
      locale: 'en-US',
      messages: {
        'customer:steps.addToCart': { message: 'Save & continue' },
        'customer:quantities.quantityCount': { message: '{{count}} items' },
        'customer:artwork.uploadTooLarge': { message: '<b>Upload</b> {{maxSizeMb}} MB' },
        'customer:missing.key': { message: 'Unknown' },
        'customer:steps.review': { other: 'Review' },
      },
    });

    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') return;
    expect(result.issues).toEqual(
      expect.arrayContaining([
        { code: 'unknown-form', key: 'customer:quantities.quantityCount', form: 'message' },
        { code: 'markup-not-allowed', key: 'customer:artwork.uploadTooLarge', form: 'message' },
        { code: 'unknown-key', key: 'customer:missing.key' },
        { code: 'unknown-form', key: 'customer:steps.review', form: 'other' },
      ]),
    );
    expect(
      validateCustomerWordingOverlay({
        locale: 'en-US',
        messages: { 'customer:steps.addToCart': { message: 'Save & continue' } },
      }).status,
    ).toBe('valid');
  });

  it('requires exact interpolation names for each plural form and canonical non-reserved tags', () => {
    const mismatch = validateCustomerWordingOverlay({
      locale: 'en-US',
      messages: {
        'customer:quantities.quantityCount': {
          one: '{{count}} item',
          other: '{{amount}} items',
        },
      },
    });
    const nonCanonical = validateCustomerWordingOverlay({ locale: 'EN-us', messages: {} });
    const pseudo = validateCustomerWordingOverlay({ locale: 'en-XA', messages: {} });

    expect(mismatch).toMatchObject({
      status: 'invalid',
      issues: [{ code: 'placeholder-mismatch', key: 'customer:quantities.quantityCount', form: 'other' }],
    });
    expect(nonCanonical).toMatchObject({ status: 'invalid', issues: [{ code: 'noncanonical-locale' }] });
    expect(pseudo).toMatchObject({ status: 'invalid', issues: [{ code: 'reserved-locale' }] });
  });

  it('interpolates validated values as plain text without treating them as templates', () => {
    const translator = createCustomerTranslator('en-US', {
      wordingOverlay: validOverlay({
        locale: 'en-US',
        messages: { 'common:resources.remove': { message: 'Remove {{resourceName}} & its copy' } },
      }),
    });
    const suppliedFilename = '<img src=x onerror=alert(1)> {{count}}';

    expect(translator.t('common:resources.remove', { resourceName: suppliedFilename })).toBe(
      `Remove ${suppliedFilename} & its copy`,
    );
  });
});

describe('literal custom wording and explicit script direction', () => {
  it('renders authored i18next-like text literally instead of resolving nested keys', () => {
    const overlay = validOverlay({
      locale: 'en',
      messages: {
        'customer:steps.addToCart': { message: '$t(customer:steps.review)' },
        'common:summary.unavailable': { message: '$t(customer:steps.review)' },
      },
    });
    const translated = createCustomerTranslator('en', { wordingOverlay: overlay });
    expect(translated.t('customer:steps.addToCart')).toBe('$t(customer:steps.review)');
    expect((translated.t as unknown as (key: string) => string)('customer:not-a-message')).toBe(
      '$t(customer:steps.review)',
    );
  });
  it('respects an explicit Latin script in a normally RTL language', async () => {
    const { customerDirectionForLocale } = await import('./customer.js');
    expect(customerDirectionForLocale('ku-Latn')).toBe('ltr');
    expect(customerDirectionForLocale('ku-Arab')).toBe('rtl');
    expect(customerDirectionForLocale('ar')).toBe('rtl');
  });
});
