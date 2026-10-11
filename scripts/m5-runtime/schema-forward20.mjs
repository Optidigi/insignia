/** Separate reviewed schema19→20 owner operation. Historical operators are immutable. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { Pool } = createRequire(new URL('../../apps/worker/package.json', import.meta.url))('pg');
const migration = '20261011000200_m5_owner_lifecycle_decisions.sql';
const sha = (value) => createHash('sha256').update(value).digest('hex');
const poolFor = (url) =>
  new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000, query_timeout: 30000 });
async function privateDirectory(path) {
  assert.ok(
    isAbsolute(path) && resolve(path) === path && (await realpath(path)) === path,
    'private_absolute_directory_required',
  );
  const value = await stat(path);
  assert.ok(
    value.isDirectory() && value.uid === process.getuid() && !(value.mode & 0o077),
    'private_directory_required',
  );
}
async function privateRead(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const value = await file.stat();
    assert.ok(
      value.isFile() &&
        value.uid === process.getuid() &&
        value.nlink === 1 &&
        !(value.mode & 0o077) &&
        value.size <= 1048576,
      'private_file_required',
    );
    return await file.readFile();
  } finally {
    await file.close();
  }
}
async function persist(path, value) {
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
  const directory = await open(dirname(path), 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function sourceInputs() {
  const manifest = JSON.parse(await readFile(join(root, 'scripts/m5-runtime/frozen-schema19-manifest.json'), 'utf8'));
  assert.equal(manifest.version, 'm5-frozen-schema19-compatibility-v1');
  assert.equal(manifest.sourceRef, '202cb93b0a3f25cdfca6aff35cbdad0484f25b52');
  const names = (await readdir(join(root, 'packages/database/migrations')))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const historical = Object.keys(manifest.files)
    .filter((path) => path.startsWith('packages/database/migrations/'))
    .sort();
  assert.equal(historical.length, 19, 'unqualified_schema19_provenance');
  assert.deepEqual(
    names,
    [...historical.map((path) => path.split('/').at(-1)), migration],
    'unexpected_source_migrations',
  );
  const sources = {};
  for (const path of historical.concat([
    `packages/database/migrations/${migration}`,
    'scripts/m5-runtime/schema-forward20.mjs',
    'scripts/m5-runtime/frozen-schema19-manifest.json',
    'pnpm-lock.yaml',
  ])) {
    sources[path] = sha(await readFile(join(root, path)));
    if (manifest.files[path]) assert.equal(sources[path], manifest.files[path], 'historical_source_changed');
  }
  return { names, sources };
}
async function state(client, identity, names, final = false) {
  const id = (
    await client.query(
      "select current_database() as database,current_user as owner,current_setting('server_version_num')::int/10000 as major,pg_get_userbyid(datdba) as database_owner,(pg_control_system()).system_identifier::text as system_identifier from pg_database where datname=current_database()",
    )
  ).rows[0];
  assert.equal(id.database, identity.expectedDatabase, 'owner_identity_mismatch');
  assert.equal(id.owner, identity.expectedOwner, 'owner_identity_mismatch');
  assert.equal(id.database_owner, identity.expectedOwner, 'database_owner_mismatch');
  assert.equal(id.major, 18, 'postgres18_required');
  const versions = (await client.query('select version from schema_migrations order by version')).rows.map(
    (row) => row.version,
  );
  assert.deepEqual(
    versions,
    names.slice(0, final ? 20 : 19).map((name) => name.split('_')[0]),
    'unexpected_migrations',
  );
  const queue = (await client.query('select version from pgboss.version')).rows;
  assert.deepEqual(queue, [{ version: 43 }], 'queue_version_unqualified');
  assert.equal(
    (await client.query("select nspowner::regrole::text as owner from pg_namespace where nspname='pgboss'")).rows[0]
      .owner,
    identity.expectedOwner,
    'queue_owner_unqualified',
  );
  const roles = (
    await client.query(
      'select rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolconnlimit from pg_roles where rolname=any($1) order by rolname',
      [
        [
          'insignia_runtime',
          'insignia_worker',
          'insignia_release_append',
          'insignia_release_owner',
          'insignia_release_operator',
          'insignia_queue_enqueue',
          'insignia_queue_consume',
        ],
      ],
    )
  ).rows;
  assert.equal(roles.length, 7, 'roles_unqualified');
  assert.ok(
    roles.every(
      (role) =>
        !role.rolsuper && !role.rolcreatedb && !role.rolcreaterole && !role.rolreplication && !role.rolbypassrls,
    ),
    'roles_unqualified',
  );
  assert.ok(
    roles.every(
      (role) =>
        role.rolcanlogin === ['insignia_runtime', 'insignia_worker', 'insignia_release_append'].includes(role.rolname),
    ),
    'role_login_unqualified',
  );
  assert.equal(roles.find((role) => role.rolname === 'insignia_worker').rolconnlimit, 4);
  assert.equal(roles.find((role) => role.rolname === 'insignia_release_append').rolconnlimit, 2);
  const rights = (
    await client.query(`select
    has_table_privilege('insignia_runtime','trusted_release_records','SELECT') and
    not has_table_privilege('insignia_runtime','trusted_release_records','INSERT,UPDATE,DELETE,TRUNCATE') and
    not has_schema_privilege('insignia_runtime','public','CREATE') and
    not has_schema_privilege('insignia_worker','public','CREATE') and
    not has_schema_privilege('insignia_worker','pgboss','CREATE') and
    pg_has_role('insignia_worker','insignia_queue_consume','MEMBER') and
    pg_has_role('insignia_runtime','insignia_queue_enqueue','MEMBER') and
    not pg_has_role('insignia_worker','insignia_release_owner','MEMBER') and
    not pg_has_role('insignia_worker','insignia_release_operator','MEMBER') and
    not pg_has_role('insignia_worker',current_user,'MEMBER') and
    not pg_has_role('insignia_runtime',current_user,'MEMBER') and
    not has_column_privilege('insignia_worker','inbox_messages','payload','UPDATE') and
    not has_column_privilege('insignia_worker','inbox_messages','erasure_state','UPDATE') and
    not has_table_privilege('insignia_release_append','trusted_release_records','UPDATE,DELETE,TRUNCATE') and
    not has_table_privilege('insignia_worker','webhook_obligation_facts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and
    not has_table_privilege('insignia_runtime','webhook_obligation_facts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as safe`)
  ).rows[0];
  assert.equal(rights.safe, true, 'effective_privileges_unqualified');
  const memberships = (
    await client.query(
      'select roleid::regrole::text as group_role,member::regrole::text as member,grantor::regrole::text as grantor,admin_option,inherit_option,set_option from pg_auth_members where roleid=any(select oid from pg_roles where rolname like $1) or member=any(select oid from pg_roles where rolname like $1) order by roleid,member',
      ['insignia_%'],
    )
  ).rows;
  const acl = (
    await client.query(
      "select c.relname,c.relowner::regrole::text as owner,c.relacl::text as acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','pgboss') and c.relkind in ('r','p','v','m','S') and c.relname<>'owner_lifecycle_decisions' order by n.nspname,c.relname",
    )
  ).rows;
  const functions = (
    await client.query(
      "select p.oid::regprocedure::text as signature,p.proowner::regrole::text as owner,p.prosecdef,p.proconfig,p.proacl::text as acl,md5(pg_get_functiondef(p.oid)) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('expire_shopify_webhook_bytes','expire_shopify_webhook_facts','pending_shopify_webhook_obligations') order by p.proname",
    )
  ).rows;
  assert.equal(functions.length, 3, 'retention_functions_missing');
  assert.ok(
    functions.every((fn) => fn.prosecdef && fn.owner === identity.expectedOwner),
    'retention_authority_unqualified',
  );
  const present = (await client.query("select to_regclass('public.owner_lifecycle_decisions') is not null as present"))
    .rows[0].present;
  assert.equal(present, final, 'unexpected_owner_lifecycle_schema');
  if (final) {
    for (const role of ['insignia_runtime', 'insignia_worker', 'insignia_release_append']) {
      const rights = (
        await client.query(
          "select has_table_privilege($1,'owner_lifecycle_decisions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as exposed",
          [role],
        )
      ).rows[0];
      assert.equal(rights.exposed, false, 'owner_lifecycle_table_exposed');
    }
    assert.equal(
      (await client.query('select count(*)::int as n from owner_lifecycle_decisions')).rows[0].n,
      0,
      'unexpected_owner_decision',
    );
    assert.equal(
      (
        await client.query(
          "select relowner::regrole::text as owner from pg_class where oid='public.owner_lifecycle_decisions'::regclass",
        )
      ).rows[0].owner,
      identity.expectedOwner,
    );
  }
  return { id, roles, memberships, acl, functions };
}
export async function reserveForwardSchema20({ directory, ownerConnectionString, expectedDatabase, expectedOwner }) {
  assert.ok(
    [expectedDatabase, expectedOwner].every((value) => /^[a-z][a-z0-9_]{0,62}$/.test(value)),
    'invalid_owner_identity',
  );
  const url = new URL(ownerConnectionString);
  assert.ok(
    ['postgres:', 'postgresql:'].includes(url.protocol) &&
      decodeURIComponent(url.username) === expectedOwner &&
      decodeURIComponent(url.pathname.slice(1)) === expectedDatabase,
    'exact_owner_endpoint_required',
  );
  await mkdir(directory, { mode: 0o700 });
  await privateDirectory(directory);
  const sources = await sourceInputs();
  const pool = poolFor(ownerConnectionString);
  try {
    const client = await pool.connect();
    try {
      await client.query('begin read only');
      const frozen = await state(client, { expectedDatabase, expectedOwner }, sources.names);
      await client.query('rollback');
      await persist(join(directory, 'credentials.json'), { ownerConnectionString });
      await persist(join(directory, 'plan.json'), {
        version: 'm5-schema-forward20-v1',
        expectedDatabase,
        expectedOwner,
        fromMigrationCount: 19,
        toMigrationCount: 20,
        ...sources,
        frozen,
        credentialsSha256: sha(await privateRead(join(directory, 'credentials.json'))),
      });
      return { status: 'FROZEN', fromMigrationCount: 19, toMigrationCount: 20 };
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
export async function executeForwardSchema20(directory) {
  await privateDirectory(directory);
  const plan = JSON.parse(await privateRead(join(directory, 'plan.json')));
  assert.equal(plan.version, 'm5-schema-forward20-v1');
  const sources = await sourceInputs();
  assert.deepEqual(plan.names, sources.names, 'frozen_source_changed');
  assert.deepEqual(plan.sources, sources.sources, 'frozen_source_changed');
  const raw = await privateRead(join(directory, 'credentials.json'));
  assert.equal(sha(raw), plan.credentialsSha256, 'frozen_credentials_changed');
  try {
    await persist(join(directory, 'attempt.json'), {
      attempt: 1,
      planSha256: sha(await privateRead(join(directory, 'plan.json'))),
    });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('already_reserved');
    throw error;
  }
  const pool = poolFor(JSON.parse(raw).ownerConnectionString);
  let client;
  try {
    client = await pool.connect();
    await client.query(
      "begin;set local lock_timeout='5s';set local statement_timeout='30s';select pg_advisory_xact_lock(hashtext('insignia.m5-runtime.schema-provision'));lock table schema_migrations in exclusive mode",
    );
    assert.deepEqual(await state(client, plan, sources.names), plan.frozen, 'frozen_database_changed');
    const sql = await readFile(join(root, 'packages/database/migrations', migration), 'utf8');
    const up = sql.split('-- migrate:up\n')[1]?.split('-- migrate:down')[0];
    assert.ok(up, 'migration_up_missing');
    await client.query(up);
    await client.query('insert into schema_migrations(version) values($1)', [migration.split('_')[0]]);
    assert.deepEqual(await state(client, plan, sources.names, true), plan.frozen, 'existing_authority_changed');
    await client.query('commit');
    const result = {
      status: 'APPLIED',
      fromMigrationCount: 19,
      toMigrationCount: 20,
      queueVersion: 43,
      rolesReprovisioned: false,
      destructiveDown: false,
    };
    await persist(join(directory, 'completed.json'), result);
    return result;
  } catch {
    await client?.query('rollback').catch(() => {});
    await persist(join(directory, 'stopped.json'), { status: 'STOPPED_RECONCILIATION_REQUIRED', retry: false });
    throw new Error('forward20_stopped_reconciliation_required');
  } finally {
    client?.release();
    await pool.end();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    let raw = '';
    for await (const part of process.stdin) {
      raw += part;
      if (Buffer.byteLength(raw) > 16384) throw new Error('input_too_large');
    }
    const input = JSON.parse(raw);
    if (process.argv[2] === 'reserve') console.log(JSON.stringify(await reserveForwardSchema20(input)));
    else if (process.argv[2] === 'execute') console.log(JSON.stringify(await executeForwardSchema20(input.directory)));
    else throw new Error('invalid_operation');
  } catch {
    console.error('forward20_operator_failed_private_receipts_required');
    process.exitCode = 1;
  }
}
