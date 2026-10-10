import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectInventory } from './collector.mjs';

const identity = {
  shop: { id: 'gid://shopify/Shop/123', myshopifyDomain: 'insignia-rewrite-dev.myshopify.com' },
  currentAppInstallation: {
    id: 'gid://shopify/AppInstallation/456',
    app: { id: 'gid://shopify/App/429028933633', apiKey: '1443cf6d03d39edae7c101a943c5c684' },
    accessScopes: [{ handle: 'write_products' }],
  },
};
function allocation(directory) {
  return {
    schema: 'insignia-native-inventory-allocation-v2',
    status: 'OWNER_ALLOCATED',
    ownerApprovalReference: 'SYNTHETIC',
    purpose: 'M5-027 existing shop subscription read',
    endpoint: 'https://insignia-rewrite-dev.myshopify.com/admin/api/2026-07/graphql.json',
    expectedShopId: null,
    expectedInstallationId: null,
    expectedGrants: ['write_products'],
    requiredScopes: [],
    optionalScopes: ['write_products', 'read_publications', 'read_product_listings'],
    allowedOperations: ['M5027WebhookInventory', 'M5027InstallationBoundary'],
    allowedMutations: [],
    incidentalEffects: ['provider-access-audit'],
    privateCredentialChannel: 'private-process-pipe-and-memory',
    credentialCapability: 'EXISTING_SUPPORTED_EXACT_APP_ADMIN_TOKEN',
    privateEvidenceDirectory: directory,
    retentionOwner: 'synthetic-owner',
    retentionDeleteBy: new Date(Date.now() + 86400000).toISOString(),
    validUntil: new Date(Date.now() + 1800000).toISOString(),
    ceilings: {
      requests: 3,
      pages: 2,
      records: 500,
      responseBytes: 1048576,
      durationMs: 1800000,
      responseTimeoutMs: 1000,
    },
  };
}
test('inventory-only v2 discovers authoritative identity once then fences exact final boundary', async (t) => {
  const p = await mkdtemp(join(tmpdir(), 'insignia-discovery-'));
  t.after(() => rm(p, { recursive: true, force: true }));
  let calls = 0;
  const r = await collectInventory({
    allocation: allocation(join(p, 'run')),
    token: 'synthetic-private-token',
    privateDirectory: join(p, 'run'),
    transport: async () => {
      calls++;
      return {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-shopify-api-version': '2026-07' },
        body: Buffer.from(
          JSON.stringify({
            data: {
              ...identity,
              ...(calls === 1
                ? { webhookSubscriptions: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }
                : {}),
            },
          }),
        ),
      };
    },
  });
  assert.equal(r.outcome, 'COLLECTION_COMPLETE_NATIVE_SAFETY_UNQUALIFIED');
  assert.equal(calls, 2);
});

test('inventory v2 requires explicit private transport before evidence or dispatch', async (t) => {
  const p = await mkdtemp(join(tmpdir(), 'insignia-missing-transport-'));
  t.after(() => rm(p, { recursive: true, force: true }));
  const r = await collectInventory({
    allocation: allocation(join(p, 'run')),
    token: 'synthetic-private-token',
    privateDirectory: join(p, 'run'),
    fetchImpl: () => {
      throw Error('must not run');
    },
  });
  assert.equal(r.outcome, 'STOP_MISSING_PRIVATE_TRANSPORT');
  assert.equal(r.requests, 0);
});
test('discovered provider installation cannot drift at final boundary', async (t) => {
  const p = await mkdtemp(join(tmpdir(), 'insignia-identity-drift-'));
  t.after(() => rm(p, { recursive: true, force: true }));
  let calls = 0;
  const r = await collectInventory({
    allocation: allocation(join(p, 'run')),
    token: 'synthetic-private-token',
    privateDirectory: join(p, 'run'),
    transport: async () => {
      calls++;
      const data = structuredClone(identity);
      if (calls === 1) data.webhookSubscriptions = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
      else data.currentAppInstallation.id = 'gid://shopify/AppInstallation/999';
      return {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-shopify-api-version': '2026-07' },
        body: Buffer.from(JSON.stringify({ data })),
      };
    },
  });
  assert.equal(r.outcome, 'STOP_IDENTITY_OR_GRANT_DRIFT');
  assert.equal(r.requests, 2);
  assert.equal(calls, 2);
});

test('inventory v2 accepts truthful private pipe/memory channel and rejects inherited-FD label', async (t) => {
  for (const channel of ['private-process-pipe-and-memory', 'inherited-file-descriptor']) {
    const p = await mkdtemp(join(tmpdir(), 'insignia-channel-v2-'));
    t.after(() => rm(p, { recursive: true, force: true }));
    let calls = 0;
    const a = allocation(join(p, 'run'));
    a.privateCredentialChannel = channel;
    const r = await collectInventory({
      allocation: a,
      token: 'synthetic-private-token',
      privateDirectory: join(p, 'run'),
      transport: async () => {
        calls++;
        return {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-shopify-api-version': '2026-07' },
          body: Buffer.from(
            JSON.stringify({
              data: {
                ...identity,
                ...(calls === 1
                  ? { webhookSubscriptions: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }
                  : {}),
              },
            }),
          ),
        };
      },
    });
    assert.equal(
      r.outcome,
      channel === 'private-process-pipe-and-memory'
        ? 'COLLECTION_COMPLETE_NATIVE_SAFETY_UNQUALIFIED'
        : 'STOP_INPUT_NOT_ALLOCATED',
    );
    assert.equal(calls, channel === 'private-process-pipe-and-memory' ? 2 : 0);
  }
});
test('historical inventory v1 refuses the v2 pipe/memory label before transport', async (t) => {
  const p = await mkdtemp(join(tmpdir(), 'insignia-channel-v1-'));
  t.after(() => rm(p, { recursive: true, force: true }));
  const a = allocation(join(p, 'run'));
  a.schema = 'insignia-native-inventory-allocation-v1';
  a.expectedShopId = identity.shop.id;
  a.expectedInstallationId = identity.currentAppInstallation.id;
  a.privateCredentialChannel = 'private-process-pipe-and-memory';
  const r = await collectInventory({
    allocation: a,
    token: 'synthetic-private-token',
    privateDirectory: join(p, 'run'),
  });
  assert.equal(r.outcome, 'STOP_INPUT_NOT_ALLOCATED');
  assert.equal(r.requests, 0);
});
