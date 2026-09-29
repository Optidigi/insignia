import { isDeepStrictEqual } from 'node:util';
import type { ClaimedOutboxEvent, OutboxEvent, OutboxRepository } from '@insignia/application';
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../client/database.js';

export class PgOutboxRepository implements OutboxRepository<Transaction<Database>> {
  constructor(private readonly database: Kysely<Database>) {}

  async add(transaction: Transaction<Database>, event: OutboxEvent): Promise<string> {
    const serialized = JSON.stringify(event.payload);
    if (serialized === undefined) throw new TypeError('Outbox payload must be JSON-safe');
    const normalizedPayload = JSON.parse(serialized) as unknown;
    const inserted = await transaction
      .insertInto('outbox_events')
      .values({
        id: event.id,
        shop_id: event.shopId,
        event_type: event.eventType,
        schema_version: event.schemaVersion,
        aggregate_ref: event.aggregateRef,
        payload: normalizedPayload,
        business_key: event.businessKey,
        occurred_at: event.occurredAt,
        collected_at: event.occurredAt,
        available_at: event.availableAt,
        state: 'pending',
        attempts: 0,
        last_error_class: null,
        lease_owner: null,
        lease_until: null,
        retention_class: event.retentionClass,
        purge_after: event.purgeAfter,
        erasure_state: 'retained',
        created_at: new Date(),
      })
      .onConflict((conflict) => conflict.doNothing())
      .returning('id')
      .executeTakeFirst();
    if (inserted) return inserted.id;
    if (event.businessKey === null) throw new Error('Outbox event ID collision');
    const existing = await transaction
      .selectFrom('outbox_events')
      .select(['id', 'schema_version', 'aggregate_ref', 'payload', 'occurred_at'])
      .where('shop_id', '=', event.shopId)
      .where('event_type', '=', event.eventType)
      .where('business_key', '=', event.businessKey)
      .executeTakeFirst();
    if (
      !existing ||
      existing.schema_version !== event.schemaVersion ||
      existing.aggregate_ref !== event.aggregateRef ||
      existing.occurred_at.getTime() !== event.occurredAt.getTime() ||
      !isDeepStrictEqual(existing.payload, normalizedPayload)
    ) {
      throw new Error('Outbox business key conflicts with another event');
    }
    return existing.id;
  }

  async claim(
    shopId: string,
    now: Date,
    leaseOwner: string,
    leaseUntil: Date,
    limit: number,
  ): Promise<ClaimedOutboxEvent[]> {
    if (
      !shopId ||
      !leaseOwner ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isFinite(now.getTime()) ||
      leaseUntil <= now
    ) {
      throw new TypeError('Invalid outbox claim');
    }
    return this.database.transaction().execute(async (transaction) => {
      const selected = await transaction
        .selectFrom('outbox_events')
        .select('id')
        .where('shop_id', '=', shopId)
        .where('available_at', '<=', now)
        .where((expression) =>
          expression.or([
            expression('state', '=', 'pending'),
            expression.and([expression('state', '=', 'leased'), expression('lease_until', '<=', now)]),
          ]),
        )
        .orderBy('available_at', 'asc')
        .orderBy('id', 'asc')
        .limit(limit)
        .forUpdate()
        .skipLocked()
        .execute();
      if (selected.length === 0) return [];
      const rows = await transaction
        .updateTable('outbox_events')
        .set((expression) => ({
          state: 'leased',
          attempts: expression('attempts', '+', 1),
          lease_owner: leaseOwner,
          lease_until: leaseUntil,
        }))
        .where('shop_id', '=', shopId)
        .where(
          'id',
          'in',
          selected.map((row) => row.id),
        )
        .returningAll()
        .execute();
      return rows.map((row) => ({
        id: row.id,
        shopId: row.shop_id,
        eventType: row.event_type,
        schemaVersion: row.schema_version,
        aggregateRef: row.aggregate_ref,
        payload: row.payload,
        businessKey: row.business_key,
        occurredAt: row.occurred_at,
        availableAt: row.available_at,
        retentionClass: row.retention_class,
        purgeAfter: row.purge_after,
        attempts: row.attempts,
        leaseOwner: row.lease_owner ?? leaseOwner,
        leaseUntil: row.lease_until ?? leaseUntil,
      }));
    });
  }

  async acknowledge(
    shopId: string,
    id: string,
    leaseOwner: string,
    expectedAttempt: number,
  ): Promise<'acknowledged' | 'already_delivered' | 'not_owned'> {
    if (!shopId || !id || !leaseOwner || !Number.isInteger(expectedAttempt) || expectedAttempt < 1) {
      throw new TypeError('Shop, event, lease owner and attempt are required');
    }
    return this.database.transaction().execute(async (transaction) => {
      const row = await transaction
        .selectFrom('outbox_events')
        .select(['state', 'lease_owner', 'attempts'])
        .where('shop_id', '=', shopId)
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!row) return 'not_owned';
      if (row.state === 'delivered') return 'already_delivered';
      if (row.state !== 'leased' || row.lease_owner !== leaseOwner || row.attempts !== expectedAttempt)
        return 'not_owned';
      await transaction
        .updateTable('outbox_events')
        .set({
          state: 'delivered',
          lease_owner: null,
          lease_until: null,
        })
        .where('shop_id', '=', shopId)
        .where('id', '=', id)
        .execute();
      return 'acknowledged';
    });
  }
}
