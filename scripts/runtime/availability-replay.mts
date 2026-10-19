// Offline-only derived replay. Never imports the live entrypoint, operator, transport or credentials.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AvailabilityHoldV3, ProductAvailabilitySnapshotV3 } from '../../packages/application/dist/index.js';
import { array, number, object, required, text } from './validation.mts';

let ambientFetchAttempts = 0;
Object.defineProperty(globalThis, 'fetch', {
  configurable: false,
  writable: false,
  value: async () => {
    ambientFetchAttempts++;
    throw new Error('network_escape_denied');
  },
});
const { createShopifyAvailabilityHoldV3Port } = await import('../../packages/shopify/dist/index.js');
const { availabilityV3AcknowledgementQualified, sameAvailabilityV3 } = await import(
  '../../packages/application/dist/index.js'
);
const root = resolve(import.meta.dirname, '../..');
const fixtureRoot = resolve(root, 'fixtures/shopify/availability-restore-v3');
const bytes = (name: string) => readFileSync(resolve(fixtureRoot, name));
const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const json = (name: string) => object(JSON.parse(bytes(name).toString('utf8')));
const boolean = (value: unknown): boolean => {
  assert(typeof value === 'boolean');
  return value;
};
const nullableText = (value: unknown) => (value === null ? null : text(value));
function observation(
  value: unknown,
): Omit<import('../../packages/application/dist/index.js').AvailabilityMutationAcknowledgementV3, 'version'> {
  const raw = object(value),
    scope = object(raw.scope),
    visibility = object(raw.effectiveVisibility),
    online = object(visibility.onlineStore);
  const state = raw.state;
  assert(state === 'available' || state === 'unavailable' || state === 'archived' || state === 'unlisted');
  const publications = (value: unknown) =>
    array(value).map((value) => {
      const row = object(value);
      return {
        publicationId: text(row.publicationId),
        isPublished: boolean(row.isPublished),
        publishDate: text(row.publishDate),
      };
    });
  return {
    scope: {
      shopId: text(scope.shopId),
      installationGeneration: text(scope.installationGeneration),
      shopifyShopId: text(scope.shopifyShopId),
      appClientId: text(scope.appClientId),
    },
    productId: text(raw.productId),
    state,
    providerUpdatedAt: text(raw.providerUpdatedAt),
    effectiveVisibility: {
      publishedPublicationIds: array(visibility.publishedPublicationIds).map(text),
      onlineStore: { publishedAtPresent: boolean(online.publishedAtPresent), urlPresent: boolean(online.urlPresent) },
      publicationEvidence: publications(visibility.publicationEvidence),
      publishedAt: nullableText(visibility.publishedAt),
      onlineStoreUrl: nullableText(visibility.onlineStoreUrl),
    },
    observedAt: text(raw.observedAt),
    receivedAt: text(raw.receivedAt),
  };
}
function snapshot(value: unknown): ProductAvailabilitySnapshotV3 {
  const raw = object(value);
  assert.equal(raw.version, 'm5-product-availability-snapshot-v3');
  return {
    ...observation(raw),
    version: 'm5-product-availability-snapshot-v3',
    visibleScheduledOrStaged: array(raw.visibleScheduledOrStaged).map((value) => {
      const row = object(value);
      return {
        publicationId: text(row.publicationId),
        isPublished: boolean(row.isPublished),
        publishDate: text(row.publishDate),
      };
    }),
    effectiveAnchors: array(raw.effectiveAnchors).map((value) => {
      const row = object(value);
      assert.equal(row.resolved, true);
      assert.equal(row.productIncluded, true);
      return {
        publicationId: text(row.publicationId),
        resolved: true,
        productIncluded: true,
        autoPublish: boolean(row.autoPublish),
        supportsFuturePublishing: boolean(row.supportsFuturePublishing),
      };
    }),
    effectiveDigest: text(raw.effectiveDigest),
    anchorDigest: text(raw.anchorDigest),
  };
}

const qualification = json('live-run/qualification.json');
const register = json('live-run/register.json');
const rawHold = json('live-run/restore-intent.json');
assert.equal(rawHold.version, 'm5-availability-hold-v3');
const claim = object(rawHold.restorationClaim),
  claimScope = object(claim.scope),
  acquisition = object(rawHold.acquisitionAcknowledgement);
assert.equal(claim.version, 'm5-availability-restoration-claim-v3');
assert.equal(claim.restoreReserved, true);
assert.equal(claim.compensationReserved, true);
assert.equal(acquisition.version, 'm5-availability-mutation-ack-v3');
const hold: AvailabilityHoldV3 = {
  version: 'm5-availability-hold-v3',
  operationId: text(rawHold.operationId),
  before: snapshot(rawHold.before),
  held: rawHold.held === null ? null : snapshot(rawHold.held),
  acquisitionAcknowledgement: { ...observation(acquisition), version: 'm5-availability-mutation-ack-v3' },
  restorationClaim: {
    version: 'm5-availability-restoration-claim-v3',
    operationId: text(claim.operationId),
    scope: {
      shopId: text(claimScope.shopId),
      installationGeneration: text(claimScope.installationGeneration),
      shopifyShopId: text(claimScope.shopifyShopId),
      appClientId: text(claimScope.appClientId),
    },
    productId: text(claim.productId),
    restoreReserved: true,
    compensationReserved: true,
  },
};
assert.deepEqual(hold, rawHold, 'decoded sealed hold retains every historical field');
const restore = object(qualification.restore);
const observe = object(qualification.observe);
const manifest = json('canonical-run-manifest.json');
for (const [name, entry] of Object.entries(manifest)) {
  assert.equal(hash(bytes(`live-run/${name}`)), object(entry).sha256);
}
assert.equal(register.phase, 'CLOSED');
assert.equal(qualification.outcome, 'STOPPED');
assert.equal(restore.kind, 'CONFLICT');
const captured = array(register.events)
  .map(object)
  .filter((e) => ['restore-read', 'restore-anchor', 'restore'].includes(text(e.operation)));
