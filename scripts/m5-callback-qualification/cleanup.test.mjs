import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { eraseAtDeadline } from './cleanup.mjs';
import { createExperiment } from './operator.mjs';

const binding = {
  experiment: 'cleanup-fixture',
  era: 'B',
  appId: 'gid://shopify/App/1',
  providerShopId: 'gid://shopify/Shop/123',
  providerShopDomain: 'fixture.myshopify.com',
  appInstallationId: 'gid://shopify/AppInstallation/456',
  capabilityLabel: 'B_PRIMARY',
};
async function setup(window = 1400) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'insignia-cleanup-'));
  await fs.chmod(root, 0o700);
  const parent = path.join(root, 'owned');
  await fs.mkdir(parent, { mode: 0o700 });
  const directory = path.join(parent, binding.experiment);
  const eraseBy = Date.now() + window;
  await createExperiment({ directory, binding, acceptUntil: eraseBy - 1000, eraseBy });
  return { root, parent, directory, eraseBy };
}
test('one exact owned experiment is erased only at its original authenticated deadline and parent survives', async () => {
  const s = await setup(5000);
  try {
    assert.deepEqual(await eraseAtDeadline({ parent: s.parent, experiment: binding.experiment }), {
      status: 'NOT_DUE',
    });
    assert.ok((await fs.stat(s.directory)).isDirectory());
    assert.deepEqual(
      await eraseAtDeadline({ parent: s.parent, experiment: binding.experiment, now: () => s.eraseBy + 1 }),
      { status: 'NOT_DUE' },
    );
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, s.eraseBy - Date.now() + 20)));
    assert.deepEqual(await eraseAtDeadline({ parent: s.parent, experiment: binding.experiment }), {
      status: 'LOCAL_FILES_REMOVED_EXTERNAL_COPIES_UNQUALIFIED',
    });
    await assert.rejects(() => fs.stat(s.directory));
    assert.equal((await fs.stat(s.parent)).mode & 0o777, 0o700);
  } finally {
    await fs.rm(s.root, { recursive: true, force: true });
  }
});

import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { constants } from 'node:fs';

test('zero exports/outside copies and exact path/symlink boundaries refuse without deleting unrelated files', async () => {
  const s = await setup();
  try {
    await new Promise((r) => setTimeout(r, Math.max(1, s.eraseBy - Date.now() + 20)));
    const external = path.join(s.parent, 'untracked-private-export');
    await fs.writeFile(external, 'SYNTHETIC_EXPORT_SENTINEL', { mode: 0o600 });
    assert.deepEqual(await eraseAtDeadline({ parent: s.parent, experiment: binding.experiment }), {
      status: 'BLOCKED',
    });
    assert.equal(await fs.readFile(external, 'utf8'), 'SYNTHETIC_EXPORT_SENTINEL');
    assert.deepEqual(await eraseAtDeadline({ parent: s.parent, experiment: binding.experiment, exports: [external] }), {
      status: 'BLOCKED',
    });
    assert.deepEqual(await eraseAtDeadline({ parent: s.parent, experiment: '../outside' }), { status: 'BLOCKED' });
    const alias = path.join(s.root, 'alias');
    await fs.symlink(s.parent, alias);
    assert.deepEqual(await eraseAtDeadline({ parent: alias, experiment: binding.experiment }), { status: 'BLOCKED' });
    assert.ok((await fs.stat(s.directory)).isDirectory());
  } finally {
    await fs.rm(s.root, { recursive: true, force: true });
  }
});

