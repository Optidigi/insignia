import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { type Header, pack } from 'tar-stream';
import { decodePublicSdkTar, prepareVerifierSdk } from './prepare-verifier-sdk.mts';

async function archive(entries: { header: Partial<Header> & Pick<Header, 'name'>; body?: string }[]) {
  const stream = pack();
  const chunks: Buffer[] = [];
  const collect = (async () => {
    for await (const chunk of stream) {
      assert.ok(Buffer.isBuffer(chunk));
      chunks.push(chunk);
    }
  })();
  for (const entry of entries) stream.entry(entry.header, entry.body ?? '');
  stream.finalize();
  await collect;
  return Buffer.concat(chunks);
}
test('SDK member decoder rejects traversal, links and duplicate files while retaining exact public bytes', async () => {
  const good = await decodePublicSdkTar(await archive([{ header: { name: 'package/data.txt' }, body: 'exact bytes' }]));
  assert.equal(good.get('package/data.txt')?.toString(), 'exact bytes');
  const cases: { header: Partial<Header> & Pick<Header, 'name'>; body?: string }[][] = [
    [{ header: { name: '../escape' }, body: 'x' }],
    [{ header: { name: '/package/escape' }, body: 'x' }],
    [{ header: { name: 'package/link', type: 'symlink', linkname: '/tmp/escape' } }],
    [
      { header: { name: 'package/x' }, body: 'x' },
      { header: { name: 'package/x' }, body: 'y' },
    ],
  ];
  for (const entries of cases) await assert.rejects(decodePublicSdkTar(await archive(entries)));
});
test('SDK preparation rejects unpinned bytes without creating or overwriting destinations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sdk-immutable-'));
  try {
    const input = join(root, 'archive.tgz'),
      target = join(root, 'target'),
      sentinel = join(root, 'sentinel');
    await writeFile(
      input,
      gzipSync(await archive([{ header: { name: 'package/package.json' }, body: '{"version":"4.8.2"}' }])),
    );
    await writeFile(sentinel, 'preserved');
    await symlink(sentinel, target);
    await assert.rejects(prepareVerifierSdk(input, target));
    assert.equal(await readFile(sentinel, 'utf8'), 'preserved');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('actual public pinned SDK extracts exact604 files read-only and refuses reused or symlink destinations', {
  skip: !process.env.INSIGNIA_VERIFIER_SDK_ARCHIVE,
}, async () => {
  const input = process.env.INSIGNIA_VERIFIER_SDK_ARCHIVE;
  assert.ok(input);
  const root = await mkdtemp(join(tmpdir(), 'sdk-public-actual-'));
  try {
    const output = join(root, 'sdk');
    assert.deepEqual(await prepareVerifierSdk(input, output), {
      classification: 'PINNED_PUBLIC_SDK_CODE_EXTRACTED_ONLY',
      members: 604,
      authentication: false,
      installScripts: false,
    });
    const manifestPath = join(output, 'package/package.json');
    const before = await readFile(manifestPath);
    assert.equal((await stat(manifestPath)).mode & 0o777, 0o400);
    await assert.rejects(prepareVerifierSdk(input, output));
    const link = join(root, 'redirect');
    await symlink(output, link);
    await assert.rejects(prepareVerifierSdk(input, link));
    assert.deepEqual(await readFile(manifestPath), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
