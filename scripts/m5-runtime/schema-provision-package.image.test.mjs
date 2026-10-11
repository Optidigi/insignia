import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { packageSchemaProvision } from './schema-provision-package.mjs';

const exec = promisify(execFile);

test('frozen owner package resolves accepted installer from qualified worker image without startup/network or private mounts', {
  timeout: 130000,
}, async () => {
  assert.ok(process.env.M5_IMAGE_ARTIFACT_DIR, 'qualified image artifact is mandatory');
  const artifact = process.env.M5_IMAGE_ARTIFACT_DIR;
  const receipt = JSON.parse(await readFile(join(artifact, 'receipt.json'), 'utf8'));
  assert.match(receipt.imageId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(receipt.file, 'worker-image.tar');
  const archive = join(artifact, receipt.file);
  assert.equal((await stat(archive)).size, receipt.sizeBytes);
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(archive)) hash.update(bytes);
  assert.equal(hash.digest('hex'), receipt.sha256);
  const parent = await mkdtemp(join(tmpdir(), 'insignia-schema-image-'));
  const directory = join(parent, 'operator');
  const container = `insignia-schema-owner-${randomUUID()}`;
  let dispatchReserved = false;
  let imageAbsentBeforeLoad = false;
  let loadReserved = false;
  let primaryFailure;
  const cleanupFailures = [];
  const inspectImage = async () => {
    try {
      const { stdout } = await exec('docker', ['image', 'inspect', '--format', '{{.Id}}', receipt.imageId], {
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      });
      assert.equal(stdout.trim(), receipt.imageId, 'actual native image identity must equal qualified export');
      return true;
    } catch (error) {
      // Only the native exact-ID absence response permits importing an owned image.
      // Daemon/access/timeout errors never establish absence.
      if (error.code === 1 && error.stderr?.includes(`No such image: ${receipt.imageId}`)) return false;
      throw error;
    }
  };
  try {
    await packageSchemaProvision({ directory, workerPackageEntry: process.env.M5_WORKER_PACKAGE_ENTRY });
    imageAbsentBeforeLoad = !(await inspectImage());
    if (imageAbsentBeforeLoad) {
      loadReserved = true;
      await exec('docker', ['image', 'load', '--input', archive], { timeout: 60000, maxBuffer: 1024 * 1024 });
    }
    assert.equal(await inspectImage(), true, 'qualified native image must exist before dispatch');
    const command =
      "const [operator,queue]=await Promise.all([import('/operator/scripts/m5-runtime/schema-provision.mjs'),import('/operator/scripts/m5-024/install-queue.mjs')]); console.log(JSON.stringify({reserve:typeof operator.reserveSchemaProvision,execute:typeof operator.executeSchemaProvision,installQueue:typeof queue.installQueue}));";
    dispatchReserved = true;
    const { stdout } = await exec(
      'docker',
      [
        'run',
        '--rm',
        '--name',
        container,
        '--init',
        '--network',
        'none',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--mount',
        `type=bind,src=${directory},dst=/operator,readonly`,
        receipt.imageId,
        '/usr/local/bin/node',
        '--input-type=module',
        '-e',
        command,
      ],
      { timeout: 15000, maxBuffer: 1024 * 1024 },
    );
    assert.deepEqual(JSON.parse(stdout), { reserve: 'function', execute: 'function', installQueue: 'function' });
  } catch (error) {
    primaryFailure = error;
  } finally {
    if (dispatchReserved) {
      try {
        await exec('docker', ['container', 'rm', '--force', container], { timeout: 5000, maxBuffer: 1024 * 1024 });
      } catch (error) {
        if (!(error.code === 1 && error.stderr?.includes(`No such container: ${container}`)))
          cleanupFailures.push(error);
      }
    }
    if (imageAbsentBeforeLoad && loadReserved) {
      // An acknowledged import or a timed-out load may have created this exact
      // image. Check it again; never remove an image that existed before this run.
      try {
        if (await inspectImage())
          await exec('docker', ['image', 'rm', receipt.imageId], { timeout: 10000, maxBuffer: 1024 * 1024 });
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    const unseal = async (path) => {
      await chmod(path, 0o755);
      for (const entry of await readdir(path, { withFileTypes: true }))
        if (entry.isDirectory()) await unseal(join(path, entry.name));
    };
    try {
      await unseal(parent);
      await rm(parent, { recursive: true, force: true });
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (primaryFailure) {
    if (cleanupFailures.length)
      throw new AggregateError([primaryFailure, ...cleanupFailures], 'owner image control and cleanup failed', {
        cause: primaryFailure,
      });
    throw primaryFailure;
  }
  if (cleanupFailures.length) throw new AggregateError(cleanupFailures, 'owned owner image cleanup failed');
});
