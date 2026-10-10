import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { runImageCommand } from '../m5-024/image-observations.mjs';
import { ownedWebAddress } from './web-address.mjs';

const root = resolve(import.meta.dirname, '../..');

test('actual disposable web image serves HTTP, stops, restarts and exports exact qualified bytes', {
  timeout: 360_000,
}, async (t) => {
  assert.equal(process.env.CI, 'true', 'Actual image control is CI only');
  assert.ok(process.env.M5_WEB_PACKAGE, 'M5_WEB_PACKAGE required');
  assert.ok(process.env.M5_WEB_IMAGE_EVIDENCE_DIR, 'M5_WEB_IMAGE_EVIDENCE_DIR required');
  const evidence = resolve(process.env.M5_WEB_IMAGE_EVIDENCE_DIR);
  await mkdir(evidence);
  const signal = AbortSignal.any([t.signal, AbortSignal.timeout(280_000)]);
  const prefix = `insignia-web-${randomUUID().replaceAll('-', '')}`;
  const imageTag = `${prefix}:qualification`;
  const network = `${prefix}-network`;
  const container = `${prefix}-web`;
  const context = await mkdtemp(join(tmpdir(), prefix));
  const receipt = {
    status: 'FAIL',
    controls: [],
    limitations: ['Disposable CI image only; no database, provider, production deployment or registry push.'],
  };
  let commandNumber = 0;
  const cleanup = [];
  const artifact = join(evidence, 'web-image.tar');
  async function run(command, args, { timeout = 60_000, cleanupCommand = false } = {}) {
    const commandSignal = cleanupCommand ? AbortSignal.timeout(timeout + 2000) : signal;
    const result = await runImageCommand(command, args, { cwd: root, timeout, signal: commandSignal });
    await writeFile(
      join(evidence, `${String(++commandNumber).padStart(3, '0')}.log`),
      `${JSON.stringify({ command, args, code: result.code, timedOut: result.timedOut, aborted: result.aborted })}\n${result.stdout}\n${result.stderr}`,
      { signal: AbortSignal.timeout(5000) },
    );
    assert.equal(result.timedOut, false, `${command} exceeded deadline`);
    assert.equal(result.code, 0, `${command} ${args[0]} failed: ${result.stderr}`);
    return result.stdout.trim();
  }
  const docker = (args, options) => run('docker', args, options);
  const inspect = async () => JSON.parse(await docker(['inspect', container]))[0];
  async function healthy() {
    for (let attempt = 0; attempt < 90; attempt++) {
      const value = await inspect();
      assert.equal(value.State.Running, true, 'Web stopped before health');
      if (value.State.Health.Status === 'healthy') return value;
      await delay(500, undefined, { signal });
    }
    throw new Error('Web health deadline exceeded');
  }
  let success = false;
  try {
    await docker(['version']);
    receipt.sourceHead = await run('git', ['rev-parse', 'HEAD']);
    receipt.sourceTree = await run('git', ['rev-parse', 'HEAD^{tree}']);
    receipt.dockerfileSha256 = createHash('sha256')
      .update(await readFile(join(root, 'scripts/m5-runtime/Dockerfile.web')))
      .digest('hex');
    await cp(resolve(process.env.M5_WEB_PACKAGE), join(context, 'web-package'), {
      recursive: true,
      verbatimSymlinks: true,
    });
    await cp(join(root, 'scripts/m5-runtime/Dockerfile.web'), join(context, 'Dockerfile'));
    cleanup.push(['image', 'rm', '--force', imageTag]);
    await docker(['build', '--network=none', '--tag', imageTag, context], { timeout: 180_000 });
    const image = JSON.parse(await docker(['image', 'inspect', imageTag]))[0];
    receipt.imageId = image.Id;
    assert.equal(image.Config.User, 'node');
    assert.deepEqual(image.Config.Cmd, ['/usr/local/bin/node', '/srv/insignia/web/dist/server/entry.mjs']);
    assert.ok(!image.Config.Entrypoint || image.Config.Entrypoint.length === 0);
    cleanup.push(['network', 'rm', network]);
    await docker(['network', 'create', '--internal', network]);
    cleanup.push(['container', 'rm', '--force', container]);
    await docker([
      'run',
      '--detach',
      '--name',
      container,
      '--network',
      network,
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--health-cmd',
      '/usr/local/bin/node -e "fetch(\'http://127.0.0.1:3000/live\').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"',
      '--health-interval',
      '1s',
      '--health-timeout',
      '3s',
      '--health-retries',
      '15',
      imageTag,
    ]);
    const running = await healthy();
    assert.equal(running.HostConfig.ReadonlyRootfs, true);
    assert.deepEqual(running.HostConfig.CapDrop, ['ALL']);
    assert.equal(running.Config.User, 'node');
    const address = ownedWebAddress(running.NetworkSettings, network);
    const response = await fetch(address, { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'live' });
    await docker(['stop', '--time', '10', container]);
    const stopped = await inspect();
    assert.equal(stopped.State.Running, false);
    assert.equal(stopped.State.OOMKilled, false);
    assert.ok([0, 143].includes(stopped.State.ExitCode), 'Web must stop without forced SIGKILL');
    await assert.rejects(fetch(address, { signal: AbortSignal.timeout(1000) }));
    await docker(['start', container]);
    await healthy();
    const restarted = await fetch(address, { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
    assert.equal(restarted.status, 200);
    assert.deepEqual(await restarted.json(), { status: 'live' });
    receipt.controls = [
      'pinned-image-build',
      'nonprivileged-direct-node',
      'readonly-dropcaps',
      'owned-internal-ipv4-http-no-published-ports',
      'sigterm-stop',
      'restart-http',
    ];
    await docker(['image', 'save', '--output', artifact, image.Id]);
    const hash = createHash('sha256');
    let sizeBytes = 0;
    for await (const bytes of createReadStream(artifact, { signal })) {
      hash.update(bytes);
      sizeBytes += bytes.length;
    }
    receipt.artifact = { file: 'web-image.tar', sha256: hash.digest('hex'), sizeBytes };
    success = true;
  } finally {
    const failures = [];
    for (const args of cleanup.reverse()) {
      try {
        await docker(args, { timeout: 10_000, cleanupCommand: true });
      } catch (error) {
        failures.push(error.message);
      }
    }
    try {
      await rm(context, { recursive: true, force: true });
    } catch (error) {
      failures.push(error.message);
    }
    receipt.cleanup = { passed: failures.length === 0, failures };
    receipt.status = success && failures.length === 0 ? 'PASS' : 'FAIL';
    if (receipt.status !== 'PASS') await rm(artifact, { force: true });
    await writeFile(join(evidence, 'receipt.json'), JSON.stringify(receipt, null, 2), {
      signal: AbortSignal.timeout(5000),
    });
    assert.deepEqual(failures, [], 'Owned web image/container/network cleanup failed');
  }
});
