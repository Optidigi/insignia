import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildPublicConfig } from '../../packages/application/dist/index.js';

const root = resolve(import.meta.dirname, '../..');
const runner = resolve(root, process.env.M1_FUNCTION_RUNNER ?? '.m1-artifacts/tools/function-runner-9.2.2');
const vectors = JSON.parse(readFileSync(resolve(root, 'packages/cart-authorization/fixtures/whole-quote-v2.json'), 'utf8'));
const caseOne = vectors.cases.find((item) => item.name === 'one_bucket');
if (!caseOne || caseOne.header.keyId !== 7 || caseOne.members.length !== 1) throw new Error('Pinned one-bucket vector changed');
// Deterministic public-only Ed25519 group points; no synthetic private seed is stored.
const additional = [
  Buffer.from('c9a3f86aae465f0e56513864510f3997561fa2c9e85ea21dc2292309f3cd6022', 'hex'),
  Buffer.from('d4b4f5784868c3020403246717ec169ff79e26608ea126a1ab69ee77d1b16712', 'hex'),
];
const uuid = caseOne.header.generationHex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
const scope = {
  shopId: 'synthetic', installationGeneration: '1',
  authorizationGeneration: uuid, authorizationEpoch: caseOne.header.epoch,
};
const variants = {
  active: ['active', 'retiring', 'revoked'],
  retiring: ['retiring', 'active', 'revoked'],
  revoked: ['revoked', 'active', 'retiring'],
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const temporary = mkdtempSync(join(tmpdir(), 'insignia-m4-003-function-'));
const rows = [];
try {
  for (const [name, states] of Object.entries(variants)) {
    const config = buildPublicConfig({ scope, keys: states.map((state, index) => ({
      id: 7 + index,
      publicKey: index === 0 ? Buffer.from(vectors.publicHex, 'hex') : additional[index - 1],
      state,
      firstDay: 20800,
      lastDay: 20804,
    })) });
    for (const target of ['transform', 'validation']) {
      const extension = resolve(root, `extensions/insignia-cart-${target}`);
      const input = JSON.parse(readFileSync(resolve(root, `crates/cart-${target}/fixtures/valid.json`), 'utf8'));
      const header = caseOne.header;
      const member = caseOne.members[0];
      const line = input.cart.lines[0];
      line.id = 'gid://shopify/CartLine/1';
      line.quantity = member.quantity;
      line.member = { value: caseOne.memberCarriers[0] };
      line.merchandise.id = `gid://shopify/ProductVariant/${member.variantId}`;
      line.merchandise.product.id = 'gid://shopify/Product/42';
      line.merchandise.product.policy = { value: `${header.generationHex}:1:required` };
      line.merchandise.product.registration = { value: `${header.generationHex}:1:ready` };
      line.cost.amountPerQuantity.currencyCode = header.currency;
      if (target === 'validation') line.cost.subtotalAmount = { amount: '19.99', currencyCode: header.currency };
      input.cart.lines = [line];
      input.cart.quote = { value: caseOne.envelope };
      input.shop.publicConfig.value = config.value;
      input.shop.localTime.date = '2026-12-13';
      input.localization.country.isoCode = header.country;
      input.localization.market.id = `gid://shopify/Market/${header.marketId}`;
      const inputPath = join(temporary, `${name}-${target}.json`);
      writeFileSync(inputPath, JSON.stringify(input));
      const wasm = resolve(extension, `target/cart-${target}.wasm`);
      const query = resolve(extension, 'src', target === 'transform'
        ? 'cart_transform_run.graphql' : 'cart_validations_generate_run.graphql');
      const exportName = target === 'transform' ? 'cart_transform_run' : 'cart_validations_generate_run';
      const run = spawnSync(runner, ['-f', wasm, '-i', inputPath, '-e', exportName,
        '-q', query, '-s', resolve(extension, 'schema.graphql'), '-j'], { encoding: 'utf8' });
      if (run.status !== 0) throw new Error(`Function runner failed for ${name}/${target}`);
      const result = JSON.parse(run.stdout);
      if (!result.success) throw new Error(`Function execution failed for ${name}/${target}`);
      const operations = result.output?.operations?.length;
      const expected = name === 'revoked' ? (target === 'validation' ? 1 : 0) : (target === 'transform' ? 1 : 0);
      if (operations !== expected) throw new Error(`Function rejected builder projection contract for ${name}/${target}`);
      rows.push({ state: name, target, operations, expected, configSha256: hash(config.value),
        inputSha256: hash(readFileSync(inputPath)), wasmSha256: hash(readFileSync(wasm)) });
    }
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
const destination = resolve(root, '.m1-artifacts/m4-003-public-config-replay.json');
writeFileSync(destination, `${JSON.stringify({ version: 1, rows }, null, 2)}\n`);
process.stdout.write(`M4-003 production builder config passed ${rows.length} complete Function runs.\n`);
