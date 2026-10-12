/** Historical test fixture only; never expands a production provisioning profile. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sourceRef = '36945927e3fedc72c44247ec8357eb669186c0c6';
const exec = promisify(execFile);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function frozenSchema20Fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'insignia-frozen-schema20-'));
  try {
    const { stdout: listing } = await exec(
      'git',
      ['ls-tree', '-r', '--name-only', sourceRef, 'packages/database/migrations'],
      { cwd: root },
    );
    const migrations = listing
      .trim()
      .split('\n')
      .filter((path) => path.endsWith('.sql'))
      .sort();
    assert.equal(migrations.length, 20, 'unqualified_schema20_provenance');
    assert.equal(migrations.at(-1), 'packages/database/migrations/20261011000200_m5_owner_lifecycle_decisions.sql');
    const operators = ['scripts/m5-runtime/schema-forward20.mjs', 'scripts/m5-runtime/schema-forward20-package.mjs'];
    const files = {};
    for (const path of [
      ...migrations,
      ...operators,
      'scripts/m5-runtime/frozen-schema19-manifest.json',
      'pnpm-lock.yaml',
      'apps/worker/package.json',
    ]) {
      const { stdout } = await exec('git', ['show', `${sourceRef}:${path}`], {
        cwd: root,
        encoding: 'buffer',
        timeout: 5000,
        maxBuffer: 2 * 1024 * 1024,
      });
      files[path] = sha(stdout);
      if (operators.includes(path))
        assert.equal(
          sha(await readFile(join(root, path))),
          files[path],
          'Historical operator source must remain unchanged',
        );
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), stdout, { mode: 0o600 });
    }
    await symlink(join(root, 'apps/worker/node_modules'), join(directory, 'apps/worker/node_modules'));
    const manifest = { version: 'm5-frozen-schema20-compatibility-v1', sourceRef, files };
    await writeFile(join(directory, 'compatibility-profile.json'), JSON.stringify(manifest), { mode: 0o600 });
    return { directory, manifest };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
