import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GraphQLPolicyTransport, READ_PRODUCT_POLICY, WRITE_PRODUCT_POLICY } from './graphql.ts';
import type { GraphQLClient } from './graphql.ts';
import type { PublishIntent } from './publisher.ts';

const intent: PublishIntent = {
  operationId: 'synthetic-1', ownerId: 'gid://shopify/Product/42', namespace: 'app--12345',
  generationHex: '1'.repeat(32), revision: 1, mode: 'required', previousMode: null,
  expectedPriorDigests: { registration: null, policy: null }
};
function field(key: string, value: string) {
  return { id: 'gid://shopify/Metafield/9', namespace: intent.namespace, key,
    type: 'single_line_text_field', value, compareDigest: 'a'.repeat(64), owner: { __typename: 'Product' } };
}

test('pinned 2026-07 product read maps owner, namespace, key, type and digest', async () => {
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  const client: GraphQLClient = { execute: async (query, variables) => {
    calls.push({ query, variables });
    return { data: { product: { id: intent.ownerId,
      registration: field('m0_007_registration', `${intent.generationHex}:1:ready`),
      policy: field('m0_007_policy', `${intent.generationHex}:1:required`) } } };
  } };
  const result = await new GraphQLPolicyTransport(client).read(intent);
  assert.equal(result.policy?.value, `${intent.generationHex}:1:required`);
  assert.equal(result.registration?.digest, 'a'.repeat(64));
  assert.equal(calls[0]?.query, READ_PRODUCT_POLICY);
  assert.deepEqual(calls[0]?.variables, { ownerId: intent.ownerId, namespace: intent.namespace });
});

test('create-only null CAS is sent explicitly; success ack still requires separate readback', async () => {
  let variables: Record<string, unknown> = {};
  const client: GraphQLClient = { execute: async (query, v) => {
    assert.equal(query, WRITE_PRODUCT_POLICY); variables = v;
    return { data: { metafieldsSet: { metafields: [field('m0_007_registration', `${intent.generationHex}:1:pending`)], userErrors: [] } } };
  } };
  const result = await new GraphQLPolicyTransport(client).set(intent, 'registration', `${intent.generationHex}:1:pending`, null);
  assert.deepEqual(result, { kind: 'ack' });
  assert.deepEqual(variables, { metafields: [{ ownerId: intent.ownerId, namespace: '$app',
    key: 'm0_007_registration', type: 'single_line_text_field',
    value: `${intent.generationHex}:1:pending`, compareDigest: null }] });
});

test('nullable metafields with Shopify stale CAS user error is classified before success payload', async () => {
  const client: GraphQLClient = { execute: async () => ({ data: { metafieldsSet: {
    metafields: null, userErrors: [{ code: 'STALE_OBJECT', message: 'synthetic stale' }] } } }) };
  assert.deepEqual(await new GraphQLPolicyTransport(client).set(intent, 'registration', 'x', null),
    { kind: 'user-errors', errors: [{ code: 'STALE_OBJECT', message: 'synthetic stale' }] });
});

test('wrong namespace, owner and malformed acknowledgement are rejected', async () => {
  for (const mutation of [
    (x: Record<string, unknown>) => ({ ...x, namespace: 'app--other' }),
    (x: Record<string, unknown>) => ({ ...x, owner: { __typename: 'Shop' } }),
    (x: Record<string, unknown>) => ({ ...x, value: 'different' })
  ]) {
    const client: GraphQLClient = { execute: async () => ({ data: { metafieldsSet: {
      metafields: [mutation(field('m0_007_policy', 'desired'))], userErrors: [] } } }) };
    await assert.rejects(() => new GraphQLPolicyTransport(client).set(intent, 'policy', 'desired', null));
  }
});
