import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handlePreferencesRequest } from '../../src/server/admin/preferences-http.ts';
import { adminActor, adminServices } from './support/fixtures.mts';

const view = {
  version: 'merchant-preferences-v1' as const,
  authority: 'a'.repeat(64),
  shop: 'synthetic.myshopify.com',
  guidanceVersion: '0',
  wordingVersion: '0',
  notificationsVersion: '0',
  notifications: { customerArtworkEmail: true },
  guidance: { dismissed: false, completedSteps: [] },
  overlays: { en: { locale: 'en', messages: {} } },
};
const command = {
  action: 'guidance',
  authority: view.authority,
  expectedVersion: '0',
  guidance: { dismissed: true, completedSteps: ['product'] },
};
const request = (value: unknown = command, headers: Record<string, string> = {}) =>
  new Request('https://app.example/api/admin/preferences', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer online-token',
      Origin: 'https://app.example',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'preferences-command-1',
      ...headers,
    },
    body: JSON.stringify(value),
  });
test('preferences boundary requires verified staff, edit grant and matching origin before any mutation', async () => {
  let writes = 0;
  const preferences = {
    read: async () => view,
    save: async () => {
      writes++;
      return { kind: 'saved' as const, preferences: view };
    },
  };
  const services = adminServices({ authenticate: async () => adminActor(), preferences });
  assert.equal(
    (await handlePreferencesRequest(new Request('https://app.example/api/admin/preferences'), services)).status,
    401,
  );
  assert.equal(
    (await handlePreferencesRequest(request(command, { Origin: 'https://evil.example' }), services)).status,
    403,
  );
  assert.equal(
    (
      await handlePreferencesRequest(
        request(),
        adminServices({ authenticate: async () => adminActor({ canEdit: false }), preferences }),
      )
    ).status,
    403,
  );
  assert.equal(writes, 0);
  assert.equal((await handlePreferencesRequest(request(), services)).status, 200);
  assert.equal(writes, 1);
});
test('preferences cannot select another tenant or smuggle unknown fields and streams are bounded', async () => {
  let writes = 0;
  const services = adminServices({
    authenticate: async () => adminActor(),
    preferences: {
      read: async () => view,
      save: async () => {
        writes++;
        return { kind: 'saved', preferences: view };
      },
    },
  });
  assert.equal(
    (await handlePreferencesRequest(request({ ...command, shop: 'other.myshopify.com' }), services)).status,
    422,
  );
  assert.equal(
    (await handlePreferencesRequest(request({ ...command, canReadPrivacy: true }), services)).status,
    422,
    'Privacy capability is server-derived and never accepted in a merchant command',
  );
  assert.equal(
    (await handlePreferencesRequest(request(command, { 'Content-Length': '256001' }), services)).status,
    422,
  );
  const oversized = new Request('https://app.example/api/admin/preferences', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer online-token',
      Origin: 'https://app.example',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'preferences-command-1',
    },
    body: JSON.stringify({ ...command, extra: 'a'.repeat(256001) }),
  });
  assert.equal((await handlePreferencesRequest(oversized, services)).status, 422);
  assert.equal(writes, 0);
});
test('read-only preference response is private and conflicts remain explicit', async () => {
  const services = adminServices({
    authenticate: async () => adminActor(),
    preferences: { read: async () => view, save: async () => ({ kind: 'conflict', message: 'Changed' }) },
  });
  const read = await handlePreferencesRequest(
    new Request('https://app.example/api/admin/preferences', { headers: { Authorization: 'Bearer online-token' } }),
    services,
  );
  assert.deepEqual(await read.json(), view);
  assert.equal(read.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await handlePreferencesRequest(request(), services)).status, 409);
});
const readRequest = () =>
  new Request('https://app.example/api/admin/preferences', { headers: { Authorization: 'Bearer online-token' } });
test('an unexpected preferences failure is recorded by safe fields only and keeps the same 503', async () => {
  const recorded: unknown[] = [];
  const secret = 'password=SECRET-9f2c for alpha.myshopify.com gid://shopify/Shop/10485042479387';
  const failing = (recordAdminFailure: (failure: unknown) => void) =>
    adminServices({
      authenticate: async () => adminActor(),
      recordAdminFailure,
      preferences: {
        read: async () => {
          throw Object.assign(new RangeError(secret), { code: 'ERR_INJECTED_FAILURE' });
        },
        save: async () => {
          throw new Error(secret);
        },
      },
    });
  const services = failing((failure) => recorded.push(failure));
  const read = await handlePreferencesRequest(readRequest(), services);
  assert.equal(read.status, 503);
  assert.deepEqual(await read.json(), { error: 'Store preferences unavailable' });
  assert.equal(recorded.length, 1);
  const failure = recorded[0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(failure).sort(), ['adminRoute', 'errorClass', 'errorCode', 'errorSite', 'httpMethod']);
  assert.equal(failure.adminRoute, 'preferences');
  assert.equal(failure.httpMethod, 'GET');
  assert.equal(failure.errorClass, 'RangeError');
  assert.equal(failure.errorCode, 'ERR_INJECTED_FAILURE');
  assert.match(String(failure.errorSite), /^apps\/web\/test\/admin\/preferences-http\.test\.mts:[1-9][0-9]*$/);

  const saved = await handlePreferencesRequest(request(), services);
  assert.equal(saved.status, 503);
  assert.deepEqual(await saved.json(), { error: 'Store preferences unavailable' });
  assert.deepEqual(
    { ...(recorded[1] as object), errorSite: undefined },
    { adminRoute: 'preferences', httpMethod: 'POST', errorClass: 'Error', errorSite: undefined },
  );
  assert.doesNotMatch(JSON.stringify(recorded), /SECRET|myshopify|gid:|10485042479387|synthetic|online-token/i);

  const still = await handlePreferencesRequest(
    request(),
    failing(() => {
      throw new Error('recorder down');
    }),
  );
  assert.equal(still.status, 503);
  assert.deepEqual(await still.json(), { error: 'Store preferences unavailable' });
});
test('handled preferences outcomes are not recorded as unexpected failures', async () => {
  const recorded: unknown[] = [];
  const services = adminServices({
    authenticate: async () => adminActor(),
    recordAdminFailure: (failure) => recorded.push(failure),
    preferences: {
      read: async () => {
        throw Object.assign(new Error('Shopify throttled'), { transient: true });
      },
      save: async () => ({ kind: 'conflict', message: 'Changed' }),
    },
  });
  assert.equal((await handlePreferencesRequest(readRequest(), services)).status, 409);
  assert.equal((await handlePreferencesRequest(request({ ...command, extra: true }), services)).status, 422);
  assert.equal((await handlePreferencesRequest(request(), services)).status, 409);
  assert.deepEqual(recorded, []);
});
