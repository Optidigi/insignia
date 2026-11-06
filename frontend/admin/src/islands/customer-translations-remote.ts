import { MerchantCustomerWordingOverlaysSchema } from '@insignia/contracts';
import { createMerchantPreferencesClient } from '../shared/merchant-preferences-client.ts';
import type { CustomerTranslationsStoragePort } from './customer-translations-workflow';

/** Same workflow/state machine as the demo, backed by authorized store-wide preferences. */
export function createRemoteCustomerTranslationsStorage(shop: unknown, client = createMerchantPreferencesClient()): CustomerTranslationsStoragePort {
  let boundShop: string | null = typeof shop === 'string' ? shop : null;
  const matchesShop = (actual: string) => {
    if (boundShop === null || actual !== boundShop) throw new Error('Customer wording shop mismatch');
  };
  return {
    async read() {
      const preferences = await client.read();
      if (boundShop === null) boundShop = preferences.shop;
      matchesShop(preferences.shop);
      return { version: 1, shop: preferences.shop, overlays: preferences.overlays };
    },
    async write(record) {
      matchesShop(record.shop);
      await client.saveWording(MerchantCustomerWordingOverlaysSchema.parse(record.overlays));
    },
    async remove() {
      const preferences = await client.read();
      matchesShop(preferences.shop);
      await client.saveWording({ en: { locale: 'en', messages: {} } });
    },
  };
}
