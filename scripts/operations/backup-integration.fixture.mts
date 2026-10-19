/** Typed subprocess fixture for actual isolated PostgreSQL boundaries. Never selects a database. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { array, check, record, text } from './backup-files.mts';

const mode = text(process.argv[2]);
async function operation(file: string, name: string): Promise<(...args: unknown[]) => Promise<unknown>> {
  const value: unknown = await import(new URL(file, import.meta.url).href);
  const fn = record(value)[name];
  check(typeof fn === 'function', 'Expected existing production operation');
  return async (...args: unknown[]): Promise<unknown> => fn(...args);
}
if (mode === 'produce') {
  globalThis.fetch = async (input) => {
    assert(
      input instanceof Request && input.method === 'GET' && input.headers.has('authorization'),
      'unexpected source dispatch',
    );
    return new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>');
  };
  const path = new URL('./backup-snapshot.mjs', import.meta.url).pathname;
  process.argv = [process.execPath, path, ...process.argv.slice(3)];
  await import(new URL('./backup-snapshot.mjs', import.meta.url).href);
} else {
  const pool = new Pool(),
    client = await pool.connect();
  try {
    if (mode === 'snapshot-read') {
      const snapshot = await operation('./backup-snapshot.mjs', 'databaseSnapshot');
      assert.equal(array(record(await snapshot(client)).references).length, 0, 'expected empty object fixture');
    } else if (mode === 'telemetry') {
      const collect = await operation('./heartbeat-snapshot.mjs', 'collectDatabaseSnapshot');
      const counts = (value: unknown) => {
        const snapshot = record(value);
        return {
          processing: record(snapshot.processing).stalledCount,
          deletion: record(snapshot.deletion).overdueCount,
        };
      };
      const empty = counts(await collect(client, Date.now(), 900));
      assert.deepEqual(empty, { processing: 0, deletion: 0 });
      await client.query(`INSERT INTO public.inbox_messages(id,source,payload,payload_sha256,received_at,state,retention_class,purge_after)
VALUES(gen_random_uuid(),'synthetic-heartbeat','fixture'::bytea,encode(sha256('fixture'::bytea),'hex'),clock_timestamp()-interval '1 hour','failed','synthetic-heartbeat',clock_timestamp()+interval '0.1 seconds')`);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const populated = counts(await collect(client, Date.now(), 900));
      assert.deepEqual(populated, { processing: 1, deletion: 1 });
      await client.query(`INSERT INTO public.shops(shop_id,shop_domain,current_generation) VALUES('heartbeat-artwork','heartbeat-artwork.myshopify.com',1),('heartbeat-inactive','heartbeat-inactive.myshopify.com',1);
INSERT INTO public.installation_generations(shop_id,generation) VALUES('heartbeat-artwork',1),('heartbeat-inactive',1);
INSERT INTO public.artwork_assets(asset_id,shop_id,installation_generation,owner_hash,declared_mime,declared_bytes,state,quarantine_key,original_key,preview_key,collected_at,upload_until,expires_at,manifest)
SELECT gen_random_uuid(),'heartbeat-artwork',1,repeat('a',64),'image/png',1,state,'q/'||state,'o/'||state,'p/'||state,clock_timestamp()-interval '2 days',clock_timestamp()-interval '2 days'+interval '1 minute',clock_timestamp()+interval '4 days',CASE WHEN state='USABLE' THEN '{}'::jsonb ELSE NULL END FROM unnest(ARRAY['UPLOADING','REJECTED','USABLE'])state;
INSERT INTO public.inbox_messages(id,source,payload,payload_sha256,received_at,state,retention_class,purge_after)
VALUES('11111111-1111-1111-1111-111111111111','synthetic-facts','fixture'::bytea,encode(sha256('fixture'::bytea),'hex'),clock_timestamp(),'processed','synthetic-facts',clock_timestamp()+interval '1 hour');
INSERT INTO public.webhook_obligation_facts(inbox_id,raw_body_sha256,collected_at,fulfill_by,forget_after,captured_fields)
VALUES('11111111-1111-1111-1111-111111111111',encode(sha256('fixture'::bytea),'hex'),transaction_timestamp()-interval '2 days',transaction_timestamp()+interval '28 days',transaction_timestamp()-interval '1 day','{"customer_id":"synthetic"}');
INSERT INTO public.buyer_sessions(session_id,shop_id,installation_generation,owner_hash,created_at,expires_at,write_window)
VALUES(gen_random_uuid(),'heartbeat-inactive',1,repeat('b',64),clock_timestamp(),clock_timestamp()+interval '1 day',clock_timestamp());
UPDATE public.installation_generations SET deactivated_at=clock_timestamp() WHERE shop_id='heartbeat-inactive';`);
      await client.query(`INSERT INTO public.inbox_messages(id,source,payload,payload_sha256,received_at,state,retention_class,purge_after,erasure_state)
VALUES('33333333-3333-3333-3333-333333333333','shopify',''::bytea,encode(sha256(''::bytea),'hex'),clock_timestamp(),'processed','shopify-webhook',clock_timestamp()+interval '1 day','erased');
INSERT INTO public.customer_privacy_receipts(inbox_id,shop_id,raw_body_sha256,operation,requested_order_count,matched_purchase_count)
VALUES('33333333-3333-3333-3333-333333333333','heartbeat-artwork',encode(sha256(''::bytea),'hex'),'SHOP_ERASURE_BLOCKED',0,0);`);
      const review = counts(await collect(client, Date.now(), 900));
      assert.deepEqual(review, { processing: 2, deletion: 6 });
      await client.query('CREATE ROLE heartbeat_monitor NOLOGIN');
      const grants = readFileSync(
        new URL('../../deployment/alerts/monitor-grants.sql', import.meta.url),
        'utf8',
      ).replaceAll(':"monitor_role"', '"heartbeat_monitor"');
      await client.query(grants);
      await client.query('SET ROLE heartbeat_monitor');
      assert.deepEqual(counts(await collect(client, Date.now(), 900)), { processing: 2, deletion: 6 });
      for (const sql of [
        'SELECT payload FROM public.inbox_messages LIMIT 0',
        'UPDATE public.inbox_messages SET state=state WHERE false',
      ]) {
        let denied = false;
        try {
          await client.query(sql);
        } catch (error) {
          denied = record(error).code === '42501';
        }
        assert(denied, 'monitor privilege boundary failed');
      }
      await client.query('RESET ROLE');
      console.log(JSON.stringify({ empty, populated, review, restricted: review }));
    } else if (mode === 'expiry') {
      const replay = await operation('./backup-expiry.mts', 'replayExpiry');
      const economics = async () =>
        text(
          (
            await client.query<{ hash: unknown }>(
              `SELECT encode(sha256(convert_to(jsonb_build_object('orders',(SELECT jsonb_agg(to_jsonb(p) ORDER BY purchase_id) FROM purchase_orders p),'bindings',(SELECT jsonb_agg(to_jsonb(p) ORDER BY purchase_id) FROM purchase_bindings p),'paid',(SELECT jsonb_agg(to_jsonb(p) ORDER BY purchase_id) FROM purchase_paid_facts p))::text,'UTF8')),'hex') AS hash`,
            )
          ).rows[0]?.hash,
        );
      const history = async () =>
        (
          await client.query(
            `SELECT asset_id::text,collected_at::text,expires_at::text,upload_until::text FROM artwork_assets ORDER BY asset_id`,
          )
        ).rows;
      const before = await economics(),
        dates = JSON.stringify(await history());
      const result = record(await replay(client));
      assert(
        result.databaseExpiryReplayed === true && array(result.keys).length >= 1,
        'actual expired exclusions missing',
      );
      assert.equal(await economics(), before, 'historical purchase changed');
      assert.equal(JSON.stringify(await history()), dates, 'original dates changed');
      const rows = await client.query<{ n: unknown }>(
        `SELECT count(*) AS n FROM buyer_sessions b WHERE expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=b.shop_id AND s.current_generation=b.installation_generation AND i.deactivated_at IS NULL)`,
      );
      assert.equal(rows.rows[0]?.n, '0', 'expiry replay incomplete');
      console.log(
        JSON.stringify({
          databaseExpiryReplayed: true,
          excludedObjects: array(result.keys).length,
          financialHistoryPreserved: true,
          originalDatesPreserved: true,
        }),
      );
    } else throw new Error('Unknown isolated PostgreSQL mode');
  } finally {
    client.release();
    await pool.end();
  }
}
