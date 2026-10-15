import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createObservability } from '@insignia/observability';
import { createWorkerHealthServer } from '../dist/health.js';

const bytes = Buffer.from('catalog-source');
const preview = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function result(source) {
  return {
    version: 'm6-inspection-v1',
    mimeType: 'image/png',
    width: 600,
    height: 800,
    originalSha256: createHash('sha256').update(source).digest('hex'),
    previewMimeType: 'image/png',
    preview,
  };
}
async function fixture(inspect, ready = true) {
  const directory = await mkdtemp(join(tmpdir(), 'insignia-preview-transport-'));
  await chmod(directory, 0o700);
  const socketPath = join(directory, 'inspection.sock');
  const server = createWorkerHealthServer({
    observability: createObservability(),
    isDurableReady: () => true,
    artworkReadiness: () => ({ ready }),
    inspectMerchantPreview: inspect,
  });
  await server.listenArtworkSocket(socketPath);
  return {
    server,
    socketPath,
    close: async () => {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
test('private catalog inspection returns the exact inspected identity without exposing a TCP route', async () => {
  const f = await fixture(async (source) => {
    assert.deepEqual(source, bytes);
    return result(source);
  });
  try {
    const { request } = await import('node:http');
    const received = await new Promise((resolve, reject) => {
      const req = request(
        {
          socketPath: f.socketPath,
          method: 'POST',
          path: '/merchant-preview-inspect',
          headers: { 'content-type': 'application/octet-stream', 'content-length': bytes.length },
        },
        (res) => {
          const chunks = [];
          res.on('data', (b) => chunks.push(b));
          res.on('end', () =>
            resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString() || 'null') }),
          );
        },
      );
      req.on('error', reject);
      req.end(bytes);
    });
    assert.equal(received.status, 200);
    assert.equal(received.body.originalSha256, 'd8a1d9b5355dd98a1227f001bd31ebee8940ca74f352046163a5839fdbe37331');
    assert.equal(received.body.preview, 'iVBORw0KGgo=');
  } finally {
    await f.close();
  }
});

test('public client binds response to captured bytes, enforces private ownership and never follows redirects', async () => {
  const { inspectArtworkPrivately } = await import('../dist/artwork/inspection-client.js');
  const f = await fixture(async (source) => result(source));
  try {
    const source = Buffer.from(bytes);
    const pending = inspectArtworkPrivately(f.socketPath, source);
    source.fill(0);
    assert.equal((await pending).originalSha256, 'd8a1d9b5355dd98a1227f001bd31ebee8940ca74f352046163a5839fdbe37331');
    await chmod(f.socketPath, 0o666);
    await assert.rejects(inspectArtworkPrivately(f.socketPath, bytes), { code: 'UNAVAILABLE' });
    await chmod(f.socketPath, 0o600);
    await assert.rejects(inspectArtworkPrivately('https://example.com/inspection', bytes), { code: 'UNAVAILABLE' });
    await assert.rejects(inspectArtworkPrivately(f.socketPath, Buffer.alloc(5 * 1024 * 1024 + 1)), {
      code: 'REJECTED',
    });
    const origin = await f.server.listen(0);
    const reply = await fetch(`${origin}/merchant-preview-inspect`, { method: 'POST', body: bytes });
    assert.equal(reply.status, 404);
  } finally {
    await f.close();
  }
});

