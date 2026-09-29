import { randomUUID } from 'node:crypto';

export type OutboxEvent = {
  id: string;
  shopId: string;
  eventType: string;
  schemaVersion: number;
  aggregateRef: string;
  payload: unknown;
  businessKey: string | null;
  occurredAt: Date;
  availableAt: Date;
  retentionClass: string;
  purgeAfter: Date | null;
};

export type ClaimedOutboxEvent = OutboxEvent & {
  attempts: number;
  leaseOwner: string;
  leaseUntil: Date;
};

export interface OutboxRepository<Tx> {
  add(transaction: Tx, event: OutboxEvent): Promise<string>;
  claim(shopId: string, now: Date, leaseOwner: string, leaseUntil: Date, limit: number): Promise<ClaimedOutboxEvent[]>;
  acknowledge(
    shopId: string,
    id: string,
    leaseOwner: string,
    expectedAttempt: number,
  ): Promise<'acknowledged' | 'already_delivered' | 'not_owned'>;
}

export function newOutboxEvent(input: Omit<OutboxEvent, 'id'>): OutboxEvent {
  if (
    !input.shopId ||
    !input.eventType ||
    !input.aggregateRef ||
    !input.retentionClass ||
    !Number.isInteger(input.schemaVersion) ||
    input.schemaVersion < 1 ||
    !Number.isFinite(input.occurredAt.getTime()) ||
    !Number.isFinite(input.availableAt.getTime()) ||
    (input.purgeAfter !== null &&
      (!Number.isFinite(input.purgeAfter.getTime()) || input.purgeAfter <= input.occurredAt))
  ) {
    throw new TypeError('Outbox event is missing required metadata');
  }
  return { ...input, id: randomUUID() };
}
