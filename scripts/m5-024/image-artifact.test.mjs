import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { exportWorkerImage } from './image-artifact.mjs';
import { runImageCommand } from './image-observations.mjs';

test('configured image export records the exact saved bytes and qualified source identity', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'm5-image-artifact-'));
  const directory = join(temporary, 'artifact');
  try {
    const receipt = await exportWorkerImage({
      directory,
      sourceHead: 'qualified-head',
      sourceTree: 'qualified-tree',
      imageId: 'sha256:qualified-image',
      async run(args, options) {
        assert.deepEqual(args, [
          'image',
          'save',
          '--output',
          join(directory, 'worker-image.tar'),
          'sha256:qualified-image',
        ]);
        const child = await runImageCommand(
          process.execPath,
          ['-e', "require('node:fs').writeFileSync(process.argv[1], 'abc')", args[3]],
          options,
        );
        assert.equal(child.code, 0);
      },
    });
    assert.deepEqual(receipt, {
      sourceHead: 'qualified-head',
      sourceTree: 'qualified-tree',
      imageId: 'sha256:qualified-image',
      file: 'worker-image.tar',
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      sizeBytes: 3,
    });
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8')), receipt);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('save and hash failures reject export and remove incomplete deployment artifacts', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'm5-image-artifact-failure-'));
  try {
    for (const failure of ['save', 'hash']) {
      const directory = join(temporary, failure);
      await assert.rejects(
        exportWorkerImage({
          directory,
          imageId: 'sha256:qualified-image',
          async run(args, options) {
            const child = await runImageCommand(
              process.execPath,
              [
                '-e',
                failure === 'save'
                  ? "require('node:fs').writeFileSync(process.argv[1], 'partial'); process.exit(7)"
                  : 'process.exit(0)',
                args[3],
              ],
              options,
            );
            assert.equal(child.code, 0, 'save child failed');
          },
        }),
        failure === 'save' ? /save child failed/ : { code: 'ENOENT' },
      );
      await assert.rejects(stat(directory), { code: 'ENOENT' });
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
