import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readdir, readFile, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { packageForwardSchema20 } from './schema-forward20-package.mjs';

test('forward20 owner package contains exact immutable inputs and no private runtime configuration', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'insignia-forward20-package-'));
  try {
    const manifest = await packageForwardSchema20({ directory: join(parent, 'operator') });
    assert.equal(manifest.version, 'm5-forward20-owner-package-v1');
    assert.equal(manifest.fromMigrationCount, 19);
    assert.equal(manifest.toMigrationCount, 20);
    assert.equal(Object.keys(manifest.files).filter((x) => x.startsWith('packages/database/migrations/')).length, 20);
    assert.equal(
      await readlink(join(parent, 'operator/apps/worker/node_modules')),
      '/srv/insignia/worker/node_modules',
    );
    for (const [path, sha] of Object.entries(manifest.files))
      assert.equal(
        createHash('sha256')
          .update(await readFile(join(parent, 'operator', path)))
          .digest('hex'),
        sha,
      );
    assert.ok(
      !Object.keys(manifest.files).some((x) =>
        /(^|\/)(credentials\.json|\.env)|queue-roles|schema-provision\.mjs/.test(x),
      ),
    );
    await assert.rejects(packageForwardSchema20({ directory: join(parent, 'operator') }), { code: 'EEXIST' });
  } finally {
    const unseal = async (path) => {
      await chmod(path, 0o700);
      for (const e of await readdir(path, { withFileTypes: true }))
        if (e.isDirectory()) await unseal(join(path, e.name));
    };
    await unseal(parent);
    await rm(parent, { recursive: true, force: true });
  }
});
