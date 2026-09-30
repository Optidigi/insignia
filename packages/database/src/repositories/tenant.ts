import { sql, type Transaction } from 'kysely';
import type { Database, DatabaseExecutor } from '../client/database.js';

export interface ShopRecord {
  shopId: string;
  shopDomain: string;
  shopifyShopId: string | null;
  currentGeneration: string;
}

export interface ActiveAuthorizationScope {
  shopId: string;
  shopDomain: string;
  shopifyShopId: string;
  installationGeneration: string;
  authorizationGeneration: string;
  authorizationEpoch: number;
}

async function readAuthorizationScope(
  executor: DatabaseExecutor,
  input: { shopId: string; installationGeneration: string },
  lock: boolean,
): Promise<ActiveAuthorizationScope | null> {
  const query = executor
    .selectFrom('shops')
    .innerJoin('installation_generations as i', (join) =>
      join.onRef('i.shop_id', '=', 'shops.shop_id').onRef('i.generation', '=', 'shops.current_generation'),
    )
    .select([
      'shops.shop_id',
      'shops.shop_domain',
      'shops.shopify_shop_id',
      'shops.current_generation',
      'i.authorization_generation',
      'i.authorization_epoch',
    ])
    .where('shops.shop_id', '=', input.shopId)
    .where('shops.current_generation', '=', input.installationGeneration)
    .where('i.deactivated_at', 'is', null);
  const row = await (lock ? query.forUpdate() : query).executeTakeFirst();
  if (!row?.shopify_shop_id) return null;
  const epoch = Number(row.authorization_epoch);
  if (!Number.isSafeInteger(epoch) || epoch < 0 || epoch > 0xffff_ffff) throw new Error('Invalid authorization epoch');
  return {
    shopId: row.shop_id,
    shopDomain: row.shop_domain,
    shopifyShopId: row.shopify_shop_id,
    installationGeneration: row.current_generation,
    authorizationGeneration: row.authorization_generation,
    authorizationEpoch: epoch,
  };
}

function mapShop(row: {
  shop_id: string;
  shop_domain: string;
  shopify_shop_id: string | null;
  current_generation: string;
}): ShopRecord {
  return {
    shopId: row.shop_id,
    shopDomain: row.shop_domain,
    shopifyShopId: row.shopify_shop_id,
    currentGeneration: row.current_generation,
  };
}

