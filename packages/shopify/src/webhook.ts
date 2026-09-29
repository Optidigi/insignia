import { createHmac, timingSafeEqual } from 'node:crypto';

/** Matches the durable inbox payload bound. The HTTP reader must enforce it while streaming too. */
export const MAX_SHOPIFY_WEBHOOK_BODY_BYTES = 8 * 1024 * 1024;

export type BodyVerifiedShopifyWebhook = {
  shopDomain: string;
  topic: string;
  apiVersion: string;
  deliveryId: string;
  triggeredAt: Date;
  eventId: string | null;
  name: string | null;
  rawBody: Uint8Array;
};

type HeaderInput = Headers | Record<string, string | readonly string[] | undefined>;

export class InvalidShopifyWebhookError extends Error {
  constructor() {
    super('Invalid Shopify webhook');
    this.name = 'InvalidShopifyWebhookError';
  }
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function normalizedHeaders(input: HeaderInput): Map<string, string> {
  const headers = new Map<string, string>();
  const entries = input instanceof Headers ? input.entries() : Object.entries(input);
  for (const [originalName, rawValue] of entries) {
    const name = originalName.toLowerCase();
    if (!name.startsWith('x-shopify-')) continue;
    if (headers.has(name) || Array.isArray(rawValue) || typeof rawValue !== 'string') {
      throw new InvalidShopifyWebhookError();
    }
    headers.set(name, rawValue);
  }
  return headers;
}

function required(headers: Map<string, string>, name: string, maxLength: number): string {
  const value = headers.get(name);
  if (!value || value.length > maxLength || hasControlCharacters(value) || value.trim() !== value) {
    throw new InvalidShopifyWebhookError();
  }
  return value;
}

export function normalizeShopifyDomain(value: string): string {
  if (typeof value !== 'string' || value.length > 255 || value.trim() !== value) {
    throw new InvalidShopifyWebhookError();
  }
  const normalized = value.toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(normalized)) {
    throw new InvalidShopifyWebhookError();
  }
  return normalized;
}

/** Authenticate exact raw bytes; Shopify's routing headers are not covered by this HMAC. */
export function verifyShopifyWebhook(
  rawBody: Uint8Array,
  inputHeaders: HeaderInput,
  clientSecretRing: readonly string[],
): BodyVerifiedShopifyWebhook {
  if (
    !(rawBody instanceof Uint8Array) ||
    rawBody.byteLength > MAX_SHOPIFY_WEBHOOK_BODY_BYTES ||
    !Array.isArray(clientSecretRing) ||
    clientSecretRing.length < 1 ||
    clientSecretRing.length > 4 ||
    clientSecretRing.some((secret) => typeof secret !== 'string' || secret.length < 1)
  ) {
    throw new InvalidShopifyWebhookError();
  }
  const headers = normalizedHeaders(inputHeaders);
  const hmac = required(headers, 'x-shopify-hmac-sha256', 44);
  if (!/^[A-Za-z0-9+/]{43}=$/.test(hmac)) throw new InvalidShopifyWebhookError();
  const provided = Buffer.from(hmac, 'base64');
  if (provided.length !== 32 || provided.toString('base64') !== hmac) throw new InvalidShopifyWebhookError();
  // Compare all configured secrets, including previous overlap, without a match-index early exit.
  let matched = 0;
  for (const secret of clientSecretRing) {
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    matched |= Number(timingSafeEqual(expected, provided));
  }
  if (!matched) throw new InvalidShopifyWebhookError();

  const shopDomain = normalizeShopifyDomain(required(headers, 'x-shopify-shop-domain', 255));
  const topic = required(headers, 'x-shopify-topic', 128);
  if (!/^[a-z][a-z0-9_.-]*\/[a-z][a-z0-9_.-]*$/.test(topic)) throw new InvalidShopifyWebhookError();
  const apiVersion = required(headers, 'x-shopify-api-version', 16);
  if (!/^(?:20[0-9]{2}-(?:01|04|07|10)|unstable)$/.test(apiVersion)) throw new InvalidShopifyWebhookError();
  const deliveryId = required(headers, 'x-shopify-webhook-id', 256);
  if ([...deliveryId].some((character) => character.charCodeAt(0) < 33 || character.charCodeAt(0) > 126)) {
    throw new InvalidShopifyWebhookError();
  }
  const triggeredAtText = required(headers, 'x-shopify-triggered-at', 64);
  const triggeredAt = new Date(triggeredAtText);
  if (
    !Number.isFinite(triggeredAt.getTime()) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(triggeredAtText)
  ) {
    throw new InvalidShopifyWebhookError();
  }
  const eventId = headers.has('x-shopify-event-id') ? required(headers, 'x-shopify-event-id', 256) : null;
  const name = headers.has('x-shopify-name') ? required(headers, 'x-shopify-name', 128) : null;
  return {
    shopDomain,
    topic,
    apiVersion,
    deliveryId,
    triggeredAt,
    eventId,
    name,
    rawBody: Uint8Array.from(rawBody),
  };
}
