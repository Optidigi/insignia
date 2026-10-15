import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createArtworkUpload } from '../../src/islands/artwork-upload.ts';

test('private direct upload completes before polling and exposes only verified raster preview', async () => {
  const steps = [];
  let reads = 0;
  const api = async (path, _init) => {
    steps.push(path);
    if (path === '/api/artwork')
      return {
        assetId: 'a',
        upload: { url: 'https://private.example/quarantine', headers: { 'content-type': 'image/svg+xml' } },
        expiresAt: '2099-01-01T00:00:00Z',
      };
    if (path.endsWith('complete')) return { state: 'QUEUED' };
    if (path.endsWith('status'))
      return { state: ++reads === 1 ? 'INSPECTING' : 'USABLE', expiresAt: '2099-01-01T00:00:00Z' };
    return { url: 'https://private.example/previews/a.png', width: 20, height: 10, expiresAt: '2099-01-01T00:00:00Z' };
  };
  const flow = createArtworkUpload({
    api,
    put: async (url, init) => {
      assert.equal(url, 'https://private.example/quarantine');
      assert.equal(init.credentials, 'omit');
      assert.equal(new Headers(init.headers).has('Authorization'), false);
      steps.push('PUT');
      return new Response(null, { status: 200 });
    },
    pause: async () => {},
  });
  const result = await flow.upload(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }), () => {});
  assert.deepEqual(steps, [
    '/api/artwork',
    'PUT',
    '/api/artwork/a/complete',
    '/api/artwork/a/status',
    '/api/artwork/a/status',
    '/api/artwork/a/preview',
  ]);
  assert.equal(result.aspectRatio, 2);
});
test('oversize, inspection rejection and cancelled uploads never expose a preview', async () => {
  let calls = 0;
  const flow = createArtworkUpload({
    api: async (path) => {
      calls++;
      return path === '/api/artwork'
        ? { assetId: 'a', upload: { url: 'https://private.example/q', headers: {} } }
        : { state: 'REJECTED', expiresAt: '2099-01-01T00:00:00Z' };
    },
    put: async () => new Response(null, { status: 200 }),
    pause: async () => {},
  });
  await assert.rejects(
    flow.upload(new File([new Uint8Array(5242881)], 'huge.png', { type: 'image/png' }), () => {}),
    /5 MiB/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    flow.upload(new File(['abc'], 'image.png', { type: 'image/png' }), () => {}),
    /rejected/,
  );
  const controller = new AbortController();
  controller.abort();
  const prior = calls;
  await assert.rejects(
    flow.upload(new File(['abc'], 'image.png', { type: 'image/png' }), () => {}, controller.signal),
    { name: 'AbortError' },
  );
  assert.equal(calls, prior);
});

test('expired derivative is renewed for the same retained artwork without uploading again', async () => {
  const calls = [];
  const flow = createArtworkUpload({
    api: async (path) => {
      calls.push(path);
      if (path.endsWith('/status')) return { state: 'USABLE', expiresAt: '2099-01-08T00:00:00Z' };
      return {
        url: 'https://private.example/previews/renewed.png',
        width: 30,
        height: 10,
        expiresAt: '2099-01-01T00:05:00Z',
      };
    },
    put: async () => {
      throw new Error('renewal must never upload');
    },
  });
  const renewed = await flow.renew({
    assetId: 'same-asset',
    url: 'https://private.example/expired.png',
    aspectRatio: 3,
    expiresAt: '2020-01-01T00:00:00Z',
    assetExpiresAt: '2099-01-08T00:00:00Z',
  });
  assert.equal(renewed.assetId, 'same-asset');
  assert.equal(renewed.assetExpiresAt, '2099-01-08T00:00:00Z');
  assert.equal(renewed.url, 'https://private.example/previews/renewed.png');
  assert.deepEqual(calls, ['/api/artwork/same-asset/status', '/api/artwork/same-asset/preview']);
});

