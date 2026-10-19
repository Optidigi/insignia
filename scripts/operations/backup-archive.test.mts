import assert from 'node:assert/strict';
import { createWriteStream, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import test from 'node:test';
import tar from 'tar-stream';

type Headers = Parameters<ReturnType<typeof tar.pack>['entry']>[0];

import { unpackArchive } from './backup-archive.mts';
import { canonicalJSON, fingerprint } from './backup-run.mts';

async function synthetic(path: string, entries: Headers[]): Promise<void> {
  const pack = tar.pack(),
    done = pipeline(pack, createWriteStream(path));
  for (const header of entries) pack.entry(header, Buffer.from(header.type === 'file' ? 'x' : ''));
  pack.finalize();
  await done;
}
test('legacy Python PAX archives retain long Unicode identities and exact original bytes', async () => {
  const root = mkdtempSync('/dev/shm/insignia-pax-');
  try {
    const archive = new URL('./backup-legacy-pax.fixture.tar', import.meta.url).pathname,
      names = await unpackArchive(archive);
    assert.equal(names.size, 3);
    await unpackArchive(archive, root);
    const name = [...names].find((name) => name.startsWith('objects/'));
    assert(name && name.length > 100 && name.includes('✓'));
    assert.deepEqual(readFileSync(join(root, name)), Buffer.from('original exact bytes\x00\xff', 'latin1'));
    assert.equal(readFileSync(join(root, 'database.dump'), 'utf8'), 'legacy dump');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('archive preflight rejects links, nonfiles, duplicates and traversal before payload extraction', async () => {
  const root = mkdtempSync('/dev/shm/insignia-unsafe-tar-');
  try {
    const cases: Headers[][] = [
      [{ name: 'objects/../escape', type: 'file' }],
      [{ name: '/objects/absolute', type: 'file' }],
      [{ name: 'objects/x', type: 'symlink', linkname: '/etc/passwd' }],
      [{ name: 'objects/x', type: 'link', linkname: 'database.dump' }],
      [{ name: 'objects/x', type: 'directory' }],
      [
        { name: 'database.dump', type: 'file' },
        { name: 'database.dump', type: 'file' },
      ],
    ];
    for (const [index, entries] of cases.entries()) {
      const path = join(root, `${index}.tar`),
        destination = join(root, `stage-${index}`);
      mkdirSync(destination, { mode: 0o700 });
      await synthetic(path, entries);
      await assert.rejects(unpackArchive(path), /unsafe archive/);
      assert.deepEqual(readdirSync(destination), []);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('recorded Docker fingerprints preserve Python sorted ASCII JSON bytes including Unicode secrets', () => {
  const row = {
    Id: 'a'.repeat(64),
    Name: '/insignia-production-web',
    Image: `sha256:${'b'.repeat(64)}`,
    Config: { Labels: { z: '✓', Z: 'Upper', a: 'lower' }, Env: ['SYNTHETIC=€\x7f'] },
    HostConfig: {},
    Mounts: [],
  };
  assert.equal(canonicalJSON({ '2': 'two', '10': 'ten' }), '{"10":"ten","2":"two"}');
  assert.equal(fingerprint(row), 'cab22e18f0719738c5571a745872e77fed9634b46393ed4d47ffbd1e09e784c6');
});
