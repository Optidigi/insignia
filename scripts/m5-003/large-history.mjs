/** Synthetic PostgreSQL 18 benchmark. Runs the actual built public read seams and
 * EXPLAINs the SQL captured from their pg client, rather than hand-copying queries.
 * Run only against a disposable DATABASE_URL; no Shopify calls or credentials.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve(import.meta.dirname, '../../packages/database/package.json'));
const { Pool } = require('pg');
const { createDurableCore, revisionContentHash } = await import('../../packages/database/dist/index.js');
const connectionString = process.env.DATABASE_URL;
assert(connectionString, 'disposable DATABASE_URL required');
const setup = new Pool({ connectionString });
const version = (await setup.query('SHOW server_version_num')).rows[0].server_version_num;
assert.equal(Math.floor(Number(version) / 10000), 18);
const shopId = randomUUID(),
  configId = randomUUID(),
  productId = '990001',
  finalRevision = randomUUID();
const core = createDurableCore(new Pool({ connectionString }));
await core.transactions.run(async (tx) => {
  await core.tenants.createShop(tx, {
    shopId,
    shopDomain: `${shopId}.benchmark.example`,
    shopifyShopId: String(BigInt('0x' + shopId.replaceAll('-', '').slice(0, 15))),
  });
  await core.tenants.startInstallation(tx, shopId);
  await core.configs.createConfig(tx, {
    shopId,
    configId,
    externalProductId: productId,
    draftSchemaVersion: 'm3-config-draft-v1',
    draftValue: {},
  });
});
const value = {
  version: 'm2-published-config-v1',
  shopId,
  productId,
  revisionId: finalRevision,
  shopCurrency: 'USD',
  methods: [{ id: 'print' }],
  placements: [{ id: 'front', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: false }],
  productionOptions: [],
  pricingRules: [],
};
value.revisionContentHash = revisionContentHash(value);
// Synthetic retained rows exercise actual FK/index/history cardinality and payload width.
// Only the selected revision is a validated economic revision; old rows are not pricing evidence.
await setup.query(
  `INSERT INTO config_revisions(shop_id,config_id,revision_id,schema_version,published_value,content_hash)
 SELECT $1,$2,'history-'||n,'m2-published-config-v1',jsonb_set($3::jsonb,'{revisionId}',to_jsonb('history-'||n)),repeat('a',64)
 FROM generate_series(1,100000) n`,
  [shopId, configId, JSON.stringify(value)],
);
await setup.query(
  `INSERT INTO config_revisions(shop_id,config_id,revision_id,schema_version,published_value,content_hash) VALUES($1,$2,$3,$4,$5,$6)`,
  [shopId, configId, finalRevision, value.version, value, value.revisionContentHash],
);
await setup.query('ANALYZE config_revisions');
await setup.query(
  `INSERT INTO publication_operations(shop_id,config_id,operation_id,revision_id,installation_generation,operation_sequence,expected_projection,expected_projection_digest)
 SELECT $1,$2,'history-'||n,'history-'||n,CASE WHEN n<=50000 THEN 1 ELSE 2 END,CASE WHEN n>50000 THEN n+1 ELSE n END,'{"syntheticHistory":true}'::jsonb,repeat('b',64) FROM generate_series(1,100000) n`,
  [shopId, configId],
);
// Give FK checks accurate cardinality before bulk dependent rows. Otherwise an
// empty-table cached plan can repeatedly scan the freshly inserted history.
await setup.query('ANALYZE publication_operations');
await setup.query(
  `INSERT INTO m4_publication_progress(shop_id,config_id,operation_id,mode) SELECT $1,$2,'history-'||n,'optional' FROM generate_series(1,100000) n`,
  [shopId, configId],
);
const projection = { version: 'historical-m3-benchmark-v1' };
const projectionDigest = createHash('sha256').update(JSON.stringify(projection)).digest('hex');
await setup.query(
  `INSERT INTO publication_operations(shop_id,config_id,operation_id,revision_id,installation_generation,operation_sequence,expected_projection,expected_projection_digest,status,acknowledged_at,observed_at,observed_projection,observed_projection_digest,activated_at)
 VALUES($1,$2,$3,$3,2,50001,$4,$5,'activated',now(),now(),$4,$5,now())`,
  [shopId, configId, finalRevision, projection, projectionDigest],
);
await setup.query(
  `UPDATE product_configs SET publication_sequence=50001,effective_operation_id=$3,effective_revision_id=$3 WHERE shop_id=$1 AND config_id=$2`,
  [shopId, configId, finalRevision],
);
await setup.query(
  `INSERT INTO m4_publication_progress(shop_id,config_id,operation_id,mode,phase,activation_evidence) VALUES($1,$2,$3,'optional','active','synthetic-historical-benchmark')`,
  [shopId, configId, finalRevision],
);
// Structural audit/state rows simulate resolved abandoned requests. They pass
// SQL identity constraints but are NOT application-validated operator decisions
// or pricing evidence. They force fallback to skip a 50k newer tail via index.
await setup.query(
  `INSERT INTO m5_availability_resolutions(shop_id,config_id,operation_id,command_key,resolution_digest,resolution)
  SELECT $1,$2,o.operation_id,'structural-'||o.operation_sequence,repeat('e',64),jsonb_build_object(
    'version','m5-availability-resolution-v1','outcome','ORIGINAL_STATE_OBSERVED',
    'shopId',$1::text,'configId',$2::text,'operationId',o.operation_id,'commandKey','structural-'||o.operation_sequence,
    'currentScope',jsonb_build_object('shopId',$1::text),
    'originalHold',jsonb_build_object('version','m5-availability-hold-v1','operationId',o.operation_id,
      'before',jsonb_build_object('scope',jsonb_build_object('shopId',$1::text),
        'productId',$3::text,'state','available','visibilityDigest',repeat('f',64)),'held',null),
    'observed',jsonb_build_object('scope',jsonb_build_object('shopId',$1::text),
      'productId',$3::text,'state','available','visibilityDigest',repeat('f',64)),
    'decision',jsonb_build_object('version','m5-availability-recovery-decision-v1',
      'outstandingWrites','SETTLED_BY_TRUSTED_OPERATOR','shopId',$1::text,'configId',$2::text,
      'operationId',o.operation_id,'commandKey','structural-'||o.operation_sequence),
    'activationEvidenceDigest',null,'createdAt','2026-10-01T00:00:00.000Z')
  FROM publication_operations o WHERE shop_id=$1 AND config_id=$2 AND operation_sequence>50001`,
  [shopId, configId, productId],
);
await setup.query('ANALYZE m5_availability_resolutions');
await setup.query(
  `INSERT INTO m5_activation_state(shop_id,config_id,operation_id,kind,hold,resolution_digest)
  SELECT shop_id,config_id,operation_id,'RESOLVED',resolution->'originalHold',resolution_digest
  FROM m5_availability_resolutions WHERE shop_id=$1 AND config_id=$2`,
  [shopId, configId],
);
await setup.query('ANALYZE m5_activation_state');
await setup.query(
  `UPDATE publication_operations SET status='failed',failed_at=now(),
  failure_class='synthetic-resolved-history',availability_resolved_at='2026-10-01T00:00:00.000Z'
  WHERE shop_id=$1 AND config_id=$2 AND operation_sequence>50001`,
  [shopId, configId],
);
await setup.query(`UPDATE product_configs SET publication_sequence=100001 WHERE shop_id=$1 AND config_id=$2`, [
  shopId,
  configId,
]);
const geometry = { version: 'm5-geometry-v1', views: [], steps: [] };
await setup.query(
  `INSERT INTO config_revision_geometry(shop_id,config_id,revision_id,schema_version,mode,geometry_value,content_hash) VALUES($1,$2,$3,'m5-geometry-v1','optional',$4,$5)`,
  [shopId, configId, finalRevision, geometry, 'c'.repeat(64)],
);
await setup.query(
  `INSERT INTO m5_current_publication_pointer(shop_id,config_id,revision_id,installation_generation,source_draft_version,idempotency_key) VALUES($1,$2,$3,2,1,'benchmark-request-1')`,
  [shopId, configId, finalRevision],
);
// Background current configs make PK/index selection observable instead of a
// planner-chosen scan over an unrealistically single-row pointer/config table.
await setup.query(
  `INSERT INTO product_configs(shop_id,config_id,external_product_id,draft_schema_version,draft_value)
 SELECT $1,'background-'||n,'background-'||n,'m3-config-draft-v1','{}'::jsonb FROM generate_series(1,5000) n`,
  [shopId],
);
await setup.query(
  `INSERT INTO config_revisions(shop_id,config_id,revision_id,schema_version,published_value,content_hash)
 SELECT $1,'background-'||n,'background-'||n,'m2-published-config-v1','{}'::jsonb,repeat('d',64) FROM generate_series(1,5000) n`,
  [shopId],
);
await setup.query(
  `INSERT INTO config_revision_geometry(shop_id,config_id,revision_id,schema_version,mode,geometry_value,content_hash)
 SELECT $1,'background-'||n,'background-'||n,'m5-geometry-v1','optional','{}'::jsonb,repeat('d',64) FROM generate_series(1,5000) n`,
  [shopId],
);
await setup.query(
  `INSERT INTO m5_current_publication_pointer(shop_id,config_id,revision_id,installation_generation,source_draft_version,idempotency_key)
 SELECT $1,'background-'||n,'background-'||n,2,1,'benchmark-background-1' FROM generate_series(1,5000) n`,
  [shopId],
);
for (const table of [
  'shops',
  'installation_generations',
  'product_configs',
  'config_revisions',
  'publication_operations',
  'm4_publication_progress',
  'm5_current_publication_pointer',
  'config_revision_geometry',
])
  await setup.query(`ANALYZE ${table}`);
const queries = [];
const readPool = new Pool({ connectionString });
readPool.on('connect', (client) => {
  const original = client.query.bind(client);
  client.query = (...args) => {
    const arg = args[0];
    queries.push({
      text: typeof arg === 'string' ? arg : arg.text,
      values: typeof arg === 'string' ? args[1] : arg.values,
    });
    return original(...args);
  };
});
const reader = createDurableCore(readPool);
assert.equal((await reader.configs.getCurrentPublication(shopId, configId)).revisionId, finalRevision);
const pointer = queries.find((q) => q.text.includes('FROM m5_current_publication_pointer'));
await setup.query('DELETE FROM m5_current_publication_pointer WHERE shop_id=$1 AND config_id=$2', [shopId, configId]);
assert.equal((await reader.configs.getCurrentPublication(shopId, configId)).revisionId, finalRevision);
const fallback = queries.find((q) => q.text.includes('ORDER BY operation.operation_sequence'));
// Actual Admin uses configs.getByProduct; quote issuance has a different join.
const adminStart = queries.length;
assert.equal((await reader.configs.getByProduct(shopId, productId)).effectiveRevisionId, finalRevision);
const adminEffective = queries.slice(adminStart).find((q) => /from "product_configs"/i.test(q.text));
// Newer abandoned requests intentionally fail the quote-issuance sequence guard.
// This is distinct from the Admin's retained effective-revision display; do not
// weaken that guard or label this large-history fixture successfully priceable.
assert.equal(await reader.acceptedQuotes.getEffective(shopId, productId), null);
await setup.query(
  `INSERT INTO m5_current_publication_pointer(shop_id,config_id,revision_id,installation_generation,source_draft_version,idempotency_key) VALUES($1,$2,$3,2,1,'benchmark-request-1')`,
  [shopId, configId, finalRevision],
);
const plans = {};
function flatten(node) {
  return [node, ...(node.Plans ?? []).flatMap(flatten)];
}
for (const [name, query] of Object.entries({ pointer, fallback, adminEffective })) {
  assert(query, `${name} actual query captured`);
  const result = await setup.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.text}`, query.values);
  const plan = result.rows[0]['QUERY PLAN'][0];
  const nodes = flatten(plan.Plan);
  assert.equal(plan.Plan['Actual Rows'], 1, `${name} must return exactly one`);
  for (const node of nodes)
    if (['publication_operations', 'config_revisions', 'm4_publication_progress'].includes(node['Relation Name'])) {
      assert(!['Seq Scan', 'Parallel Seq Scan'].includes(node['Node Type']), `${name} scans history`);
      assert((node['Actual Rows'] ?? 0) <= 2, `${name} unbounded history rows`);
    }
  if (name === 'pointer')
    assert(
      nodes.some((n) => n['Index Name'] === 'm5_current_publication_pointer_pkey'),
      'pointer PK bounded',
    );
  if (name === 'adminEffective')
    assert(
      nodes.some(
        (n) =>
          n['Relation Name'] === 'product_configs' &&
          ['Index Scan', 'Index Only Scan', 'Bitmap Heap Scan'].includes(n['Node Type']),
      ),
      'effective config index bounded',
    );
  if (name === 'fallback') {
    assert(
      nodes.some((n) => n['Index Name'] === 'm5_current_publication_visible_idx'),
      'fallback current-generation index',
    );
    assert(
      !nodes.some((n) => n['Node Type'] === 'Sort' || n['Node Type'] === 'Incremental Sort'),
      'fallback sorts retained history',
    );
  }
  plans[name] = {
    query: query.text,
    parameterRoles: ['synthetic tenant/config/product'],
    plan,
    summary: {
      planningMs: plan['Planning Time'],
      executionMs: plan['Execution Time'],
      rows: plan.Plan['Actual Rows'],
      indexes: nodes.map((n) => n['Index Name']).filter(Boolean),
    },
  };
}
const hashes = {};
for (const path of [
  'scripts/m5-003/large-history.mjs',
  'packages/database/dist/durable-core.js',
  'packages/database/dist/repositories/accepted-quote.js',
  'packages/database/dist/repositories/config.js',
  'packages/database/migrations/20260930000900_m5_activation.sql',
  'apps/web/src/server/merchant-config.ts',
])
  hashes[path] = createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
const artifact = {
  hashes,
  version: 'm5-query-plan-v1',
  observedAt: new Date().toISOString(),
  postgresVersion: version,
  history: {
    revisions: 100001,
    operations: 100001,
    oneConfig: true,
    oldGeneration: 50000,
    currentGeneration: 50001,
    backgroundCurrentConfigs: 5000,
    newerResolvedCurrentGeneration: 50000,
    effectiveOperationSequence: 50001,
  },
  qualification:
    'Synthetic history for one config. Captured SQL from actual built read seams. No machine SLA; retained rows are structural history, not 100k validated pricing revisions.',
  quoteReadiness: {
    result: null,
    reason:
      'Effective operation sequence 50001 differs from latest publication sequence 100001; the existing quote-issuance guard fails closed.',
    measuredAsAdminRead: false,
  },
  plans,
};
const out = resolve(process.env.M5_QUERY_PLAN_OUTPUT ?? 'docs/delivery/evidence/m5-003/query-plan.json');
await mkdir(resolve(out, '..'), { recursive: true });
await writeFile(out, JSON.stringify(artifact, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(plans).map(([name, p]) => [name, p.summary])), null, 2));
await reader.close();
await core.close();
await setup.end();
