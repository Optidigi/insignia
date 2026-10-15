import { describe, expect, it } from 'vitest';
import { formatShopifyUsageEvent, parseShopifyUsageEventResponse } from '../src/usage-event.js';

const intent = {
  providerShopId: 'gid://shopify/Shop/123',
  meterHandle: 'customized_order_paid',
  occurredAt: '2026-10-15T12:34:56.789Z',
  idempotencyKey: '12345678-1234-4234-8234-123456789abc',
  units: 1 as const,
};

describe('pinned usage event codec, without dispatch authority', () => {
  it('preserves one original key/time/unit as fixed bytes without order or buyer attributes', () => {
    const request = formatShopifyUsageEvent({
      ...intent,
      orderId: 'private-order',
      attributes: { email: 'private' },
    } as typeof intent);
    expect(request.url).toBe('https://api.shopify.com/app/2026-07/events');
    expect(request.method).toBe('POST');
    expect(request.bodySha256).toBe('eb20fc45d41c385da05aa2e33bd050bde0ee360523c1a3af7c5f6082b6ad6966');
    expect(request.body).toBe(
      '{"shop_id":"gid://shopify/Shop/123","event_handle":"customized_order_paid","timestamp":"2026-10-15T12:34:56.789Z","idempotency_key":"12345678-1234-4234-8234-123456789abc","attributes":{"value":1}}',
    );
    expect(formatShopifyUsageEvent(intent)).toEqual(request);
    expect(request.body).not.toMatch(/private|orderId|email/);
  });
  it('rejects altered units, noncanonical identity/time and invalid provider handles before formatting', () => {
    for (const patch of [
      { units: 500 },
      { units: '1' },
      { providerShopId: '123' },
      { meterHandle: 'wrong handle' },
      { meterHandle: 'x'.repeat(129) },
      { occurredAt: '2026-02-30T12:34:56.789Z' },
      { occurredAt: '2026-10-15T12:34:56Z' },
      { idempotencyKey: 'replacement-key' },
    ])
      expect(() => formatShopifyUsageEvent({ ...intent, ...patch } as typeof intent)).toThrow('USAGE_EVENT_INVALID');
  });

  it('normalizes a synthetic success receipt as transport-only while retaining unverified202 and processing responses', () => {
    // Semantic fixture matching recorded M0 responseSuccess; no saved raw response bytes are claimed.
    const response = {
      url: 'https://api.shopify.com/app/2026-07/events',
      redirected: false,
      status: 202,
      body: '{"success":true}',
    };
    expect(parseShopifyUsageEventResponse(response)).toEqual({ kind: 'RECEIPT', httpStatus: 202 });
    for (const body of ['not-json', '[]', '{}', '{"success":false}', '{"success":"true"}'])
      expect(parseShopifyUsageEventResponse({ ...response, body })).toEqual({ kind: 'HTTP', httpStatus: 202 });
    expect(parseShopifyUsageEventResponse({ ...response, status: 409 })).toEqual({ kind: 'HTTP', httpStatus: 409 });
    expect(parseShopifyUsageEventResponse({ ...response, status: 503 })).toEqual({ kind: 'HTTP', httpStatus: 503 });
  });

  it('holds redirected, wrong-origin, invalid-status and oversized evidence instead of asserting no dispatch', () => {
    const response = {
      url: 'https://api.shopify.com/app/2026-07/events',
      redirected: false,
      status: 202,
      body: '{"success":true}',
    };
    for (const patch of [
      { redirected: true },
      { url: 'https://other.example/events' },
      { status: 302 },
      { status: 0 },
      { status: 600 },
      { status: NaN },
      { body: `{"success":true,"extra":"${'€'.repeat(8000)}"}` },
    ])
      expect(parseShopifyUsageEventResponse({ ...response, ...patch })).toEqual({ kind: 'UNKNOWN' });
  });
});
