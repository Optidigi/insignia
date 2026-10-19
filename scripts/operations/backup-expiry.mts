/** Owner-only expiry replay against an offline restored database; never provider writes. */

import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { PoolClient } from 'pg';

export async function replayExpiry(client: PoolClient) {
  await client.query('BEGIN');
  try {
    const owner = (
      await client.query<{ allowed: boolean }>(
        `SELECT current_database() ~ '^insignia_recovery_[a-z0-9_]{1,40}$' AND current_user=session_user AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS allowed`,
      )
    ).rows[0]?.allowed;
    if (
      owner !== true ||
      (
        await client.query(
          'SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() LIMIT 1',
        )
      ).rowCount
    )
      throw Error('Offline schema owner required');
    // Reuse the current expiry rules, preserving immutable collection/expiry and financial facts.
    for (let page = 0; page < 1000; page++) {
      const cleaned = (
        await client.query<{ buyer: number; purchase: number }>(
          'SELECT public.cleanup_buyer_payloads(1000) AS buyer,public.cleanup_purchase_payloads(1000) AS purchase',
        )
      ).rows[0];
      assert(cleaned, 'Expiry cleanup response missing');
      const rows = (
        await client.query<{ id: string }>(
          `SELECT id FROM public.inbox_messages WHERE source='shopify' AND retention_class='shopify-webhook' AND erasure_state<>'erased' AND purge_after<=clock_timestamp() ORDER BY id LIMIT 100`,
        )
      ).rows;
      for (const row of rows) await client.query('SELECT public.expire_shopify_webhook_bytes($1)', [row.id]);
      await client.query('SELECT public.expire_shopify_webhook_facts(100)');
      const pending = (
        await client.query<{ count: string }>(`SELECT
        (SELECT count(*) FROM public.design_drafts WHERE expires_at<=clock_timestamp())+
        (SELECT count(*) FROM public.quote_proposals WHERE retain_private_until<=clock_timestamp())+
        (SELECT count(*) FROM public.buyer_sessions b WHERE expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM public.shops s JOIN public.installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=b.shop_id AND s.current_generation=b.installation_generation AND i.deactivated_at IS NULL))+
        (SELECT count(*) FROM public.purchase_design_payloads WHERE erased_at IS NULL AND expires_at<=clock_timestamp())+
        (SELECT count(*) FROM public.purchase_offer_payloads WHERE erased_at IS NULL AND expires_at<=clock_timestamp())+
        (SELECT count(*) FROM public.purchase_artwork_events WHERE kind='ATTACH' AND erased_at IS NULL AND expires_at<=clock_timestamp())+
        (SELECT count(*) FROM public.inbox_messages WHERE source='shopify' AND retention_class='shopify-webhook' AND erasure_state<>'erased' AND purge_after<=clock_timestamp())+
        (SELECT count(*) FROM public.webhook_obligation_facts WHERE facts_erased_at IS NULL AND forget_after<=clock_timestamp()) AS count`)
      ).rows[0]?.count;
      assert(pending !== undefined && /^\d+$/.test(pending), 'Expiry count response missing');
      if (Number(pending) === 0 && Number(cleaned.buyer) === 0 && Number(cleaned.purchase) === 0) break;
      if (page === 999) throw Error('Expiry replay budget exceeded');
    }
    await client.query(
      `UPDATE public.inbox_messages SET payload=''::bytea,erasure_state='erased',lease_owner=NULL,lease_until=NULL WHERE source<>'shopify' AND erasure_state<>'erased' AND purge_after<=clock_timestamp()`,
    );
    await client.query(
      `UPDATE public.outbox_events SET payload='{}',erasure_state='erased',lease_owner=NULL,lease_until=NULL WHERE erasure_state<>'erased' AND purge_after<=clock_timestamp()`,
    );
    await client.query(
      `UPDATE public.artwork_assets a SET state='DELETING',claim_id=NULL,claim_until=NULL WHERE state<>'DELETED' AND (state IN ('REJECTED','DELETING') OR expires_at<=clock_timestamp() OR (state='UPLOADING' AND collected_at<=clock_timestamp()-interval '24 hours') OR NOT EXISTS(SELECT 1 FROM public.shops s JOIN public.installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=a.shop_id AND s.current_generation=a.installation_generation AND i.deactivated_at IS NULL))`,
    );
    await client.query(
      `UPDATE public.merchant_preview_assets a SET state='DELETING',claim_id=NULL WHERE state NOT IN ('WRITING','DELETED') AND (state IN ('RETIRED','DELETING') OR NOT EXISTS(SELECT 1 FROM public.shops s JOIN public.installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=a.shop_id AND s.current_generation=a.installation_generation AND i.deactivated_at IS NULL) OR (abandon_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM public.config_revision_preview_assets r WHERE r.asset_id=a.asset_id)))`,
    );
    const excluded = (
      await client.query<{ key: string }>(
        `SELECT original_key AS key FROM public.artwork_assets WHERE state IN ('DELETING','DELETED') UNION SELECT preview_key FROM public.artwork_assets WHERE state IN ('DELETING','DELETED') UNION SELECT quarantine_key FROM public.artwork_assets WHERE state IN ('DELETING','DELETED') OR (state='USABLE' AND upload_until<=clock_timestamp()) UNION SELECT original_key FROM public.merchant_preview_assets WHERE state IN ('DELETING','DELETED') UNION SELECT preview_key FROM public.merchant_preview_assets WHERE state IN ('DELETING','DELETED') ORDER BY key`,
      )
    ).rows;
    await client.query('COMMIT');
    return {
      readiness: 'HOLD_STORAGE_AND_AUTHORITY_REQUALIFICATION',
      keys: excluded.map((row) => row.key),
      databaseExpiryReplayed: true,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
function requiredOutput(): string {
  assert(process.argv[2], 'Output path required');
  return process.argv[2];
}
async function main() {
  assert(process.env.DATABASE_URL, 'Explicit isolated target required');
  const target = new URL(process.env.DATABASE_URL);
  const socket = target.searchParams.get('host');
  if (
    !/^\/insignia_recovery_[a-z0-9_]{1,40}$/.test(target.pathname) ||
    !socket?.startsWith('/') ||
    socket.includes(',') ||
    process.env.PGHOSTADDR ||
    process.env.PGSERVICE ||
    process.env.PGSERVICEFILE ||
    process.env.PGOPTIONS
  )
    throw Error('Explicit isolated target required');
  const info = await lstat(socket);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || info.mode & 0o077)
    throw Error('Private socket required');
  const { Pool }: typeof import('pg') = createRequire(new URL('../../apps/worker/package.json', import.meta.url))('pg');
  const pool = new Pool({ connectionString: target.href, max: 1 });
  const client = await pool.connect();
  try {
    const result = await replayExpiry(client);
    const file = await open(
      requiredOutput(),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(JSON.stringify(result));
      await file.sync();
    } finally {
      await file.close();
    }
    console.log(JSON.stringify({ databaseExpiryReplayed: true, readiness: result.readiness }));
  } finally {
    client.release();
    await pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error('Expiry replay failed; restore readiness HOLD');
    process.exitCode = 1;
  });
