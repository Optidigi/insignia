import type { PoolClient } from 'pg';
import { QUEUE_SCHEMA_VERSION, WEBHOOK_QUEUE } from '../../apps/worker/dist/queue-contract.js';

/** Run in the offline owner's transaction after the selected inboxes are erased. */
export async function clearRestoredWebhookJobs(client: PoolClient, inboxIds: string[]) {
  if (!inboxIds.length) return;
  const queue = await client.query<{ installed: boolean }>("SELECT to_regnamespace('pgboss') IS NOT NULL AS installed");
  if (queue.rows[0]?.installed) {
    const version = await client.query<{ version: number }>('SELECT version FROM pgboss.version');
    if (version.rowCount !== 1 || version.rows[0]?.version !== QUEUE_SCHEMA_VERSION)
      throw new Error('Unreviewed restore queue schema');
    await client.query('LOCK TABLE pgboss.job IN SHARE ROW EXCLUSIVE MODE');
    const invalid = await client.query(
      `SELECT 1 FROM pgboss.job WHERE name=$1 AND id=ANY($2::uuid[])
       AND data IS DISTINCT FROM jsonb_build_object('inboxId',id) LIMIT 1`,
      [WEBHOOK_QUEUE, inboxIds],
    );
    if (invalid.rowCount) throw new Error('Conflicting restored webhook job identity');
    await client.query('DELETE FROM pgboss.job WHERE name=$1 AND id=ANY($2::uuid[])', [WEBHOOK_QUEUE, inboxIds]);
    const remaining = await client.query('SELECT 1 FROM pgboss.job WHERE name=$1 AND id=ANY($2::uuid[]) LIMIT 1', [
      WEBHOOK_QUEUE,
      inboxIds,
    ]);
    if (remaining.rowCount) throw new Error('Restored webhook job cleanup could not be confirmed');
  }
  await client.query(
    'UPDATE public.shopify_webhook_deliveries SET queue_cleanup_pending=false WHERE inbox_id=ANY($1::uuid[])',
    [inboxIds],
  );
}
