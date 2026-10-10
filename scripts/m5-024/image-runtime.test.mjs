import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { exportWorkerImage } from './image-artifact.mjs';
import {
  assembleDatabaseFixtureProbe,
  assembleImageInventoryProbe,
  finalizeImageFixture,
  qualifyFixtureDatabase,
  qualifyImageConfiguration,
  qualifyImageRuntime,
  runImageCommand,
} from './image-observations.mjs';

const root = resolve(import.meta.dirname, '../..');
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
}, async (t) => {
  // Reserve 120 seconds: 2 logs * (5s command + 5s write), 4 removals *
  // (10s command + 5s write), 15s context cleanup and 5s receipt = 100s,
  // leaving 20s for child shutdown and scheduling inside the 420s test deadline.
  const signal = AbortSignal.any([t.signal, AbortSignal.timeout(300_000)]);
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
      'Local image ID is recorded; no registry image is pushed and no registry digest is claimed. An exported image-tar hash is recorded only when CI artifact export is configured and succeeds.',
    ],
  };
  const prefix = `insignia-m5-image-${randomUUID().replaceAll('-', '')}`;
  const networkName = `${prefix}-net`;
  const databaseName = `${prefix}-db`;
  const workerName = `${prefix}-worker`;
  const imageTag = `${prefix}:qualification`;
  let commandNumber = 0;
  let context;
  let dockerReady = false;
  const owned = { network: false, database: false, worker: false, image: false };

  async function run(
    command,
    args,
    { input, env = process.env, timeout = 60_000, signal: commandSignal = signal } = {},
  ) {
    const log = join(evidence, `${String(++commandNumber).padStart(3, '0')}.log`);
    const result = await runImageCommand(command, args, { input, cwd: root, env, timeout, signal: commandSignal });
    await writeFile(
      log,
      `${JSON.stringify({ command, args, code: result.code, signal: result.signal, aborted: result.aborted, timedOut: result.timedOut })}\n${result.stdout}\n${result.stderr}`,
      { signal: AbortSignal.timeout(5000) },
    );
    commandSignal.throwIfAborted();
    assert.equal(result.timedOut, false, `command deadline exceeded; raw log ${log}`);
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
      await delay(500, undefined, { signal });
    }
    throw new Error(`${name} did not become healthy within 45 seconds`);
  }
  try {
    await docker(['version']);
    dockerReady = true;
    receipt.status = 'FAIL';
    assert.equal(process.version, 'v24.21.0');
    assert.equal(process.platform, 'linux', 'native host-to-owned bridge routing qualification is Linux only');
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
    const networkId = await docker(['network', 'create', '--internal', networkName]);
    let network = JSON.parse(await docker(['network', 'inspect', networkName]))[0];
    owned.database = true;
    const databaseContainerId = await docker([
      'create',
      '--name',
      databaseName,
      '--network',
      networkName,
      '--network-alias',
      'fixture-db',
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
    network = JSON.parse(await docker(['network', 'inspect', networkName]))[0];
    const ownerUrl = qualifyFixtureDatabase({
      container: database,
      network,
      expectedContainerId: databaseContainerId,
      expectedName: databaseName,
      expectedNetworkId: networkId,
      expectedNetworkName: networkName,
    });
    receipt.databaseEndpoint = { containerId: databaseContainerId, networkId, ownerUrl };
    await writeFile(join(evidence, 'database-endpoint-observations.json'), JSON.stringify({ database, network }), {
      signal,
    });
    await run(
      join(root, 'node_modules/.bin/dbmate'),
      ['--no-dump-schema', '--migrations-dir', join(root, 'packages/database/migrations'), 'up'],
      {
        env: { PATH: process.env.PATH, DATABASE_URL: ownerUrl },
      },
    );
    const ownerEnvironment = {
      PATH: process.env.PATH,
      DATABASE_URL: ownerUrl,
      INSIGNIA_QUEUE_OWNER_INSTALL: 'explicit-reviewed-owner-operation',
    };
    receipt.queueInstall = JSON.parse(
      await run(process.execPath, [join(root, 'scripts/m5-024/install-queue.mjs')], {
        env: ownerEnvironment,
        timeout: 45_000,
      }),
    );
    receipt.database = JSON.parse(
      await run(process.execPath, ['--input-type=module'], {
        input: assembleDatabaseFixtureProbe(),
        env: ownerEnvironment,
        timeout: 45_000,
      }),
    );
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
          input: assembleImageInventoryProbe(inventorySource),
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
    if (process.env.M5_IMAGE_ARTIFACT_DIR) {
      assert.equal(process.env.CI, 'true', 'worker image artifact export is CI only');
      receipt.artifact = await exportWorkerImage({
        directory: resolve(process.env.M5_IMAGE_ARTIFACT_DIR),
        sourceHead: receipt.sourceHead,
        sourceTree: receipt.sourceTree,
        imageId,
        run: docker,
        signal,
      });
    }
    receipt.status = 'PASS';
  } catch (error) {
    receipt.failure = error.message;
    throw error;
  } finally {
    // Every log and removal has its own deadline; an aborted body must still
    // preserve logs and launch every owned removal. Any failure is fatal.
    const finalized = await finalizeImageFixture({
      containerNames: dockerReady
        ? [
            [workerName, owned.worker],
            [databaseName, owned.database],
          ]
            .filter(([, exists]) => exists)
            .map(([name]) => name)
        : [],
      cleanupCommands: [
        [owned.worker, ['rm', '--force', '--volumes', workerName]],
        [owned.database, ['rm', '--force', '--volumes', databaseName]],
        [owned.network, ['network', 'rm', networkName]],
        [owned.image, ['image', 'rm', imageTag]],
      ]
        .filter(([exists]) => exists)
        .map(([, args]) => args),
      run: docker,
    });
    receipt.logs = finalized.logs;
    receipt.cleanup = finalized.cleanup;
    if (finalized.status !== 'PASS') receipt.status = 'FAIL';
    if (context) {
      try {
        await run(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            "import { rm } from 'node:fs/promises'; await rm(process.argv[1], { recursive: true, force: true });",
            context,
          ],
          { timeout: 10_000, signal: AbortSignal.timeout(15_000) },
        );
      } catch (error) {
        receipt.status = 'FAIL';
        receipt.contextCleanupFailure = error.message;
      }
    }
    await writeFile(join(evidence, 'receipt.json'), JSON.stringify(receipt, null, 2), {
      signal: AbortSignal.timeout(5000),
    });
    assert.ok(
      finalized.status === 'PASS' && !receipt.contextCleanupFailure,
      'fixture logs and owned cleanup must pass',
    );
  }
});
