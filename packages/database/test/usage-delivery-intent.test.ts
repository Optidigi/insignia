import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PurchaseObservation } from '@insignia/application';
import type { PaidOrderUsageHistory } from '@insignia/domain';
import { formatShopifyUsageEvent, parseShopifyUsageEventResponse } from '@insignia/shopify';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPurchaseRepository } from '../src/repositories/purchase.js';
import { createUsageDeliveryAttemptRepository } from '../src/repositories/usage-delivery-attempt.js';
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
      sql`TRUNCATE m9_usage_delivery_intents,m9_usage_delivery_attempts`,
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
  async function attemptFixture() {
    const f = await fixture();
    const prepared = await createUsageDeliveryIntentRepository(db).prepare(f.scope, {
      purchaseId: f.purchaseId,
      binding: f.binding,
    });
    if (prepared.kind !== 'STAGED') throw new Error('Expected intent');
    return { ...f, intent: prepared.intent, bodySha256: 'a'.repeat(64) };
  }
  it('preserves formatted financial bytes and synthetic transport receipt across a reopened pool', async () => {
    const f = await attemptFixture(),
      request = formatShopifyUsageEvent(f.intent),
      input = { purchaseId: f.purchaseId, bodySha256: request.bodySha256 },
      core = openTestDurableCore();
    let settled: Awaited<ReturnType<typeof core.usageDeliveryAttempts.get>> = null;
    try {
      const started = await core.usageDeliveryAttempts.begin(f.scope, input);
      expect(started.kind).toBe('STARTED');
      expect(started.attempt.bodySha256).toBe(request.bodySha256);
      // Synthetic response fixture only: no HTTP request or historical provider capture.
      const outcome = parseShopifyUsageEventResponse({
        url: request.url,
        redirected: false,
        status: 202,
        body: JSON.stringify({ success: true }),
      });
      expect(outcome).toEqual({ kind: 'RECEIPT', httpStatus: 202 });
      settled = await core.usageDeliveryAttempts.recordOutcome(f.scope, {
        purchaseId: f.purchaseId,
        attemptId: started.attempt.attemptId,
        outcome,
      });
      expect(settled.status).toEqual({ state: 'TRANSPORT_ACCEPTED', reason: 'RECEIVED', httpStatus: 202 });
    } finally {
      await core.close();
    }
    const reopened = openTestDurableCore();
    try {
      const intent = await reopened.usageDeliveryIntents.get(f.scope, f.purchaseId);
      expect(intent).toEqual(f.intent);
      if (!intent) throw new Error('Expected permanent intent');
      expect(formatShopifyUsageEvent(intent)).toEqual(request);
      expect(JSON.parse(request.body)).toMatchObject({
        idempotency_key: f.intent.idempotencyKey,
        timestamp: f.intent.occurredAt,
      });
      expect(await reopened.usageDeliveryAttempts.get(f.scope, f.purchaseId)).toEqual(settled);
      expect(await reopened.usageDeliveryAttempts.begin(f.scope, input)).toEqual({ kind: 'HELD', attempt: settled });
    } finally {
      await reopened.close();
    }
  });
  it('persists an unsettled dispatch fence across reopened pools and concurrent begin', async () => {
    const f = await attemptFixture(),
      core = openTestDurableCore();
    let first: Awaited<ReturnType<typeof core.usageDeliveryAttempts.get>> = null;
    try {
      const results = await Promise.all(Array.from({ length: 4 }, () => core.usageDeliveryAttempts.begin(f.scope, f)));
      expect(results.filter((r) => r.kind === 'STARTED')).toHaveLength(1);
      first = results[0]?.attempt ?? null;
      expect(results.every((r) => r.attempt.attemptId === first?.attemptId)).toBe(true);
      expect(first).toMatchObject({
        ordinal: 1,
        outcome: null,
        settledAt: null,
        status: { state: 'RECONCILIATION_REQUIRED', reason: 'OUTCOME_UNRECORDED' },
      });
    } finally {
      await core.close();
    }
    const reopened = openTestDurableCore();
    try {
      expect(await reopened.usageDeliveryAttempts.begin(f.scope, f)).toEqual({ kind: 'HELD', attempt: first });
      expect(await reopened.usageDeliveryAttempts.list(f.scope, f.purchaseId)).toEqual([first]);
    } finally {
      await reopened.close();
    }
  });
  it('only definite non-dispatch allows another same-body attempt without rekeying or losing history', async () => {
    const f = await attemptFixture(),
      repo = createUsageDeliveryAttemptRepository(db),
      first = await repo.begin(f.scope, f);
    await repo.recordOutcome(f.scope, {
      purchaseId: f.purchaseId,
      attemptId: first.attempt.attemptId,
      outcome: { kind: 'NOT_DISPATCHED' },
    });
    const second = await repo.begin(f.scope, f);
    expect(second.kind).toBe('STARTED');
    if (second.kind !== 'STARTED') throw new Error('Expected started');
    expect(second.intent).toEqual(f.intent);
    expect(second.attempt.ordinal).toBe(2);
    expect(second.attempt.attemptId).not.toBe(first.attempt.attemptId);
    expect((await repo.list(f.scope, f.purchaseId)).map((a) => a.outcome?.kind ?? null)).toEqual([
      'NOT_DISPATCHED',
      null,
    ]);
    await expect(repo.begin(f.scope, { ...f, bodySha256: 'b'.repeat(64) })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(
      await repo.recordOutcome(f.scope, {
        purchaseId: f.purchaseId,
        attemptId: first.attempt.attemptId,
        outcome: { kind: 'NOT_DISPATCHED' },
      }),
    ).toMatchObject({ ordinal: 1 });
    await expect(
      repo.recordOutcome(f.scope, {
        purchaseId: f.purchaseId,
        attemptId: first.attempt.attemptId,
        outcome: { kind: 'UNKNOWN' },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('holds unknown, rejected, processing and unverified HTTP responses; validated202 is receipt only', async () => {
    for (const outcome of [
      { kind: 'UNKNOWN' } as const,
      { kind: 'HTTP', httpStatus: 400 } as const,
      { kind: 'HTTP', httpStatus: 409 } as const,
      { kind: 'HTTP', httpStatus: 202 } as const,
      { kind: 'RECEIPT', httpStatus: 202 } as const,
    ]) {
      const f = await attemptFixture(),
        repo = createUsageDeliveryAttemptRepository(db),
        started = await repo.begin(f.scope, f);
      const input = { purchaseId: f.purchaseId, attemptId: started.attempt.attemptId, outcome };
      const settled = await repo.recordOutcome(f.scope, input);
      expect(settled.outcome).toEqual(outcome);
      expect(settled.settledAt).toBeTruthy();
      expect(settled.status.state).toBe(outcome.kind === 'RECEIPT' ? 'TRANSPORT_ACCEPTED' : 'RECONCILIATION_REQUIRED');
      expect(await repo.recordOutcome(f.scope, input)).toEqual(settled);
      expect(await repo.begin(f.scope, f)).toEqual({ kind: 'HELD', attempt: settled });
      await expect(
        repo.recordOutcome(f.scope, { ...input, outcome: { kind: 'NOT_DISPATCHED' } }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    }
  });
  it('fences foreign financial scope and rejects invalid outcome shape or body before settlement', async () => {
    const f = await attemptFixture(),
      repo = createUsageDeliveryAttemptRepository(db),
      started = await repo.begin(f.scope, f),
      foreign = { ...f.scope, installationGeneration: '2' };
    expect(await repo.get(foreign, f.purchaseId)).toBeNull();
    expect(await repo.list(foreign, f.purchaseId)).toEqual([]);
    await expect(repo.begin(foreign, f)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      repo.recordOutcome(foreign, {
        purchaseId: f.purchaseId,
        attemptId: started.attempt.attemptId,
        outcome: { kind: 'UNKNOWN' },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(repo.begin(f.scope, { ...f, bodySha256: 'A'.repeat(64) })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(
      repo.recordOutcome(f.scope, {
        purchaseId: f.purchaseId,
        attemptId: started.attempt.attemptId,
        outcome: { kind: 'HTTP', httpStatus: 202, secret: 'forbidden' } as never,
      }),
    ).rejects.toMatchObject({ code: 'INVALID' });
    expect((await repo.get(f.scope, f.purchaseId))?.outcome).toBeNull();
  });
  it('independently guards SQL attempt identity, body, unsettled fence, bounded outcome and populated rollback', async () => {
    const f = await attemptFixture(),
      repo = createUsageDeliveryAttemptRepository(db),
      callerId = randomUUID();
    await sql`INSERT INTO m9_usage_delivery_attempts(purchase_id,body_sha256,attempt_id,ordinal,created_at)
      VALUES(${f.purchaseId}::uuid,${f.bodySha256},${callerId}::uuid,999,'2000-01-01')`.execute(db);
    const first = await repo.get(f.scope, f.purchaseId);
    expect(first?.attemptId).not.toBe(callerId);
    expect(first?.ordinal).toBe(1);
    for (const q of [
      sql`INSERT INTO m9_usage_delivery_attempts(purchase_id,body_sha256) VALUES(${f.purchaseId}::uuid,${f.bodySha256})`,
      sql`UPDATE m9_usage_delivery_attempts SET body_sha256=${'b'.repeat(64)} WHERE purchase_id=${f.purchaseId}::uuid`,
      sql`UPDATE m9_usage_delivery_attempts SET ordinal=2 WHERE purchase_id=${f.purchaseId}::uuid`,
      sql`UPDATE m9_usage_delivery_attempts SET created_at='2000-01-01' WHERE purchase_id=${f.purchaseId}::uuid`,
      sql`UPDATE m9_usage_delivery_attempts SET outcome='{"kind":null}' WHERE purchase_id=${f.purchaseId}::uuid`,
      sql`UPDATE m9_usage_delivery_attempts SET outcome='{"kind":"HTTP","httpStatus":202,"extra":"forbidden"}' WHERE purchase_id=${f.purchaseId}::uuid`,
      sql`DELETE FROM m9_usage_delivery_attempts WHERE purchase_id=${f.purchaseId}::uuid`,
      sql`TRUNCATE m9_usage_delivery_attempts`,
    ])
      await expect(q.execute(db)).rejects.toMatchObject({ code: '23514' });
    if (!first) throw new Error('Expected attempt');
    await repo.recordOutcome(f.scope, {
      purchaseId: f.purchaseId,
      attemptId: first.attemptId,
      outcome: { kind: 'NOT_DISPATCHED' },
    });
    await expect(
      sql`INSERT INTO m9_usage_delivery_attempts(purchase_id,body_sha256) VALUES(${f.purchaseId}::uuid,${'b'.repeat(64)})`.execute(
        db,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      sql`UPDATE m9_usage_delivery_attempts SET outcome='{"kind":"UNKNOWN"}' WHERE purchase_id=${f.purchaseId}::uuid`.execute(
        db,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const attemptMigration = readFileSync(
      new URL('../migrations/20261015000500_m9_usage_delivery_attempt.sql', import.meta.url),
      'utf8',
    );
    const empty = attemptMigration.replaceAll(
      'm9_usage_delivery_attempts',
      `empty_attempt_${randomUUID().replaceAll('-', '')}`,
    );
    await db.transaction().execute(async (tx) => {
      await sql.raw(empty.split('-- migrate:down')[0] ?? '').execute(tx);
      await sql.raw(empty.split('-- migrate:down')[1] ?? '').execute(tx);
    });
    await expect(
      db.transaction().execute((tx) => sql.raw(attemptMigration.split('-- migrate:down')[1] ?? '').execute(tx)),
    ).rejects.toThrow('persisted usage delivery attempts prevent rollback');
  });
});
