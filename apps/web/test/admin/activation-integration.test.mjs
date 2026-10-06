import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { SigningKeyLifecycle } from '@insignia/application';
import { createDurableCore } from '@insignia/database';
import { createShopifyAvailabilityHoldV2Port } from '@insignia/shopify';
import { Pool } from 'pg';
import { createServerActivationReadiness } from '../../src/server/admin/release-evidence.ts';

const database = process.env.DATABASE_URL;
test('real PG activation composes trusted release, synthetic Shopify hold and immutable evidence', {
  skip: !database,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  try {
    const shopId = randomUUID(),
      configId = randomUUID(),
      revisionId = randomUUID(),
      operationId = randomUUID();
    const clientId = 'a'.repeat(32),
      appId = '99999001',
      productId = '42';
    const providerShop = String(BigInt('0x' + shopId.replaceAll('-', '').slice(0, 15)));
    const now = () => new Date('2026-10-01T12:00:00.000Z');
    await core.transactions.run(async (tx) => {
      await core.tenants.createShop(tx, {
        shopId,
        shopDomain: 's' + shopId.replaceAll('-', '') + '.myshopify.com',
        shopifyShopId: providerShop,
      });
      await core.configs.createConfig(tx, {
        shopId,
        configId,
        externalProductId: productId,
        draftSchemaVersion: 'm3-config-draft-v1',
        draftValue: {},
      });
      await core.configs.createValidatedRevision(tx, {
        shopId,
        configId,
        revisionId,
        mode: 'required',
        sourceDraftVersion: '1',
        sourceInstallationGeneration: '1',
        createdByRef: 'synthetic',
        publishedValue: {
          version: 'm2-published-config-v1',
          shopId,
          productId,
          revisionId,
          shopCurrency: 'USD',
          methods: [],
          placements: [],
          productionOptions: [],
          pricingRules: [],
        },
        geometry: {
          version: 'm5-geometry-v1',
          value: { version: 'm5-geometry-v1', views: [{ id: 'front', variantImages: [], placements: [] }], steps: [] },
        },
        presentation: { version: 'm5-presentation-v1', labels: {} },
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
    const cells = new Map();
    const keys = {
      public_config: 'insignia_public_config_v2',
      registration: 'insignia_registration_v2',
      policy: 'insignia_policy_v2',
    };
    const remote = {
      read: async (target) => cells.get(target.field) ?? null,
      set: async (target) => {
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
        return { observed };
      },
    };
    let status = 'ACTIVE',
      version = 0,
      mutationCount = 0;
    const product = () => ({
      __typename: 'Product',
      id: `gid://shopify/Product/${productId}`,
      status,
      updatedAt: `2026-10-01T11:00:0${version}.000Z`,
      publishedAt: null,
      onlineStoreUrl: null,
      resourcePublications: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
      unpublishedPublications: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
    });
    const availability = createShopifyAvailabilityHoldV2Port({
      now,
      isCurrent: async (supplied) => {
        const active = await core.tenants.getActiveAuthorizationScope({
          shopId: supplied.shopId,
          installationGeneration: supplied.installationGeneration,
        });
        return (
          active?.shopifyShopId === providerShop &&
          supplied.shopifyShopId === `gid://shopify/Shop/${providerShop}` &&
          supplied.appClientId === clientId
        );
      },
      credentials: {
        acquire: async () => ({
          kind: 'usable',
          shopDomain: 'synthetic.myshopify.com',
          accessToken: 'synthetic-test-only',
          accessExpiresAt: new Date('2026-10-02T00:00:00Z'),
        }),
      },
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body);
        if (body.query.startsWith('mutation')) {
          assert.deepEqual(Object.keys(body.variables.product).sort(), ['id', 'status']);
          assert.equal(body.variables.product.id, `gid://shopify/Product/${productId}`);
          status = body.variables.product.status;
          version++;
          mutationCount++;
          return Response.json({ data: { productUpdate: { product: product(), userErrors: [] } } });
        }
        return Response.json({
          data: {
            shop: { id: `gid://shopify/Shop/${providerShop}` },
            currentAppInstallation: {
              app: { apiKey: clientId },
              accessScopes: [
                { handle: 'read_products' },
                { handle: 'write_products' },
                { handle: 'read_publications' },
              ],
            },
            node: product(),
            publications: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false, endCursor: null } },
          },
        });
      },
    });
    const object = (kind) => ({
      functionId: `gid://shopify/ShopifyFunction/${kind === 'transform' ? '1' : '2'}`,
      handle: `synthetic-${kind}`,
      apiType: kind === 'transform' ? 'cart_transform' : 'cart_checkout_validation',
      apiVersion: '2026-07',
      inputQuerySha256: 'b'.repeat(64),
      wasmSha256: 'c'.repeat(64),
    });
    const artifactScope = { shopId, installationGeneration: '1', appClientId: clientId };
    const build = {
      ...artifactScope,
      schemaVersion: 1,
      sourceCommit: 'd'.repeat(40),
      appVersionRef: 'synthetic-release',
      devPreviewRef: null,
      transform: object('transform'),
      validation: object('validation'),
    };
    const strip = ({ wasmSha256, ...rest }) => rest;
    const observation = {
      ...artifactScope,
      observedAt: now().toISOString(),
      transform: strip(build.transform),
      validation: strip(build.validation),
    };
    const readiness = createServerActivationReadiness(
      {
        expectedBuild: { read: async () => build },
        observeFunctions: async () => ({ transform: 'present', validation: 'present', observation }),
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
    const identity = { shopId, configId, operationId };
    const publications = activation.publications;
    await publications.prepare({ ...identity, revisionId, mode: 'required' });
    assert.equal((await publications.advance(shopId, configId, operationId)).kind, 'ADMISSION_PENDING');
    assert.equal((await activation.advance(identity)).kind, 'WAITING_HOLD');
    assert.equal((await activation.advance(identity)).kind, 'HELD');
    assert.equal(status, 'DRAFT');
    assert.equal(mutationCount, 1);
    let result;
    for (let i = 0; i < 6; i++) result = await publications.advance(shopId, configId, operationId);
    assert.equal(result.kind, 'REMOTE_READY_ACTIVATION_PENDING');
    assert.equal((await activation.advance(identity)).kind, 'ACTIVATED_RESTORATION_PENDING');
    assert.equal((await core.configs.getConfig(shopId, configId)).effectiveRevisionId, revisionId);
    assert.equal((await core.configs.getCurrentPublication(shopId, configId)).activationKind, 'RESTORATION_PENDING');
    const evidence = (await activation.read(identity)).evidence;
    assert.equal(evidence.admissionClass, 'FIRST_PUBLICATION');
    assert.equal(evidence.version, 'm5-activation-evidence-v2');
    assert.equal(evidence.decisionVersion, 2);
    assert.equal(evidence.hold.version, 'm5-availability-hold-v2');
    assert.equal((await activation.advance(identity)).kind, 'ACTIVE');
    assert.equal(status, 'ACTIVE');
    assert.equal((await core.configs.getCurrentPublication(shopId, configId)).activationKind, 'RESTORED');
    assert.equal(await core.configs.getAvailabilityRecovery(shopId, configId), null);
    assert.equal(mutationCount, 2);
    assert.deepEqual((await activation.read(identity)).evidence, evidence);
    if (process.env.M5_ACTIVATION_EXAMPLE_PATH)
      await writeFile(process.env.M5_ACTIVATION_EXAMPLE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
    assert.equal((await activation.advance(identity)).kind, 'ACTIVE');
    assert.equal(mutationCount, 2);
  } finally {
    await core.close();
  }
});
