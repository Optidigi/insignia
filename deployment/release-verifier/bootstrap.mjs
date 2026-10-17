import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePrivatePacket } from '../../scripts/m5-runtime/trusted-release-input.mjs';
import { privateFile, qualifyVerifierArtifact, readVerifierStartup } from './artifact.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
let child;
try {
  assert.equal(process.argv.length, 5);
  assert.equal(process.argv[2], '--manifest-sha256');
  assert.equal(process.version, 'v24.21.0');
  assert.equal(await realpath(process.execPath), await realpath(join(root, 'bin/node')));
  await qualifyVerifierArtifact(await realpath(root), process.argv[3]);
  const identity = JSON.parse(await privateFile(join(root, 'identity.json')));
  assert.deepEqual(identity, { version: 'insignia-release-verifier-identity-v1', manifestSha256: process.argv[3] });
  const { releaseProfile } = await import('../../scripts/m5-runtime/release-profile.mjs');
  releaseProfile(process.argv[4]);
  for (const directory of [
    '/var/lib/insignia/verifier',
    '/var/lib/insignia/verifier-auth',
    '/run/insignia/release-verification',
  ]) {
    const info = await lstat(directory);
    assert.ok(info.isDirectory() && info.uid === process.getuid() && (info.mode & 0o777) === 0o700);
    assert.equal(await realpath(directory), directory);
  }
  const startup = await readVerifierStartup('/run/insignia/verifier-startup.json');
  const packet = Buffer.from(JSON.stringify({ ...startup, recordId: randomUUID() }));
  try {
    child = spawn(
      process.execPath,
      [join(root, 'scripts/m5-runtime/release-verification-native.mjs'), process.argv[4]],
      {
        cwd: root,
        env: {
          HOME: '/var/lib/insignia/verifier-auth',
          PATH: `${root}/bin:/usr/bin:/bin`,
          LANG: 'C.UTF-8',
          TERM: 'dumb',
        },
        stdio: ['pipe', 'inherit', 'inherit'],
      },
    );
    child.stdin.on('error', () => {});
    const stopped = new Promise((done) => {
      child.once('error', () => done(1));
      child.once('exit', (code) => done(code ?? 1));
    });
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => child.kill(signal));
    await writePrivatePacket(child.stdin, packet);
    startup.clientSecret = undefined;
    startup.appendPassword = undefined;
    startup.databaseUrl = undefined;
    process.exitCode = await stopped;
  } finally {
    packet.fill(0);
  }
} catch {
  child?.kill('SIGTERM');
  console.error('Insignia independent verifier startup rejected');
  process.exitCode = 1;
}
