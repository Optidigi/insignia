import type { CommandIdentity, CommandRepository, CommandReservation } from '@insignia/application';
import type { Transaction } from 'kysely';
import type { Database } from '../../client/database.js';

export class PgCommandRepository implements CommandRepository<Transaction<Database>> {
  async reserve(transaction: Transaction<Database>, identity: CommandIdentity): Promise<CommandReservation> {
    const inserted = await transaction
      .insertInto('idempotency_records')
      .values({
        shop_id: identity.shopId,
        namespace: identity.namespace,
        idempotency_key: identity.key,
        request_digest: identity.requestDigest,
        status: 'pending',
        created_at: new Date(),
        completed_at: null,
        result_ref: null,
        failure_class: null,
      })
      .onConflict((conflict) => conflict.columns(['shop_id', 'namespace', 'idempotency_key']).doNothing())
      .returning('idempotency_key')
      .executeTakeFirst();
    if (inserted) return { kind: 'reserved' };

    const existing = await transaction
      .selectFrom('idempotency_records')
      .select(['request_digest', 'status', 'result_ref'])
      .where('shop_id', '=', identity.shopId)
      .where('namespace', '=', identity.namespace)
      .where('idempotency_key', '=', identity.key)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (existing.request_digest !== identity.requestDigest) return { kind: 'digest_conflict' };
    if (existing.status === 'completed' && existing.result_ref) {
      return { kind: 'completed', resultRef: existing.result_ref };
    }
    throw new Error('Idempotency record has no completed result');
  }

  async complete(transaction: Transaction<Database>, identity: CommandIdentity, resultRef: string): Promise<void> {
    const updated = await transaction
      .updateTable('idempotency_records')
      .set({
        status: 'completed',
        result_ref: resultRef,
        completed_at: new Date(),
      })
      .where('shop_id', '=', identity.shopId)
      .where('namespace', '=', identity.namespace)
      .where('idempotency_key', '=', identity.key)
      .where('request_digest', '=', identity.requestDigest)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    if (updated.numUpdatedRows !== 1n) throw new Error('Command completion did not own a pending record');
  }
}
