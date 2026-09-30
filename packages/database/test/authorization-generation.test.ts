import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { createDurableCore } from '../src/index.js';
import { openTestDatabase } from './support/postgres.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('installation authorization generation', () => {
  it('assigns a durable unique UUID per installation and fences stale or inactive generations', async () => {
    const database = await openTestDatabase();
    const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
    const shopId = randomUUID();
    const shopifyShopId = (BigInt(`0x${shopId.replaceAll('-', '').slice(0, 15)}`) + 1n).toString();
    try {
      await core.transactions.run((transaction) =>
        core.tenants.createShop(transaction, {
          shopId,
          shopDomain: `${shopId}.myshopify.com`,
          shopifyShopId,
        }),
      );
      const one = await core.tenants.getActiveAuthorizationScope({ shopId, installationGeneration: '1' });
      expect(one?.authorizationGeneration).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(one?.authorizationEpoch).toBe(0);
      expect(await core.tenants.getActiveAuthorizationScope({ shopId, installationGeneration: '1' })).toEqual(one);
      await expect(
        database
          .updateTable('installation_generations')
          .set({ authorization_generation: randomUUID() })
          .where('shop_id', '=', shopId)
          .where('generation', '=', '1')
          .execute(),
      ).rejects.toThrow();
      await core.transactions.run((transaction) => core.tenants.startInstallation(transaction, shopId));
      const two = await core.tenants.getActiveAuthorizationScope({ shopId, installationGeneration: '2' });
      expect(two?.authorizationGeneration).toMatch(/^[0-9a-f-]{36}$/);
      expect(two?.authorizationGeneration).not.toBe(one?.authorizationGeneration);
      expect(await core.tenants.getActiveAuthorizationScope({ shopId, installationGeneration: '1' })).toBeNull();
      await expect(
        database
          .updateTable('installation_generations')
          .set({ authorization_epoch: '4294967296' })
          .where('shop_id', '=', shopId)
          .where('generation', '=', '2')
          .execute(),
      ).rejects.toThrow();
      await core.transactions.run((transaction) => core.tenants.deactivateCurrent(transaction, shopId, '2'));
      expect(await core.tenants.getActiveAuthorizationScope({ shopId, installationGeneration: '2' })).toBeNull();
    } finally {
      await Promise.all([core.close(), database.destroy()]);
    }
  });
});
