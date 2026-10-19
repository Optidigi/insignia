import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ImageEntry } from './image-identity.mts';
import { qualifyImageArchive, qualifyImageEntries, verifyNativeImageIdentity } from './image-identity.mts';
import { number, object, required, text } from './validation.mts';

const hash = (bytes: Buffer) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
function fixture() {
  const entries = new Map<string, ImageEntry>();
  const put = (name: string | null, value: unknown) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
    const digest = hash(bytes);
    const path = name ?? `blobs/sha256/${digest.slice(7)}`;
    entries.set(path, { size: bytes.length, digest, bytes });
    return { digest, size: bytes.length, path };
  };
  const layer = put(null, Buffer.from('exact synthetic uncompressed layer'));
  const config = {
    architecture: 'amd64',
    os: 'linux',
    config: {
      User: 'node',
      Cmd: ['/usr/local/bin/node', '/srv/insignia/worker/dist/main.js'],
      Env: ['NODE_ENV=production'],
      WorkingDir: '/srv/insignia/worker',
    },
    rootfs: { type: 'layers', diff_ids: [layer.digest] },
  };
  const c = put(null, config);
  const m = put(null, {
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: c.digest, size: c.size },
    layers: [{ mediaType: 'application/vnd.oci.image.layer.v1.tar', digest: layer.digest, size: layer.size }],
  });
  put('oci-layout', { imageLayoutVersion: '1.0.0' });
  put('index.json', {
    schemaVersion: 2,
    manifests: [{ mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: m.digest, size: m.size }],
  });
  put('manifest.json', [{ Config: c.path, Layers: [layer.path], RepoTags: ['ignored:mutable'] }]);
  return { entries, receipt: { imageId: c.digest, sha256: 'a'.repeat(64), sizeBytes: 100 }, config, layer, c, m, put };
}
const native = (q: ReturnType<typeof qualifyImageEntries>, id = q.configId) => ({
  Id: id,
  Architecture: q.config.architecture,
  Os: q.config.os,
  RootFS: { Type: 'layers', Layers: q.layerIds },
  Config: structuredClone(object(q.config.config)),
});

test('config and directly linked manifest are the only qualified immutable native identities', () => {
  const f = fixture();
  const q = qualifyImageEntries(f);
  assert.equal(verifyNativeImageIdentity({ qualified: q, image: native(q) }).nativeId, q.configId);
  assert.equal(verifyNativeImageIdentity({ qualified: q, image: native(q, q.manifestId) }).nativeId, q.manifestId);
  assert.throws(
    () => verifyNativeImageIdentity({ qualified: q, image: native(q, `sha256:${'b'.repeat(64)}`) }),
    /unknown native/,
  );
});
for (const key of ['User', 'Cmd', 'Entrypoint', 'Env', 'WorkingDir', 'Healthcheck'])
  test(`changed native ${key} fails closed`, () => {
    const q = qualifyImageEntries(fixture());
    const image = native(q);
    image.Config[key] = key === 'User' ? 'root' : ['changed'];
    assert.throws(() => verifyNativeImageIdentity({ qualified: q, image }), /native image Config/);
  });
