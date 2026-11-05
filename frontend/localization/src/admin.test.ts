import { describe, expect, it } from 'vitest';
import { createAdminTranslator } from './admin.js';

describe('merchant presentation contracts', () => {
  it('pluralizes order quantities and keeps a formatted quantity phrase intact in metadata', () => {
    const { t } = createAdminTranslator('en-GB');
    expect(t('home:orders.itemCount', { count: 1, formattedCount: '1' })).toBe('1 item');
    expect(t('home:orders.itemCount', { count: 2, formattedCount: '2' })).toBe('2 items');
    expect(t('home:orders.itemMeta', { formattedItemCount: '2 items', date: '4 Nov 2026' })).toBe(
      '2 items · 4 Nov 2026',
    );
  });

  it('renders permission outcomes from stable reason keys in the current snapshot', () => {
    const english = createAdminTranslator('en');
    const expanded = createAdminTranslator('en-XA', { allowPseudoLocale: true });
    expect(english.t('settings:permissionStatus.checkout-result-unknown')).toBe(
      'The permission request result is unknown. Check access to verify current permissions.',
    );
    expect(expanded.t('settings:permissionStatus.checkout-result-unknown')).toMatch(/^［/);
  });
});
