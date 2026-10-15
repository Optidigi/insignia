import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PurchaseObservation } from '@insignia/application';
import type { PaidOrderUsageHistory } from '@insignia/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPurchaseRepository } from '../src/repositories/purchase.js';
import {
  createUsageDeliveryIntentRepository,
  type UsageDeliveryPreparation,
} from '../src/repositories/usage-delivery-intent.js';
import { createUsageLedgerRepository } from '../src/repositories/usage-ledger.js';
import { openTestDatabase, openTestDurableCore } from './support/postgres.js';
import { purchaseFixture } from './support/purchase-fixture.js';

const policy = { id: 'qualified-paid-plan', version: 'v1' };
const migration = readFileSync(
  new URL('../migrations/20261015000400_m9_usage_delivery_intent.sql', import.meta.url),
  'utf8',
);

describe.runIf(Boolean(process.env.DATABASE_URL))('permanent local billing delivery intents', () => {
  let db: Awaited<ReturnType<typeof openTestDatabase>>;
  beforeAll(async () => {
    db = await openTestDatabase();
  });
  afterAll(async () => {
    await db?.destroy();
  });
  async function fixture(kind: 'ELIGIBLE' | 'TEST' | 'TRIAL' | 'INACTIVE' | 'UNRESOLVED' | 'UNPAID' = 'ELIGIBLE') {
    const f = await purchaseFixture(db);
    const at = (await sql<{ now: Date }>`SELECT clock_timestamp() AS now`.execute(db)).rows[0]?.now;
    if (!at) throw new Error('Expected database clock');
    const occurredAt = at.toISOString(),
      scope = { shopId: f.shopId, installationGeneration: f.generation };
    const lines = f.quote.economics.lines.map((line, index) => ({
      orderLineId: `gid://shopify/LineItem/${index + 1}`,
      lineIndex: index,
      productId: f.productId,
      variantId: line.variantId,
      quantity: 1,
      unitPriceMinor: line.unitPriceMinor,
    }));
    const observation: PurchaseObservation = {
      order: {
        ...scope,
        orderId: `gid://shopify/Order/${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`)}`,
        createdAt: occurredAt,
        updatedAt: occurredAt,
        observedAt: occurredAt,
        currency: 'USD',
        country: 'US',
        marketId: '42',
        totalPriceMinor: '2001',
        contextVerified: true,
        test: kind === 'TEST',
        sourceApiVersion: '2026-07',
        edited: false,
        complete: true,
        financialStatus: kind === 'UNPAID' ? 'PENDING' : 'PAID',
        cancelledAt: null,
        lines: lines.map((line) => ({
          lineId: line.orderLineId,
          productId: line.productId,
          variantId: line.variantId,
          quantity: 1,
          currentQuantity: 1,
          originalUnitPriceMinor: line.unitPriceMinor,
          sellingPlanId: null,
          attributes: [{ key: '_insignia_quote_v2', value: 'application-verified-at-repository-seam' }],
        })),
        transactions: [],
        refunds: [],
      },
      bindings: [
        {
          quoteId: f.quote.quoteId,
          authorizationSetId: f.authorization.setId,
          quote: f.quote as never,
          lines,
          designPayload: null,
          payloadCollectedAt: occurredAt,
          payloadExpiresAt: new Date(+at + 7 * 86400000).toISOString(),
        },
      ],
      exception: null,
      firstPaidAt: kind === 'UNPAID' ? null : occurredAt,
    };
    const purchase = await createPurchaseRepository(db).reconcile(observation);
    if (!purchase.purchaseId) throw new Error('Expected purchase');
    const interval = { startsAt: new Date(+at - 1000).toISOString(), endsAt: new Date(+at + 86400000).toISOString() };
    const history: PaidOrderUsageHistory =
      kind === 'UNRESOLVED'
        ? { kind: 'UNVERIFIED' }
        : {
            kind: 'TRUSTED',
            ...scope,
            windows: [
              kind === 'TRIAL'
                ? { kind: 'TRIAL', ...interval, policy, trial: interval }
                : kind === 'INACTIVE'
                  ? { kind: 'INACTIVE', ...interval }
                  : { kind: 'PAID', ...interval, policy, cycleId: 'original-cycle', cycle: interval },
            ],
          };
    await createUsageLedgerRepository(db).record(scope, { purchaseId: purchase.purchaseId, policy, history });
    const binding = {
      appId: 'gid://shopify/App/1234',
      providerShopId: `gid://shopify/Shop/${f.shopifyShopId}`,
      meterHandle: 'qualified-customized-order-paid',
      policy,
    };
    return { scope, purchaseId: purchase.purchaseId, orderId: observation.order.orderId, occurredAt, binding };
  }
  it('stages exactly one original unit with a database-generated opaque key and financial-only fields', async () => {
    const f = await fixture(),
      repo = createUsageDeliveryIntentRepository(db);
    const supplied = {
      purchaseId: f.purchaseId,
      binding: f.binding,
      units: 999,
      occurredAt: '2000-01-01T00:00:00.000Z',
      idempotencyKey: randomUUID(),
    };
    const result = await repo.prepare(f.scope, supplied);
    expect(result.kind).toBe('STAGED');
    if (result.kind !== 'STAGED') throw new Error('Expected staged intent');
    expect(result.intent).toMatchObject({
      ...f.scope,
      purchaseId: f.purchaseId,
      orderId: f.orderId,
      occurredAt: f.occurredAt,
      units: 1,
      policy,
      cycleId: 'original-cycle',
      ...f.binding,
    });
    expect(result.intent.idempotencyKey).not.toBe(supplied.idempotencyKey);
    expect(result.intent.idempotencyKey).toMatch(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
    expect(await repo.get(f.scope, f.purchaseId)).toEqual(result.intent);
    expect(Object.keys(result.intent).sort()).toEqual(
      [
        'appId',
        'createdAt',
        'cycleId',
        'idempotencyKey',
        'installationGeneration',
        'meterHandle',
        'occurredAt',
        'orderId',
        'policy',
        'providerShopId',
        'purchaseId',
        'shopId',
        'units',
      ].sort(),
    );
  });
  it('preserves one key across concurrent staging and a reopened pool', async () => {
    const f = await fixture(),
      core = openTestDurableCore();
    let first: UsageDeliveryPreparation | undefined;
    try {
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          core.usageDeliveryIntents.prepare(f.scope, { purchaseId: f.purchaseId, binding: f.binding }),
        ),
      );
      expect(results.every((result) => result.kind === 'STAGED')).toBe(true);
      first = results[0];
      expect(results.every((result) => JSON.stringify(result) === JSON.stringify(first))).toBe(true);
    } finally {
      await core.close();
    }
    const reopened = openTestDurableCore();
    try {
      expect(
        await reopened.usageDeliveryIntents.prepare(f.scope, { purchaseId: f.purchaseId, binding: f.binding }),
      ).toEqual(first);
    } finally {
      await reopened.close();
    }
    expect(
      (
        await sql<{
          count: string;
        }>`SELECT count(*)::text FROM m9_usage_delivery_intents WHERE purchase_id=${f.purchaseId}::uuid`.execute(db)
      ).rows[0]?.count,
    ).toBe('1');
  });
  it('retains the original installation identity after reinstall without authorizing current dispatch', async () => {
    const f = await fixture(),
      core = openTestDurableCore();
    try {
      const first = await core.usageDeliveryIntents.prepare(f.scope, { purchaseId: f.purchaseId, binding: f.binding });
      await core.transactions.run((tx) => core.tenants.startInstallation(tx, f.scope.shopId));
      expect(
        await core.usageDeliveryIntents.prepare(f.scope, { purchaseId: f.purchaseId, binding: f.binding }),
      ).toEqual(first);
      expect(await core.usageDeliveryIntents.get({ ...f.scope, installationGeneration: '2' }, f.purchaseId)).toBeNull();
    } finally {
      await core.close();
    }
  });
  it('does not stage tests, trial waivers, inactive, unresolved, unpaid or unbound purchases', async () => {
    const repo = createUsageDeliveryIntentRepository(db);
    for (const kind of ['TEST', 'TRIAL', 'INACTIVE', 'UNRESOLVED', 'UNPAID'] as const) {
      const f = await fixture(kind);
      expect(await repo.prepare(f.scope, { purchaseId: f.purchaseId, binding: f.binding })).toEqual({
        kind: 'NOT_ELIGIBLE',
      });
      expect(await repo.get(f.scope, f.purchaseId)).toBeNull();
    }
    const f = await fixture();
    expect(await repo.prepare(f.scope, { purchaseId: f.purchaseId, binding: null })).toEqual({ kind: 'UNBOUND' });
    expect(await repo.get(f.scope, f.purchaseId)).toBeNull();
  });
  it('rejects changed targets or policies, another scope, invalid identities and unknown purchases', async () => {
    const f = await fixture(),
      repo = createUsageDeliveryIntentRepository(db);
    await repo.prepare(f.scope, { purchaseId: f.purchaseId, binding: f.binding });
    for (const binding of [
      { ...f.binding, appId: 'gid://shopify/App/999' },
      { ...f.binding, providerShopId: 'gid://shopify/Shop/999' },
      { ...f.binding, meterHandle: 'changed' },
      { ...f.binding, policy: { ...policy, version: 'v2' } },
    ])
      await expect(repo.prepare(f.scope, { purchaseId: f.purchaseId, binding })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    await expect(
      repo.prepare({ ...f.scope, shopId: randomUUID() }, { purchaseId: f.purchaseId, binding: f.binding }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(repo.prepare(f.scope, { purchaseId: randomUUID(), binding: f.binding })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      repo.prepare(f.scope, { purchaseId: f.purchaseId, binding: { ...f.binding, meterHandle: 'bad\nvalue' } }),
    ).rejects.toMatchObject({ code: 'INVALID' });
  });
  it('guards immutable intent, source facts, original time, units and caller-chosen keys in SQL', async () => {
    const f = await fixture(),
      repo = createUsageDeliveryIntentRepository(db);
    const result = await repo.prepare(f.scope, { purchaseId: f.purchaseId, binding: f.binding });
    if (result.kind !== 'STAGED') throw new Error('Expected staged intent');
    for (const query of [
      sql`UPDATE m9_usage_delivery_intents SET idempotency_key=gen_random_uuid() WHERE purchase_id=${f.purchaseId}::uuid`,
      sql`UPDATE m9_usage_delivery_intents SET occurred_at=occurred_at+interval '1 second' WHERE purchase_id=${f.purchaseId}::uuid`,
      sql`DELETE FROM m9_usage_delivery_intents WHERE purchase_id=${f.purchaseId}::uuid`,
      sql`TRUNCATE m9_usage_delivery_intents`,
    ])
      await expect(query.execute(db)).rejects.toMatchObject({ code: '23514' });
    const source = await fixture('TEST');
    const insert = (
      target: typeof f,
      occurrence: string,
      units: number,
      key = randomUUID(),
    ) => sql`INSERT INTO m9_usage_delivery_intents
      (purchase_id,shop_id,installation_generation,order_id,occurred_at,units,policy_id,policy_version,cycle_id,app_id,provider_shop_id,meter_handle,idempotency_key)
      VALUES(${target.purchaseId}::uuid,${target.scope.shopId},${target.scope.installationGeneration}::bigint,${target.orderId},${new Date(occurrence)},${units},${policy.id},${policy.version},'original-cycle',${target.binding.appId},${target.binding.providerShopId},${target.binding.meterHandle},${key}::uuid)`;
    await expect(insert(source, source.occurredAt, 1).execute(db)).rejects.toMatchObject({ code: '23514' });
    const other = await fixture();
    await expect(
      insert(other, new Date(Date.parse(other.occurredAt) + 1000).toISOString(), 1).execute(db),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(insert(other, other.occurredAt, 2).execute(db)).rejects.toMatchObject({ code: '23514' });
    await expect(
      insert(
        { ...other, binding: { ...other.binding, providerShopId: 'gid://shopify/Shop/999' } },
        other.occurredAt,
        1,
      ).execute(db),
    ).rejects.toMatchObject({ code: '23514' });
    const callerKey = randomUUID();
    await insert(other, other.occurredAt, 1, callerKey).execute(db);
    expect((await repo.get(other.scope, other.purchaseId))?.idempotencyKey).not.toBe(callerKey);
  });
  it('permits empty rollback while refusing populated financial intent rollback', async () => {
    const suffix = randomUUID().replaceAll('-', '');
    const empty = migration.replaceAll('m9_usage_delivery_intents', `empty_usage_${suffix}`);
    await db.transaction().execute(async (tx) => {
      await sql.raw(empty.split('-- migrate:down')[0] ?? '').execute(tx);
      await sql.raw(empty.split('-- migrate:down')[1] ?? '').execute(tx);
    });
    const f = await fixture();
    await createUsageDeliveryIntentRepository(db).prepare(f.scope, { purchaseId: f.purchaseId, binding: f.binding });
    await expect(
      db.transaction().execute((tx) => sql.raw(migration.split('-- migrate:down')[1] ?? '').execute(tx)),
    ).rejects.toThrow('persisted usage delivery intents prevent rollback');
  });
});
