import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePrivatePacket } from '../../scripts/release/private-pipe.mts';
import { privateFile, qualifyVerifierArtifact, readVerifierStartup } from './artifact.mts';

function uid(): number {
  assert(process.getuid);
  return process.getuid();
}
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
let child: ReturnType<typeof spawn> | undefined;
try {
  assert.equal(process.argv.length, 5);
  assert.equal(process.argv[2], '--manifest-sha256');
  assert.equal(process.version, 'v24.21.0');
  assert.equal(await realpath(process.execPath), await realpath(join(root, 'bin/node')));
  const manifestSha256 = process.argv[3],
    profileName = process.argv[4];
  assert(typeof manifestSha256 === 'string' && typeof profileName === 'string');
  await qualifyVerifierArtifact(await realpath(root), manifestSha256);
  const identity = JSON.parse((await privateFile(join(root, 'identity.json'))).toString('utf8'));
  assert.deepEqual(identity, { version: 'insignia-release-verifier-identity-v1', manifestSha256: process.argv[3] });
  const { releaseProfile } = await import('../../scripts/release/profiles.mts');
  releaseProfile(profileName);
  for (const directory of [
    '/var/lib/insignia/verifier',
    '/var/lib/insignia/verifier-auth',
    '/run/insignia/release-verification',
  ]) {
    const info = await lstat(directory);
    assert.ok(info.isDirectory() && info.uid === uid() && (info.mode & 0o777) === 0o700);
    assert.equal(await realpath(directory), directory);
  }
  const startup = await readVerifierStartup('/run/insignia/verifier-startup.json');
  const packet = Buffer.from(JSON.stringify({ ...startup, recordId: randomUUID() }));
  try {
    child = spawn(process.execPath, [join(root, 'scripts/release/serve.mts'), profileName], {
      cwd: root,
      env: {
        HOME: '/var/lib/insignia/verifier-auth',
        PATH: `${root}/bin:/usr/bin:/bin`,
        LANG: 'C.UTF-8',
        TERM: 'dumb',
      },
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    assert(child.stdin);
    child.stdin.on('error', () => {});
    const worker = child;
    assert(worker.stdin);
    const input = worker.stdin;
    const stopped = new Promise<number>((done) => {
      worker.once('error', () => done(1));
      worker.once('exit', (code) => done(code ?? 1));
    });
    for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => worker.kill(signal));
    await writePrivatePacket(input, packet);
    for (const name of ['clientSecret', 'appendPassword', 'databaseUrl']) Reflect.set(startup, name, undefined);
    process.exitCode = await stopped;
  } finally {
    packet.fill(0);
  }
} catch {
  child?.kill('SIGTERM');
  console.error('Insignia independent verifier startup rejected');
  process.exitCode = 1;
}
