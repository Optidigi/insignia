import { describe, expect, test, vi } from 'vitest';
import type { InboxRepository } from '../src/delivery/inbox.js';
import { processShopifyUninstallInbox } from '../src/shopify/uninstall.js';
import type { TransactionRunner } from '../src/transactions/transaction.js';

const shopId = 'shop-uuid';
const inboxId = 'inbox-uuid';
type Tx = { label: string };

function setup(generation: string | null = '2') {
  const transaction = { label: 'owned-transaction' };
  const transactions: TransactionRunner<Tx> = { run: async (work) => work(transaction) };
  const markProcessed = vi.fn(async () => {});
  const inbox: InboxRepository<Tx> = {
    receive: vi.fn(),
    lockForProcessing: vi.fn(async () => ({
      id: inboxId,
      source: 'shopify',
      externalDeliveryId: 'delivery-id',
      shopId,
      installationGeneration: generation,
      payload: new Uint8Array(),
      payloadSha256: 'sha256',
      receivedAt: new Date(),
      retentionClass: 'webhook',
      purgeAfter: new Date(Date.now() + 10_000),
      state: 'pending' as const,
    })),
    markProcessed,
    recordFailure: vi.fn(async () => {}),
  };
  const deactivateCurrent = vi.fn(async (): Promise<'deactivated' | 'already_inactive' | 'stale'> => 'deactivated');
  return { transactions, inbox, deactivateCurrent, markProcessed, transaction };
}

describe('signed uninstall delivery processing', () => {
  test('deactivates the bound generation inside the inbox processing transaction without a token', async () => {
    const deps = setup();
    expect(
      await processShopifyUninstallInbox(
        deps.transactions,
        deps.inbox,
        { deactivateCurrent: deps.deactivateCurrent },
        shopId,
        inboxId,
      ),
    ).toBe('processed');
    expect(deps.deactivateCurrent).toHaveBeenCalledWith(deps.transaction, shopId, '2');
    expect(deps.markProcessed).toHaveBeenCalledWith(deps.transaction, shopId, inboxId);
  });

  test('unresolved delivery cannot mark processed or deactivate any generation', async () => {
    const deps = setup(null);
    await expect(
      processShopifyUninstallInbox(
        deps.transactions,
        deps.inbox,
        { deactivateCurrent: deps.deactivateCurrent },
        shopId,
        inboxId,
      ),
    ).rejects.toThrow('no resolved installation');
    expect(deps.deactivateCurrent).not.toHaveBeenCalled();
    expect(deps.markProcessed).not.toHaveBeenCalled();
  });

  test('deactivation error rolls back the processing marker', async () => {
    const deps = setup();
    deps.deactivateCurrent.mockRejectedValueOnce(new Error('database aborted'));
    await expect(
      processShopifyUninstallInbox(
        deps.transactions,
        deps.inbox,
        { deactivateCurrent: deps.deactivateCurrent },
        shopId,
        inboxId,
      ),
    ).rejects.toThrow('database aborted');
    expect(deps.markProcessed).not.toHaveBeenCalled();
  });

  test('old-generation uninstall is processed without deactivating a newer installation', async () => {
    const deps = setup('1');
    deps.deactivateCurrent.mockResolvedValueOnce('stale');
    expect(
      await processShopifyUninstallInbox(
        deps.transactions,
        deps.inbox,
        { deactivateCurrent: deps.deactivateCurrent },
        shopId,
        inboxId,
      ),
    ).toBe('processed');
    expect(deps.deactivateCurrent).toHaveBeenCalledWith(deps.transaction, shopId, '1');
    expect(deps.markProcessed).toHaveBeenCalledTimes(1);
  });
});
