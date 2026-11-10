/** Offline semantic replay of the actual built cart-line v3 Functions. */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  array,
  compact,
  evidence,
  type FunctionInput,
  fixture,
  hash,
  invoke,
  ROOT,
  record,
  required,
  type Target,
  targetPaths,
  text,
} from './runtime.mts';
export type SemanticCase = {
  case: string;
  operations: number;
  inputBytes: number;
  outputJsonBytes: number;
  instructions: number;
  memoryUsage: number;
};
export type SemanticEvidence = {
  sourceSha256: string;
  querySha256: string;
  schemaSha256: string;
  rawWasmSha256: string;
  finalWasmSha256: string;
  rawWasmBytes: number;
  finalWasmBytes: number;
  cases: SemanticCase[];
};
function replayTarget(target: Target, runner: string): SemanticEvidence {
  const records: SemanticCase[] = [];
  function check(name: string, payload: FunctionInput, expected: number, prices?: string[]) {
    const result = invoke(target, payload, runner, join(targetPaths(target).extension, 'target')),
      operations = result.output.operations;
    assert.equal(operations.length, expected, `${target}/${name}`);
    if (prices) {
      const actual = operations.map((value) => {
        const expanded = record(record(value).lineExpand),
          item = record(array(expanded.expandedCartItems)[0]);
        return text(record(record(record(item.price).adjustment).fixedPricePerUnit).amount);
      });
      assert.deepEqual(actual, prices, `${target}/${name}`);
    }
    records.push({
      case: name,
      operations: operations.length,
      inputBytes: compact(payload).length,
      outputJsonBytes: compact(result.output).length,
      instructions: result.instructions,
      memoryUsage: result.memoryUsage,
    });
  }
  const base = fixture(target),
    other = fixture(target, '33-signed-0-ordinary'),
    transform = target === 'transform',
    rejected = transform ? 0 : 1;
  const carrierOf = (input: FunctionInput, index: number) => required(required(input.cart.lines[index]).line).value;
  for (const step of transform ? [undefined] : ['CHECKOUT_INTERACTION', 'CHECKOUT_COMPLETION']) {
    const label = step ?? 'cart',
      valid = structuredClone(base);
    if (step) valid.buyerJourney = { step };
    check(`valid-${label}`, valid, transform ? 2 : 0, transform ? ['30.33', '30.34'] : undefined);
    const zero = structuredClone(valid);
    required(zero.cart.lines[0]).id = 'gid://shopify/CartLine/0';
    check(`canonical-zero-${label}`, zero, transform ? 2 : 0, transform ? ['30.33', '30.34'] : undefined);
    // Native theme edits: quantity change and removal keep each signed unit price.
    const changed = structuredClone(valid),
      first = required(changed.cart.lines[0]);
    first.quantity = 5;
    if (!transform) required(first.cost.subtotalAmount).amount = '151.65';
    check(`quantity-changed-${label}`, changed, transform ? 2 : 0, transform ? ['30.33', '30.34'] : undefined);
    const subset = structuredClone(valid);
    subset.cart.lines.pop();
    check(`one-line-subset-${label}`, subset, transform ? 1 : 0, transform ? ['30.33'] : undefined);
    const missing = structuredClone(valid);
    required(missing.cart.lines[1]).line = null;
    check(`unmarked-required-${label}`, missing, rejected);
    const duplicate = structuredClone(valid);
    required(duplicate.cart.lines[1]).line = { value: carrierOf(valid, 0) };
    check(`duplicate-${label}`, duplicate, rejected);
    const mixed = structuredClone(valid);
    required(mixed.cart.lines[1]).line = { value: carrierOf(other, 32) };
    check(`two-sets-${label}`, mixed, rejected);
    const legacy = structuredClone(valid);
    required(legacy.cart.lines[1]).legacy = { value: 'AAEAIAAAAAAAAQAAAAEAAAAAAAAL2g' };
    check(`legacy-v2-line-${label}`, legacy, rejected);
    const forged = structuredClone(valid),
      bytes = Buffer.from(carrierOf(valid, 1));
    bytes[236 + 30] = bytes[236 + 30] === 65 ? 66 : 65;
    required(forged.cart.lines[1]).line = { value: bytes.toString() };
    check(`forged-proof-${label}`, forged, rejected);
    const altered = structuredClone(valid);
    required(altered.cart.lines[1]).line = { value: 'bad' };
    check(`altered-${label}`, altered, rejected);
    if (!transform) {
      const underpriced = structuredClone(valid);
      required(required(underpriced.cart.lines[0]).cost.subtotalAmount).amount = '60.64';
      check(`underpriced-${label}`, underpriced, 1);
      const unsigned = structuredClone(valid);
      for (const line of unsigned.cart.lines) line.line = null;
      check(`unsigned-required-${label}`, unsigned, 1);
      const plain = structuredClone(unsigned);
      for (const line of plain.cart.lines) line.merchandise.product.policy = { value: `${'1'.repeat(32)}:1:optional` };
      check(`unmarked-optional-plain-${label}`, plain, 0);
    }
  }
  if (!transform) {
    const repair = structuredClone(base);
    repair.buyerJourney = { step: 'CART_INTERACTION' };
    required(repair.cart.lines[0]).line = { value: 'bad' };
    check('cart-repair', repair, 0);
  }
  check('10-plus-190', fixture(target, '10-signed-190-ordinary'), transform ? 10 : 0);
  check('32-plus-168', fixture(target, '32-signed-168-ordinary'), transform ? 32 : 0);
  check('33-over-cap-rejected', other, rejected);
  check(
    '10000-physical-units',
    fixture(target, '10k-physical'),
    transform ? 2 : 0,
    transform ? ['30.33', '30.33'] : undefined,
  );
  const over = fixture(target, '10k-physical'),
    overLine = required(over.cart.lines[0]);
  overLine.quantity = 5001;
  if (!transform) required(overLine.cost.subtotalAmount).amount = '151680.33';
  check('10001-physical-units-rejected', over, rejected);
  const sourceFiles = [join(ROOT, 'crates/cart-authorization/src'), join(ROOT, `crates/cart-${target}/src`)].flatMap(
    (directory) =>
      readdirSync(directory)
        .filter((name) => name.endsWith('.rs'))
        .sort()
        .map((name) => join(directory, name)),
  );
  const sourceSha256 = hash(
    Buffer.concat(sourceFiles.flatMap((path) => [Buffer.from(`${relative(ROOT, path)}\0`), readFileSync(path)])),
  );
  const current = evidence(target);
  return {
    sourceSha256,
    querySha256: current.querySha256,
    schemaSha256: current.schemaSha256,
    rawWasmSha256: current.rawWasmSha256,
    finalWasmSha256: current.finalWasmSha256,
    rawWasmBytes: current.rawWasmBytes,
    finalWasmBytes: current.finalWasmBytes,
    cases: records,
  };
}
export function semanticReplay(runner: string): Record<Target, SemanticEvidence> {
  return { transform: replayTarget('transform', runner), validation: replayTarget('validation', runner) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(semanticReplay(text(process.env.INSIGNIA_FUNCTION_RUNNER)), null, 2));
