/** Separate owner-only password operation. Private inputs; never worker startup. */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { Pool } = createRequire(new URL('../../apps/worker/package.json', import.meta.url))('pg');
const roles = [
  'insignia_rewrite',
  'insignia_runtime',
  'insignia_release_owner',
  'insignia_release_operator',
  'insignia_queue_enqueue',
  'insignia_queue_consume',
  'insignia_worker',
  'insignia_release_append',
].sort();
const versions = [
  '20260929000100',
  '20260929000200',
  '20260929000300',
  '20260929000400',
  '20260930000100',
  '20260930000200',
  '20260930000300',
  '20260930000400',
  '20260930000500',
  '20260930000600',
  '20260930000700',
  '20260930000800',
  '20260930000900',
  '20261006000100',
  '20261007000100',
  '20261008000100',
  '20261009000100',
  '20261009000200',
];
const paths = ['scripts/m5-runtime/db-password-rotation.mjs', 'apps/worker/package.json', 'pnpm-lock.yaml'];
const hash = (b) => createHash('sha256').update(b).digest('hex');
const stable = (v) => JSON.stringify(v);
const poolFor = (url) =>
  new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000, query_timeout: 10000 });
async function sources() {
  return Object.fromEntries(await Promise.all(paths.map(async (p) => [p, hash(await readFile(join(root, p)))])));
}
async function privateDirectory(directory) {
  assert.ok(isAbsolute(directory) && resolve(directory) === directory, 'absolute_private_directory_required');
  const s = await stat(directory);
  assert.ok(s.isDirectory() && s.uid === process.getuid() && (s.mode & 0o077) === 0, 'private_directory_required');
  assert.equal(await realpath(directory), directory, 'canonical_directory_required');
}
async function readPrivate(path) {
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = await f.stat();
    assert.ok(
      s.isFile() && s.nlink === 1 && s.uid === process.getuid() && (s.mode & 0o077) === 0 && s.size <= 1024 * 1024,
      'private_input_required',
    );
    return await f.readFile();
  } finally {
    await f.close();
  }
}
async function durable(path, value) {
  const f = await open(path, 'wx', 0o600);
  try {
    await f.writeFile(`${stable(value)}\n`);
    await f.sync();
  } finally {
    await f.close();
  }
  const d = await open(dirname(path), 'r');
  try {
    await d.sync();
  } finally {
    await d.close();
  }
}
function endpoints(owner, runtime, db) {
  assert.match(db, /^[a-z][a-z0-9_]{0,62}$/);
  const a = new URL(owner),
    b = new URL(runtime);
  assert.ok(
    ['postgres:', 'postgresql:'].includes(a.protocol) && a.password && b.password,
    'private_password_urls_required',
  );
  assert.equal(a.username, 'insignia_rewrite');
  assert.equal(b.username, 'insignia_runtime');
  assert.equal(a.pathname, `/${db}`);
  assert.equal(b.pathname, a.pathname);
  assert.equal(b.host, a.host);
  assert.equal(b.protocol, a.protocol);
  assert.equal(b.search, a.search);
  return [a, b];
}
async function snapshot(client, db) {
  const identity = (
    await client.query(
      `select current_database() as database,current_user as owner,current_setting('server_version_num')::int/10000 as major,(pg_control_system()).system_identifier::text as system_identifier`,
    )
  ).rows[0];
  assert.deepEqual(
    { database: identity.database, owner: identity.owner, major: identity.major },
    { database: db, owner: 'insignia_rewrite', major: 18 },
    'owner_identity_mismatch',
  );
  assert.equal(
    (await client.query('select pg_get_userbyid(datdba) as owner from pg_database where datname=current_database()'))
      .rows[0].owner,
    'insignia_rewrite',
    'database_owner_mismatch',
  );
  const applied = (await client.query('select version from public.schema_migrations order by version')).rows.map(
    (r) => r.version,
  );
  assert.deepEqual(applied, versions, 'exact_applied18_required');
  assert.deepEqual(
    (await client.query('select version from pgboss.version')).rows,
    [{ version: 43 }],
    'exact_queue43_required',
  );
  const roleState = (
    await client.query(
      `select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil::text,rolconfig from pg_roles where rolname like 'insignia_%' order by rolname`,
    )
  ).rows;
  assert.deepEqual(
    roleState.map((r) => r.rolname),
    roles,
    'exact_existing_roles_required',
  );
  const owner = roleState.find((r) => r.rolname === 'insignia_rewrite'),
    runtime = roleState.find((r) => r.rolname === 'insignia_runtime');
  assert.ok(owner.rolsuper && owner.rolcanlogin, 'qualified_owner_required');
  assert.ok(
    runtime.rolcanlogin &&
      !runtime.rolsuper &&
      !runtime.rolcreaterole &&
      !runtime.rolcreatedb &&
      !runtime.rolreplication &&
      !runtime.rolbypassrls,
    'runtime_privileges_unqualified',
  );
  assert.equal(
    (
      await client.query(
        "select pg_has_role('insignia_runtime','insignia_rewrite','MEMBER') or pg_has_role('insignia_runtime','pg_database_owner','MEMBER') as inherited",
      )
    ).rows[0].inherited,
    false,
    'runtime_owner_inheritance',
  );
  for (const role of roleState.filter((r) => !['insignia_rewrite', 'insignia_runtime'].includes(r.rolname))) {
    assert.ok(
      !role.rolsuper && !role.rolcreaterole && !role.rolcreatedb && !role.rolreplication && !role.rolbypassrls,
      'existing_group_privilege_mismatch',
    );
    assert.equal(
      role.rolcanlogin,
      ['insignia_worker', 'insignia_release_append'].includes(role.rolname),
      'existing_role_login_mismatch',
    );
  }
  assert.equal(roleState.find((r) => r.rolname === 'insignia_worker').rolconnlimit, 4);
  assert.equal(roleState.find((r) => r.rolname === 'insignia_release_append').rolconnlimit, 2);
  const trusted = (
    await client.query(
      "select has_table_privilege('insignia_runtime','trusted_release_records','SELECT') as readable,has_table_privilege('insignia_runtime','trusted_release_records','INSERT,UPDATE,DELETE,TRUNCATE') as writable",
    )
  ).rows[0];
  assert.deepEqual(trusted, { readable: true, writable: false }, 'runtime_trusted_release_privilege_mismatch');
  const memberships = (
    await client.query(
      `select r.rolname as role,m.rolname as member,a.admin_option,a.inherit_option,a.set_option,a.grantor::text from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member where r.rolname=any($1) or m.rolname=any($1) order by r.rolname,m.rolname`,
      [roles],
    )
  ).rows;
  const relations = (
    await client.query(
      `select n.nspname,c.relname,c.relkind,c.relowner::text,c.relacl::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','pgboss') order by n.nspname,c.relname`,
    )
  ).rows;
  const columns = (
    await client.query(
      `select n.nspname,c.relname,a.attname,a.attacl::text from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','pgboss') and a.attnum>0 and a.attacl is not null order by n.nspname,c.relname,a.attname`,
    )
  ).rows;
  const functions = (
    await client.query(
      `select n.nspname,p.proname,p.oid::text,p.proowner::text,p.proacl::text,encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') as definition_hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','pgboss') and p.prokind='f' order by n.nspname,p.oid`,
    )
  ).rows;
  const schemas = (
    await client.query(
      "select nspname,nspowner::text,nspacl::text from pg_namespace where nspname in ('public','pgboss') order by nspname",
    )
  ).rows;
  const databaseState = (
    await client.query(
      'select datname,datdba::text,datacl::text,datconnlimit,datallowconn,datistemplate,encoding,datcollate,datctype from pg_database where datname=current_database()',
    )
  ).rows;
  const loggingModules = (
    await client.query(
      "select name,setting from pg_settings where name in ('shared_preload_libraries','session_preload_libraries','local_preload_libraries') order by name",
    )
  ).rows;
  assert.equal(loggingModules.length, 3);
  assert.ok(
    loggingModules.every((r) => r.setting === ''),
    'unqualified_preloaded_logging_module',
  );
  const passwords = (
    await client.query(
      "select rolname,encode(sha256(convert_to(coalesce(rolpassword,''),'UTF8')),'hex') as password_hash,rolpassword like 'SCRAM-SHA-256$%' as scram from pg_authid where rolname in ('insignia_rewrite','insignia_runtime') order by rolname",
    )
  ).rows;
  assert.ok(
    passwords.every((r) => r.scram),
    'existing_scram_required',
  );
  return {
    identity,
    applied,
    roleState,
    memberships,
    relations,
    columns,
    functions,
    schemas,
    passwords,
    databaseState,
    loggingModules,
  };
}
const privileges = (s) => ({ ...s, passwords: undefined });
export async function reserveDatabasePasswordRotation({
  directory,
  ownerConnectionString,
  runtimeConnectionString,
  expectedDatabase,
}) {
  endpoints(ownerConnectionString, runtimeConnectionString, expectedDatabase);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await privateDirectory(directory);
  assert.equal((await readdir(directory)).length, 0, 'empty_private_directory_required');
  const pool = poolFor(ownerConnectionString);
  const runtime = poolFor(runtimeConnectionString);
  let client;
  try {
    assert.equal((await runtime.query('select current_user as role')).rows[0].role, 'insignia_runtime');
    client = await pool.connect();
    await client.query('begin read only');
    const frozen = await snapshot(client, expectedDatabase);
    await client.query('rollback');
    const ownerPassword = randomBytes(32).toString('hex'),
      runtimePassword = randomBytes(32).toString('hex');
    const [ownerUrl, runtimeUrl] = endpoints(ownerConnectionString, runtimeConnectionString, expectedDatabase);
    ownerUrl.password = ownerPassword;
    runtimeUrl.password = runtimePassword;
    const credentials = {
      ownerConnectionString,
      runtimeConnectionString,
      ownerPassword,
      runtimePassword,
      ownerUrl: ownerUrl.href,
      runtimeUrl: runtimeUrl.href,
    };
    await durable(join(directory, 'credentials.json'), credentials);
    const bytes = await readPrivate(join(directory, 'credentials.json'));
    const plan = {
      version: 'm5-two-password-rotation-v1',
      expectedDatabase,
      sources: await sources(),
      snapshot: frozen,
      credentialsSha256: hash(bytes),
      attempts: 1,
    };
    await durable(join(directory, 'plan.json'), plan);
    return { status: 'FROZEN', roles: ['insignia_rewrite', 'insignia_runtime'], appliedMigrations: 18 };
  } finally {
    client?.release();
    await Promise.allSettled([pool.end(), runtime.end()]);
  }
}
export async function executeDatabasePasswordRotation(directory) {
  await privateDirectory(directory);
  if ((await readdir(directory)).includes('attempt.json')) throw new Error('attempt_already_reserved');
  const plan = JSON.parse(await readPrivate(join(directory, 'plan.json')));
  assert.equal(plan.version, 'm5-two-password-rotation-v1');
  assert.equal(plan.attempts, 1);
  assert.deepEqual(await sources(), plan.sources, 'frozen_source_changed');
  const raw = await readPrivate(join(directory, 'credentials.json'));
  assert.equal(hash(raw), plan.credentialsSha256, 'frozen_credentials_changed');
  const secrets = JSON.parse(raw);
  endpoints(secrets.ownerConnectionString, secrets.runtimeConnectionString, plan.expectedDatabase);
  for (const key of ['ownerPassword', 'runtimePassword']) assert.match(secrets[key], /^[a-f0-9]{64}$/);
  const [a, b] = endpoints(secrets.ownerConnectionString, secrets.runtimeConnectionString, plan.expectedDatabase);
  a.password = secrets.ownerPassword;
  b.password = secrets.runtimePassword;
  assert.equal(a.href, secrets.ownerUrl);
  assert.equal(b.href, secrets.runtimeUrl);
  await durable(join(directory, 'attempt.json'), {
    status: 'RESERVED',
    roles: ['insignia_rewrite', 'insignia_runtime'],
    planSha256: hash(await readPrivate(join(directory, 'plan.json'))),
  });
  const pool = poolFor(secrets.ownerConnectionString);
  let client;
  let committed = false;
  let phase = 'CONNECT';
  try {
    client = await pool.connect();
    await client.query("begin;set local statement_timeout='10s';set local lock_timeout='1s';");
    phase = 'CAS';
    assert.deepEqual(await snapshot(client, plan.expectedDatabase), plan.snapshot, 'frozen_database_changed');
    phase = 'LOGGING_GUARD';
    await client.query(
      "set local log_statement='none';set local log_min_duration_statement=-1;set local log_min_duration_sample=-1;set local log_statement_sample_rate=0;set local log_min_error_statement='panic';set local log_parameter_max_length=0;set local log_parameter_max_length_on_error=0;set local password_encryption='scram-sha-256'",
    );
    phase = 'PASSWORD_UPDATE';
    await client.query(
      `alter role insignia_rewrite password '${secrets.ownerPassword}';alter role insignia_runtime password '${secrets.runtimePassword}'`,
    );
    const after = await snapshot(client, plan.expectedDatabase);
    assert.deepEqual(privileges(after), privileges(plan.snapshot), 'privilege_state_changed');
    assert.ok(
      after.passwords.every((r, i) => r.scram && r.password_hash !== plan.snapshot.passwords[i].password_hash),
      'password_change_not_exact',
    );
    phase = 'COMMIT';
    await client.query('commit');
    committed = true;
    await durable(join(directory, 'ack.json'), { status: 'ACKNOWLEDGED', privilegeStateUnchanged: true });
    phase = 'NEW_LOGIN_READBACK';
    for (const [url, role] of [
      [secrets.ownerUrl, 'insignia_rewrite'],
      [secrets.runtimeUrl, 'insignia_runtime'],
    ]) {
      const next = poolFor(url);
      try {
        const identity = (await next.query('select current_user as role,current_database() as database')).rows[0];
        assert.deepEqual(identity, { role, database: plan.expectedDatabase });
        if (role === 'insignia_rewrite') {
          const c = await next.connect();
          try {
            assert.deepEqual(privileges(await snapshot(c, plan.expectedDatabase)), privileges(plan.snapshot));
          } finally {
            c.release();
          }
        }
      } finally {
        await next.end();
      }
    }
    phase = 'OLD_LOGIN_REJECTION';
    for (const url of [secrets.ownerConnectionString, secrets.runtimeConnectionString]) {
      const old = poolFor(url);
      try {
        let denied = false;
        try {
          await old.query('select 1');
        } catch (e) {
          if (e.code === '28P01') denied = true;
          else throw new Error('old_login_settlement_unknown');
        }
        assert.ok(denied, 'old_login_still_valid');
      } finally {
        await old.end();
      }
    }
    await durable(join(directory, 'result.json'), {
      status: 'ROTATED_VERIFIED',
      roles: ['insignia_rewrite', 'insignia_runtime'],
      newScramLogins: true,
      oldLoginsRejected: true,
      privilegesUnchanged: true,
    });
    return { status: 'ROTATED_VERIFIED' };
  } catch {
    if (client && !committed) await client.query('rollback').catch(() => {});
    await durable(join(directory, 'stopped.json'), {
      status: 'STOP_ROTATION_UNCERTAIN',
      phase,
      commitAcknowledged: committed,
    }).catch(() => {});
    return { status: 'STOP_ROTATION_UNCERTAIN', phase, commitAcknowledged: committed };
  } finally {
    client?.release();
    await pool.end().catch(() => {});
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const operation = process.argv[2],
      directory = process.argv[3];
    assert.equal(process.argv.length, 4, 'fixed_arguments_required');
    let result;
    if (operation === 'reserve') {
      assert.notEqual(process.stdin.isTTY, true, 'private_pipe_required');
      const chunks = [];
      let length = 0;
      for await (const chunk of process.stdin) {
        length += chunk.length;
        assert.ok(length <= 16384, 'bounded_private_input_required');
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.deepEqual(Object.keys(input).sort(), [
        'expectedDatabase',
        'ownerConnectionString',
        'runtimeConnectionString',
      ]);
      result = await reserveDatabasePasswordRotation({ directory, ...input });
    } else {
      assert.equal(operation, 'execute', 'fixed_operation_required');
      result = await executeDatabasePasswordRotation(directory);
    }
    console.log(JSON.stringify(result));
    if (result.status !== 'FROZEN' && result.status !== 'ROTATED_VERIFIED') process.exitCode = 1;
  } catch {
    console.error('db_password_rotation_stopped');
    process.exitCode = 1;
  }
}
