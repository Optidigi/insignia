import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createObservability } from '@insignia/observability';
import { ensureArtworkInspectionReady } from '../../web/src/server/artwork/readiness.ts';
import { startArtworkInspectionProcess } from '../dist/artwork-process.js';
import { createArtworkRunner } from '../dist/artwork-runner.js';

test('failed private readiness binding does not start artwork processing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'insignia-artwork-process-'));
  await chmod(directory, 0o755);
  let started = 0;
  let processed = 0;
  const runner = {
    ready: true,
    start: async () => {
      started++;
    },
    runOnce: async () => {
      processed++;
    },
    stop: async () => {},
  };
  try {
    await assert.rejects(
      startArtworkInspectionProcess({
        runner,
        socketPath: join(directory, 'inspection.sock'),
        observability: createObservability(),
        cleanup: async () => {},
      }),
    );
    assert.equal(started, 0);
    assert.equal(processed, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('qualified isolated inspection advertises privately and shutdown waits for retention work', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'insignia-artwork-process-'));
  await chmod(directory, 0o700);
  const socketPath = join(directory, 'inspection.sock');
  let ready = false;
  let stopped = false;
  let releaseCleanup;
  const pending = new Promise((resolve) => {
    releaseCleanup = resolve;
  });
  const runner = {
    get ready() {
      return ready;
    },
    start: async () => {},
    runOnce: async () => {
      ready = true;
    },
    stop: async () => {
      stopped = true;
      ready = false;
    },
  };
  const running = await startArtworkInspectionProcess({
    runner,
    socketPath,
    observability: createObservability(),
    cleanup: async () => {
      await pending;
    },
  });
  try {
    await ensureArtworkInspectionReady({ socketPath });
    let settled = false;
    const stop = running.stop().then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(stopped, true);
    assert.equal(settled, false);
    await assert.rejects(ensureArtworkInspectionReady({ socketPath }));
    releaseCleanup();
    await stop;
    assert.equal(settled, true);
  } finally {
    releaseCleanup();
    await running.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('ordinary purchase worker refuses inspection capability before loading database or provider inputs', () => {
  const child = spawnSync(process.execPath, [new URL('../dist/main.js', import.meta.url).pathname], {
    env: { INSIGNIA_ARTWORK_HOST_RUNNER: '1', INSIGNIA_M8_PURCHASE_ENABLED: '1' },
    timeout: 5000,
    encoding: 'utf8',
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /Use the dedicated artwork inspection entrypoint/);
  assert.doesNotMatch(child.stderr, /DATABASE_URL is required/);
});

test('first pending-file failure keeps readiness unavailable while the real runner recovers', {
  timeout: 5000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'insignia-artwork-recovery-'));
  await chmod(directory, 0o700);
  const socketPath = join(directory, 'inspection.sock');
  let recover = false;
  let pending = true;
  let attempts = 0;
  let cleanups = 0;
  const runner = createArtworkRunner({
    inspect: async (bytes) => ({
      version: 'm6-inspection-v1',
      mimeType: 'image/svg+xml',
      width: 16,
      height: 8,
      originalSha256: createHash('sha256').update(bytes).digest('hex'),
      preview: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      previewMimeType: 'image/png',
    }),
    timing: { pollMs: 10, backoffMaxMs: 20 },
    store: { selectPending: async () => (pending ? ['retained-pending-asset'] : []) },
    service: {
      process: async () => {
        attempts++;
        if (!recover) throw new Error('transient object unavailable');
        pending = false;
      },
    },
  });
  let running;
  try {
    running = await startArtworkInspectionProcess({
      runner,
      socketPath,
      observability: createObservability(),
      cleanup: async () => {
        cleanups++;
      },
    });
    assert.equal(runner.ready, false);
    await assert.rejects(ensureArtworkInspectionReady({ socketPath }));
    assert.equal(cleanups, 1);
    recover = true;
    const deadline = Date.now() + 1000;
    while (!runner.ready && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(attempts >= 2);
    assert.equal(pending, false);
    await ensureArtworkInspectionReady({ socketPath });
  } finally {
    await running?.stop();
    await runner.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
