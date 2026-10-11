import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const jsonLimit = 1024 * 1024;
const text = (bytes) => bytes.toString('utf8').replace(/\0.*$/s, '');
const octal = (bytes) => {
  const value = text(bytes).trim();
  assert.match(value, /^[0-7]+$/);
  const number = Number.parseInt(value, 8);
  assert.ok(Number.isSafeInteger(number) && number >= 0);
  return number;
};

/** Reads, never extracts, the single-image uncompressed OCI Docker-save format
 * produced by the reviewed image controls. No tag supplies identity. */
export async function qualifyImageArchive({ archive, receipt }) {
  assert.match(receipt.imageId, digestPattern);
  assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(receipt.sizeBytes) && receipt.sizeBytes > 0);
  const handle = await open(archive, 'r');
  const archiveHash = createHash('sha256');
  let offset = 0;
  const entries = new Map();
  try {
    const initial = await handle.stat();
    assert.equal(initial.size, receipt.sizeBytes, 'qualified archive size');
    const read = async (length) => {
      const bytes = Buffer.alloc(length);
      let received = 0;
      while (received < length) {
        const result = await handle.read(bytes, received, length - received, offset + received);
        assert.ok(result.bytesRead > 0, 'truncated archive');
        received += result.bytesRead;
      }
      offset += length;
      archiveHash.update(bytes);
      return bytes;
    };
    let ended = false;
    while (offset < initial.size) {
      const header = await read(512);
      if (header.every((byte) => byte === 0)) {
        ended = true;
        while (offset < initial.size)
          assert.ok(
            (await read(Math.min(65536, initial.size - offset))).every((byte) => byte === 0),
            'nonzero tar trailer',
          );
        break;
      }
      const checksum = octal(header.subarray(148, 156));
      const sum = header.reduce((total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte), 0);
      assert.equal(sum, checksum, 'tar header checksum');
      const name = [text(header.subarray(345, 500)), text(header.subarray(0, 100))].filter(Boolean).join('/');
      assert.ok(
        name && !name.startsWith('/') && !name.split('/').some((part) => part === '..' || part === '.'),
        'unsafe archive member',
      );
      assert.ok(!entries.has(name), 'duplicate archive member');
      const size = octal(header.subarray(124, 136));
      const type = header[156];
      assert.ok(type === 0 || type === 48 || type === 53, 'unsupported archive member type');
      if (type === 53) assert.equal(size, 0, 'directory has content');
      const hash = createHash('sha256');
      const chunks = [];
      let remaining = size;
      while (remaining) {
        const bytes = await read(Math.min(65536, remaining));
        hash.update(bytes);
        if (size <= jsonLimit) chunks.push(bytes);
        remaining -= bytes.length;
      }
      if (size % 512) await read(512 - (size % 512));
      const entry = {
        size,
        digest: `sha256:${hash.digest('hex')}`,
        bytes: size <= jsonLimit ? Buffer.concat(chunks) : null,
      };
      if (type !== 53 && name.startsWith('blobs/sha256/'))
        assert.equal(entry.digest, `sha256:${name.slice('blobs/sha256/'.length)}`, 'blob content digest');
      entries.set(name, entry);
    }
    assert.ok(ended, 'missing tar termination');
    assert.equal(offset, initial.size);
    assert.equal(archiveHash.digest('hex'), receipt.sha256, 'qualified archive hash');
    const final = await handle.stat();
    assert.equal(final.size, initial.size);
    assert.equal(final.mtimeMs, initial.mtimeMs);
    return qualifyImageEntries({ entries, receipt });
  } finally {
    await handle.close();
  }
}

