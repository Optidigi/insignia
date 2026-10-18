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
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyPortableWorker, validatePortableWorker } from './portable-worker.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const runtimeFiles = [
  'scripts/operations/heartbeat.mjs',
  'scripts/operations/heartbeat-snapshot.mjs',
  'scripts/operations/backup.py',
  'scripts/operations/backup-run.py',
  'scripts/operations/backup-snapshot.mjs',
  'scripts/operations/backup-replica.mjs',
  'scripts/operations/backup-expiry.mjs',
  'scripts/privacy/restore-exclusions.mjs',
];

/** Offline relocatable operations package. No credential, native DB or provider input. */
export async function packageOperations({ workerPackage, destination, sourceHead, sourceTree }) {
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
  assert.equal(JSON.parse(await readFile(join(storage, 'package.json'))).name, '@insignia/storage');
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
  await mkdir(join(output, 'bin'), { mode: 0o700 });
  await copyFile(process.execPath, join(output, 'bin/node'));
  await copyFile(resolve(dirname(process.execPath), '../LICENSE'), join(output, 'NODE-LICENSE'));
  await chmod(join(output, 'bin/node'), 0o500);
  const files = {};
  async function inventory(directory) {
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
  console.log(
    JSON.stringify(
      await packageOperations({ workerPackage: process.argv[2], destination: process.argv[3], sourceHead, sourceTree }),
    ),
  );
}
