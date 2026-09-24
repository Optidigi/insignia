import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";
import {
  buildFunction,
  getFunctionInfo,
  loadFixture,
  loadInputQuery,
  loadSchema,
  runFunction,
  validateTestAssets,
} from "@shopify/shopify-function-test-helpers";

const suiteDir = path.dirname(fileURLToPath(import.meta.url));
const functionDir = path.resolve(suiteDir, "../../extensions/m0-001-same-variant");
const fixturesDir = path.join(suiteDir, "fixtures");
const fixtures = fs.readdirSync(fixturesDir).filter((name) => name.endsWith(".json")).sort();

function exactMinorUnits(decimal) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(decimal);
  if (!match) throw new Error(`Unsupported fixture decimal: ${decimal}`);
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
}

describe("M0-001 Cart Transform Wasm", () => {
  let schema;
  let info;

  beforeAll(async () => {
    await buildFunction(functionDir);
    info = await getFunctionInfo(functionDir);
    schema = await loadSchema(info.schemaPath);
  }, 120_000);

  for (const name of fixtures) {
    test(name, async () => {
      const fixture = await loadFixture(path.join(fixturesDir, name));
      const queryPath = info.targeting[fixture.target].inputQueryPath;
      const query = await loadInputQuery(queryPath);
      const validation = await validateTestAssets({ schema, fixture, inputQueryAST: query });
      expect(validation.inputQuery.errors).toEqual([]);
      expect(validation.inputFixture.errors).toEqual([]);
      expect(validation.outputFixture.errors).toEqual([]);
      const actual = await runFunction(fixture, info.functionRunnerPath, info.wasmPath, queryPath, info.schemaPath);
      expect(actual.error).toBeNull();
      expect(actual.result.output).toEqual(fixture.expectedOutput);
      for (const operation of actual.result.output.operations) {
        const amount = operation.lineExpand.expandedCartItems[0].price.adjustment.fixedPricePerUnit.amount;
        expect(exactMinorUnits(amount)).toBe(3000n);
      }
    }, 20_000);
  }
});