test('changed native RootFS, OS or architecture fails closed', () => {
  const q = qualifyImageEntries(fixture());
  for (const mutation of [
    (i: ReturnType<typeof native>) => {
      i.RootFS.Layers = [`sha256:${'b'.repeat(64)}`];
    },
    (i: ReturnType<typeof native>) => {
      i.Os = 'windows';
    },
    (i: ReturnType<typeof native>) => {
      i.Architecture = 'arm64';
    },
  ]) {
    const image = native(q);
    mutation(image);
    assert.throws(() => verifyNativeImageIdentity({ qualified: q, image }));
  }
});
test('changed manifest/config bytes or reference digests fail closed', () => {
  for (const target of ['m', 'c'] as const) {
    const f = fixture();
    required(f.entries.get(f[target].path)).bytes = Buffer.from('{}');
    assert.throws(() => qualifyImageEntries(f));
  }
  const f = fixture();
  f.receipt.imageId = `sha256:${'c'.repeat(64)}`;
  assert.throws(() => qualifyImageEntries(f), /configuration identity/);
});
test('layer descriptor substitution and classic layer disagreement fail closed', () => {
  const f = fixture();
  required(f.entries.get(f.layer.path)).digest = `sha256:${'d'.repeat(64)}`;
  assert.throws(() => qualifyImageEntries(f));
  const second = fixture();
  second.put('manifest.json', [{ Config: second.c.path, Layers: [] }]);
  assert.throws(() => qualifyImageEntries(second), /layers must agree/);
});
function tar(entries: Map<string, ImageEntry>) {
  const output: Buffer[] = [];
  for (const [name, entry] of entries) {
    const h = Buffer.alloc(512);
    h.write(name, 0, 100);
    h.write('0000644\0', 100, 8);
    h.write('0000000\0', 108, 8);
    h.write('0000000\0', 116, 8);
    h.write(`${required(entry.bytes).length.toString(8).padStart(11, '0')}\0`, 124, 12);
    h.write('00000000000\0', 136, 12);
    h.fill(32, 148, 156);
    h[156] = 48;
    h.write('ustar\0', 257, 6);
    h.write('00', 263, 2);
    const sum = h.reduce((a, b) => a + b, 0);
    h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
    output.push(h, required(entry.bytes), Buffer.alloc((512 - (required(entry.bytes).length % 512)) % 512));
  }
  output.push(Buffer.alloc(1024));
  return Buffer.concat(output);
}
test('actual archive SHA/size and every blob byte are qualified, changed layer bytes rejected', async () => {
  const f = fixture();
  const bytes = tar(f.entries);
  const directory = await mkdtemp(join(tmpdir(), 'insignia-identity-'));
  try {
    const archive = join(directory, 'image.tar');
    await writeFile(archive, bytes);
    const receipt = { ...f.receipt, sizeBytes: bytes.length, sha256: hash(bytes).slice(7) };
    const q = await qualifyImageArchive({ archive, receipt });
    assert.equal(q.manifestId, f.m.digest);
    await assert.rejects(
      qualifyImageArchive({ archive, receipt: { ...receipt, sha256: 'b'.repeat(64) } }),
      /archive hash/,
    );
    await assert.rejects(
      qualifyImageArchive({ archive, receipt: { ...receipt, sizeBytes: receipt.sizeBytes + 1 } }),
      /archive size/,
    );
    required(f.entries.get(f.layer.path)).bytes = Buffer.from('changed synthetic layer bytes');
    const altered = tar(f.entries);
    await writeFile(archive, altered);
    await assert.rejects(
      qualifyImageArchive({
        archive,
        receipt: { ...receipt, sizeBytes: altered.length, sha256: hash(altered).slice(7) },
      }),
      /blob content digest/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('qualified native worker export links receipt config to exact OCI manifest without Docker', {
  skip: !process.env.M5_IMAGE_ARTIFACT_DIR,
}, async () => {
  const dir = required(process.env.M5_IMAGE_ARTIFACT_DIR);
  const rawReceipt = object(JSON.parse(await readFile(join(dir, 'receipt.json'), 'utf8')));
  const receipt = {
    imageId: text(rawReceipt.imageId),
    sha256: text(rawReceipt.sha256),
    sizeBytes: number(rawReceipt.sizeBytes),
    file: text(rawReceipt.file),
  };
  const q = await qualifyImageArchive({ archive: join(dir, receipt.file), receipt });
  assert.equal(q.configId, receipt.imageId);
  assert.equal(object(q.config.config).User, 'node');
  assert.deepEqual(object(q.config.config).Cmd, ['/usr/local/bin/node', '/srv/insignia/worker/dist/main.js']);
  assert.equal(verifyNativeImageIdentity({ qualified: q, image: native(q, q.manifestId) }).configId, receipt.imageId);
});
