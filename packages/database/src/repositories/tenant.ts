import type { Transaction } from 'kysely';
import type { Database, DatabaseExecutor } from '../client/database.js';

export interface ShopRecord {
  shopId: string;
  shopDomain: string;
  currentGeneration: string;
}

function mapShop(row: { shop_id: string; shop_domain: string; current_generation: string }): ShopRecord {
  return { shopId: row.shop_id, shopDomain: row.shop_domain, currentGeneration: row.current_generation };
}

/** Mutations require an enclosing transaction so installation and shop state commit together. */
export function createTenantRepository(executor: DatabaseExecutor) {
  return {
    async getShop(shopId: string): Promise<ShopRecord | null> {
      const row = await executor.selectFrom('shops').select(['shop_id', 'shop_domain', 'current_generation'])
        .where('shop_id', '=', shopId).executeTakeFirst();
      return row ? mapShop(row) : null;
    },

    async createShop(transaction: Transaction<Database>, input: { shopId: string; shopDomain: string; externalInstallationId?: string }): Promise<ShopRecord> {
      const domain = input.shopDomain.trim().toLowerCase();
      await transaction.insertInto('shops').values({ shop_id: input.shopId, shop_domain: domain, current_generation: '0' }).execute();
      await transaction.insertInto('installation_generations').values({
        shop_id: input.shopId,
        generation: '1',
        external_installation_id: input.externalInstallationId ?? null,
        deactivated_at: null,
      }).execute();
      const row = await transaction.updateTable('shops').set({ current_generation: '1', updated_at: new Date() })
        .where('shop_id', '=', input.shopId).returning(['shop_id', 'shop_domain', 'current_generation']).executeTakeFirstOrThrow();
      return mapShop(row);
    },

    async startInstallation(transaction: Transaction<Database>, shopId: string, externalInstallationId?: string): Promise<string> {
      const shop = await transaction.selectFrom('shops').select('current_generation')
        .where('shop_id', '=', shopId).forUpdate().executeTakeFirstOrThrow();
      const generation = (BigInt(shop.current_generation) + 1n).toString();
      await transaction.updateTable('installation_generations').set({ deactivated_at: new Date() })
        .where('shop_id', '=', shopId).where('generation', '=', shop.current_generation).execute();
      await transaction.insertInto('installation_generations').values({
        shop_id: shopId,
        generation,
        external_installation_id: externalInstallationId ?? null,
        deactivated_at: null,
      }).execute();
      await transaction.updateTable('shops').set({ current_generation: generation, updated_at: new Date() })
        .where('shop_id', '=', shopId).execute();
      await transaction.updateTable('product_configs').set({
        effective_revision_id: null, effective_operation_id: null, updated_at: new Date(),
      }).where('shop_id', '=', shopId).where('effective_operation_id', 'is not', null).execute();
      return generation;
    },
  };
}
