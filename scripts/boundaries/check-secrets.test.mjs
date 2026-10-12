import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('secret provenance rejects an unused lazy storefront chunk, not only the bootstrap entry', () => {
  const root = resolve(import.meta.dirname, '../..');
  const probe = resolve(root, 'apps/storefront/dist/insignia-secret-probe.js');
  assert.equal(existsSync(probe), false);
  try {
    writeFileSync(probe, `export const probe=${JSON.stringify(['sh', 'pat', '_synthetic'].join(''))};`);
    const result = spawnSync(process.execPath, ['scripts/boundaries/check-secrets.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /browser artifact contains forbidden marker: apps\/storefront\/dist\/insignia-secret-probe\.js/,
    );
  } finally {
    rmSync(probe, { force: true });
  }
});
