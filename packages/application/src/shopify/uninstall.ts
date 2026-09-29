import { type InboxRepository, processInbox } from '../delivery/inbox.js';
import type { TransactionRunner } from '../transactions/transaction.js';

export interface InstallationDeactivationPort<Tx> {
  /** Stale old-generation uninstall cannot deactivate a newer installation. */
  deactivateCurrent(
    transaction: Tx,
    shopId: string,
    expectedGeneration: string,
  ): Promise<'deactivated' | 'already_inactive' | 'stale'>;
}

/** Invoked only for a verified app/uninstalled delivery; no Admin token is required. */
export async function processShopifyUninstallInbox<Tx>(
  transactions: TransactionRunner<Tx>,
  inbox: InboxRepository<Tx>,
  installations: InstallationDeactivationPort<Tx>,
  shopId: string,
  inboxId: string,
): Promise<'processed' | 'already_processed' | 'not_found'> {
  return processInbox(transactions, inbox, shopId, inboxId, async (transaction, message) => {
    if (message.shopId !== shopId || !message.installationGeneration) {
      throw new TypeError('Uninstall delivery has no resolved installation');
    }
    await installations.deactivateCurrent(transaction, shopId, message.installationGeneration);
  });
}
