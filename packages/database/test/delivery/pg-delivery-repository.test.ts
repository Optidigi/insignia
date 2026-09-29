import { randomUUID } from 'node:crypto';
import { InboxPayloadConflictError, newOutboxEvent, processInbox, receiveInbox } from '@insignia/application';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { PgInboxRepository } from '../../src/repositories/delivery/pg-inbox-repository.js';
import { PgOutboxRepository } from '../../src/repositories/delivery/pg-outbox-repository.js';
import { PgTransactionRunner } from '../../src/repositories/delivery/pg-transaction-runner.js';
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

function event(shopId: string, businessKey: string) {
  const now = new Date();
  return newOutboxEvent({
    shopId,
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
      const firstLeaseUntil = new Date(now.getTime() + 1_000);
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
      const recoveryTime = new Date(firstLeaseUntil.getTime() + 1);
      const recovered = await outboxRight.claim(
        shopId,
        recoveryTime,
        recoveryToken,
        new Date(recoveryTime.getTime() + 30_000),
        1,
      );
      expect(recovered.map((row) => row.id)).toEqual([outboxEvent.id]);
      expect(recovered[0]?.attempts).toBe(2);
      expect(await outboxLeft.acknowledge(shopId, outboxEvent.id, firstToken, 1)).toBe('not_owned');
      expect(await outboxRight.acknowledge(shopId, outboxEvent.id, recoveryToken, 2)).toBe('acknowledged');
      expect(await outboxRight.acknowledge(shopId, outboxEvent.id, recoveryToken, 2)).toBe('already_delivered');
      expect(
        await outboxLeft.claim(shopId, recoveryTime, randomUUID(), new Date(recoveryTime.getTime() + 30_000), 1),
      ).toEqual([]);
    } finally {
      await Promise.all([left.destroy(), right.destroy()]);
    }
  });
});
