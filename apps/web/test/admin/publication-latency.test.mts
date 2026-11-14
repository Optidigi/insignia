import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { ExpectedFunctionBuild, FunctionArtifactIdentity } from '@insignia/application';
import { SigningKeyLifecycle } from '@insignia/application';
import { createDurableCore, type DurableCore } from '@insignia/database';
import { createShopifyAvailabilityHoldV3Port } from '@insignia/shopify';
import { Pool } from 'pg';
import type { AdminActor } from '../../src/server/admin/contracts.ts';
import { handleAdminRequest } from '../../src/server/admin/http.ts';
import { createServerActivationReadiness } from '../../src/server/admin/release-evidence.ts';
import {
  createMerchantConfigService,
  PUBLICATION_CONTINUATION_VALIDITY_MS,
  PUBLICATION_STEP_MARGIN_MS,
} from '../../src/server/merchant-config.ts';
import { adminServices } from './support/fixtures.mts';
import { captureSyntheticPublicationPreviews } from './support/publication-previews.mts';

type Remote = Parameters<DurableCore['productionPublications']['create']>[0]['remote'];

const database = process.env.DATABASE_URL;
// Every synthetic provider call waits this long, so the request time reflects its serial provider work.
const latencyMs = Number(process.env.PUBLICATION_LATENCY_MS ?? 100);
const delay = () => new Promise((resolve) => setTimeout(resolve, latencyMs));

/**
 * A first publication (ACTIVE product, so the owned availability hold and restore really
 * dispatch) through the real admin HTTP route, merchant-config loop and PG activation coordinator.
 * Every provider port is a counted double with the same latency, so the provider-call budget is
 * the request's serial wait. `authenticate` answers the current `actor` (one per request session).
 */
