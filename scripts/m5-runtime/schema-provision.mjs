/** Separate schema-owner operation. stdin/private files only; never runtime startup. */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const workerRequire = createRequire(new URL('../../apps/worker/package.json', import.meta.url));
const { Pool } = workerRequire('pg');
const roles = [
  'insignia_release_owner',
  'insignia_release_operator',
  'insignia_queue_enqueue',
  'insignia_queue_consume',
  'insignia_worker',
  'insignia_release_append',
];
const hash = (value) => createHash('sha256').update(value).digest('hex');
const quote = (value) => `"${value.replaceAll('"', '""')}"`;
async function writePrivate(path, value) {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const parent = await open(dirname(path), 'r');
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}
async function inputs() {
  if (workerRequire('pg-boss/package.json').version !== '12.35.0') throw new Error('unreviewed_queue_package');
  const names = (await readdir(join(root, 'packages/database/migrations'))).filter((x) => x.endsWith('.sql')).sort();
  if (names.length !== 18) throw new Error('unexpected_source_migrations');
  const paths = names
    .map((x) => `packages/database/migrations/${x}`)
    .concat([
      'docs/delivery/evidence/m5-023/operators/trusted-release-roles.sql',
      'scripts/m5-024/queue-roles.sql',
      'scripts/m5-024/install-queue.mjs',
      'apps/worker/dist/queue-contract.js',
      'pnpm-lock.yaml',
      'scripts/m5-runtime/schema-provision.mjs',
    ]);
  const sources = {};
  for (const path of paths) sources[path] = hash(await readFile(join(root, path)));
  return { names, sources };
}
async function preflight(client, expectedDatabase, expectedOwner, names) {
  const {
    rows: [identity],
  } = await client.query(`select current_database() as database,current_user as owner,
    current_setting('server_version_num')::int/10000 as major`);
  if (identity.database !== expectedDatabase || identity.owner !== expectedOwner || identity.major !== 18)
    throw new Error('owner_identity_mismatch');
  const versions = (await client.query('select version from public.schema_migrations order by version')).rows.map(
    (x) => x.version,
  );
  if (JSON.stringify(versions) !== JSON.stringify(names.slice(0, 15).map((x) => x.split('_')[0])))
    throw new Error('unexpected_migrations');
  if ((await client.query('select rolname from pg_roles where rolname=any($1)', [roles])).rowCount)
    throw new Error('unexpected_roles');
  if (
    (
      await client.query(
        "select to_regnamespace('pgboss') is not null or to_regclass('public.trusted_release_records') is not null as present",
      )
    ).rows[0].present
  )
    throw new Error('unexpected_schema');
  const runtime = (
    await client.query(`select exists(select 1 from pg_roles where rolname='insignia_runtime' and rolcanlogin
    and not (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls))
    and not pg_has_role('insignia_runtime','pg_database_owner','MEMBER') as safe`)
  ).rows[0];
  if (runtime.safe !== true) throw new Error('runtime_identity_unqualified');
}
export async function reserveSchemaProvision({ directory, ownerConnectionString, expectedDatabase, expectedOwner }) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(expectedDatabase) || !/^[a-z][a-z0-9_]{0,62}$/.test(expectedOwner))
    throw new Error('invalid_owner_identity');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await stat(directory)).mode & 0o077 || (await readdir(directory)).length)
    throw new Error('private_empty_directory_required');
  const source = await inputs();
  const pool = new Pool({
    connectionString: ownerConnectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  });
  let client;
  try {
    client = await pool.connect();
    await client.query('begin read only');
    await preflight(client, expectedDatabase, expectedOwner, source.names);
    await client.query('rollback');
    const credentials = {
      ownerConnectionString,
      workerPassword: randomBytes(32).toString('hex'),
      releasePassword: randomBytes(32).toString('hex'),
    };
    for (const [key, role, password] of [
      ['workerUrl', 'insignia_worker', credentials.workerPassword],
      ['releaseUrl', 'insignia_release_append', credentials.releasePassword],
    ]) {
      const url = new URL(ownerConnectionString);
      url.username = role;
      url.password = password;
      credentials[key] = url.href;
    }
    await writePrivate(join(directory, 'credentials.json'), credentials);
    const plan = {
      version: 'm5-schema-provision-v1',
      expectedDatabase,
      expectedOwner,
      fromMigrationCount: 15,
      toMigrationCount: 18,
      credentialsSha256: hash(await readFile(join(directory, 'credentials.json'))),
      ...source,
    };
    await writePrivate(join(directory, 'plan.json'), plan);
    return {
      version: plan.version,
      fromMigrationCount: 15,
      toMigrationCount: 18,
      planSha256: hash(JSON.stringify(plan)),
    };
  } finally {
    client?.release();
    await pool.end();
  }
}
async function effectiveCheck(client) {
  const {
    rows: [check],
  } = await client.query(`select
    has_table_privilege('insignia_runtime','public.trusted_release_records','SELECT') and
    not has_table_privilege('insignia_runtime','public.trusted_release_records','INSERT,UPDATE,DELETE,TRUNCATE') and
    not has_schema_privilege('insignia_runtime','public','CREATE') and
    not pg_has_role('insignia_runtime','insignia_release_owner','MEMBER') and
    not pg_has_role('insignia_runtime','insignia_release_operator','MEMBER') and
    not pg_has_role('insignia_worker','insignia_release_owner','MEMBER') and
    not pg_has_role('insignia_worker','insignia_release_operator','MEMBER') and
    not pg_has_role('insignia_release_append','insignia_release_owner','MEMBER') and
    not has_schema_privilege('insignia_worker','pgboss','CREATE') and
    not has_table_privilege('insignia_release_append','public.trusted_release_records','UPDATE,DELETE,TRUNCATE') as safe`);
  if (check.safe !== true) throw new Error('effective_privileges_unqualified');
}
export async function executeSchemaProvision(directory) {
  if ((await stat(directory)).mode & 0o077) throw new Error('private_directory_required');
  for (const file of ['plan.json', 'credentials.json'])
    if ((await stat(join(directory, file))).mode & 0o077) throw new Error('private_file_required');
  const plan = JSON.parse(await readFile(join(directory, 'plan.json'), 'utf8'));
  const source = await inputs();
  if (
    plan.version !== 'm5-schema-provision-v1' ||
    JSON.stringify(plan.sources) !== JSON.stringify(source.sources) ||
    JSON.stringify(plan.names) !== JSON.stringify(source.names)
  )
    throw new Error('frozen_source_changed');
  const credentialsRaw = await readFile(join(directory, 'credentials.json'));
  if (hash(credentialsRaw) !== plan.credentialsSha256) throw new Error('frozen_credentials_changed');
  const secrets = JSON.parse(credentialsRaw);
  if (![secrets.workerPassword, secrets.releasePassword].every((x) => /^[a-f0-9]{64}$/.test(x)))
    throw new Error('invalid_private_credentials');
  try {
    await writePrivate(join(directory, 'attempt.json'), { planSha256: hash(JSON.stringify(plan)), attempt: 1 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('already_reserved');
    throw error;
  }
  const pool = new Pool({
    connectionString: secrets.ownerConnectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 30000,
  });
  let client;
  try {
    client = await pool.connect();
    await client.query("select pg_advisory_lock(hashtext('insignia.m5-runtime.schema-provision'))");
    await client.query('begin');
    await client.query(
      "set local lock_timeout = '5s'; set local statement_timeout = '30s'; lock table public.schema_migrations in exclusive mode",
    );
    await preflight(client, plan.expectedDatabase, plan.expectedOwner, source.names);
    for (const name of source.names.slice(15)) {
      const raw = await readFile(join(root, 'packages/database/migrations', name), 'utf8');
      const up = raw.split('-- migrate:up\n')[1]?.split('-- migrate:down')[0];
      if (!up) throw new Error('migration_up_missing');
      await client.query(up);
      await client.query('insert into public.schema_migrations(version) values($1)', [name.split('_')[0]]);
    }
    await client.query(
      await readFile(join(root, 'docs/delivery/evidence/m5-023/operators/trusted-release-roles.sql'), 'utf8'),
    );
    await client.query('commit');
    await writePrivate(join(directory, 'schema-applied.json'), {
      migrations: source.names.slice(15),
      status: 'ACKNOWLEDGED',
    });
    // Existing accepted installer owns schema43/queue construction. Not duplicated here.
    const { installQueue } = await import('../m5-024/install-queue.mjs');
    const queue = await installQueue(secrets.ownerConnectionString);
    await writePrivate(join(directory, 'queue-applied.json'), queue);
    await client.query(await readFile(join(root, 'scripts/m5-024/queue-roles.sql'), 'utf8'));
    await client.query('begin');
    // Credential DDL must never reach backend statement/error/parameter logs.
    // These settings affect this transaction only, never other applications.
    await client.query(
      "set local log_statement='none'; set local log_min_duration_statement=-1; set local log_min_duration_sample=-1; set local log_statement_sample_rate=0; set local log_min_error_statement='panic'; set local log_parameter_max_length=0; set local log_parameter_max_length_on_error=0",
    );
    await client.query(`create role insignia_worker login password '${secrets.workerPassword}' nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 4;
      create role insignia_release_append login password '${secrets.releasePassword}' nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 2;
      grant insignia_queue_consume to insignia_worker;
      grant insignia_release_operator to insignia_release_append;
      grant insignia_queue_enqueue to insignia_runtime;
      grant connect on database ${quote(plan.expectedDatabase)} to insignia_worker, insignia_release_append;`);
    await effectiveCheck(client);
    await client.query('commit');
    const result = {
      status: 'APPLIED',
      migrations: 18,
      queue,
      credentials: 'private credentials.json',
      destructiveDown: false,
    };
    await writePrivate(join(directory, 'completed.json'), result);
    return result;
  } catch {
    try {
      await client?.query('rollback');
    } catch {
      /* Settlement remains explicit. */
    }
    await writePrivate(join(directory, 'stopped.json'), { status: 'STOPPED_RECONCILIATION_REQUIRED', retry: false });
    throw new Error('schema_provision_stopped_reconciliation_required');
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
    for await (const chunk of process.stdin) {
      raw += chunk;
      if (raw.length > 16384) throw new Error('input_too_large');
    }
    const input = JSON.parse(raw);
    if (process.argv[2] === 'reserve') console.log(JSON.stringify(await reserveSchemaProvision(input)));
    else if (process.argv[2] === 'execute') console.log(JSON.stringify(await executeSchemaProvision(input.directory)));
    else throw new Error('invalid_operation');
  } catch {
    console.error('schema_operator_failed_private_receipts_required');
    process.exitCode = 1;
  }
}
