import type { InboxLockedMessage, InboxMessage, InboxReceipt, InboxRepository } from '@insignia/application';
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../client/database.js';

export class PgInboxRepository implements InboxRepository<Transaction<Database>> {
  constructor(private readonly database: Kysely<Database>) {}

  async receive(message: InboxMessage): Promise<InboxReceipt | { kind: 'payload_conflict' }> {
    const inserted = await this.database
      .insertInto('inbox_messages')
      .values({
        id: message.id,
        source: message.source,
        external_delivery_id: message.externalDeliveryId,
        shop_id: message.shopId,
        installation_generation: message.installationGeneration,
        payload: Buffer.from(message.payload),
        payload_sha256: message.payloadSha256,
        received_at: message.receivedAt,
        state: 'pending',
        attempts: 0,
        last_error_class: null,
        retention_class: message.retentionClass,
        purge_after: message.purgeAfter,
        lease_owner: null,
        lease_until: null,
        erasure_state: 'retained',
      })
      .onConflict((conflict) => conflict.doNothing())
      .returning('id')
      .executeTakeFirst();
    if (inserted) return { kind: 'received', id: inserted.id };
    if (message.externalDeliveryId === null) throw new Error('Inbox identity collision without external delivery ID');

    let query = this.database
      .selectFrom('inbox_messages')
      .select(['id', 'shop_id', 'installation_generation', 'payload_sha256'])
      .where('source', '=', message.source)
      .where('external_delivery_id', '=', message.externalDeliveryId);
    query = message.shopId === null ? query.where('shop_id', 'is', null) : query.where('shop_id', '=', message.shopId);
    query =
      message.installationGeneration === null
        ? query.where('installation_generation', 'is', null)
        : query.where('installation_generation', '=', message.installationGeneration);
    const existing = await query.executeTakeFirst();
    if (
      !existing ||
      existing.payload_sha256 !== message.payloadSha256 ||
      existing.installation_generation !== message.installationGeneration
    ) {
      return { kind: 'payload_conflict' };
    }
    return { kind: 'duplicate', id: existing.id };
  }

  async lockForProcessing(
    transaction: Transaction<Database>,
    shopId: string,
    id: string,
  ): Promise<InboxLockedMessage | null> {
    const shop = await transaction
      .selectFrom('shops')
      .select('current_generation')
      .where('shop_id', '=', shopId)
      .forNoKeyUpdate()
      .executeTakeFirst();
    if (!shop) return null;
    const row = await transaction
      .selectFrom('inbox_messages')
      .selectAll()
      .where('shop_id', '=', shopId)
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!row) return null;
    if (row.installation_generation !== null && row.installation_generation !== shop.current_generation) return null;
    return {
      id: row.id,
      source: row.source,
      externalDeliveryId: row.external_delivery_id,
      shopId: row.shop_id,
      installationGeneration: row.installation_generation,
      payload: Uint8Array.from(row.payload),
      payloadSha256: row.payload_sha256,
      receivedAt: row.received_at,
      state: row.state,
      retentionClass: row.retention_class,
      purgeAfter: row.purge_after,
    };
  }

  async markProcessed(transaction: Transaction<Database>, shopId: string, id: string): Promise<void> {
    const result = await transaction
      .updateTable('inbox_messages')
      .set((expression) => ({
        state: 'processed',
        attempts: expression('attempts', '+', 1),
        last_error_class: null,
        lease_owner: null,
        lease_until: null,
      }))
      .where('shop_id', '=', shopId)
      .where('id', '=', id)
      .where('state', 'in', ['pending', 'failed'])
      .executeTakeFirst();
    if (result.numUpdatedRows !== 1n) throw new Error('Inbox message was not processable');
  }

  async recordFailure(shopId: string, id: string, failureClass: string): Promise<void> {
    await this.database
      .updateTable('inbox_messages')
      .set((expression) => ({
        state: 'failed',
        attempts: expression('attempts', '+', 1),
        last_error_class: failureClass,
      }))
      .where('shop_id', '=', shopId)
      .where('id', '=', id)
      .where('state', 'in', ['pending', 'failed'])
      .execute();
  }
}
