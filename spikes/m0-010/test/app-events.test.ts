import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyAppEventResponse, encodeAppEvent } from '../src/app-events.ts';
import type { AppEvent } from '../src/index.ts';

const event: AppEvent = {
  shop_id: 'gid://shopify/Shop/101', event_handle: 'customized_order_paid',
  timestamp: '2026-05-31T12:00:00.000Z', idempotency_key: 'a'.repeat(64),
  attributes: { value: 1 }
};

test('versioned request carries original time, opaque stable key and only unit value', () => {
  const request = encodeAppEvent(event);
  assert.equal(request.url, 'https://api.shopify.com/app/2026-07/events');
  assert.equal(request.method, 'POST');
  assert.deepEqual(JSON.parse(request.body), event);
  assert.equal(request.body.includes('Order/'), false);
  assert.throws(() => encodeAppEvent({ ...event, idempotency_key: 'a'.repeat(65) }), /idempotency key/);
});

test('HTTP status classification keeps 202 transport-only and distinguishes retry and terminal errors', () => {
  assert.equal(classifyAppEventResponse(202, { success: true }).kind, 'RECEIVED');
  assert.equal(classifyAppEventResponse(202, { success: false }).kind, 'UNKNOWN_RESPONSE');
  assert.equal(classifyAppEventResponse(400, { success: false }).kind, 'VALIDATION_ERROR');
  assert.equal(classifyAppEventResponse(401, {}).kind, 'AUTH_ERROR');
  assert.equal(classifyAppEventResponse(403, {}).kind, 'AUTH_ERROR');
  assert.equal(classifyAppEventResponse(409, {}).kind, 'CONFLICT');
  assert.deepEqual(classifyAppEventResponse(429, {}, '12'), { kind: 'RATE_LIMITED', retryAfterMs: 12_000 });
  assert.equal(classifyAppEventResponse(503, {}).kind, 'SERVER_ERROR');
});
