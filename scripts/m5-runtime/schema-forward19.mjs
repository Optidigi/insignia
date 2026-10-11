/** Separate one-attempt owner operation: reviewed schema18 to schema19 only. */
import { createHash } from 'node:crypto';
import { mkdir, open, readdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { Pool } = createRequire(new URL('../../apps/worker/package.json', import.meta.url))('pg');
const hash = (v) => createHash('sha256').update(v).digest('hex');
const migration = '20261011000100_m5_webhook_minimal_obligations.sql';
const functions = [
  'expire_shopify_webhook_bytes(uuid)',
  'expire_shopify_webhook_facts(integer)',
  'pending_shopify_webhook_obligations(integer)',
];
async function persist(path, value) {
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
  const parent = await open(dirname(path), 'r');
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}
async function sourceInputs() {
  const manifest = JSON.parse(await readFile(join(root, 'scripts/m5-runtime/frozen-schema18-manifest.json'), 'utf8'));
  if (
    manifest.version !== 'm5-frozen-schema18-compatibility-v1' ||
    manifest.sourceRef !== 'bbec1483a7a8b91e7c8a2306d896128b40136d72'
  )
    throw new Error('unqualified_schema18_provenance');
  const names = (await readdir(join(root, 'packages/database/migrations'))).filter((x) => x.endsWith('.sql')).sort();
  const historical = Object.keys(manifest.files)
    .filter((x) => x.startsWith('packages/database/migrations/'))
    .map((x) => x.split('/').at(-1))
    .sort();
  if (names.length !== 19 || JSON.stringify(names) !== JSON.stringify([...historical, migration]))
    throw new Error('unexpected_source_migrations');
  for (const name of historical)
    if (
      hash(await readFile(join(root, 'packages/database/migrations', name))) !==
      manifest.files[`packages/database/migrations/${name}`]
    )
      throw new Error('historical_source_changed');
  const sources = {};
  for (const path of names
    .map((x) => `packages/database/migrations/${x}`)
    .concat([
      'scripts/m5-runtime/schema-forward19.mjs',
      'scripts/m5-runtime/frozen-schema18-manifest.json',
      'pnpm-lock.yaml',
    ]))
    sources[path] = hash(await readFile(join(root, path)));
  return { names, sources };
}
async function privileges(client, final = false) {
  const roles = await client.query(
    'select rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolconnlimit from pg_roles where rolname=any($1)',
    [
      [
        'insignia_runtime',
        'insignia_worker',
        'insignia_release_append',
        'insignia_queue_enqueue',
        'insignia_queue_consume',
      ],
    ],
  );
  if (
    roles.rowCount !== 5 ||
    roles.rows.some(
      (r) =>
        r.rolsuper ||
        r.rolcreatedb ||
        r.rolcreaterole ||
        r.rolreplication ||
        r.rolbypassrls ||
        r.rolcanlogin !== ['insignia_runtime', 'insignia_worker', 'insignia_release_append'].includes(r.rolname),
    ) ||
    roles.rows.find((r) => r.rolname === 'insignia_worker').rolconnlimit !== 4 ||
    roles.rows.find((r) => r.rolname === 'insignia_release_append').rolconnlimit !== 2
  )
    throw new Error('roles_unqualified');
  const {
    rows: [rights],
  } = await client.query(`select
 has_table_privilege('insignia_runtime','trusted_release_records','SELECT') and
 not has_table_privilege('insignia_runtime','trusted_release_records','INSERT,UPDATE,DELETE,TRUNCATE') and
 not has_schema_privilege('insignia_runtime','public','CREATE') and
 not has_schema_privilege('insignia_worker','public','CREATE') and
 not has_schema_privilege('insignia_worker','pgboss','CREATE') and
 pg_has_role('insignia_worker','insignia_queue_consume','MEMBER') and
 pg_has_role('insignia_runtime','insignia_queue_enqueue','MEMBER') and
 not pg_has_role('insignia_worker','insignia_release_owner','MEMBER') and
 not pg_has_role('insignia_worker','insignia_release_operator','MEMBER') and
 not has_column_privilege('insignia_worker','inbox_messages','payload','UPDATE') and
 not has_column_privilege('insignia_worker','inbox_messages','erasure_state','UPDATE') and
 not has_table_privilege('insignia_release_append','trusted_release_records','UPDATE,DELETE,TRUNCATE') as safe`);
  if (!rights.safe) throw new Error('effective_privileges_unqualified');
  if (final) {
    const owner = (await client.query('select current_user as owner')).rows[0].owner;
    for (const signature of functions) {
      const {
        rows: [entry],
      } = await client.query(
        `select p.prosecdef,p.proowner::regrole::text as owner,p.proconfig,
    has_function_privilege('insignia_worker',p.oid,'EXECUTE') as worker,
    has_function_privilege('insignia_runtime',p.oid,'EXECUTE') as runtime,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute
    from pg_proc p where p.oid=to_regprocedure($1)`,
        [`public.${signature}`],
      );
      if (
        !entry?.prosecdef ||
        entry.owner !== owner ||
        JSON.stringify(entry.proconfig) !== JSON.stringify(['search_path=pg_catalog, public']) ||
        !entry.worker ||
        entry.runtime ||
        entry.public_execute
      )
        throw new Error('function_privileges_unqualified');
    }
    const {
      rows: [facts],
    } = await client.query(
      `select has_table_privilege('insignia_worker','webhook_obligation_facts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') or has_table_privilege('insignia_runtime','webhook_obligation_facts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as exposed`,
    );
    if (facts.exposed) throw new Error('facts_table_exposed');
  }
}
async function preflight(client, plan, names) {
  const {
    rows: [id],
  } = await client.query(
    "select current_database() as database,current_user as owner,current_setting('server_version_num')::int/10000 as major",
  );
  if (id.database !== plan.expectedDatabase || id.owner !== plan.expectedOwner || id.major !== 18)
    throw new Error('owner_identity_mismatch');
  const versions = (await client.query('select version from schema_migrations order by version')).rows.map(
    (x) => x.version,
  );
  if (JSON.stringify(versions) !== JSON.stringify(names.slice(0, 18).map((x) => x.split('_')[0])))
    throw new Error('unexpected_migrations');
  const queue = await client.query('select version from pgboss.version');
  if (queue.rowCount !== 1 || queue.rows[0].version !== 43) throw new Error('queue_version_unqualified');
  const {
    rows: [schema],
  } = await client.query("select nspowner::regrole::text as owner from pg_namespace where nspname='pgboss'");
  if (schema.owner !== id.owner) throw new Error('queue_owner_unqualified');
  if (
    (await client.query("select to_regclass('public.webhook_obligation_facts') is not null as present")).rows[0].present
  )
    throw new Error('unexpected_schema');
  await privileges(client);
}
export async function reserveForwardSchema19({ directory, ownerConnectionString, expectedDatabase, expectedOwner }) {
  if (![expectedDatabase, expectedOwner].every((x) => /^[a-z][a-z0-9_]{0,62}$/.test(x)))
    throw new Error('invalid_owner_identity');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await stat(directory)).mode & 0o077 || (await readdir(directory)).length)
    throw new Error('private_empty_directory_required');
  const source = await sourceInputs();
  const pool = new Pool({
    connectionString: ownerConnectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  });
  let client;
  try {
    client = await pool.connect();
    await client.query('begin read only');
    await preflight(client, { expectedDatabase, expectedOwner }, source.names);
    await client.query('rollback');
    await persist(join(directory, 'credentials.json'), { ownerConnectionString });
    const plan = {
      version: 'm5-schema-forward19-v1',
      expectedDatabase,
      expectedOwner,
      fromMigrationCount: 18,
      toMigrationCount: 19,
      credentialsSha256: hash(await readFile(join(directory, 'credentials.json'))),
      ...source,
    };
    await persist(join(directory, 'plan.json'), plan);
    return {
      version: plan.version,
      fromMigrationCount: 18,
      toMigrationCount: 19,
      planSha256: hash(JSON.stringify(plan)),
    };
  } finally {
    client?.release();
    await pool.end();
  }
}
export async function executeForwardSchema19(directory) {
  for (const path of [directory, join(directory, 'plan.json'), join(directory, 'credentials.json')])
    if ((await stat(path)).mode & 0o077) throw new Error('private_files_required');
  const plan = JSON.parse(await readFile(join(directory, 'plan.json'), 'utf8'));
  const source = await sourceInputs();
  if (
    plan.version !== 'm5-schema-forward19-v1' ||
    JSON.stringify(plan.names) !== JSON.stringify(source.names) ||
    JSON.stringify(plan.sources) !== JSON.stringify(source.sources)
  )
    throw new Error('frozen_source_changed');
  const raw = await readFile(join(directory, 'credentials.json'));
  if (hash(raw) !== plan.credentialsSha256) throw new Error('frozen_credentials_changed');
  try {
    await persist(join(directory, 'attempt.json'), { attempt: 1, planSha256: hash(JSON.stringify(plan)) });
  } catch (e) {
    if (e.code === 'EEXIST') throw new Error('already_reserved');
    throw e;
  }
  const pool = new Pool({
    connectionString: JSON.parse(raw).ownerConnectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 30000,
  });
  let client;
  try {
    client = await pool.connect();
    await client.query("select pg_advisory_lock(hashtext('insignia.m5-runtime.schema-provision'))");
    await client.query(
      "begin; set local lock_timeout='5s'; set local statement_timeout='30s'; lock table schema_migrations in exclusive mode",
    );
    await preflight(client, plan, source.names);
    const sql = await readFile(join(root, 'packages/database/migrations', migration), 'utf8');
    const up = sql.split('-- migrate:up\n')[1]?.split('-- migrate:down')[0];
    if (!up) throw new Error('migration_up_missing');
    await client.query(up);
    await client.query('insert into schema_migrations(version) values($1)', [migration.split('_')[0]]);
    await privileges(client, true);
    await client.query('commit');
    const result = {
      status: 'APPLIED',
      fromMigrationCount: 18,
      toMigrationCount: 19,
      queueVersion: 43,
      destructiveDown: false,
      rolesReprovisioned: false,
    };
    await persist(join(directory, 'completed.json'), result);
    return result;
  } catch {
    try {
      await client?.query('rollback');
    } catch {
      /* one attempt; reconciliation required */
    }
    await persist(join(directory, 'stopped.json'), { status: 'STOPPED_RECONCILIATION_REQUIRED', retry: false });
    throw new Error('forward19_stopped_reconciliation_required');
  } finally {
    try {
      await client?.query("select pg_advisory_unlock(hashtext('insignia.m5-runtime.schema-provision'))");
    } finally {
      client?.release();
      await pool.end();
    }
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    let raw = '';
    for await (const part of process.stdin) {
      raw += part;
      if (raw.length > 16384) throw new Error('input_too_large');
    }
    const input = JSON.parse(raw);
    if (process.argv[2] === 'reserve') console.log(JSON.stringify(await reserveForwardSchema19(input)));
    else if (process.argv[2] === 'execute') console.log(JSON.stringify(await executeForwardSchema19(input.directory)));
    else throw new Error('invalid_operation');
  } catch {
    console.error('forward19_operator_failed_private_receipts_required');
    process.exitCode = 1;
  }
}