async function firstPublication(core: DurableCore) {
  const shopId = randomUUID();
  const configId = randomUUID();
  const clientId = 'a'.repeat(32);
  const appId = '99999001';
  const productId = '42';
  const providerShop = String(BigInt(`0x${shopId.replaceAll('-', '').slice(0, 15)}`));
  const now = () => new Date('2026-10-01T12:00:00.000Z');
  await core.transactions.run(async (tx) => {
    await core.tenants.createShop(tx, {
      shopId,
      shopDomain: `s${shopId.replaceAll('-', '')}.myshopify.com`,
      shopifyShopId: providerShop,
    });
    await core.configs.createConfig(tx, {
      shopId,
      configId,
      externalProductId: productId,
      draftSchemaVersion: 'm3-config-draft-v1',
      draftValue: {
        version: 'm5-merchant-draft-v1',
        mode: 'required',
        shopCurrency: 'USD',
        methods: [{ id: 'print' }],
        placements: [{ id: 'front', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: false }],
        productionOptions: [],
        pricingRules: [],
        geometry: {
          version: 'm5-geometry-v1',
          views: [
            {
              id: 'front',
              image: { revisionId: 'product_42', width: 800, height: 900 },
              variantImages: [],
              placements: [{ id: 'front', rect: { centerX: 0.5, centerY: 0.5, width: 0.3, height: 0.3 } }],
            },
          ],
          steps: [{ id: 'small', widthFraction: 0.5, heightFraction: 0.5, physicalMm: { width: 80, height: 60 } }],
        },
      },
    });
  });
  const scope = await core.tenants.getActiveAuthorizationScope({ shopId, installationGeneration: '1' });
  assert(scope);
  const lifecycle = new SigningKeyLifecycle(core.signingKeys, {
    currentKeyId: 'synthetic-wrap',
    keys: { 'synthetic-wrap': Buffer.alloc(32, 1) },
  });
  await lifecycle.createPending({ scope, keyId: 7, firstDay: 20000, lastDay: 30000, seed: Buffer.alloc(32, 2) });
  await lifecycle.activate(scope, 7);

  const calls = new Map<string, number>();
  // Runs after each acknowledged provider write, between two persisted publication steps.
  let afterWrite: ((label: string) => void) | undefined;
  // A round is a stretch of time with at least one provider call in flight: calls made
  // concurrently share a round, so rounds x latency is the request's provider wait.
  let inFlight = 0;
  let rounds = 0;
  const count = async (label: string) => {
    calls.set(label, (calls.get(label) ?? 0) + 1);
    if (inFlight++ === 0) rounds++;
    try {
      await delay();
    } finally {
      inFlight--;
    }
  };
  const cells = new Map();
  const keys = {
    public_config: 'insignia_public_config_v2',
    registration: 'insignia_registration_v2',
    policy: 'insignia_policy_v2',
  };
  const remote: Remote = {
    read: async (target) => {
      await count('metafield read');
      return cells.get(target.field) ?? null;
    },
    set: async (target) => {
      await count('metafield write');
      assert.equal(cells.get(target.field)?.compareDigest ?? null, target.compareDigest);
      const observed = {
        ownerId: target.productId ?? target.shopifyShopId,
        namespace: `app--${appId}`,
        key: keys[target.field],
        type: target.field === 'public_config' ? 'json' : 'single_line_text_field',
        value: target.value,
        compareDigest: createHash('sha256').update(target.value).digest('hex'),
      };
      cells.set(target.field, observed);
      afterWrite?.('metafield write');
      return { observed };
    },
  };
  // Four sales channels, as on the development store's published products.
  const channels = [301, 302, 303, 304];
  let status = 'ACTIVE';
  let version = 0;
  const product = () => ({
    __typename: 'Product',
    id: `gid://shopify/Product/${productId}`,
    status,
    updatedAt: `2026-10-01T11:00:0${version}.000Z`,
    publishedAt: null,
    onlineStoreUrl: null,
    resourcePublications: {
      nodes:
        status === 'ACTIVE'
          ? channels.map((id) => ({
              publication: { id: `gid://shopify/Publication/${id}` },
              isPublished: true,
              publishDate: '2026-10-01T11:00:00Z',
            }))
          : [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    },
  });
  const availability = createShopifyAvailabilityHoldV3Port({
    now,
    isCurrent: async (supplied) =>
      supplied.shopifyShopId === `gid://shopify/Shop/${providerShop}` && supplied.appClientId === clientId,
    credentials: {
      acquire: async () => ({
        kind: 'usable',
        shopDomain: 'synthetic.myshopify.com',
        accessToken: 'synthetic-test-only',
        accessExpiresAt: new Date('2026-10-02T00:00:00Z'),
      }),
    },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.query.startsWith('mutation')) {
        await count('product status write');
        status = body.variables.product.status;
        version++;
        afterWrite?.('product status write');
        return Response.json({ data: { productUpdate: { product: product(), userErrors: [] } } });
      }
      await count(body.query.includes('publication(id:') ? 'sales channel read' : 'product availability read');
      return Response.json({
        data: {
          shop: { id: `gid://shopify/Shop/${providerShop}` },
          currentAppInstallation: {
            app: { apiKey: clientId },
            accessScopes: [{ handle: 'read_products' }, { handle: 'write_products' }, { handle: 'read_publications' }],
          },
          node: product(),
          ...(body.query.includes('publication(id:')
            ? {
                publication: {
                  __typename: 'Publication',
                  id: body.variables.publicationId,
                  autoPublish: true,
                  supportsFuturePublishing: true,
                  includedProducts: {
                    nodes: [{ id: `gid://shopify/Product/${productId}` }],
                    pageInfo: { hasNextPage: false, hasPreviousPage: false },
                  },
                },
              }
            : {}),
        },
      });
    },
  });
  const object = (kind: 'transform' | 'validation'): FunctionArtifactIdentity => ({
    functionId: `gid://shopify/ShopifyFunction/${kind === 'transform' ? '1' : '2'}`,
    handle: `synthetic-${kind}`,
    apiType: kind === 'transform' ? 'cart_transform' : 'cart_checkout_validation',
    apiVersion: '2026-07',
    inputQuerySha256: 'b'.repeat(64),
    wasmSha256: 'c'.repeat(64),
  });
  const artifactScope = { shopId, installationGeneration: '1', appClientId: clientId };
  const build: ExpectedFunctionBuild = {
    ...artifactScope,
    schemaVersion: 1,
    sourceCommit: 'd'.repeat(40),
    appVersionRef: 'synthetic-release',
    devPreviewRef: null,
    transform: object('transform'),
    validation: object('validation'),
  };
  const strip = ({ wasmSha256: _wasm, ...rest }: FunctionArtifactIdentity) => rest;
  const readiness = createServerActivationReadiness(
    {
      expectedBuild: { read: async () => build },
      observeFunctions: async () => {
        await count('function read');
        return {
          transform: 'present',
          validation: 'present',
          observation: {
            ...artifactScope,
            observedAt: now().toISOString(),
            transform: strip(build.transform),
            validation: strip(build.validation),
          },
        };
      },
      currentDay: () => 20727,
    },
    {
      read: async () => ({
        version: 'm5-trusted-release-v1',
        recordId: 'synthetic-release-1',
        activeAppVersionRef: 'synthetic-release',
        attestation: {
          ...build,
          evidenceKind: 'RELEASE_BOUND',
          observedAt: now().toISOString(),
          expiresAt: '2026-10-02T00:00:00Z',
        },
      }),
    },
  );
  const activation = core.productionActivations.create({
    appId,
    appClientId: clientId,
    remote,
    availability,
    readiness,
    now,
    maxObservationAgeMs: 1000,
  });
  let actor: AdminActor = {
    shop: `s${shopId.replaceAll('-', '')}.myshopify.com`,
    shopId: `gid://shopify/Shop/${providerShop}`,
    tenantShopId: shopId,
    installationGeneration: '1',
    installationId: 'synthetic-install',
    staffId: 'synthetic-staff',
    sessionId: 'synthetic-session',
    expiresAtMs: Date.now() + 60000,
    canRead: true,
    canEdit: true,
  };
  const catalog = {
    get: async (_actor: unknown, gid: string) => {
      await count('product read');
      return gid === `gid://shopify/Product/${productId}`
        ? { id: gid, title: 'Synthetic admin shirt', status, imageUrl: null, variants: [] }
        : null;
    },
    shopCurrency: async () => {
      await count('shop currency read');
      return 'USD';
    },
  };
  let denials = 0;
  const configs = createMerchantConfigService({
    core,
    catalog,
    eligibility: async () => {
      await count('subscription read');
      if (denials > 0) {
        denials--;
        return { allowed: false, reason: 'Synthetic subscription lapsed' };
      }
      return { allowed: true, reason: null };
    },
    publication: () => activation.publications,
    activation: () => activation,
    capturePublicationPreviews: (owner, input) => captureSyntheticPublicationPreviews(core, owner, input),
  });
  const services = adminServices({
    appOrigin: 'https://synthetic.example',
    authenticate: async () => actor,
    catalog,
    configs,
  });
  const publish = (key: string) =>
    handleAdminRequest(
      new Request(`https://synthetic.example/api/admin/products/${productId}/config`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer synthetic-identity',
          Origin: 'https://synthetic.example',
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify({ action: 'publish', configId, draftVersion: '1' }),
      }),
      services,
      { kind: 'config', productId: `gid://shopify/Product/${productId}` },
    );
  return {
    shopId,
    configId,
    calls,
    rounds: () => rounds,
    status: () => status,
    actor: () => actor,
    session: (next: Partial<AdminActor>) => {
      actor = { ...actor, ...next };
      return actor;
    },
    afterWrite: (hook: (label: string) => void) => {
      afterWrite = hook;
    },
    publish,
    setDenials: (value: number) => {
      denials = value;
    },
  };
}

