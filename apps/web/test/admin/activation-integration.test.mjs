import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { SigningKeyLifecycle } from '@insignia/application';
import { createDurableCore } from '@insignia/database';
import { createShopifyAvailabilityHoldV3Port } from '@insignia/shopify';
import { Pool } from 'pg';
import { handleAdminRequest } from '../../src/server/admin/http.ts';
import { createServerActivationReadiness } from '../../src/server/admin/release-evidence.ts';
import { createMerchantConfigService } from '../../src/server/merchant-config.ts';

const database = process.env.DATABASE_URL;
test('real admin HTTP publish commits PG v3 activation and immutable evidence without reentry writes', {
  skip: !database,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  try {
    let shopId = randomUUID(),
      configId = randomUUID(),
      revisionId = null,
      operationId = null;
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
        draftValue: {
          version: 'm5-merchant-draft-v1',
          mode: 'required',
          shopCurrency: 'USD',
          methods: [{ id: 'print' }],
          placements: [
            { id: 'front', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: false },
          ],
          productionOptions: [],
          pricingRules: [],
          geometry: {
            version: 'm5-geometry-v1',
            views: [
              {
                id: 'front',
                variantImages: [],
                placements: [{ id: 'front', rect: { centerX: 0.5, centerY: 0.5, width: 0.3, height: 0.3 } }],
              },
            ],
            steps: [{ id: 'small', widthFraction: 0.5, heightFraction: 0.5 }],
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
      resourcePublications: {
        nodes:
          status === 'ACTIVE'
            ? [
                {
                  publication: { id: 'gid://shopify/Publication/303' },
                  isPublished: true,
                  publishDate: '2026-10-01T11:00:00Z',
                },
              ]
            : [],
        pageInfo: { hasNextPage: false, hasPreviousPage: false },
      },
    });
    const availability = createShopifyAvailabilityHoldV3Port({
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
    let releaseReady = true;
    let eligible = true;
    const readiness = createServerActivationReadiness(
      {
        expectedBuild: { read: async () => build },
        observeFunctions: async () => ({ transform: 'present', validation: 'present', observation }),
        currentDay: () => 20727,
      },
      {
        read: async () =>
          releaseReady
            ? {
                version: 'm5-trusted-release-v1',
                recordId: 'synthetic-release-1',
                activeAppVersionRef: 'synthetic-release',
                attestation: {
                  ...build,
                  evidenceKind: 'RELEASE_BOUND',
                  observedAt: now().toISOString(),
                  expiresAt: '2026-10-02T00:00:00Z',
                },
              }
            : null,
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
    const actor = {
      shop: 's' + shopId.replaceAll('-', '') + '.myshopify.com',
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
      get: async (_actor, gid) =>
        gid === `gid://shopify/Product/${productId}`
          ? { id: gid, title: 'Synthetic admin shirt', status, imageUrl: null, variants: [] }
          : null,
      shopCurrency: async () => 'USD',
    };
    const configs = createMerchantConfigService({
      core,
      catalog,
      eligibility: async () => ({ allowed: eligible, reason: eligible ? null : 'Synthetic feature revoked' }),
      publication: () => activation.publications,
      activation: () => activation,
    });
    const services = { appOrigin: 'https://synthetic.example', authenticate: async () => actor, catalog, configs };
    let draftVersion = '1';
    const publish = async (key) =>
      handleAdminRequest(
        new Request(`https://synthetic.example/api/admin/products/${productId}/config`, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer synthetic-identity',
            Origin: 'https://synthetic.example',
            'Content-Type': 'application/json',
            'Idempotency-Key': key,
          },
          body: JSON.stringify({ action: 'publish', configId, draftVersion }),
        }),
        services,
        { kind: 'config', productId: `gid://shopify/Product/${productId}` },
      );
    const response = await publish('m5-018-first-publication');
    assert.equal(response.status, 202);
    const result = await response.json();
    assert.equal(result.state, 'ACTIVE');
    operationId = revisionId = result.revisionId;
    const identity = { shopId, configId, operationId };
    assert.equal((await core.configs.getConfig(shopId, configId)).effectiveRevisionId, revisionId);
    const evidence = (await activation.read(identity)).evidence;
    assert.equal(evidence.admissionClass, 'FIRST_PUBLICATION');
    assert.equal(evidence.version, 'm5-activation-evidence-v3');
    assert.equal(evidence.decisionVersion, 3);
    assert.equal(evidence.hold.version, 'm5-availability-hold-v3');
    assert.deepEqual(evidence.hold.before.effectiveVisibility.publishedPublicationIds, [
      'gid://shopify/Publication/303',
    ]);
    assert.equal(evidence.hold.before.effectiveAnchors[0].supportsFuturePublishing, true);
    assert.deepEqual(evidence.hold.held.effectiveVisibility.publishedPublicationIds, []);
    assert.equal(evidence.hold.acquisitionAcknowledgement.version, 'm5-availability-mutation-ack-v3');
    assert.equal(status, 'ACTIVE');
    assert.equal((await core.configs.getCurrentPublication(shopId, configId)).activationKind, 'RESTORED');
    assert.equal(await core.configs.getAvailabilityRecovery(shopId, configId), null);
    assert.equal(mutationCount, 2);
    assert.deepEqual((await activation.read(identity)).evidence, evidence);
    if (process.env.M5_ACTIVATION_EXAMPLE_PATH)
      await writeFile(process.env.M5_ACTIVATION_EXAMPLE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
    assert.equal((await (await publish('m5-018-first-publication')).json()).revisionId, revisionId);
    assert.equal(mutationCount, 2);
    assert.equal((await configs.read(actor, `gid://shopify/Product/${productId}`)).config.publication.state, 'ACTIVE');
    const original = await core.configs.getValidatedPublishedRevision(shopId, revisionId);
    const save = async (mode) => {
      const draft = structuredClone((await configs.read(actor, `gid://shopify/Product/${productId}`)).config.draft);
      draft.mode = mode;
      const response = await handleAdminRequest(
        new Request('https://synthetic.example/api/admin/config', {
          method: 'PUT',
          headers: {
            Authorization: 'Bearer synthetic-identity',
            Origin: 'https://synthetic.example',
            'Content-Type': 'application/json',
            'Idempotency-Key': `m5-018-save-${draftVersion}`,
          },
          body: JSON.stringify({ action: 'save', configId, draftVersion, draft }),
        }),
        services,
        { kind: 'config', productId: `gid://shopify/Product/${productId}` },
      );
      assert.equal(response.status, 200);
      draftVersion = (await response.json()).draftVersion;
    };
    await save('required');
    const same = await (await publish('m5-018-same-mode')).json();
    assert.equal(same.state, 'ACTIVE');
    const sameEvidence = (await activation.read({ shopId, configId, operationId: same.revisionId })).evidence;
    assert.equal(sameEvidence.version, 'm5-activation-evidence-v3');
    assert.equal(sameEvidence.admissionClass, 'SAME_MODE');
    assert.equal(sameEvidence.hold, null);
    assert.equal(mutationCount, 2);
    await save('optional');
    const changed = await (await publish('m5-018-mode-change')).json();
    assert.equal(changed.state, 'ACTIVE');
    const changedEvidence = (await activation.read({ shopId, configId, operationId: changed.revisionId })).evidence;
    assert.equal(changedEvidence.admissionClass, 'MODE_CHANGE');
    assert.equal(changedEvidence.hold.version, 'm5-availability-hold-v3');
    assert.equal(mutationCount, 4);
    assert.deepEqual(await core.configs.getValidatedPublishedRevision(shopId, revisionId), original);
    await save('required');
    releaseReady = false;
    const waiting = await (await publish('m5-018-release-blocked')).json();
    assert.equal(waiting.state, 'ACTIVATION_WAITING_RELEASE');
    assert.equal((await core.configs.getConfig(shopId, configId)).effectiveRevisionId, changed.revisionId);
    const pendingView = await configs.read(actor, `gid://shopify/Product/${productId}`);
    assert.equal(pendingView.config.publication.revisionId, waiting.revisionId);
    assert.equal(pendingView.config.publication.activeRevisionId, changed.revisionId);
    eligible = false;
    assert.equal((await publish('m5-018-release-blocked')).status, 403);
    assert.equal(mutationCount, 4);
    assert.equal((await core.configs.getConfig(shopId, configId)).effectiveRevisionId, changed.revisionId);
  } finally {
    await core.close();
  }
});
