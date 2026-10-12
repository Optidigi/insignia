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
