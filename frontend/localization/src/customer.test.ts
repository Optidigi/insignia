import { describe, expect, it } from 'vitest';
import { createAdminTranslator } from './admin.js';
import { createCustomerLocaleController, createCustomerTranslator, customerMessage } from './customer.js';

describe('audience-scoped translators', () => {
  it('translates synchronously with a fresh customer instance', () => {
    const first = createCustomerTranslator('en');
    const second = createCustomerTranslator('nl-NL');

    expect(first.t('customer:quantities.quantityCount', { count: 1 })).toBe('1 item');
    expect(second).not.toBe(first);
    expect(second.t('customer:quantities.quantityCount', { count: 2 })).toBe('2 artikelen');
    expect(second).toMatchObject({
      requestedLocale: 'nl-NL',
      activeLanguage: 'nl',
      formatLocale: 'nl-NL',
      lang: 'nl',
    });
  });

  it('counts the same customized items with one unit word on Quantities and Review', () => {
    for (const locale of ['en', 'nl', 'de', 'fr', 'es', 'it'])
      for (const count of [1, 3]) {
        const { t } = createCustomerTranslator(locale);
        expect(t('customer:quantities.quantityCount', { count }), `${locale} ${count}`).toBe(
          t('customer:review.itemCount', { count }),
        );
      }
  });

  it('keeps Spanish diseño for the artwork and personalización for the whole or saved design', () => {
    const { t } = createCustomerTranslator('es');
    const artwork = [
      t('customer:steps.artwork'),
      t('customer:artwork.chooseArtwork'),
      t('customer:review.artwork'),
      t('customer:recovery.editDesign'),
    ];
    for (const text of artwork) expect(text).toMatch(/diseño/i);
    const wholeDesign = [
      t('customer:chrome.skipToDesignControls'),
      t('customer:chrome.designControls'),
      t('customer:review.designTotals'),
      t('customer:review.currentDesign'),
      t('customer:validation.checkDesign'),
      t('customer:recovery.cartCommitFailed'),
      t('customer:recovery.cartRejected'),
      t('customer:recovery.cartRejectedStock'),
      t('customer:recovery.busy'),
      t('customer:recovery.unavailable'),
      t('customer:host.discardHelp'),
      t('customer:host.savedDesigns'),
      t('customer:host.openSaved'),
      t('customer:host.startNew'),
      t('customer:close.help'),
      t('customer:resume.help'),
    ];
    for (const text of wholeDesign) {
      expect(text).toMatch(/personalizaci(ón|ones)/i);
      expect(text).not.toMatch(/diseño/i);
    }
    expect(t('customer:host.startNew')).toBe(t('customer:resume.startNew'));
  });

  it('uses an expanded pseudo catalog without changing interpolation values', () => {
    const pseudo = createCustomerTranslator('en-XA', { allowPseudoLocale: true });

    expect(
      pseudo.t('customer:artwork.addArtworkForPosition', {
        positionName: '<front & back>',
      }),
    ).toContain('<front & back>');
    expect(
      pseudo.t('customer:artwork.addArtworkForPosition', {
        positionName: '<front & back>',
      }),
    ).toMatch(/^［/);
    expect(pseudo).toMatchObject({ activeLanguage: 'en-XA', lang: 'en-XA', dir: 'ltr' });
  });

  it('stores a semantic message descriptor and renders it with the active translator', async () => {
    const message = customerMessage('common:resources.remove', { resourceName: 'View' });
    const controller = createCustomerLocaleController('en', { allowPseudoLocale: true });

    expect(controller.getSnapshot().message(message)).toBe('Remove View');
    await controller.setLocale('en-XA');

    expect(controller.getSnapshot().message(message)).toMatch(/^［/);
    expect(message).toEqual({
      key: 'common:resources.remove',
      args: [{ resourceName: 'View' }],
    });
    expect(Object.isFrozen(message)).toBe(true);
    expect(Object.isFrozen(message.args)).toBe(true);
    expect(Object.isFrozen(message.args[0])).toBe(true);
  });

  it('keeps customer and admin preview resources in separate instances', () => {
    const customer = createCustomerTranslator('en');
    const admin = createAdminTranslator('en');
    const unsafeLookup = customer.t as unknown as (key: string) => string;

    expect(admin.t('admin-preview:preview.documentTitle')).toBe('Insignia | Artwork preview');
    expect(customer.t('customer:steps.addToCart')).toBe('Add to cart');
    expect(unsafeLookup('admin-preview:preview.documentTitle')).toBe('Unavailable');
  });

  it('uses a safe English fallback for invalid dynamic keys and interpolation values', () => {
    const missingKeys: string[] = [];
    const translator = createCustomerTranslator('en', {
      onMissingKey: (key) => missingKeys.push(key),
    });
    const unsafeLookup = translator.t as unknown as (key: string, values?: unknown) => string;

    expect(unsafeLookup('common:resources.remove')).toBe('Unavailable');
    expect(
      unsafeLookup('common:resources.remove', {
        resourceName: { html: '<img src=x onerror=alert(1)>' },
      }),
    ).toBe('Unavailable');
    expect(unsafeLookup('customer:quantities.quantityCount', { count: 'two' })).toBe('Unavailable');
    expect(missingKeys).toEqual([
      'common:resources.remove',
      'common:resources.remove',
      'customer:quantities.quantityCount',
    ]);
  });

  it('returns plain text for escaped text-node sinks', () => {
    const translator = createCustomerTranslator('en');
    const filename = '<img src=x onerror=alert(1)>.png';

    expect(translator.t('common:resources.remove', { resourceName: filename })).toBe(`Remove ${filename}`);
  });

  it('preserves merchant content containing translation-like syntax literally', () => {
    const translator = createCustomerTranslator('en');
    const filename = '$t(common:actions.close) {{count}} <logo>.svg';
    expect(translator.t('common:resources.remove', { resourceName: filename })).toBe(`Remove ${filename}`);
  });

  it('does not expose a half-prepared language to subscribers', async () => {
    let finishPreparation: (() => void) | undefined;
    const controller = createCustomerLocaleController('en', {
      prepareLocale: async () =>
        new Promise<void>((resolve) => {
          finishPreparation = resolve;
        }),
    });
    const notices: string[] = [];
    controller.subscribe(() => notices.push(controller.getSnapshot().requestedLocale ?? ''));

    const update = controller.setLocale('nl-NL');
    expect(controller.getSnapshot().requestedLocale).toBe('en');
    finishPreparation?.();

    await expect(update).resolves.toEqual({ status: 'activated' });
    expect(notices).toEqual(['nl-NL']);
    expect(controller.getSnapshot()).toMatchObject({ activeLanguage: 'nl', lang: 'nl' });
  });
});
