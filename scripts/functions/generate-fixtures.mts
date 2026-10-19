/** Reproduce local-only v2 capacity fixtures from a labelled synthetic key; no runtime credentials. */
import assert from 'node:assert/strict';
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compact, fixture, publicConfig, ROOT, required, TARGETS, type Target } from './runtime.mts';

const DOMAIN = Buffer.from('Insignia\0WholeQuoteAuthorization\0v2\0');
// Never use this synthetic seed for runtime keys.
const key = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, 1)]),
  format: 'der',
  type: 'pkcs8',
});
export function generatedFixture(target: Target, count: number, ordinary: number, quantity = 1) {
  const base = fixture(target),
    header = Buffer.from(required(base.cart.quote).value, 'base64url').subarray(0, 92);
  header.writeUInt16BE(count, 60);
  header.writeUInt32BE(count * quantity, 80);
  header.writeBigUInt64BE(BigInt(count * quantity) * 3033n, 84);
  const records: Buffer[] = [],
    lines: typeof base.cart.lines = [];
  for (let index = 0; index < count; index++) {
    const member = Buffer.alloc(22);
    member.writeUInt16BE(index, 0);
    member.writeBigUInt64BE(9007199254740993n, 2);
    member.writeUInt32BE(quantity, 10);
    member.writeBigUInt64BE(3033n, 14);
    records.push(member);
    const line = structuredClone(required(base.cart.lines[0]));
    line.id = `gid://shopify/CartLine/${index}`;
    line.quantity = quantity;
    line.member = { value: member.toString('base64url') };
    if (target === 'validation')
      required(line.cost.subtotalAmount).amount =
        `${Math.floor((quantity * 3033) / 100)}.${((quantity * 3033) % 100).toString().padStart(2, '0')}`;
    lines.push(line);
  }
  for (let index = 0; index < ordinary; index++) {
    const line = structuredClone(required(base.cart.lines[0]));
    line.id = `gid://shopify/CartLine/${count + index}`;
    line.quantity = 1;
    line.member = null;
    line.merchandise.product.registration = null;
    line.merchandise.product.policy = null;
    if (target === 'validation') required(line.cost.subtotalAmount).amount = '10.00';
    lines.push(line);
  }
  const signature = sign(null, Buffer.concat([DOMAIN, header, ...records]), key);
  base.cart.quote = { value: Buffer.concat([header, signature]).toString('base64url') };
  base.cart.lines = lines;
  const config = publicConfig(base.shop.publicConfig.value);
  config.maxBuckets = count;
  base.shop.publicConfig.value = compact(config).toString();
  return base;
}
export function generateFixtures(checkOnly = false): void {
  for (const target of TARGETS)
    for (const [name, count, ordinary, quantity] of [
      ['32-signed-168-ordinary', 32, 168, 1],
      ['33-signed-0-ordinary', 33, 0, 1],
      ['10k-physical', 2, 0, 5000],
    ] as const) {
      const path = join(ROOT, `crates/cart-${target}/fixtures/${name}.json`),
        bytes = Buffer.concat([compact(generatedFixture(target, count, ordinary, quantity)), Buffer.from('\n')]);
      if (checkOnly) assert.deepEqual(readFileSync(path), bytes, `Synthetic fixture drift: ${path}`);
      else writeFileSync(path, bytes);
    }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  generateFixtures(process.argv.includes('--check'));
