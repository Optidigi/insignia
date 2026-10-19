/** Explicit disposable PostgreSQL18 qualification; never consumes ambient DB URLs. */
import assert from 'node:assert/strict';
import { type SpawnSyncOptionsWithStringEncoding, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { array, record, root, text, timestamp } from './backup-files.mts';

const TOOLS = process.env.BACKUP_PG_TOOLS;
test('real populated dump restores atomically with erasure/expiry replay, unchanged facts and mandatory hold', {
  skip: !TOOLS ? 'Set BACKUP_PG_TOOLS to existing PostgreSQL18 tools for owned-cluster qualification' : false,
}, async (t) => {
  const tools = text(TOOLS),
    directory = mkdtempSync(join(tmpdir(), 'insignia-restore-pg-')),
    stage = mkdtempSync('/dev/shm/insignia-backup-'),
    socket = join(directory, 'socket');
  mkdirSync(socket, { mode: 0o700 });
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('PG') && key !== 'DATABASE_URL'),
    ),
    PGHOST: socket,
    PGUSER: 'serveradmin',
    PGDATABASE: 'backup_source',
    PGPORT: '5432',
  };
  const invoke = (argv: string[], options: Partial<SpawnSyncOptionsWithStringEncoding> = {}) => {
    const [command, ...args] = argv;
    assert(command);
    return spawnSync(command, args, { ...options, env: options.env ?? env, encoding: 'utf8' });
  };
  const run = (argv: string[], options: Partial<SpawnSyncOptionsWithStringEncoding> = {}) => {
    const result = invoke(argv, options);
    assert.equal(result.status, 0, `Isolated command failed: ${result.stderr}`);
    return result.stdout;
  };
  const psql = (sql: string) => run([join(tools, 'psql'), '-X', '-v', 'ON_ERROR_STOP=1', '-c', sql]);
  const fixture = new URL('./backup-integration.fixture.mts', import.meta.url).pathname;
  const nodeFixture = (mode: string, ...args: string[]) => run([process.execPath, fixture, mode, ...args]);
  const migrationDirectory = join(root, 'packages/database/migrations'),
    migrations = readdirSync(migrationDirectory)
      .filter((name) => name.endsWith('.sql'))
      .sort();
  let started = false;
  try {
    const share = join(dirname(dirname(dirname(dirname(tools)))), 'share/postgresql/18');
    run([
      join(tools, 'initdb'),
      '-D',
      join(directory, 'data'),
      '-A',
      'trust',
      '-U',
      'serveradmin',
      '--no-locale',
      '-E',
      'UTF8',
      '-L',
      share,
    ]);
    run([
      join(tools, 'pg_ctl'),
      '-D',
      join(directory, 'data'),
      '-l',
      join(directory, 'postgres.log'),
      '-o',
      `-k ${socket} -h '' -p 5432`,
      '-w',
      'start',
    ]);
    started = true;
    run([join(tools, 'createdb'), 'backup_source']);
    psql('CREATE TABLE schema_migrations(version varchar(255) PRIMARY KEY)');
    for (const migration of migrations) {
      const sql = readFileSync(join(migrationDirectory, migration), 'utf8')
        .split('-- migrate:up')[1]
        ?.split('-- migrate:down')[0];
      assert(sql);
      run([join(tools, 'psql'), '-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction'], {
        input: `${sql}\nINSERT INTO schema_migrations VALUES('${migration.split('_')[0]}');`,
      });
    }
    const url = `postgresql://serveradmin@localhost/backup_source?host=${socket}`;
    run(
      [
        join(root, 'packages/database/node_modules/.bin/vitest'),
        'run',
        'test/activation.test.ts',
        '-t',
        'v3 hold/evidence/restoration audit JSONB roundtrips',
      ],
      { cwd: join(root, 'packages/database'), env: { ...env, DATABASE_URL: url } },
    );
    const historicalSQL =
      "SELECT jsonb_build_object('evidence',(SELECT jsonb_agg(to_jsonb(e) ORDER BY shop_id,config_id,operation_id) FROM m5_activation_evidence e),'states',(SELECT jsonb_agg(to_jsonb(s) ORDER BY shop_id,config_id,operation_id) FROM m5_activation_state s))::text";
    const helperSQL =
      "SELECT jsonb_object_agg(oid::regprocedure::text,md5(prosrc))::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'm5_v3_%'";
    const at = (sql: string) => run([join(tools, 'psql'), '-X', '-Atc', sql]);
    const historical = at(historicalSQL),
      helpers = at(helperSQL);
    assert(array(record(JSON.parse(historical)).evidence).length > 0, 'populated activation evidence required');
    psql(
      "DO $$ DECLARE f record; BEGIN FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'm5_v3_%' LOOP EXECUTE format('ALTER FUNCTION %s RESET search_path',f.signature); END LOOP; END $$",
    );
    nodeFixture('snapshot-read');
    const exclusions = join(stage, 'exclusions.json'),
      privacy = join(root, 'scripts/privacy/restore-exclusions.mts');
    const exportExclusions = () => {
      env.DATABASE_URL = url;
      run([process.execPath, privacy, 'export', exclusions]);
      delete env.DATABASE_URL;
    };
    exportExclusions();
    const certificate = join(stage, 'recipient.pem'),
      key = join(stage, 'identity.pem');
    run([
      'openssl',
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=isolated-backup-test',
      '-keyout',
      key,
      '-out',
      certificate,
    ]);
    const objects = join(stage, 'objects');
    mkdirSync(objects, { mode: 0o700 });
    const manifest = join(stage, 'manifest.json'),
      now = Date.now(),
      window = join(stage, 'window.json');
    writeFileSync(
      window,
      JSON.stringify({
        id: 'owned-empty-database-test',
        startedAt: new Date(now).toISOString(),
        until: new Date(now + 3600000).toISOString(),
      }),
      { mode: 0o600 },
    );
    const profile = join(stage, 'storage-profile.json');
    writeFileSync(
      profile,
      JSON.stringify({ accessKeyId: 'local-fixture-access-key', secretAccessKey: 'local-fixture-only' }),
      { mode: 0o600 },
    );
    const promised = new Date(now + 4 * 86400000).toISOString();
    Object.assign(env, {
      ARTWORK_R2_ENDPOINT: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com/`,
      ARTWORK_R2_BUCKET: 'local-fixture-bucket',
      ARTWORK_R2_PREFIX: 'snapshot-fixture',
      ARTWORK_STORAGE_PROFILE: profile,
      BACKUP_PROMISED_CLEANUP_AT: promised,
    });
    nodeFixture('produce', objects, manifest, window);
    const produced = record(JSON.parse(readFileSync(manifest, 'utf8')));
    assert.equal(timestamp(produced.promisedCleanupAt), timestamp(promised));
    assert(timestamp(produced.absoluteExpiresAt) > now + 7 * 86400000);
    const operator = new URL('./backup.mts', import.meta.url).pathname;
    const backup = record(
      JSON.parse(
        run([
          process.execPath,
          operator,
          'create',
          '--store',
          join(stage, 'store'),
          '--scratch',
          join(stage, 'scratch'),
          '--objects',
          objects,
          '--object-manifest',
          manifest,
          '--recipient',
          certificate,
          '--pg-dump',
          join(tools, 'pg_dump'),
        ]),
      ),
    );
    const namespace = readFileSync(join(migrationDirectory, '20261018000500_restore_validation_namespace.sql'), 'utf8')
      .split('-- migrate:up')[1]
      ?.split('-- migrate:down')[0];
    assert(namespace);
    psql(namespace);
    unlinkSync(exclusions);
    exportExclusions();
    env.PGDATABASE = 'insignia_recovery_qualification';
    const restoreArgs = (destination: string, psqlPath: string) => [
      process.execPath,
      operator,
      'restore',
      '--artifact',
      join(stage, 'store', `${text(backup.id)}.cms`),
      '--receipt',
      join(stage, 'store', `${text(backup.id)}.json`),
      '--identity',
      key,
      '--destination',
      destination,
      '--exclusions',
      exclusions,
      '--createdb',
      join(tools, 'createdb'),
      '--pg-restore',
      join(tools, 'pg_restore'),
      '--psql',
      psqlPath,
    ];
    const restored = record(JSON.parse(run(restoreArgs(join(stage, 'restored'), join(tools, 'psql')))));
    assert.equal(restored.readiness, 'HOLD_STORAGE_ERASURE_AND_AUTHORITY_REQUALIFICATION');
    assert.equal(restored.erasureImportCompleted, true);
    assert.equal(restored.databaseExpiryReplayed, true);
    assert.equal(at(historicalSQL), historical);
    const validation = at(
      "SET search_path=''; SELECT bool_and(public.m5_v3_held(evidence#>'{hold,held}',evidence#>'{hold,before}')) FROM public.m5_activation_evidence WHERE evidence->'hold'<>'null'; SELECT public.m5_v3_held('{}','{}')",
    )
      .trim()
      .split('\n');
    assert.deepEqual(validation.slice(-2), ['t', 'f']);
    assert.equal(
      Number(
        at(
          "SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'm5_v3_%' AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']",
        ),
      ),
      12,
    );
    assert.equal(at(helperSQL), helpers);
    const malformed = invoke([
      join(tools, 'psql'),
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      "INSERT INTO public.m5_activation_evidence SELECT (jsonb_populate_record(NULL::public.m5_activation_evidence, to_jsonb(e) || jsonb_build_object('evidence',jsonb_set(e.evidence,'{hold,held,anchorDigest}',to_jsonb(repeat('0',64)))))).* FROM public.m5_activation_evidence e WHERE evidence->'hold'<>'null' LIMIT 1",
    ]);
    assert.notEqual(malformed.status, 0);
    assert.match(malformed.stderr, /m5_017_evidence_v3_hold/);
    for (const name of ['restore-pre.sql', 'restore-data.sql', 'restore-post.sql', 'restore-fix.sql'])
      assert(!existsSync(join(stage, 'restored', name)));
    env.PGDATABASE = 'insignia_recovery_rollback';
    const failing = join(stage, 'failing-psql'),
      failingFixture = new URL('./backup-failing-psql.fixture.mts', import.meta.url).pathname;
    for (const value of [process.execPath, failingFixture, tools]) assert(!value.includes("'"));
    writeFileSync(
      failing,
      `#!/bin/sh\nexec '${process.execPath}' '${failingFixture}' '${join(tools, 'psql')}' "$@"\n`,
      { mode: 0o700 },
    );
    const failed = invoke(restoreArgs(join(stage, 'failed-restore'), failing));
    assert.equal(failed.status, 1);
    assert.equal(Number(at("SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace")), 0);
    assert.deepEqual(readdirSync(join(stage, 'failed-restore')).sort(), ['HOLD.json']);
    env.PGDATABASE = 'insignia_recovery_qualification';
    assert(!existsSync(join(stage, 'restored/snapshot.tar')));
    assert(!existsSync(join(stage, 'restored/database.dump')));
    assert.equal(Number(at('SELECT count(*) FROM schema_migrations')), migrations.length);
    run([join(tools, 'createdb'), '--template', 'backup_source', 'privacy_restore_source']);
    env.PGDATABASE = 'backup_source';
    t.diagnostic(`Actual PostgreSQL heartbeat aggregates: ${nodeFixture('telemetry').trim()}`);
    const restoreSource = url.replace('/backup_source?', '/privacy_restore_source?');
    Object.assign(env, {
      DATABASE_URL: restoreSource,
      PRIVACY_RESTORE_TEST_URL: restoreSource,
      PRIVACY_PG_TOOLS: tools,
    });
    run([join(root, 'packages/database/node_modules/.bin/vitest'), 'run', 'test/privacy-restore.test.ts'], {
      cwd: join(root, 'packages/database'),
    });
    delete env.DATABASE_URL;
    run([join(tools, 'createdb'), '--template', 'privacy_restore_source', 'insignia_recovery_expiry_fixture']);
    env.PGDATABASE = 'insignia_recovery_expiry_fixture';
    t.diagnostic(`Actual isolated expiry replay: ${nodeFixture('expiry').trim()}`);
  } finally {
    if (started) run([join(tools, 'pg_ctl'), '-D', join(directory, 'data'), '-m', 'immediate', '-w', 'stop']);
    rmSync(directory, { recursive: true, force: true });
    rmSync(stage, { recursive: true, force: true });
  }
});
