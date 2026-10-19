import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { CatalogProduct } from '../src/catalog.js';
import { createCatalogImageReader } from '../src/catalog-image.js';

const product: CatalogProduct = {
  id: 'gid://shopify/Product/42',
  title: 'Synthetic shirt',
  status: 'ACTIVE',
  image: { url: 'https://cdn.shopify.com/s/files/synthetic/product.png?v=1', alt: null },
  variants: [{ id: 'gid://shopify/ProductVariant/77', title: 'Blue', selectedOptions: [], image: null }],
  variantsTruncated: false,
};

describe('catalog-owned image byte reader', () => {
  it('reads the selected catalog image once with pinned public DNS and no credentials or redirects', async () => {
    const calls: unknown[] = [];
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const reader = createCatalogImageReader({
      lookup: async (hostname, options) => {
        calls.push({ hostname, options });
        return [{ address: '104.16.1.1', family: 4 }];
      },
      request: (url, options, callback) => {
        calls.push({ url: url.href, method: options.method, headers: options.headers, agent: options.agent });
        if (!options.lookup) throw Error('Pinned lookup required');
        options.lookup('cdn.shopify.com', {}, (error, address, family) => {
          expect(error).toBeNull();
          expect(address).toBe('104.16.1.1');
          expect(family).toBe(4);
        });
        options.lookup('cdn.shopify.com', { all: true }, (error, address) => {
          expect(error).toBeNull();
          expect(address).toEqual([{ address: '104.16.1.1', family: 4 }]);
        });
        options.lookup('other.test', {}, (error) => expect(error?.message).toBe('CDN_HOST_DRIFT'));
        const request = new EventEmitter() as ClientRequest;
        request.end = () => {
          const response = Readable.from([bytes]) as IncomingMessage;
          response.statusCode = 200;
          response.headers = { 'content-type': 'image/png', 'content-length': '8' };
          Object.defineProperty(response, 'complete', { value: true });
          callback(response);
          return request;
        };
        return request;
      },
    });
    const result = await reader.read(product, 'variant_77');
    expect(result).toEqual({ imageRevisionId: 'variant_77', contentType: 'image/png', bytes: new Uint8Array(bytes) });
    expect(calls).toEqual([
      { hostname: 'cdn.shopify.com', options: { family: 4, all: true } },
      {
        url: product.image?.url,
        method: 'GET',
        headers: { Accept: 'image/png, image/jpeg, image/svg+xml', 'Accept-Encoding': 'identity' },
        agent: false,
      },
    ]);
  });
});

function wire(
  input: {
    status?: number;
    type?: string;
    length?: string;
    encoding?: string;
    chunks?: readonly Buffer[];
    complete?: boolean;
    addresses?: readonly { address: string; family: number }[];
  } = {},
) {
  let requests = 0,
    lookups = 0,
    target = '',
    destroyed = 0;
  const reader = createCatalogImageReader({
    lookup: async () => {
      lookups++;
      return [...(input.addresses ?? [{ address: '104.16.1.1', family: 4 }])];
    },
    request: (url, options, callback) => {
      requests++;
      target = url.href;
      expect(options.servername).toBe('cdn.shopify.com');
      expect(options.rejectUnauthorized).toBe(true);
      expect(options.family).toBe(4);
      expect(options.maxHeaderSize).toBe(16 * 1024);
      const request = new EventEmitter() as ClientRequest;
      request.destroy = () => {
        destroyed++;
        return request;
      };
      request.end = () => {
        const response = Readable.from(input.chunks ?? [Buffer.from('synthetic')]) as IncomingMessage;
        response.statusCode = input.status ?? 200;
        response.headers = {
          'content-type': input.type ?? 'image/png',
          ...(input.length === undefined ? {} : { 'content-length': input.length }),
          ...(input.encoding ? { 'content-encoding': input.encoding } : {}),
        };
        Object.defineProperty(response, 'complete', { value: input.complete ?? true });
        callback(response);
        return request;
      };
      return request;
    },
  });
  return { reader, observed: () => ({ requests, lookups, target, destroyed }) };
}

it('uses only the selected product/variant catalog image, keeps source intact and leaves missing images absent', async () => {
  const source = structuredClone(product);
  const variant = source.variants[0];
  if (!variant) throw Error('Synthetic variant missing');
  variant.image = { url: 'https://cdn.shopify.com/s/files/synthetic/blue.png?v=2', alt: null };
  const original = structuredClone(source),
    own = wire();
  await own.reader.read(source, 'variant_77');
  expect(own.observed().target).toBe(variant.image?.url);
  const base = wire();
  await base.reader.read(source, 'product_42');
  expect(base.observed().target).toBe(source.image?.url);
  expect(source).toEqual(original);
  for (const reference of ['https://cdn.shopify.com/synthetic.png', 'product_43', 'variant_78', 'variant_077']) {
    const foreign = wire();
    await expect(foreign.reader.read(source, reference)).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
    expect(foreign.observed().requests).toBe(0);
    expect(foreign.observed().lookups).toBe(0);
  }
  source.image = null;
  variant.image = null;
  const missing = wire();
  expect(await missing.reader.read(source, 'variant_77')).toBeNull();
  expect(missing.observed().lookups).toBe(0);
});

