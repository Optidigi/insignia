import { describe, expect, it } from 'vitest';
import { resolveVariantContext } from '../src/contextual-pricing.js';
import { readPrimaryMarketContext } from '../src/primary-market.js';
import { readShopContext } from '../src/shop-context.js';
import { readVariantAvailability } from '../src/storefront/variant-availability.js';

/**
 * A buyer request answers a transient Shopify failure with 409 BUSY and a retry (#336). Only
 * throttling (429, THROTTLED), Shopify 5xx and network/abort qualify; a revoked token, a missing
 * scope or a retired API version would otherwise make every buyer retry forever.
 */
const now = () => new Date('2026-10-15T12:00:00Z');
const credentials = {
  acquire: async () => ({
    kind: 'usable' as const,
    shopDomain: 'synthetic.myshopify.com',
    accessToken: 'synthetic-token',
    accessExpiresAt: new Date('2026-10-15T12:10:00Z'),
  }),
};
const version = { 'x-shopify-api-version': '2026-07' };
const status = (code: number) => async () => new Response('{}', { status: code, headers: version });
const graphqlError = (code: string) => async () =>
  Response.json({ errors: [{ message: 'synthetic', extensions: { code } }] }, { headers: version });
const network = async (): Promise<Response> => {
  throw new TypeError('fetch failed');
};
const aborted = async (): Promise<Response> => {
  throw new DOMException('The operation was aborted.', 'AbortError');
};
const transient = { 429: status(429), 500: status(500), 503: status(503), network, aborted };
const permanent = { 401: status(401), 403: status(403), 404: status(404) };

const readers = {
  'primary Market': (fetchImpl: typeof fetch) =>
    readPrimaryMarketContext(
      { shopId: 'tenant-1', installationGeneration: '7', shopifyShopId: '105501393179' },
      { credentials, fetchImpl, now },
    ),
  'shop context': (fetchImpl: typeof fetch) =>
    readShopContext(
      { shopId: 'tenant-1', installationGeneration: '7', shopifyShopId: '105501393179' },
      { credentials, fetchImpl, now },
    ),
  'variant availability': (fetchImpl: typeof fetch) =>
    readVariantAvailability(
      {
        shopId: 'tenant-1',
        installationGeneration: '7',
        productId: 'gid://shopify/Product/111',
        variantIds: ['gid://shopify/ProductVariant/222'],
      },
      { credentials, fetchImpl, clock: now },
    ),
};
const failure = (read: Promise<unknown>) =>
  read.then(
    () => {
      throw new Error('expected a provider failure');
    },
    (error: unknown) => error as { name: string; transient?: unknown },
  );

describe.each(Object.entries(readers))('%s read', (_name, read) => {
  it.each(Object.entries(transient))('%s is transient', async (_case, fetchImpl) => {
    expect((await failure(read(fetchImpl))).transient).toBe(true);
  });
  it('a THROTTLED GraphQL error is transient', async () => {
    expect((await failure(read(graphqlError('THROTTLED')))).transient).toBe(true);
  });
  it.each(Object.entries(permanent))('%s is not transient', async (_case, fetchImpl) => {
    expect((await failure(read(fetchImpl))).transient).toBe(false);
  });
  it('ACCESS_DENIED (missing scope) is not transient', async () => {
    expect((await failure(read(graphqlError('ACCESS_DENIED')))).transient).toBe(false);
  });
});

describe('primary Market read', () => {
  it('a retired or substituted API version is not transient', async () => {
    const response = async () => new Response('{}', { status: 200, headers: { 'x-shopify-api-version': '2025-01' } });
    expect((await failure(readers['primary Market'](response))).transient).toBe(false);
  });
});

describe('contextual pricing read', () => {
  const target = {
    shopId: 'tenant-1',
    installationGeneration: '7',
    productId: 'gid://shopify/Product/202',
    variantIds: ['gid://shopify/ProductVariant/303'],
    context: { country: 'NL' },
  };
  const read = (response: { status: number; body: unknown } | Error) =>
    failure(
      resolveVariantContext(target, {
        transport: {
          execute: async () => {
            if (response instanceof Error) throw response;
            return { ...response, requestId: null };
          },
        },
        now,
      }),
    );
  const errors = (code: string) => ({ status: 200, body: { errors: [{ message: 'x', extensions: { code } }] } });
  it.each([
    ['429', { status: 429, body: null }],
    ['500', { status: 500, body: null }],
    ['THROTTLED', errors('THROTTLED')],
    ['network', new TypeError('fetch failed')],
  ] as const)('%s is transient', async (_case, response) => {
    expect((await read(response)).transient).toBe(true);
  });
  it.each([
    ['401', { status: 401, body: null }],
    ['403', { status: 403, body: null }],
    ['ACCESS_DENIED', errors('ACCESS_DENIED')],
    // A query over Shopify's cost limit fails the same way on every retry.
    ['MAX_COST_EXCEEDED', errors('MAX_COST_EXCEEDED')],
  ] as const)('%s is not transient', async (_case, response) => {
    expect((await read(response)).transient).toBe(false);
  });
});
