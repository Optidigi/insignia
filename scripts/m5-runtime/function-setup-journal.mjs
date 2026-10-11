/** Private operator admission. A reserved run is never resumed or replaced after a crash. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const operations = new Set([
  'READ_PRESTATE',
  'CREATE_TRANSFORM',
  'READ_TRANSFORM',
  'CREATE_VALIDATION',
  'READ_FINAL',
  'ActiveAppReleaseFromApiKey',
  'AppVersions',
  'AppVersions_CLOSE',
  'AppVersionByTag',
  'AUTH_ONLINE',
  ...Array.from({ length: 6 }, (_, i) => `INSTALLATION_HTTP_${i + 1}`),
]);
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function durable(directory, name, value) {
  const fd = openSync(join(directory, name), 'wx', 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const parent = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
}
export function reserveFunctionSetupRun(directory, binding) {
  assert.ok(isAbsolute(directory) && resolve(directory) === directory, 'private_directory_required');
  const parent = dirname(directory),
    stat = lstatSync(parent);
  assert.ok(
    stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0,
    'private_directory_required',
  );
  assert.equal(realpathSync(parent), parent, 'private_directory_required');
  assert.deepEqual(Object.keys(binding).sort(), [
    'appVersionRef',
    'externalInstallationId',
    'installationGeneration',
    'shopId',
    'sourceCommit',
  ]);
  for (const value of Object.values(binding))
    assert.ok(typeof value === 'string' && /^[A-Za-z0-9:/._-]{1,256}$/.test(value));
  assert.match(binding.sourceCommit, /^[a-f0-9]{40}$/);
  assert.match(binding.appVersionRef, /^[1-9][0-9]*$/);
  assert.match(binding.installationGeneration, /^[1-9][0-9]*$/);
  assert.match(binding.externalInstallationId, /^gid:\/\/shopify\/AppInstallation\/[1-9][0-9]*$/);
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('function_setup_run_exists');
    throw new Error('function_setup_reservation_failed');
  }
  const parentFd = openSync(parent, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    fsyncSync(parentFd);
  } finally {
    closeSync(parentFd);
  }
  const bindingSha256 = hash(binding);
  durable(directory, '000-reservation.json', {
    version: 'm5-function-setup-run-v1',
    binding,
    bindingSha256,
    attempt: 1,
  });
  const reserved = new Set(),
    settled = new Set(),
    dispatched = new Set();
  let closed = false;
  return Object.freeze({
    bindingSha256,
    reserve(operation) {
      assert.ok(!closed && operations.has(operation) && !reserved.has(operation), 'function_setup_admission_denied');
      reserved.add(operation);
      durable(directory, `${operation}-reserved.json`, { operation, bindingSha256, attempt: 1 });
      return true;
    },
    dispatch(operation) {
      assert.ok(
        !closed && reserved.has(operation) && !settled.has(operation) && !dispatched.has(operation),
        'function_setup_dispatch_denied',
      );
      dispatched.add(operation);
      durable(directory, `${operation}-dispatched.json`, { operation, bindingSha256, attempt: 1 });
    },
    settle(operation, outcome, id = null) {
      assert.ok(!closed && dispatched.has(operation) && !settled.has(operation) && ['ACK', 'STOP'].includes(outcome));
      assert.ok(id === null || /^gid:\/\/shopify\/(CartTransform|Validation)\/[1-9][0-9]*$/.test(id));
      settled.add(operation);
      durable(directory, `${operation}-settled.json`, { operation, outcome, id, retryAuthorized: false });
    },
    finish(classification) {
      assert.ok(!closed && ['FUNCTIONS_VERIFIED', 'FUNCTION_SETUP_STOPPED'].includes(classification));
      closed = true;
      durable(directory, 'result.json', { classification, bindingSha256, retryAuthorized: false });
    },
  });
}
