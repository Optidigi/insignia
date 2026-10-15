import { createHash } from 'node:crypto';
import { partnerInstant } from './partner-instant.js';

export const SHOPIFY_USAGE_EVENT_URL = 'https://api.shopify.com/app/2026-07/events' as const;
/** A structural view of an immutable financial intent. This is not meter or credential authority. */
export interface ShopifyUsageEventInput {
  readonly providerShopId: string;
  readonly meterHandle: string;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
  readonly units: 1;
}
/** Select only economic event fields; no buyer/order/artwork attributes cross this boundary. */
export function formatShopifyUsageEvent(input: ShopifyUsageEventInput) {
  if (!input || typeof input !== 'object') throw new Error('USAGE_EVENT_INVALID');
  const { providerShopId, meterHandle, occurredAt, idempotencyKey, units } = input;
  if (
    typeof providerShopId !== 'string' ||
    !/^gid:\/\/shopify\/Shop\/[1-9][0-9]{0,39}$/.test(providerShopId) ||
    typeof meterHandle !== 'string' ||
    !/^[A-Za-z0-9_./-]{1,128}$/.test(meterHandle) ||
    typeof occurredAt !== 'string' ||
    partnerInstant(occurredAt) !== occurredAt ||
    typeof idempotencyKey !== 'string' ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(idempotencyKey) ||
    units !== 1
  )
    throw new Error('USAGE_EVENT_INVALID');
  const body = JSON.stringify({
    shop_id: providerShopId,
    event_handle: meterHandle,
    timestamp: occurredAt,
    idempotency_key: idempotencyKey,
    attributes: { value: units },
  });
  return Object.freeze({
    url: SHOPIFY_USAGE_EVENT_URL,
    method: 'POST' as const,
    body,
    bodySha256: createHash('sha256').update(body).digest('hex'),
  });
}

export type ShopifyUsageEventResponseOutcome =
  | { readonly kind: 'RECEIPT'; readonly httpStatus: 202 }
  | { readonly kind: 'HTTP'; readonly httpStatus: number }
  | { readonly kind: 'UNKNOWN' };

/** Normalize supplied response evidence only; this never dispatches or asserts billing processing. */
export function parseShopifyUsageEventResponse(response: {
  readonly url: string;
  readonly redirected: boolean;
  readonly status: number;
  readonly body: string;
}): ShopifyUsageEventResponseOutcome {
  if (
    !response ||
    response.url !== SHOPIFY_USAGE_EVENT_URL ||
    response.redirected !== false ||
    !Number.isInteger(response.status) ||
    response.status < 100 ||
    response.status > 599 ||
    (response.status >= 300 && response.status < 400) ||
    typeof response.body !== 'string' ||
    Buffer.byteLength(response.body, 'utf8') > 16 * 1024
  )
    return { kind: 'UNKNOWN' };
  if (response.status === 202) {
    try {
      const body: unknown = JSON.parse(response.body);
      if (body && typeof body === 'object' && !Array.isArray(body) && (body as { success?: unknown }).success === true)
        return { kind: 'RECEIPT', httpStatus: 202 };
    } catch {}
  }
  return { kind: 'HTTP', httpStatus: response.status };
}
