import type { PurchaseObservation } from '@insignia/application';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/client/database.js';
import { createPurchaseRepository } from '../src/repositories/purchase.js';
import { createTestShop, openTestDatabase } from './support/postgres.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('whole-dataset purchase list queries', () => {
  let db: Awaited<ReturnType<typeof openTestDatabase>>;
  beforeAll(async () => {
    db = await openTestDatabase();
  });
  afterAll(async () => {
    await db?.destroy();
  });
  it('searches all retained labels, applies date sorting/cursors before pagination, and keeps tenants separate', async () => {
    const tenant = await createTestShop(db),
      other = await createTestShop(db);
    const repo = createPurchaseRepository(db);
    const scope = { shopId: tenant.shopId, installationGeneration: tenant.generation, kind: 'merchant' as const };
    const created: string[] = [];
    const inputs: PurchaseObservation[] = [];
    for (const [day, name, orderId] of [
      ['01', '#1001', '880001'],
      ['03', '#1003', '880003'],
      ['02', '#1002', '880002'],
      ['04', '#Literal%_', '880004'],
    ]) {
      const date = `2026-11-${day}T10:00:00.000Z`;
      const observation: PurchaseObservation = {
        order: {
          shopId: tenant.shopId,
          installationGeneration: tenant.generation,
          // Stable IDs cannot accidentally match a label-search term. Tenant ownership remains independently generated.
          orderId: `gid://shopify/Order/${orderId}`,
          orderName: name,
          createdAt: date,
          updatedAt: date,
          observedAt: date,
          currency: 'USD',
          country: 'US',
          marketId: '42',
          contextVerified: true,
          totalPriceMinor: '0',
          test: false,
          edited: false,
          sourceApiVersion: '2026-07',
          complete: true,
          financialStatus: 'PENDING',
          cancelledAt: null,
          lines: [],
          transactions: [],
          refunds: [],
        },
        bindings: [],
        exception: 'AUTHORIZATION_INCOMPLETE',
        firstPaidAt: null,
      };
      inputs.push(observation);
      const result = await repo.reconcile(observation);
      if (!('purchaseId' in result)) throw new Error('Expected retained purchase');
      created.push(result.purchaseId);
    }
    const page = await repo.list(scope, { sort: 'date-asc', limit: 2 });
    expect(page.map((row) => row?.purchaseId)).toEqual([created[0], created[2]]);
    expect(
      (await repo.list(scope, { sort: 'date-asc', before: created[2], limit: 2 })).map((row) => row?.purchaseId),
    ).toEqual([created[1], created[3]]);
    expect((await repo.list(scope, { q: '1003', limit: 1 })).map((row) => row?.purchaseId)).toEqual([created[1]]);
    expect(
      (await repo.list(scope, { q: '880002', limit: 1 })).map((row) => row?.purchaseId),
      'Order-ID substring search remains supported independently of labels',
    ).toEqual([created[2]]);
    expect((await repo.list(scope, { q: '%_', limit: 20 })).map((row) => row?.purchaseId)).toEqual([created[3]]);
    expect(
      (
        await repo.list(scope, {
          createdFrom: '2026-11-02T00:00:00Z',
          createdBefore: '2026-11-03T00:00:00Z',
          limit: 20,
        })
      ).map((row) => row?.purchaseId),
    ).toEqual([created[2]]);
    expect(
      await repo.list(
        { shopId: other.shopId, installationGeneration: other.generation, kind: 'merchant' },
        { q: '1003' },
      ),
    ).toEqual([]);
    expect(await repo.missingOrderNames(scope)).toEqual([]);
    expect(await repo.list(scope, { artwork: 'complete' })).toEqual([]);
    expect((await repo.list(scope, { artwork: 'needed' })).length).toBe(4);
    const days = await repo.statistics(scope, 'Europe/Amsterdam', new Date('2026-11-05T12:00:00Z'));
    expect(days.reduce((sum, day) => sum + BigInt(day.orders), 0n)).toBe(4n);
    expect(days.every((day) => day.items === '0')).toBe(true);
    const original = inputs[0];
    if (!original) throw new Error('Expected first retained order');
    await repo.reconcile({
      ...original,
      order: {
        ...original.order,
        updatedAt: '2026-11-05T11:00:00Z',
        observedAt: '2026-11-05T11:01:00Z',
        cancelledAt: '2026-11-05T11:00:00Z',
      },
    });
    const afterCancellation = await repo.statistics(scope, 'Europe/Amsterdam', new Date('2026-11-05T12:00:00Z'));
    expect(afterCancellation.reduce((sum, day) => sum + BigInt(day.orders), 0n)).toBe(3n);
    const firstPage = await repo.listPage(scope, { sort: 'date-asc', before: null, limit: 2 });
    expect(firstPage.purchases.map((row) => row.purchaseId)).toEqual([created[0], created[2]]);
    expect(firstPage.nextCursor).toBe(created[2]);
    expect(firstPage.purchases[0]?.observations).toMatchObject([{ cancelledAt: '2026-11-05T11:00:00.000Z' }]);
    expect((await repo.get(scope, firstPage.purchases[0]!.purchaseId))?.observations).toHaveLength(2);
    const lastPage = await repo.listPage(scope, { sort: 'date-asc', before: firstPage.nextCursor, limit: 2 });
    expect(lastPage.purchases.map((row) => row.purchaseId)).toEqual([created[1], created[3]]);
    expect(lastPage.nextCursor).toBeNull();
    const statements: (readonly unknown[])[] = [];
    const measured = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) }),
      log(event) {
        if (event.level === 'query') statements.push(event.query.parameters);
      },
    });
    try {
      const measuredRepo = createPurchaseRepository(measured);
      const small = await measuredRepo.listPage(scope, { sort: 'date-asc', before: null, limit: 1 });
      const smallCost = statements.length;
      expect(small.purchases).toHaveLength(1);
      expect(statements.flat(2)).not.toContain(created[2]);
      statements.length = 0;
      const large = await measuredRepo.listPage(scope, { sort: 'date-asc', before: null, limit: 3 });
      expect(large.purchases).toHaveLength(3);
      expect(statements.flat(2)).not.toContain(created[3]);
      expect(statements.length).toBeLessThanOrEqual(smallCost);
    } finally {
      await measured.destroy();
    }
    // Owner decision, 18 November 2026: test orders count on Home; cancelled orders still do not.
    const test = inputs[1];
    if (!test) throw new Error('Expected second retained order');
    await repo.reconcile({
      ...test,
      order: { ...test.order, orderId: 'gid://shopify/Order/880005', orderName: '#1005', test: true },
    });
    const withTest = await repo.statistics(scope, 'Europe/Amsterdam', new Date('2026-11-05T12:00:00Z'));
    expect(withTest.reduce((sum, day) => sum + BigInt(day.orders), 0n)).toBe(4n);
  });
});