test('standalone runtime catch-up erases an expired exact experiment and emits one non-secret receipt', async () => {
  const s = await setup();
  try {
    await new Promise((r) => setTimeout(r, Math.max(1, s.eraseBy - Date.now() + 20)));
    const child = spawn(
      process.execPath,
      [new URL('./cleanup.mjs', import.meta.url).pathname, s.parent, binding.experiment],
      { env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '',
      err = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    const [code] = await once(child, 'exit');
    assert.equal(code, 0);
    assert.equal(out, '{"status":"LOCAL_FILES_REMOVED_EXTERNAL_COPIES_UNQUALIFIED"}\n');
    assert.equal(err, '');
    await assert.rejects(() => fs.stat(s.directory));
    assert.equal((await fs.stat(s.parent)).mode & 0o777, 0o700);
  } finally {
    await fs.rm(s.root, { recursive: true, force: true });
  }
});

test('blocked metadata read is bounded, returns no completion, and preserves the exact target', async () => {
  const s = await setup();
  let fd;
  try {
    await fs.unlink(path.join(s.directory, 'mapping.json'));
    assert.equal(spawnSync('/usr/bin/mkfifo', ['-m', '600', path.join(s.directory, 'mapping.json')]).status, 0);
    fd = await fs.open(path.join(s.directory, 'mapping.json'), constants.O_RDWR);
    const start = performance.now();
    assert.deepEqual(await eraseAtDeadline({ parent: s.parent, experiment: binding.experiment, deadlineMs: 300 }), {
      status: 'BLOCKED',
    });
    assert.ok(performance.now() - start < 1800);
    assert.ok((await fs.stat(s.directory)).isDirectory());
  } finally {
    await fd?.close();
    await fs.rm(s.root, { recursive: true, force: true });
  }
});

import http from 'node:http';
import { privateEnrollment, status } from './operator.mjs';

test('active and live unrelated PIDs block erasure; confirmed killed serving child keeps uncertainty until due cleanup', async () => {
  const s = await setup(3000);
  const signing = path.join(s.root, 'synthetic-signing');
  await fs.writeFile(signing, '["SYNTHETIC_SIGNING_SENTINEL"]', { mode: 0o600 });
  const fd = await fs.open(signing, 'r');
  const child = spawn(process.execPath, [new URL('./service.mjs', import.meta.url).pathname, s.directory], {
    env: { PATH: '/usr/bin:/bin' },
    stdio: ['ignore', 'pipe', 'pipe', fd.fd],
  });
  let q;
  try {
    let out = '';
    const port = await new Promise((resolve, reject) => {
      child.stdout.on('data', (c) => {
        out += c;
        if (out.includes('\n')) {
          const ready = JSON.parse(out.trim());
          if (ready.status === 'READY') resolve(ready.port);
          else reject(Error('FIXTURE_REFUSED'));
        }
      });
      child.on('exit', () => reject(Error('FIXTURE_EXIT')));
    });
    const enrollment = await privateEnrollment(s.directory);
    q = http.request({ host: '127.0.0.1', port, path: enrollment.callbackPath, method: 'POST' });
    q.on('error', () => {});
    q.flushHeaders();
    q.write('INCOMPLETE_SYNTHETIC_BODY');
    for (let i = 0; i < 100 && (await status(s.directory)).reserved === 0; i++)
      await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(await status(s.directory), { status: 'OPEN', reserved: 1, committed: 0, uncertain: 1 });
    child.kill('SIGSTOP');
    await new Promise((r) => setTimeout(r, Math.max(1, s.eraseBy - Date.now() + 20)));
    assert.deepEqual(await eraseAtDeadline({ parent: s.parent, experiment: binding.experiment }), {
      status: 'BLOCKED',
    });
    assert.ok((await fs.stat(s.directory)).isDirectory());
    const exit = once(child, 'exit');
    child.kill('SIGKILL');
    await exit;
    assert.deepEqual(await status(s.directory), {
      status: 'RETENTION_EXPIRED',
      reserved: 1,
      committed: null,
      uncertain: null,
    });
    const lockPath = path.join(s.directory, 'receiver.lock');
    const oldLock = await fs.readFile(lockPath);
    const collision = Buffer.from(JSON.stringify({ ...JSON.parse(oldLock), pid: process.pid }));
    await fs.writeFile(lockPath, collision);
    assert.deepEqual(await eraseAtDeadline({ parent: s.parent, experiment: binding.experiment }), {
      status: 'BLOCKED',
    });
    assert.deepEqual(await fs.readFile(lockPath), collision);
    await fs.writeFile(lockPath, oldLock);
    assert.deepEqual(await eraseAtDeadline({ parent: s.parent, experiment: binding.experiment }), {
      status: 'LOCAL_FILES_REMOVED_EXTERNAL_COPIES_UNQUALIFIED',
    });
    await assert.rejects(() => fs.stat(s.directory));
  } finally {
    q?.destroy();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
    await fd.close();
    await fs.rm(s.root, { recursive: true, force: true });
  }
});

test('crash inside a real lifecycle critical section leaves a stale guard that cleanup never unlinks', async () => {
  const s = await setup();
  const code = `const {withLifecycle}=await import(${JSON.stringify(new URL('./store.mjs', import.meta.url).href)});await withLifecycle(process.argv[1],async()=>{console.log('HELD');await new Promise(()=>{setInterval(()=>{},10000);});});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code, s.directory], {
    env: { PATH: '/usr/bin:/bin' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once('data', (c) => (c.toString() === 'HELD\n' ? resolve() : reject(Error('GUARD_OUTPUT'))));
      child.once('exit', () => reject(Error('GUARD_EXIT')));
    });
    const exit = once(child, 'exit');
    child.kill('SIGKILL');
    await exit;
    const before = await fs.readdir(s.parent);
    assert.equal(before.filter((name) => name.startsWith('.callback-lifecycle-')).length, 1);
    await new Promise((r) => setTimeout(r, Math.max(1, s.eraseBy - Date.now() + 20)));
    assert.deepEqual(await eraseAtDeadline({ parent: s.parent, experiment: binding.experiment }), {
      status: 'BLOCKED',
    });
    assert.deepEqual(await fs.readdir(s.parent), before);
    assert.ok((await fs.stat(s.directory)).isDirectory());
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
    await fs.rm(s.root, { recursive: true, force: true });
  }
});
