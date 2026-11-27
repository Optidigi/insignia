import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createMerchantPreferencesRepository } from '../src/repositories/merchant-preferences.js';
import { createTenantRepository } from '../src/repositories/tenant.js';
import { openTestDatabase } from './support/postgres.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('Free plan product choice', () => {
  it('keeps one choice per shop and does not reuse it after reinstall', async () => {
    const database = await openTestDatabase();
    const shopId = randomUUID();
    try {
      await database.transaction().execute(async (tx) => {
        await createTenantRepository(tx).createShop(tx, {
          shopId,
          shopDomain: `free-${randomBytes(8).toString('hex')}.myshopify.com`,
          shopifyShopId: BigInt(`0x${randomBytes(8).toString('hex')}`).toString(),
          externalInstallationId: 'gid://shopify/AppInstallation/1',
        });
        const preferences = createMerchantPreferencesRepository(tx);
        expect(await preferences.readFreeProduct(shopId, '1')).toBeNull();
        await preferences.chooseFreeProduct(shopId, '1', '101');
        expect(await preferences.readFreeProduct(shopId, '1')).toBe('101');
        expect(await preferences.readFreeProduct(shopId, '2')).toBeNull();
        await preferences.chooseFreeProduct(shopId, '2', '102');
        expect(await preferences.readFreeProduct(shopId, '1')).toBeNull();
        expect(await preferences.readFreeProduct(shopId, '2')).toBe('102');
      });
    } finally {
      await database.destroy();
    }
  });
});
