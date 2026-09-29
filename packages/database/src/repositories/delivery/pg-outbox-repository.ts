import { isDeepStrictEqual } from 'node:util';
import {
  type ClaimedOutboxEvent,
  MAX_DURABLE_PAYLOAD_BYTES,
  type OutboxEvent,
  type OutboxRepository,
} from '@insignia/application';
import { type Kysely, sql, type Transaction } from 'kysely';
import type { Database } from '../../client/database.js';
import { canonicalJson } from '../../hash/canonical.js';

export class PgOutboxRepository implements OutboxRepository<Transaction<Database>> {
  constructor(private readonly database: Kysely<Database>) {}

  async add(transaction: Transaction<Database>, event: OutboxEvent): Promise<string> {
    const canonicalPayload = canonicalJson(event.payload);
    if (Buffer.byteLength(canonicalPayload, 'utf8') > MAX_DURABLE_PAYLOAD_BYTES)
      throw new TypeError('Outbox payload exceeds durable size limit');
    const normalizedPayload = JSON.parse(canonicalPayload) as unknown;
    const shop = await transaction
      .selectFrom('shops')
      .select('current_generation')
      .where('shop_id', '=', event.shopId)
      .forNoKeyUpdate()
      .executeTakeFirst();
    if (!shop) throw new Error('Outbox shop does not exist');
    if (event.installationGeneration !== null && event.installationGeneration !== shop.current_generation) {
      throw new Error('Outbox event belongs to a stale installation generation');
    }
    const inserted = await transaction
      .insertInto('outbox_events')
      .values({
        id: event.id,
        shop_id: event.shopId,
        installation_generation: event.installationGeneration,
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
      .select([
        'id',
        'installation_generation',
        'schema_version',
        'aggregate_ref',
        'payload',
        'occurred_at',
        'available_at',
        'retention_class',
        'purge_after',
      ])
      .where('shop_id', '=', event.shopId)
      .where('event_type', '=', event.eventType)
      .where('business_key', '=', event.businessKey)
      .executeTakeFirst();
    if (
      !existing ||
      existing.installation_generation !== event.installationGeneration ||
      existing.schema_version !== event.schemaVersion ||
      existing.aggregate_ref !== event.aggregateRef ||
      existing.occurred_at.getTime() !== event.occurredAt.getTime() ||
      existing.available_at.getTime() !== event.availableAt.getTime() ||
      existing.retention_class !== event.retentionClass ||
      existing.purge_after?.getTime() !== event.purgeAfter?.getTime() ||
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
      !Number.isFinite(leaseUntil.getTime())
    ) {
      throw new TypeError('Invalid outbox claim');
    }
    return this.database.transaction().execute(async (transaction) => {
      const shop = await transaction
        .selectFrom('shops')
        .select('current_generation')
        .where('shop_id', '=', shopId)
        .forNoKeyUpdate()
        .executeTakeFirst();
      if (!shop) return [];
      const databaseTime = await sql<{ current_time: Date }>`select clock_timestamp() as current_time`.execute(
        transaction,
      );
      const currentTime = databaseTime.rows[0]?.current_time;
      if (!currentTime) throw new Error('Database clock was unavailable');
      if (leaseUntil <= currentTime) throw new TypeError('Outbox lease deadline has passed');
      const selected = await transaction
        .selectFrom('outbox_events')
        .select('id')
        .where('shop_id', '=', shopId)
        .where((expression) =>
          expression.or([
            expression('installation_generation', 'is', null),
            expression('installation_generation', '=', shop.current_generation),
          ]),
        )
        .where('available_at', '<=', sql<Date>`clock_timestamp()`)
        .where((expression) =>
          expression.or([
            expression('state', '=', 'pending'),
            expression.and([
              expression('state', '=', 'leased'),
              expression('lease_until', '<=', sql<Date>`clock_timestamp()`),
            ]),
          ]),
        )
        .orderBy('available_at', 'asc')
        .orderBy('id', 'asc')
        .limit(limit)
        .forNoKeyUpdate()
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
        installationGeneration: row.installation_generation,
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
      const shop = await transaction
        .selectFrom('shops')
        .select('current_generation')
        .where('shop_id', '=', shopId)
        .forNoKeyUpdate()
        .executeTakeFirst();
      if (!shop) return 'not_owned';
      const row = await transaction
        .selectFrom('outbox_events')
        .select(['state', 'lease_owner', 'lease_until', 'attempts', 'installation_generation'])
        .where('shop_id', '=', shopId)
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!row) return 'not_owned';
      if (row.installation_generation !== null && row.installation_generation !== shop.current_generation)
        return 'not_owned';
      if (row.state === 'delivered') return 'already_delivered';
      if (row.state !== 'leased' || row.lease_owner !== leaseOwner || row.attempts !== expectedAttempt)
        return 'not_owned';
      const updated = await transaction
        .updateTable('outbox_events')
        .set({
          state: 'delivered',
          lease_owner: null,
          lease_until: null,
        })
        .where('shop_id', '=', shopId)
        .where('id', '=', id)
        .where('lease_until', '>', sql<Date>`clock_timestamp()`)
        .returning('id')
        .executeTakeFirst();
      if (!updated) return 'not_owned';
      return 'acknowledged';
    });
  }
}
