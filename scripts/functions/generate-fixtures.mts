/** Reproduce local-only cart-line v3 Function fixtures from a labelled synthetic key; no runtime credentials. */
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type HeaderV3Claims,
  issueLineSetV3,
  type LineRecordV3,
} from '../../packages/cart-authorization/src/line-v3.ts';
import type { AuthorizationSigner } from '../../packages/cart-authorization/src/whole-quote.ts';
import { compact, type FunctionInput, type FunctionLine, money, ROOT, TARGETS, type Target } from './runtime.mts';

// Never use this synthetic seed for runtime keys.
const key = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, 1)]),
  format: 'der',
  type: 'pkcs8',
});
export const FIXTURE_PUBLIC_HEX = createPublicKey(key)
  .export({ format: 'der', type: 'spki' })
  .subarray(-32)
  .toString('hex');
const signer: AuthorizationSigner = {
  signWholeQuote: async (input) => ({
    keyId: 7,
    publicKeyFingerprint: 'synthetic-function-fixture',
    firstValidDay: 20800,
    lastValidDay: 20804,
    signature: sign(null, input.message, key),
  }),
};
const GENERATION = '1'.repeat(32);
/** Fixture shop day 2026-12-15 = Unix day 20802; issued that day, valid through D+2. */
export const FIXTURE_DATE = '2026-12-15';
const ISSUED_DAY = 20802;
export const FIXTURE_VARIANT = '9007199254740993';

export async function issueSet(records: LineRecordV3[], setByte = '3') {
  const claims: HeaderV3Claims = {
    keyId: 7,
    generationHex: GENERATION,
    epoch: 4,
    quoteHex: '2'.repeat(32),
    setHex: setByte.repeat(32),
    currency: 'EUR',
    exponent: 2,
    country: 'DE',
    marketId: '42',
    validThroughDay: ISSUED_DAY + 2,
  };
  return issueLineSetV3(claims, records, ISSUED_DAY, signer);
}

function cartLine(target: Target, id: string, quantity: number, unitMinor: bigint, carrier: string | null) {
  const line: FunctionLine = {
    id: `gid://shopify/CartLine/${id}`,
    quantity,
    line: carrier === null ? null : { value: carrier },
    legacy: null,
    cost: { amountPerQuantity: { currencyCode: 'EUR' } },
    sellingPlanAllocation: null,
    merchandise: {
      __typename: 'ProductVariant',
      id: `gid://shopify/ProductVariant/${FIXTURE_VARIANT}`,
      product: {
        id: 'gid://shopify/Product/42',
        registration: carrier === null ? null : { value: `${GENERATION}:1:ready` },
        policy: carrier === null ? null : { value: `${GENERATION}:1:required` },
      },
    },
  };
  if (target === 'validation')
    line.cost.subtotalAmount = { amount: money(unitMinor * BigInt(quantity)), currencyCode: 'EUR' };
  return line;
}

function input(target: Target, lines: FunctionLine[], maxBuckets: number): FunctionInput {
  const config = {
    generationHex: GENERATION,
    epoch: 4,
    maxBuckets,
    maxPhysicalQuantity: 10000,
    allowNoMarket: false,
    keys: [{ id: 7, publicHex: FIXTURE_PUBLIC_HEX, revoked: false, firstDay: 20800, lastDay: 20804 }],
  };
  return {
    cart: { lines },
    localization: {
      country: { isoCode: 'DE' },
      ...(target === 'validation' ? { language: { isoCode: 'EN' } } : {}),
      market: { id: 'gid://shopify/Market/42' },
    },
    shop: { localTime: { date: FIXTURE_DATE }, publicConfig: { value: compact(config).toString() } },
    ...(target === 'validation' ? { buyerJourney: { step: 'CHECKOUT_COMPLETION' } } : {}),
  };
}

/**
 * `count` signed lines (one set, same real variant, unit 30.33 except the valid fixture) at `quantity`,
 * then `ordinary` unmanaged lines. `extraSet` adds one more customized line from a second set
 * (the 33-line over-cap case).
 */
export async function generatedFixture(
  target: Target,
  count: number,
  ordinary: number,
  quantity = 1,
  options: {
    units?: bigint[];
    quantities?: number[];
    lineIds?: string[];
    extraSet?: boolean;
    maxBuckets?: number;
  } = {},
): Promise<FunctionInput> {
  const units = options.units ?? Array.from({ length: count }, () => 3033n);
  const issued = await issueSet(
    units.map((unit, index) => ({ index, variantId: FIXTURE_VARIANT, unitMinor: unit.toString() })),
  );
  const lines = issued.carriers.map((carrier, index) =>
    cartLine(
      target,
      options.lineIds?.[index] ?? String(index),
      options.quantities?.[index] ?? quantity,
      units[index] ?? 0n,
      carrier,
    ),
  );
  if (options.extraSet) {
    const other = await issueSet([{ index: 0, variantId: FIXTURE_VARIANT, unitMinor: '3033' }], '4');
    lines.push(cartLine(target, String(count), quantity, 3033n, other.carriers[0] ?? ''));
  }
  for (let index = 0; index < ordinary; index++) {
    lines.push(cartLine(target, String(count + 1 + index), 1, 1000n, null));
  }
  return input(target, lines, options.maxBuckets ?? Math.max(count, 2));
}

export const FIXTURES = {
  // Two designs on one real variant at different unit prices; quantities 2 and 1.
  valid: (target: Target) =>
    generatedFixture(target, 2, 0, 1, {
      units: [3033n, 3034n],
      quantities: [2, 1],
      lineIds: ['9007199254740991', '9007199254740992'],
      maxBuckets: 10,
    }),
  '10-signed-190-ordinary': (target: Target) => generatedFixture(target, 10, 190),
  '32-signed-168-ordinary': (target: Target) => generatedFixture(target, 32, 168),
  // 33 customized lines cannot be one set (32-line cap); 32 from one set plus one from another must reject.
  '33-signed-0-ordinary': (target: Target) => generatedFixture(target, 32, 0, 1, { extraSet: true, maxBuckets: 32 }),
  '10k-physical': (target: Target) => generatedFixture(target, 2, 0, 5000),
} as const;

export async function generateFixtures(checkOnly = false): Promise<void> {
  for (const target of TARGETS)
    for (const [name, make] of Object.entries(FIXTURES)) {
      const path = join(ROOT, `crates/cart-${target}/fixtures/${name}.json`),
        bytes = Buffer.concat([compact(await make(target)), Buffer.from('\n')]);
      if (checkOnly) assert.deepEqual(readFileSync(path), bytes, `Synthetic fixture drift: ${path}`);
      else writeFileSync(path, bytes);
    }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await generateFixtures(process.argv.includes('--check'));
