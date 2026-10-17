import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, readFile, readlink, realpath } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function privateFile(path, limit = 16384) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    assert.ok(info.isFile() && info.uid === process.getuid() && (info.mode & 0o777) === 0o600 && info.size <= limit);
    assert.equal(await realpath(path), resolve(path));
    const bytes = await handle.readFile();
    assert.ok(bytes.length <= limit);
    return bytes;
  } finally {
    await handle.close();
  }
}

/** Digest must originate in independently reviewed artifact/deployment provenance, never a web request. */
export async function qualifyVerifierArtifact(root, expectedDigest) {
  assert.match(expectedDigest, /^[a-f0-9]{64}$/);
  const raw = await privateFile(join(root, 'manifest.json'), 4 * 1024 * 1024);
  assert.equal(hash(raw), expectedDigest, 'verifier_manifest_digest_changed');
  const manifest = JSON.parse(raw);
  assert.deepEqual(Object.keys(manifest).sort(), ['files', 'nodeVersion', 'sourceHead', 'sourceTree', 'version']);
  assert.equal(manifest.version, 'insignia-release-verifier-artifact-v1');
  assert.equal(manifest.nodeVersion, 'v24.21.0');
  assert.match(manifest.sourceHead, /^[a-f0-9]{40}$/);
  assert.match(manifest.sourceTree, /^[a-f0-9]{40}$/);
  assert.ok(manifest.files && Object.keys(manifest.files).length > 0 && Object.keys(manifest.files).length <= 20000);
  const seen = [];
  async function walk(directory) {
    const d = await lstat(directory);
    assert.ok(d.isDirectory() && d.uid === process.getuid() && (d.mode & 0o777) === 0o700);
    for (const name of await readdir(directory)) {
      const path = join(directory, name),
        key = relative(root, path),
        info = await lstat(path);
      if (['manifest.json', 'identity.json', 'receipt.json'].includes(key)) {
        await privateFile(path, 4 * 1024 * 1024);
      } else if (info.isDirectory()) await walk(path);
      else {
        assert.ok(
          !name.startsWith('.env') && !/^(?:auth|session|context|credentials)\.json$/.test(name),
          'secret_file_in_artifact',
        );
        seen.push(key);
        const expected = manifest.files[key];
        assert.ok(expected, 'unrecorded_verifier_code');
        if (info.isSymbolicLink()) {
          assert.equal(expected.kind, 'link');
          assert.equal(await readlink(path), expected.target);
          assert.ok((await realpath(path)).startsWith(`${root}/`));
        } else {
          assert.ok(info.isFile() && info.uid === process.getuid());
          assert.equal(info.mode & 0o777, expected.mode);
          assert.equal(hash(await readFile(path)), expected.sha256, 'verifier_code_changed');
        }
      }
    }
  }
  await walk(root);
  assert.deepEqual(seen.sort(), Object.keys(manifest.files).sort(), 'verifier_code_omitted');
  return manifest;
}

export async function readVerifierStartup(path) {
  const bytes = await privateFile(path);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      value = JSON.parse(text);
    assert.deepEqual(Object.keys(value).sort(), ['appendPassword', 'clientSecret', 'databaseUrl']);
    assert.equal(text.match(/"(?:[^"\\]|\\[\s\S])*"/g)?.length, 6);
    assert.ok(Object.values(value).every((v) => typeof v === 'string'));
    assert.match(value.appendPassword, /^[a-f0-9]{64}$/);
    assert.match(value.clientSecret, /^[^\r\n\0]{1,4096}$/);
    const database = new URL(value.databaseUrl);
    assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
    assert.equal(database.username, 'insignia_runtime');
    assert.ok(database.password && !database.hash);
    assert.equal(database.hostname, 'insignia-rewrite-m5-019-database');
    assert.equal(database.port, '5432');
    assert.equal(database.pathname, '/insignia_rewrite');
    assert.deepEqual([...database.searchParams], [['sslmode', 'disable']]);
    return value;
  } finally {
    bytes.fill(0);
  }
}
