import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Pool, PoolClient } from 'pg';
import { clearRestoredWebhookJobs } from './restore-webhook-queue.mts';

const FORMAT = 'insignia-privacy-erasure-exclusions-v2';
const MAX_BYTES = 64 * 1024 * 1024;
const keys = {
  shopIdentities: ['shop_id', 'domain_digest', 'provider_digest'],
  shopReplays: [
    'inbox_id',
    'delivery_digest',
    'content_digest',
    'forget_at',
    'uninstall_domain_digest',
    'uninstall_observed_at',
  ],
  uninstallScopes: ['privacy_inbox_id', 'shop_id', 'generation_ceiling', 'observed_at', 'observation_kind'],
  uninstallRecoveries: [
    'privacy_inbox_id',
    'shop_id',
    'installation_generation',
    'uninstall_inbox_id',
    'capability_digest',
    'external_installation_id',
    'decided_at',
  ],
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
  shopFences: ['shop_id', 'installation_generation', 'source_inbox_id', 'created_at'],
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
  generations: ['shop_id', 'generation', 'authorization_generation', 'external_installation_id', 'deactivated_at'],
} as const;
const copies = [
  ['inboxes', 'inbox_messages', ['id']],
  ['receipts', 'customer_privacy_receipts', ['inbox_id']],
  ['uninstallScopes', 'uninstall_privacy_scopes', ['privacy_inbox_id']],
  ['uninstallRecoveries', 'uninstall_privacy_recoveries', ['privacy_inbox_id', 'shop_id', 'installation_generation']],
  ['links', 'customer_privacy_order_links', ['inbox_id', 'order_id']],
  ['shopFences', 'shop_privacy_fences', ['shop_id', 'installation_generation']],
  ['orderFences', 'customer_order_erasure_fences', ['shop_id', 'order_id']],
  ['quoteFences', 'customer_quote_erasure_fences', ['shop_id', 'quote_id']],
  ['assetFences', 'customer_asset_erasure_fences', ['shop_id', 'asset_id']],
] as const;
const tables = [
  ...copies.map(([, table]) => table),
  'shops',
  'installation_generations',
  'purchase_orders',
  'customer_artwork_epoch',
  'customer_artwork_grants',
  'customer_artwork_submissions',
  'customer_artwork_notifications',
  'merchant_preferences',
  'purchase_order_labels',
  'purchase_bindings',
  'purchase_offer_payloads',
  'purchase_design_payloads',
  'purchase_artwork_events',
  'artwork_assets',
  'quote_proposals',
  'design_drafts',
  'buyer_quote_ownership',
  'buyer_sessions',
  'shopify_webhook_deliveries',
  'shopify_expired_transport',
  'webhook_obligation_facts',
  'shop_privacy_finalization',
  'shop_privacy_identity',
  'shop_privacy_replays',
  'shop_privacy_proof_key',
  'shop_privacy_finalization_targets',
  'shop_privacy_transport_scope',
];
const functions = [
  'customer_privacy_payload_assets',
  'customer_privacy_fence_asset',
  'customer_privacy_fence_payload',
  'customer_privacy_fence_quote',
  'process_customer_privacy_inbox',
  'stage_customer_privacy_inbox',
  'stage_shop_privacy_inbox',
  'cleanup_customer_privacy_inboxes',
  'privacy_webhook_identity',
  'read_customer_privacy_requests',
  'read_customer_privacy_order_links',
  'export_customer_privacy_order',
  'guard_customer_private_ingestion',
  'snapshot_uninstall_privacy_scope',
  'recover_uninstall_privacy',
  'recover_pending_uninstall_privacy',
  'uninstall_privacy_status',
  'plan_customer_artwork_notification',
  'erase_customer_artwork_for_payload',
  'erase_customer_artwork_authority',
  'erase_method_catalog_for_shop_privacy',
  'erase_merchant_preferences_for_shop_privacy',
  'erase_purchase_labels_for_order_privacy',
  'erase_purchase_labels_for_shop_privacy',
  'enforce_payload_collection_time',
  'guard_webhook_obligation_facts',
  'finalize_shop_privacy_generation',
  'shop_privacy_digest',
  'shop_privacy_installation_token',
  'shop_privacy_replay_digest',
  'compact_erased_shopify_delivery',
  'expire_shopify_webhook_routes',
  'pending_shopify_webhook_obligations',
  'finalize_pending_shop_privacy',
  'shop_privacy_delete_scope',
  'reject_quote_mutation',
  'reject_revision_mutation',
  'guard_uninstall_destination_delete',
];
type ScalarKind = 'text' | 'nullableText' | 'integer';
const scalarTypes = {
  shopIdentities: { shop_id: 'text', domain_digest: 'text', provider_digest: 'nullableText' },
  shopReplays: {
    inbox_id: 'text',
    delivery_digest: 'text',
    content_digest: 'text',
    forget_at: 'text',
    uninstall_domain_digest: 'nullableText',
    uninstall_observed_at: 'nullableText',
  },
  uninstallScopes: {
    privacy_inbox_id: 'text',
    shop_id: 'text',
    generation_ceiling: 'text',
    observed_at: 'text',
    observation_kind: 'text',
  },
  uninstallRecoveries: {
    privacy_inbox_id: 'text',
    shop_id: 'text',
    installation_generation: 'text',
    uninstall_inbox_id: 'text',
    capability_digest: 'text',
    external_installation_id: 'text',
    decided_at: 'text',
  },
  receipts: {
    inbox_id: 'text',
    shop_id: 'text',
    raw_body_sha256: 'text',
    operation: 'text',
    request_id: 'nullableText',
    requested_order_count: 'integer',
    matched_purchase_count: 'integer',
    staged_at: 'text',
  },
  links: { inbox_id: 'text', order_id: 'text' },
  shopFences: { shop_id: 'text', installation_generation: 'text', source_inbox_id: 'text', created_at: 'text' },
  orderFences: { shop_id: 'text', order_id: 'text', source_inbox_id: 'text', created_at: 'text' },
  quoteFences: { shop_id: 'text', quote_id: 'text', source_inbox_id: 'text', created_at: 'text' },
  assetFences: { shop_id: 'text', asset_id: 'text', source_inbox_id: 'text', created_at: 'text' },
  inboxes: {
    id: 'text',
    source: 'text',
    external_delivery_id: 'nullableText',
    shop_id: 'nullableText',
    installation_generation: 'nullableText',
    payload: 'text',
    payload_sha256: 'text',
    received_at: 'text',
    collected_at: 'text',
    state: 'text',
    attempts: 'integer',
    last_error_class: 'nullableText',
    lease_owner: 'nullableText',
    lease_until: 'nullableText',
    retention_class: 'text',
    purge_after: 'text',
    erasure_state: 'text',
  },
  shops: { shop_id: 'text', shopify_shop_id: 'nullableText', current_generation: 'text' },
  generations: {
    shop_id: 'text',
    generation: 'text',
    authorization_generation: 'text',
    external_installation_id: 'nullableText',
    deactivated_at: 'nullableText',
  },
} as const satisfies { [C in keyof typeof keys]: { [F in (typeof keys)[C][number]]: ScalarKind } };
type ScalarValue<K> = K extends 'integer' ? number : K extends 'nullableText' ? string | null : string;
type Row<C extends keyof typeof scalarTypes> = {
  [F in keyof (typeof scalarTypes)[C]]: ScalarValue<(typeof scalarTypes)[C][F]>;
};
const optionalCollections = ['uninstallScopes', 'uninstallRecoveries', 'shopIdentities', 'shopReplays'] as const;
type OptionalCollection = (typeof optionalCollections)[number];
export type ExclusionData = Record<string, unknown> & {
  schemaIdentity: string;
  exportedAt: string;
  proofKeyId?: string;
} & { [C in Exclude<keyof typeof scalarTypes, OptionalCollection>]: Row<C>[] } & {
  [C in OptionalCollection]?: Row<C>[];
};
export interface ExclusionEnvelope {
  format: typeof FORMAT;
  sha256: string;
  data: ExclusionData;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
function assertDataShape(data: Record<string, unknown>): asserts data is ExclusionData {
  if (typeof data.schemaIdentity !== 'string' || typeof data.exportedAt !== 'string') fail('source metadata');
  for (const [collection, schema] of Object.entries(scalarTypes)) {
    const values = data[collection];
    if ((optionalCollections as readonly string[]).includes(collection) && values === undefined) continue;
    if (!isArray(values)) fail('non-minimal record shape');
    for (const row of values) {
      if (!exactKeys(row, Object.keys(schema))) fail('non-minimal record shape');
      for (const [field, kind] of Object.entries(schema)) {
        const value = row[field];
        if (
          kind === 'integer'
            ? typeof value !== 'number' || !Number.isSafeInteger(value)
            : kind === 'nullableText'
              ? value !== null && typeof value !== 'string'
              : typeof value !== 'string'
        )
          fail('invalid record scalar');
      }
    }
  }
}
const hash = (value: unknown) =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_key: string, value: unknown) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
          : value,
      ),
    )
    .digest('hex');
