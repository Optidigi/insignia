import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createAjaxCartAdapter } from '../src/cart.ts';

const root = resolve(import.meta.dirname, '../../..');
const runner = process.env.M1_FUNCTION_RUNNER;
const artifacts = process.env.INSIGNIA_FUNCTION_ARTIFACT_ROOT ?? root;
// Actual pinned Wasm/query runner, synthetic provider projection and signed golden carriers.
// No native checkout, provider execution receipt or observed order is asserted.
test('Ajax shared/line carriers satisfy actual production Functions; incomplete and altered vectors reject', {
  skip: !runner,
}, async () => {
  const vectors = JSON.parse(
    await readFile(join(root, 'packages/cart-authorization/fixtures/whole-quote-v2.json'), 'utf8'),
  );
  const c = vectors.cases.find((value) => value.name === 'one_bucket');
  let items = [],
    attributes = {};
  const fetchImpl = async (path, request = {}) => {
    const body = request.body ? JSON.parse(request.body) : {};
    if (path.endsWith('cart/add.js'))
      items.push(
        ...body.items.map((item, index) => ({
          key: `line:${index}`,
          variant_id: item.id,
          quantity: item.quantity,
          properties: item.properties,
        })),
      );
    if (path.endsWith('cart/update.js')) {
      if (body.updates) items = items.filter((item) => body.updates[item.key] !== 0);
      Object.assign(attributes, body.attributes ?? {});
    }
    return Response.json({ items, attributes, currency: 'EUR' });
  };
  const ajax = createAjaxCartAdapter({ root: '/', fetchImpl });
  const initial = await ajax.read();
  const result = await ajax.apply(
    c.members.map((member, index) => ({
      variantId: String(member.variantId),
      quantity: member.quantity,
      properties: { _insignia_quote_v2: c.envelope, _insignia_member_v2: c.memberCarriers[index] },
    })),
    { expectedFingerprint: initial.fingerprint },
  );
  assert.equal(result.status, 'applied');
  const directory = await mkdtemp(join(tmpdir(), 'insignia-cart-functions-'));
  try {
    for (const target of ['transform', 'validation']) {
      const input = JSON.parse(await readFile(join(root, `crates/cart-${target}/fixtures/valid.json`), 'utf8'));
      const config = JSON.parse(input.shop.publicConfig.value);
      Object.assign(config, {
        generationHex: c.header.generationHex,
        epoch: c.header.epoch,
        maxBuckets: 32,
        maxPhysicalQuantity: 10000,
        keys: [{ id: c.header.keyId, publicHex: vectors.publicHex, revoked: false, firstDay: 20800, lastDay: 20802 }],
      });
      input.shop.publicConfig.value = JSON.stringify(config);
      input.shop.localTime.date = '2026-12-13';
      input.localization.country.isoCode = c.header.country;
      input.localization.market.id = `gid://shopify/Market/${c.header.marketId}`;
      input.cart.quote = { value: result.cart.attributes._insignia_quote_v2 };
      const model = input.cart.lines[0];
      input.cart.lines = result.cart.customized.map((line, index) => ({
        ...structuredClone(model),
        id: `gid://shopify/CartLine/${index + 1}`,
        quantity: line.quantity,
        member: { value: line.properties._insignia_member_v2 },
        cost: { amountPerQuantity: { currencyCode: 'EUR' }, subtotalAmount: { currencyCode: 'EUR', amount: '19.99' } },
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
      async function invoke(value) {
        const path = join(directory, `${target}.json`);
        await writeFile(path, JSON.stringify(value));
        const run = spawnSync(
          runner,
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
        const output = JSON.parse(run.stdout);
        assert.equal(output.success, true);
        return output.output.operations;
      }
      assert.equal((await invoke(input)).length, target === 'transform' ? 1 : 0);
      for (const changed of [
        (() => {
          const value = structuredClone(input);
          value.cart.quote = null;
          return value;
        })(),
        (() => {
          const value = structuredClone(input);
          value.cart.lines[0].quantity = 2;
          return value;
        })(),
      ])
        assert.equal((await invoke(changed)).length, target === 'transform' ? 0 : 1);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