test('renewal refuses erased artwork and preserves authorization failures', async () => {
  const asset = {
    assetId: 'retained',
    url: 'https://private.example/old.png',
    aspectRatio: 1,
    expiresAt: '2020-01-01T00:00:00Z',
    assetExpiresAt: '2099-01-08T00:00:00Z',
  };
  let previews = 0;
  const gone = createArtworkUpload({
    api: async (path) => {
      if (path.endsWith('/preview')) previews++;
      return { state: 'DELETED', expiresAt: '2099-01-08T00:00:00Z' };
    },
  });
  await assert.rejects(gone.renew(asset), { status: 410 });
  assert.equal(previews, 0);
  const denied = Object.assign(new Error('Permission removed'), { status: 403 });
  await assert.rejects(
    createArtworkUpload({
      api: async () => {
        throw denied;
      },
    }).renew(asset),
    (error) => error === denied,
  );
});

test('processing timeout retains the completed upload and resumes the same asset without another PUT', async () => {
  let queued = true,
    admissions = 0,
    puts = 0,
    pending;
  const flow = createArtworkUpload({
    api: async (path) => {
      if (path === '/api/artwork') {
        admissions++;
        return {
          assetId: 'retained',
          expiresAt: '2099-01-08T00:00:00Z',
          upload: { url: 'https://private.example/q', headers: {} },
        };
      }
      if (path.endsWith('/status')) return { state: queued ? 'QUEUED' : 'USABLE', expiresAt: '2099-01-08T00:00:00Z' };
      if (path.endsWith('/preview'))
        return {
          url: 'https://private.example/verified.png',
          width: 10,
          height: 10,
          expiresAt: '2099-01-01T00:05:00Z',
        };
      return {};
    },
    put: async () => {
      puts++;
      return new Response(null, { status: 200 });
    },
    pause: async () => {},
    onPending: (value) => {
      pending = value;
    },
  });
  await assert.rejects(
    flow.upload(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }), () => {}),
    /still processing/,
  );
  assert.equal(pending?.assetId, 'retained');
  queued = false;
  const resumed = await flow.resume(pending, () => {});
  assert.equal(resumed.assetId, 'retained');
  assert.equal(admissions, 1);
  assert.equal(puts, 1);
});

test('resuming an acknowledged PUT reconciles an unqueued completion and refuses terminal artwork', async () => {
  const retained = { assetId: 'retained', assetExpiresAt: '2099-01-08T00:00:00Z' };
  const calls = [];
  let completed = false;
  const flow = createArtworkUpload({
    api: async (path) => {
      calls.push(path);
      if (path.endsWith('/complete')) {
        completed = true;
        return {};
      }
      if (path.endsWith('/status'))
        return { state: completed ? 'USABLE' : 'UPLOADING', expiresAt: retained.assetExpiresAt };
      return { url: 'https://private.example/verified.png', width: 10, height: 10, expiresAt: '2099-01-01T00:05:00Z' };
    },
    pause: async () => {},
  });
  assert.equal((await flow.resume(retained, () => {})).assetId, 'retained');
  assert.deepEqual(calls, [
    '/api/artwork/retained/status',
    '/api/artwork/retained/complete',
    '/api/artwork/retained/status',
    '/api/artwork/retained/preview',
  ]);
  for (const [state, status] of [
    ['REJECTED', 422],
    ['DELETED', 410],
    ['DELETING', 410],
  ]) {
    const terminal = createArtworkUpload({
      api: async (path) => {
        assert.ok(path.endsWith('/status'), 'terminal artwork must not complete or obtain a preview');
        return { state, expiresAt: retained.assetExpiresAt };
      },
    });
    await assert.rejects(
      terminal.resume(retained, () => {}),
      { status },
    );
  }
});

