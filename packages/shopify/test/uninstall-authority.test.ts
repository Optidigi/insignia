import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { verifyShopifyWebhook } from '../src/webhook.js';

const secret = 'synthetic-m5-025-authority-control';
const body = Buffer.from('{"id":123456,"myshopify_domain":"authority-test.myshopify.com"}');
const hmac = createHmac('sha256', secret).update(body).digest('base64');
const headers = {
  'x-shopify-hmac-sha256': hmac,
  'x-shopify-shop-domain': 'authority-test.myshopify.com',
  'x-shopify-topic': 'app/uninstalled',
  'x-shopify-api-version': '2026-07',
  'x-shopify-webhook-id': 'old-delivery',
  'x-shopify-event-id': 'old-event',
  'x-shopify-triggered-at': '2026-10-01T12:00:00Z',
};

describe('M5-025 cryptographic authority characterization, not a security PASS', () => {
  test.each([
    ['x-shopify-webhook-id', 'new-delivery'],
    ['x-shopify-event-id', 'new-event'],
    ['x-shopify-topic', 'shop/update'],
    ['x-shopify-triggered-at', '2026-10-09T12:00:00Z'],
    ['x-shopify-shop-domain', 'another-shop.myshopify.com'],
    ['x-shopify-api-version', '2026-10'],
  ])('body authentication survives changed unsigned %s', (key, value) => {
    const result = verifyShopifyWebhook(body, { ...headers, [key]: value }, [secret]);
    expect(Buffer.from(result.rawBody)).toEqual(body);
    expect(() => verifyShopifyWebhook(Buffer.concat([body, Buffer.from(' ')]), headers, [secret])).toThrow();
  });

  test('identical Shop bytes on a hypothetical legitimate later uninstall have the same HMAC', () => {
    // This is an indistinguishability control, not a claim that Shopify emitted
    // two observed native events. There is no nonce/generation in these bytes.
    const later = Buffer.from(body);
    const laterSignature = createHmac('sha256', secret).update(later).digest('base64');
    expect(laterSignature).toBe(hmac);
    const laterHeaders = {
      ...headers,
      'x-shopify-webhook-id': 'legitimate-later-delivery',
      'x-shopify-event-id': 'legitimate-later-event',
      'x-shopify-triggered-at': '2026-10-09T12:00:00Z',
      'x-shopify-hmac-sha256': laterSignature,
    };
    expect(verifyShopifyWebhook(later, laterHeaders, [secret]).deliveryId).toBe('legitimate-later-delivery');
    expect(verifyShopifyWebhook(body, laterHeaders, [secret]).deliveryId).toBe('legitimate-later-delivery');
  });
});
