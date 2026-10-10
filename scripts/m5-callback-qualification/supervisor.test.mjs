import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createExperiment } from './operator.mjs';
import { startSupervisor } from './supervisor.mjs';

const binding = {
  experiment: 'supervisor-fixture',
  era: 'B',
  appId: 'gid://shopify/App/1',
  providerShopId: 'gid://shopify/Shop/123',
  providerShopDomain: 'fixture.myshopify.com',
  appInstallationId: 'gid://shopify/AppInstallation/456',
  capabilityLabel: 'B_PRIMARY',
};
async function setup(window = 60000) {
  const parent = await fs.mkdtemp(path.join(tmpdir(), 'insignia-lifecycle-'));
  await fs.chmod(parent, 0o700);
  const directory = path.join(parent, binding.experiment);
  await createExperiment({
    directory,
    binding,
    acceptUntil: Date.now() + window,
    eraseBy: Date.now() + window + 60000,
  });
  const signing = path.join(parent, 'synthetic-signing');
  await fs.writeFile(signing, JSON.stringify(['SYNTHETIC_SIGNING_SENTINEL']), { mode: 0o600 });
  const fd = await fs.open(signing, 'r');
  return { parent, directory, fd };
}
function request(port) {
  return new Promise((resolve, reject) => {
    const q = http.get({ host: '127.0.0.1', port, path: '/private-status' }, (r) => {
      r.resume();
      r.on('end', () => resolve(r.statusCode));
    });
    q.on('error', reject);
  });
}
test('supervisor inherits private FD3, accepts exact service READY and confirms listening is stopped', async () => {
  const s = await setup();
  let running;
  try {
    running = await startSupervisor({ directory: s.directory, signingFd: s.fd.fd });
    assert.equal(running.status, 'READY');
    assert.equal(await request(running.port), 404);
    assert.deepEqual(await running.stop(), { status: 'STOPPED' });
    await assert.rejects(() => request(running.port));
  } finally {
    if (running?.stop) await running.stop();
    await s.fd.close();
    await fs.rm(s.parent, { recursive: true, force: true });
  }
});

import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { constants } from 'node:fs';
import { observeReadyProtocol } from './supervisor.mjs';

