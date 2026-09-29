import { randomUUID } from 'node:crypto';
import {
  CommandDigestConflictError,
  executeCommand,
  executeCommandWithOutbox,
  newOutboxEvent,
} from '@insignia/application';
import { describe, expect, it } from 'vitest';
import { PgCommandRepository } from '../../src/repositories/command/pg-command-repository.js';
import { PgOutboxRepository } from '../../src/repositories/delivery/pg-outbox-repository.js';
import { PgTransactionRunner } from '../../src/repositories/delivery/pg-transaction-runner.js';
import { createTestShop, openTestDatabase } from '../support/postgres.js';

const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);

function event(shopId: string, businessKey: string) {
  const now = new Date();
  return newOutboxEvent({
    shopId,
    eventType: 'synthetic.business-committed',
    schemaVersion: 1,
    aggregateRef: businessKey,
    payload: { businessKey },
    businessKey,
    occurredAt: now,
    availableAt: now,
    retentionClass: 'test-transient',
    purgeAfter: new Date(now.getTime() + 60_000),
  });
}

describe('durable commands on PostgreSQL 18', () => {
  it('replays a completed result, rejects digest reuse, and scopes keys to shops', async () => {
    const database = await openTestDatabase();
    try {
      const { shopId: shopA } = await createTestShop(database);
      const { shopId: shopB } = await createTestShop(database);
      const commands = new PgCommandRepository();
      const transactions = new PgTransactionRunner(database);
      const outbox = new PgOutboxRepository(database);
      const key = randomUUID();
      const identity = { shopId: shopA, namespace: 'test.create', key, requestDigest: digestA };
      const first = await executeCommandWithOutbox(transactions, commands, outbox, identity, async () => {
        const outboxEvent = event(shopA, key);
        return { resultRef: outboxEvent.id, event: outboxEvent };
      });
      const repeated = await executeCommand(transactions, commands, identity, async () => {
        throw new Error('duplicate command executed business mutation');
      });
      expect(first.kind).toBe('executed');
      expect(repeated).toEqual({ kind: 'replayed', resultRef: first.resultRef });
      await expect(
        executeCommand(transactions, commands, { ...identity, requestDigest: digestB }, async () => 'unexpected'),
      ).rejects.toBeInstanceOf(CommandDigestConflictError);
      const otherShop = await executeCommand(
        transactions,
        commands,
        { ...identity, shopId: shopB },
        async () => 'shop-b-result',
      );
      expect(otherShop).toEqual({ kind: 'executed', resultRef: 'shop-b-result' });
      const claimed = await outbox.claim(shopA, new Date(), randomUUID(), new Date(Date.now() + 30_000), 10);
      expect(claimed.map((item) => item.id)).toEqual([first.resultRef]);
      expect(await outbox.claim(shopB, new Date(), randomUUID(), new Date(Date.now() + 30_000), 10)).toEqual([]);
    } finally {
      await database.destroy();
    }
  });

  it('commits only one mutation for simultaneous duplicate commands on independent connections', async () => {
    const left = await openTestDatabase();
    const right = await openTestDatabase();
    try {
      const { shopId } = await createTestShop(left);
      const identity = { shopId, namespace: 'test.race', key: randomUUID(), requestDigest: digestA };
      let executed = 0;
      const attempt = (database: typeof left) =>
        executeCommandWithOutbox(
          new PgTransactionRunner(database),
          new PgCommandRepository(),
          new PgOutboxRepository(database),
          identity,
          async () => {
            executed += 1;
            const outboxEvent = event(shopId, identity.key);
            return { resultRef: outboxEvent.id, event: outboxEvent };
          },
        );
      const results = await Promise.all([attempt(left), attempt(right)]);
      expect(results.map((result) => result.kind).sort()).toEqual(['executed', 'replayed']);
      expect(results[0]?.resultRef).toBe(results[1]?.resultRef);
      expect(executed).toBe(1);
      const claimed = await new PgOutboxRepository(left).claim(
        shopId,
        new Date(),
        randomUUID(),
        new Date(Date.now() + 30_000),
        10,
      );
      expect(claimed).toHaveLength(1);
    } finally {
      await Promise.all([left.destroy(), right.destroy()]);
    }
  });

  it('rolls back the command result and outbox together so the same key can retry', async () => {
    const database = await openTestDatabase();
    try {
      const { shopId } = await createTestShop(database);
      const commands = new PgCommandRepository();
      const outbox = new PgOutboxRepository(database);
      const transactions = new PgTransactionRunner(database);
      const identity = { shopId, namespace: 'test.rollback', key: randomUUID(), requestDigest: digestA };
      await expect(
        executeCommand(transactions, commands, identity, async (transaction) => {
          await transaction
            .insertInto('product_configs')
            .values({
              shop_id: shopId,
              config_id: identity.key,
              external_product_id: identity.key,
              draft_schema_version: 'synthetic-test',
              draft_value: { label: 'rollback probe' },
              effective_revision_id: null,
              effective_operation_id: null,
            })
            .execute();
          await outbox.add(transaction, event(shopId, identity.key));
          throw new Error('synthetic failure before commit');
        }),
      ).rejects.toThrow('synthetic failure before commit');
      expect(
        await database
          .selectFrom('product_configs')
          .select('config_id')
          .where('shop_id', '=', shopId)
          .where('config_id', '=', identity.key)
          .executeTakeFirst(),
      ).toBeUndefined();
      expect(await outbox.claim(shopId, new Date(), randomUUID(), new Date(Date.now() + 30_000), 10)).toEqual([]);
      const retried = await executeCommandWithOutbox(transactions, commands, outbox, identity, async (transaction) => {
        await transaction
          .insertInto('product_configs')
          .values({
            shop_id: shopId,
            config_id: identity.key,
            external_product_id: identity.key,
            draft_schema_version: 'synthetic-test',
            draft_value: { label: 'committed probe' },
            effective_revision_id: null,
            effective_operation_id: null,
          })
          .execute();
        const outboxEvent = event(shopId, identity.key);
        return { resultRef: outboxEvent.id, event: outboxEvent };
      });
      expect(retried.kind).toBe('executed');
      expect(
        await database
          .selectFrom('product_configs')
          .select('config_id')
          .where('shop_id', '=', shopId)
          .where('config_id', '=', identity.key)
          .executeTakeFirst(),
      ).toEqual({ config_id: identity.key });
      expect(
        (await outbox.claim(shopId, new Date(), randomUUID(), new Date(Date.now() + 30_000), 10)).map((row) => row.id),
      ).toEqual([retried.resultRef]);
    } finally {
      await database.destroy();
    }
  });
});