function fail(code: string): never {
  throw new Error(`Erasure restore HOLD: ${code}`);
}
const exactKeys = (value: unknown, expected: readonly string[]): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join('|') === [...expected].sort().join('|');

async function owner(client: PoolClient) {
  const result = await client.query<{ tables: unknown; functions: unknown }>(
    `SELECT
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))::integer AS tables,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY($2::text[]) AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))::integer AS functions`,
    [tables, functions],
  );
  if (result.rows[0]?.tables !== tables.length || result.rows[0]?.functions !== functions.length)
    fail('schema owner required');
}
async function schemaIdentity(client: PoolClient) {
  const versions = (
    await client.query<{ version: string }>('SELECT version::text FROM public.schema_migrations ORDER BY version')
  ).rows;
  const columns = (
    await client.query<{ relname: string; attname: string; type: string; attnotnull: boolean }>(
      `SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`,
      [tables],
    )
  ).rows;
  const constraints = (
    await client.query<{ relname: string; conname: string; definition: string }>(
      `SELECT c.relname,con.conname,pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,con.conname`,
      [tables],
    )
  ).rows;
  // pg_dump reparses existing nested AND checks into equivalent flat forms.
  // Normalize only these known expression pairs, never arbitrary checks.
  for (const row of constraints) {
    if (
      row.relname === 'shopify_webhook_deliveries' &&
      row.conname === 'shopify_webhook_deliveries_shop_domain_check'
    ) {
      const flat =
        "CHECK (((length(shop_domain) >= 16) AND (length(shop_domain) <= 253) AND (shop_domain = lower(shop_domain)) AND (shop_domain ~~ '%.myshopify.com'::text)))";
      const nested =
        "CHECK ((((length(shop_domain) >= 16) AND (length(shop_domain) <= 253)) AND (shop_domain = lower(shop_domain)) AND (shop_domain ~~ '%.myshopify.com'::text)))";
      if (row.definition === nested) row.definition = flat;
    }
    if (row.relname === 'purchase_order_labels' && row.conname === 'purchase_order_labels_order_name_check') {
      const flat =
        "CHECK (((order_name IS NULL) OR ((char_length(order_name) >= 1) AND (char_length(order_name) <= 512) AND (order_name !~ '[[:cntrl:]]'::text))))";
      const nested =
        "CHECK (((order_name IS NULL) OR (((char_length(order_name) >= 1) AND (char_length(order_name) <= 512)) AND (order_name !~ '[[:cntrl:]]'::text))))";
      if (row.definition === nested) row.definition = flat;
    }
  }
  const definitions = (
    await client.query<{ proname: string; definition: string }>(
      `SELECT p.proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY($1::text[]) ORDER BY p.proname`,
      [functions],
    )
  ).rows;
  const triggers = (
    await client.query<{ relname: string; tgname: string; tgenabled: string; definition: string }>(
      `SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
      [tables],
    )
  ).rows;
  const views = (
    await client.query<{ relname: string; definition: string }>(
      `SELECT c.relname,pg_get_viewdef(c.oid) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind='v' AND c.relname=ANY($1::text[]) ORDER BY c.relname`,
      [tables],
    )
  ).rows;
  return hash({ versions, columns, constraints, definitions, triggers, views });
}
async function rows(client: PoolClient, query: string, parameters: unknown[] = []): Promise<unknown> {
  return (
    await client.query<{ rows: unknown }>(
      `SELECT coalesce(jsonb_agg(to_jsonb(exported)),'[]'::jsonb) AS rows FROM (${query}) exported`,
      parameters,
    )
  ).rows[0]?.rows;
}
async function proofKeyId(client: PoolClient) {
  const result = await client.query<{ id: string }>(
    "SELECT public.shop_privacy_digest(jsonb_build_array('restore-key-identity')) AS id",
  );
  return result.rows[0]?.id ?? fail('missing compact erasure proof key');
}
const receiptIds = 'SELECT inbox_id FROM public.customer_privacy_receipts';
const emptyShopify =
  "SELECT id FROM public.inbox_messages WHERE source='shopify' AND retention_class='shopify-webhook' AND erasure_state='erased' AND octet_length(payload)=0";
const coveredShops = `SELECT shop_id FROM public.customer_privacy_receipts UNION SELECT shop_id FROM public.inbox_messages WHERE id IN (${emptyShopify}) AND shop_id IS NOT NULL`;

/** Private owner export of already committed erasures. Never retained bodies or customer fields. */
export async function exportErasureExclusions(pool: Pick<Pool, 'connect'>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await owner(client);
    // Verify erasure state before selecting any inbox record into the export.
    if (
      (
        await client.query(
          `SELECT 1 FROM public.customer_privacy_receipts r JOIN public.inbox_messages i ON i.id=r.inbox_id WHERE (i.source<>'shopify' OR i.retention_class<>'shopify-webhook' OR i.erasure_state<>'erased' OR octet_length(i.payload)<>0 OR i.state<>'processed' OR i.payload_sha256<>r.raw_body_sha256 OR i.lease_owner IS NOT NULL OR i.lease_until IS NOT NULL OR i.last_error_class IS NOT NULL OR (i.shop_id IS NOT NULL AND i.shop_id<>r.shop_id)) LIMIT 1`,
        )
      ).rowCount
    )
      fail('source is not a verified erased tombstone');
    // Transport exclusion is not permission to discard a pending obligation.
    // Legacy expiration retains minimal facts; require separate qualification
    // rather than copying a tombstone that would erase those facts on restore.
    if (
      (
        await client.query(
          `SELECT 1 FROM public.webhook_obligation_facts WHERE inbox_id IN (${emptyShopify}) AND (facts_erased_at IS NULL OR captured_fields<>'{}'::jsonb) LIMIT 1`,
        )
      ).rowCount
    )
      fail('unresolved transport obligation requires separate restore qualification');
    const data: Record<string, unknown> = {
      schemaIdentity: await schemaIdentity(client),
      proofKeyId: await proofKeyId(client),
      exportedAt: (await client.query<{ at: unknown }>('SELECT transaction_timestamp()::text AS at')).rows[0]?.at,
    };
    data.receipts = await rows(client, 'SELECT * FROM public.customer_privacy_receipts ORDER BY inbox_id');
    data.uninstallScopes = await rows(
      client,
      'SELECT privacy_inbox_id,shop_id,generation_ceiling::text,observed_at,observation_kind FROM public.uninstall_privacy_scopes ORDER BY privacy_inbox_id',
    );
    data.uninstallRecoveries = await rows(
      client,
      `SELECT privacy_inbox_id,shop_id,installation_generation::text,uninstall_inbox_id,capability_digest,external_installation_id,decided_at FROM public.uninstall_privacy_recoveries ORDER BY privacy_inbox_id,shop_id,installation_generation`,
    );
    data.shopIdentities = await rows(
      client,
      `SELECT p.* FROM public.shop_privacy_identity p JOIN public.shops s USING(shop_id)
       WHERE s.shop_domain=s.shop_id||'.erased.invalid' ORDER BY p.shop_id`,
    );
    data.shopReplays = await rows(
      client,
      'SELECT * FROM public.shop_privacy_replays WHERE forget_at>transaction_timestamp() ORDER BY inbox_id',
    );
    data.inboxes = await rows(
      client,
      `SELECT i.id,i.source,i.external_delivery_id,i.shop_id,i.installation_generation::text,i.payload,i.payload_sha256,i.received_at,i.collected_at,i.state,i.attempts,i.last_error_class,i.lease_owner,i.lease_until,i.retention_class,i.purge_after,i.erasure_state FROM public.inbox_messages i WHERE i.id IN (${emptyShopify}) ORDER BY i.id`,
    );
    data.links = await rows(
      client,
      `SELECT l.* FROM public.customer_privacy_order_links l JOIN public.customer_privacy_receipts r USING(inbox_id)
        WHERE r.operation<>'SHOP_ERASURE_STAGED' ORDER BY l.inbox_id,l.order_id`,
    );
    data.shopFences = await rows(
      client,
      `SELECT shop_id,installation_generation::text,source_inbox_id,created_at FROM public.shop_privacy_fences WHERE source_inbox_id IN (${receiptIds}) ORDER BY shop_id,installation_generation`,
    );
    // A BLOCKED receipt gains no arbitrary order/quote/asset authority from a
    // recovery. Its exact-generation shop fence rederives those targets on import.
    data.orderFences = await rows(
      client,
      `SELECT f.* FROM public.customer_order_erasure_fences f JOIN public.customer_privacy_receipts r ON r.inbox_id=f.source_inbox_id
        WHERE r.operation='ERASURE_STAGED' ORDER BY f.shop_id,f.order_id`,
    );
    data.quoteFences = await rows(
      client,
      `SELECT * FROM public.customer_quote_erasure_fences WHERE source_inbox_id IN (${receiptIds}) AND source_inbox_id NOT IN (SELECT inbox_id FROM public.customer_privacy_receipts WHERE operation='SHOP_ERASURE_BLOCKED') ORDER BY shop_id,quote_id`,
    );
    data.assetFences = await rows(
      client,
      `SELECT * FROM public.customer_asset_erasure_fences WHERE source_inbox_id IN (${receiptIds}) AND source_inbox_id NOT IN (SELECT inbox_id FROM public.customer_privacy_receipts WHERE operation='SHOP_ERASURE_BLOCKED') ORDER BY shop_id,asset_id`,
    );
    data.shops = await rows(
      client,
      `SELECT shop_id,shopify_shop_id,current_generation::text FROM public.shops WHERE shop_id IN (${coveredShops}) ORDER BY shop_id`,
    );
    data.generations = await rows(
      client,
      `SELECT shop_id,generation::text,authorization_generation::text,external_installation_id,deactivated_at FROM public.installation_generations WHERE shop_id IN (${coveredShops}) ORDER BY shop_id,generation`,
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
function validate(envelope: unknown): asserts envelope is ExclusionEnvelope {
  if (
    Buffer.byteLength(JSON.stringify(envelope)) > MAX_BYTES ||
    !exactKeys(envelope, ['format', 'sha256', 'data']) ||
    envelope.format !== FORMAT ||
    envelope.sha256 !== hash(envelope.data)
  )
    fail('exclusion format or checksum');
  const data = envelope.data;
  if (!isRecord(data)) fail('source metadata');
  if (
    !exactKeys(data, [
      'schemaIdentity',
      'exportedAt',
      ...(data.proofKeyId === undefined ? [] : ['proofKeyId']),
      ...Object.keys(keys).filter(
        (key) => !(optionalCollections as readonly string[]).includes(key) || data[key] !== undefined,
      ),
    ]) ||
    typeof data.schemaIdentity !== 'string' ||
    typeof data.exportedAt !== 'string' ||
    !/^[a-f0-9]{64}$/.test(data.schemaIdentity) ||
    !Number.isFinite(Date.parse(data.exportedAt))
  )
    fail('source metadata');
  assertDataShape(data);
  const receipts = new Map(data.receipts.map((r) => [r.inbox_id, r])),
    shops = new Map(data.shops.map((r) => [r.shop_id, r]));
  if (
    receipts.size !== data.receipts.length ||
    shops.size !== data.shops.length ||
    new Set(data.inboxes.map((r) => r.id)).size !== data.inboxes.length
  )
    fail('duplicate or missing source identity');
  for (const receipt of data.receipts) {
    if (
      !['ERASURE_STAGED', 'DATA_REQUEST_PENDING_EXPORT', 'SHOP_ERASURE_STAGED', 'SHOP_ERASURE_BLOCKED'].includes(
        receipt.operation,
      ) ||
      (receipt.operation === 'DATA_REQUEST_PENDING_EXPORT'
        ? !/^[1-9][0-9]{0,19}$/.test(receipt.request_id ?? '')
        : receipt.request_id !== null) ||
      !shops.has(receipt.shop_id) ||
      !/^[a-f0-9]{64}$/.test(receipt.raw_body_sha256)
    )
      fail('not a committed erasure');
    const inbox = data.inboxes.find((row) => row.id === receipt.inbox_id);
    if (
      !inbox ||
      inbox.payload_sha256 !== receipt.raw_body_sha256 ||
      (inbox.shop_id !== null && inbox.shop_id !== receipt.shop_id)
    )
      fail('not an actual erased inbox tombstone');
    const orders = new Set(data.links.filter((row) => row.inbox_id === receipt.inbox_id).map((row) => row.order_id));
    if (orders.size !== (receipt.operation === 'SHOP_ERASURE_STAGED' ? 0 : receipt.requested_order_count))
      fail('incomplete order exclusions');
  }
  for (const link of data.links) {
    const receipt = receipts.get(link.inbox_id);
    if (
      !receipt ||
      !/^gid:\/\/shopify\/Order\/[1-9][0-9]{0,19}$/.test(link.order_id) ||
      (receipt.operation !== 'DATA_REQUEST_PENDING_EXPORT' &&
        !data.orderFences.some((row) => row.shop_id === receipt.shop_id && row.order_id === link.order_id)) ||
      receipt.operation === 'SHOP_ERASURE_BLOCKED'
    )
      fail('unbound order exclusion');
  }
  for (const inbox of data.inboxes) {
    if (
      inbox.source !== 'shopify' ||
      inbox.retention_class !== 'shopify-webhook' ||
      inbox.erasure_state !== 'erased' ||
      inbox.payload !== '\\x' ||
      inbox.state !== 'processed' ||
      !/^[a-f0-9]{64}$/.test(inbox.payload_sha256) ||
      inbox.lease_owner !== null ||
      inbox.lease_until !== null ||
      inbox.last_error_class !== null ||
      (inbox.shop_id !== null && !shops.has(inbox.shop_id))
    )
      fail('not an actual erased inbox tombstone');
  }
  const digest = /^[a-f0-9]{64}$/;
  const compactIdentities = data.shopIdentities ?? [];
  const compactReplays = data.shopReplays ?? [];
  if (
    (data.proofKeyId !== undefined && (typeof data.proofKeyId !== 'string' || !digest.test(data.proofKeyId))) ||
    ((compactIdentities.length > 0 ||
      compactReplays.length > 0 ||
      data.generations.some((row) => row.external_installation_id?.startsWith('erased:'))) &&
      data.proofKeyId === undefined)
  )
    fail('invalid compact proof key identity');
  if (
    new Set(compactIdentities.map((row) => row.shop_id)).size !== compactIdentities.length ||
    new Set(compactReplays.map((row) => row.inbox_id)).size !== compactReplays.length ||
    new Set(compactReplays.map((row) => row.delivery_digest)).size !== compactReplays.length
  )
    fail('duplicate compact erasure proof');
  for (const proof of compactIdentities) {
    const shop = shops.get(proof.shop_id);
    if (
      !shop ||
      shop.shopify_shop_id !== null ||
      !digest.test(proof.domain_digest) ||
      (proof.provider_digest !== null && !digest.test(proof.provider_digest)) ||
      !data.shopFences.some(
        (fence) => fence.shop_id === shop.shop_id && fence.installation_generation === shop.current_generation,
      )
    )
      fail('unbound compact tenant identity');
  }
  for (const proof of compactReplays) {
    const inbox = data.inboxes.find((row) => row.id === proof.inbox_id);
    if (
      !inbox ||
      inbox.external_delivery_id !== null ||
      proof.forget_at !== inbox.purge_after ||
      !digest.test(proof.delivery_digest) ||
      !digest.test(proof.content_digest) ||
      (proof.uninstall_domain_digest === null) !== (proof.uninstall_observed_at === null) ||
      (proof.uninstall_domain_digest !== null &&
        (!digest.test(proof.uninstall_domain_digest) ||
          !Number.isFinite(Date.parse(proof.uninstall_observed_at ?? ''))))
    )
      fail('unbound compact delivery proof');
  }
  const scopes = data.uninstallScopes ?? [];
  if (new Set(scopes.map((scope) => scope.privacy_inbox_id)).size !== scopes.length) fail('duplicate privacy scope');
  for (const scope of scopes) {
    const receipt = receipts.get(scope.privacy_inbox_id);
    if (
      receipt?.shop_id !== scope.shop_id ||
      !['SHOP_ERASURE_BLOCKED', 'SHOP_ERASURE_STAGED'].includes(receipt?.operation ?? '') ||
      !['original_processing', 'legacy_recovery'].includes(scope.observation_kind) ||
      typeof scope.generation_ceiling !== 'string' ||
      !/^[1-9][0-9]{0,18}$/.test(scope.generation_ceiling) ||
      !data.generations.some((g) => g.shop_id === scope.shop_id && g.generation === scope.generation_ceiling) ||
      !Number.isFinite(Date.parse(scope.observed_at)) ||
      Date.parse(scope.observed_at) < Date.parse(receipt.staged_at)
    )
      fail('unbound privacy scope');
  }
  const recoveries = data.uninstallRecoveries ?? [];
  for (const recovery of recoveries) {
    if (
      typeof recovery.installation_generation !== 'string' ||
      !/^[1-9][0-9]{0,18}$/.test(recovery.installation_generation)
    )
      fail('invalid recovery generation');
    const scope = scopes.find((scope) => scope.privacy_inbox_id === recovery.privacy_inbox_id);
    if (
      data.uninstallScopes !== undefined &&
      (!scope || BigInt(recovery.installation_generation) > BigInt(scope.generation_ceiling))
    )
      fail('recovery exceeds privacy scope');
    const generation = data.generations.find(
      (g) => g.shop_id === recovery.shop_id && g.generation === recovery.installation_generation,
    );
    if (
      !generation?.deactivated_at ||
      generation.external_installation_id !== recovery.external_installation_id ||
      !['SHOP_ERASURE_BLOCKED', 'SHOP_ERASURE_STAGED'].includes(
        receipts.get(recovery.privacy_inbox_id)?.operation ?? '',
      ) ||
      receipts.get(recovery.privacy_inbox_id)?.shop_id !== recovery.shop_id ||
      !/^[a-f0-9]{64}$/.test(recovery.capability_digest) ||
      !/^[a-f0-9-]{36}$/.test(recovery.uninstall_inbox_id) ||
      !Number.isFinite(Date.parse(recovery.decided_at)) ||
      Date.parse(recovery.decided_at) < Date.parse(generation.deactivated_at)
    )
      fail('unbound uninstall recovery');
  }
  const recovered = (inbox: string, shop: string, generation?: string) =>
    recoveries.some(
      (r) =>
        r.privacy_inbox_id === inbox &&
        r.shop_id === shop &&
        (generation === undefined || r.installation_generation === generation),
    );
  for (const collection of ['shopFences', 'orderFences', 'quoteFences', 'assetFences'] as const)
    for (const fence of data[collection])
      if (
        receipts.get(fence.source_inbox_id)?.shop_id !== fence.shop_id ||
        (!['ERASURE_STAGED', 'SHOP_ERASURE_STAGED'].includes(receipts.get(fence.source_inbox_id)?.operation ?? '') &&
          !(
            collection === 'shopFences' &&
            receipts.get(fence.source_inbox_id)?.operation === 'SHOP_ERASURE_BLOCKED' &&
            recovered(
              fence.source_inbox_id,
              fence.shop_id,
              'installation_generation' in fence ? fence.installation_generation : undefined,
            )
          ))
      )
        fail('foreign erasure fence');
  if (data.orderFences.some((fence) => receipts.get(fence.source_inbox_id)?.operation !== 'ERASURE_STAGED'))
    fail('shop exclusion must use generation authority');
  for (const fence of data.shopFences) {
    if (fence.installation_generation !== '1') fail('shop erasure successor authority unverified');
    const generation = data.generations.find(
      (g) => g.shop_id === fence.shop_id && g.generation === fence.installation_generation,
    );
    if (
      (receipts.get(fence.source_inbox_id)?.operation !== 'SHOP_ERASURE_STAGED' &&
        !recovered(
          fence.source_inbox_id,
          fence.shop_id,
          'installation_generation' in fence ? fence.installation_generation : undefined,
        )) ||
      !generation ||
      !generation.deactivated_at
    )
      fail('unbound shop erasure fence');
  }
  for (const generation of data.generations) if (!shops.has(generation.shop_id)) fail('foreign installation identity');
}
async function copyRows(client: PoolClient, table: string, primary: readonly string[], values: unknown) {
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
    JSON.stringify(values ?? []),
  ]);
}

/** Administrative copy, not new HMAC authority. Run against an offline restored target only. */
export async function importErasureExclusions(pool: Pick<Pool, 'connect'>, envelope: unknown) {
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
    if (data.proofKeyId !== undefined && (await proofKeyId(client)) !== data.proofKeyId)
      fail('compact erasure proof key drift');
    // Restoring an old backup cannot replay prior customer capabilities or email delivery intents.
    await client.query('DELETE FROM public.customer_artwork_notifications');
    await client.query('DELETE FROM public.customer_artwork_submissions');
    await client.query('DELETE FROM public.customer_artwork_grants');
    await client.query('UPDATE public.customer_artwork_epoch SET value=gen_random_uuid() WHERE singleton=true');
    for (const shop of data.shops)
      await client.query('SELECT 1 FROM public.shops WHERE shop_id=$1 FOR UPDATE', [shop.shop_id]);
    // Identity uses copied immutable installation UUIDs, not a newly asserted current installation.
    for (const shop of data.shops) {
      const found = (
        await client.query<Row<'shops'>>(
          'SELECT shop_id,shopify_shop_id,current_generation::text FROM public.shops WHERE shop_id=$1',
          [shop.shop_id],
        )
      ).rows[0];
      if (!found || found.current_generation !== shop.current_generation)
        fail('missing tenant or shop/generation drift');
      const compact = data.shopIdentities?.find((row) => row.shop_id === shop.shop_id);
      if (compact) {
        const match = await client.query(
          `SELECT 1 FROM public.shops s WHERE s.shop_id=$1 AND
           ((s.shop_domain=s.shop_id||'.erased.invalid' AND s.shopify_shop_id IS NULL AND EXISTS(
              SELECT 1 FROM public.shop_privacy_identity p WHERE p.shop_id=s.shop_id
                AND p.domain_digest=$2 AND p.provider_digest IS NOT DISTINCT FROM $3::text))
            OR (public.shop_privacy_digest(jsonb_build_array('shop-domain',s.shop_domain))=$2
              AND CASE WHEN s.shopify_shop_id IS NOT NULL
                THEN public.shop_privacy_digest(jsonb_build_array('shop-provider',s.shopify_shop_id)) END
                    IS NOT DISTINCT FROM $3::text))`,
          [shop.shop_id, compact.domain_digest, compact.provider_digest],
        );
        if (!match.rowCount) fail('compact tenant identity drift');
      } else if (found.shopify_shop_id !== shop.shopify_shop_id) fail('missing tenant or shop/generation drift');
      const expected = data.generations.filter((row) => row.shop_id === shop.shop_id);
      const generations = await rows(
        client,
        `SELECT i.shop_id,i.generation::text,i.authorization_generation::text,
            CASE WHEN e.external_installation_id LIKE 'erased:%' AND i.external_installation_id NOT LIKE 'erased:%'
              THEN public.shop_privacy_installation_token(i.shop_id,i.external_installation_id)
              ELSE i.external_installation_id END AS external_installation_id,i.deactivated_at
          FROM public.installation_generations i
          LEFT JOIN jsonb_populate_recordset(NULL::public.installation_generations,$2::jsonb) e
            ON e.shop_id=i.shop_id AND e.generation=i.generation
          WHERE i.shop_id=$1 ORDER BY i.generation`,
        [shop.shop_id, JSON.stringify(expected)],
      );
      if (hash(generations) !== hash(expected)) fail('installation identity drift');
    }
    if (
      (
        await client.query(
          'SELECT 1 FROM public.uninstall_privacy_scopes WHERE NOT(privacy_inbox_id=ANY($1::uuid[])) LIMIT 1',
          [(data.uninstallScopes ?? []).map((scope) => scope.privacy_inbox_id)],
        )
      ).rowCount
    )
      fail('target privacy scopes absent from source');
    const sourceIds = data.receipts.map((row) => row.inbox_id);
    if (
      (
        await client.query(
          'SELECT 1 FROM public.customer_privacy_receipts WHERE NOT(inbox_id=ANY($1::uuid[])) LIMIT 1',
          [sourceIds],
        )
      ).rowCount
    )
      fail('target has exclusions absent from source copy');
    // A backup may already contain the original pending inbox. Its immutable
    // source identity/hash/deadline must match before copying the actual erased state.
    const mutable = [
      'external_delivery_id',
      'payload',
      'state',
      'attempts',
      'last_error_class',
      'lease_owner',
      'lease_until',
      'erasure_state',
      'next_attempt_at',
    ];
    if (
      (
        await client.query(
          `SELECT 1 FROM public.inbox_messages actual JOIN jsonb_populate_recordset(NULL::public.inbox_messages,$1::jsonb) expected USING(id) WHERE (to_jsonb(actual)-$2::text[]) IS DISTINCT FROM (to_jsonb(expected)-$2::text[])
          OR (expected.external_delivery_id IS NOT NULL
            AND actual.external_delivery_id IS DISTINCT FROM expected.external_delivery_id
            AND NOT (actual.external_delivery_id IS NULL AND EXISTS (
              SELECT 1 FROM public.shop_privacy_replays r WHERE r.inbox_id=actual.id
                AND r.delivery_digest=public.shop_privacy_digest(jsonb_build_array('webhook-delivery',
                  split_part(expected.external_delivery_id,':',1),
                  substr(expected.external_delivery_id,strpos(expected.external_delivery_id,':')+1))))))
          OR actual.attempts>expected.attempts LIMIT 1`,
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
    await client.query(
      `INSERT INTO public.inbox_messages
       SELECT * FROM jsonb_populate_recordset(NULL::public.inbox_messages,$1::jsonb) ON CONFLICT(id) DO NOTHING`,
      [JSON.stringify(data.inboxes)],
    );
    await client.query('ALTER TABLE public.inbox_messages ENABLE TRIGGER inbox_collection_guard');
    for (const [collection, table, primary] of copies.slice(1)) {
      if (
        collection === 'shopFences' &&
        (
          await client.query(
            `SELECT 1 FROM unnest($1::text[]) AS shops(shop_id)
             WHERE public.shop_privacy_has_open_data_request(shops.shop_id) LIMIT 1`,
            [data.shopFences.map((fence) => fence.shop_id)],
          )
        ).rowCount
      )
        fail('customer data request must be resolved before shop erasure');
      if (collection === 'uninstallRecoveries') {
        // Compare/copy the decision in the target's representation. Live
        // finalization will compact both provider ID copies together.
        const recovered = await rows(
          client,
          `SELECT r.privacy_inbox_id,r.shop_id,r.installation_generation,r.uninstall_inbox_id,
             r.capability_digest,i.external_installation_id,r.decided_at
           FROM jsonb_populate_recordset(NULL::public.uninstall_privacy_recoveries,$1::jsonb) r
           JOIN public.installation_generations i ON i.shop_id=r.shop_id AND i.generation=r.installation_generation`,
          [JSON.stringify(data.uninstallRecoveries ?? [])],
        );
        await copyRows(client, table, primary, recovered);
      } else await copyRows(client, table, primary, data[collection] ?? []);
    }
    await copyRows(
      client,
      'shop_privacy_replays',
      ['inbox_id'],
      await rows(
        client,
        `SELECT * FROM jsonb_populate_recordset(NULL::public.shop_privacy_replays,$1::jsonb)
         WHERE forget_at>statement_timestamp() ORDER BY inbox_id`,
        [JSON.stringify(data.shopReplays ?? [])],
      ),
    );
    // A prior import can have erased additional old transport from the exact
    // copied fences. Require the original source copy for every other tombstone.
    if (
      (
        await client.query(
          `SELECT 1 FROM public.inbox_messages i WHERE i.id IN (${emptyShopify}) AND NOT(i.id=ANY($1::uuid[]))
             AND NOT EXISTS (SELECT 1 FROM public.shop_privacy_transport_scope t
               JOIN public.shop_privacy_finalization f USING(shop_id,installation_generation)
               WHERE t.inbox_id=i.id)
             LIMIT 1`,
          [data.inboxes.map((r) => r.id)],
        )
      ).rowCount
    )
      fail('target has transport exclusions absent from source copy');
    // Transport tombstones also cover erased order receipts without privacy receipts.
    await client.query(
      `UPDATE public.webhook_obligation_facts SET captured_fields='{}',facts_erased_at=coalesce(facts_erased_at,clock_timestamp()) WHERE inbox_id=ANY($1::uuid[])`,
      [data.inboxes.map((r) => r.id)],
    );
    await clearRestoredWebhookJobs(
      client,
      data.inboxes.map((r) => r.id),
    );
    const compactedInboxIds = data.inboxes.filter((row) => row.external_delivery_id === null).map((row) => row.id);
    const conflictingRoute = await client.query(
      `SELECT 1 FROM public.inbox_messages i LEFT JOIN public.shopify_webhook_deliveries d ON d.inbox_id=i.id
       LEFT JOIN jsonb_populate_recordset(NULL::public.shop_privacy_replays,$2::jsonb) r ON r.inbox_id=i.id
       WHERE i.id=ANY($1::uuid[]) AND (
         (d.inbox_id IS NOT NULL AND i.external_delivery_id IS DISTINCT FROM d.shop_domain||':'||d.delivery_id)
         OR (i.external_delivery_id IS NOT NULL AND r.inbox_id IS NULL AND i.purge_after>statement_timestamp())
         OR (r.inbox_id IS NOT NULL AND i.external_delivery_id IS NOT NULL
           AND r.delivery_digest<>public.shop_privacy_digest(jsonb_build_array('webhook-delivery',
             split_part(i.external_delivery_id,':',1),substr(i.external_delivery_id,strpos(i.external_delivery_id,':')+1))))
         OR (r.inbox_id IS NOT NULL AND d.inbox_id IS NOT NULL AND (
           r.content_digest<>public.shop_privacy_replay_digest(d.topic,d.api_version,d.triggered_at,d.event_id,d.webhook_name,i.payload_sha256)
           OR r.uninstall_domain_digest IS DISTINCT FROM CASE WHEN d.topic='app/uninstalled'
             THEN public.shop_privacy_digest(jsonb_build_array('shop-domain',d.shop_domain)) END
           OR r.uninstall_observed_at IS DISTINCT FROM CASE WHEN d.topic='app/uninstalled' THEN d.triggered_at END
         ))) LIMIT 1`,
      [compactedInboxIds, JSON.stringify(data.shopReplays ?? [])],
    );
    if (conflictingRoute.rowCount) fail('conflicting compact delivery routing');
    await client.query('DELETE FROM public.shopify_webhook_deliveries WHERE inbox_id=ANY($1::uuid[])', [
      compactedInboxIds,
    ]);
    await client.query('UPDATE public.inbox_messages SET external_delivery_id=NULL WHERE id=ANY($1::uuid[])', [
      compactedInboxIds,
    ]);
    // Only staged receipt authority or a separately copied exact-generation
    // recovery decision backs a fence. The original BLOCKED receipt stays blocked.
    for (const fence of data.shopFences) {
      const parameters = [fence.shop_id, fence.installation_generation];
      const quotes = (
        await client.query<{ quote_id: string }>(
          'SELECT quote_id FROM public.accepted_quotes WHERE shop_id=$1 AND installation_generation=$2 ORDER BY quote_id',
          parameters,
        )
      ).rows;
      for (const row of quotes)
        await client.query('SELECT public.customer_privacy_fence_quote($1,$2,$3)', [
          fence.shop_id,
          row.quote_id,
          fence.source_inbox_id,
        ]);
      const assets = (
        await client.query<{ asset_id: string }>(
          'SELECT asset_id FROM public.artwork_assets WHERE shop_id=$1 AND installation_generation=$2 ORDER BY asset_id',
          parameters,
        )
      ).rows;
      for (const row of assets)
        await client.query('SELECT public.customer_privacy_fence_asset($1,$2,$3)', [
          fence.shop_id,
          row.asset_id,
          fence.source_inbox_id,
        ]);
      for (const table of ['purchase_design_payloads', 'purchase_offer_payloads'])
        await client.query(
          `UPDATE public.${table} SET payload=NULL,erased_at=clock_timestamp() WHERE shop_id=$1 AND installation_generation=$2 AND erased_at IS NULL`,
          parameters,
        );
      await client.query(
        "UPDATE public.purchase_artwork_events SET asset_id=NULL,placement_id=NULL,group_index=NULL,erased_at=clock_timestamp() WHERE shop_id=$1 AND installation_generation=$2 AND kind='ATTACH' AND erased_at IS NULL",
        parameters,
      );
    }
    // Reapply against the restored old private payloads. Helpers preserve exact expiry/economics.
    const bound = (
      await client.query<{ shop_id: string; quote_id: string; source_inbox_id: string }>(
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
      await client.query<{ shop_id: string; asset_id: string; source_inbox_id: string }>(
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
    // Use the live finalizer for row deletion. The storage cleaners still own
    // external side effects and unsettled custody keeps the restore in HOLD.
    const finalization: Record<string, number> = {};
    for (const fence of data.shopFences) {
      const parameters = [fence.shop_id, fence.installation_generation];
      let result: string;
      do {
        const queueCleanup = await client.query<{ id: string }>(
          `SELECT i.id FROM public.shop_privacy_transport_scope t JOIN public.inbox_messages i ON i.id=t.inbox_id
           JOIN public.shopify_webhook_deliveries d ON d.inbox_id=i.id
           WHERE t.shop_id=$1 AND t.installation_generation=$2 AND i.erasure_state='erased' AND d.queue_cleanup_pending
           ORDER BY i.id LIMIT 100`,
          parameters,
        );
        await clearRestoredWebhookJobs(
          client,
          queueCleanup.rows.map((row) => row.id),
        );
        const step = await client.query<{ result: string }>(
          'SELECT public.finalize_shop_privacy_generation($1,$2,100) AS result',
          parameters,
        );
        result = step.rows[0]?.result ?? fail('missing finalization outcome');
        if (result === 'dependency_pending' && queueCleanup.rows.length === 100) result = 'progress';
      } while (result === 'progress');
      if (result === 'no_authority') fail('unqualified shop finalization target');
      finalization[result] = (finalization[result] ?? 0) + 1;
    }
    await client.query('COMMIT');
    return {
      readiness: 'HOLD_STORAGE_AND_AUTHORITY_REQUALIFICATION',
      receipts: data.receipts.length,
      orders: data.orderFences.length,
      assets: data.assetFences.length,
      finalization,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function writeExclusions(path: string, envelope: unknown) {
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
export async function readExclusions(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > MAX_BYTES)
      fail('private owner exclusion file required');
    const envelope: unknown = JSON.parse(await file.readFile('utf8'));
    validate(envelope);
    return envelope;
  } finally {
    await file.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { Pool }: typeof import('pg') = createRequire(new URL('../../apps/worker/package.json', import.meta.url))('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const [action, path] = process.argv.slice(2);
    if (!process.env.DATABASE_URL || !path || (action !== 'export' && action !== 'import'))
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
