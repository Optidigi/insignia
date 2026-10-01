import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createShopifyAvailabilityHoldPort } from './availability-hold.ts';
import { createPublicationAdminAdapter, createPublicationAdminHttpTransport } from './publication-admin.ts';

// Fixed-source diagnostic. No database, actual network, or production credentials.
// Both complete Shopify modules are unchanged snapshots, not replacement implementations.
globalThis.fetch = async () => { throw new Error('NETWORK FORBIDDEN'); };
const expectedBlobs = {
  'availability-hold.ts': '144c4ab6210757847a3c58903db5f3df61e62d81',
  'production-activation.ts': '0f1bae13e1fc09c0d8b10e7086d007a0f71ce982',
  'publication-admin.ts': '2f91fa12a06315a9f9959547a2ef7569556fdf9e',
};
const sourceVerification = {};
for (const [file, expected] of Object.entries(expectedBlobs)) {
  const bytes = readFileSync(new URL(file, import.meta.url));
  const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  assert.equal(blob, expected, `Source mismatch: ${file}`);
  sourceVerification[file] = { bytes: bytes.length, gitBlob: blob, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const source = readFileSync(new URL('production-activation.ts', import.meta.url), 'utf8');
const start = source.indexOf('established: async (identity) => {') + 'established: '.length;
const end = source.indexOf('\n    },\n  });', start) + '\n    }'.length;
assert.ok(start > 0 && end > start);
const callbackSource = source.slice(start, end);
const epoch = Date.parse('2026-10-01T12:00:00.000Z');
const scope = {
  shopId: 'synthetic-shop', installationGeneration: '1',
  shopifyShopId: 'gid://shopify/Shop/101', appClientId: 'a'.repeat(32),
};
const productId = 'gid://shopify/Product/202';
const scopeDigest = value => createHash('sha256').update(`{${Object.keys(value).sort().map(
  key => `${JSON.stringify(key)}:${JSON.stringify(value[key])}`).join(',')}}`).digest('hex');
const credential = () => ({
  kind: 'usable', shopDomain: 'synthetic.myshopify.com', accessToken: 'synthetic-not-a-credential',
  accessExpiresAt: new Date('2099-01-01T00:00:00Z'),
});
const product = status => ({
  __typename: 'Product', id: productId, status,
  updatedAt: '2026-10-01T11:00:00.000Z', publishedAt: null, onlineStoreUrl: null,
  resourcePublications: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
  unpublishedPublications: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
});
function fixture(status = 'DRAFT') {
  let at = epoch, observationDelay = 0;
  const now = () => new Date(at);
  const availability = createShopifyAvailabilityHoldPort({
    now, timeoutMs: 8000, isCurrent: async () => true,
    credentials: { acquire: async () => credential() },
    fetchImpl: async (_url, init) => {
      assert.ok(JSON.parse(init.body).query.startsWith('query'));
      const payload = JSON.stringify({ data: {
        shop: { id: scope.shopifyShopId },
        currentAppInstallation: { app: { apiKey: scope.appClientId },
          accessScopes: [{ handle: 'read_products' }, { handle: 'write_products' }] },
        node: product(status),
      } });
      at += observationDelay;
      observationDelay = 0;
      return new Response(payload, { status: 200 });
    },
  });
  const getAdmission = async (delay = 0) => {
    const before = await availability.snapshot(scope, productId);
    const hold = { version: 'm5-availability-hold-v1', operationId: 'synthetic-operation', before, held: before };
    const options = { appClientId: scope.appClientId, maxObservationAgeMs: 1000, availability };
    const store = { read: async () => ({ state: { kind: 'HELD', hold } }) };
    const established = new Function('store', 'options', 'now', 'activationDigest', `return (${callbackSource});`)(
      store, options, now, scopeDigest);
    observationDelay = delay;
    return established({ shopId: scope.shopId, configId: 'synthetic-config', operationId: hold.operationId,
      installationGeneration: '1', productId });
  };
  return { now, availability, getAdmission, advance: ms => { at += ms; } };
}
const observations = [];
for (const delayMs of [0, 999, 1000, 1001, 2000]) {
  const f = fixture(); const admission = await f.getAdmission(delayMs);
  const accepted = Boolean(admission?.isFresh());
  observations.push({ delayMs, accepted });
  assert.equal(accepted, delayMs <= 1000, 'Observation-origin correction regression');
}
const statuses = [];
for (const status of ['ACTIVE', 'DRAFT', 'ARCHIVED', 'UNLISTED', 'UNSUPPORTED_SYNTHETIC_STATUS']) {
  const f = fixture(status);
  try { const result = await f.availability.snapshot(scope, productId);
    statuses.push({ status, accepted: true, normalizedState: result.state });
  } catch (error) { statuses.push({ status, accepted: false, kind: error.kind }); }
}
assert.equal(statuses.find(s => s.status === 'UNLISTED').normalizedState, 'unlisted');
assert.equal(statuses.at(-1).accepted, false);
const phases = [
  ['prepared','public_config','{"synthetic":true}'],
  ['shop-config-written','registration',`${'1'.repeat(32)}:1:pending`],
  ['pending-written','policy',`${'1'.repeat(32)}:1:required`],
  ['policy-written','registration',`${'1'.repeat(32)}:1:ready`],
];
async function dispatchCase(phase, field, value, delayMs, delayPoint) {
  const f = fixture(); const admission = await f.getAdmission();
  assert.ok(admission?.isFresh());
  let delayed = false, writes = 0, observedWrite = null;
  let fieldPayload;
  const transport = createPublicationAdminHttpTransport({
    now: f.now, timeoutMs: 8000,
    credentials: { acquire: async () => {
      if (!delayed && delayPoint === 'inside-transport-credential') { delayed = true; f.advance(delayMs); }
      return credential();
    } },
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(init.body);
      if (request.query.startsWith('mutation')) {
        writes++;
        observedWrite = { ageAtHttpMs: f.now().getTime() - epoch, admissionFreshAtHttp: admission.isFresh() };
        const cell = request.variables.metafields[0];
        fieldPayload = { owner: { id: cell.ownerId }, namespace: 'app--101', key: cell.key,
          type: cell.type, value: cell.value, compareDigest: 'c'.repeat(64) };
        return new Response(JSON.stringify({ data: { metafieldsSet: { metafields: [fieldPayload], userErrors: [] } } }), { status: 200 });
      }
      assert.ok(fieldPayload);
      const resource = { __typename: field === 'public_config' ? 'Shop' : 'Product',
        id: fieldPayload.owner.id, field: fieldPayload };
      return new Response(JSON.stringify({ data: field === 'public_config' ? { shop: resource } : { node: resource } }), { status: 200 });
    },
  });
  const remote = createPublicationAdminAdapter({ transport });
  const target = { shopId: scope.shopId, installationGeneration: '1', shopifyShopId: scope.shopifyShopId,
    appId: '101', field, ...(field === 'public_config' ? {} : { productId }) };
  if (delayPoint === 'before-caller-guard') f.advance(delayMs);
  const freshAtCallerGuard = admission.isFresh();
  // Exact guard/call ordering of production-publication.ts:705-708.
  // Other coordinator state/SQL is not executed by this focused diagnostic.
  let result = 'ADMISSION_PENDING';
  if (admission && !admission.isFresh()) { /* no dispatch */ }
  else { result = (await remote.set({ ...target, value, compareDigest: null })).kind; }
  return { phase, field, delayPoint, delayMs, freshnessBudgetMs: 1000,
    freshAtCallerGuard, writes, ...observedWrite, result };
}
const dispatch = [];
for (const phase of phases)
  for (const delay of [0, 999, 1000, 1001, 2000, -1])
    dispatch.push(await dispatchCase(...phase, delay, 'inside-transport-credential'));
const callerControls = [];
for (const delay of [0, 1000, 1001, 2000, -1])
  callerControls.push(await dispatchCase(...phases[0], delay, 'before-caller-guard'));
for (const row of callerControls) assert.equal(row.writes, row.delayMs >= 0 && row.delayMs <= 1000 ? 1 : 0);
for (const row of dispatch.filter(r => [0,999,1000].includes(r.delayMs))) {
  assert.equal(row.writes, 1); assert.equal(row.admissionFreshAtHttp, true);
}
const staleWrites = dispatch.filter(r => r.writes > 0 && r.admissionFreshAtHttp === false);
const result = {
  kind: 'principal-fixed-source-transport-dispatch-characterization',
  head: '91f46ba0006d9c5d50613dc39e234f33c797f625', node: process.version, sourceVerification,
  executedScope: 'Complete unchanged Shopify hold + publication adapter/HTTP transport; exact production admission callback; equivalent exact caller guard/dispatch excerpt',
  exclusions: ['No full production coordinator or database transaction', 'No pinned Node24 suite', 'No real Shopify/network calls', 'No repository modification'],
  correctedObservationControls: observations, correctedStatusControls: statuses,
  callerGuardControls: callerControls, transportDispatchCases: dispatch,
  staleOrReversedHttpDispatches: staleWrites.length,
};
console.log(JSON.stringify(result, null, 2));
if (process.argv.includes('--assert-contract')) assert.equal(staleWrites.length, 0,
  'Publication HTTP mutation dispatched after admission expired/reversed inside credential acquisition');