/** Mutations require an enclosing transaction so installation and shop state commit together. */
export function createTenantRepository(executor: DatabaseExecutor) {
  return {
    async getActiveAuthorizationScope(input: {
      shopId: string;
      installationGeneration: string;
    }): Promise<ActiveAuthorizationScope | null> {
      return readAuthorizationScope(executor, input, false);
    },
    async lockActiveAuthorizationScope(input: {
      shopId: string;
      installationGeneration: string;
    }): Promise<ActiveAuthorizationScope | null> {
      return readAuthorizationScope(executor, input, true);
    },
    async getActiveProviderScope(input: { shopId: string; installationGeneration: string }) {
      const row = await executor
        .selectFrom('shops')
        .innerJoin('installation_generations as i', (join) =>
          join.onRef('i.shop_id', '=', 'shops.shop_id').onRef('i.generation', '=', 'shops.current_generation'),
        )
        .select(['shops.shop_id', 'shops.shop_domain', 'shops.shopify_shop_id', 'shops.current_generation'])
        .where('shops.shop_id', '=', input.shopId)
        .where('shops.current_generation', '=', input.installationGeneration)
        .where('i.deactivated_at', 'is', null)
        .executeTakeFirst();
      if (!row?.shopify_shop_id) return null;
      return {
        shopId: row.shop_id,
        shopDomain: row.shop_domain,
        shopifyShopId: row.shopify_shop_id,
        installationGeneration: row.current_generation,
      };
    },
    async getShop(shopId: string): Promise<ShopRecord | null> {
      const row = await executor
        .selectFrom('shops')
        .select(['shop_id', 'shop_domain', 'shopify_shop_id', 'current_generation'])
        .where('shop_id', '=', shopId)
        .executeTakeFirst();
      return row ? mapShop(row) : null;
    },
    async getShopByDomain(shopDomain: string): Promise<ShopRecord | null> {
      const row = await executor
        .selectFrom('shops')
        .select(['shop_id', 'shop_domain', 'shopify_shop_id', 'current_generation'])
        .where('shop_domain', '=', shopDomain)
        .executeTakeFirst();
      return row ? mapShop(row) : null;
    },
    async getCurrentAdminInstallation(shopId: string): Promise<{
      generation: string;
      externalInstallationId: string | null;
      active: boolean;
    } | null> {
      const row = await executor
        .selectFrom('shops')
        .innerJoin('installation_generations as i', (join) =>
          join.onRef('i.shop_id', '=', 'shops.shop_id').onRef('i.generation', '=', 'shops.current_generation'),
        )
        .select(['i.generation', 'i.external_installation_id', 'i.deactivated_at'])
        .where('shops.shop_id', '=', shopId)
        .executeTakeFirst();
      return row
        ? {
            generation: row.generation,
            externalInstallationId: row.external_installation_id,
            active: row.deactivated_at === null,
          }
        : null;
    },

    async createShop(
      transaction: Transaction<Database>,
      input: { shopId: string; shopDomain: string; shopifyShopId?: string; externalInstallationId?: string },
    ): Promise<ShopRecord> {
      const domain = input.shopDomain.trim().toLowerCase();
      if (input.shopifyShopId !== undefined && !/^[1-9][0-9]{0,19}$/.test(input.shopifyShopId))
        throw new TypeError('Invalid Shopify shop identity');
      await transaction
        .insertInto('shops')
        .values({
          shop_id: input.shopId,
          shop_domain: domain,
          shopify_shop_id: input.shopifyShopId ?? null,
          current_generation: '0',
        })
        .execute();
      await transaction
        .insertInto('installation_generations')
        .values({
          shop_id: input.shopId,
          generation: '1',
          external_installation_id: input.externalInstallationId ?? null,
          deactivated_at: null,
        })
        .execute();
      const row = await transaction
        .updateTable('shops')
        .set({ current_generation: '1', updated_at: new Date() })
        .where('shop_id', '=', input.shopId)
        .returning(['shop_id', 'shop_domain', 'shopify_shop_id', 'current_generation'])
        .executeTakeFirstOrThrow();
      return mapShop(row);
    },

    async startInstallation(
      transaction: Transaction<Database>,
      shopId: string,
      externalInstallationId?: string,
    ): Promise<string> {
      const shop = await transaction
        .selectFrom('shops')
        .select('current_generation')
        .where('shop_id', '=', shopId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const generation = (BigInt(shop.current_generation) + 1n).toString();
      await transaction
        .updateTable('installation_generations')
        .set({ deactivated_at: sql<Date>`clock_timestamp()` })
        .where('shop_id', '=', shopId)
        .where('generation', '=', shop.current_generation)
        .where('deactivated_at', 'is', null)
        .execute();
      await transaction
        .updateTable('shop_credentials')
        .set({
          state: 'revoked',
          access_envelope: null,
          refresh_envelope: null,
          refresh_claim_id: null,
          refresh_claim_until: null,
          updated_at: sql<Date>`clock_timestamp()`,
        })
        .where('shop_id', '=', shopId)
        .where('installation_generation', '=', shop.current_generation)
        .execute();
      await transaction
        .insertInto('installation_generations')
        .values({
          shop_id: shopId,
          generation,
          external_installation_id: externalInstallationId ?? null,
          deactivated_at: null,
        })
        .execute();
      await transaction
        .updateTable('shops')
        .set({ current_generation: generation, updated_at: new Date() })
        .where('shop_id', '=', shopId)
        .execute();
      await transaction
        .updateTable('product_configs')
        .set({
          effective_revision_id: null,
          effective_operation_id: null,
          updated_at: new Date(),
        })
        .where('shop_id', '=', shopId)
        .where('effective_operation_id', 'is not', null)
        .execute();
      return generation;
    },

    async deactivateCurrent(
      transaction: Transaction<Database>,
      shopId: string,
      expectedGeneration: string,
    ): Promise<'deactivated' | 'already_inactive' | 'stale'> {
      const shop = await transaction
        .selectFrom('shops')
        .select('current_generation')
        .where('shop_id', '=', shopId)
        .forUpdate()
        .executeTakeFirst();
      if (!shop || shop.current_generation !== expectedGeneration) return 'stale';
      const result = await transaction
        .updateTable('installation_generations')
        .set({ deactivated_at: sql<Date>`clock_timestamp()` })
        .where('shop_id', '=', shopId)
        .where('generation', '=', expectedGeneration)
        .where('deactivated_at', 'is', null)
        .executeTakeFirst();
      if (result.numUpdatedRows !== 1n) return 'already_inactive';
      await transaction
        .updateTable('shop_credentials')
        .set({
          state: 'revoked',
          access_envelope: null,
          refresh_envelope: null,
          refresh_claim_id: null,
          refresh_claim_until: null,
          updated_at: sql<Date>`clock_timestamp()`,
        })
        .where('shop_id', '=', shopId)
        .where('installation_generation', '=', expectedGeneration)
        .execute();
      await transaction
        .updateTable('product_configs')
        .set({ effective_revision_id: null, effective_operation_id: null, updated_at: sql<Date>`clock_timestamp()` })
        .where('shop_id', '=', shopId)
        .where('effective_operation_id', 'is not', null)
        .execute();
      return 'deactivated';
    },
  };
}
