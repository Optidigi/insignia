import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Header, Member } from '../../packages/cart-authorization/src/whole-quote.ts';
export const ROOT = resolve(import.meta.dirname, '../..');
export const TARGETS = ['transform', 'validation'] as const;
export type Target = (typeof TARGETS)[number];
export type Attribute = { value: string } | null;
export type FunctionLine = Record<string, unknown> & {
  id: string;
  quantity: number;
  member: Attribute;
  cost: { amountPerQuantity: { currencyCode: string }; subtotalAmount?: { currencyCode: string; amount?: string } };
  sellingPlanAllocation: null | { sellingPlan: { id: string } };
  merchandise: { __typename: string; id: string; product: { id: string; policy: Attribute; registration: Attribute } };
};
export type FunctionInput = Record<string, unknown> & {
  cart: { quote: Attribute; lines: FunctionLine[] };
  localization: { country: { isoCode: string }; market: { id: string } };
  shop: { localTime: { date: string }; publicConfig: { value: string } };
  buyerJourney?: { step: string };
};
export type PublicConfig = Record<string, unknown> & {
  generationHex: string;
  epoch: number;
  maxBuckets: number;
  maxPhysicalQuantity: number;
  keys: { id: number; publicHex: string; revoked: boolean; firstDay: number; lastDay: number }[];
};
export type ReplayCase = {
  name: string;
  ordinaryLines: number;
  header: Header;
  members: Member[];
  memberCarriers: string[];
  envelope: string;
  publicHex?: string;
  firstValidDay?: number;
  lastValidDay?: number;
  acceptedDate?: string;
};
export function required<T>(value: T | null | undefined): T {
  assert(value !== null && value !== undefined, 'Missing fixture member');
  return value;
}
export function record(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'Object required');
  return Object.fromEntries(Object.entries(value));
}
export function text(value: unknown): string {
  assert(typeof value === 'string', 'String required');
  return value;
}
export function number(value: unknown): number {
  assert(typeof value === 'number' && Number.isFinite(value), 'Finite number required');
  return value;
}
export function array(value: unknown): unknown[] {
  assert(Array.isArray(value), 'Array required');
  return value;
}
export function jsonFile(path: string): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path)));
}
export function hash(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export function fileHash(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const hash = createHash('sha256'),
      chunk = Buffer.alloc(1024 * 1024);
    while (true) {
      const length = readSync(fd, chunk);
      if (length === 0) break;
      hash.update(chunk.subarray(0, length));
    }
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}
/** Match the compact ASCII JSON used by the historical local replay receipts. */
export function compact(value: unknown): Buffer {
  return Buffer.from(
    JSON.stringify(value).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`),
  );
}
function attribute(value: unknown): Attribute {
  if (value === null) return null;
  return { value: text(record(value).value) };
}
export function decodeInput(value: unknown): FunctionInput {
  const raw = record(value),
    cart = record(raw.cart),
    localization = record(raw.localization),
    shop = record(raw.shop);
  const result: FunctionInput = {
    ...raw,
    cart: {
      ...cart,
      quote: attribute(cart.quote),
      lines: array(cart.lines).map((value) => {
        const line = record(value),
          cost = record(line.cost),
          merchandise = record(line.merchandise),
          product = record(merchandise.product);
        const decoded: FunctionLine = {
          ...line,
          id: text(line.id),
          quantity: number(line.quantity),
          member: attribute(line.member),
          cost: {
            ...cost,
            amountPerQuantity: {
              ...record(cost.amountPerQuantity),
              currencyCode: text(record(cost.amountPerQuantity).currencyCode),
            },
          },
          sellingPlanAllocation:
            line.sellingPlanAllocation === null || line.sellingPlanAllocation === undefined
              ? null
              : { sellingPlan: { id: text(record(record(line.sellingPlanAllocation).sellingPlan).id) } },
          merchandise: {
            ...merchandise,
            __typename: text(merchandise.__typename),
            id: text(merchandise.id),
            product: {
              ...product,
              id: text(product.id),
              policy: attribute(product.policy),
              registration: attribute(product.registration),
            },
          },
        };
        if (cost.subtotalAmount !== undefined) {
          const subtotal = record(cost.subtotalAmount);
          decoded.cost.subtotalAmount = { ...subtotal, currencyCode: text(subtotal.currencyCode) };
          if (subtotal.amount !== undefined) decoded.cost.subtotalAmount.amount = text(subtotal.amount);
        }
        return decoded;
      }),
    },
    localization: {
      country: { isoCode: text(record(localization.country).isoCode) },
      market: { id: text(record(localization.market).id) },
    },
    shop: {
      localTime: { date: text(record(shop.localTime).date) },
      publicConfig: { value: text(record(shop.publicConfig).value) },
    },
  };
  if (raw.buyerJourney !== undefined) result.buyerJourney = { step: text(record(raw.buyerJourney).step) };
  return result;
}
export function fixture(target: Target, name = 'valid'): FunctionInput {
  return decodeInput(jsonFile(join(ROOT, `crates/cart-${target}/fixtures/${name}.json`)));
}
export function publicConfig(value: string): PublicConfig {
  const raw = record(JSON.parse(value));
  return {
    ...raw,
    generationHex: text(raw.generationHex),
    epoch: number(raw.epoch),
    maxBuckets: number(raw.maxBuckets),
    maxPhysicalQuantity: number(raw.maxPhysicalQuantity),
    keys: array(raw.keys).map((value) => {
      const key = record(value);
      assert(typeof key.revoked === 'boolean');
      return {
        id: number(key.id),
        publicHex: text(key.publicHex),
        revoked: key.revoked,
        firstDay: number(key.firstDay),
        lastDay: number(key.lastDay),
      };
    }),
  };
}
export function targetPaths(target: Target) {
  const extension = join(ROOT, `extensions/insignia-cart-${target}`);
  return {
    extension,
    wasm: join(extension, `target/cart-${target}.wasm`),
    raw: join(extension, `target/cart-${target}.raw.wasm`),
    query: join(
      extension,
      'src',
      target === 'transform' ? 'cart_transform_run.graphql' : 'cart_validations_generate_run.graphql',
    ),
    schema: join(extension, 'schema.graphql'),
    exportName: target === 'transform' ? 'cart_transform_run' : 'cart_validations_generate_run',
  };
}
export type RunnerResult = {
  output: Record<string, unknown> & { operations: unknown[] };
  instructions: number;
  memoryUsage: number;
};
export function invoke(target: Target, payload: FunctionInput, runner: string, scratchRoot: string): RunnerResult {
  const paths = targetPaths(target),
    scratch = mkdtempSync(join(scratchRoot, '.function-replay-'));
  try {
    const input = join(scratch, 'input.json');
    writeFileSync(input, compact(payload));
    const run = spawnSync(
      runner,
      ['-f', paths.wasm, '-i', input, '-e', paths.exportName, '-q', paths.query, '-s', paths.schema, '-j'],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
    assert.equal(run.status, 0, `Function runner failed for ${target}: ${run.stderr}`);
    const value = record(JSON.parse(run.stdout));
    assert.equal(value.success, true, `Function execution failed for ${target}`);
    const output = record(value.output);
    return {
      output: { ...output, operations: array(output.operations) },
      instructions: number(value.instructions),
      memoryUsage: number(value.memory_usage),
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
export function evidence(target: Target) {
  const paths = targetPaths(target);
  return {
    querySha256: hash(readFileSync(paths.query)),
    queryBytes: statSync(paths.query).size,
    rawWasmSha256: hash(readFileSync(paths.raw)),
    finalWasmSha256: hash(readFileSync(paths.wasm)),
    rawWasmBytes: statSync(paths.raw).size,
    finalWasmBytes: statSync(paths.wasm).size,
    schemaSha256: hash(readFileSync(paths.schema)),
  };
}
export function money(minor: string | number | bigint): string {
  const amount = BigInt(minor);
  assert(amount >= 0n, 'Nonnegative Function amount required');
  return `${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`;
}
