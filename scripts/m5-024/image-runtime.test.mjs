import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { qualifyImageConfiguration, qualifyImageRuntime } from './image-observations.mjs';

const root = resolve(import.meta.dirname, '../..');
const entry = '/srv/insignia/worker/dist/main.js';
const postgresImage =
  'public.ecr.aws/docker/library/postgres@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336';
const health = `/usr/local/bin/node -e "fetch('http://127.0.0.1:4301/ready').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"`;

// This script is sent over Docker exec stdin; no executable mount or image modification.
const processProbe = `
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { connect } from 'node:net';
const status = readFileSync('/proc/1/status', 'utf8');
const field = (name) => status.split('\\n').find(line => line.startsWith(name + ':')).split(':')[1].trim();
let rootWriteError = null;
try { writeFileSync('/tmp/m5-image-root-write-probe', 'must fail'); } catch (error) { rootWriteError = error.code; }
const externalConnect = await new Promise(resolve => {
  // Documentation-only IP: no Shopify/provider request, DNS lookup or provider payload.
  const socket = connect({ host: '192.0.2.1', port: 443 });
  const finish = value => { socket.destroy(); resolve(value); };
  socket.setTimeout(1500, () => finish(false));
  socket.once('error', () => finish(false));
  socket.once('connect', () => finish(true));
});
console.log(JSON.stringify({
  argv: readFileSync('/proc/1/cmdline', 'utf8').split('\\0').filter(Boolean),
  uid: field('Uid').split(/\\s+/).map(Number), gid: field('Gid').split(/\\s+/).map(Number),
  capabilities: ['CapInh','CapPrm','CapEff','CapBnd','CapAmb'].map(field),
  noNewPrivileges: Number(field('NoNewPrivs')), rootWriteError, externalConnect,
  defaultRoute: readFileSync('/proc/net/route', 'utf8').trim().split('\\n').slice(1).some(line => line.trim().split(/\\s+/)[1] === '00000000'),
  nodeExecutableSha256: createHash('sha256').update(readFileSync('/proc/1/exe')).digest('hex'),
}));
`;

