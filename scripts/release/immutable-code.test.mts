import assert from 'node:assert/strict';
import test from 'node:test';
import { immutableImageBoundary } from './immutable-code.mts';

const root = '1 0 0:1 / / ro,relatime - overlay overlay ro,lowerdir=/immutable\n';
test('only an unmounted subtree of the read-only image can reuse startup code qualification', () => {
  assert.equal(typeof immutableImageBoundary(root, '/srv/insignia/verifier'), 'string');
  for (const info of [
    root.replace('ro,relatime', 'rw,relatime'),
    root.replace('- overlay', '- ext4'),
    root + '2 1 0:2 /code /srv/insignia/verifier ro - ext4 /host/code ro\n',
    root + '3 1 0:3 /other /srv/insignia/verifier/sdk ro - ext4 /host/sdk ro\n',
  ])
    assert.equal(immutableImageBoundary(info, '/srv/insignia/verifier'), null);
  assert.equal(
    immutableImageBoundary(
      root + '4 1 0:4 /state /var/lib/insignia/verifier rw - ext4 /host/state rw\n',
      '/srv/insignia/verifier',
    ),
    immutableImageBoundary(root, '/srv/insignia/verifier'),
  );
});
