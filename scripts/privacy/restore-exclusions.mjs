import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const FORMAT = 'insignia-customer-erasure-exclusions-v1';
const MAX_BYTES = 64 * 1024 * 1024;
const keys = {
  receipts: [
    'inbox_id',
    'shop_id',
    'raw_body_sha256',
    'operation',
    'request_id',
    'requested_order_count',
    'matched_purchase_count',
    'staged_at',
  ],
  links: ['inbox_id', 'order_id'],
  orderFences: ['shop_id', 'order_id', 'source_inbox_id', 'created_at'],
  quoteFences: ['shop_id', 'quote_id', 'source_inbox_id', 'created_at'],
  assetFences: ['shop_id', 'asset_id', 'source_inbox_id', 'created_at'],
  inboxes: [
    'id',
    'source',
    'external_delivery_id',
    'shop_id',
    'installation_generation',
    'payload',
    'payload_sha256',
    'received_at',
    'collected_at',
    'state',
    'attempts',
    'last_error_class',
    'lease_owner',
    'lease_until',
    'retention_class',
    'purge_after',
    'erasure_state',
  ],
  shops: ['shop_id', 'shopify_shop_id', 'current_generation'],
  generations: ['shop_id', 'generation', 'authorization_generation', 'external_installation_id'],
};
const copies = [
  ['inboxes', 'inbox_messages', ['id']],
  ['receipts', 'customer_privacy_receipts', ['inbox_id']],
  ['links', 'customer_privacy_order_links', ['inbox_id', 'order_id']],
  ['orderFences', 'customer_order_erasure_fences', ['shop_id', 'order_id']],
  ['quoteFences', 'customer_quote_erasure_fences', ['shop_id', 'quote_id']],
  ['assetFences', 'customer_asset_erasure_fences', ['shop_id', 'asset_id']],
];
const tables = [
  ...copies.map(([, table]) => table),
  'shops',
  'installation_generations',
  'purchase_orders',
  'purchase_bindings',
  'purchase_offer_payloads',
  'purchase_design_payloads',
  'purchase_artwork_events',
  'artwork_assets',
  'quote_proposals',
  'design_drafts',
  'buyer_quote_ownership',
];
const functions = [
  'customer_privacy_payload_assets',
  'customer_privacy_fence_asset',
  'customer_privacy_fence_payload',
  'customer_privacy_fence_quote',
  'process_customer_privacy_inbox',
  'guard_customer_private_ingestion',
  'enforce_payload_collection_time',
];
const hash = (value) =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_key, value) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
          : value,
      ),
    )
    .digest('hex');
const fail = (code) => {
  throw new Error(`Erasure restore HOLD: ${code}`);
};
const exactKeys = (value, expected) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join('|') === [...expected].sort().join('|');