/** Pure linkage control; entries must be obtained from qualified archive bytes. */
export function qualifyImageEntries({ entries, receipt }) {
  const json = (name) => {
    const entry = entries.get(name);
    assert.ok(entry?.bytes && entry.bytes.length <= jsonLimit, 'missing/oversized image JSON');
    assert.equal(
      entry.digest,
      `sha256:${createHash('sha256').update(entry.bytes).digest('hex')}`,
      'JSON content digest',
    );
    assert.equal(entry.size, entry.bytes.length);
    return JSON.parse(entry.bytes.toString('utf8'));
  };
  const blob = (descriptor) => {
    assert.match(descriptor.digest, digestPattern);
    const name = `blobs/sha256/${descriptor.digest.slice(7)}`;
    const entry = entries.get(name);
    assert.ok(entry, 'missing referenced blob');
    assert.equal(entry.digest, descriptor.digest);
    assert.equal(entry.size, descriptor.size);
    if (entry.bytes) {
      assert.equal(entry.bytes.length, descriptor.size);
      assert.equal(
        `sha256:${createHash('sha256').update(entry.bytes).digest('hex')}`,
        descriptor.digest,
        'referenced blob bytes',
      );
    }
    return name;
  };
  assert.deepEqual(json('oci-layout'), { imageLayoutVersion: '1.0.0' });
  const index = json('index.json');
  assert.equal(index.schemaVersion, 2);
  assert.equal(index.manifests.length, 1, 'single exact image required');
  const descriptor = index.manifests[0];
  assert.equal(descriptor.mediaType, 'application/vnd.oci.image.manifest.v1+json');
  const manifest = json(blob(descriptor));
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.mediaType, descriptor.mediaType);
  assert.equal(manifest.config.mediaType, 'application/vnd.oci.image.config.v1+json');
  const config = json(blob(manifest.config));
  assert.ok(manifest.layers.length > 0);
  const layerNames = manifest.layers.map((layer) => {
    assert.equal(layer.mediaType, 'application/vnd.oci.image.layer.v1.tar', 'only qualified uncompressed layer format');
    return blob(layer);
  });
  const classic = json('manifest.json');
  assert.equal(classic.length, 1);
  assert.equal(classic[0].Config, blob(manifest.config));
  assert.deepEqual(classic[0].Layers, layerNames, 'classic and OCI layers must agree');
  assert.equal(config.rootfs.type, 'layers');
  assert.deepEqual(
    config.rootfs.diff_ids,
    manifest.layers.map((layer) => layer.digest),
    'exact uncompressed RootFS linkage',
  );
  assert.equal(receipt.imageId, manifest.config.digest, 'export receipt is exact configuration identity');
  return {
    version: 1,
    archiveSha256: receipt.sha256,
    sizeBytes: receipt.sizeBytes,
    configId: manifest.config.digest,
    manifestId: descriptor.digest,
    config,
    layerIds: config.rootfs.diff_ids,
  };
}

/** Containerd may report manifest ID; classic Docker reports config ID. Both
 * must be proven by this exact archive, never provided as arbitrary aliases. */
export function verifyNativeImageIdentity({ qualified, image }) {
  assert.equal(qualified.version, 1);
  assert.ok(
    image.Id === qualified.configId || image.Id === qualified.manifestId,
    'unknown native immutable image identity',
  );
  assert.equal(image.Architecture, qualified.config.architecture);
  assert.equal(image.Os, qualified.config.os);
  assert.equal(image.RootFS.Type, 'layers');
  assert.deepEqual(image.RootFS.Layers, qualified.layerIds);
  const expected = qualified.config.config;
  const empty = (value) => value === undefined || value === null || (Array.isArray(value) && value.length === 0);
  for (const key of new Set([
    ...Object.keys(expected),
    'User',
    'Cmd',
    'Entrypoint',
    'Env',
    'WorkingDir',
    'Healthcheck',
    'Volumes',
    'ExposedPorts',
    'StopSignal',
    'Shell',
    'OnBuild',
  ])) {
    if (empty(expected[key]) && empty(image.Config[key])) continue;
    assert.deepEqual(image.Config[key], expected[key], `native image Config.${key}`);
  }
  return {
    nativeId: image.Id,
    configId: qualified.configId,
    manifestId: qualified.manifestId,
    archiveSha256: qualified.archiveSha256,
  };
}
