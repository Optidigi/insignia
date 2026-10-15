import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PurchaseObservation } from '@insignia/application';
import type { PaidOrderUsageHistory } from '@insignia/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPurchaseRepository } from '../src/repositories/purchase.js';
import { createUsageLedgerRepository } from '../src/repositories/usage-ledger.js';
import { openTestDatabase, openTestDurableCore } from './support/postgres.js';
import { purchaseFixture } from './support/purchase-fixture.js';

const policy = { id: 'single-plan', version: '2026-10-10' };
const occurredAt = '2026-10-15T12:00:00.000Z';
const unavailable = { kind: 'UNAVAILABLE' } as const;

describe.runIf(Boolean(process.env.DATABASE_URL))('durable first-paid usage qualification ledger', () => {
  let db: Awaited<ReturnType<typeof openTestDatabase>>;
  beforeAll(async () => {
    db = await openTestDatabase();
  });
  afterAll(async () => {
    await db?.destroy();
  });
  async function fixture(options: { test?: boolean; bound?: boolean; paid?: boolean } = {}) {
    const f = await purchaseFixture(db);
    const binding: PurchaseObservation['bindings'][number] = {
      quoteId: f.quote.quoteId,
      authorizationSetId: f.authorization.setId,
      quote: f.quote as never,
      lines: [
        {
          orderLineId: 'gid://shopify/LineItem/55',
          lineIndex: 0,
          productId: f.productId,
          variantId: '1',
          quantity: 1,
          unitPriceMinor: '1001',
        },
        {
          orderLineId: 'gid://shopify/LineItem/56',
          lineIndex: 1,
          productId: f.productId,
          variantId: '2',
          quantity: 1,
          unitPriceMinor: '1000',
        },
      ],
      designPayload: null,
      payloadCollectedAt: '2026-10-15T10:00:00.000Z',
      payloadExpiresAt: '2026-10-22T10:00:00.000Z',
    };
    const input: PurchaseObservation = {
      order: {
        shopId: f.shopId,
        installationGeneration: f.generation,
        orderId: `gid://shopify/Order/${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`)}`,
        createdAt: '2026-10-15T10:00:00.000Z',
        updatedAt: occurredAt,
        observedAt: '2026-10-15T12:01:00.000Z',
        currency: 'USD',
        country: 'US',
        marketId: '42',
        totalPriceMinor: '2001',
        contextVerified: true,
        test: options.test ?? false,
        sourceApiVersion: '2026-07',
        edited: false,
        complete: true,
        financialStatus: options.paid === false ? 'PENDING' : 'PAID',
        cancelledAt: null,
        lines:
          options.bound === false
            ? []
            : binding.lines.map((line) => ({
                lineId: line.orderLineId,
                productId: line.productId,
                variantId: line.variantId,
                quantity: line.quantity,
                currentQuantity: line.quantity,
                originalUnitPriceMinor: line.unitPriceMinor,
                sellingPlanId: null,
                attributes: [{ key: '_insignia_quote_v2', value: 'application-verified-at-repository-seam' }],
              })),
        transactions: [],
        refunds: [],
      },
      bindings: options.bound === false ? [] : [binding],
      exception: options.bound === false ? 'AUTHORIZATION_INCOMPLETE' : null,
      firstPaidAt: options.paid === false ? null : occurredAt,
    };
    const result = await createPurchaseRepository(db).reconcile(input);
    if (!result.purchaseId) throw new Error('expected customized purchase');
    const scope = { shopId: f.shopId, installationGeneration: f.generation };
    const history: PaidOrderUsageHistory = {
      kind: 'TRUSTED',
      ...scope,
      windows: [
        {
          kind: 'PAID',
          startsAt: '2026-10-01T00:00:00.000Z',
          endsAt: '2026-11-01T00:00:00.000Z',
          policy,
          cycleId: 'cycle-a',
          cycle: { startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z' },
        },
      ],
    };
    return { scope, purchaseId: result.purchaseId, history, input, binding };
  }
  it('persists one identity across concurrent calls and a fresh facade/pool, ignoring quote trial policy', async () => {
    const f = await fixture(),
      core = openTestDurableCore();
    let closed = false;
    try {
      const rows = await Promise.all(
        Array.from({ length: 6 }, () =>
          core.usageLedger.record(f.scope, { purchaseId: f.purchaseId, policy, history: f.history }),
        ),
      );
      expect(rows.every((row) => row.decision.kind === 'ELIGIBLE' && row.decision.units === 1)).toBe(true);
      expect(new Set(rows.map((row) => row.createdAt)).size).toBe(1);
      expect(rows[0]?.firstPaidAt).toBe(occurredAt);
      expect(rows[0]?.historyPolicyHash).toMatch(/^[a-f0-9]{64}$/);
      expect(await core.usageLedger.get(f.scope, f.purchaseId)).toEqual(rows[0]);
      await core.close();
      closed = true;
      const reopened = openTestDurableCore();
      try {
        expect(
          await reopened.usageLedger.record(f.scope, { purchaseId: f.purchaseId, policy, history: unavailable }),
        ).toEqual(rows[0]);
      } finally {
        await reopened.close();
      }
      expect(
        (
          await sql<{
            count: string;
          }>`SELECT count(*)::text FROM m9_order_usage WHERE shop_id=${f.scope.shopId}`.execute(db)
        ).rows[0]?.count,
      ).toBe('1');
    } finally {
      if (!closed) await core.close();
    }
  });
  it('excludes actual test facts despite caller overrides and holds immutable unknown legacy test status', async () => {
    const f = await fixture({ test: true }),
      repo = createUsageLedgerRepository(db);
    const attemptedOverride = {
      purchaseId: f.purchaseId,
      policy,
      history: unavailable,
      isTest: false,
      units: 1,
      firstPaidAt: occurredAt,
    };
    expect((await repo.record(f.scope, attemptedOverride)).decision).toEqual({
      kind: 'EXCLUDED',
      reason: 'TEST_ORDER',
      units: 0,
    });
    const legacyId = randomUUID();
    await sql`INSERT INTO purchase_orders(purchase_id,shop_id,installation_generation,order_id,order_created_at,currency,original_total_minor)
      VALUES(${legacyId}::uuid,${f.scope.shopId},${f.scope.installationGeneration}::bigint,'gid://shopify/Order/9881',${new Date(occurredAt)},'USD',2001)`.execute(
      db,
    );
    expect((await repo.record(f.scope, { purchaseId: legacyId, policy, history: f.history })).decision).toEqual({
      kind: 'UNRESOLVED',
      reason: 'TEST_STATUS_UNKNOWN',
      units: 0,
    });
  });
  it('keeps missing bindings unresolved, then uses late immutable binding/payment and historical evidence', async () => {
    const f = await fixture({ bound: false, paid: false }),
      repo = createUsageLedgerRepository(db);
    const first = await repo.record(f.scope, { purchaseId: f.purchaseId, policy, history: unavailable });
    expect(first.decision).toEqual({ kind: 'UNRESOLVED', reason: 'CUSTOMIZATION_UNVERIFIED', units: 0 });
    const complete = {
      ...f.input,
      bindings: [f.binding],
      exception: null,
      order: {
        ...f.input.order,
        lines: f.binding.lines.map((line) => ({
          lineId: line.orderLineId,
          productId: line.productId,
          variantId: line.variantId,
          quantity: line.quantity,
          currentQuantity: line.quantity,
          originalUnitPriceMinor: line.unitPriceMinor,
          sellingPlanId: null,
          attributes: [{ key: '_insignia_quote_v2', value: 'application-verified-at-repository-seam' }],
        })),
      },
    };
    await createPurchaseRepository(db).reconcile(complete);
    expect((await repo.record(f.scope, { purchaseId: f.purchaseId, policy, history: unavailable })).decision).toEqual({
      kind: 'PENDING_PAYMENT',
      units: 0,
    });
    await createPurchaseRepository(db).reconcile({
      ...complete,
      firstPaidAt: occurredAt,
      order: { ...complete.order, financialStatus: 'PAID' },
    });
    const held = await repo.record(f.scope, { purchaseId: f.purchaseId, policy, history: unavailable });
    expect(held.firstPaidAt).toBe(occurredAt);
    expect(held.decision).toEqual({ kind: 'UNRESOLVED', reason: 'HISTORY_UNAVAILABLE', units: 0 });
    const eligible = await repo.record(f.scope, { purchaseId: f.purchaseId, policy, history: f.history });
    expect(eligible.decision).toMatchObject({ kind: 'ELIGIBLE', units: 1, occurredAt });
    expect(eligible.createdAt).toBe(first.createdAt);
  });
  it('permanently waives the event-time trial despite paid history, refund/cancellation observations or reinstall', async () => {
    const f = await fixture(),
      repo = createUsageLedgerRepository(db);
    const trial: PaidOrderUsageHistory = {
      kind: 'TRUSTED',
      ...f.scope,
      windows: [
        {
          kind: 'TRIAL',
          startsAt: '2026-10-10T00:00:00.000Z',
          endsAt: '2026-10-24T00:00:00.000Z',
          policy,
          trial: { startsAt: '2026-10-10T00:00:00.000Z', endsAt: '2026-10-24T00:00:00.000Z' },
        },
      ],
    };
    const waived = await repo.record(f.scope, { purchaseId: f.purchaseId, policy, history: trial });
    expect(waived.decision).toMatchObject({ kind: 'WAIVED_TRIAL', units: 0, occurredAt });
    await createPurchaseRepository(db).reconcile({
      ...f.input,
      firstPaidAt: null,
      order: {
        ...f.input.order,
        updatedAt: '2026-10-15T13:00:00.000Z',
        financialStatus: 'REFUNDED',
        cancelledAt: '2026-10-15T13:00:00.000Z',
        refunds: [
          {
            refundId: 'gid://shopify/Refund/8191',
            occurredAt: '2026-10-15T13:00:00.000Z',
            currency: 'USD',
            amountMinor: '2001',
            lines: [],
          },
        ],
      },
    });
    const core = openTestDurableCore();
    try {
      await core.transactions.run((tx) => core.tenants.startInstallation(tx, f.scope.shopId));
    } finally {
      await core.close();
    }
    expect(await repo.record(f.scope, { purchaseId: f.purchaseId, policy, history: f.history })).toEqual(waived);
    expect(await repo.get({ ...f.scope, installationGeneration: '2' }, f.purchaseId)).toBeNull();
    await expect(
      repo.record(
        { ...f.scope, installationGeneration: '2' },
        { purchaseId: f.purchaseId, policy, history: f.history },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('rejects another tenant, stale scope, malformed scope and unknown purchase identity', async () => {
    const f = await fixture(),
      repo = createUsageLedgerRepository(db);
    for (const scope of [
      { ...f.scope, shopId: randomUUID() },
      { ...f.scope, installationGeneration: '2' },
    ]) {
      expect(await repo.get(scope, f.purchaseId)).toBeNull();
      await expect(repo.record(scope, { purchaseId: f.purchaseId, policy, history: f.history })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    }
    await expect(
      repo.record(
        { ...f.scope, installationGeneration: '0' },
        { purchaseId: f.purchaseId, policy, history: f.history },
      ),
    ).rejects.toMatchObject({ code: 'INVALID' });
    await expect(repo.record(f.scope, { purchaseId: randomUUID(), policy, history: f.history })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('guards terminal rewrite, identity mutation, deletion and populated rollback in PostgreSQL', async () => {
    const f = await fixture(),
      repo = createUsageLedgerRepository(db);
    await repo.record(f.scope, { purchaseId: f.purchaseId, policy, history: f.history });
    await expect(
      sql`UPDATE m9_order_usage SET qualification='UNRESOLVED',decision='{"kind":"UNRESOLVED","reason":"HISTORY_UNAVAILABLE","units":0}' WHERE purchase_id=${f.purchaseId}::uuid`.execute(
        db,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      sql`UPDATE m9_order_usage SET order_id='gid://shopify/Order/777' WHERE purchase_id=${f.purchaseId}::uuid`.execute(
        db,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      sql`DELETE FROM m9_order_usage WHERE purchase_id=${f.purchaseId}::uuid`.execute(db),
    ).rejects.toMatchObject({ code: '23514' });
    const down = readFileSync(
      new URL('../migrations/20261015000300_m9_usage_ledger.sql', import.meta.url),
      'utf8',
    ).split('-- migrate:down')[1];
    expect(down).toBeTruthy();
    await expect(db.transaction().execute((tx) => sql.raw(down ?? '').execute(tx))).rejects.toThrow(
      'persisted usage facts prevent rollback',
    );
    expect((await repo.get(f.scope, f.purchaseId))?.decision.kind).toBe('ELIGIBLE');
  });
  it('guards direct eligible SQL against test/unknown/unbound facts, wrong occurrence and nonfinancial JSON', async () => {
    for (const options of [{ test: true }, { bound: false }]) {
      const f = await fixture(options);
      const decision = {
        kind: 'ELIGIBLE',
        units: 1,
        ...f.scope,
        orderId: f.input.order.orderId,
        occurredAt,
        policy,
        cycleId: 'cycle-a',
      };
      await expect(
        sql`INSERT INTO m9_order_usage(purchase_id,shop_id,installation_generation,order_id,first_paid_at,qualification,decision,history_policy_hash)
        VALUES(${f.purchaseId}::uuid,${f.scope.shopId},${f.scope.installationGeneration}::bigint,${f.input.order.orderId},${options.bound === false ? null : new Date(occurredAt)},'ELIGIBLE',${JSON.stringify(decision)}::jsonb,${'a'.repeat(64)})`.execute(
          db,
        ),
      ).rejects.toMatchObject({ code: '23514' });
    }
    const f = await fixture(),
      repo = createUsageLedgerRepository(db);
    await repo.record(f.scope, { purchaseId: f.purchaseId, policy, history: unavailable });
    await expect(
      sql`UPDATE m9_order_usage SET first_paid_at='2026-10-15T12:01:00Z' WHERE purchase_id=${f.purchaseId}::uuid`.execute(
        db,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      sql`UPDATE m9_order_usage SET decision=decision||'{"design":{"private":"not financial"}}'::jsonb WHERE purchase_id=${f.purchaseId}::uuid`.execute(
        db,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps explicit event-time inactivity permanently unbillable after reactivation', async () => {
    const f = await fixture(),
      repo = createUsageLedgerRepository(db);
    const history: PaidOrderUsageHistory = {
      kind: 'TRUSTED',
      ...f.scope,
      windows: [{ kind: 'INACTIVE', startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z' }],
    };
    const first = await repo.record(f.scope, { purchaseId: f.purchaseId, policy, history });
    expect(first.decision).toMatchObject({ kind: 'UNBILLABLE_INACTIVE', units: 0, occurredAt });
    expect(await repo.record(f.scope, { purchaseId: f.purchaseId, policy, history: f.history })).toEqual(first);
  });

  it('retains an early terminal test exclusion when payment arrives later', async () => {
    const f = await fixture({ test: true, paid: false }),
      repo = createUsageLedgerRepository(db);
    const first = await repo.record(f.scope, { purchaseId: f.purchaseId, policy, history: unavailable });
    expect(first.firstPaidAt).toBeNull();
    expect(first.decision).toEqual({ kind: 'EXCLUDED', reason: 'TEST_ORDER', units: 0 });
    await createPurchaseRepository(db).reconcile({
      ...f.input,
      firstPaidAt: occurredAt,
      order: { ...f.input.order, financialStatus: 'PAID' },
    });
    expect(await repo.record(f.scope, { purchaseId: f.purchaseId, policy, history: f.history })).toEqual(first);
  });
});
