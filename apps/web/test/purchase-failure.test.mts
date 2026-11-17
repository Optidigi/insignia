import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AdminOnlineIdentityError } from '@insignia/shopify';
import { handlePurchaseRequest } from '../src/server/purchase/http.ts';
import { actorFixture } from './http-fixtures.mts';

type Services = NonNullable<Parameters<typeof handlePurchaseRequest>[1]>;
const secret = 'password=SECRET-9f2c for alpha.myshopify.com gid://shopify/Order/10485042479387';
const purchaseId = '9f959f81-f169-4848-a190-0b0059db8888';
const reader = () =>
  actorFixture({ tenantShopId: 'tenant-secret', canReadOrders: true, canReadArtwork: true, canUploadArtwork: true });

function services(input: {
  statistics?: () => Promise<unknown>;
  authenticate?: () => Promise<ReturnType<typeof reader> | null>;
  recordAdminFailure?: (failure: unknown) => void;
}): Services {
  return {
    appOrigin: 'https://app.example',
    authenticate: input.authenticate ?? (async () => reader()),
    statistics: input.statistics ?? (async () => ({})),
    recordAdminFailure: input.recordAdminFailure,
  } as unknown as Services;
}
const statistics = () =>
  new Request('https://app.example/api/purchases/v1/statistics', { headers: { Authorization: 'Bearer synthetic' } });
async function snapshot(response: Response) {
  const body = (await response.json()) as Record<string, unknown>;
  return {
    status: response.status,
    headers: [...response.headers],
    body: { ...body, requestId: typeof body.requestId },
  };
}

test('an unexpected purchase failure records one admin failure by safe fields and keeps the same 503', async () => {
  const recorded: unknown[] = [];
  const failing = (recordAdminFailure: (failure: unknown) => void) =>
    services({
      statistics: async () => {
        throw Object.assign(new RangeError(secret), { code: 'ERR_INJECTED_FAILURE' });
      },
      recordAdminFailure,
    });
  const response = await handlePurchaseRequest(
    statistics(),
    failing((failure) => recorded.push(failure)),
    'statistics',
  );
  const expected = {
    status: 503,
    headers: [
      ['cache-control', 'private, no-store'],
      ['content-type', 'application/json'],
      ['x-content-type-options', 'nosniff'],
    ],
    body: { code: 'UNAVAILABLE', message: 'Purchase dependency unavailable', requestId: 'string' },
  };
  assert.deepEqual(await snapshot(response), expected);
  assert.equal(recorded.length, 1);
  const failure = recorded[0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(failure).sort(), ['adminRoute', 'errorClass', 'errorCode', 'errorSite', 'httpMethod']);
  assert.equal(failure.adminRoute, 'purchases');
  assert.equal(failure.httpMethod, 'GET');
  assert.equal(failure.errorClass, 'RangeError');
  assert.equal(failure.errorCode, 'ERR_INJECTED_FAILURE');
  assert.match(String(failure.errorSite), /^apps\/web\/test\/purchase-failure\.test\.mts:[1-9][0-9]*$/);
  // A plain error whose message is not a purchase code is unexpected too.
  await handlePurchaseRequest(
    statistics(),
    services({
      statistics: async () => {
        throw new TypeError(secret);
      },
      recordAdminFailure: (value) => recorded.push(value),
    }),
    'statistics',
  );
  assert.equal(recorded.length, 2);
  assert.equal((recorded[1] as Record<string, unknown>).errorClass, 'TypeError');
  assert.doesNotMatch(JSON.stringify(recorded), /SECRET|myshopify|gid:|10485042479387|synthetic|tenant-secret/i);

  const still = await handlePurchaseRequest(
    statistics(),
    failing(() => {
      throw new Error('recorder down');
    }),
    'statistics',
  );
  assert.deepEqual(await snapshot(still), expected);
});

test('handled purchase outcomes, including classified and authentication failures, are not recorded', async () => {
  const recorded: unknown[] = [];
  const recordAdminFailure = (failure: unknown) => recorded.push(failure);
  const status = async (
    thrown: unknown,
    authenticate?: () => Promise<ReturnType<typeof reader> | null>,
    request = statistics(),
  ) =>
    (
      await handlePurchaseRequest(
        request,
        services({
          statistics: async () => {
            throw thrown;
          },
          ...(authenticate ? { authenticate } : {}),
          recordAdminFailure,
        }),
        'statistics',
      )
    ).status;
  // The purchase service's own message-classified errors keep their status and are handled.
  for (const [message, expected] of [
    ['UNAVAILABLE', 503],
    ['SEARCH_UNAVAILABLE', 503],
    ['SEARCH_INCOMPLETE', 503],
    ['STORE_CALENDAR_UNAVAILABLE', 503],
    ['UNSUPPORTED_CURRENCY', 503],
    ['NOT_FOUND', 404],
    ['ARTWORK_UNAVAILABLE', 410],
  ] as const)
    assert.equal(await status(new Error(message)), expected);
  for (const [code, expected] of [
    ['CONFLICT', 409],
    ['LOCKED', 409],
    ['MERCHANT_REQUIRED', 403],
    ['UNAVAILABLE', 503],
  ] as const)
    assert.equal(await status(Object.assign(new Error(secret), { code })), expected);
  // Authentication failures are observed by admin_authentication, not as unexpected failures.
  const throwing = (error: unknown) => async () => {
    throw error;
  };
  assert.equal(await status(null, throwing(new Error(secret))), 503);
  assert.equal(await status(null, throwing(new AdminOnlineIdentityError('ONLINE_EXCHANGE_FAILED'))), 503);
  assert.equal(await status(null, throwing(new AdminOnlineIdentityError('ONLINE_EXCHANGE_REFRESH_REQUIRED'))), 401);
  assert.equal(await status(null, throwing(Object.assign(new Error('Shopify throttled'), { transient: true }))), 409);
  assert.equal(await status(null, async () => null), 401);
  assert.equal(await status(null, async () => actorFixture({})), 403);
  assert.equal(await status(null, undefined, new Request('https://app.example/api/purchases/v1/statistics')), 401);
  assert.equal(
    await status(
      null,
      undefined,
      new Request('https://app.example/api/purchases/v1/statistics?x=1', {
        headers: { Authorization: 'Bearer synthetic' },
      }),
    ),
    400,
  );
  assert.equal(
    (await handlePurchaseRequest(statistics(), services({ recordAdminFailure }), `${purchaseId}/nothing/x/y/z`)).status,
    404,
  );
  assert.equal((await handlePurchaseRequest(statistics(), undefined, 'statistics')).status, 503);
  assert.deepEqual(recorded, []);
});
