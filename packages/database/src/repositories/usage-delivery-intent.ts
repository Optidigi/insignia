import type { UsagePolicyIdentity } from '@insignia/domain';
import { type Kysely, sql } from 'kysely';
import type { Database } from '../client/database.js';
import type { UsageLedgerScope } from './usage-ledger.js';

/** Separately qualified backend billing target. This DTO does not itself authenticate provider authority. */
export interface UsageDeliveryBinding {
  readonly appId: string;
  readonly providerShopId: string;
  readonly meterHandle: string;
  readonly policy: UsagePolicyIdentity;
}
/** Permanent financial intent only: not queued, transmitted, accepted or billed. */
export interface UsageDeliveryIntent extends UsageLedgerScope, UsageDeliveryBinding {
  readonly purchaseId: string;
  readonly orderId: string;
  readonly occurredAt: string;
  readonly units: 1;
  readonly cycleId: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}
export type UsageDeliveryPreparation =
  | { kind: 'STAGED'; intent: UsageDeliveryIntent }
  | { kind: 'NOT_ELIGIBLE' | 'UNBOUND' };
export class UsageDeliveryIntentStateError extends Error {
  constructor(readonly code: 'INVALID' | 'NOT_FOUND' | 'CONFLICT') {
    super(code);
  }
}
const fail = (code: UsageDeliveryIntentStateError['code']): never => {
  throw new UsageDeliveryIntentStateError(code);
};
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s\p{Cc}]/u.test(value);
function validate(scope: UsageLedgerScope, purchaseId: string) {
  if (
    !scope ||
    !text(scope.shopId) ||
    typeof scope.installationGeneration !== 'string' ||
    !/^[1-9][0-9]{0,18}$/.test(scope.installationGeneration) ||
    BigInt(scope.installationGeneration) > 9223372036854775807n ||
    typeof purchaseId !== 'string' ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(purchaseId)
  )
    fail('INVALID');
}
function snapshot(binding: UsageDeliveryBinding | null): UsageDeliveryBinding | null {
  if (binding === null) return null;
  if (
    !binding ||
    !text(binding.appId) ||
    !/^gid:\/\/shopify\/App\/[1-9][0-9]{0,39}$/.test(binding.appId) ||
    !text(binding.providerShopId) ||
    !/^gid:\/\/shopify\/Shop\/[1-9][0-9]{0,39}$/.test(binding.providerShopId) ||
    !text(binding.meterHandle) ||
    !binding.policy ||
    !text(binding.policy.id) ||
    !text(binding.policy.version)
  )
    fail('INVALID');
  return {
    appId: binding.appId,
    providerShopId: binding.providerShopId,
    meterHandle: binding.meterHandle,
    policy: { id: binding.policy.id, version: binding.policy.version },
  };
}
interface Row {
  purchase_id: string;
  shop_id: string;
  installation_generation: string;
  order_id: string;
  occurred_at: Date;
  units: 1;
  policy_id: string;
  policy_version: string;
  cycle_id: string;
  app_id: string;
  provider_shop_id: string;
  meter_handle: string;
  idempotency_key: string;
  created_at: Date;
}
function map(row: Row): UsageDeliveryIntent {
  return {
    purchaseId: row.purchase_id,
    shopId: row.shop_id,
    installationGeneration: row.installation_generation,
    orderId: row.order_id,
    occurredAt: row.occurred_at.toISOString(),
    units: row.units,
    policy: { id: row.policy_id, version: row.policy_version },
    cycleId: row.cycle_id,
    appId: row.app_id,
    providerShopId: row.provider_shop_id,
    meterHandle: row.meter_handle,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at.toISOString(),
  };
}
async function get(db: Kysely<Database>, scope: UsageLedgerScope, purchaseId: string) {
  const row = (
    await sql<Row>`SELECT purchase_id::text,shop_id,installation_generation::text,order_id,occurred_at,units,
    policy_id,policy_version,cycle_id,app_id,provider_shop_id,meter_handle,idempotency_key::text,created_at
    FROM m9_usage_delivery_intents WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint
    AND purchase_id=${purchaseId}::uuid`.execute(db)
  ).rows[0];
  return row ? map(row) : null;
}
/** Retains original-generation financial identity; any future dispatch must separately authorize credentials/contract/window. */
export function createUsageDeliveryIntentRepository(db: Kysely<Database>) {
  return {
    async get(scope: UsageLedgerScope, purchaseId: string): Promise<UsageDeliveryIntent | null> {
      validate(scope, purchaseId);
      return get(db, { ...scope }, purchaseId);
    },
    async prepare(
      callerScope: UsageLedgerScope,
      input: { purchaseId: string; binding: UsageDeliveryBinding | null },
    ): Promise<UsageDeliveryPreparation> {
      validate(callerScope, input?.purchaseId);
      const scope = { ...callerScope },
        purchaseId = input.purchaseId,
        binding = snapshot(input.binding);
      try {
        return await db.transaction().execute(async (tx) => {
          // Installation SHARE first, then the same shop:order advisory key used by immutable purchase/usage reconciliation.
          const identity = (
            await sql<{
              order_id: string;
              provider_id: string | null;
            }>`SELECT p.order_id,s.shopify_shop_id::text AS provider_id
            FROM purchase_orders p JOIN installation_generations i ON i.shop_id=p.shop_id AND i.generation=p.installation_generation
            JOIN shops s ON s.shop_id=p.shop_id WHERE p.purchase_id=${purchaseId}::uuid AND p.shop_id=${scope.shopId}
            AND p.installation_generation=${scope.installationGeneration}::bigint FOR SHARE OF i`.execute(tx)
          ).rows[0];
          if (!identity) return fail('NOT_FOUND');
          await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope.shopId}:${identity.order_id}`},0))`.execute(
            tx,
          );
          const source = (
            await sql<{
              qualification: string;
              first_paid_at: Date | null;
              policy_id: string;
              policy_version: string;
              cycle_id: string;
            }>`SELECT qualification,first_paid_at,
            decision->'policy'->>'id' AS policy_id,decision->'policy'->>'version' AS policy_version,decision->>'cycleId' AS cycle_id
            FROM m9_order_usage WHERE purchase_id=${purchaseId}::uuid AND shop_id=${scope.shopId}
            AND installation_generation=${scope.installationGeneration}::bigint FOR SHARE`.execute(tx)
          ).rows[0];
          if (source?.qualification !== 'ELIGIBLE') return { kind: 'NOT_ELIGIBLE' };
          if (!binding) return { kind: 'UNBOUND' };
          if (
            binding.providerShopId !== `gid://shopify/Shop/${identity.provider_id}` ||
            binding.policy.id !== source.policy_id ||
            binding.policy.version !== source.policy_version
          )
            return fail('CONFLICT');
          const existing = await get(tx, scope, purchaseId);
          if (existing) {
            if (
              existing.appId !== binding.appId ||
              existing.providerShopId !== binding.providerShopId ||
              existing.meterHandle !== binding.meterHandle ||
              existing.policy.id !== binding.policy.id ||
              existing.policy.version !== binding.policy.version
            )
              return fail('CONFLICT');
            return { kind: 'STAGED', intent: existing };
          }
          await sql`INSERT INTO m9_usage_delivery_intents(purchase_id,shop_id,installation_generation,order_id,occurred_at,units,
            policy_id,policy_version,cycle_id,app_id,provider_shop_id,meter_handle)
            VALUES(${purchaseId}::uuid,${scope.shopId},${scope.installationGeneration}::bigint,${identity.order_id},${source.first_paid_at},1,
            ${source.policy_id},${source.policy_version},${source.cycle_id},${binding.appId},${binding.providerShopId},${binding.meterHandle})`.execute(
            tx,
          );
          const intent = await get(tx, scope, purchaseId);
          if (!intent) return fail('CONFLICT');
          return { kind: 'STAGED', intent };
        });
      } catch (error) {
        if (error instanceof UsageDeliveryIntentStateError) throw error;
        const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
        if (['23505', '23514', '23503'].includes(String(code))) return fail('CONFLICT');
        throw error;
      }
    },
  };
}
export type UsageDeliveryIntentRepository = ReturnType<typeof createUsageDeliveryIntentRepository>;
