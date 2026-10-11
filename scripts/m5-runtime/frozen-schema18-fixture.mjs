/** Local/CI compatibility fixture only. Never a new production provisioning profile. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const exec = promisify(execFile);
export async function frozenSchema18Fixture() {
  const manifest = JSON.parse(await readFile(new URL('./frozen-schema18-manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.version, 'm5-frozen-schema18-compatibility-v1');
  assert.equal(manifest.sourceRef, 'bbec1483a7a8b91e7c8a2306d896128b40136d72');
  const directory = await mkdtemp(join(tmpdir(), 'insignia-frozen-schema18-'));
  try {
    for (const [path, hash] of Object.entries(manifest.files)) {
      const { stdout } = await exec('git', ['show', `${manifest.sourceRef}:${path}`], {
        cwd: root,
        encoding: 'buffer',
        timeout: 5000,
        maxBuffer: 2 * 1024 * 1024,
      });
      assert.equal(sha(stdout), hash, `Frozen source mismatch: ${path}`);
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), stdout, { mode: 0o600 });
    }
    for (const path of ['scripts/m5-runtime/schema-provision.mjs', 'scripts/m5-runtime/schema-provision-package.mjs'])
      assert.equal(
        sha(await readFile(join(root, path))),
        manifest.files[path],
        'Historical operator source must remain unchanged',
      );
    const queue = await readFile(join(root, 'apps/worker/dist/queue-contract.js'));
    assert.equal(sha(queue), manifest.compiledQueueContractSha256, 'Built queue contract must remain exact');
    await mkdir(join(directory, 'apps/worker/dist'), { recursive: true });
    await writeFile(join(directory, 'apps/worker/dist/queue-contract.js'), queue, { mode: 0o600 });
    await symlink(join(root, 'apps/worker/node_modules'), join(directory, 'apps/worker/node_modules'));
    await writeFile(join(directory, 'compatibility-profile.json'), JSON.stringify(manifest), { mode: 0o600 });
    return { directory, manifest };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
