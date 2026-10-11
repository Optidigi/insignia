/** Readonly owner-operation mount; uses the already qualified worker image dependency graph. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const files = ['scripts/m5-owner-lifecycle/private-operator.mjs', 'apps/worker/package.json', 'pnpm-lock.yaml'];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function packageOwnerLifecycle(directory) {
  assert.ok(isAbsolute(directory) && resolve(directory) === directory, 'absolute_new_owned_directory_required');
  await mkdir(directory, { mode: 0o700 });
  try {
    const hashes = {};
    for (const path of files) {
      const bytes = await readFile(join(root, path));
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), bytes, { mode: 0o444 });
      hashes[path] = digest(bytes);
    }
    const dependencyPath = '/srv/insignia/worker/node_modules';
    await symlink(dependencyPath, join(directory, 'apps/worker/node_modules'));
    const manifest = {
      version: 'm5-explicit-owner-lifecycle-package-v1',
      files: hashes,
      dependencyPath,
      appliedMigrationProfile: 20,
      queueVersion: 43,
      operation: 'separate-owner-container-only',
      ordinaryWorkerStartup: false,
    };
    await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o444 });
    async function seal(path) {
      for (const entry of await readdir(path, { withFileTypes: true }))
        if (entry.isDirectory()) await seal(join(path, entry.name));
      await chmod(path, 0o555);
    }
    await seal(directory);
    return manifest;
  } catch (error) {
    async function unseal(path) {
      await chmod(path, 0o700);
      for (const entry of await readdir(path, { withFileTypes: true }))
        if (entry.isDirectory()) await unseal(join(path, entry.name));
    }
    await unseal(directory);
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 3);
    console.log(JSON.stringify(await packageOwnerLifecycle(process.argv[2])));
  } catch {
    console.error('owner_lifecycle_package_failed');
    process.exitCode = 1;
  }
}