it('rejects credentials, alternate hosts, ports, fragments and non-HTTPS before DNS or dispatch', async () => {
  for (const url of [
    'http://cdn.shopify.com/x',
    'https://cdn.shopify.com:8443/x',
    'https://user:secret@cdn.shopify.com/x',
    'https://cdn.shopify.com@127.0.0.1/x',
    'https://cdn.shopify.com.attacker.test/x',
    'https://cdn.shopify.com./x',
    'https://[::1]/x',
    'https://127.0.0.1/x',
    'https://cdn.shopify.com/x#fragment',
    'https://store.shopifycdn.net/x',
    'not a URL',
  ]) {
    const source = structuredClone(product);
    source.image = { url, alt: null };
    const test = wire();
    await expect(test.reader.read(source, 'product_42')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(test.observed().requests).toBe(0);
    expect(test.observed().lookups).toBe(0);
  }
});

it('rejects private/reserved or mixed DNS results and never resolves again through the transport', async () => {
  for (const address of [
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '192.0.0.1',
    '192.0.2.1',
    '192.88.99.1',
    '198.18.0.1',
    '198.19.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::ffff:127.0.0.1',
    'not-an-address',
  ]) {
    const test = wire({
      addresses: [
        { address: '104.16.1.1', family: 4 },
        { address, family: 4 },
      ],
    });
    await expect(test.reader.read(product, 'product_42')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(test.observed().requests).toBe(0);
  }
  for (const addresses of [[], [{ address: '104.16.1.1', family: 6 }]]) {
    const test = wire({ addresses });
    await expect(test.reader.read(product, 'product_42')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(test.observed().requests).toBe(0);
  }
});

it('never follows redirects or accepts unsupported encoding/type and destroys the one request', async () => {
  for (const [input, code] of [
    [{ status: 302 }, 'UNAVAILABLE'],
    [{ status: 404 }, 'UNAVAILABLE'],
    [{ encoding: 'gzip' }, 'UNAVAILABLE'],
    [{ type: 'image/webp' }, 'UNSUPPORTED_TYPE'],
    [{ type: 'image/avif' }, 'UNSUPPORTED_TYPE'],
    [{ type: 'text/html' }, 'UNSUPPORTED_TYPE'],
  ] as const) {
    const test = wire(input);
    await expect(test.reader.read(product, 'product_42')).rejects.toMatchObject({ code });
    expect(test.observed().requests).toBe(1);
    expect(test.observed().destroyed).toBe(1);
  }
});

it('bounds declared and streamed bytes, rejects truncated/empty bodies and does not retry', async () => {
  for (const [input, code] of [
    [{ length: '5242881' }, 'TOO_LARGE'],
    [{ length: 'invalid' }, 'TOO_LARGE'],
    [{ length: '0' }, 'TOO_LARGE'],
    [{ chunks: [Buffer.alloc(5 * 1024 * 1024), Buffer.from('x')] }, 'TOO_LARGE'],
    [{ length: '10', chunks: [Buffer.from('short')] }, 'UNAVAILABLE'],
    [{ chunks: [], complete: true }, 'UNAVAILABLE'],
    [{ complete: false }, 'UNAVAILABLE'],
  ] as const) {
    const test = wire(input);
    await expect(test.reader.read(product, 'product_42')).rejects.toMatchObject({ code });
    expect(test.observed().requests).toBe(1);
    expect(test.observed().destroyed).toBe(1);
  }
});

it('aborts even while DNS is unresolved and dispatches nothing when lookup later completes', async () => {
  const controller = new AbortController();
  let finishLookup!: (value: { address: string; family: number }[]) => void;
  let requests = 0;
  const reader = createCatalogImageReader({
    lookup: () =>
      new Promise((resolve) => {
        finishLookup = resolve;
      }),
    request: () => {
      requests++;
      throw Error('unexpected request');
    },
  });
  const pending = reader.read(product, 'product_42', controller.signal);
  await Promise.resolve();
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  finishLookup([{ address: '104.16.1.1', family: 4 }]);
  await Promise.resolve();
  expect(requests).toBe(0);
});