test('cancelling a pending resume prevents stale status from obtaining or exposing a preview', async () => {
  const controller = new AbortController();
  let release;
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  let previews = 0;
  const flow = createArtworkUpload({
    api: async (path) => {
      if (path.endsWith('/status')) return delayed;
      previews++;
      return { url: 'https://private.example/stale.png', width: 10, height: 10, expiresAt: '2099-01-01T00:05:00Z' };
    },
  });
  const resumed = flow.resume(
    { assetId: 'old-file', assetExpiresAt: '2099-01-08T00:00:00Z' },
    () => {},
    controller.signal,
  );
  controller.abort();
  release({ state: 'USABLE', expiresAt: '2099-01-08T00:00:00Z' });
  await assert.rejects(resumed, { name: 'AbortError' });
  assert.equal(previews, 0);
});

test('merchant upload and pending completion cross the HTTPS proxy origin gate without relaxing authentication or CSRF', async () => {
  const { createRequire } = await import('node:module');
  const { dirname, join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const { isForbiddenCrossOriginRequest } = await import(
    pathToFileURL(
      join(dirname(createRequire(import.meta.url).resolve('astro/package.json')), 'dist/core/app/origin-check.js'),
    )
  );
  const { handleArtworkRequest } = await import('../../src/server/artwork/http.ts');
  const id = '00000000-0000-4000-8000-000000000001';
  const actor = {
    shop: 'alpha.myshopify.com',
    shopId: 'gid://shopify/Shop/1',
    installationId: 'i',
    tenantShopId: 'tenant-1',
    installationGeneration: '4',
    staffId: 's',
    sessionId: 'ss',
    expiresAtMs: Date.now() + 60000,
    canRead: true,
    canEdit: true,
    canReadArtwork: true,
    canUploadArtwork: true,
  };
  let completionHeaders,
    completed = 0,
    uploading = true;
  const services = {
    appOrigin: 'https://app.example.test',
    authenticate: async () => actor,
    artwork: {
      complete: async () => {
        completed++;
        uploading = false;
        return { state: 'QUEUED' };
      },
    },
  };
  const complete = async (headers, origin = services.appOrigin, authenticated = true) => {
    const request = new Request(`http://app.example.test/api/artwork/${id}/complete`, {
      method: 'POST',
      headers: {
        ...Object.fromEntries(new Headers(headers)),
        Origin: origin,
        ...(authenticated ? { Authorization: 'Bearer synthetic' } : {}),
      },
    });
    assert.equal(await request.clone().text(), '');
    if (isForbiddenCrossOriginRequest(request, new URL(request.url), false)) return new Response(null, { status: 403 });
    return handleArtworkRequest(request, services, { kind: 'complete', audience: 'merchant', assetId: id });
  };
  const flow = createArtworkUpload({
    api: async (path, init) => {
      if (path === '/api/artwork')
        return {
          assetId: id,
          upload: { url: 'https://private.example/quarantine', headers: {} },
          expiresAt: '2099-01-01T00:00:00Z',
        };
      if (path.endsWith('/complete')) {
        completionHeaders = init.headers;
        const response = await complete(init.headers);
        assert.equal(response.status, 202, 'empty JSON completion must reach the authenticated handler behind HTTPS');
        return response.json();
      }
      if (path.endsWith('/status'))
        return { state: uploading ? 'UPLOADING' : 'USABLE', expiresAt: '2099-01-01T00:00:00Z' };
      return { url: 'https://private.example/preview.png', width: 20, height: 10, expiresAt: '2099-01-01T00:00:00Z' };
    },
    put: async () => new Response(null, { status: 200 }),
    pause: async () => {},
  });
  await flow.upload(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }), () => {});
  assert.equal(completed, 1);
  uploading = true;
  await flow.resume({ assetId: id, assetExpiresAt: '2099-01-01T00:00:00Z' }, () => {});
  assert.equal(completed, 2);
  assert.equal((await complete(completionHeaders, 'https://foreign.example')).status, 403);
  assert.equal((await complete(completionHeaders, services.appOrigin, false)).status, 401);
  assert.equal(completed, 2, 'denied callers cannot complete an upload');
});
