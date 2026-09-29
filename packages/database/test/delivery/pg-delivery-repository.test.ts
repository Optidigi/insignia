import { randomUUID } from 'node:crypto';
import { InboxPayloadConflictError, newOutboxEvent, processInbox, receiveInbox } from '@insignia/application';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { CONFIG_DRAFT_STORAGE_VERSION } from '../../src/repositories/config.js';
import { PgInboxRepository } from '../../src/repositories/delivery/pg-inbox-repository.js';
import { PgOutboxRepository } from '../../src/repositories/delivery/pg-outbox-repository.js';
import { PgTransactionRunner } from '../../src/repositories/delivery/pg-transaction-runner.js';
import { createTenantRepository } from '../../src/repositories/tenant.js';
import { createTestShop, openTestDatabase } from '../support/postgres.js';

function delivery(shopId: string, externalDeliveryId: string, body: string) {
  const receivedAt = new Date();
  return {
    source: 'synthetic.provider',
    externalDeliveryId,
    shopId,
    installationGeneration: null,
    payload: Buffer.from(body),
    receivedAt,
    retentionClass: 'test-transient',
    purgeAfter: new Date(receivedAt.getTime() + 60_000),
  };
}

function event(shopId: string, businessKey: string, installationGeneration: string | null = null) {
  const now = new Date();
  return newOutboxEvent({
    shopId,
    installationGeneration,
    eventType: 'synthetic.processed',
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

describe('durable inbox and outbox on PostgreSQL 18', () => {
  it('uses PostgreSQL 18', async () => {
    const database = await openTestDatabase();
    try {
      const result = await sql<{ server_version_num: string }>`show server_version_num`.execute(database);
      expect(Math.floor(Number(result.rows[0]?.server_version_num) / 10_000)).toBe(18);
    } finally {
      await database.destroy();
    }
  });

  it('retains out-of-order deliveries, deduplicates exact replay and processes each business fact once', async () => {
    const database = await openTestDatabase();
    try {
      const { shopId } = await createTestShop(database);
      const { shopId: otherShop } = await createTestShop(database);
      const inbox = new PgInboxRepository(database);
      const outbox = new PgOutboxRepository(database);
      const transactions = new PgTransactionRunner(database);
      const newer = delivery(shopId, randomUUID(), '{"sequence":2}');
      const older = delivery(shopId, randomUUID(), '{"sequence":1}');
      const receipt2 = await receiveInbox(inbox, newer);
      const receipt1 = await receiveInbox(inbox, older);
      expect(receipt2.kind).toBe('received');
      expect(receipt1.kind).toBe('received');
      expect(await receiveInbox(inbox, newer)).toEqual({ kind: 'duplicate', id: receipt2.id });
      await expect(receiveInbox(inbox, { ...newer, payload: Buffer.from('{"sequence":3}') })).rejects.toBeInstanceOf(
        InboxPayloadConflictError,
      );
      expect(
        await processInbox(transactions, inbox, otherShop, receipt1.id, async () => {
          throw new Error('cross-tenant processing');
        }),
      ).toBe('not_found');
      for (const receipt of [receipt1, receipt2]) {
        expect(
          await processInbox(transactions, inbox, shopId, receipt.id, async (transaction) => {
            await outbox.add(transaction, event(shopId, receipt.id));
          }),
        ).toBe('processed');
      }
      expect(
        await processInbox(transactions, inbox, shopId, receipt1.id, async () => {
          throw new Error('duplicate business mutation');
        }),
      ).toBe('already_processed');
      const claimed = await outbox.claim(shopId, new Date(), randomUUID(), new Date(Date.now() + 30_000), 10);
      expect(claimed.map((row) => row.aggregateRef).sort()).toEqual([receipt1.id, receipt2.id].sort());
      expect(await outbox.claim(otherShop, new Date(), randomUUID(), new Date(Date.now() + 30_000), 10)).toEqual([]);
    } finally {
      await database.destroy();
    }
  });

  it('deduplicates delivery IDs within an installation and fences old-generation processing', async () => {
    const database = await openTestDatabase();
    try {
      const { shopId, generation } = await createTestShop(database);
      const inbox = new PgInboxRepository(database);
      const transactions = new PgTransactionRunner(database);
      const original = { ...delivery(shopId, randomUUID(), '{}'), installationGeneration: generation };
      const first = await receiveInbox(inbox, original);
      expect(await receiveInbox(inbox, original)).toEqual({ kind: 'duplicate', id: first.id });
      const nextGeneration = await transactions.run((transaction) =>
        createTenantRepository(transaction).startInstallation(transaction, shopId),
      );
      const second = await receiveInbox(inbox, { ...original, installationGeneration: nextGeneration });
      expect(second.kind).toBe('received');
      expect(second.id).not.toBe(first.id);
      expect(await processInbox(transactions, inbox, shopId, first.id, async () => {})).toBe('not_found');
      expect(await processInbox(transactions, inbox, shopId, second.id, async () => {})).toBe('processed');
    } finally {
      await database.destroy();
    }
  });

  it('bounds raw and JSON payload size and retention at the durable boundary', async () => {
    const database = await openTestDatabase();
    try {
      const { shopId } = await createTestShop(database);
      const inbox = new PgInboxRepository(database);
      const outbox = new PgOutboxRepository(database);
      const transactions = new PgTransactionRunner(database);
      const base = delivery(shopId, randomUUID(), '{}');
      await expect(receiveInbox(inbox, { ...base, payload: Buffer.alloc(8 * 1024 * 1024 + 1) })).rejects.toThrow(
        'required metadata',
      );
      await expect(
        receiveInbox(inbox, { ...base, purgeAfter: new Date(base.receivedAt.getTime() + 181 * 24 * 60 * 60 * 1000) }),
      ).rejects.toThrow('required metadata');
      const receipt = await receiveInbox(inbox, base);
      await expect(
        sql`UPDATE inbox_messages SET purge_after = collected_at + interval '181 days' WHERE id = ${receipt.id}::uuid`.execute(
          database,
        ),
      ).rejects.toThrow();
      const oversized = { ...event(shopId, randomUUID()), payload: { text: 'x'.repeat(8 * 1024 * 1024 + 1) } };
      await expect(transactions.run((transaction) => outbox.add(transaction, oversized))).rejects.toThrow(
        'durable size limit',
      );
      const existing = event(shopId, randomUUID());
      await transactions.run((transaction) => outbox.add(transaction, existing));
      await expect(
        transactions.run((transaction) =>
          outbox.add(transaction, {
            ...existing,
            id: randomUUID(),
            purgeAfter: new Date(existing.occurredAt.getTime() + 1),
          }),
        ),
      ).rejects.toThrow('Outbox business key conflicts');
      await expect(
        sql`UPDATE outbox_events SET purge_after = collected_at + interval '181 days' WHERE id = ${existing.id}::uuid`.execute(
          database,
        ),
      ).rejects.toThrow();
    } finally {
      await database.destroy();
    }
  });

  it('rolls back business outbox and inbox completion together', async () => {
    const database = await openTestDatabase();
    try {
      const { shopId } = await createTestShop(database);
      const inbox = new PgInboxRepository(database);
      const outbox = new PgOutboxRepository(database);
      const transactions = new PgTransactionRunner(database);
      const receipt = await receiveInbox(inbox, delivery(shopId, randomUUID(), '{}'));
      await expect(
        processInbox(transactions, inbox, shopId, receipt.id, async (transaction) => {
          await outbox.add(transaction, event(shopId, receipt.id));
          throw new Error('synthetic crash');
        }),
      ).rejects.toThrow('synthetic crash');
      expect(await outbox.claim(shopId, new Date(), randomUUID(), new Date(Date.now() + 30_000), 10)).toEqual([]);
      expect(
        await processInbox(transactions, inbox, shopId, receipt.id, async (transaction) => {
          await outbox.add(transaction, event(shopId, receipt.id));
        }),
      ).toBe('processed');
      expect(await outbox.claim(shopId, new Date(), randomUUID(), new Date(Date.now() + 30_000), 10)).toHaveLength(1);
    } finally {
      await database.destroy();
    }
  });

  it('rejects outbox payloads that JSON serialization would silently alter', async () => {
    const database = await openTestDatabase();
    try {
      const { shopId } = await createTestShop(database);
      const outbox = new PgOutboxRepository(database);
      const transactions = new PgTransactionRunner(database);
      for (const payload of [{ amount: Number.NaN }, { omitted: undefined }, [undefined], { limit: Infinity }]) {
        const candidate = { ...event(shopId, randomUUID()), payload };
        await expect(transactions.run((transaction) => outbox.add(transaction, candidate))).rejects.toBeInstanceOf(
          TypeError,
        );
      }
      expect(await outbox.claim(shopId, new Date(), randomUUID(), new Date(Date.now() + 30_000), 10)).toEqual([]);
    } finally {
      await database.destroy();
    }
  });

  it('denies acknowledgement after the database lease deadline even before a new claim', async () => {
    const database = await openTestDatabase();
    try {
      const { shopId } = await createTestShop(database);
      const outbox = new PgOutboxRepository(database);
      const outboxEvent = event(shopId, randomUUID());
      await new PgTransactionRunner(database).run((transaction) => outbox.add(transaction, outboxEvent));
      const owner = randomUUID();
      const claimed = await outbox.claim(shopId, new Date(), owner, new Date(Date.now() + 30_000), 1);
      expect(claimed.map((row) => row.id)).toEqual([outboxEvent.id]);
      await sql`update outbox_events set lease_until = clock_timestamp() - interval '1 second' where id = ${outboxEvent.id}`.execute(
        database,
      );
      expect(await outbox.acknowledge(shopId, outboxEvent.id, owner, 1)).toBe('not_owned');
      const recovered = await outbox.claim(shopId, new Date(), randomUUID(), new Date(Date.now() + 30_000), 1);
      expect(recovered[0]?.attempts).toBe(2);
    } finally {
      await database.destroy();
    }
  });

  it('uses database time to decide whether an event is available', async () => {
    const database = await openTestDatabase();
    try {
      const { shopId } = await createTestShop(database);
      const outbox = new PgOutboxRepository(database);
      const candidate = { ...event(shopId, randomUUID()), availableAt: new Date(Date.now() + 60_000) };
      await new PgTransactionRunner(database).run((transaction) => outbox.add(transaction, candidate));
      const claimedFuture = new Date(Date.now() + 120_000);
      expect(
        await outbox.claim(shopId, claimedFuture, randomUUID(), new Date(claimedFuture.getTime() + 30_000), 1),
      ).toEqual([]);
      await sql`update outbox_events set available_at = clock_timestamp() - interval '1 second' where id = ${candidate.id}`.execute(
        database,
      );
      expect(
        (await outbox.claim(shopId, new Date(), randomUUID(), new Date(Date.now() + 30_000), 1)).map((row) => row.id),
      ).toEqual([candidate.id]);
    } finally {
      await database.destroy();
    }
  });

  it('fences installation-bound claims and acknowledgements after reinstall', async () => {
    const database = await openTestDatabase();
    try {
      const { shopId, generation } = await createTestShop(database);
      const outbox = new PgOutboxRepository(database);
      const transactions = new PgTransactionRunner(database);
      const oldEvent = event(shopId, randomUUID(), generation);
      await transactions.run((transaction) => outbox.add(transaction, oldEvent));
      const oldOwner = randomUUID();
      const oldClaim = await outbox.claim(shopId, new Date(), oldOwner, new Date(Date.now() + 30_000), 1);
      expect(oldClaim.map((row) => row.id)).toEqual([oldEvent.id]);
      expect(oldClaim[0]?.installationGeneration).toBe(generation);
      const nextGeneration = await transactions.run((transaction) =>
        createTenantRepository(transaction).startInstallation(transaction, shopId),
      );
      expect(nextGeneration).toBe('2');
      expect(await outbox.acknowledge(shopId, oldEvent.id, oldOwner, 1)).toBe('not_owned');
      const staleConfigId = randomUUID();
      await expect(
        transactions.run(async (transaction) => {
          await transaction
            .insertInto('product_configs')
            .values({
              shop_id: shopId,
              config_id: staleConfigId,
              external_product_id: staleConfigId,
              draft_schema_version: CONFIG_DRAFT_STORAGE_VERSION,
              draft_value: { label: 'must roll back' },
              effective_revision_id: null,
              effective_operation_id: null,
            })
            .execute();
          await outbox.add(transaction, event(shopId, randomUUID(), generation));
        }),
      ).rejects.toThrow('stale installation generation');
      expect(
        await database
          .selectFrom('product_configs')
          .select('config_id')
          .where('shop_id', '=', shopId)
          .where('config_id', '=', staleConfigId)
          .executeTakeFirst(),
      ).toBeUndefined();
      const independentEvent = event(shopId, randomUUID(), null);
      const newEvent = event(shopId, randomUUID(), nextGeneration);
      await transactions.run(async (transaction) => {
        await outbox.add(transaction, independentEvent);
        await outbox.add(transaction, newEvent);
      });
      const claimed = await outbox.claim(shopId, new Date(), randomUUID(), new Date(Date.now() + 30_000), 10);
      expect(claimed.map((row) => row.id).sort()).toEqual([independentEvent.id, newEvent.id].sort());
      expect(claimed.map((row) => row.installationGeneration).sort()).toEqual([null, nextGeneration].sort());
    } finally {
      await database.destroy();
    }
  });

  it('leases once across independent connections and recovers a committed event after lease expiry', async () => {
    const left = await openTestDatabase();
    const right = await openTestDatabase();
    try {
      const { shopId } = await createTestShop(left);
      const outboxLeft = new PgOutboxRepository(left);
      const outboxRight = new PgOutboxRepository(right);
      const outboxEvent = event(shopId, randomUUID());
      await new PgTransactionRunner(left).run((transaction) => outboxLeft.add(transaction, outboxEvent));
      const now = new Date();
      const firstLeaseUntil = new Date(now.getTime() + 30_000);
      const leftToken = randomUUID();
      const rightToken = randomUUID();
      const [leftClaim, rightClaim] = await Promise.all([
        outboxLeft.claim(shopId, now, leftToken, firstLeaseUntil, 1),
        outboxRight.claim(shopId, now, rightToken, firstLeaseUntil, 1),
      ]);
      expect(leftClaim.length + rightClaim.length).toBe(1);
      const firstToken = leftClaim.length ? leftToken : rightToken;
      const firstAttempt = (leftClaim[0] ?? rightClaim[0])?.attempts;
      expect(firstAttempt).toBe(1);
      // Reuse the same owner to prove the attempt itself fences a stale acknowledgement.
      const recoveryToken = firstToken;
      const fakeFuture = new Date(firstLeaseUntil.getTime() + 60_000);
      expect(
        await outboxRight.claim(shopId, fakeFuture, recoveryToken, new Date(fakeFuture.getTime() + 30_000), 1),
      ).toEqual([]);
      await sql`update outbox_events set lease_until = clock_timestamp() - interval '1 second' where id = ${outboxEvent.id}`.execute(
        left,
      );
      const recovered = await outboxRight.claim(shopId, new Date(), recoveryToken, new Date(Date.now() + 30_000), 1);
      expect(recovered.map((row) => row.id)).toEqual([outboxEvent.id]);
      expect(recovered[0]?.attempts).toBe(2);
      expect(await outboxLeft.acknowledge(shopId, outboxEvent.id, firstToken, 1)).toBe('not_owned');
      expect(await outboxRight.acknowledge(shopId, outboxEvent.id, recoveryToken, 2)).toBe('acknowledged');
      expect(await outboxRight.acknowledge(shopId, outboxEvent.id, recoveryToken, 2)).toBe('already_delivered');
      expect(await outboxLeft.claim(shopId, new Date(), randomUUID(), new Date(Date.now() + 30_000), 1)).toEqual([]);
    } finally {
      await Promise.all([left.destroy(), right.destroy()]);
    }
  });
});
