import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { qualifyVerifierArtifact, readVerifierStartup } from './runtime-boundaries.mts';
import { jsonRecord, requiredEnv } from './validation.mts';

const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('relocated immutable verifier qualifies exact reviewed bytes without git and rejects tamper or omitted code', async () => {
  const root = await mkdtemp(join(tmpdir(), 'insignia-verifier-artifact-'));
  try {
    await mkdir(join(root, 'scripts'), { mode: 0o700 });
    await writeFile(join(root, 'scripts/receiver.mjs'), 'export {};', { mode: 0o400 });
    const manifest = {
      version: 'insignia-release-verifier-artifact-v1',
      sourceHead: '1'.repeat(40),
      sourceTree: '2'.repeat(40),
      nodeVersion: 'v24.21.0',
      files: { 'scripts/receiver.mjs': { kind: 'file', mode: 0o400, sha256: sha('export {};') } },
    };
    const bytes = JSON.stringify(manifest);
    await writeFile(join(root, 'manifest.json'), bytes, { mode: 0o600 });
    assert.equal((await qualifyVerifierArtifact(root, sha(bytes))).sourceTree, '2'.repeat(40));
    await assert.rejects(qualifyVerifierArtifact(root, '3'.repeat(64)));
    const wrongVersion = JSON.stringify({ ...manifest, version: 'unreviewed-v2' });
    await writeFile(join(root, 'manifest.json'), wrongVersion);
    await assert.rejects(qualifyVerifierArtifact(root, sha(wrongVersion)));
    await writeFile(join(root, 'manifest.json'), bytes);
    await chmod(join(root, 'scripts/receiver.mjs'), 0o600);
    await writeFile(join(root, 'scripts/receiver.mjs'), 'tampered');
    await chmod(join(root, 'scripts/receiver.mjs'), 0o400);
    await assert.rejects(qualifyVerifierArtifact(root, sha(bytes)));
    await rm(join(root, 'scripts/receiver.mjs'));
    await assert.rejects(qualifyVerifierArtifact(root, sha(bytes)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('verifier startup accepts only private exact-role configuration, never arbitrary targets, extra authority or weak modes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'insignia-verifier-private-'));
  try {
    const path = join(root, 'startup.json');
    const config = {
      databaseUrl:
        'postgres://insignia_runtime:synthetic@insignia-rewrite-m5-019-database:5432/insignia_rewrite?sslmode=disable',
      clientSecret: 'synthetic',
      appendPassword: 'a'.repeat(64),
    };
    await writeFile(path, JSON.stringify(config), { mode: 0o600 });
    assert.deepEqual(await readVerifierStartup(path), config);
    for (const value of [
      { ...config, databaseUrl: config.databaseUrl.replace('insignia_runtime', 'insignia_rewrite') },
      { ...config, databaseUrl: config.databaseUrl.replace('insignia-rewrite-m5-019-database', 'example.com') },
      { ...config, arbitrarySource: 'self-asserted' },
    ]) {
      await writeFile(path, JSON.stringify(value));
      await assert.rejects(readVerifierStartup(path));
    }
    await writeFile(path, JSON.stringify(config));
    await chmod(path, 0o644);
    await assert.rejects(readVerifierStartup(path));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('actual packaged collector relocates with pinned SDK and production dependencies without git or authentication', {
  skip:
    (!process.env.M5_WORKER_PACKAGE_ENTRY || !process.env.INSIGNIA_VERIFIER_SDK_ARCHIVE) &&
    'Actual portable worker and public pinned SDK are supplied by runtime CI',
}, async () => {
  const { packageVerifier } = await import('./package-release-verifier.mts');
  const { spawnSync } = await import('node:child_process');
  const { rename, readFile } = await import('node:fs/promises');
  const scratch = await mkdtemp(join(tmpdir(), 'insignia-verifier-package-'));
  try {
    const original = join(scratch, 'original'),
      relocated = join(scratch, 'relocated');
    const receipt = await packageVerifier({
      workerPackage: join(requiredEnv('M5_WORKER_PACKAGE_ENTRY'), '../..'),
      sdkArchive: requiredEnv('INSIGNIA_VERIFIER_SDK_ARCHIVE'),
      destination: original,
      sourceHead: '1'.repeat(40),
      sourceTree: '2'.repeat(40),
    });
    await rename(original, relocated);
    const probe = spawnSync(
      join(relocated, 'bin/node'),
      [
        '--input-type=module',
        '-e',
        `import assert from 'node:assert/strict';
         import {readFile} from 'node:fs/promises';
         import http from 'node:http';
         import https from 'node:https';
         import {syncBuiltinESMExports} from 'node:module';
         const deny=()=>{throw Error('offline SDK import cannot access network')};
         // The pinned SDK loads its embedded Yoga WASM through a data URI.
         // Decode those local bytes ourselves; every actual network URL stays denied.
         globalThis.fetch=(url)=>{
           if(typeof url!=='string'||!/^data:application\\/octet-stream;base64,[A-Za-z0-9+/]+={0,2}$/.test(url))return deny();
           return Promise.resolve(new Response(Buffer.from(url.slice(url.indexOf(',')+1),'base64')));
         };
         http.request=deny;http.get=deny;https.request=deny;https.get=deny;
         syncBuiltinESMExports();
         for(const url of ['https://example.invalid','http://example.invalid','file:///etc/passwd',new URL('https://example.invalid')])
           assert.throws(()=>fetch(url),/cannot access network/);
         const {qualifyLaunchInputs}=await import('./scripts/m5-runtime/trusted-release-launch.mjs');
         const identity=JSON.parse(await readFile('identity.json','utf8'));
         const result=await qualifyLaunchInputs(identity);
         const sdk = await import('./sdk/package/dist/chunk-MJ3WNVMQ.js');
         await import('./sdk/package/dist/chunk-NYHGIWKZ.js');
         const {existingClient} = await import('./sdk/existing-session-qualification/client.mjs');
         let authenticationCalls=0;
         const seeded=await existingClient({
           authenticate:async(options)=>{
             assert.deepEqual(options,{noPrompt:true});authenticationCalls++;
             return {appManagementToken:'synthetic-offline-token',businessPlatformToken:'synthetic-offline-business',userId:'synthetic-offline-user'};
           },
           getClient:sdk.z,
         });
         assert.equal(authenticationCalls,1);
         assert.equal(sdk.z(),seeded);
         await import('./scripts/m5-runtime/trusted-release-management-worker.mjs');
         console.log(JSON.stringify({sourceTree:result.reviewedTree,sdkImports:'OFFLINE_IMPORT_ONLY_NOT_AUTHENTICATED'}));`,
      ],
      {
        cwd: relocated,
        env: { PATH: '/usr/bin:/bin', HOME: join(scratch, 'empty-auth') },
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    assert.equal(probe.status, 0, probe.stderr);
    assert.equal(jsonRecord(probe.stdout).sourceTree, '2'.repeat(40));
    assert.equal(jsonRecord(probe.stdout).sdkImports, 'OFFLINE_IMPORT_ONLY_NOT_AUTHENTICATED');
    const identity = jsonRecord(await readFile(join(relocated, 'identity.json'), 'utf8'));
    assert.equal(identity.manifestSha256, receipt.manifestSha256);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