assert.equal(captured.length, 7);
assert.equal(captured.filter((e) => e.mutation).length, 1);
const historicalAck = object(restore.acknowledgement);
assert.equal(historicalAck.observedAt, '2026-10-07T12:09:54.968Z');
assert.equal(historicalAck.receivedAt, '2026-10-07T12:09:57.978Z');
let clock = new Date(number(required(captured[0]).observationOrigin));
let cursor = 0;
let compensationAttempts = 0;
let restorationAttempts = 0;
const replayedEvents: { index: number; operation: string; responseSha256: string }[] = [];
const fetchImpl: typeof fetch = async (_url, init) => {
  const request = object(JSON.parse(text(required(init).body)));
  if (text(request.query).startsWith('mutation')) {
    if (object(object(request.variables).product).status === 'DRAFT') compensationAttempts++;
    else restorationAttempts++;
  }
  const event = captured[cursor++];
  assert.ok(event, 'no additional request is permitted by exact-response replay');
  assert.deepEqual(request, event.request, 'production provider document and sequence must remain exact');
  assert.equal(event.status, 200);
  assert.equal(event.settlement, event.mutation ? 'ACKNOWLEDGED' : 'SETTLED');
  // Preserve the recorded ACK interval; other clocks use completed event/read timestamps.
  const lastPreRead = cursor === 3;
  const lastReadback = cursor === captured.length;
  clock = new Date(
    lastPreRead
      ? text(historicalAck.observedAt)
      : event.mutation
        ? text(historicalAck.receivedAt)
        : lastReadback
          ? text(object(restore.current).receivedAt)
          : text(event.completedAt),
  );
  replayedEvents.push({
    index: number(event.index),
    operation: text(event.operation),
    responseSha256: hash(JSON.stringify(event.response)),
  });
  return Response.json(event.response);
};
const port = createShopifyAvailabilityHoldV3Port({
  // Synthetic in-memory credential premise only; no environment/file credential access or auth request.
  credentials: {
    acquire: async () => ({
      kind: 'usable',
      shopDomain: 'synthetic.myshopify.com',
      accessToken: 'synthetic-offline-token',
      accessExpiresAt: new Date('2099-01-01T00:00:00Z'),
    }),
  },
  isCurrent: async () => true,
  now: () => new Date(clock),
  timeoutMs: 30000,
  fetchImpl,
});
const result = await port.restore(hold.before.scope, hold, snapshot(observe.current), () => true);
assert.equal(result.kind, 'RESTORED');
assert(
  result.current && 'version' in result.current && result.current.version === 'm5-product-availability-snapshot-v3',
);
assert(result.acknowledgement);
assert.ok(sameAvailabilityV3(result.current, hold.before));
assert.ok(availabilityV3AcknowledgementQualified(result.acknowledgement));
assert.deepEqual(result.acknowledgement, historicalAck, 'raw ACK facts and both timestamps remain exact');
assert.equal(cursor, captured.length);
assert.equal(restorationAttempts, 1);
assert.equal(compensationAttempts, 0);
assert.equal(ambientFetchAttempts, 0);
for (const [name, entry] of Object.entries(manifest))
  assert.equal(hash(bytes(`live-run/${name}`)), object(entry).sha256);
const sourceFiles = [
  'packages/application/src/publication/availability-v3.ts',
  'packages/shopify/src/availability-hold-v3.ts',
  'packages/database/migrations/20261007000100_m5_availability_v3.sql',
];
const buildFiles = [
  'packages/application/dist/publication/availability-v3.js',
  'packages/shopify/dist/availability-hold-v3.js',
];
console.log(
  JSON.stringify(
    {
      version: 'm5-017r-memory-replay-v1',
      kind: result.kind,
      historicalLiveOutcome: qualification.outcome,
      historicalRestoreKind: restore.kind,
      exactSemanticReadbackEqualToBefore: true,
      effectivePublicationIds: result.current.effectiveVisibility.publishedPublicationIds,
      compensationAttempts,
      replayedRestoreAttempts: restorationAttempts,
      memoryResponseInvocations: cursor,
      externalRequests: 0,
      ambientFetchAttempts,
      canonicalBytesUnchanged: true,
      canonicalManifestSha256: hash(bytes('canonical-run-manifest.json')),
      originalAckRetainedExactly: true,
      result,
      replayedEvents,
      sourceHashes: Object.fromEntries(sourceFiles.map((f) => [f, hash(readFileSync(resolve(root, f)))])),
      buildHashes: Object.fromEntries(buildFiles.map((f) => [f, hash(readFileSync(resolve(root, f)))])),
    },
    null,
    2,
  ),
);
