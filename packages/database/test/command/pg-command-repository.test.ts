import { randomUUID } from 'node:crypto';
import {
  CommandDigestConflictError,
  CommandOutboxTenantMismatchError,
  executeCommand,
  executeCommandWithOutbox,
  newOutboxEvent,
} from '@insignia/application';
import { describe, expect, it } from 'vitest';
import { CONFIG_DRAFT_STORAGE_VERSION } from '../../src/repositories/config.js';
import { createTestShop, openTestDatabase, openTestDurableCore } from '../support/postgres.js';

const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);

function event(shopId: string, businessKey: string) {
  const now = new Date();
  return newOutboxEvent({
    shopId,
    installationGeneration: null,
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
  it('keeps public transaction handles scoped to their core and lifetime', async () => {
    const core = openTestDurableCore();
    const other = openTestDurableCore();
    const shopId = randomUUID();
    const configId = randomUUID();
    let escaped: Parameters<typeof core.configs.createConfig>[0] | undefined;
    try {
      await core.transactions.run(async (transaction) => {
        escaped = transaction;
        await core.tenants.createShop(transaction, { shopId, shopDomain: `${shopId}.test.example` });
        await expect(
          other.configs.createConfig(transaction, {
            shopId,
            configId,
            externalProductId: configId,
            draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
            draftValue: { label: 'wrong core' },
          }),
        ).rejects.toThrow('invalid or expired');
        await core.configs.createConfig(transaction, {
          shopId,
          configId,
          externalProductId: configId,
          draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
          draftValue: { label: 'scoped' },
        });
        expect((await core.configs.getConfigInTransaction(transaction, shopId, configId))?.draftValue).toEqual({
          label: 'scoped',
        });
      });
      expect((await core.tenants.getShop(shopId))?.currentGeneration).toBe('1');
      expect((await core.configs.getConfig(shopId, configId))?.draftValue).toEqual({ label: 'scoped' });
      expect(await core.configs.getConfig(randomUUID(), configId)).toBeNull();
      if (!escaped) throw new Error('transaction handle was not captured');
      await expect(
        core.configs.createConfig(escaped, {
          shopId,
          configId: randomUUID(),
          externalProductId: randomUUID(),
          draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
          draftValue: {},
        }),
      ).rejects.toThrow('invalid or expired');
    } finally {
      await Promise.all([core.close(), other.close()]);
    }
  });

  it('rolls back a draft CAS and outbox insertion when a command fails', async () => {
    const database = await openTestDatabase();
    const core = openTestDurableCore();
    try {
      const { shopId } = await createTestShop(database);
      const configId = randomUUID();
      await core.transactions.run((transaction) =>
        core.configs.createConfig(transaction, {
          shopId,
          configId,
          externalProductId: configId,
          draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
          draftValue: { label: 'original' },
        }),
      );
      const identity = { shopId, namespace: 'test.draft-rollback', key: randomUUID(), requestDigest: digestA };
      await expect(
        executeCommand(core.transactions, core.commands, identity, async (transaction) => {
          const result = await core.configs.updateDraft(transaction, {
            shopId,
            configId,
            expectedVersion: '1',
            schemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
            draftValue: { label: 'uncommitted' },
          });
          expect(result.kind).toBe('updated');
          expect((await core.configs.getConfigInTransaction(transaction, shopId, configId))?.draftVersion).toBe('2');
          await core.outbox.add(transaction, event(shopId, identity.key));
          throw new Error('synthetic command failure');
        }),
      ).rejects.toThrow('synthetic command failure');
      expect((await core.configs.getConfig(shopId, configId))?.draftValue).toEqual({ label: 'original' });
      expect((await core.configs.getConfig(shopId, configId))?.draftVersion).toBe('1');
      expect(await core.outbox.claim(shopId, new Date(), randomUUID(), new Date(Date.now() + 30_000), 1)).toEqual([]);
    } finally {
      await Promise.all([core.close(), database.destroy()]);
    }
  });

  it('replays a completed result, rejects digest reuse, and scopes keys to shops', async () => {
    const database = await openTestDatabase();
    const core = openTestDurableCore();
    try {
      const { shopId: shopA } = await createTestShop(database);
      const { shopId: shopB } = await createTestShop(database);
      const { commands, transactions, outbox } = core;
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
      await Promise.all([core.close(), database.destroy()]);
    }
  });

  it('commits only one mutation for simultaneous duplicate commands on independent connections', async () => {
    const left = await openTestDatabase();
    const right = await openTestDatabase();
    const leftCore = openTestDurableCore();
    const rightCore = openTestDurableCore();
    try {
      const { shopId } = await createTestShop(left);
      const identity = { shopId, namespace: 'test.race', key: randomUUID(), requestDigest: digestA };
      let executed = 0;
      const attempt = (core: typeof leftCore) =>
        executeCommandWithOutbox(core.transactions, core.commands, core.outbox, identity, async () => {
          executed += 1;
          const outboxEvent = event(shopId, identity.key);
          return { resultRef: outboxEvent.id, event: outboxEvent };
        });
      const results = await Promise.all([attempt(leftCore), attempt(rightCore)]);
      expect(results.map((result) => result.kind).sort()).toEqual(['executed', 'replayed']);
      expect(results[0]?.resultRef).toBe(results[1]?.resultRef);
      expect(executed).toBe(1);
      const claimed = await leftCore.outbox.claim(shopId, new Date(), randomUUID(), new Date(Date.now() + 30_000), 10);
      expect(claimed).toHaveLength(1);
    } finally {
      await Promise.all([leftCore.close(), rightCore.close(), left.destroy(), right.destroy()]);
    }
  });

  it('rolls back the command result and outbox together so the same key can retry', async () => {
    const database = await openTestDatabase();
    const core = openTestDurableCore();
    try {
      const { shopId } = await createTestShop(database);
      const { commands, outbox, transactions, configs } = core;
      const identity = { shopId, namespace: 'test.rollback', key: randomUUID(), requestDigest: digestA };
      await expect(
        executeCommand(transactions, commands, identity, async (transaction) => {
          await configs.createConfig(transaction, {
            shopId,
            configId: identity.key,
            externalProductId: identity.key,
            draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
            draftValue: { label: 'rollback probe' },
          });
          await outbox.add(transaction, event(shopId, identity.key));
          throw new Error('synthetic failure before commit');
        }),
      ).rejects.toThrow('synthetic failure before commit');
      expect(await configs.getConfig(shopId, identity.key)).toBeNull();
      expect(await outbox.claim(shopId, new Date(), randomUUID(), new Date(Date.now() + 30_000), 10)).toEqual([]);
      const retried = await executeCommandWithOutbox(transactions, commands, outbox, identity, async (transaction) => {
        await configs.createConfig(transaction, {
          shopId,
          configId: identity.key,
          externalProductId: identity.key,
          draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
          draftValue: { label: 'committed probe' },
        });
        const outboxEvent = event(shopId, identity.key);
        return { resultRef: outboxEvent.id, event: outboxEvent };
      });
      expect(retried.kind).toBe('executed');
      expect((await configs.getConfig(shopId, identity.key))?.configId).toBe(identity.key);
      expect(
        (await outbox.claim(shopId, new Date(), randomUUID(), new Date(Date.now() + 30_000), 10)).map((row) => row.id),
      ).toEqual([retried.resultRef]);
    } finally {
      await Promise.all([core.close(), database.destroy()]);
    }
  });

  it('rolls back a business mutation when its required outbox event names another shop', async () => {
    const database = await openTestDatabase();
    const core = openTestDurableCore();
    try {
      const { shopId: shopA } = await createTestShop(database);
      const { shopId: shopB } = await createTestShop(database);
      const { transactions, commands, outbox, configs } = core;
      const identity = { shopId: shopA, namespace: 'test.tenant-outbox', key: randomUUID(), requestDigest: digestA };
      await expect(
        executeCommandWithOutbox(transactions, commands, outbox, identity, async (transaction) => {
          await configs.createConfig(transaction, {
            shopId: shopA,
            configId: identity.key,
            externalProductId: identity.key,
            draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
            draftValue: { label: 'must roll back' },
          });
          const wrongShopEvent = event(shopB, identity.key);
          return { resultRef: wrongShopEvent.id, event: wrongShopEvent };
        }),
      ).rejects.toBeInstanceOf(CommandOutboxTenantMismatchError);
      expect(await configs.getConfig(shopA, identity.key)).toBeNull();
      expect(await outbox.claim(shopB, new Date(), randomUUID(), new Date(Date.now() + 30_000), 1)).toEqual([]);
      const retried = await executeCommandWithOutbox(transactions, commands, outbox, identity, async () => {
        const correctEvent = event(shopA, identity.key);
        return { resultRef: correctEvent.id, event: correctEvent };
      });
      expect(retried.kind).toBe('executed');
      expect(
        (await outbox.claim(shopA, new Date(), randomUUID(), new Date(Date.now() + 30_000), 1)).map((row) => row.id),
      ).toEqual([retried.resultRef]);
    } finally {
      await Promise.all([core.close(), database.destroy()]);
    }
  });
});