async function owner(client) {
  const result = await client.query(
    `SELECT
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))::integer AS tables,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY($2::text[]) AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))::integer AS functions`,
    [tables, functions],
  );
  if (result.rows[0].tables !== tables.length || result.rows[0].functions !== functions.length)
    fail('schema owner required');
}
async function schemaIdentity(client) {
  const versions = (await client.query('SELECT version::text FROM public.schema_migrations ORDER BY version')).rows;
  const columns = (
    await client.query(
      `SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`,
      [tables],
    )
  ).rows;
  const constraints = (
    await client.query(
      `SELECT c.relname,con.conname,pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,con.conname`,
      [tables],
    )
  ).rows;
  const definitions = (
    await client.query(
      `SELECT p.proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY($1::text[]) ORDER BY p.proname`,
      [functions],
    )
  ).rows;
  const triggers = (
    await client.query(
      `SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
      [tables],
    )
  ).rows;
  return hash({ versions, columns, constraints, definitions, triggers });
}
async function rows(client, query, parameters = []) {
  return (
    await client.query(
      `SELECT coalesce(jsonb_agg(to_jsonb(exported)),'[]'::jsonb) AS rows FROM (${query}) exported`,
      parameters,
    )
  ).rows[0].rows;
}
const staged = "SELECT inbox_id FROM public.customer_privacy_receipts WHERE operation='ERASURE_STAGED'";

/** Private owner export of already committed erasures. Never retained bodies or customer fields. */
export async function exportErasureExclusions(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await owner(client);
    // Verify erasure state before selecting any inbox record into the export.
    if (
      (
        await client.query(
          `SELECT 1 FROM public.customer_privacy_receipts r JOIN public.inbox_messages i ON i.id=r.inbox_id WHERE r.operation='ERASURE_STAGED' AND (r.request_id IS NOT NULL OR i.source<>'shopify' OR i.retention_class<>'shopify-webhook' OR i.erasure_state<>'erased' OR octet_length(i.payload)<>0 OR i.state<>'processed' OR i.payload_sha256<>r.raw_body_sha256 OR i.lease_owner IS NOT NULL OR i.lease_until IS NOT NULL OR i.last_error_class IS NOT NULL OR (i.shop_id IS NOT NULL AND i.shop_id<>r.shop_id)) LIMIT 1`,
        )
      ).rowCount
    )
      fail('source is not a verified erased tombstone');
    const data = {
      schemaIdentity: await schemaIdentity(client),
      exportedAt: (await client.query('SELECT transaction_timestamp()::text AS at')).rows[0].at,
    };
    data.receipts = await rows(client, `${staged.replace('SELECT inbox_id', 'SELECT *')} ORDER BY inbox_id`);
    data.inboxes = await rows(
      client,
      `SELECT i.id,i.source,i.external_delivery_id,i.shop_id,i.installation_generation::text,i.payload,i.payload_sha256,i.received_at,i.collected_at,i.state,i.attempts,i.last_error_class,i.lease_owner,i.lease_until,i.retention_class,i.purge_after,i.erasure_state FROM public.inbox_messages i WHERE i.id IN (${staged}) ORDER BY i.id`,
    );
    data.links = await rows(
      client,
      `SELECT * FROM public.customer_privacy_order_links WHERE inbox_id IN (${staged}) ORDER BY inbox_id,order_id`,
    );
    data.orderFences = await rows(
      client,
      `SELECT * FROM public.customer_order_erasure_fences WHERE source_inbox_id IN (${staged}) ORDER BY shop_id,order_id`,
    );
    data.quoteFences = await rows(
      client,
      `SELECT * FROM public.customer_quote_erasure_fences WHERE source_inbox_id IN (${staged}) ORDER BY shop_id,quote_id`,
    );
    data.assetFences = await rows(
      client,
      `SELECT * FROM public.customer_asset_erasure_fences WHERE source_inbox_id IN (${staged}) ORDER BY shop_id,asset_id`,
    );
    data.shops = await rows(
      client,
      `SELECT shop_id,shopify_shop_id,current_generation::text FROM public.shops WHERE shop_id IN (SELECT shop_id FROM public.customer_privacy_receipts WHERE operation='ERASURE_STAGED') ORDER BY shop_id`,
    );
    data.generations = await rows(
      client,
      `SELECT shop_id,generation::text,authorization_generation::text,external_installation_id FROM public.installation_generations WHERE shop_id IN (SELECT shop_id FROM public.customer_privacy_receipts WHERE operation='ERASURE_STAGED') ORDER BY shop_id,generation`,
    );
    const envelope = { format: FORMAT, sha256: hash(data), data };
    validate(envelope);
    await client.query('COMMIT');
    return envelope;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
function validate(envelope) {
  if (
    Buffer.byteLength(JSON.stringify(envelope)) > MAX_BYTES ||
    !exactKeys(envelope, ['format', 'sha256', 'data']) ||
    envelope.format !== FORMAT ||
    envelope.sha256 !== hash(envelope.data)
  )
    fail('exclusion format or checksum');
  const data = envelope.data;
  if (
    !exactKeys(data, ['schemaIdentity', 'exportedAt', ...Object.keys(keys)]) ||
    !/^[a-f0-9]{64}$/.test(data.schemaIdentity) ||
    !Number.isFinite(Date.parse(data.exportedAt))
  )
    fail('source metadata');
  for (const [collection, fields] of Object.entries(keys)) {
    if (!Array.isArray(data[collection]) || data[collection].some((row) => !exactKeys(row, fields)))
      fail('non-minimal record shape');
  }
  const receipts = new Map(data.receipts.map((r) => [r.inbox_id, r])),
    shops = new Map(data.shops.map((r) => [r.shop_id, r]));
  if (
    receipts.size !== data.receipts.length ||
    shops.size !== data.shops.length ||
    data.inboxes.length !== receipts.size
  )
    fail('duplicate or missing source identity');
  for (const receipt of data.receipts) {
    if (
      receipt.operation !== 'ERASURE_STAGED' ||
      receipt.request_id !== null ||
      !shops.has(receipt.shop_id) ||
      !/^[a-f0-9]{64}$/.test(receipt.raw_body_sha256)
    )
      fail('not a committed erasure');
    const inbox = data.inboxes.find((row) => row.id === receipt.inbox_id);
    if (
      !inbox ||
      inbox.source !== 'shopify' ||
      inbox.retention_class !== 'shopify-webhook' ||
      inbox.erasure_state !== 'erased' ||
      inbox.payload !== '\\x' ||
      inbox.state !== 'processed' ||
      inbox.payload_sha256 !== receipt.raw_body_sha256 ||
      inbox.lease_owner !== null ||
      inbox.lease_until !== null ||
      inbox.last_error_class !== null ||
      (inbox.shop_id !== null && inbox.shop_id !== receipt.shop_id)
    )
      fail('not an actual erased inbox tombstone');
    if (
      new Set(data.links.filter((row) => row.inbox_id === receipt.inbox_id).map((row) => row.order_id)).size !==
      receipt.requested_order_count
    )
      fail('incomplete order exclusions');
  }
  for (const link of data.links) {
    const receipt = receipts.get(link.inbox_id);
    if (
      !receipt ||
      !/^gid:\/\/shopify\/Order\/[1-9][0-9]{0,19}$/.test(link.order_id) ||
      !data.orderFences.some((row) => row.shop_id === receipt.shop_id && row.order_id === link.order_id)
    )
      fail('unbound order exclusion');
  }
  for (const collection of ['orderFences', 'quoteFences', 'assetFences'])
    for (const fence of data[collection])
      if (receipts.get(fence.source_inbox_id)?.shop_id !== fence.shop_id) fail('foreign erasure fence');
  for (const generation of data.generations) if (!shops.has(generation.shop_id)) fail('foreign installation identity');
}
async function copyRows(client, table, primary, values) {
  const expected = `jsonb_populate_recordset(NULL::public.${table},$1::jsonb)`;
  const join = primary.map((key) => `actual.${key}=expected.${key}`).join(' AND ');
  if (
    (
      await client.query(
        `SELECT 1 FROM public.${table} actual JOIN ${expected} expected ON ${join} WHERE to_jsonb(actual) IS DISTINCT FROM to_jsonb(expected) LIMIT 1`,
        [JSON.stringify(values)],
      )
    ).rowCount
  )
    fail('conflicting copied erasure identity');
  await client.query(`INSERT INTO public.${table} SELECT * FROM ${expected} ON CONFLICT DO NOTHING`, [
    JSON.stringify(values),
  ]);
}

/** Administrative copy, not new HMAC authority. Run against an offline restored target only. */
export async function importErasureExclusions(pool, envelope) {
  validate(envelope);
  const data = envelope.data,
    client = await pool.connect();
  try {
    await client.query('BEGIN');
    await owner(client);
    if (
      (
        await client.query(
          `SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() LIMIT 1`,
        )
      ).rowCount
    )
      fail('target is not offline');

    if ((await schemaIdentity(client)) !== data.schemaIdentity) fail('schema mismatch');
    for (const shop of data.shops)
      await client.query('SELECT 1 FROM public.shops WHERE shop_id=$1 FOR UPDATE', [shop.shop_id]);
    // Identity uses copied immutable installation UUIDs, not a newly asserted current installation.
    for (const shop of data.shops) {
      const found = (
        await client.query(
          'SELECT shop_id,shopify_shop_id,current_generation::text FROM public.shops WHERE shop_id=$1',
          [shop.shop_id],
        )
      ).rows[0];
      if (!found || hash(found) !== hash(shop)) fail('missing tenant or shop/generation drift');
      const generations = await rows(
        client,
        `SELECT shop_id,generation::text,authorization_generation::text,external_installation_id FROM public.installation_generations WHERE shop_id=$1 ORDER BY generation`,
        [shop.shop_id],
      );
      if (hash(generations) !== hash(data.generations.filter((row) => row.shop_id === shop.shop_id)))
        fail('installation identity drift');
    }
    const sourceIds = data.receipts.map((row) => row.inbox_id);
    if (
      (
        await client.query(
          "SELECT 1 FROM public.customer_privacy_receipts WHERE operation='ERASURE_STAGED' AND NOT(inbox_id=ANY($1::uuid[])) LIMIT 1",
          [sourceIds],
        )
      ).rowCount
    )
      fail('target has exclusions absent from source copy');
    // A backup may already contain the original pending inbox. Its immutable
    // source identity/hash/deadline must match before copying the actual erased state.
    const mutable = ['payload', 'state', 'attempts', 'last_error_class', 'lease_owner', 'lease_until', 'erasure_state'];
    if (
      (
        await client.query(
          `SELECT 1 FROM public.inbox_messages actual JOIN jsonb_populate_recordset(NULL::public.inbox_messages,$1::jsonb) expected USING(id) WHERE (to_jsonb(actual)-$2::text[]) IS DISTINCT FROM (to_jsonb(expected)-$2::text[]) OR actual.attempts>expected.attempts LIMIT 1`,
          [JSON.stringify(data.inboxes), mutable],
        )
      ).rowCount
    )
      fail('conflicting inbox source identity');
    await client.query(
      `UPDATE public.inbox_messages actual SET payload=expected.payload,state=expected.state,attempts=expected.attempts,last_error_class=NULL,lease_owner=NULL,lease_until=NULL,erasure_state='erased' FROM jsonb_populate_recordset(NULL::public.inbox_messages,$1::jsonb) expected WHERE actual.id=expected.id`,
      [JSON.stringify(data.inboxes)],
    );
    await client.query('LOCK TABLE public.inbox_messages IN ACCESS EXCLUSIVE MODE');
    const collectionGuard = (
      await client.query(
        `SELECT 1 FROM pg_trigger t WHERE t.tgrelid='public.inbox_messages'::regclass AND t.tgname='inbox_collection_guard' AND t.tgfoid='public.enforce_payload_collection_time()'::regprocedure AND t.tgtype=23 AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text=''`,
      )
    ).rowCount;
    if (collectionGuard !== 1) fail('collection trigger identity');
    // Administrative restoration of validated empty metadata only. This exact
    // INSERT trigger otherwise restamps the original collection time. PostgreSQL
    // rolls this DDL back on every failure; all CHECK/FK/other guards remain active.
    await client.query('ALTER TABLE public.inbox_messages DISABLE TRIGGER inbox_collection_guard');
    await copyRows(client, 'inbox_messages', ['id'], data.inboxes);
    await client.query('ALTER TABLE public.inbox_messages ENABLE TRIGGER inbox_collection_guard');
    for (const [collection, table, primary] of copies.slice(1))
      await copyRows(client, table, primary, data[collection]);
    // Reapply against the restored old private payloads. Helpers preserve exact expiry/economics.
    const bound = (
      await client.query(
        `SELECT DISTINCT b.shop_id,b.quote_id,f.source_inbox_id FROM public.purchase_bindings b JOIN public.purchase_orders p USING(purchase_id) JOIN public.customer_order_erasure_fences f ON f.shop_id=p.shop_id AND f.order_id=p.order_id WHERE f.source_inbox_id=ANY($1::uuid[]) ORDER BY b.shop_id,b.quote_id`,
        [sourceIds],
      )
    ).rows;
    for (const row of [...data.quoteFences, ...bound])
      await client.query('SELECT public.customer_privacy_fence_quote($1,$2,$3)', [
        row.shop_id,
        row.quote_id,
        row.source_inbox_id,
      ]);
    const attached = (
      await client.query(
        `SELECT e.shop_id,e.asset_id,f.source_inbox_id FROM public.purchase_artwork_events e JOIN public.purchase_orders p USING(purchase_id) JOIN public.customer_order_erasure_fences f ON f.shop_id=p.shop_id AND f.order_id=p.order_id WHERE e.kind='ATTACH' AND e.erased_at IS NULL AND e.asset_id IS NOT NULL AND f.source_inbox_id=ANY($1::uuid[]) ORDER BY e.shop_id,e.asset_id`,
        [sourceIds],
      )
    ).rows;
    for (const row of [...data.assetFences, ...attached])
      await client.query('SELECT public.customer_privacy_fence_asset($1,$2,$3)', [
        row.shop_id,
        row.asset_id,
        row.source_inbox_id,
      ]);
    await client.query(
      `UPDATE public.purchase_artwork_events e SET asset_id=NULL,placement_id=NULL,group_index=NULL,erased_at=clock_timestamp() FROM public.purchase_orders p,public.customer_order_erasure_fences f WHERE e.purchase_id=p.purchase_id AND f.shop_id=p.shop_id AND f.order_id=p.order_id AND e.kind='ATTACH' AND e.erased_at IS NULL AND f.source_inbox_id=ANY($1::uuid[])`,
      [sourceIds],
    );
    await client.query('COMMIT');
    return {
      readiness: 'HOLD_STORAGE_AND_AUTHORITY_REQUALIFICATION',
      receipts: data.receipts.length,
      orders: data.orderFences.length,
      assets: data.assetFences.length,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function writeExclusions(path, envelope) {
  validate(envelope);
  const file = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(JSON.stringify(envelope));
    await file.sync();
  } finally {
    await file.close();
  }
  const directory = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
export async function readExclusions(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0 || stat.size > MAX_BYTES)
      fail('private owner exclusion file required');
    const envelope = JSON.parse(await file.readFile('utf8'));
    validate(envelope);
    return envelope;
  } finally {
    await file.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { Pool } = createRequire(new URL('../../apps/worker/package.json', import.meta.url))('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const [action, path] = process.argv.slice(2);
    if (!process.env.DATABASE_URL || !path || !['export', 'import'].includes(action))
      fail('explicit owner target and private file required');
    if (action === 'export') {
      const envelope = await exportErasureExclusions(pool);
      await writeExclusions(path, envelope);
      console.log(
        JSON.stringify({ exportedReceipts: envelope.data.receipts.length, coverageAt: envelope.data.exportedAt }),
      );
    } else console.log(JSON.stringify(await importErasureExclusions(pool, await readExclusions(path))));
  } catch {
    console.error('Erasure exclusion operation failed; restore readiness remains HOLD.');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
