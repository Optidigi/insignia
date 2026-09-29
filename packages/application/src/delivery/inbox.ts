import { createHash, randomUUID } from 'node:crypto';
import type { TransactionRunner } from '../transactions/transaction.js';

export type InboxMessage = {
  id: string;
  source: string;
  externalDeliveryId: string | null;
  shopId: string | null;
  installationGeneration: string | null;
  payload: Uint8Array;
  payloadSha256: string;
  receivedAt: Date;
  retentionClass: string;
  purgeAfter: Date | null;
};

export type InboxReceipt = { kind: 'received' | 'duplicate'; id: string };
export type InboxLockedMessage = InboxMessage & { state: 'pending' | 'leased' | 'processed' | 'failed' };

export const MAX_DURABLE_PAYLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_DURABLE_PAYLOAD_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

export interface InboxRepository<Tx> {
  receive(message: InboxMessage): Promise<InboxReceipt | { kind: 'payload_conflict' }>;
  lockForProcessing(transaction: Tx, shopId: string, id: string): Promise<InboxLockedMessage | null>;
  markProcessed(transaction: Tx, shopId: string, id: string): Promise<void>;
  recordFailure(shopId: string, id: string, failureClass: string): Promise<void>;
}

export class InboxPayloadConflictError extends Error {
  constructor() {
    super('Delivery identity was previously used with different payload bytes or tenant');
    this.name = 'InboxPayloadConflictError';
  }
}

export async function receiveInbox<Tx>(
  inbox: InboxRepository<Tx>,
  input: Omit<InboxMessage, 'id' | 'payloadSha256'>,
): Promise<InboxReceipt> {
  if (
    !input.source ||
    !input.retentionClass ||
    !(input.payload instanceof Uint8Array) ||
    input.payload.byteLength > MAX_DURABLE_PAYLOAD_BYTES ||
    !Number.isFinite(input.receivedAt.getTime()) ||
    input.purgeAfter === null ||
    !Number.isFinite(input.purgeAfter.getTime()) ||
    input.purgeAfter <= input.receivedAt ||
    input.purgeAfter.getTime() - input.receivedAt.getTime() > MAX_DURABLE_PAYLOAD_RETENTION_MS ||
    (input.installationGeneration !== null && input.shopId === null)
  ) {
    throw new TypeError('Inbox delivery is missing required metadata');
  }
  const message: InboxMessage = {
    ...input,
    id: randomUUID(),
    payload: Uint8Array.from(input.payload),
    payloadSha256: createHash('sha256').update(input.payload).digest('hex'),
  };
  const receipt = await inbox.receive(message);
  if (receipt.kind === 'payload_conflict') throw new InboxPayloadConflictError();
  return receipt;
}

export async function processInbox<Tx>(
  transactions: TransactionRunner<Tx>,
  inbox: InboxRepository<Tx>,
  shopId: string,
  id: string,
  process: (transaction: Tx, message: InboxLockedMessage) => Promise<void>,
): Promise<'processed' | 'already_processed' | 'not_found'> {
  if (!shopId || !id) throw new TypeError('Shop and inbox message are required');
  let processFailed = false;
  try {
    return await transactions.run(async (transaction) => {
      const message = await inbox.lockForProcessing(transaction, shopId, id);
      if (!message) return 'not_found';
      if (message.state === 'processed') return 'already_processed';
      if (message.state !== 'pending' && message.state !== 'failed') {
        throw new Error('Inbox message is currently leased');
      }
      try {
        await process(transaction, message);
      } catch (error) {
        processFailed = true;
        throw error;
      }
      await inbox.markProcessed(transaction, shopId, id);
      return 'processed';
    });
  } catch (error) {
    if (processFailed) await inbox.recordFailure(shopId, id, 'processing_failed');
    throw error;
  }
}
