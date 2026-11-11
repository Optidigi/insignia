import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import vectors from '../../../packages/cart-authorization/fixtures/cart-line-v3.json' with { type: 'json' };
import { createAjaxCartAdapter } from '../src/cart.ts';
import { type AjaxItem, fetchBody, jsonRecord, record, requestUrl, required, text } from './support.mts';

const root = resolve(import.meta.dirname, '../../..');
const runner = process.env.INSIGNIA_FUNCTION_RUNNER;
const artifacts = process.env.INSIGNIA_FUNCTION_ARTIFACT_ROOT ?? root;
const LINE = '_insignia_line_v3';
// Actual pinned Wasm/query runner, synthetic provider projection and signed golden v3 carriers.
// No native checkout, provider execution receipt or observed order is asserted.
test('Ajax v3 line carriers satisfy actual production Functions at any quantity; missing and altered carriers reject', {
  skip: !runner,
}, async () => {
  const c = required(vectors.cases.find((value) => value.name === 'two_lines'));
  let items: AjaxItem[] = [];
  const fetchImpl: typeof fetch = async (input, request = {}) => {
    const path = requestUrl(input);
    const body = fetchBody(request);
    if (path.endsWith('cart/add.js'))
      items.push(
        ...required(body.items).map((item, index) => ({
          key: `line:${index}`,
          variant_id: item.id,
          quantity: item.quantity,
          properties: item.properties,
        })),
      );
    if (path.endsWith('cart/update.js') && body.updates) items = items.filter((item) => body.updates?.[item.key] !== 0);
    return Response.json({ items, attributes: {}, currency: 'EUR' });
  };
  const ajax = createAjaxCartAdapter({ root: '/', fetchImpl });
  const initial = await ajax.read();
  const result = await ajax.apply(
    c.records.map((line, index) => ({
      variantId: line.variantId,
      quantity: 1,
      properties: { [LINE]: required(c.carriers[index]) },
    })),
    { expectedFingerprint: initial.fingerprint },
  );
  assert.equal(result.status, 'applied');
  assert.deepEqual(required(result.cart).attributes, {});
  const unit = new Map(c.records.map((line) => [line.variantId, BigInt(line.unitMinor)]));
  const money = (minor: bigint) => `${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`;
  const directory = await mkdtemp(join(tmpdir(), 'insignia-cart-functions-'));
  try {
    for (const target of ['transform', 'validation'] as const) {
      // The Function fixtures are owned by the Function crates; only their stable outer shape is used here.
      const input = jsonRecord(readFileSync(join(root, `crates/cart-${target}/fixtures/valid.json`), 'utf8'));
      const shop = record(input.shop),
        cart = record(input.cart),
        localization = record(input.localization);
      const publicConfig = record(shop.publicConfig);
      const config = jsonRecord(text(publicConfig.value));
      Object.assign(config, {
        generationHex: c.header.generationHex,
        epoch: c.header.epoch,
        maxBuckets: 32,
        maxPhysicalQuantity: 10000,
        keys: [{ id: c.header.keyId, publicHex: vectors.publicHex, revoked: false, firstDay: 20800, lastDay: 20802 }],
      });
      publicConfig.value = JSON.stringify(config);
      record(shop.localTime).date = '2026-12-13';
      record(localization.country).isoCode = c.header.country;
      record(localization.market).id = `gid://shopify/Market/${c.header.marketId}`;
      delete cart.quote;
      const lines = cart.lines;
      assert(Array.isArray(lines));
      const model = record(lines[0]);
      delete model.member;
      cart.lines = required(result.cart).customized.map((line, index) => ({
        ...structuredClone(model),
        id: `gid://shopify/CartLine/${index + 1}`,
        quantity: line.quantity,
        line: { value: text(line.properties[LINE]) },
        cost: {
          amountPerQuantity: { currencyCode: 'EUR' },
          subtotalAmount: {
            currencyCode: 'EUR',
            amount: money(required(unit.get(line.variantId)) * BigInt(line.quantity)),
          },
        },
        merchandise: {
          __typename: 'ProductVariant',
          id: `gid://shopify/ProductVariant/${line.variantId}`,
          product: {
            id: 'gid://shopify/Product/42',
            policy: { value: `${c.header.generationHex}:1:required` },
            registration: { value: `${c.header.generationHex}:1:ready` },
          },
        },
      }));
      const extension = join(root, `extensions/insignia-cart-${target}`);
      async function invoke(value: unknown) {
        const path = join(directory, `${target}.json`);
        await writeFile(path, JSON.stringify(value));
        const run = spawnSync(
          required(runner),
          [
            '-f',
            join(artifacts, `extensions/insignia-cart-${target}/target/cart-${target}.wasm`),
            '-i',
            path,
            '-e',
            target === 'transform' ? 'cart_transform_run' : 'cart_validations_generate_run',
            '-q',
            join(
              extension,
              'src',
              target === 'transform' ? 'cart_transform_run.graphql' : 'cart_validations_generate_run.graphql',
            ),
            '-s',
            join(extension, 'schema.graphql'),
            '-j',
          ],
          { encoding: 'utf8', timeout: 30000 },
        );
        assert.equal(run.status, 0, run.stderr);
        const output = jsonRecord(run.stdout);
        assert.equal(output.success, true);
        const operations = record(output.output).operations;
        assert(Array.isArray(operations));
        return operations;
      }
      const edit = (change: (lines: Record<string, unknown>[]) => void) => {
        const value = structuredClone(input);
        const changed = record(value.cart).lines;
        assert(Array.isArray(changed));
        change(changed.map(record));
        return value;
      };
      assert.equal((await invoke(input)).length, target === 'transform' ? 2 : 0);
      // A native quantity change or a removed size keeps the remaining lines priced and checkout open.
      const requantified = edit((lines) => {
        const first = required(lines[0]);
        first.quantity = 4;
        const variant = text(record(first.merchandise).id).split('/').at(-1) ?? '';
        record(record(first.cost).subtotalAmount).amount = money(required(unit.get(variant)) * 4n);
      });
      assert.equal((await invoke(requantified)).length, target === 'transform' ? 2 : 0);
      const removed = structuredClone(input);
      const removedLines = record(removed.cart).lines;
      assert(Array.isArray(removedLines));
      removedLines.pop();
      assert.equal((await invoke(removed)).length, target === 'transform' ? 1 : 0);
      for (const changed of [
        edit((lines) => {
          required(lines[0]).line = null;
        }),
        edit((lines) => {
          const value = text(record(required(lines[0]).line).value);
          required(lines[0]).line = { value: `${value.slice(0, -2)}${value.endsWith('AA') ? 'BA' : 'AA'}` };
        }),
        edit((lines) => {
          required(lines[1]).line = structuredClone(required(lines[0]).line);
        }),
      ])
        assert.equal((await invoke(changed)).length, target === 'transform' ? 0 : 1);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