async function raw(
  socketPath,
  { path = '/merchant-preview-inspect', method = 'POST', body = bytes, headers = {} } = {},
) {
  const { request } = await import('node:http');
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path,
        method,
        agent: false,
        headers: { 'content-type': 'application/octet-stream', 'content-length': body.length, ...headers },
      },
      (res) => {
        res.resume();
        res.once('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

test('unready, unsupported and oversized requests never reach the decoder; private metrics remain inaccessible', async () => {
  let calls = 0;
  const f = await fixture(async (source) => {
    calls++;
    return result(source);
  });
  try {
    assert.equal(await raw(f.socketPath, { headers: { 'content-type': 'application/json' } }), 415);
    assert.equal(await raw(f.socketPath, { headers: { 'content-encoding': 'gzip' } }), 415);
    assert.equal(await raw(f.socketPath, { headers: { 'content-length': 5 * 1024 * 1024 + 1 } }), 413);
    assert.equal(await raw(f.socketPath, { body: Buffer.alloc(0) }), 400);
    assert.equal(await raw(f.socketPath, { path: '/metrics', method: 'GET' }), 404);
    assert.equal(calls, 0);
  } finally {
    await f.close();
  }
  // A readiness-only deployment has no decoder route, even when its readiness is healthy.
  const unready = await fixture(async () => {
    calls++;
    return result(bytes);
  }, false);
  try {
    assert.equal(await raw(unready.socketPath), 503);
    assert.equal(calls, 0);
  } finally {
    await unready.close();
  }
  const missing = await fixture(undefined);
  try {
    assert.equal(await raw(missing.socketPath), 503);
  } finally {
    await missing.close();
  }
});

test('one in-flight decoder owns its slot after client cancellation until settlement; shutdown awaits it', {
  timeout: 5000,
}, async () => {
  const { inspectArtworkPrivately } = await import('../dist/artwork/inspection-client.js');
  let entered, release, signal;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const f = await fixture(async (source, options) => {
    calls++;
    signal = options.signal;
    entered();
    await wait;
    return result(source);
  });
  const controller = new AbortController();
  const first = inspectArtworkPrivately(f.socketPath, bytes, { signal: controller.signal });
  try {
    await started;
    await assert.rejects(inspectArtworkPrivately(f.socketPath, bytes), { code: 'UNAVAILABLE' });
    controller.abort();
    await assert.rejects(first, { code: 'ABORTED' });
    // Socket close crosses the OS boundary asynchronously.
    if (!signal.aborted) await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    await assert.rejects(inspectArtworkPrivately(f.socketPath, bytes), { code: 'UNAVAILABLE' });
    let closed = false;
    const closing = f.server.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closed, false);
    assert.equal(calls, 1);
    release();
    await closing;
  } finally {
    release();
    await f.close();
  }
});

test('bad or substituted results refuse and rejected input stays distinct from unavailable infrastructure', async () => {
  const { inspectArtworkPrivately } = await import('../dist/artwork/inspection-client.js');
  const { ArtworkInspectionError } = await import('../dist/artwork/errors.js');
  let mode = 'digest';
  const f = await fixture(async (source) => {
    if (mode === 'rejected') throw new ArtworkInspectionError('REJECTED', 'private diagnostic must not leak');
    if (mode === 'unavailable') throw new Error('private credential must not leak');
    const r = result(source);
    if (mode === 'digest') r.originalSha256 = 'a'.repeat(64);
    if (mode === 'dimensions') r.width = 12001;
    if (mode === 'preview') r.preview = Buffer.alloc(2 * 1024 * 1024 + 1);
    return r;
  });
  try {
    for (const value of ['digest', 'dimensions', 'preview', 'unavailable', 'rejected']) {
      mode = value;
      await assert.rejects(inspectArtworkPrivately(f.socketPath, bytes), {
        code: value === 'rejected' ? 'REJECTED' : 'UNAVAILABLE',
        message: 'Private inspection unavailable',
      });
    }
  } finally {
    await f.close();
  }
});

test('the client rejects redirected, oversized, truncated and substituted private peer responses without replay', async () => {
  const { createServer } = await import('node:http');
  const { inspectArtworkPrivately } = await import('../dist/artwork/inspection-client.js');
  const directory = await mkdtemp(join(tmpdir(), 'insignia-preview-peer-'));
  await chmod(directory, 0o700);
  const socketPath = join(directory, 'peer.sock');
  let mode = 'redirect';
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    request.resume();
    request.on('end', () => {
      if (mode === 'redirect') return response.writeHead(302, { location: 'https://example.com/' }).end();
      response.setHeader('content-type', 'application/json');
      if (mode === 'oversized') return response.end('x'.repeat(3 * 1024 * 1024 + 1));
      if (mode === 'truncated') {
        response.writeHead(200, { 'content-length': 100 });
        response.end('{}');
        return;
      }
      const value = { ...result(bytes), originalSha256: 'a'.repeat(64), preview: preview.toString('base64') };
      response.end(JSON.stringify(value));
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  await chmod(socketPath, 0o600);
  try {
    for (const value of ['redirect', 'oversized', 'truncated', 'substituted']) {
      mode = value;
      await assert.rejects(inspectArtworkPrivately(socketPath, bytes), { code: 'UNAVAILABLE' });
    }
    assert.equal(requests, 4);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('a decoder deadline aborts the peer without freeing unresolved work or repeating it', {
  timeout: 16000,
}, async () => {
  const { inspectArtworkPrivately } = await import('../dist/artwork/inspection-client.js');
  let release;
  let signal;
  let calls = 0;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(async (source, options) => {
    calls++;
    signal = options.signal;
    await wait;
    return result(source);
  });
  try {
    await assert.rejects(inspectArtworkPrivately(f.socketPath, bytes), { code: 'UNAVAILABLE' });
    assert.equal(signal.aborted, true);
    await assert.rejects(inspectArtworkPrivately(f.socketPath, bytes), { code: 'UNAVAILABLE' });
    assert.equal(calls, 1);
  } finally {
    release();
    await f.close();
  }
});
