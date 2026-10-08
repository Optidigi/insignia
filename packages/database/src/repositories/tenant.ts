import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { Database, DatabaseExecutor } from '../client/database.js';

export interface ShopRecord {
  shopId: string;
  shopDomain: string;
  shopifyShopId: string | null;
  currentGeneration: string;
}

export type ManagedInstallationState = ShopRecord & { externalInstallationId: string | null; active: boolean };
export type ManagedInstallationIdentity = {
  shopDomain: string;
  shopifyShopId: string;
  externalInstallationId: string;
};
export type ManagedInstallationInput = ManagedInstallationIdentity & {
  expected: ManagedInstallationState | null;
  /** A second matching provider observation; never a browser assertion. */
  confirmation?: ManagedInstallationIdentity;
};
export type ManagedInstallationResult = {
  outcome: 'CREATED' | 'REUSED' | 'REINSTALLED';
  state: ManagedInstallationState;
};
export class ManagedInstallationError extends Error {
  constructor(readonly kind: 'identity_mismatch' | 'state_changed' | 'confirmation_required') {
    super(
      {
        identity_mismatch: 'Managed installation identity mismatch',
        state_changed: 'Managed installation state changed',
        confirmation_required: 'Managed installation confirmation required',
      }[kind],
    );
    this.name = 'ManagedInstallationError';
  }
}

async function managedInstallationState(executor: DatabaseExecutor, shopDomain: string) {
  const row = await executor
    .selectFrom('shops')
    .innerJoin('installation_generations as i', (join) =>
      join.onRef('i.shop_id', '=', 'shops.shop_id').onRef('i.generation', '=', 'shops.current_generation'),
    )
    .select([
      'shops.shop_id',
      'shops.shop_domain',
      'shops.shopify_shop_id',
      'shops.current_generation',
      'i.external_installation_id',
      'i.deactivated_at',
    ])
    .where('shops.shop_domain', '=', shopDomain)
    .executeTakeFirst();
  return row
    ? { ...mapShop(row), externalInstallationId: row.external_installation_id, active: row.deactivated_at === null }
    : null;
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
    getManagedInstallationState: (shopDomain: string) => managedInstallationState(executor, shopDomain),
    async ensureManagedInstallation(
      transaction: Transaction<Database>,
      input: ManagedInstallationInput,
    ): Promise<ManagedInstallationResult> {
      if (
        !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(input.shopDomain) ||
        !/^[1-9][0-9]{0,19}$/.test(input.shopifyShopId) ||
        !/^gid:\/\/shopify\/AppInstallation\/[1-9][0-9]*$/.test(input.externalInstallationId)
      )
        throw new ManagedInstallationError('identity_mismatch');
      // Shared provider/domain locks serialize both first creation and alias races.
      for (const key of [
        `insignia:managed-install:domain:${input.shopDomain}`,
        `insignia:managed-install:shop:${input.shopifyShopId}`,
      ].sort())
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`.execute(transaction);
      const rows = await transaction
        .selectFrom('shops')
        .selectAll()
        .where((eb) =>
          eb.or([eb('shop_domain', '=', input.shopDomain), eb('shopify_shop_id', '=', input.shopifyShopId)]),
        )
        .forUpdate()
        .execute();
      if (
        rows.length > 1 ||
        rows.some((row) => row.shop_domain !== input.shopDomain || row.shopify_shop_id !== input.shopifyShopId)
      )
        throw new ManagedInstallationError('identity_mismatch');
      if (rows.length === 0) {
        if (input.expected !== null) throw new ManagedInstallationError('state_changed');
        await sql`SAVEPOINT managed_installation_create`.execute(transaction);
        try {
          await createTenantRepository(transaction).createShop(transaction, {
            shopId: randomUUID(),
            shopDomain: input.shopDomain,
            shopifyShopId: input.shopifyShopId,
            externalInstallationId: input.externalInstallationId,
          });
          await sql`RELEASE SAVEPOINT managed_installation_create`.execute(transaction);
          const state = await managedInstallationState(transaction, input.shopDomain);
          if (!state) throw new ManagedInstallationError('state_changed');
          return { outcome: 'CREATED', state };
        } catch (error) {
          if (!error || typeof error !== 'object' || !('code' in error) || error.code !== '23505') throw error;
          await sql`ROLLBACK TO SAVEPOINT managed_installation_create`.execute(transaction);
          await sql`RELEASE SAVEPOINT managed_installation_create`.execute(transaction);
          // An independent writer can bypass advisory locks. A uniqueness error
          // alone never proves success: re-read all provider-bound fields.
          await transaction
            .selectFrom('shops')
            .select('shop_id')
            .where('shop_domain', '=', input.shopDomain)
            .forUpdate()
            .execute();
          const winner = await managedInstallationState(transaction, input.shopDomain);
          if (
            !winner ||
            winner.shopifyShopId !== input.shopifyShopId ||
            winner.externalInstallationId !== input.externalInstallationId ||
            !winner.active
          )
            throw new ManagedInstallationError('identity_mismatch');
          return { outcome: 'REUSED', state: winner };
        }
      }
      const state = await managedInstallationState(transaction, input.shopDomain);
      if (!state || !state.externalInstallationId || (input.expected && input.expected.shopId !== state.shopId))
        throw new ManagedInstallationError('state_changed');
      if (state.externalInstallationId === input.externalInstallationId) {
        if (!state.active) throw new ManagedInstallationError('state_changed');
        return { outcome: 'REUSED', state };
      }
      const expected = input.expected;
      if (
        !expected ||
        expected.shopDomain !== state.shopDomain ||
        expected.shopifyShopId !== state.shopifyShopId ||
        expected.currentGeneration !== state.currentGeneration ||
        expected.externalInstallationId !== state.externalInstallationId ||
        expected.active !== state.active
      )
        throw new ManagedInstallationError('state_changed');
      const history = await transaction
        .selectFrom('installation_generations')
        .select('generation')
        .where('shop_id', '=', state.shopId)
        .where('external_installation_id', '=', input.externalInstallationId)
        .executeTakeFirst();
      if (history) throw new ManagedInstallationError('state_changed');
      const confirmation = input.confirmation;
      if (
        !confirmation ||
        confirmation.shopDomain !== input.shopDomain ||
        confirmation.shopifyShopId !== input.shopifyShopId ||
        confirmation.externalInstallationId !== input.externalInstallationId
      )
        throw new ManagedInstallationError('confirmation_required');
      await createTenantRepository(transaction).startInstallation(
        transaction,
        state.shopId,
        input.externalInstallationId,
      );
      const installed = await managedInstallationState(transaction, input.shopDomain);
      if (!installed) throw new ManagedInstallationError('state_changed');
      return { outcome: 'REINSTALLED', state: installed };
    },
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
