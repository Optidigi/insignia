import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, readFile, readlink, realpath } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

type ArtifactEntry = { kind: 'link'; target: string } | { kind: 'file'; mode: number; sha256: string };
export interface VerifierManifest {
  version: string;
  nodeVersion: string;
  sourceHead: string;
  sourceTree: string;
  files: Record<string, ArtifactEntry>;
}
function record(value: unknown): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'invalid_artifact_record');
  return Object.fromEntries(Object.entries(value));
}
function manifestFrom(value: unknown): VerifierManifest {
  const input = record(value);
  assert.deepEqual(Object.keys(input).sort(), ['files', 'nodeVersion', 'sourceHead', 'sourceTree', 'version']);
  assert(
    typeof input.version === 'string' &&
      typeof input.nodeVersion === 'string' &&
      typeof input.sourceHead === 'string' &&
      typeof input.sourceTree === 'string',
  );
  const files: Record<string, ArtifactEntry> = {};
  for (const [name, value] of Object.entries(record(input.files))) {
    const entry = record(value);
    if (entry.kind === 'link') {
      assert(typeof entry.target === 'string', 'invalid_artifact_link');
      files[name] = { kind: 'link', target: entry.target };
    } else {
      assert(
        entry.kind === 'file' && typeof entry.mode === 'number' && typeof entry.sha256 === 'string',
        'invalid_artifact_file',
      );
      files[name] = { kind: 'file', mode: entry.mode, sha256: entry.sha256 };
    }
  }
  return {
    version: input.version,
    nodeVersion: input.nodeVersion,
    sourceHead: input.sourceHead,
    sourceTree: input.sourceTree,
    files,
  };
}

function uid(): number {
  assert(process.getuid, 'POSIX identity required');
  return process.getuid();
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export async function privateFile(path: string, limit = 16384) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    assert.ok(info.isFile() && info.uid === uid() && (info.mode & 0o777) === 0o600 && info.size <= limit);
    assert.equal(await realpath(path), resolve(path));
    const bytes = await handle.readFile();
    assert.ok(bytes.length <= limit);
    return bytes;
  } finally {
    await handle.close();
  }
}

/** Digest must originate in independently reviewed artifact/deployment provenance, never a web request. */
export async function qualifyVerifierArtifact(root: string, expectedDigest: string) {
  assert.match(expectedDigest, /^[a-f0-9]{64}$/);
  const raw = await privateFile(join(root, 'manifest.json'), 4 * 1024 * 1024);
  assert.equal(hash(raw), expectedDigest, 'verifier_manifest_digest_changed');
  const manifest = manifestFrom(JSON.parse(raw.toString()) as unknown);
  assert.deepEqual(Object.keys(manifest).sort(), ['files', 'nodeVersion', 'sourceHead', 'sourceTree', 'version']);
  assert.equal(manifest.version, 'insignia-release-verifier-artifact-v1');
  assert.equal(manifest.nodeVersion, 'v24.21.0');
  assert.match(manifest.sourceHead, /^[a-f0-9]{40}$/);
  assert.match(manifest.sourceTree, /^[a-f0-9]{40}$/);
  assert.ok(manifest.files && Object.keys(manifest.files).length > 0 && Object.keys(manifest.files).length <= 20000);
  const seen: string[] = [];
  async function walk(directory: string) {
    const d = await lstat(directory);
    assert.ok(d.isDirectory() && d.uid === uid() && (d.mode & 0o777) === 0o700);
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
          assert.equal(expected.kind, 'file');
          assert.ok(info.isFile() && info.uid === uid());
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

export async function readVerifierStartup(path: string) {
  const bytes = await privateFile(path);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      value = record(JSON.parse(text) as unknown);
    assert.deepEqual(Object.keys(value).sort(), ['appendPassword', 'clientSecret', 'databaseUrl']);
    assert.equal(text.match(/"(?:[^"\\]|\\[\s\S])*"/g)?.length, 6);
    assert(
      typeof value.appendPassword === 'string' &&
        typeof value.clientSecret === 'string' &&
        typeof value.databaseUrl === 'string',
    );
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
    return { appendPassword: value.appendPassword, clientSecret: value.clientSecret, databaseUrl: value.databaseUrl };
  } finally {
    bytes.fill(0);
  }
}
