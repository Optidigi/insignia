import { describe, expect, it } from 'vitest';
import { createAdminTranslator } from './admin.js';
import { SUPPORTED_LANGUAGES } from './core.js';
import { createCustomerLocaleController, createCustomerTranslator } from './customer.js';
import { adminParameterContracts } from './generated/admin-parameters.js';
import { customerParameterContracts } from './generated/customer-parameters.js';
import { guestParameterContracts } from './generated/guest-parameters.js';
import { createGuestTranslator } from './guest.js';

const saveLabels = { en: 'Save', nl: 'Opslaan', de: 'Speichern', fr: 'Enregistrer', es: 'Guardar', it: 'Salva' };

describe('complete bundled languages', () => {
  it('renders each audience in its selected language without sharing mutable language state', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const admin = createAdminTranslator(language);
      const customer = createCustomerTranslator(language);
      const guest = createGuestTranslator(language);
      expect(admin.t('common:actions.save')).toBe(saveLabels[language]);
      expect(customer.t('common:actions.save')).toBe(saveLabels[language]);
      expect(guest.t('common:actions.save')).toBe(saveLabels[language]);
      expect(customer.lang).toBe(language);
      expect(createAdminTranslator('en').t('common:actions.save')).toBe('Save');
    }
  });

  it('renders every typed message with real plural categories and valid parameters', () => {
    const audiences = [
      [createAdminTranslator, adminParameterContracts],
      [createCustomerTranslator, customerParameterContracts],
      [createGuestTranslator, guestParameterContracts],
    ] as const;
    for (const language of SUPPORTED_LANGUAGES) {
      const number = new Intl.NumberFormat(language);
      for (const [createTranslator, contracts] of audiences) {
        const missing: string[] = [];
        const snapshot = createTranslator(language, { onMissingKey: (key) => missing.push(key) });
        const dynamic = snapshot.t as unknown as (key: string, values?: Record<string, string | number>) => string;
        for (const [key, parameters] of Object.entries(contracts)) {
          for (const count of Object.hasOwn(parameters, 'count') ? [0, 1, 2, 5, 1_000_000] : [2]) {
            const values = Object.fromEntries(
              Object.entries(parameters).map(([name, type]) => [
                name,
                type === 'number'
                  ? count
                  : name.startsWith('formatted')
                    ? number.format(count)
                    : 'Shopify supplied <&> value',
              ]),
            );
            const result = dynamic(key, Object.keys(values).length ? values : undefined);
            expect(result, `${language} ${key} ${count}`).toBeTruthy();
            expect(result, `${language} ${key}`).not.toBe(key);
            for (const name of Object.keys(parameters)) expect(result).not.toContain(`{{${name}}}`);
          }
        }
        expect(missing, `${language} contract diagnostics`).toEqual([]);
      }
    }
  });

  it('switches complete real language snapshots', async () => {
    const controller = createCustomerLocaleController('en');
    for (const language of ['nl', 'de', 'fr', 'es', 'it', 'en'] as const) {
      await expect(controller.setLocale(language)).resolves.toEqual({ status: 'activated' });
      expect(controller.getSnapshot().t('common:actions.save')).toBe(saveLabels[language]);
    }
  });
});
