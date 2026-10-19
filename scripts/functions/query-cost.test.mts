import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { calculatedQueryCost } from './query-cost.mts';
import { TARGETS, targetPaths } from './runtime.mts';

const schema =
  'type Query { shop: Shop } type Shop { value: String, metafield(namespace: String, key: String): Metafield, hasAnyTag: Boolean } type Metafield { value: String, type: String }';
test('current production queries parse and remain within the actual schema/cost envelope', () => {
  for (const target of TARGETS) {
    const paths = targetPaths(target),
      cost = calculatedQueryCost(readFileSync(paths.query, 'utf8'), readFileSync(paths.schema, 'utf8'));
    assert(cost > 0 && cost <= 30);
  }
});
test('aliases and inline fragments preserve Metafield cost while special/invalid/unqualified grammar rejects', () => {
  assert.equal(
    calculatedQueryCost(
      'query Input { shop { alias: metafield(namespace:"x", key:"y") { value type } ... on Shop { value } } }',
      schema,
    ),
    4,
  );
  assert.throws(() => calculatedQueryCost('query Input { shop { hasAnyTag } }', schema), /special cost/);
  assert.throws(() => calculatedQueryCost('query Input { shop { missing } }', schema), /Cannot query field/);
  assert.throws(() => calculatedQueryCost('query Input { shop { value', schema));
  assert.throws(
    () => calculatedQueryCost('query Input { shop { ...Values } } fragment Values on Shop { value }', schema),
    /One query/,
  );
});
