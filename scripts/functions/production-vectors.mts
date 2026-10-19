/** Replay real TypeScript carriers through both complete local Functions with independent exact-output expectations. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import persisted from '../../docs/delivery/evidence/m4-002/pg-persisted-negative-vector.json' with { type: 'json' };
import accepted from '../../docs/delivery/evidence/m4-002/synthetic-accepted-quote.json' with { type: 'json' };
import vectors from '../../packages/cart-authorization/fixtures/whole-quote-v2.json' with { type: 'json' };
import { calculatedQueryCost } from './query-cost.mts';
import {
  array,
  compact,
  type FunctionInput,
  fixture,
  hash,
  invoke,
  money,
  publicConfig,
  type ReplayCase,
  ROOT,
  record,
  required,
  TARGETS,
  type Target,
  targetPaths,
  text,
} from './runtime.mts';
export function makeInput(target: Target, entry: ReplayCase): FunctionInput {
  const input = fixture(target),
    header = entry.header,
    config = publicConfig(input.shop.publicConfig.value);
  config.generationHex = header.generationHex;
  config.epoch = header.epoch;
  config.maxBuckets = 32;
  config.maxPhysicalQuantity = 10000;
  config.keys = [
    {
      id: header.keyId,
      publicHex: entry.publicHex ?? vectors.publicHex,
      revoked: false,
      firstDay: entry.firstValidDay ?? 20800,
      lastDay: entry.lastValidDay ?? 20802,
    },
  ];
  input.shop.publicConfig.value = compact(config).toString();
  input.shop.localTime.date = entry.acceptedDate ?? '2026-12-13';
  input.localization.country.isoCode = header.country;
  input.localization.market.id = `gid://shopify/Market/${header.marketId}`;
  input.cart.quote = { value: entry.envelope };
  const model = required(input.cart.lines[0]);
  input.cart.lines = [];
  assert.equal(entry.members.length, entry.memberCarriers.length, 'Complete carrier vector required');
  for (const [index, member] of entry.members.entries()) {
    const line = structuredClone(model);
    line.id = `gid://shopify/CartLine/${index + 1}`;
    line.member = { value: required(entry.memberCarriers[index]) };
    line.quantity = member.quantity;
    line.merchandise.id = `gid://shopify/ProductVariant/${member.variantId}`;
    line.merchandise.product.id = `gid://shopify/Product/${42 + (index % 3)}`;
    line.merchandise.product.policy = { value: `${header.generationHex}:1:required` };
    line.merchandise.product.registration = { value: `${header.generationHex}:1:ready` };
    line.cost.subtotalAmount ??= { currencyCode: header.currency };
    line.cost.amountPerQuantity.currencyCode = header.currency;
    if (target === 'validation')
      line.cost.subtotalAmount.amount = money(BigInt(member.quantity) * BigInt(member.unitMinor));
    line.cost.subtotalAmount.currencyCode = header.currency;
    input.cart.lines.push(line);
  }
  for (let index = 0; index < entry.ordinaryLines; index++) {
    const line = structuredClone(model);
    line.id = `gid://shopify/CartLine/${entry.members.length + index + 1}`;
    line.member = null;
    line.quantity = 1;
    line.merchandise.id = `gid://shopify/ProductVariant/${100000 + index}`;
    line.merchandise.product.policy = null;
    line.merchandise.product.registration = null;
    line.cost.subtotalAmount ??= { currencyCode: header.currency };
    line.cost.amountPerQuantity.currencyCode = header.currency;
    line.cost.subtotalAmount.currencyCode = header.currency;
    if (target === 'validation') line.cost.subtotalAmount.amount = '10.00';
    input.cart.lines.push(line);
  }
  return input;
}
function validateSourceVectors() {
  assert.equal(vectors.version, 'whole-quote-v2-candidate-v1');
  assert.equal(required(accepted.quote.economics.groups[0]).customizationUnitMinor, '-1');
  assert.deepEqual(
    accepted.quote.economics.lines.map((line) => line.unitPriceMinor),
    ['1', '0'],
  );
  assert.equal(accepted.quote.economics.version, 'm4-quote-economics-v1');
  for (const kind of ['groups', 'lines'] as const)
    for (const entry of accepted.quote.economics[kind]) {
      assert(!('canonicalIdentity' in entry));
      assert.equal(entry.canonicalIdentitySha256.length, 64);
    }
  assert(!JSON.stringify(accepted.quote).includes('"art"'));
  assert.equal(persisted.schemaVersion, 'm4-002-pg-persisted-vector-v1');
  assert.equal(persisted.quoteSha256, hash(compact(persisted.quote)));
  assert.equal(persisted.quoteEconomicsVersion, persisted.quote.economics.version);
  assert.equal(persisted.quoteEconomicsVersion, 'm4-quote-economics-v1');
  assert.equal(persisted.totalMinor, '1');
  assert.equal(persisted.quote.economics.totalMinor, '1');
  assert.deepEqual(persisted.lineUnitMinor, ['1', '0']);
  assert.deepEqual(
    persisted.quote.economics.lines.map((line) => line.unitPriceMinor),
    persisted.lineUnitMinor,
  );
  assert.equal(persisted.functionVector.header.quoteHex, persisted.quoteId.replaceAll('-', ''));
  assert.equal(persisted.functionVector.header.setHex, persisted.setId.replaceAll('-', ''));
  assert.deepEqual(
    persisted.functionVector.members.map((member) => member.unitMinor),
    persisted.lineUnitMinor,
  );
  assert(!JSON.stringify(persisted.quote).includes('"art"'));
}
export interface ProductionVectorEvidence {
  target: Target;
  case: string;
  expectedOperations: number;
  actualOperations: number;
  inputBytes: number;
  outputBytes: number;
  transformOutputUpperBytes: number | null;
  inputSha256: string;
  outputSha256: string;
  instructions: number;
  linearMemoryKiB: number;
  wasmSha256: string;
  wasmBytes: number;
  querySha256: string;
  queryBytes: number;
  calculatedQueryCost: number;
  queryCostStatus: string;
  stackBytes: null;
  stackStatus: string;
}
export function productionVectors(runner: string) {
  validateSourceVectors();
  const out = join(ROOT, '.m4-002-artifacts');
  mkdirSync(out, { recursive: true });
  const rows: ProductionVectorEvidence[] = [];
  function replay(target: Target, name: string, payload: FunctionInput, expectedCount: number, entry?: ReplayCase) {
    const result = invoke(target, payload, runner, out),
      output = result.output;
    assert.equal(output.operations.length, expectedCount, `${target}/${name}`);
    if (target === 'transform' && expectedCount) {
      assert(entry);
      assert.equal(entry.members.length, entry.memberCarriers.length);
      const byCarrier = new Map(
        entry.memberCarriers.map((carrier, index) => [carrier, required(entry.members[index])]),
      );
      const expected: Record<string, unknown> = {};
      for (const line of payload.cart.lines) {
        if (!line.member) continue;
        const carrier = line.member.value,
          member = required(byCarrier.get(carrier));
        expected[line.id] = {
          merchandiseId: `gid://shopify/ProductVariant/${member.variantId}`,
          quantity: 1,
          attributes: [{ key: '_insignia_member_v2', value: carrier }],
          amount: money(member.unitMinor),
        };
      }
      const actual: Record<string, unknown> = {};
      for (const operation of output.operations) {
        const expanded = record(record(operation).lineExpand),
          items = array(expanded.expandedCartItems);
        assert.equal(items.length, 1, `${target}/${name}`);
        const item = record(items[0]);
        actual[text(expanded.cartLineId)] = {
          merchandiseId: item.merchandiseId,
          quantity: item.quantity,
          attributes: item.attributes,
          amount: record(record(record(item.price).adjustment).fixedPricePerUnit).amount,
        };
      }
      assert.deepEqual(actual, expected, `${target}/${name}`);
    }
    const actualCount = output.operations.length,
      outputBytes = compact(output).length,
      upper = 17 + 362 * actualCount + Math.max(0, actualCount - 1);
    if (target === 'transform') assert(outputBytes <= upper && upper <= 16000, `${name}: output capacity`);
    const paths = targetPaths(target);
    rows.push({
      target,
      case: name,
      expectedOperations: expectedCount,
      actualOperations: actualCount,
      inputBytes: compact(payload).length,
      outputBytes,
      transformOutputUpperBytes: target === 'transform' ? upper : null,
      inputSha256: hash(compact(payload)),
      outputSha256: hash(compact(output)),
      instructions: result.instructions,
      linearMemoryKiB: result.memoryUsage,
      wasmSha256: hash(readFileSync(paths.wasm)),
      wasmBytes: statSync(paths.wasm).size,
      querySha256: hash(readFileSync(paths.query)),
      queryBytes: statSync(paths.query).size,
      calculatedQueryCost: calculatedQueryCost(readFileSync(paths.query, 'utf8'), readFileSync(paths.schema, 'utf8')),
      queryCostStatus: 'calculated from current Shopify Function field-cost table; not runner-measured',
      stackBytes: null,
      stackStatus: 'unmeasured: pinned runner exposes linear memory, not stack peak',
    });
  }
  const cases: ReplayCase[] = [
    ...vectors.cases,
    { ...accepted.functionVector, publicHex: accepted.publicKeyHex },
    persisted.functionVector,
  ];
  for (const target of TARGETS)
    for (const entry of cases) {
      const base = makeInput(target, entry),
        count = entry.members.length;
      replay(target, entry.name, base, target === 'transform' ? count : 0, entry);
      const reordered = structuredClone(base);
      reordered.cart.lines.reverse();
      replay(target, `${entry.name}-reordered`, reordered, target === 'transform' ? count : 0, entry);
      const alterations: Record<string, (input: FunctionInput) => void> = {
        country: (input) => {
          input.localization.country.isoCode = entry.header.country === 'US' ? 'DE' : 'US';
        },
        market: (input) => {
          input.localization.market.id = 'gid://shopify/Market/43';
        },
        currency: (input) => {
          const cost = required(input.cart.lines[0]).cost,
            currency = entry.header.currency === 'USD' ? 'EUR' : 'USD';
          if (target === 'transform') cost.amountPerQuantity = { currencyCode: currency };
          else required(cost.subtotalAmount).currencyCode = currency;
        },
        generation: (input) => {
          input.shop.publicConfig.value = input.shop.publicConfig.value.replace(
            entry.header.generationHex,
            '00'.repeat(16),
          );
        },
        epoch: (input) => {
          input.shop.publicConfig.value = input.shop.publicConfig.value.replace(
            `"epoch":${entry.header.epoch}`,
            `"epoch":${entry.header.epoch + 1}`,
          );
        },
        'missing-member': (input) => {
          required(input.cart.lines[0]).member = null;
        },
        'wrong-variant': (input) => {
          required(input.cart.lines[0]).merchandise.id = 'gid://shopify/ProductVariant/999999';
        },
        'wrong-quantity': (input) => {
          required(input.cart.lines[0]).quantity++;
        },
        'selling-plan': (input) => {
          required(input.cart.lines[0]).sellingPlanAllocation = { sellingPlan: { id: 'gid://shopify/SellingPlan/1' } };
        },
      };
      if (count > 1)
        alterations['duplicate-member'] = (input) => {
          required(input.cart.lines[1]).member = structuredClone(required(input.cart.lines[0]).member);
        };
      if (target === 'validation')
        alterations['wrong-price'] = (input) => {
          required(required(input.cart.lines[0]).cost.subtotalAmount).amount = '9.99';
        };
      for (const [label, mutate] of Object.entries(alterations)) {
        const changed = structuredClone(base);
        mutate(changed);
        replay(target, `${entry.name}-${label}`, changed, target === 'transform' ? 0 : 1);
      }
      let changed = structuredClone(base),
        config = publicConfig(changed.shop.publicConfig.value);
      required(config.keys[0]).revoked = true;
      changed.shop.publicConfig.value = compact(config).toString();
      replay(target, `${entry.name}-revoked`, changed, target === 'transform' ? 0 : 1);
      changed = structuredClone(base);
      config = publicConfig(changed.shop.publicConfig.value);
      required(config.keys[0]).lastDay = (entry.firstValidDay ?? 20800) - 1;
      changed.shop.publicConfig.value = compact(config).toString();
      replay(target, `${entry.name}-key-out-of-window`, changed, target === 'transform' ? 0 : 1);
    }
  const manifest = {
    version: 1,
    sourceVectorsSha256: hash(readFileSync(join(ROOT, 'packages/cart-authorization/fixtures/whole-quote-v2.json'))),
    acceptedQuoteExampleSha256: hash(
      readFileSync(join(ROOT, 'docs/delivery/evidence/m4-002/synthetic-accepted-quote.json')),
    ),
    pgPersistedQuoteVectorSha256: hash(
      readFileSync(join(ROOT, 'docs/delivery/evidence/m4-002/pg-persisted-negative-vector.json')),
    ),
    runnerSha256: hash(readFileSync(runner)),
    rows,
  };
  writeFileSync(join(out, 'production-vectors-replay.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    rows: rows.length,
    positive: rows.filter((row) => !row.case.includes('-')).length,
    vectorsSha256: manifest.sourceVectorsSha256,
    transformWasmSha256: required(rows.find((row) => row.target === 'transform')).wasmSha256,
    validationWasmSha256: required(rows.find((row) => row.target === 'validation')).wasmSha256,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(productionVectors(text(process.env.INSIGNIA_FUNCTION_RUNNER)), null, 2));
