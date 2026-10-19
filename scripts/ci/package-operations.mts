import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { copyPortableWorker, validatePortableWorker } from './portable-worker.mts';
import { jsonRecord } from './validation.mts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const runtimeFiles = [
  'scripts/operations/heartbeat.mts',
  'scripts/operations/heartbeat-snapshot.mjs',
  'scripts/operations/backup.mts',
  'scripts/operations/backup-run.mts',
  'scripts/operations/backup-files.mts',
  'scripts/operations/backup-archive.mts',
  'scripts/operations/backup-lock.mts',
  'scripts/operations/backup-snapshot.mjs',
  'scripts/operations/backup-replica.mjs',
  'scripts/operations/backup-expiry.mts',
  'scripts/privacy/restore-exclusions.mts',
  'packages/database/migrations/20261018000500_restore_validation_namespace.sql',
];

/** Offline relocatable operations package. No credential, native DB or provider input. */
export async function packageOperations({
  workerPackage,
  destination,
  sourceHead,
  sourceTree,
}: {
  workerPackage: string;
  destination: string;
  sourceHead: string;
  sourceTree: string;
}) {
  assert.equal(process.version, 'v24.21.0');
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  assert.match(sourceHead, /^[a-f0-9]{40}$/);
  assert.match(sourceTree, /^[a-f0-9]{40}$/);
  const worker = await validatePortableWorker(workerPackage);
  const output = resolve(destination);
  assert.ok(output !== worker && !output.startsWith(`${worker}/`), 'New separate destination required');
  const storage = await realpath(join(worker, 'node_modules/@insignia/storage'));
  assert.ok(storage.startsWith(`${worker}/`), 'Storage must remain inside portable worker');
  assert.equal(jsonRecord(await readFile(join(storage, 'package.json'), 'utf8')).name, '@insignia/storage');
  assert.ok((await lstat(join(storage, 'dist/index.js'))).isFile(), 'Built storage dependency required');
  await mkdir(output, { mode: 0o700 });
  await mkdir(join(output, 'apps/worker'), { recursive: true, mode: 0o700 });
  await copyPortableWorker(worker, join(output, 'apps/worker'));
  await mkdir(join(output, 'packages'), { mode: 0o700 });
  await symlink('../apps/worker/node_modules/@insignia/storage', join(output, 'packages/storage'));
  for (const source of runtimeFiles) {
    assert.ok((await lstat(join(root, source))).isFile(), 'Regular allowlisted operations source required');
    await mkdir(dirname(join(output, source)), { recursive: true, mode: 0o700 });
    await copyFile(join(root, source), join(output, source));
  }
  // Bundle the operator's pinned archive dependency into an ordinary isolated
  // CommonJS runtime package. Application worker dependencies remain unchanged.
  const require = createRequire(import.meta.url);
  const archiveManifest = jsonRecord(await readFile(require.resolve('tar-stream/package'), 'utf8'));
  assert.equal(archiveManifest.name, 'tar-stream');
  assert.equal(archiveManifest.version, '3.2.2');
  const archiveDirectory = join(output, 'node_modules/tar-stream');
  await mkdir(archiveDirectory, { recursive: true, mode: 0o700 });
  const bundle = await build({
    entryPoints: [require.resolve('tar-stream')],
    outfile: join(archiveDirectory, 'index.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    legalComments: 'linked',
    metafile: true,
  });
  await writeFile(
    join(archiveDirectory, 'package.json'),
    JSON.stringify({
      name: archiveManifest.name,
      version: archiveManifest.version,
      type: 'commonjs',
      main: 'index.cjs',
      license: archiveManifest.license,
      description: 'Generated runtime bundle from the pinned operations dependency closure',
    }),
    { mode: 0o600, flag: 'wx' },
  );
  await copyFile(join(dirname(require.resolve('tar-stream/package')), 'LICENSE'), join(archiveDirectory, 'LICENSE'));
  const bundledPackages = new Map<
    string,
    { name: string; version: string; directory: string; manifestSha256: string }
  >();
  for (const input of Object.keys(bundle.metafile.inputs)) {
    let directory = dirname(resolve(root, input));
    assert(directory.startsWith(`${root}/node_modules/`), 'Archive bundle input must come from pinned dependencies');
    while (directory.startsWith(`${root}/node_modules/`)) {
      const path = join(directory, 'package.json');
      let raw: Buffer;
      try {
        raw = await readFile(path);
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
        directory = dirname(directory);
        continue;
      }
      const manifest = jsonRecord(raw.toString('utf8'));
      assert(typeof manifest.name === 'string' && typeof manifest.version === 'string', 'Dependency identity required');
      assert(
        /^[a-zA-Z0-9_.@/-]+$/.test(manifest.name) && /^[a-zA-Z0-9_.+-]+$/.test(manifest.version),
        'Invalid dependency identity',
      );
      bundledPackages.set(directory, {
        name: manifest.name,
        version: manifest.version,
        directory,
        manifestSha256: hash(raw),
      });
      break;
    }
  }
  const notices: { name: string; version: string; manifestSha256: string; licenseFiles: string[] }[] = [];
  for (const library of [...bundledPackages.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const prefix = `licenses/${encodeURIComponent(library.name)}@${library.version}`;
    const names = (await readdir(library.directory))
      .filter((name) => /^(?:LICEN[CS]E|NOTICE)(?:[.-]|$)/i.test(name))
      .sort();
    assert(names.length > 0, `Bundled dependency license absent: ${library.name}`);
    await mkdir(join(output, prefix), { recursive: true, mode: 0o700 });
    const licenseFiles: string[] = [];
    for (const name of names) {
      const source = join(library.directory, name);
      assert((await lstat(source)).isFile(), 'Regular dependency notice required');
      const destination = `${prefix}/${name}`;
      await copyFile(source, join(output, destination));
      licenseFiles.push(destination);
    }
    notices.push({
      name: library.name,
      version: library.version,
      manifestSha256: library.manifestSha256,
      licenseFiles,
    });
  }
  await writeFile(join(output, 'THIRD-PARTY-NOTICES.json'), JSON.stringify(notices, null, 2) + '\n', {
    mode: 0o600,
    flag: 'wx',
  });
  await mkdir(join(output, 'bin'), { mode: 0o700 });
  await copyFile(process.execPath, join(output, 'bin/node'));
  await copyFile(resolve(dirname(process.execPath), '../LICENSE'), join(output, 'NODE-LICENSE'));
  await chmod(join(output, 'bin/node'), 0o500);
  const files: Record<string, { kind: 'link'; target: string } | { kind: 'file'; mode: number; sha256: string }> = {};
  async function inventory(directory: string) {
    await chmod(directory, 0o700);
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name),
        info = await lstat(path),
        key = relative(output, path);
      if (info.isDirectory()) await inventory(path);
      else if (info.isSymbolicLink()) {
        assert.ok((await realpath(path)).startsWith(`${output}/`), 'Packaged dependency escaped artifact');
        files[key] = { kind: 'link', target: await readlink(path) };
      } else {
        assert.ok(info.isFile(), 'Only regular operations files supported');
        const mode = info.mode & 0o111 ? 0o500 : 0o400;
        await chmod(path, mode);
        files[key] = { kind: 'file', mode, sha256: hash(await readFile(path)) };
      }
    }
  }
  await inventory(output);
  const manifest = {
    version: 'insignia-operations-artifact-v1',
    sourceHead,
    sourceTree,
    nodeVersion: process.version,
    platform: 'linux-x64',
    files,
  };
  const raw = `${JSON.stringify(manifest, null, 2)}\n`;
  const receipt = {
    classification: 'OPERATIONS_ARTIFACT_PACKAGED_NOT_NATIVE_QUALIFIED',
    sourceHead,
    sourceTree,
    manifestSha256: hash(raw),
    fileCount: Object.keys(files).length,
    nativeEffects: false,
  };
  await writeFile(join(output, 'manifest.json'), raw, { mode: 0o400, flag: 'wx' });
  await writeFile(join(output, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o400, flag: 'wx' });
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 4, 'Usage: package-operations.mjs WORKER_PACKAGE NEW_DESTINATION');
  const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const sourceTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim();
  assert.ok(process.argv[2] && process.argv[3]);
  console.log(
    JSON.stringify(
      await packageOperations({ workerPackage: process.argv[2], destination: process.argv[3], sourceHead, sourceTree }),
    ),
  );
}
