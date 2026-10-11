import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readdir, readFile, readlink, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { packageDatabasePasswordRotation } from './db-password-rotation-package.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
test('separate readonly package freezes exact three source files and fixed existing-image dependency route without secrets or worker startup', async () => {
  const base = await mkdtemp(join(tmpdir(), 'insignia-rotation-package-'));
  const directory = join(base, 'code');
  try {
    const m = await packageDatabasePasswordRotation(directory);
    assert.equal(m.appliedMigrationProfile, 18);
    assert.equal(m.queueVersion, 43);
    assert.equal(m.ordinaryWorkerStartup, false);
    assert.deepEqual(Object.keys(m.files), [
      'scripts/m5-runtime/db-password-rotation.mjs',
      'apps/worker/package.json',
      'pnpm-lock.yaml',
    ]);
    for (const [path, hash] of Object.entries(m.files)) {
      const b = await readFile(join(directory, path));
      assert.equal(createHash('sha256').update(b).digest('hex'), hash);
      assert.deepEqual(b, await readFile(join(root, path)));
      assert.equal((await stat(join(directory, path))).mode & 0o777, 0o444);
    }
    assert.equal((await stat(directory)).mode & 0o777, 0o555);
    assert.equal(await readlink(join(directory, 'apps/worker/node_modules')), '/srv/insignia/worker/node_modules');
    await assert.rejects(packageDatabasePasswordRotation(directory), { code: 'EEXIST' });
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')), m);
    await assert.rejects(packageDatabasePasswordRotation('relative'), /absolute_new_owned_directory_required/);
  } finally {
    async function unseal(p) {
      await chmod(p, 0o700);
      for (const e of await readdir(p, { withFileTypes: true })) if (e.isDirectory()) await unseal(join(p, e.name));
    }
    await unseal(base);
    await rm(base, { recursive: true, force: true });
  }
});
