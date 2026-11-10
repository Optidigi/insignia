import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InlineConfig, Plugin, ViteDevServer } from 'vite';
import {
  encodeHeaderV3,
  encodeLineCarrierV3,
  merkleProofV3,
  merkleRootV3,
} from '../../../packages/cart-authorization/src/line-v3.ts';
import type { CartProperty } from '../src/cart.ts';

/** Concurrent Vite configurations must not rewrite another fixture's optimizer cache. */
export async function createStorefrontTestServer(config: InlineConfig = {}): Promise<ViteDevServer> {
  const cacheDir = await mkdtemp(join(tmpdir(), 'insignia-storefront-vite-'));
  try {
    const { createServer } = await import('vite');
    const server = await createServer({ ...config, cacheDir });
    const close = server.close.bind(server);
    let closing: Promise<void> | undefined;
    server.close = () =>
      (closing ??= (async () => {
        try {
          await close();
        } finally {
          await rm(cacheDir, { recursive: true, force: true });
        }
      })());
    return server;
  } catch (error) {
    await rm(cacheDir, { recursive: true, force: true });
    throw error;
  }
}

export function required<T>(value: T | null | undefined): T {
  assert(value !== null && value !== undefined, 'Missing test fixture or observed value');
  return value;
}
export function serverPort(server: Pick<Server, 'address'> | null): number {
  const address = required(server).address();
  assert(address && typeof address !== 'string', 'Expected listening TCP server');
  return address.port;
}
export function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return input instanceof Request ? input.url : String(input);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function record(value: unknown): Record<string, unknown> {
  assert(isRecord(value));
  return value;
}
export function jsonRecord(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  return record(value);
}
export type AjaxItem = {
  key: string;
  variant_id: number | string;
  quantity: number;
  properties: Record<string, CartProperty>;
  product_id?: number | string;
};
export type AjaxBody = {
  items?: { id: string | number; quantity: number; properties: Record<string, string> }[];
  updates?: Record<string, number>;
  attributes?: Record<string, string>;
};
export function ajaxBody(value: unknown): AjaxBody {
  const body = record(value);
  const items = body.items === undefined ? [] : body.items;
  assert(Array.isArray(items));
  const decoded = items.map((item: unknown) => {
    const entry = record(item);
    assert(typeof entry.id === 'string' || typeof entry.id === 'number');
    assert(typeof entry.quantity === 'number');
    const properties = record(entry.properties);
    const checked: Record<string, string> = {};
    for (const [key, value] of Object.entries(properties)) {
      assert(typeof value === 'string');
      checked[key] = value;
    }
    return { id: entry.id, quantity: entry.quantity, properties: checked };
  });
  const result: AjaxBody = {};
  if (body.items !== undefined) result.items = decoded;
  if (body.updates !== undefined) {
    result.updates = {};
    for (const [key, value] of Object.entries(record(body.updates))) {
      assert(typeof value === 'number');
      result.updates[key] = value;
    }
  }
  if (body.attributes !== undefined) {
    result.attributes = {};
    for (const [key, value] of Object.entries(record(body.attributes))) {
      assert(typeof value === 'string');
      result.attributes[key] = value;
    }
  }
  return result;
}
export function fetchBody(init: RequestInit): AjaxBody {
  assert(init.body === undefined || typeof init.body === 'string');
  return ajaxBody(init.body ? JSON.parse(init.body) : {});
}
export function text(value: unknown): string {
  assert(typeof value === 'string');
  return value;
}

/** Vite serves the actual compiled isolated frame and its closed asset graph at the source host URL. */
export function selectedFrameAssets(): Plugin {
  return {
    name: 'selected-frame-artifact',
    // Keep pure ESM hashing native during source-host tests; delayed optimizer discovery would reload the page after the user opens the frame.
    config() {
      return { optimizeDeps: { exclude: ['@noble/hashes'] } };
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = new URL(request.url ?? '/', 'http://fixture').pathname;
        const name = path.split('/').at(-1);
        if (!name || !/^insignia-[A-Za-z0-9_.-]+\.(js|css)$/.test(name)) {
          next();
          return;
        }
        void readFile(new URL(`../dist/${name}`, import.meta.url))
          .then((bytes) => {
            response.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : 'text/javascript');
            response.end(bytes);
          })
          .catch(() => {
            response.statusCode = 404;
            response.end();
          });
      });
    },
  };
}

/**
 * Structurally exact v3 line carriers for storefront tests. The browser never verifies signatures, so a
 * fixed placeholder signature stands in; Function-authority tests use the signed shared vectors instead.
 */
export function lineCarriers(
  lines: readonly { variantId: string; unitMinor: string }[],
  context: {
    set?: number;
    currency?: string;
    country?: string;
    marketId?: string;
    validThroughDay?: number;
  } = {},
): { prefix: string; carriers: string[] } {
  const records = lines.map((line, index) => ({ index, variantId: line.variantId, unitMinor: line.unitMinor }));
  const set = (context.set ?? 1).toString(16).padStart(8, '0');
  const header = encodeHeaderV3({
    keyId: 7,
    generationHex: '11111111111141118111111111111111',
    epoch: 4,
    quoteHex: `${set}000040008000000000000001`,
    setHex: `${set}000040008000000000000002`,
    count: records.length,
    currency: context.currency ?? 'EUR',
    exponent: 2,
    country: context.country ?? 'DE',
    marketId: context.marketId ?? '42',
    validThroughDay: context.validThroughDay ?? 20802,
    rootHex: merkleRootV3(records).toString('hex'),
  });
  const prefix = Buffer.concat([header, Buffer.alloc(64, 7)]);
  return {
    prefix: prefix.toString('base64url'),
    carriers: records.map((record) => encodeLineCarrierV3(prefix, record, merkleProofV3(records, record.index))),
  };
}
