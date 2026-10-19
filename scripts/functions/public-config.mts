/** Exercise production public-key configuration against complete local Wasm Functions. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPublicConfig, type PublicSigningKey } from '../../packages/application/dist/index.js';
import vectors from '../../packages/cart-authorization/fixtures/whole-quote-v2.json' with { type: 'json' };
import { fixture, hash, invoke, ROOT, required, TARGETS, targetPaths } from './runtime.mts';
export function publicConfigReplay(runner: string) {
  const one = required(vectors.cases.find((item) => item.name === 'one_bucket'));
  assert(one.header.keyId === 7 && one.members.length === 1, 'Pinned one-bucket vector changed');
  const additional = [
    Buffer.from('c9a3f86aae465f0e56513864510f3997561fa2c9e85ea21dc2292309f3cd6022', 'hex'),
    Buffer.from('d4b4f5784868c3020403246717ec169ff79e26608ea126a1ab69ee77d1b16712', 'hex'),
  ];
  const scope = {
    shopId: 'synthetic',
    installationGeneration: '1',
    authorizationGeneration: one.header.generationHex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5'),
    authorizationEpoch: one.header.epoch,
  };
  const variants: Record<string, PublicSigningKey['state'][]> = {
    active: ['active', 'retiring', 'revoked'],
    retiring: ['retiring', 'active', 'revoked'],
    revoked: ['revoked', 'active', 'retiring'],
  };
  const rows: {
    state: string;
    target: (typeof TARGETS)[number];
    operations: number;
    expected: number;
    configSha256: string;
    inputSha256: string;
    wasmSha256: string;
  }[] = [];
  for (const [name, states] of Object.entries(variants)) {
    const config = buildPublicConfig({
      scope,
      keys: states.map((state, index) => ({
        id: 7 + index,
        publicKey: index === 0 ? Buffer.from(vectors.publicHex, 'hex') : required(additional[index - 1]),
        state,
        firstDay: 20800,
        lastDay: 20804,
      })),
    });
    for (const target of TARGETS) {
      const input = fixture(target),
        header = one.header,
        member = required(one.members[0]),
        line = required(input.cart.lines[0]);
      line.id = 'gid://shopify/CartLine/1';
      line.quantity = member.quantity;
      line.member = { value: required(one.memberCarriers[0]) };
      line.merchandise.id = `gid://shopify/ProductVariant/${member.variantId}`;
      line.merchandise.product.id = 'gid://shopify/Product/42';
      line.merchandise.product.policy = { value: `${header.generationHex}:1:required` };
      line.merchandise.product.registration = { value: `${header.generationHex}:1:ready` };
      line.cost.amountPerQuantity.currencyCode = header.currency;
      if (target === 'validation') line.cost.subtotalAmount = { amount: '19.99', currencyCode: header.currency };
      input.cart.lines = [line];
      input.cart.quote = { value: one.envelope };
      input.shop.publicConfig.value = config.value;
      input.shop.localTime.date = '2026-12-13';
      input.localization.country.isoCode = header.country;
      input.localization.market.id = `gid://shopify/Market/${header.marketId}`;
      const result = invoke(target, input, runner, join(targetPaths(target).extension, 'target')),
        operations = result.output.operations.length,
        expected = name === 'revoked' ? (target === 'validation' ? 1 : 0) : target === 'transform' ? 1 : 0;
      assert.equal(operations, expected, `Function rejected builder projection for ${name}/${target}`);
      rows.push({
        state: name,
        target,
        operations,
        expected,
        configSha256: hash(config.value),
        inputSha256: hash(JSON.stringify(input)),
        wasmSha256: hash(readFileSync(targetPaths(target).wasm)),
      });
    }
  }
  return { version: 1, rows };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = publicConfigReplay(
    resolve(ROOT, process.env.INSIGNIA_FUNCTION_RUNNER ?? '.m1-artifacts/tools/function-runner-9.2.2'),
  );
  mkdirSync(join(ROOT, '.m1-artifacts'), { recursive: true });
  writeFileSync(join(ROOT, '.m1-artifacts/m4-003-public-config-replay.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Production builder config passed ${result.rows.length} complete Function runs.`);
}