test('#436: a first publication spends its provider calls on sequencing, not repeated gates', {
  skip: !database,
  timeout: 120000,
}, async (t) => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  try {
    const { publish, calls, rounds: roundCount, status: currentStatus, setDenials } = await firstPublication(core);
    const started = performance.now();
    const response = await publish('m5-436-first-publication');
    const rounds = roundCount();
    const status = currentStatus();
    const elapsed = Math.round(performance.now() - started);
    assert.equal(response.status, 202);
    assert.equal((await response.json()).state, 'ACTIVE');
    assert.equal(status, 'ACTIVE', 'the owned hold was acquired and restored');
    const budget = Object.fromEntries([...calls].sort());
    const total = [...calls.values()].reduce((sum, value) => sum + value, 0);
    t.diagnostic(
      `latency ${latencyMs} ms/call: ${elapsed} ms, ${rounds} serial provider rounds, ${total} calls ${JSON.stringify(budget)}`,
    );
    // Sequencing work stays: hold and restore status writes, four field writes, each read back.
    assert.equal(calls.get('product status write'), 2);
    assert.equal(calls.get('metafield write'), 4);
    // Repeated gates within one request do not: an allowed subscription check and the shop
    // currency are reused, not read again before every publication step.
    assert.ok((calls.get('subscription read') ?? 0) <= 2, JSON.stringify(budget));
    assert.equal(calls.get('shop currency read'), 1);
    // A held-product observation reads its four sales channels together, and is not repeated
    // between two field writes. Before #436 this publication took 146 rounds.
    assert.ok(rounds <= 75, `${rounds} rounds ${JSON.stringify(budget)}`);

    // A denial is never reused: the next request reads the subscription again and proceeds.
    const read = () => calls.get('subscription read') ?? 0;
    setDenials(1);
    let before = read();
    assert.equal((await publish('m5-436-denied')).status, 403);
    assert.equal(read() - before, 1);
    before = read();
    const republished = await publish('m5-436-after-denial');
    assert.equal(republished.status, 202, await republished.clone().text());
    assert.ok(read() - before >= 1, 'the request after a denial reads the subscription again');
  } finally {
    await core.close();
  }
});

