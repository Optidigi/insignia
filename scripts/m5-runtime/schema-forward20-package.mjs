/** New owner-only schema19→20 code mount; never modifies the historical18 package. */
import { createHash } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function packageForwardSchema20({ directory }) {
  if (!isAbsolute(directory)) throw new Error('absolute_owned_path_required');
  await mkdir(directory, { mode: 0o700 });
  const seal = async (path, mode) => {
    for (const entry of await readdir(path, { withFileTypes: true }))
      if (entry.isDirectory()) await seal(join(path, entry.name), mode);
    await chmod(path, mode);
  };
  try {
    const migrations = (await readdir(join(root, 'packages/database/migrations')))
      .filter((x) => x.endsWith('.sql'))
      .sort();
    const provenance = JSON.parse(
      await readFile(join(root, 'scripts/m5-runtime/frozen-schema19-manifest.json'), 'utf8'),
    );
    const historical = Object.keys(provenance.files)
      .filter((x) => x.startsWith('packages/database/migrations/'))
      .map((x) => x.split('/').at(-1))
      .sort();
    if (
      provenance.sourceRef !== '202cb93b0a3f25cdfca6aff35cbdad0484f25b52' ||
      provenance.version !== 'm5-frozen-schema19-compatibility-v1' ||
      migrations.length !== 20 ||
      JSON.stringify(migrations) !== JSON.stringify([...historical, '20261011000200_m5_owner_lifecycle_decisions.sql'])
    )
      throw new Error('unexpected_migration_inputs');
    const files = {};
    for (const path of migrations
      .map((x) => `packages/database/migrations/${x}`)
      .concat([
        'scripts/m5-runtime/schema-forward20.mjs',
        'scripts/m5-runtime/frozen-schema19-manifest.json',
        'pnpm-lock.yaml',
        'apps/worker/package.json',
      ])) {
      const bytes = await readFile(join(root, path));
      if (
        path.startsWith('packages/database/migrations/') &&
        provenance.files[path] &&
        sha(bytes) !== provenance.files[path]
      )
        throw new Error('historical_source_changed');
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), bytes, { mode: 0o444 });
      files[path] = sha(bytes);
    }
    await symlink('/srv/insignia/worker/node_modules', join(directory, 'apps/worker/node_modules'));
    const manifest = {
      version: 'm5-forward20-owner-package-v1',
      fromMigrationCount: 19,
      toMigrationCount: 20,
      files,
      dependencyPath: '/srv/insignia/worker/node_modules',
      ordinaryWorkerStartup: false,
      destructiveDown: false,
      rolesReprovisioned: false,
    };
    await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o444 });
    await seal(directory, 0o555);
    return manifest;
  } catch (error) {
    await seal(directory, 0o700);
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await packageForwardSchema20({ directory: process.argv[2] })));
  } catch {
    console.error('forward20_owner_package_failed');
    process.exitCode = 1;
  }
}
