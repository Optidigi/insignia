/** Offline semantic replay of the actual built whole-quote v2 Functions. */
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
  const base = fixture(target);
  for (const step of target === 'validation' ? ['CHECKOUT_INTERACTION', 'CHECKOUT_COMPLETION'] : [undefined]) {
    const label = step ?? 'cart',
      valid = structuredClone(base);
    if (step) valid.buyerJourney = { step };
    check(
      `valid-${label}`,
      valid,
      target === 'transform' ? 2 : 0,
      target === 'transform' ? ['30.33', '30.34'] : undefined,
    );
    const zero = structuredClone(valid);
    required(zero.cart.lines[0]).id = 'gid://shopify/CartLine/0';
    check(
      `canonical-zero-${label}`,
      zero,
      target === 'transform' ? 2 : 0,
      target === 'transform' ? ['30.33', '30.34'] : undefined,
    );
    const missing = structuredClone(valid);
    missing.cart.lines.pop();
    check(`missing-${label}`, missing, target === 'transform' ? 0 : 1);
    const duplicate = structuredClone(valid);
    required(duplicate.cart.lines[1]).member = structuredClone(required(duplicate.cart.lines[0]).member);
    check(`duplicate-${label}`, duplicate, target === 'transform' ? 0 : 1);
    const altered = structuredClone(valid);
    required(altered.cart.lines[1]).member = { value: 'bad' };
    check(`altered-${label}`, altered, target === 'transform' ? 0 : 1);
    if (target === 'validation') {
      const underpriced = structuredClone(valid);
      required(required(underpriced.cart.lines[0]).cost.subtotalAmount).amount = '60.64';
      check(`underpriced-${label}`, underpriced, 1);
      const unsigned = structuredClone(valid);
      unsigned.cart.quote = null;
      for (const line of unsigned.cart.lines) line.member = null;
      check(`unsigned-required-${label}`, unsigned, 1);
    }
  }
  if (target === 'validation') {
    const repair = structuredClone(base);
    repair.buyerJourney = { step: 'CART_INTERACTION' };
    required(repair.cart.lines[0]).member = { value: 'bad' };
    check('cart-repair', repair, 0);
  }
  check('32-plus-168', fixture(target, '32-signed-168-ordinary'), target === 'transform' ? 32 : 0);
  check('33-rejected', fixture(target, '33-signed-0-ordinary'), target === 'transform' ? 0 : 1);
  check(
    '10000-physical-units',
    fixture(target, '10k-physical'),
    target === 'transform' ? 2 : 0,
    target === 'transform' ? ['30.33', '30.33'] : undefined,
  );
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
