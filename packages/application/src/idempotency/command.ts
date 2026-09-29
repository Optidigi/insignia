import type { OutboxEvent, OutboxRepository } from '../delivery/outbox.js';
import type { TransactionRunner } from '../transactions/transaction.js';

export type CommandIdentity = {
  shopId: string;
  namespace: string;
  key: string;
  requestDigest: string;
};

export type CommandReservation =
  | { kind: 'reserved' }
  | { kind: 'completed'; resultRef: string }
  | { kind: 'digest_conflict' };

export interface CommandRepository<Tx> {
  reserve(transaction: Tx, identity: CommandIdentity): Promise<CommandReservation>;
  complete(transaction: Tx, identity: CommandIdentity, resultRef: string): Promise<void>;
}

export class CommandDigestConflictError extends Error {
  constructor() {
    super('Idempotency key was previously used with a different request digest');
    this.name = 'CommandDigestConflictError';
  }
}

export async function executeCommand<Tx>(
  transactions: TransactionRunner<Tx>,
  commands: CommandRepository<Tx>,
  identity: CommandIdentity,
  mutate: (transaction: Tx) => Promise<string>,
): Promise<{ kind: 'executed' | 'replayed'; resultRef: string }> {
  if (!identity.shopId || !identity.namespace || !identity.key || !/^[0-9a-f]{64}$/.test(identity.requestDigest)) {
    throw new TypeError('A command requires shop, namespace, key and lowercase SHA-256 digest');
  }
  return transactions.run(async (transaction) => {
    const reservation = await commands.reserve(transaction, identity);
    if (reservation.kind === 'digest_conflict') throw new CommandDigestConflictError();
    if (reservation.kind === 'completed') return { kind: 'replayed', resultRef: reservation.resultRef };
    const resultRef = await mutate(transaction);
    if (!resultRef) throw new TypeError('Command mutation must return a durable result reference');
    await commands.complete(transaction, identity, resultRef);
    return { kind: 'executed', resultRef };
  });
}

/** Use when the command's business mutation requires a downstream delivery. */
export function executeCommandWithOutbox<Tx>(
  transactions: TransactionRunner<Tx>,
  commands: CommandRepository<Tx>,
  outbox: OutboxRepository<Tx>,
  identity: CommandIdentity,
  mutate: (transaction: Tx) => Promise<{ resultRef: string; event: OutboxEvent }>,
): Promise<{ kind: 'executed' | 'replayed'; resultRef: string }> {
  return executeCommand(transactions, commands, identity, async (transaction) => {
    const result = await mutate(transaction);
    await outbox.add(transaction, result.event);
    return result.resultRef;
  });
}
