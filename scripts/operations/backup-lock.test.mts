import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { acquireFileLock } from './backup-lock.mts';

test('kernel flock remains owned after helper exit and releases only when the owning descriptor closes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'insignia-lock-'));
  try {
    const path = join(directory, '.lock');
    const lock = acquireFileLock(path);
    try {
      assert.throws(() => execFileSync('/usr/bin/flock', ['-xn', path, '/usr/bin/true'], { stdio: 'ignore' }));
      assert.throws(() => acquireFileLock(path));
    } finally {
      lock.close();
    }
    execFileSync('/usr/bin/flock', ['-xn', path, '/usr/bin/true'], { stdio: 'ignore' });
    const next = acquireFileLock(path);
    next.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('kernel closes the writer lock after process death; a symlink cannot select another lock identity', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'insignia-lock-crash-'));
  const path = join(directory, '.lock');
  const fixture = new URL('./backup-lock.fixture.mts', import.meta.url).pathname;
  const child = spawn(process.execPath, [fixture, path], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const [bytes] = await once(child.stdout, 'data');
    assert.equal(String(bytes), 'LOCKED');
    assert.throws(() => acquireFileLock(path));
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    const next = acquireFileLock(path);
    next.close();
    symlinkSync(path, join(directory, 'alias'));
    assert.throws(() => acquireFileLock(join(directory, 'alias')));
  } finally {
    child.kill('SIGKILL');
    rmSync(directory, { recursive: true, force: true });
  }
});
