// Offline-only derived replay. Never imports the live entrypoint, operator, transport or credentials.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
const evidence = resolve(root, 'docs/delivery/evidence/m5-017');
const bytes = (name) => readFileSync(resolve(evidence, name));
const hash = (data) => createHash('sha256').update(data).digest('hex');
const qualification = JSON.parse(bytes('live-run/qualification.json'));
const register = JSON.parse(bytes('live-run/register.json'));
const hold = JSON.parse(bytes('live-run/restore-intent.json'));
const manifest = JSON.parse(bytes('canonical-run-manifest.json'));
for (const [name, entry] of Object.entries(manifest)) {
  assert.equal(hash(bytes(`live-run/${name}`)), entry.sha256);
}
assert.equal(register.phase, 'CLOSED');
assert.equal(qualification.outcome, 'STOPPED');
assert.equal(qualification.restore.kind, 'CONFLICT');
const captured = register.events.filter((e) => ['restore-read', 'restore-anchor', 'restore'].includes(e.operation));
assert.equal(captured.length, 7);
assert.equal(captured.filter((e) => e.mutation).length, 1);
const historicalAck = qualification.restore.acknowledgement;
assert.equal(historicalAck.observedAt, '2026-10-07T12:09:54.968Z');
assert.equal(historicalAck.receivedAt, '2026-10-07T12:09:57.978Z');
let clock = new Date(captured[0].observationOrigin);
let cursor = 0;
let compensationAttempts = 0;
let restorationAttempts = 0;
const replayedEvents = [];
const fetchImpl = async (_url, init) => {
  const request = JSON.parse(init.body);
  if (request.query.startsWith('mutation')) {
    if (request.variables.product.status === 'DRAFT') compensationAttempts++;
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
      ? historicalAck.observedAt
      : event.mutation
        ? historicalAck.receivedAt
        : lastReadback
          ? qualification.restore.current.receivedAt
          : event.completedAt,
  );
  replayedEvents.push({
    index: event.index,
    operation: event.operation,
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
const result = await port.restore(hold.before.scope, hold, qualification.observe.current, () => true);
assert.equal(result.kind, 'RESTORED');
assert.ok(sameAvailabilityV3(result.current, hold.before));
assert.ok(availabilityV3AcknowledgementQualified(result.acknowledgement));
assert.deepEqual(result.acknowledgement, historicalAck, 'raw ACK facts and both timestamps remain exact');
assert.equal(cursor, captured.length);
assert.equal(restorationAttempts, 1);
assert.equal(compensationAttempts, 0);
assert.equal(ambientFetchAttempts, 0);
for (const [name, entry] of Object.entries(manifest)) assert.equal(hash(bytes(`live-run/${name}`)), entry.sha256);
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
      historicalRestoreKind: qualification.restore.kind,
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
