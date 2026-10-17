import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, cp, lstat, mkdir, readdir, readFile, readlink, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const privateName =
  /(?:^\.env(?:\.|$)|\.env$|^(?:auth|session|context|credentials|inspection|m6-r2)\.json$|\.pem$|\.key$)/i;

/** Offline packaging of the existing portable worker; never starts inspection or reads credentials. */
export async function packageInspector({ workerPackage, destination, sourceHead, sourceTree }) {
  assert.equal(process.version, 'v24.21.0');
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  assert.match(sourceHead, /^[a-f0-9]{40}$/);
  assert.match(sourceTree, /^[a-f0-9]{40}$/);
  const worker = await realpath(workerPackage);
  const output = resolve(destination);
  assert.ok(!output.startsWith(`${worker}/`) && output !== worker, 'New separate destination required');
  assert.equal(JSON.parse(await readFile(join(worker, 'package.json'))).name, '@insignia/worker');
  async function validate(directory) {
    for (const name of await readdir(directory)) {
      assert.ok(!privateName.test(name), 'Private file cannot enter inspector artifact');
      const path = join(directory, name),
        info = await lstat(path);
      if (info.isSymbolicLink()) {
        assert.ok((await realpath(path)).startsWith(`${worker}/`), 'Worker dependency escaped portable package');
        assert.ok(!(await readlink(path)).startsWith('/'), 'Absolute worker dependency escaped relocation');
      } else if (info.isDirectory()) await validate(path);
      else assert.ok(info.isFile(), 'Only regular runtime files are supported');
    }
  }
  for (const item of ['dist', 'node_modules']) await validate(join(worker, item));
  for (const name of [
    'artwork-main.js',
    'artwork/sandbox.js',
    'artwork/child.js',
    'artwork/isolation-probe.js',
    'artwork/runtime-mounts.js',
  ])
    assert.ok((await lstat(join(worker, 'dist', name))).isFile(), 'Built inspector entrypoint and sandbox required');
  await mkdir(output, { mode: 0o700 });
  await mkdir(join(output, 'worker'), { mode: 0o700 });
  for (const name of ['dist', 'node_modules', 'package.json'])
    await cp(join(worker, name), join(output, 'worker', name), {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      force: false,
      errorOnExist: true,
    });
  await mkdir(join(output, 'bin'), { mode: 0o700 });
  await copyFile(process.execPath, join(output, 'bin/node'));
  await copyFile(resolve(dirname(process.execPath), '../LICENSE'), join(output, 'NODE-LICENSE'));
  await chmod(join(output, 'bin/node'), 0o500);
  const template = await readFile(join(root, 'deployment/artwork-inspector/artwork-inspection.service.in'), 'utf8');
  await copyFile(join(root, 'deployment/artwork-inspector/start.mjs'), join(output, 'start.mjs'));
  await writeFile(join(output, 'service.template'), template, { mode: 0o400 });
  const files = {};
  async function inventory(directory) {
    await chmod(directory, 0o700);
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name),
        info = await lstat(path),
        key = relative(output, path);
      if (info.isDirectory()) await inventory(path);
      else if (info.isSymbolicLink()) files[key] = { kind: 'link', target: await readlink(path) };
      else {
        const mode = info.mode & 0o111 ? 0o500 : 0o400;
        await chmod(path, mode);
        files[key] = { kind: 'file', mode, sha256: hash(await readFile(path)) };
      }
    }
  }
  await inventory(output);
  const manifest = {
    version: 'insignia-artwork-inspector-artifact-v1',
    sourceHead,
    sourceTree,
    nodeVersion: process.version,
    platform: 'linux-x64',
    files,
  };
  const raw = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestSha256 = hash(raw);
  await writeFile(join(output, 'manifest.json'), raw, { mode: 0o600, flag: 'wx' });
  const service = template.replaceAll('@SOURCE_TREE@', sourceTree).replaceAll('@MANIFEST_SHA256@', manifestSha256);
  await writeFile(join(output, 'artwork-inspection.service'), service, { mode: 0o600, flag: 'wx' });
  const receipt = {
    classification: 'INSPECTOR_ARTIFACT_PACKAGED_NOT_NATIVE_QUALIFIED',
    sourceHead,
    sourceTree,
    manifestSha256,
    serviceSha256: hash(service),
    fileCount: Object.keys(files).length,
    hostExceptionApproved: true,
    sandboxQualified: false,
    nativeEffects: false,
  };
  await writeFile(join(output, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 4, 'Usage: package-artwork-inspector.mjs WORKER_PACKAGE NEW_DESTINATION');
  const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const sourceTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim();
  console.log(
    JSON.stringify(
      await packageInspector({ workerPackage: process.argv[2], destination: process.argv[3], sourceHead, sourceTree }),
    ),
  );
}
