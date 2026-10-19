import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, readlink, realpath } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function object(value:unknown):Record<string,unknown> { assert(value && typeof value==='object' && !Array.isArray(value));return Object.fromEntries(Object.entries(value));}
function uid():number {assert(process.getuid);return process.getuid();}
const root = dirname(fileURLToPath(import.meta.url));
const hash = (bytes:Uint8Array) => createHash('sha256').update(bytes).digest('hex');
try {
  const args = process.argv.slice(2);
  assert.ok(args.length === 2 || (args.length === 3 && args[2] === '--verify-only'));
  assert.equal(args[0], '--manifest-sha256');
  const manifestSha256=args[1];
  assert(typeof manifestSha256 === 'string');
  assert.match(manifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(process.version, 'v24.21.0');
  assert.equal(await realpath(process.execPath), join(root, 'bin/node'));
  const raw = await readFile(join(root, 'manifest.json'));
  assert.equal(hash(raw), args[1]);
  const manifestValue:unknown=JSON.parse(raw.toString('utf8'));
  const manifest=object(manifestValue);
  const files=object(manifest.files);
  assert(typeof manifest.sourceTree === 'string');
  assert.equal(manifest.version, 'insignia-artwork-inspector-artifact-v1');
  const seen:string[] = [];
  async function verify(directory:string):Promise<void> {
    const directoryStat = await lstat(directory);
    assert.ok(
      directoryStat.isDirectory() && directoryStat.uid === uid() && (directoryStat.mode & 0o777) === 0o700,
    );
    for (const name of await readdir(directory)) {
      const path = join(directory, name);
      const key = relative(root, path);
      if (['manifest.json', 'receipt.json', 'artwork-inspection.service'].includes(key)) {
        const info = await lstat(path);
        assert.ok(info.isFile() && info.uid === uid() && (info.mode & 0o777) === 0o600);
        continue;
      }
      const info = await lstat(path);
      if (info.isDirectory()) await verify(path);
      else {
        seen.push(key);
        const expected = object(files[key]);
        assert.ok(expected);
        if (info.isSymbolicLink()) {
          assert.equal(expected.kind, 'link');
          assert.equal(await readlink(path), expected.target);
          assert.ok((await realpath(path)).startsWith(`${root}/`));
        } else {
          assert.ok(info.isFile() && info.uid === uid());
          assert.equal(info.mode & 0o777, expected.mode);
          assert.equal(hash(await readFile(path)), expected.sha256);
        }
      }
    }
  }
  await verify(root);
  assert.deepEqual(seen.sort(), Object.keys(files).sort());
  const expectedService = (await readFile(join(root, 'service.template'), 'utf8'))
    .replaceAll('@SOURCE_TREE@', manifest.sourceTree)
    .replaceAll('@MANIFEST_SHA256@', manifestSha256);
  assert.equal(await readFile(join(root, 'artwork-inspection.service'), 'utf8'), expectedService);

  if (args[2] === '--verify-only') {
    console.log(JSON.stringify({ classification: 'INSPECTOR_ARTIFACT_INTEGRITY_PASS_ONLY', inspectionStarted: false }));
  } else {
    // Only external private storage custody is loaded after code qualification.
    const storage = process.env.ARTWORK_STORAGE_PROFILE;
    assert.ok(storage && !storage.startsWith(`${root}/`));
    const info = await lstat(storage);
    assert.ok(info.isFile() && info.uid === uid() && (info.mode & 0o777) === 0o600);
    assert.equal(await realpath(storage), storage);
    await import(pathToFileURL(join(root, 'worker/dist/artwork-main.js')).href);
  }
} catch {
  console.error('Insignia inspector artifact or private startup configuration rejected');
  process.exitCode = 1;
}
