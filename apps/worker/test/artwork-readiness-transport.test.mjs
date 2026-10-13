import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, stat } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createObservability } from '@insignia/observability';
import { ensureArtworkInspectionReady } from '../../web/src/server/artwork/readiness.ts';
import { createWorkerHealthServer } from '../dist/health.js';

function unixGet(socketPath, path) {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

test('private inspection readiness crosses the Unix mount without exposing worker metrics', {
  timeout: 10000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'insignia-inspection-ready-'));
  await chmod(directory, 0o700);
  const socketPath = join(directory, 'inspection.sock');
  let ready = false;
  const server = createWorkerHealthServer({
    observability: createObservability(),
    isDurableReady: () => true,
    artworkReadiness: () => ({ ready }),
  });
  try {
    await server.listenArtworkSocket(socketPath);
    assert.equal((await stat(socketPath)).mode & 0o777, 0o600);
    await assert.rejects(ensureArtworkInspectionReady({ socketPath }));
    ready = true;
    await ensureArtworkInspectionReady({ socketPath });
    assert.equal(await unixGet(socketPath, '/metrics'), 404);
    assert.equal(await unixGet(socketPath, '/ready'), 404);
    await chmod(directory, 0o755);
    await assert.rejects(ensureArtworkInspectionReady({ socketPath }));
  } finally {
    await chmod(directory, 0o700);
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('inspection listener refuses permissive directories and never replaces an existing socket', {
  timeout: 10000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'insignia-inspection-ready-'));
  const socketPath = join(directory, 'inspection.sock');
  const make = () => createWorkerHealthServer({ observability: createObservability(), isDurableReady: () => true });
  const first = make();
  const second = make();
  try {
    await chmod(directory, 0o755);
    await assert.rejects(first.listenArtworkSocket(socketPath));
    await chmod(directory, 0o700);
    await first.listenArtworkSocket(socketPath);
    await assert.rejects(second.listenArtworkSocket(socketPath));
    assert.equal(await unixGet(socketPath, '/artwork-ready'), 503);
  } finally {
    await first.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('unready, redirect, oversized and stalled private responses refuse within the budget', {
  timeout: 10000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'insignia-inspection-ready-'));
  await chmod(directory, 0o700);
  const socketPath = join(directory, 'inspection.sock');
  let mode = 'unready';
  const server = createServer((_request, response) => {
    if (mode === 'stall') return;
    if (mode === 'redirect') {
      response.writeHead(302, { location: 'https://example.com/' }).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(mode === 'oversized' ? JSON.stringify({ ready: true, data: 'x'.repeat(4096) }) : '{"ready":false}');
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  await chmod(socketPath, 0o600);
  try {
    for (const value of ['unready', 'redirect', 'oversized', 'stall']) {
      mode = value;
      await assert.rejects(ensureArtworkInspectionReady({ socketPath }));
    }
    await assert.rejects(ensureArtworkInspectionReady({ socketPath, url: 'http://127.0.0.1/artwork-ready' }));
    await assert.rejects(ensureArtworkInspectionReady({ url: 'https://example.com/artwork-ready' }));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
