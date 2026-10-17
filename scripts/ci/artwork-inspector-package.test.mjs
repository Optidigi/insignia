import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { packageInspector } from './package-artwork-inspector.mjs';

const identity = { sourceHead: '1'.repeat(40), sourceTree: '2'.repeat(40) };
async function fixture(parent) {
  const worker = join(parent, 'worker');
  await mkdir(join(worker, 'dist/artwork'), { recursive: true });
  await mkdir(join(worker, 'node_modules/decoder'), { recursive: true });
  await writeFile(join(worker, 'package.json'), JSON.stringify({ name: '@insignia/worker', type: 'module' }));
  await writeFile(
    join(worker, 'dist/artwork-main.js'),
    "throw new Error('must not start DB or storage in verification');\n",
  );
  for (const file of ['sandbox.js', 'child.js', 'isolation-probe.js', 'runtime-mounts.js'])
    await writeFile(join(worker, 'dist/artwork', file), 'export {};\n');
  await writeFile(join(worker, 'node_modules/decoder/index.js'), 'export {};\n');
  await symlink('decoder', join(worker, 'node_modules/alias'));
  return worker;
}

test('digest-bound inspector package relocates and verifies without starting inspection or reading secrets', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'insignia-inspector-package-'));
  try {
    const worker = await fixture(scratch);
    const original = join(scratch, 'original');
    const receipt = await packageInspector({ workerPackage: worker, destination: original, ...identity });
    const relocated = join(scratch, 'relocated');
    await rename(original, relocated);
    const verify = () =>
      spawnSync(
        join(relocated, 'bin/node'),
        [join(relocated, 'start.mjs'), '--manifest-sha256', receipt.manifestSha256, '--verify-only'],
        { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } },
      );
    const result = verify();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).classification, 'INSPECTOR_ARTIFACT_INTEGRITY_PASS_ONLY');
    assert.equal(JSON.parse(result.stdout).inspectionStarted, false);
    const service = await readFile(join(relocated, 'artwork-inspection.service'), 'utf8');
    assert.ok(service.includes(`--manifest-sha256 ${receipt.manifestSha256}`));
    assert.ok(service.includes(`%h/insignia-artwork-releases/${identity.sourceTree}/bin/node`));
    assert.ok(service.includes('EnvironmentFile=%h/.config/insignia/artwork-inspection.env'));
    assert.ok(service.includes('NoNewPrivileges=yes'));
    assert.ok(service.includes('MemoryMax=512M'));
    assert.ok(service.includes('KillMode=control-group'));
    assert.ok(service.includes('Restart=no'));
    assert.ok(!service.includes('docker.sock') && !service.includes('insignia-m8-runtime-20261013'));
    await writeFile(join(relocated, 'artwork-inspection.service'), `${service}\nEnvironment=UNREVIEWED_CONFIG=1\n`);
    assert.notEqual(verify().status, 0, 'rendered service must match the digest-bound template');
    await writeFile(join(relocated, 'artwork-inspection.service'), service);
    await chmod(join(relocated, 'worker/dist/artwork-main.js'), 0o644);
    assert.notEqual(verify().status, 0, 'group/world-readable runtime mode must be rejected');
    await chmod(join(relocated, 'worker/dist/artwork-main.js'), 0o600);
    await writeFile(join(relocated, 'worker/dist/artwork-main.js'), 'throw new Error("SECRET tampered code");');
    await chmod(join(relocated, 'worker/dist/artwork-main.js'), 0o400);
    const rejected = verify();
    assert.notEqual(rejected.status, 0);
    assert.doesNotMatch(rejected.stdout + rejected.stderr, /SECRET/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('inspector packaging refuses credential files and dependencies escaping the portable worker', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'insignia-inspector-invalid-'));
  try {
    const worker = await fixture(scratch);
    await writeFile(join(worker, 'dist/inspection.env'), 'SECRET');
    await assert.rejects(
      packageInspector({ workerPackage: worker, destination: join(scratch, 'secret'), ...identity }),
      /Private file/,
    );
    await rm(join(worker, 'dist/inspection.env'));
    await symlink('/etc/passwd', join(worker, 'node_modules/escape'));
    await assert.rejects(
      packageInspector({ workerPackage: worker, destination: join(scratch, 'escape'), ...identity }),
      /escaped/,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('actual existing portable worker inspector and decoder survive packaging without a checkout', {
  skip: !process.env.M5_WORKER_PACKAGE_ENTRY && 'Existing portable worker package is supplied by runtime CI',
}, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'insignia-inspector-portable-'));
  try {
    const worker = join(process.env.M5_WORKER_PACKAGE_ENTRY, '../..');
    const artifact = join(scratch, 'artifact');
    const receipt = await packageInspector({ workerPackage: worker, destination: artifact, ...identity });
    const result = spawnSync(
      join(artifact, 'bin/node'),
      [join(artifact, 'start.mjs'), '--manifest-sha256', receipt.manifestSha256, '--verify-only'],
      { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } },
    );
    assert.equal(result.status, 0, result.stderr);
    const decoder = spawnSync(
      join(artifact, 'bin/node'),
      [
        '--input-type=module',
        '-e',
        "import sharp from 'sharp'; import {SaxesParser} from 'saxes'; if(!sharp.versions.vips || typeof SaxesParser !== 'function') process.exit(1)",
      ],
      { cwd: join(artifact, 'worker'), encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } },
    );
    assert.equal(decoder.status, 0, decoder.stderr);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
