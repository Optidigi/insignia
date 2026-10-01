import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createShopifyAvailabilityHoldPort } from './availability-hold.ts';

// Execute the complete, unchanged adapter and the exact admission callback.
// The callback's store and clock are synthetic; this does not execute PostgreSQL.
const expectedBlobs = {
  'availability-hold.ts': '4685b97caffa3b7c98600bceda5af9e5ff0f9d44',
  'production-activation.ts': '15c9a83b957065b41bfb06eab929b9aaace6aa53',
};
const verified = {};
for (const [file, expected] of Object.entries(expectedBlobs)) {
  const bytes = readFileSync(new URL(file, import.meta.url));
  const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  assert.equal(blob, expected, `Source mismatch: ${file}`);
  verified[file] = { bytes: bytes.length, gitBlob: blob, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const source = readFileSync(new URL('production-activation.ts', import.meta.url), 'utf8');
const start = source.indexOf('established: async (identity) => {') + 'established: '.length;
const end = source.indexOf('\n    },\n  });', start) + '\n    }'.length;
assert.ok(start > 0 && end > start, 'Exact callback not found');
const callbackSource = source.slice(start, end);
const scope = {
  shopId: 'synthetic-shop', installationGeneration: '1',
  shopifyShopId: 'gid://shopify/Shop/101', appClientId: 'a'.repeat(32),
};
const productId = 'gid://shopify/Product/202';
const epoch = Date.parse('2026-10-01T12:00:00.000Z');
const product = (status) => ({
  __typename: 'Product', id: productId, status,
  updatedAt: '2026-10-01T11:00:00.000Z', publishedAt: null, onlineStoreUrl: null,
  resourcePublications: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
  unpublishedPublications: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
});
function fixture(status, delays) {
  let at = epoch, reads = 0, capturedAt = null;
  const now = () => new Date(at);
  const port = createShopifyAvailabilityHoldPort({
    now, timeoutMs: 8000,
    isCurrent: async () => true,
    credentials: { acquire: async () => ({
      kind: 'usable', shopDomain: 'synthetic.myshopify.com', accessToken: 'synthetic-not-a-credential',
      accessExpiresAt: new Date('2099-01-01T00:00:00Z'),
    }) },
    fetchImpl: async (_url, init) => {
      assert.ok(JSON.parse(init.body).query.startsWith('query'), 'No mutation is permitted by this probe');
      capturedAt = at;
      const payload = JSON.stringify({ data: {
        shop: { id: scope.shopifyShopId },
        currentAppInstallation: { app: { apiKey: scope.appClientId },
          accessScopes: [{ handle: 'read_products' }, { handle: 'write_products' }] },
        node: product(status),
      } });
      // The payload is captured before the controlled transport delay.
      // Advance only the injected clock, rather than sleeping or touching a provider.
      at += delays[reads++] ?? 0;
      return new Response(payload, { status: 200 });
    },
  });
  return { port, now, capturedAt: () => capturedAt, reads: () => reads };
}
// Exact application digest behavior on this all-string plain scope object.
const scopeDigest = (value) => createHash('sha256').update(`{${Object.keys(value).sort().map(
  key => `${JSON.stringify(key)}:${JSON.stringify(value[key])}`).join(',')}}`).digest('hex');
async function admission(delay) {
  const f = fixture('DRAFT', [0, delay]);
  const before = await f.port.snapshot(scope, productId);
  const hold = { version: 'm5-availability-hold-v1', operationId: 'synthetic-operation', before, held: before };
  let observed;
  const options = {
    appClientId: scope.appClientId, maxObservationAgeMs: 1000,
    availability: { observe: async (...args) => (observed = await f.port.observe(...args)) },
  };
  const store = { read: async () => ({ state: { kind: 'HELD', hold } }) };
  const established = new Function('store', 'options', 'now', 'activationDigest', `return (${callbackSource});`)(
    store, options, f.now, scopeDigest);
  const accepted = await established({
    shopId: scope.shopId, configId: 'synthetic-config', operationId: hold.operationId,
    installationGeneration: '1', productId,
  });
  return {
    transportDelayMs: delay, freshnessBudgetMs: 1000, admissionAccepted: accepted,
    payloadCapturedAt: new Date(f.capturedAt()).toISOString(),
    adapterObservedAt: observed.current.observedAt, decisionAt: f.now().toISOString(),
    reportedAgeMs: f.now().getTime() - Date.parse(observed.current.observedAt),
    actualControlledPayloadAgeMs: f.now().getTime() - f.capturedAt(),
    syntheticReadAttempts: f.reads(),
  };
}
const immediate = await admission(0);
const delayed = await admission(2000);
const statuses = [];
for (const status of ['ACTIVE', 'DRAFT', 'ARCHIVED', 'UNLISTED', 'NOT_A_SHOPIFY_STATUS']) {
  const f = fixture(status, [0]);
  try {
    const value = await f.port.snapshot(scope, productId);
    statuses.push({ status, accepted: true, normalizedState: value.state });
  } catch (error) {
    statuses.push({ status, accepted: false, errorKind: error.kind, message: error.message });
  }
}
assert.equal(immediate.admissionAccepted, true);
assert.equal(statuses.at(-1).accepted, false);
const result = {
  kind: 'principal-offline-fixed-source-characterization',
  head: 'a426719e5350f61ecb5620f6c90ab7a0e365e66b', node: process.version,
  sourceVerification: verified,
  executedScope: 'Complete adapter with synthetic HTTP; exact admission callback with a synthetic store and clock',
  exclusions: ['No full workspace suite', 'No PostgreSQL transaction', 'No Shopify or other provider request', 'No code correction'],
  immediateControl: immediate, delayedObservation: delayed, statuses,
  findings: {
    R1: delayed.admissionAccepted && delayed.actualControlledPayloadAgeMs > delayed.freshnessBudgetMs,
    R2: statuses.find(row => row.status === 'UNLISTED').accepted === false,
  },
};
console.log(JSON.stringify(result, null, 2));
if (process.argv.includes('--assert-contract') || process.argv.includes('--assert-freshness')) {
  assert.equal(result.findings.R1, false, 'R1: stale payload admitted as fresh');
}
if (process.argv.includes('--assert-contract') || process.argv.includes('--assert-status')) {
  assert.equal(result.findings.R2, false, 'R2: valid UNLISTED status rejected');
}
