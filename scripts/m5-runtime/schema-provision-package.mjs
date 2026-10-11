/** Owner-only readonly code mount for the already qualified ordinary worker image. */
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const digest = (value) => createHash('sha256').update(value).digest('hex');
export async function packageSchemaProvision({ directory, workerPackageEntry }) {
  if (!isAbsolute(directory) || !isAbsolute(workerPackageEntry)) throw new Error('absolute_owned_paths_required');
  await mkdir(directory, { mode: 0o700 });
  try {
    const { readdir } = await import('node:fs/promises');
    const migrations = (await readdir(join(root, 'packages/database/migrations')))
      .filter((x) => x.endsWith('.sql'))
      .sort();
    if (migrations.length !== 18) throw new Error('unexpected_migration_inputs');
    const paths = migrations
      .map((x) => `packages/database/migrations/${x}`)
      .concat([
        'docs/delivery/evidence/m5-023/operators/trusted-release-roles.sql',
        'scripts/m5-024/queue-roles.sql',
        'scripts/m5-024/install-queue.mjs',
        'scripts/m5-runtime/schema-provision.mjs',
        'pnpm-lock.yaml',
        'apps/worker/package.json',
      ]);
    const files = {};
    for (const path of paths) {
      const bytes = await readFile(join(root, path));
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), bytes, { mode: 0o444 });
      files[path] = digest(bytes);
    }
    const queuePath = 'apps/worker/dist/queue-contract.js';
    const queue = await readFile(join(dirname(workerPackageEntry), 'queue-contract.js'));
    // Package the exact compiled contract supplied by the reviewed worker build;
    // no compilation/source fallback or private environment file is admitted.
    if (digest(queue) !== digest(await readFile(join(root, queuePath))))
      throw new Error('compiled_queue_contract_mismatch');
    await mkdir(dirname(join(directory, queuePath)), { recursive: true });
    await writeFile(join(directory, queuePath), queue, { mode: 0o444 });
    files[queuePath] = digest(queue);
    const dependencyPath = '/srv/insignia/worker/node_modules';
    await symlink(dependencyPath, join(directory, 'apps/worker/node_modules'));
    const manifest = {
      version: 'm5-schema-owner-package-v1',
      files,
      dependencyPath,
      operation: 'separate-owner-container-only',
      ordinaryWorkerStartup: false,
    };
    await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o444 });
    const seal = async (path) => {
      for (const entry of await readdir(path, { withFileTypes: true }))
        if (entry.isDirectory()) await seal(join(path, entry.name));
      await chmod(path, 0o555);
    };
    await seal(directory);
    return manifest;
  } catch (error) {
    const unseal = async (path) => {
      await chmod(path, 0o700);
      const { readdir } = await import('node:fs/promises');
      for (const entry of await readdir(path, { withFileTypes: true }))
        if (entry.isDirectory()) await unseal(join(path, entry.name));
    };
    await unseal(directory);
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(
      JSON.stringify(await packageSchemaProvision({ directory: process.argv[2], workerPackageEntry: process.argv[3] })),
    );
  } catch {
    console.error('schema_owner_package_failed');
    process.exitCode = 1;
  }
}
