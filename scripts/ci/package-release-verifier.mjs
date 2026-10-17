import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  cp,
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
import { SOURCE_PATHS } from '../m5-runtime/trusted-release-launch.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function packageVerifier({ workerPackage, sdkArchive, destination, sourceHead, sourceTree }) {
  assert.equal(process.version, 'v24.21.0');
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  assert.match(sourceHead, /^[a-f0-9]{40}$/);
  assert.match(sourceTree, /^[a-f0-9]{40}$/);
  const output = resolve(destination),
    worker = await realpath(workerPackage);
  assert.ok(output !== worker && !output.startsWith(`${worker}/`));
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
  await symlink('worker/node_modules', join(output, 'node_modules'));
  const sources = new Set([
    ...SOURCE_PATHS,
    'package.json',
    'deployment/release-verifier/artifact.mjs',
    'deployment/release-verifier/bootstrap.mjs',
    'scripts/m5-runtime/verifier-runtime.mjs',
  ]);
  for (const directory of ['deployment/m8-journey', 'deployment/m5-runtime'])
    for (const name of await readdir(join(root, directory)))
      if (name.endsWith('.json')) sources.add(`${directory}/${name}`);
  for (const path of sources) {
    await mkdir(dirname(join(output, path)), { recursive: true, mode: 0o700 });
    await copyFile(join(root, path), join(output, path));
  }
  await mkdir(join(output, 'bin'), { mode: 0o700 });
  await copyFile(process.execPath, join(output, 'bin/node'));
  await chmod(join(output, 'bin/node'), 0o500);
  await copyFile(resolve(dirname(process.execPath), '../LICENSE'), join(output, 'NODE-LICENSE'));
  execFileSync(
    'python3',
    ['-B', join(root, 'scripts/ci/prepare-verifier-sdk.py'), resolve(sdkArchive), join(output, 'sdk')],
    { stdio: 'pipe' },
  );
  await mkdir(join(output, 'sdk/existing-session-qualification'), { mode: 0o700 });
  const client = await readFile(join(root, 'deployment/release-verifier/client.mjs'));
  assert.equal(hash(client), '0ef1b8bc8e073b7753d93ed2a912148d7c87de5c3804622607040cb414b4f641');
  await writeFile(join(output, 'sdk/existing-session-qualification/client.mjs'), client, { mode: 0o400, flag: 'wx' });
  const files = {};
  async function inventory(directory) {
    await chmod(directory, 0o700);
    for (const name of (await readdir(directory)).sort()) {
      assert.ok(
        !name.startsWith('.env') && !/^(?:auth|session|context|credentials)\.json$/.test(name),
        'private_file_in_code_artifact',
      );
      const path = join(directory, name),
        info = await lstat(path),
        key = relative(output, path);
      if (info.isDirectory()) await inventory(path);
      else if (info.isSymbolicLink()) {
        assert.ok(
          (await realpath(path)).startsWith(`${output}/`) && !(await readlink(path)).startsWith('/'),
          'runtime_symlink_escaped',
        );
        files[key] = { kind: 'link', target: await readlink(path) };
      } else {
        assert.ok(info.isFile());
        const mode = info.mode & 0o111 ? 0o500 : 0o400;
        await chmod(path, mode);
        files[key] = { kind: 'file', mode, sha256: hash(await readFile(path)) };
      }
    }
  }
  await inventory(output);
  const manifest = {
    version: 'insignia-release-verifier-artifact-v1',
    sourceHead,
    sourceTree,
    nodeVersion: process.version,
    files,
  };
  const raw = `${JSON.stringify(manifest, null, 2)}\n`,
    manifestSha256 = hash(raw);
  await writeFile(join(output, 'manifest.json'), raw, { mode: 0o600, flag: 'wx' });
  await writeFile(
    join(output, 'identity.json'),
    JSON.stringify({ version: 'insignia-release-verifier-identity-v1', manifestSha256 }),
    { mode: 0o600, flag: 'wx' },
  );
  const receipt = {
    classification: 'IMMUTABLE_VERIFIER_CODE_PACKAGED_NOT_NATIVE_QUALIFIED',
    sourceHead,
    sourceTree,
    manifestSha256,
    sdkArchiveSha256: '0b1c01d1ebf1f1265826a4ffa78ea94bc4c2eb8a36beb9b2f5fb305ef30231ff',
    providerCalls: 0,
    nativeEffects: false,
  };
  await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt), { mode: 0o600, flag: 'wx' });
  return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 5);
  const git = (ref) => execFileSync('git', ['rev-parse', ref], { cwd: root, encoding: 'utf8' }).trim();
  console.log(
    JSON.stringify(
      await packageVerifier({
        workerPackage: process.argv[2],
        sdkArchive: process.argv[3],
        destination: process.argv[4],
        sourceHead: git('HEAD'),
        sourceTree: git('HEAD^{tree}'),
      }),
    ),
  );
}
