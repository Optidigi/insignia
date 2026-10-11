import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { packageDatabasePasswordRotation } from './db-password-rotation-package.mjs';
import { frozenSchema18Fixture } from './frozen-schema18-fixture.mjs';
import { qualifyImageArchive, verifyNativeImageIdentity } from './image-identity.mjs';
import { packageForwardSchema19 } from './schema-forward19-package.mjs';

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
  const qualified = await qualifyImageArchive({ archive, receipt });
  const frozen = await frozenSchema18Fixture();
  const { packageSchemaProvision } = await import(
    pathToFileURL(join(frozen.directory, 'scripts/m5-runtime/schema-provision-package.mjs')).href
  );
  const parent = await mkdtemp(join(tmpdir(), 'insignia-schema-image-'));
  const directory = join(parent, 'operator');
  const forwardDirectory = join(parent, 'forward19');
  const rotationDirectory = join(parent, 'rotation');
  const container = `insignia-schema-owner-${randomUUID()}`;
  let dispatchReserved = false;
  let imageAbsentBeforeLoad = false;
  let loadReserved = false;
  let primaryFailure;
  const cleanupFailures = [];
  let nativeId;
  const inspectImage = async () => {
    let found;
    for (const id of new Set([qualified.configId, qualified.manifestId])) {
      try {
        const { stdout } = await exec('docker', ['image', 'inspect', id], { timeout: 5000, maxBuffer: 1024 * 1024 });
        const images = JSON.parse(stdout);
        assert.equal(images.length, 1);
        const verified = verifyNativeImageIdentity({ qualified, image: images[0] });
        if (found) assert.equal(verified.nativeId, found);
        found = verified.nativeId;
      } catch (error) {
        if (!(error.code === 1 && error.stderr?.includes(`No such image: ${id}`))) throw error;
      }
    }
    if (found) nativeId = found;
    return Boolean(found);
  };
  try {
    await packageSchemaProvision({ directory, workerPackageEntry: process.env.M5_WORKER_PACKAGE_ENTRY });
    await packageForwardSchema19({ directory: forwardDirectory });
    await packageDatabasePasswordRotation(rotationDirectory);
    imageAbsentBeforeLoad = !(await inspectImage());
    if (imageAbsentBeforeLoad) {
      loadReserved = true;
      await exec('docker', ['image', 'load', '--input', archive], { timeout: 60000, maxBuffer: 1024 * 1024 });
    }
    assert.equal(await inspectImage(), true, 'qualified native image must exist before dispatch');
    const command =
      "const [operator,queue]=await Promise.all([import('/operator/scripts/m5-runtime/schema-provision.mjs'),import('/operator/scripts/m5-024/install-queue.mjs')]); const forward=await import('/forward19/scripts/m5-runtime/schema-forward19.mjs'); const rotation=await import('/rotation/scripts/m5-runtime/db-password-rotation.mjs'); console.log(JSON.stringify({rotationReserve:typeof rotation.reserveDatabasePasswordRotation,rotationExecute:typeof rotation.executeDatabasePasswordRotation,reserve:typeof operator.reserveSchemaProvision,execute:typeof operator.executeSchemaProvision,installQueue:typeof queue.installQueue,forwardReserve:typeof forward.reserveForwardSchema19,forwardExecute:typeof forward.executeForwardSchema19}));";
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
        '--mount',
        `type=bind,src=${forwardDirectory},dst=/forward19,readonly`,
        '--mount',
        `type=bind,src=${rotationDirectory},dst=/rotation,readonly`,
        nativeId,
        '/usr/local/bin/node',
        '--input-type=module',
        '-e',
        command,
      ],
      { timeout: 15000, maxBuffer: 1024 * 1024 },
    );
    assert.deepEqual(JSON.parse(stdout), {
      reserve: 'function',
      execute: 'function',
      installQueue: 'function',
      forwardReserve: 'function',
      forwardExecute: 'function',
      rotationReserve: 'function',
      rotationExecute: 'function',
    });
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
          await exec('docker', ['image', 'rm', nativeId], { timeout: 10000, maxBuffer: 1024 * 1024 });
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
      await rm(frozen.directory, { recursive: true, force: true });
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