test('actual built worker image qualifies OS isolation, frozen inventory, readiness, SIGTERM and restart on disposable PG18', {
  timeout: 420_000,
}, async () => {
  const evidence = process.env.M5_IMAGE_EVIDENCE_DIR
    ? resolve(process.env.M5_IMAGE_EVIDENCE_DIR)
    : await mkdtemp(join(tmpdir(), 'insignia-m5-image-evidence-'));
  if (process.env.M5_IMAGE_EVIDENCE_DIR) await mkdir(evidence);
  console.log(`M5 image evidence: ${evidence}`);
  const receipt = {
    status: 'NOT_RUN',
    controls: [],
    limitations: [
      'Disposable CI only; production topology, deployment, backup/rollback, native providers, uninstall authority and privacy effects are NOT_RUN.',
      'Network control observes one internal IPv4 network, no default route and failed TCP to documentation-only 192.0.2.1:443; it does not attest host-gateway services, DNS filtering or arbitrary host topology.',
      'Local image ID is recorded; no registry image is pushed and no registry digest or exported image-tar hash is claimed.',
    ],
  };
  const prefix = `insignia-m5-image-${randomUUID().replaceAll('-', '')}`;
  const networkName = `${prefix}-net`;
  const databaseName = `${prefix}-db`;
  const workerName = `${prefix}-worker`;
  const imageTag = `${prefix}:qualification`;
  let commandNumber = 0;
  let context;
  let pool;
  let dockerReady = false;
  const owned = { network: false, database: false, worker: false, image: false };

  async function run(command, args, { input, env = process.env, timeout = 60_000 } = {}) {
    const log = join(evidence, `${String(++commandNumber).padStart(3, '0')}.log`);
    const result = await new Promise((resolveResult) => {
      const child = spawn(command, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (bytes) => {
        stdout += bytes;
      });
      child.stderr.on('data', (bytes) => {
        stderr += bytes;
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
      child.once('error', (error) => {
        stderr += error.message;
      });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        resolveResult({ code, signal, stdout, stderr });
      });
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    });
    await writeFile(
      log,
      `${JSON.stringify({ command, args, code: result.code, signal: result.signal })}\n${result.stdout}\n${result.stderr}`,
    );
    assert.equal(result.code, 0, `${command} failed; raw log ${log}: ${result.stderr.slice(-2000)}`);
    return result.stdout.trim();
  }
  const docker = (args, options) => run('docker', args, options);
  const inspect = async (name) => JSON.parse(await docker(['inspect', name]))[0];
  async function healthy(name) {
    for (let attempt = 0; attempt < 90; attempt++) {
      const value = await inspect(name);
      if (value.State.Health?.Status === 'healthy') return value;
      assert.equal(value.State.Running, true, `${name} stopped before readiness`);
      await delay(500);
    }
    throw new Error(`${name} did not become healthy within 45 seconds`);
  }
  try {
    await docker(['version']);
    dockerReady = true;
    receipt.status = 'FAIL';
    assert.equal(process.version, 'v24.21.0');
    assert.ok(
      process.env.M5_WORKER_PACKAGE_ENTRY,
      'M5_WORKER_PACKAGE_ENTRY is required; no skipped image qualification',
    );
    const packageEntry = resolve(process.env.M5_WORKER_PACKAGE_ENTRY);
    const packageRoot = dirname(dirname(packageEntry));
    const { collectWorkerInventory } = await import(
      '../../docs/delivery/evidence/m5-023/operators/worker-inventory.mjs'
    );
    const expectedInventory = collectWorkerInventory(packageEntry);
    assert.deepEqual(expectedInventory, JSON.parse(await readFile(join(packageRoot, 'worker-inventory.json'), 'utf8')));
    await writeFile(join(evidence, 'expected-inventory.json'), JSON.stringify(expectedInventory));
    receipt.sourceHead = await run('git', ['rev-parse', 'HEAD']);
    receipt.sourceTree = await run('git', ['rev-parse', 'HEAD^{tree}']);
    receipt.dockerfileSha256 = createHash('sha256')
      .update(await readFile(join(root, 'scripts/m5-024/Dockerfile')))
      .digest('hex');
    context = await mkdtemp(join(tmpdir(), `${prefix}-context-`));
    // Preserve portable pnpm relative links; fs.cp's default resolves link targets.
    await cp(packageRoot, join(context, 'worker-package'), { recursive: true, verbatimSymlinks: true });
    assert.deepEqual(collectWorkerInventory(join(context, 'worker-package/dist/main.js')), expectedInventory);
    await cp(join(root, 'scripts/m5-024/Dockerfile'), join(context, 'Dockerfile'));
    const iid = join(context, 'image-id');
    owned.image = true;
    await docker(['build', '--network=none', '--iidfile', iid, '--tag', imageTag, context], { timeout: 180_000 });
    const imageId = (await readFile(iid, 'utf8')).trim();
    receipt.imageId = imageId;
    receipt.image = await inspect(imageId);
    qualifyImageConfiguration(receipt.image);
    receipt.controls.push('built-image-identity');

    owned.network = true;
    await docker(['network', 'create', '--internal', networkName]);
    const network = JSON.parse(await docker(['network', 'inspect', networkName]))[0];
    owned.database = true;
    await docker([
      'create',
      '--name',
      databaseName,
      '--network',
      networkName,
      '--network-alias',
      'fixture-db',
      '--publish',
      '127.0.0.1::5432',
      '--env',
      'POSTGRES_USER=insignia_test',
      '--env',
      'POSTGRES_PASSWORD=synthetic-owner',
      '--env',
      'POSTGRES_DB=insignia_image_test',
      '--health-cmd',
      'pg_isready -U insignia_test -d insignia_image_test',
      '--health-interval',
      '1s',
      '--health-timeout',
      '3s',
      '--health-retries',
      '30',
      postgresImage,
    ]);
    await docker(['start', databaseName]);
    const database = await healthy(databaseName);
    const binding = database.NetworkSettings.Ports['5432/tcp'];
    assert.equal(binding.length, 1);
    assert.equal(binding[0].HostIp, '127.0.0.1');
    const ownerUrl = `postgres://insignia_test:synthetic-owner@127.0.0.1:${binding[0].HostPort}/insignia_image_test?sslmode=disable`;
    await run(
      join(root, 'node_modules/.bin/dbmate'),
      ['--no-dump-schema', '--migrations-dir', join(root, 'packages/database/migrations'), 'up'],
      {
        env: { PATH: process.env.PATH, DATABASE_URL: ownerUrl },
      },
    );
    const { installQueue } = await import('./install-queue.mjs');
    receipt.queueInstall = await installQueue(ownerUrl);
    const requireWorker = createRequire(new URL('../../apps/worker/package.json', import.meta.url));
    const { Pool } = requireWorker('pg');
    pool = new Pool({ connectionString: ownerUrl });
    const serverVersion = (await pool.query('show server_version_num')).rows[0].server_version_num;
    assert.equal(Math.floor(Number(serverVersion) / 10000), 18);
    await pool.query(await readFile(new URL('./queue-roles.sql', import.meta.url), 'utf8'));
    await pool.query(
      "create role image_worker login password 'synthetic-worker' nosuperuser nocreatedb nocreaterole noreplication nobypassrls; grant insignia_queue_consume to image_worker",
    );
    const login = new Pool({
      connectionString: ownerUrl.replace('insignia_test:synthetic-owner', 'image_worker:synthetic-worker'),
    });
    try {
      const currentUser = (await login.query('select current_user')).rows[0].current_user;
      assert.equal(currentUser, 'image_worker');
      const roleFlags = (
        await login.query(
          'select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user',
        )
      ).rows[0];
      assert.deepEqual(roleFlags, {
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: false,
      });
      const memberships = (
        await login.query(
          'select r.rolname from pg_auth_members m join pg_roles r on r.oid=m.roleid where m.member=(select oid from pg_roles where rolname=current_user) order by r.rolname',
        )
      ).rows.map((row) => row.rolname);
      assert.deepEqual(memberships, ['insignia_queue_consume']);
      const denied = [];
      for (const sql of [
        'create table pgboss.escape(id int)',
        'create schema escape',
        'truncate pgboss.job',
        'update pgboss.version set version=42',
      ]) {
        await assert.rejects(login.query(sql), { code: '42501' });
        denied.push({ sql, sqlstate: '42501' });
      }
      assert.equal((await login.query('select version from pgboss.version')).rows[0].version, 43);
      receipt.database = { serverVersion, currentUser, roleFlags, memberships, denied, schemaVersion: 43 };
    } finally {
      await login.end();
    }
    receipt.controls.push('PG18-owner-install-schema43-restricted-consume-role');
    owned.worker = true;
    await docker([
      'create',
      '--pull=never',
      '--name',
      workerName,
      '--network',
      networkName,
      '--read-only',
      '--user',
      'node',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges:true',
      '--restart=unless-stopped',
      '--stop-timeout=40',
      '--health-cmd',
      health,
      '--health-interval',
      '1s',
      '--health-timeout',
      '3s',
      '--health-retries',
      '30',
      '--env',
      'DATABASE_URL=postgres://image_worker:synthetic-worker@fixture-db:5432/insignia_image_test?sslmode=disable',
      '--env',
      'SHOPIFY_CLIENT_ID=synthetic-client',
      '--env',
      'SHOPIFY_CLIENT_SECRET=synthetic-secret',
      '--env',
      'INSIGNIA_CREDENTIAL_KEY_ID=synthetic-k1',
      '--env',
      `INSIGNIA_CREDENTIAL_KEY_BASE64=${Buffer.alloc(32, 7).toString('base64')}`,
      imageId,
    ]);
    await docker(['start', workerName]);
    const inventorySource = await readFile(
      join(root, 'docs/delivery/evidence/m5-023/operators/worker-inventory.mjs'),
      'utf8',
    );
    async function qualifyRunning(label) {
      const container = await healthy(workerName);
      assert.equal(container.HostConfig.RestartPolicy.Name, 'unless-stopped');
      const process = JSON.parse(
        await docker(['exec', '-i', workerName, '/usr/local/bin/node', '--input-type=module'], { input: processProbe }),
      );
      const inventory = JSON.parse(
        await docker(['exec', '-i', workerName, '/usr/local/bin/node', '--input-type=module'], {
          input: `${inventorySource}\nconsole.log(JSON.stringify(collectWorkerInventory('${entry}'))));`,
        }),
      );
      qualifyImageRuntime({ imageId, container, network, process, inventory, expectedInventory });
      await docker([
        'exec',
        workerName,
        '/usr/local/bin/node',
        '--input-type=module',
        '-e',
        "for(const route of ['ready','live']) {const r=await fetch('http://127.0.0.1:4301/'+route); if(r.status!==200)throw new Error(route+' unhealthy');}",
      ]);
      await writeFile(
        join(evidence, `${label}-observations.json`),
        JSON.stringify({ container, network, process, inventory }),
      );
      receipt.controls.push(`${label}-PID1-OS-isolation-inventory-live-ready`);
      return container;
    }
    const startup = await qualifyRunning('startup');
    await docker(['stop', '--time', '40', workerName]);
    const stopped = await inspect(workerName);
    assert.equal(stopped.State.Running, false);
    assert.equal(stopped.State.ExitCode, 0, 'SIGTERM clean exit, no timeout SIGKILL');
    await writeFile(join(evidence, 'sigterm-observations.json'), JSON.stringify(stopped));
    receipt.controls.push('SIGTERM-exit0');
    await docker(['start', workerName]);
    const restarted = await qualifyRunning('restart');
    assert.notEqual(restarted.State.StartedAt, startup.State.StartedAt, 'restart must launch a new process');
    receipt.status = 'PASS';
  } catch (error) {
    receipt.failure = error.message;
    throw error;
  } finally {
    // Preserve native receipts/logs before removing only resources owned by this run.
    if (dockerReady) {
      for (const [name, exists] of [
        [workerName, owned.worker],
        [databaseName, owned.database],
      ]) {
        if (exists) {
          try {
            await docker(['logs', name]);
          } catch (error) {
            receipt.logFailure = error.message;
          }
        }
      }
    }
    try {
      await pool?.end();
    } catch (error) {
      receipt.status = 'FAIL';
      receipt.poolCleanupFailure = error.message;
    }
    receipt.cleanup = [];
    for (const [exists, args] of [
      [owned.worker, ['rm', '--force', '--volumes', workerName]],
      [owned.database, ['rm', '--force', '--volumes', databaseName]],
      [owned.network, ['network', 'rm', networkName]],
      [owned.image, ['image', 'rm', imageTag]],
    ]) {
      if (exists) {
        try {
          await docker(args);
          receipt.cleanup.push({ args, status: 'PASS' });
        } catch (error) {
          receipt.status = 'FAIL';
          receipt.cleanup.push({ args, status: 'FAIL', error: error.message });
        }
      }
    }
    if (context) {
      try {
        await rm(context, { recursive: true, force: true });
      } catch (error) {
        receipt.status = 'FAIL';
        receipt.contextCleanupFailure = error.message;
      }
    }
    await writeFile(join(evidence, 'receipt.json'), JSON.stringify(receipt, null, 2));
    assert.ok(
      receipt.cleanup.every((value) => value.status === 'PASS') &&
        !receipt.poolCleanupFailure &&
        !receipt.contextCleanupFailure,
      'owned fixture cleanup must pass',
    );
  }
});
