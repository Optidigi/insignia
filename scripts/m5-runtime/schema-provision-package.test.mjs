import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readdir, readFile, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { packageSchemaProvision } from './schema-provision-package.mjs';

test('owner operator package freezes accepted SQL/installer and compiled queue contract with image-only dependencies', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'insignia-schema-package-'));
  const directory = join(parent, 'operator');
  try {
    const result = await packageSchemaProvision({
      directory,
      workerPackageEntry: new URL('../../apps/worker/dist/main.js', import.meta.url).pathname,
    });
    assert.equal(result.dependencyPath, '/srv/insignia/worker/node_modules');
    assert.equal(await readlink(join(directory, 'apps/worker/node_modules')), result.dependencyPath);
    for (const [path, sha] of Object.entries(result.files))
      assert.equal(
        createHash('sha256')
          .update(await readFile(join(directory, path)))
          .digest('hex'),
        sha,
      );
    assert.equal(Object.keys(result.files).filter((x) => x.startsWith('packages/database/migrations/')).length, 18);
    assert.equal(
      await readFile(join(directory, 'scripts/m5-024/install-queue.mjs'), 'utf8'),
      await readFile(new URL('../m5-024/install-queue.mjs', import.meta.url), 'utf8'),
    );
    await assert.rejects(
      packageSchemaProvision({
        directory,
        workerPackageEntry: new URL('../../apps/worker/dist/main.js', import.meta.url).pathname,
      }),
      { code: 'EEXIST' },
    );
  } finally {
    const unseal = async (path) => {
      await chmod(path, 0o755);
      for (const entry of await readdir(path, { withFileTypes: true }))
        if (entry.isDirectory()) await unseal(join(path, entry.name));
    };
    await unseal(parent);
    await rm(parent, { recursive: true, force: true });
  }
});