/** #468: the staff session ends while a step runs; the server answers `continue` at the next stop point. */
async function interruptedPublication(core: DurableCore, key: string) {
  const f = await firstPublication(core);
  let writes = 0;
  f.afterWrite(() => {
    // The request's session token runs out right after the second acknowledged provider write.
    if (++writes === 2) f.actor().expiresAtMs = Date.now() + 50;
  });
  const response = await f.publish(key);
  assert.equal(response.status, 202, await response.clone().text());
  const body = await response.json();
  assert.equal(body.kind, 'continue', JSON.stringify(body));
  assert.equal(body.minimumValidityMs, PUBLICATION_CONTINUATION_VALIDITY_MS);
  assert.match(body.revisionId, /^[a-f0-9-]{36}$/);
  // Its progress is persisted: the publication operation stays open, not failed or held.
  const progress = await core.configs.getCurrentPublication(f.shopId, f.configId);
  assert.equal(progress?.operationId, body.revisionId);
  assert.notEqual(progress?.phase, 'active');
  assert.notEqual(progress?.status, 'failed');
  const writesSoFar = () => (f.calls.get('product status write') ?? 0) + (f.calls.get('metafield write') ?? 0);
  assert.equal(writesSoFar(), 2, 'it stopped at the step boundary after the write in flight');
  return { ...f, revisionId: body.revisionId as string, writesSoFar };
}

test('#468: a session that ends between publication steps continues with the next session, exactly once', {
  skip: !database,
  timeout: 120000,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  try {
    const f = await interruptedPublication(core, 'm5-468-continue');
    // Same staff member, new session token: the same idempotent request resumes from the persisted step.
    f.session({ sessionId: 'synthetic-session-2', expiresAtMs: Date.now() + 60000 });
    const resumed = await f.publish('m5-468-continue');
    assert.equal(resumed.status, 202);
    const body = await resumed.json();
    assert.equal(body.kind, 'accepted');
    assert.equal(body.state, 'ACTIVE');
    assert.equal(body.revisionId, f.revisionId);
    assert.equal(f.status(), 'ACTIVE', 'the owned hold was acquired once and restored');
    // The writes of one uninterrupted publication, each exactly once: none repeated or replayed.
    assert.equal(f.calls.get('product status write'), 2);
    assert.equal(f.calls.get('metafield write'), 4);
    const config = await core.configs.getConfig(f.shopId, f.configId);
    assert.equal(config?.effectiveOperationId, f.revisionId);
  } finally {
    await core.close();
  }
});

test('#468: another staff member cannot continue a publication', { skip: !database, timeout: 120000 }, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  try {
    const f = await interruptedPublication(core, 'm5-468-other-staff');
    f.session({ staffId: 'synthetic-other-staff', sessionId: 'synthetic-session-3', expiresAtMs: Date.now() + 60000 });
    const refused = await f.publish('m5-468-other-staff');
    assert.equal(refused.status, 403);
    assert.match((await refused.json()).message, /another staff member/);
    assert.equal(f.writesSoFar(), 2, 'nothing was written for the other staff member');
    // The original staff member still can.
    f.session({ staffId: 'synthetic-staff', sessionId: 'synthetic-session-4', expiresAtMs: Date.now() + 60000 });
    const resumed = await f.publish('m5-468-other-staff');
    assert.equal((await resumed.json()).state, 'ACTIVE');
    assert.equal(f.writesSoFar(), 6);
  } finally {
    await core.close();
  }
});

test('#468: a publication cannot be continued after a reinstall', { skip: !database, timeout: 120000 }, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  try {
    const f = await interruptedPublication(core, 'm5-468-reinstall');
    const generation = await core.transactions.run((tx) => core.tenants.startInstallation(tx, f.shopId));
    f.session({
      installationGeneration: generation,
      sessionId: 'synthetic-session-5',
      expiresAtMs: Date.now() + 60000,
    });
    const refused = await f.publish('m5-468-reinstall');
    assert.equal(refused.status, 403, await refused.clone().text());
    assert.equal(f.writesSoFar(), 2, 'nothing was written under the new installation');
  } finally {
    await core.close();
  }
});

test('#468: a session too short for the next step stops before any work', { skip: !database }, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  try {
    const f = await firstPublication(core);
    f.session({ expiresAtMs: Date.now() + PUBLICATION_STEP_MARGIN_MS - 1000 });
    const response = await f.publish('m5-468-short');
    const body = await response.json();
    assert.equal(response.status, 202);
    assert.equal(body.kind, 'continue');
    assert.equal(body.revisionId, undefined, 'nothing was admitted yet');
    // Only the route's own product check ran; no publication read, capture or write.
    assert.deepEqual(Object.fromEntries(f.calls), { 'product read': 1 });
  } finally {
    await core.close();
  }
});
