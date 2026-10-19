import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  ftruncateSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { prune } from './backup.mts';
import { number, record } from './backup-files.mts';
import { runOffhostReplica } from './backup-run.mts';

const fixture = new URL('./backup-review.fixture.mts', import.meta.url).pathname;

test('offhost replica interruption terminates the actual child and cannot acknowledge completion', {
  timeout: 10000,
}, async () => {
  const root = mkdtempSync('/dev/shm/insignia-replica-abort-'),
    controller = new AbortController();
  try {
    const pending = runOffhostReplica([process.execPath, fixture, 'replica', root], controller.signal);
    // Attach the rejection observer before aborting the actual transport.
    const observed = assert.rejects(pending);
    while (!existsSync(join(root, 'replica-ready'))) await delay(10);
    const pid = Number(readFileSync(join(root, 'replica-pid'), 'utf8'));
    controller.abort(new Error('operator interrupted'));
    await observed;
    assert(!existsSync(join(root, 'replica-completed')));
    assert.throws(() => process.kill(pid, 0));
  } finally {
    controller.abort();
    rmSync(root, { recursive: true, force: true });
  }
});
test('large sparse payload hashing is byte-exact with bounded resident memory', () => {
  const root = mkdtempSync('/dev/shm/insignia-digest-bound-'),
    path = join(root, 'payload');
  try {
    const fd = openSync(path, 'wx', 0o600);
    try {
      ftruncateSync(fd, 64 * 1024 * 1024);
    } finally {
      closeSync(fd);
    }
    const expected = execFileSync('openssl', ['dgst', '-sha256', path], { encoding: 'utf8' })
      .trim()
      .match(/[a-f0-9]{64}$/)?.[0];
    assert(expected);
    const child = spawnSync(process.execPath, [fixture, 'digest', path], { encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, 0, child.stderr);
    const result = record(JSON.parse(child.stdout));
    assert.equal(result.hash, expected);
    assert(number(result.peakIncreaseKiB) < 16 * 1024, 'Hashing must not allocate the payload size');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('truncated Unix readiness HTTP enters durable resume HOLD instead of crashing or restarting containers', () => {
  const root = mkdtempSync('/dev/shm/insignia-truncated-ready-');
  try {
    const child = spawnSync(process.execPath, [fixture, 'readiness', root], { encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { held: true, containerStarts: 0, windowClosed: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('dangling expired artifact symlink retains its receipt and intent while independent expiry still prunes', () => {
  const root = mkdtempSync('/dev/shm/insignia-retention-link-');
  try {
    const bad = '11111111-1111-1111-1111-111111111111',
      good = '22222222-2222-2222-2222-222222222222';
    const receipt = (id: string) => ({ format: 'insignia-encrypted-backup-v1', id, expiresAt: '2000-01-01T00:00:00Z' });
    const intent = { format: 'insignia-backup-intent-v1', id: bad, expiresAt: '2000-01-01T00:00:00Z' };
    writeFileSync(join(root, `${bad}.json`), JSON.stringify(receipt(bad)));
    writeFileSync(join(root, `${bad}.intent.json`), JSON.stringify(intent));
    symlinkSync(join(root, 'missing-target'), join(root, `${bad}.cms`));
    writeFileSync(join(root, `${good}.json`), JSON.stringify(receipt(good)));
    writeFileSync(join(root, `${good}.cms`), 'expired owned ciphertext');
    assert.throws(() => prune(root, Date.now()), /damaged identities/);
    assert.equal(readFileSync(join(root, `${bad}.json`), 'utf8'), JSON.stringify(receipt(bad)));
    assert.equal(readFileSync(join(root, `${bad}.intent.json`), 'utf8'), JSON.stringify(intent));
    assert(lstatSync(join(root, `${bad}.cms`)).isSymbolicLink());
    assert(!existsSync(join(root, `${good}.cms`)));
    assert(!existsSync(join(root, `${good}.json`)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
