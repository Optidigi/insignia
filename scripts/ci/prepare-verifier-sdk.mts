/** Validate/extract only the public pinned SDK code archive. No install/auth/network operation. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { extract } from 'tar-stream';
import { jsonRecord } from './validation.mts';

const sdkDigest = '0b1c01d1ebf1f1265826a4ffa78ea94bc4c2eb8a36beb9b2f5fb305ef30231ff';
/** Decode without filesystem effects; the extraction entrypoint separately requires the immutable archive digest. */
export async function decodePublicSdkTar(bytes: Buffer): Promise<Map<string, Buffer>> {
  assert.ok(bytes.length < 110_000_000, 'SDK tar exceeds bound');
  const stream = extract();
  const members = new Map<string, Buffer>();
  let total = 0,
    count = 0;
  const consume = (async () => {
    try {
      for await (const entry of stream) {
        const header = entry.header,
          name = header.name;
        assert.ok(
          ++count < 10000 &&
            !isAbsolute(name) &&
            !name.includes('\\') &&
            !name.includes('\0') &&
            !name.split('/').includes('..') &&
            name.split('/')[0] === 'package',
          'Unsafe SDK path',
        );
        assert.ok(header.type === 'file' || header.type === 'directory', 'Only SDK files/directories supported');
        if (header.type === 'directory') {
          entry.resume();
          continue;
        }
        const size = header.size;
        assert.ok(typeof size === 'number' && Number.isSafeInteger(size) && size >= 0 && size < 20_000_000);
        total += size;
        assert.ok(total < 100_000_000 && !members.has(posix.normalize(name)), 'SDK size or duplicate member');
        const chunks: Buffer[] = [];
        let received = 0;
        for await (const chunk of entry) {
          assert.ok(Buffer.isBuffer(chunk));
          received += chunk.length;
          assert.ok(received <= size);
          chunks.push(chunk);
        }
        assert.equal(received, size);
        members.set(posix.normalize(name), Buffer.concat(chunks));
      }
    } catch (error) {
      stream.destroy(error instanceof Error ? error : new Error('SDK decoding failed'));
      throw error;
    }
  })();
  await Promise.all([pipeline(Readable.from(bytes), stream), consume]);
  return members;
}
export async function prepareVerifierSdk(archive: string, destination: string) {
  const bytes = await readFile(archive);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), sdkDigest, 'Unpinned SDK archive');
  const members = await decodePublicSdkTar(gunzipSync(bytes, { maxOutputLength: 110_000_000 }));
  assert.equal(members.size, 604);
  const manifest = members.get('package/package.json');
  assert.ok(manifest);
  assert.equal(jsonRecord(manifest.toString('utf8')).version, '4.8.2');
  const output = resolve(destination);
  assert.equal(await realpath(dirname(output)), dirname(output), 'Destination parent must not redirect extraction');
  await mkdir(output, { mode: 0o700 }); // Existing files, directories and symlinks all fail.
  assert.equal(await realpath(output), output, 'Destination ancestors must not redirect extraction');
  for (const [name, body] of members) {
    const path = join(output, name),
      parent = dirname(path);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    assert.equal(await realpath(parent), parent, 'SDK directory must not be a symlink');
    assert.ok((await lstat(parent)).isDirectory());
    const file = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o400,
    );
    try {
      await file.writeFile(body);
    } finally {
      await file.close();
    }
  }
  return {
    classification: 'PINNED_PUBLIC_SDK_CODE_EXTRACTED_ONLY',
    members: 604,
    authentication: false,
    installScripts: false,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 4);
  assert.ok(process.argv[2] && process.argv[3]);
  console.log(JSON.stringify(await prepareVerifierSdk(process.argv[2], process.argv[3])));
}
