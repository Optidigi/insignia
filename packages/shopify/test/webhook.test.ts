import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { InvalidShopifyWebhookError, verifyShopifyWebhook } from '../src/webhook.js';

const secret = 'synthetic-current-client-secret';
const body = Buffer.from('{"order":1,"raw":"é"}', 'utf8');
const signature = (raw: Uint8Array, key = secret) => createHmac('sha256', key).update(raw).digest('base64');

function headers(raw = body, key = secret): Record<string, string> {
  return {
    'X-Shopify-Hmac-Sha256': signature(raw, key),
    'X-Shopify-Shop-Domain': 'Example-Shop.MyShopify.Com',
    'X-Shopify-Topic': 'app/uninstalled',
    'X-Shopify-API-Version': '2026-07',
    'X-Shopify-Webhook-Id': 'opaque:provider-delivery+1',
    'X-Shopify-Triggered-At': '2026-09-29T12:30:00Z',
    'X-Shopify-Event-Id': 'event+1',
    'X-Shopify-Name': 'owned-subscription',
  };
}

describe('Shopify raw webhook verification', () => {
  test('accepts signed raw bytes and case-insensitive trusted headers', () => {
    const trusted = verifyShopifyWebhook(body, headers(), [secret]);
    expect(trusted.shopDomain).toBe('example-shop.myshopify.com');
    expect(trusted.deliveryId).toBe('opaque:provider-delivery+1');
    expect(trusted.topic).toBe('app/uninstalled');
    expect(trusted.apiVersion).toBe('2026-07');
    expect(trusted.triggeredAt.toISOString()).toBe('2026-09-29T12:30:00.000Z');
    expect(trusted.eventId).toBe('event+1');
    expect(trusted.name).toBe('owned-subscription');
    expect(Buffer.from(trusted.rawBody)).toEqual(body);
    expect(trusted.rawBody).not.toBe(body);
    expect(verifyShopifyWebhook(body, new Headers(headers()), [secret]).deliveryId).toBe(trusted.deliveryId);
  });

  test('current and previous secret overlap, and no match rejects', () => {
    expect(
      verifyShopifyWebhook(body, headers(body, 'synthetic-previous-secret'), [secret, 'synthetic-previous-secret'])
        .topic,
    ).toBe('app/uninstalled');
    expect(() => verifyShopifyWebhook(body, headers(body, 'unknown-secret'), [secret])).toThrow(
      InvalidShopifyWebhookError,
    );
  });

  test('one-byte mutation, missing and malformed signatures reject', () => {
    const changed = Buffer.from(body);
    changed[4] ^= 1;
    expect(() => verifyShopifyWebhook(changed, headers(), [secret])).toThrow(InvalidShopifyWebhookError);
    const missing = headers();
    delete missing['X-Shopify-Hmac-Sha256'];
    expect(() => verifyShopifyWebhook(body, missing, [secret])).toThrow(InvalidShopifyWebhookError);
    expect(() => verifyShopifyWebhook(body, { ...headers(), 'X-Shopify-Hmac-Sha256': '%%%=' }, [secret])).toThrow(
      InvalidShopifyWebhookError,
    );
  });

  test('rejects conflicting header casing, wrong domain, oversized body, and missing required metadata', () => {
    expect(() => verifyShopifyWebhook(body, { ...headers(), 'x-shopify-topic': 'orders/paid' }, [secret])).toThrow(
      InvalidShopifyWebhookError,
    );
    expect(() =>
      verifyShopifyWebhook(body, { ...headers(), 'X-Shopify-Shop-Domain': 'evil.example.com' }, [secret]),
    ).toThrow(InvalidShopifyWebhookError);
    expect(() => verifyShopifyWebhook(new Uint8Array(8 * 1024 * 1024 + 1), headers(), [secret])).toThrow(
      InvalidShopifyWebhookError,
    );
    const missing = headers();
    delete missing['X-Shopify-Webhook-Id'];
    expect(() => verifyShopifyWebhook(body, missing, [secret])).toThrow(InvalidShopifyWebhookError);
  });

  test('requires an unambiguous provider trigger instant and a configured secret', () => {
    expect(() =>
      verifyShopifyWebhook(body, { ...headers(), 'X-Shopify-Triggered-At': '2026-09-29T12:30:00' }, [secret]),
    ).toThrow(InvalidShopifyWebhookError);
    expect(() => verifyShopifyWebhook(body, headers(), [])).toThrow(InvalidShopifyWebhookError);
  });
});
