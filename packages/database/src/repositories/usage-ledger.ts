import {
  type PaidOrderUsageHistory,
  type PaidOrderUsageQualification,
  qualifyPaidOrderUsage,
  type UsagePolicyIdentity,
} from '@insignia/domain';
import { type Kysely, sql } from 'kysely';
import type { Database } from '../client/database.js';
import { canonicalJson, sha256CanonicalJson } from '../hash/canonical.js';

export interface UsageLedgerScope {
  readonly shopId: string;
  readonly installationGeneration: string;
}
export interface UsageLedgerRecord extends UsageLedgerScope {
  readonly purchaseId: string;
  readonly orderId: string;
  readonly firstPaidAt: string | null;
  readonly decision: PaidOrderUsageQualification;
  /** Audit digest only, never provider authority or evidence that a charge was delivered. */
  readonly historyPolicyHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export class UsageLedgerStateError extends Error {
  constructor(readonly code: 'INVALID' | 'NOT_FOUND' | 'CONFLICT') {
    super(code);
  }
}
const fail = (code: UsageLedgerStateError['code']): never => {
  throw new UsageLedgerStateError(code);
};
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function validate(scope: UsageLedgerScope, purchaseId: string) {
  if (
    !scope ||
    typeof scope.shopId !== 'string' ||
    !scope.shopId ||
    scope.shopId.length > 256 ||
    /[\s\p{Cc}]/u.test(scope.shopId) ||
    typeof scope.installationGeneration !== 'string' ||
    !/^[1-9][0-9]{0,18}$/.test(scope.installationGeneration) ||
    BigInt(scope.installationGeneration) > 9223372036854775807n ||
    typeof purchaseId !== 'string' ||
    !UUID.test(purchaseId)
  )
    fail('INVALID');
}
interface Row {
  purchase_id: string;
  shop_id: string;
  installation_generation: string;
  order_id: string;
  first_paid_at: Date | null;
  decision: PaidOrderUsageQualification;
  history_policy_hash: string;
  created_at: Date;
  updated_at: Date;
}
function map(row: Row): UsageLedgerRecord {
  return {
    purchaseId: row.purchase_id,
    shopId: row.shop_id,
    installationGeneration: row.installation_generation,
    orderId: row.order_id,
    firstPaidAt: row.first_paid_at?.toISOString() ?? null,
    decision: row.decision,
    historyPolicyHash: row.history_policy_hash,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
const terminal = (decision: PaidOrderUsageQualification) => !['UNRESOLVED', 'PENDING_PAYMENT'].includes(decision.kind);

/** Local financial qualification only. Facts come from immutable purchase storage, never caller-supplied economics. */
export function createUsageLedgerRepository(db: Kysely<Database>) {
  async function get(executor: Kysely<Database>, scope: UsageLedgerScope, purchaseId: string, lock = false) {
    const row = (
      await sql<Row>`SELECT purchase_id::text,shop_id,installation_generation::text,order_id,first_paid_at,
      decision,history_policy_hash,created_at,updated_at FROM m9_order_usage
      WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint
      AND purchase_id=${purchaseId}::uuid ${lock ? sql`FOR UPDATE` : sql``}`.execute(executor)
    ).rows[0];
    return row ? map(row) : null;
  }
  return {
    /** Read-only recovery index. Cursor is a scan hint, never a claim or durable completion marker. */
    async selectPending(
      callerScope: UsageLedgerScope,
      page: { limit: number; afterPurchaseId: string | null },
    ): Promise<{
      purchases: readonly (UsageLedgerScope & { purchaseId: string })[];
      nextCursor: string | null;
      exhausted: boolean;
    }> {
      validate(
        callerScope,
        page?.afterPurchaseId === null ? '00000000-0000-0000-0000-000000000000' : page?.afterPurchaseId,
      );
      if (!page || !Number.isInteger(page.limit) || page.limit < 1 || page.limit > 100) return fail('INVALID');
      const scope = { shopId: callerScope.shopId, installationGeneration: callerScope.installationGeneration },
        limit = page.limit,
        after = page.afterPurchaseId;
      const rows = (
        await sql<{ purchase_id: string }>`SELECT p.purchase_id::text FROM purchase_orders p
        LEFT JOIN m9_order_usage u ON u.purchase_id=p.purchase_id
        LEFT JOIN m9_usage_delivery_intents d ON d.purchase_id=p.purchase_id
        WHERE p.shop_id=${scope.shopId} AND p.installation_generation=${scope.installationGeneration}::bigint
        AND (${after}::uuid IS NULL OR p.purchase_id>${after}::uuid)
        AND (u.purchase_id IS NULL OR u.qualification IN ('UNRESOLVED','PENDING_PAYMENT')
          OR (u.qualification='ELIGIBLE' AND d.purchase_id IS NULL))
        ORDER BY p.purchase_id LIMIT ${limit + 1}`.execute(db)
      ).rows;
      const selected = rows.slice(0, limit);
      return {
        purchases: selected.map((row) => ({ ...scope, purchaseId: row.purchase_id })),
        nextCursor: selected.at(-1)?.purchase_id ?? null,
        exhausted: rows.length <= limit,
      };
    },
    async get(scope: UsageLedgerScope, purchaseId: string): Promise<UsageLedgerRecord | null> {
      validate(scope, purchaseId);
      return get(db, scope, purchaseId);
    },
    async record(
      scope: UsageLedgerScope,
      input: { purchaseId: string; policy: UsagePolicyIdentity | null; history: PaidOrderUsageHistory },
    ): Promise<UsageLedgerRecord> {
      validate(scope, input?.purchaseId);
      return db.transaction().execute(async (tx) => {
        // Retained facts use their original generation, even after reinstall. No new current-generation authority is inferred.
        const identity = (
          await sql<{ order_id: string }>`SELECT p.order_id FROM purchase_orders p JOIN installation_generations i
          ON i.shop_id=p.shop_id AND i.generation=p.installation_generation WHERE p.shop_id=${scope.shopId}
          AND p.installation_generation=${scope.installationGeneration}::bigint AND p.purchase_id=${input.purchaseId}::uuid FOR SHARE OF i`.execute(
            tx,
          )
        ).rows[0];
        if (!identity) return fail('NOT_FOUND');
        // Same advisory key and subsequent purchase row-lock order as purchase reconciliation.
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope.shopId}:${identity.order_id}`},0))`.execute(
          tx,
        );
        const purchase = (
          await sql<{ order_id: string; is_test: boolean | null }>`SELECT order_id,is_test FROM purchase_orders
          WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint
          AND purchase_id=${input.purchaseId}::uuid FOR UPDATE`.execute(tx)
        ).rows[0];
        if (!purchase || purchase.order_id !== identity.order_id) return fail('CONFLICT');
        const previous = await get(tx, scope, input.purchaseId, true);
        if (previous && terminal(previous.decision)) return previous;
        const fact = (
          await sql<{ occurred_at: Date | null; has_binding: boolean }>`SELECT
          (SELECT occurred_at FROM purchase_paid_facts WHERE shop_id=${scope.shopId}
           AND installation_generation=${scope.installationGeneration}::bigint AND purchase_id=${input.purchaseId}::uuid) AS occurred_at,
          EXISTS(SELECT 1 FROM purchase_bindings WHERE shop_id=${scope.shopId}
           AND installation_generation=${scope.installationGeneration}::bigint AND purchase_id=${input.purchaseId}::uuid) AS has_binding`.execute(
            tx,
          )
        ).rows[0];
        if (
          !fact ||
          (fact.occurred_at !== null && (!(fact.occurred_at instanceof Date) || !Number.isFinite(+fact.occurred_at)))
        )
          return fail('INVALID');
        const firstPaidAt = fact.occurred_at?.toISOString() ?? null;
        if (previous?.firstPaidAt && previous.firstPaidAt !== firstPaidAt) return fail('CONFLICT');
        const decision = qualifyPaidOrderUsage({
          purchase: {
            ...scope,
            orderId: purchase.order_id,
            isTest: purchase.is_test,
            hasVerifiedCustomization: fact.has_binding ? true : null,
            firstPaidAt,
          },
          policy: input.policy,
          history: input.history,
        });
        let hash: string;
        let serialized: string;
        try {
          const evidence = canonicalJson({ policy: input.policy, history: input.history });
          if (Buffer.byteLength(evidence) > 1048576) return fail('INVALID');
          hash = sha256CanonicalJson({ policy: input.policy, history: input.history });
          serialized = canonicalJson(decision);
          if (Buffer.byteLength(serialized) > 8192) return fail('INVALID');
        } catch {
          return fail('INVALID');
        }
        if (previous)
          await sql`UPDATE m9_order_usage SET first_paid_at=${fact.occurred_at},qualification=${decision.kind},
          decision=${serialized}::jsonb,history_policy_hash=${hash} WHERE purchase_id=${input.purchaseId}::uuid`.execute(
            tx,
          );
        else
          await sql`INSERT INTO m9_order_usage(purchase_id,shop_id,installation_generation,order_id,first_paid_at,qualification,decision,history_policy_hash)
          VALUES(${input.purchaseId}::uuid,${scope.shopId},${scope.installationGeneration}::bigint,${purchase.order_id},
          ${fact.occurred_at},${decision.kind},${serialized}::jsonb,${hash})`.execute(tx);
        const stored = await get(tx, scope, input.purchaseId);
        if (!stored) return fail('CONFLICT');
        return stored;
      });
    },
  };
}
export type UsageLedgerRepository = ReturnType<typeof createUsageLedgerRepository>;
