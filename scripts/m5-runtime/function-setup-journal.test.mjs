import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { reserveFunctionSetupRun } from './function-setup-journal.mjs';

const binding = {
  shopId: 'synthetic-tenant',
  installationGeneration: '3',
  externalInstallationId: 'gid://shopify/AppInstallation/101',
  appVersionRef: '101',
  sourceCommit: 'a'.repeat(40),
};
test('admission and exact acknowledgement are private, durable and single-use', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'insignia-function-'));
  const directory = join(parent, 'run');
  try {
    const journal = reserveFunctionSetupRun(directory, binding);
    assert.equal(journal.reserve('CREATE_TRANSFORM'), true);
    journal.dispatch('CREATE_TRANSFORM');
    journal.settle('CREATE_TRANSFORM', 'ACK', 'gid://shopify/CartTransform/101');
    assert.equal(
      JSON.parse(await readFile(join(directory, 'CREATE_TRANSFORM-settled.json'))).id,
      'gid://shopify/CartTransform/101',
    );
    assert.throws(() => journal.reserve('CREATE_TRANSFORM'), /admission_denied/);
    journal.finish('FUNCTION_SETUP_STOPPED');
    assert.throws(() => journal.reserve('CREATE_VALIDATION'), /admission_denied/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
test('a killed operator leaves durable admission that a fresh process cannot repeat', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'insignia-function-'));
  const directory = join(parent, 'run');
  try {
    const script = `import {reserveFunctionSetupRun} from ${JSON.stringify(new URL('./function-setup-journal.mjs', import.meta.url).href)};
      const journal = reserveFunctionSetupRun(process.argv[1], JSON.parse(process.argv[2]));
      journal.reserve('CREATE_TRANSFORM'); process.kill(process.pid, 'SIGKILL');`;
    const child = spawnSync(process.execPath, [
      '--input-type=module',
      '-e',
      script,
      directory,
      JSON.stringify(binding),
    ]);
    assert.equal(child.signal, 'SIGKILL');
    assert.equal(JSON.parse(await readFile(join(directory, 'CREATE_TRANSFORM-reserved.json'))).attempt, 1);
    const restart = spawnSync(process.execPath, [
      '--input-type=module',
      '-e',
      script,
      directory,
      JSON.stringify(binding),
    ]);
    assert.notEqual(restart.status, 0);
    assert.match(String(restart.stderr), /function_setup_run_exists/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