test('hung FD3 EOF is bounded and fixed refusal preserves original evidence without a receiver listener', async () => {
  const s = await setup();
  const fifo = path.join(s.parent, 'synthetic-fifo');
  let fd;
  try {
    assert.equal(spawnSync('/usr/bin/mkfifo', [fifo]).status, 0);
    fd = await fs.open(fifo, constants.O_RDWR);
    const start = performance.now();
    assert.deepEqual(await startSupervisor({ directory: s.directory, signingFd: fd.fd, deadlineMs: 300 }), {
      status: 'REFUSED',
    });
    assert.ok(performance.now() - start < 1800);
    assert.deepEqual(await (await import('./operator.mjs')).status(s.directory), {
      status: 'OPEN',
      reserved: 0,
      committed: 0,
      uncertain: 0,
    });
    await assert.rejects(() => fs.stat(path.join(s.directory, 'receiver.lock')));
  } finally {
    await fd?.close();
    await s.fd.close();
    await fs.rm(s.parent, { recursive: true, force: true });
  }
});
test('real child output is a closed bounded READY protocol; raw reflection, stderr, duplicate keys and extra fields refuse', async () => {
  for (const code of [
    'process.stdout.write(\'{"status":"READY","port":1234,"secret":"OUTPUT_SECRET_SENTINEL"}\\n\')',
    'process.stdout.write(\'{"status":"READY","status":"READY","port":1234}\\n\')',
    "process.stdout.write('OUTPUT_SECRET_SENTINEL'.repeat(100))",
    'process.stderr.write(\'STDERR_SECRET_SENTINEL\');process.stdout.write(\'{"status":"READY","port":1234}\\n\')',
    'process.stdout.write(\'{"status":"REFUSED"}\\n\')',
    'process.stdout.end();setTimeout(()=>{},50)',
  ]) {
    const child = spawn(process.execPath, ['-e', code], {
      env: { PATH: '/usr/bin:/bin' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const protocol = observeReadyProtocol(child.stdout, child.stderr, { port: 1234, deadlineMs: 500 });
    try {
      assert.deepEqual(await protocol.ready, { status: 'REFUSED' });
    } finally {
      protocol.close();
      if (child.exitCode === null) child.kill('SIGKILL');
      await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', resolve)));
    }
  }
});
test('standalone supervisor exits promptly after TERM; an idle metadata timer cannot keep it alive', async () => {
  const s = await setup();
  const child = spawn(process.execPath, [new URL('./supervisor.mjs', import.meta.url).pathname, s.directory], {
    env: { PATH: '/usr/bin:/bin' },
    stdio: ['ignore', 'pipe', 'pipe', s.fd.fd],
  });
  let out = '',
    err = '';
  child.stderr.on('data', (c) => (err += c));
  let port;
  try {
    port = await new Promise((resolve, reject) => {
      child.stdout.on('data', (c) => {
        out += c;
        if (out.includes('\n')) resolve(JSON.parse(out.trim()).port);
      });
      child.on('exit', () => reject(Error('SUPERVISOR_EARLY_EXIT')));
    });
    assert.equal(await request(port), 404);
    const start = performance.now();
    const exit = once(child, 'exit');
    child.kill('SIGTERM');
    await exit;
    assert.ok(performance.now() - start < 2000, 'supervisor stayed alive after confirmed stop');
    assert.equal(err, '');
    assert.equal(out.includes('SENTINEL'), false);
    await assert.rejects(() => request(port));
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    await s.fd.close();
    await fs.rm(s.parent, { recursive: true, force: true });
  }
});
test('strict output bound counts actual UTF8 bytes before newline, with no reflection', async () => {
  const child = spawn(
    process.execPath,
    [
      '-e',
      "process.stdout.write('é'.repeat(40));setTimeout(()=>process.stdout.write('é'.repeat(40)),30);setTimeout(()=>{},1500)",
    ],
    { env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const protocol = observeReadyProtocol(child.stdout, child.stderr, { deadlineMs: 500 });
  const start = performance.now();
  try {
    assert.deepEqual(await protocol.violation, { status: 'REFUSED' });
    assert.ok(performance.now() - start < 250, 'oversized bytes were held until timeout');
  } finally {
    protocol.close();
    child.kill('SIGKILL');
    await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', resolve)));
  }
});
test('TERM during hung startup terminates the already owned child group before supervisor exits', async () => {
  const s = await setup();
  const fifo = path.join(s.parent, 'early-term-fifo');
  assert.equal(spawnSync('/usr/bin/mkfifo', [fifo]).status, 0);
  const fd = await fs.open(fifo, constants.O_RDWR);
  const child = spawn(process.execPath, [new URL('./supervisor.mjs', import.meta.url).pathname, s.directory], {
    env: { PATH: '/usr/bin:/bin' },
    stdio: ['ignore', 'pipe', 'pipe', fd.fd],
  });
  let descendant;
  try {
    for (let i = 0; i < 100; i++) {
      const children = (await fs.readFile(`/proc/${child.pid}/task/${child.pid}/children`, 'utf8')).trim();
      if (children) {
        descendant = Number(children.split(/\s+/)[0]);
        await new Promise((r) => setTimeout(r, 200));
        const later = (await fs.readFile(`/proc/${child.pid}/task/${child.pid}/children`, 'utf8')).trim();
        if (later) {
          descendant = Number(later.split(/\s+/)[0]);
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.ok(descendant);
    const exit = once(child, 'exit');
    child.kill('SIGTERM');
    await exit;
    await new Promise((r) => setTimeout(r, 100));
    assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' });
  } finally {
    if (descendant)
      try {
        process.kill(-descendant, 'SIGKILL');
      } catch {}
    if (child.exitCode === null) child.kill('SIGKILL');
    await fd.close();
    await s.fd.close();
    await fs.rm(s.parent, { recursive: true, force: true });
  }
});

import net from 'node:net';

test('owned process stop bounds an unfinished HTTP header and confirms the listener is gone', async () => {
  const s = await setup();
  let running, socket;
  try {
    running = await startSupervisor({ directory: s.directory, signingFd: s.fd.fd });
    assert.equal(running.status, 'READY');
    socket = net.createConnection({ host: '127.0.0.1', port: running.port });
    socket.on('error', () => {});
    await once(socket, 'connect');
    socket.write('POST /private-status HTTP/1.1\r\nHost: localhost\r\n');
    const closed = once(socket, 'close');
    const start = performance.now();
    assert.deepEqual(await running.stop(), { status: 'STOPPED' });
    assert.ok(performance.now() - start < 2200);
    await closed;
    await assert.rejects(() => request(running.port));
  } finally {
    socket?.destroy();
    await running?.stop?.();
    await s.fd.close();
    await fs.rm(s.parent, { recursive: true, force: true });
  }
});
test('authenticated original acceptance expiry stops the listening child without restart or restamping', async () => {
  const s = await setup(1000);
  let running;
  try {
    running = await startSupervisor({ directory: s.directory, signingFd: s.fd.fd });
    assert.equal(running.status, 'READY');
    const done = await running.done;
    assert.ok(['EXPIRED', 'REFUSED'].includes(done.status));
    await assert.rejects(() => request(running.port));
    await assert.rejects(
      () =>
        startSupervisor({ directory: s.directory, signingFd: s.fd.fd }).then((value) =>
          value.status === 'READY' ? Promise.resolve() : Promise.reject(Error('REFUSED')),
        ),
      /REFUSED/,
    );
  } finally {
    await running?.stop?.();
    await s.fd.close();
    await fs.rm(s.parent, { recursive: true, force: true });
  }
});
test('blocked private mapping metadata is bounded before service startup; executable/module input is refused', async () => {
  const s = await setup();
  let fifo;
  try {
    assert.deepEqual(
      await startSupervisor({ directory: s.directory, signingFd: s.fd.fd, executable: '/untrusted/secret' }),
      { status: 'REFUSED' },
    );
    await fs.unlink(path.join(s.directory, 'mapping.json'));
    assert.equal(spawnSync('/usr/bin/mkfifo', ['-m', '600', path.join(s.directory, 'mapping.json')]).status, 0);
    fifo = await fs.open(path.join(s.directory, 'mapping.json'), constants.O_RDWR);
    const start = performance.now();
    assert.deepEqual(await startSupervisor({ directory: s.directory, signingFd: s.fd.fd, deadlineMs: 300 }), {
      status: 'REFUSED',
    });
    assert.ok(performance.now() - start < 1800);
    await assert.rejects(() => fs.stat(path.join(s.directory, 'receiver.lock')));
  } finally {
    await fifo?.close();
    await s.fd.close();
    await fs.rm(s.parent, { recursive: true, force: true });
  }
});

import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';

function unconfirmedInspection(t, command = '--inspect', output = 'REFUSED', exitCode = 20) {
  const originalSpawn = childProcess.spawn,
    originalKill = process.kill;
  const syntheticPid = 2147480000;
  t.mock.method(childProcess, 'spawn', (executable, args, options) => {
    if (args[1] !== command) return originalSpawn(executable, args, options);
    const child = Object.assign(new EventEmitter(), {
      pid: syntheticPid,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    child.stdio = [null, child.stdout, child.stderr, new PassThrough()];
    queueMicrotask(() => {
      child.stdout.end(JSON.stringify({ status: output }) + '\n');
      child.stderr.end();
      child.emit('close', exitCode, null);
    });
    return child;
  });
  t.mock.method(process, 'kill', (pid, signal) => {
    if (pid !== -syntheticPid) return originalKill(pid, signal);
    if (signal === 0) return true;
    throw Object.assign(Error('SYNTHETIC_SIGNAL_DENIED'), { code: 'EPERM' });
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
}

test('failed inspection propagates unconfirmed process-group cleanup through supervisor startup', async (t) => {
  const s = await setup();
  unconfirmedInspection(t);
  try {
    assert.deepEqual(await startSupervisor({ directory: s.directory, signingFd: s.fd.fd }), {
      status: 'STOP_UNCONFIRMED',
    });
  } finally {
    await s.fd.close();
    await fs.rm(s.parent, { recursive: true, force: true });
  }
});

import { runErasureChild } from './supervisor.mjs';

test('an erasure child receipt cannot hide unconfirmed process-group cleanup', async (t) => {
  unconfirmedInspection(t, '--erase', 'NOT_DUE', 0);
  assert.deepEqual(await runErasureChild('/synthetic-owned/fixture', 100, 'a'.repeat(64)), { status: 'UNCERTAIN' });
});
