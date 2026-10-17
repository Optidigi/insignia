import assert from 'node:assert/strict';
import { createHash, createHmac, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createDurableCore, sha256CanonicalJson } from '@insignia/database';
import { abstractFetch, setAbstractFetchFunc } from '@shopify/shopify-api/runtime';
import { build } from 'esbuild';
import { Pool } from 'pg';
import binding from '../../../../deployment/m5-runtime/native-function-module-binding.json' with { type: 'json' };
import { qualifyReleaseAppendInput } from '../../../../scripts/m5-runtime/release-append.mjs';
import { createReleaseVerificationServer } from '../../../../scripts/m5-runtime/release-verification-server.mjs';
import { collectFreshTrustedRelease } from '../../../../scripts/m5-runtime/trusted-release-collector.mjs';
import { fixture as collectorFixture } from '../../../../scripts/m5-runtime/trusted-release-collector-fixture.mjs';
import { handleAdminRequest } from '../../src/server/admin/http.ts';
import { createReleaseVerificationClient } from '../../src/server/admin/release-verification.ts';
import { isolatedDatabase } from '../support/isolated-database.mjs';

const database = process.env.DATABASE_URL;
const client = binding.appClientId;
const secret = 'synthetic-m5-composition-secret';
const productId = 'gid://shopify/Product/555';
const appId = `gid://shopify/App/${binding.appId}`;
const queries = {
  transform: await readFile(
    new URL('../../../../extensions/insignia-cart-transform/src/cart_transform_run.graphql', import.meta.url),
    'utf8',
  ),
  validation: await readFile(
    new URL(
      '../../../../extensions/insignia-cart-validation/src/cart_validations_generate_run.graphql',
      import.meta.url,
    ),
    'utf8',
  ),
};
function staffToken(shop) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: `https://${shop}/admin`,
      dest: `https://${shop}`,
      aud: client,
      sub: '23',
      sid: 'synthetic-session-23',
      iat: now,
      nbf: now - 1,
      exp: now + 3600,
      jti: 'synthetic-composition-jti',
    }),
  ).toString('base64url');
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}
function validDraft() {
  return {
    version: 'm5-merchant-draft-v1',
    mode: 'optional',
    shopCurrency: 'USD',
    methods: [{ id: 'print' }],
    placements: [{ id: 'front', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: true }],
    productionOptions: [],
    pricingRules: [],
    geometry: {
      version: 'm5-geometry-v1',
      views: [
        {
          id: 'front-view',
          image: { revisionId: 'product_555', width: 800, height: 900 },
          variantImages: [],
          placements: [{ id: 'front', rect: { centerX: 0.5, centerY: 0.5, width: 0.4, height: 0.3 } }],
        },
      ],
      steps: [{ id: 'small', widthFraction: 0.5, heightFraction: 0.5 }],
    },
  };
}
for (const releaseMode of [
  'missing',
  'trusted-function-mismatch',
  'demand-function-mismatch',
  'demand-signing',
  'demand-success',
  'demand-lost-ack',
  'demand-expired',
  'demand-failure',
  'demand-unrelated-completion',
])
  test(`production composition uses signed staff SDK, current policy and trusted readiness: ${releaseMode}`, {
    skip: !database,
    timeout: 70000,
  }, async (t) => {
    const output = new URL('../../.astro/m5-production-composition.mjs', import.meta.url);
    await mkdir(new URL('../../.astro/', import.meta.url), { recursive: true });
    await build({
      entryPoints: [new URL('../../src/server/admin/production.ts', import.meta.url).pathname],
      outfile: output.pathname,
      platform: 'node',
      format: 'esm',
      bundle: true,
      packages: 'external',
    });
    const { createProductionAdminServices } = await import(output.href);
    const isolated = await isolatedDatabase('m5publication');
    const fixtureDatabase = isolated.connectionString;
    const pool = new Pool({ connectionString: fixtureDatabase });
    const core = createDurableCore(pool);
    const oldFetch = globalThis.fetch;
    const oldSdkFetch = abstractFetch;
    const tenantId = randomUUID();
    const shopNumber = String(BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`) + 1n);
    const shopId = `gid://shopify/Shop/${shopNumber}`;
    const lostAcknowledgement = releaseMode === 'demand-lost-ack';
    const successful = releaseMode === 'demand-success' || lostAcknowledgement;
    const signing = releaseMode === 'demand-signing' || successful;
    const origin = signing ? 'https://insignia-app.optidigi.nl' : 'https://synthetic.example';
    const shop = signing ? 'insignia-rewrite-dev.myshopify.com' : `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
    let providerMode = 'current';
    let unexpectedUsageItem = false;
    let entitlementNow = '2026-09-30T23:59:59.999Z';
    let adminMutations = 0;
    let partnerReads = 0;
    let sdkExchanges = 0;
    let functionReads = 0;
    let runtimePool,
      writerPool,
      verificationServer,
      socketDirectory,
      verificationClient,
      signingConfiguration,
      ownerDirectory;
    let collected = 0;
    let authenticationInFlight = 0;
    const role = 'm5022_runtime_' + randomUUID().replaceAll('-', '');
    try {
      await core.transactions.run((tx) =>
        core.tenants.createShop(tx, {
          shopId: tenantId,
          shopDomain: shop,
          shopifyShopId: shopNumber,
          externalInstallationId: 'gid://shopify/AppInstallation/9',
        }),
      );
      const auth = await pool.query(
        'SELECT authorization_generation FROM installation_generations WHERE shop_id=$1 AND generation=1',
        [tenantId],
      );
      const pair = generateKeyPairSync('ed25519');
      const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
      if (!signing)
        await pool.query(
          'INSERT INTO signing_keys (shop_id,installation_generation,authorization_generation,key_id,public_key,public_key_fingerprint,private_envelope,wrapping_key_id,state,first_valid_day,last_valid_day) VALUES ($1,1,$2,7,$3,$4,$5,$6,$7,20000,21000)',
          [
            tenantId,
            auth.rows[0].authorization_generation,
            publicKey,
            createHash('sha256').update(publicKey).digest('hex'),
            { v: 1 },
            'synthetic',
            'pending',
          ],
        );
      if (releaseMode !== 'missing') {
        const observedAt = new Date(Date.now() - (releaseMode === 'demand-expired' ? 60_000 : 0)).toISOString();
        const expected = {
          schemaVersion: 1,
          shopId: tenantId,
          installationGeneration: '1',
          appClientId: client,
          appVersionRef: '1163229200385',
          devPreviewRef: null,
          sourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
          transform: {
            functionId: 'expected-transform',
            handle: 'insignia-experimental-v2-transform',
            apiType: 'cart_transform',
            apiVersion: '2026-07',
            inputQuerySha256: createHash('sha256').update(queries.transform).digest('hex'),
            wasmSha256: 'c'.repeat(64),
          },
          validation: {
            functionId: 'expected-validation',
            handle: 'insignia-experimental-v2-validation',
            apiType: 'cart_checkout_validation',
            apiVersion: '2026-07',
            inputQuerySha256: createHash('sha256').update(queries.validation).digest('hex'),
            wasmSha256: 'e'.repeat(64),
          },
        };
        const record = {
          version: 'm5-trusted-release-v1',
          recordId: randomUUID(),
          activeAppVersionRef: expected.appVersionRef,
          attestation: {
            ...expected,
            evidenceKind: 'RELEASE_BOUND',
            observedAt,
            expiresAt: new Date(Date.parse(observedAt) + 30_000).toISOString(),
          },
        };
        const proof = 'f'.repeat(64);
        const appendRecord = (writer) =>
          writer.query(
            'INSERT INTO trusted_release_records(record_id,shop_id,installation_generation,app_client_id,active_app_version_ref,expected_build,trusted_record,active_version_observed_at,active_version_evidence_sha256,evidence_digest) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9)',
            [
              record.recordId,
              tenantId,
              client,
              expected.appVersionRef,
              expected,
              record,
              record.attestation.observedAt,
              proof,
              sha256CanonicalJson({
                trustedRecord: record,
                expectedBuild: expected,
                activeVersionObservedAt: record.attestation.observedAt,
                activeVersionEvidenceSha256: proof,
              }),
            ],
          );
        if (releaseMode === 'trusted-function-mismatch') await appendRecord(pool);
        await pool.query('CREATE ROLE ' + role + ' NOLOGIN');
        await pool.query('GRANT USAGE ON SCHEMA public TO ' + role);
        await pool.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ' + role);
        await pool.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ' + role);
        await pool.query('REVOKE INSERT,UPDATE,DELETE ON trusted_release_records FROM ' + role);
        runtimePool = new Pool({ connectionString: fixtureDatabase, options: '-c role=' + role });
        if (releaseMode.startsWith('demand-')) {
          await pool.query('CREATE ROLE ' + role + '_writer NOLOGIN');
          await pool.query('GRANT USAGE ON SCHEMA public TO ' + role + '_writer');
          await pool.query('GRANT INSERT ON trusted_release_records TO ' + role + '_writer');
          await pool.query('GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ' + role + '_writer');
          writerPool = new Pool({ connectionString: fixtureDatabase, options: '-c role=' + role + '_writer' });
          socketDirectory = await mkdtemp(join(tmpdir(), 'm5-verify-composition-'));
          const socketPath = join(socketDirectory, 'collector.sock');
          const requestBinding = {
            shopId: tenantId,
            installationGeneration: '1',
            appClientId: client,
            authorizationGeneration: auth.rows[0].authorization_generation,
            authorizationEpoch: 0,
            externalInstallationId: 'gid://shopify/AppInstallation/9',
          };
          verificationServer = createReleaseVerificationServer({
            readBinding: async () => requestBinding,
            async collect() {
              collected++;
              if (releaseMode === 'demand-failure')
                return {
                  classification: 'TRUSTED_RELEASE_COLLECT_STOPPED',
                  appendAttempted: false,
                  appendAcknowledged: false,
                  ambiguousWrite: false,
                  retryAuthorized: false,
                };
              // No database transaction may span independent collection.
              const open = await pool.query(
                "SELECT count(*)::integer n FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'",
              );
              if (open.rows[0].n !== 0)
                console.error(
                  'SYNTHETIC_COLLECTION_TRANSACTION_BOUNDARY',
                  JSON.stringify({
                    openTransactions: open.rows[0].n,
                    authenticationInFlight,
                  }),
                );
              assert.equal(open.rows[0].n, 0);
              if (successful) {
                const f = await collectorFixture({
                  root: socketDirectory,
                  time: Date.now(),
                  recordId: randomUUID(),
                  binding: {
                    tenantShopId: tenantId,
                    installationGeneration: '1',
                    shopId,
                    externalInstallationId: requestBinding.externalInstallationId,
                    authorizationGeneration: requestBinding.authorizationGeneration,
                    authorizationEpoch: 0,
                  },
                  functionIds: { transform: 'expected-transform', validation: 'expected-validation' },
                });
                f.ports.readTenant = async () => {
                  const managed = await core.tenants.getManagedInstallationState(shop);
                  const current = await core.tenants.getActiveAuthorizationScope({
                    shopId: managed.shopId,
                    installationGeneration: managed.currentGeneration,
                  });
                  return {
                    shop,
                    tenantShopId: managed.shopId,
                    installationGeneration: managed.currentGeneration,
                    shopId: `gid://shopify/Shop/${managed.shopifyShopId}`,
                    externalInstallationId: managed.externalInstallationId,
                    authorizationGeneration: current.authorizationGeneration,
                    authorizationEpoch: current.authorizationEpoch,
                  };
                };
                f.ports.append = async (input) => {
                  const q = qualifyReleaseAppendInput(input, Date.now());
                  await writerPool.query(
                    'INSERT INTO trusted_release_records(record_id,shop_id,installation_generation,app_client_id,active_app_version_ref,expected_build,trusted_record,active_version_observed_at,active_version_evidence_sha256,evidence_digest) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9)',
                    [
                      input.recordId,
                      tenantId,
                      client,
                      q.record.activeAppVersionRef,
                      q.expected,
                      q.record,
                      q.observations.observedAt,
                      q.observations.proof,
                      q.digest,
                    ],
                  );
                  const read = await createDurableCore(runtimePool).trustedReleaseRecords.read({
                    scope: q.scope,
                    expectedActiveAppVersionRef: q.record.activeAppVersionRef,
                    now: new Date(),
                  });
                  assert.equal(read.record.recordId, input.recordId);
                  return {
                    classification: 'TRUSTED_RELEASE_APPEND_ACK_RUNTIME_QUALIFIED',
                    recordId: input.recordId,
                    writeAttempted: true,
                    writeAcknowledged: true,
                  };
                };
                const result = await collectFreshTrustedRelease(f.config, f.ports);
                if (lostAcknowledgement && collected === 1) throw new Error('Synthetic collector completion lost');
                return { ...result, recordId: f.config.recordId };
              }
              await appendRecord(writerPool);
              return {
                classification: 'TRUSTED_RELEASE_COLLECT_APPEND_ACK',
                appendAttempted: true,
                appendAcknowledged: true,
                ambiguousWrite: false,
                retryAuthorized: false,
                recordId: releaseMode === 'demand-unrelated-completion' ? randomUUID() : record.recordId,
              };
            },
          });
          await new Promise((resolve) => verificationServer.listen(socketPath, resolve));
          verificationClient = createReleaseVerificationClient(socketPath);
          if (signing) {
            ownerDirectory = await mkdtemp(join(tmpdir(), 'm5-signing-composition-'));
            const day = Math.floor(Date.now() / 86400000);
            signingConfiguration = {
              directory: join(ownerDirectory, 'attempt'),
              plan: { keyId: 7, firstDay: day - 1, lastDay: day + 3 },
              binding: {
                shop,
                shopId,
                installationId: requestBinding.externalInstallationId,
                tenantShopId: tenantId,
                installationGeneration: '1',
                authorizationGeneration: requestBinding.authorizationGeneration,
                authorizationEpoch: 0,
              },
              ring: { currentKeyId: 'synthetic-wrap', keys: { 'synthetic-wrap': randomBytes(32) } },
            };
          }
        }
      }
      setAbstractFetchFunc(async (url, init) => {
        sdkExchanges++;
        assert.equal(String(url), `https://${shop}/admin/oauth/access_token`);
        assert.equal(JSON.parse(String(init.body)).client_id, client);
        return Response.json({
          access_token: 'synthetic-online-grant',
          scope: 'read_products,write_products,read_cart_transforms,read_validations',
          expires_in: 3600,
          associated_user_scope: 'read_products,write_products,read_cart_transforms,read_validations',
          associated_user: { id: 23 },
        });
      });
      let publicConfig = null;
      const productFields = new Map();
      globalThis.fetch = async (url, init) => {
        const address = String(url);
        const { query, variables } = JSON.parse(String(init.body));
        if (address.startsWith('https://partners.shopify.com/')) {
          partnerReads++;
          assert.match(query, /^query ActiveSubscription/);
          if (providerMode === 'ended') return Response.json({ data: { activeSubscription: null } });
          const active = providerMode !== 'ended';
          const planHandle = providerMode === 'unrecognized' ? 'plan.unknown' : 'plan.m5';
          return Response.json({
            data: {
              activeSubscription: {
                app: { id: appId },
                shop: { id: shopId },
                billingPeriod: 'EVERY_30_DAYS',
                cancelAtEndOfCycle: providerMode === 'cancelled',
                trialEndsAt: null,
                currentBillingCycle: { startTime: '2026-09-01T00:00:00Z', endTime: '2026-10-01T00:00:00Z' },
                items: [
                  {
                    handle: planHandle,
                    price: { __typename: 'FlatRatePrice', active, currency: 'USD', amount: '29.00' },
                    discount: null,
                    usage: null,
                  },
                  ...(unexpectedUsageItem
                    ? [
                        {
                          handle: 'meter.m5',
                          price: {
                            __typename: 'TieredPrice',
                            active,
                            currency: 'USD',
                            tiersMode: 'GRADUATED',
                            tiers: [{ upTo: null, amountPerUnit: '0.00', amount: '0.00' }],
                          },
                          discount: null,
                          usage: { quantity: 0, cost: { amount: '0.00', currencyCode: 'USD' } },
                        },
                      ]
                    : []),
                ],
                pendingUpdate:
                  providerMode === 'pending'
                    ? { billingPeriod: 'EVERY_30_DAYS', items: [{ handle: 'plan.future' }] }
                    : null,
              },
            },
          });
        }
        assert.equal(address, `https://${shop}/admin/api/2026-07/graphql.json`);
        assert.equal(new Headers(init.headers).get('x-shopify-access-token'), 'synthetic-online-grant');
        if (/^mutation\b/.test(query)) {
          adminMutations++;
          if (signing && query.includes('InsigniaSet')) {
            const input = variables.metafields[0];
            const field = {
              owner: { id: input.ownerId },
              namespace: `app--${binding.appId}`,
              key: input.key,
              type: input.type,
              value: input.value,
              compareDigest: '1'.repeat(64),
            };
            if (input.ownerId === shopId) publicConfig = input.value;
            else productFields.set(input.key, field);
            return Response.json({ data: { metafieldsSet: { userErrors: [], metafields: [field] } } });
          }
          throw new Error('Synthetic test forbids remote mutation');
        }
        if (query.includes('M5001StaffInstallation'))
          return Response.json({
            data: {
              shop: { id: shopId, myshopifyDomain: shop, ianaTimezone: 'America/New_York' },
              currentAppInstallation: {
                id: 'gid://shopify/AppInstallation/9',
                accessScopes: ['read_products', 'write_products', 'read_cart_transforms', 'read_validations'].map(
                  (handle) => ({ handle }),
                ),
              },
            },
          });
        if (query.includes('M5001Product'))
          return Response.json({
            data: {
              product: {
                id: productId,
                title: 'Synthetic shirt',
                status: 'ACTIVE',
                featuredMedia: null,
                variants: { nodes: [], pageInfo: { hasNextPage: false } },
              },
            },
          });
        if (query.includes('M5001ShopCurrency')) return Response.json({ data: { shop: { currencyCode: 'USD' } } });
        if (query.includes('InsigniaReadPublicConfig'))
          return Response.json({
            data: {
              shop: {
                id: shopId,
                field:
                  publicConfig === null
                    ? null
                    : {
                        owner: { id: shopId },
                        namespace: `app--${binding.appId}`,
                        key: 'insignia_public_config_v2',
                        type: 'json',
                        value: publicConfig,
                        compareDigest: '1'.repeat(64),
                      },
              },
            },
          });
        if (query.includes('InsigniaOwnedFunctions')) {
          functionReads++;
          if (signing && (successful || functionReads <= 2)) {
            const functions = [
              {
                id: 'expected-transform',
                handle: 'insignia-experimental-v2-transform',
                apiType: 'cart_transform',
                apiVersion: '2026-07',
                appKey: client,
                inputQuery: queries.transform,
              },
              {
                id: 'expected-validation',
                handle: 'insignia-experimental-v2-validation',
                apiType: 'cart_checkout_validation',
                apiVersion: '2026-07',
                appKey: client,
                inputQuery: queries.validation,
              },
            ];
            return Response.json({
              data: {
                shop: { id: shopId },
                shopifyFunctions: { nodes: functions, pageInfo: { hasNextPage: false } },
                cartTransforms: {
                  nodes: [
                    { id: 'synthetic-transform-instance', functionId: 'expected-transform', blockOnFailure: true },
                  ],
                  pageInfo: { hasNextPage: false },
                },
                validations: {
                  nodes: [
                    {
                      id: 'synthetic-validation-instance',
                      enabled: true,
                      blockOnFailure: true,
                      shopifyFunction: functions[1],
                    },
                  ],
                  pageInfo: { hasNextPage: false },
                },
              },
            });
          }
          return Response.json({
            data: {
              shopifyFunctions: {
                nodes: [
                  {
                    id: 'wrong-transform',
                    title: 'Synthetic',
                    handle: 'insignia-experimental-v2-transform',
                    apiType: 'cart_transform',
                    apiVersion: '2026-07',
                    appKey: client,
                  },
                  {
                    id: 'wrong-validation',
                    title: 'Synthetic',
                    handle: 'insignia-experimental-v2-validation',
                    apiType: 'cart_checkout_validation',
                    apiVersion: '2026-07',
                    appKey: client,
                  },
                ],
                pageInfo: { hasNextPage: false },
              },
              cartTransforms: { nodes: [], pageInfo: { hasNextPage: false } },
              validations: { nodes: [], pageInfo: { hasNextPage: false } },
            },
          });
        }
        if (query.includes('InsigniaReadRegistration') || query.includes('InsigniaReadPolicy'))
          return Response.json({
            data: {
              node: {
                __typename: 'Product',
                id: productId,
                field:
                  productFields.get(
                    query.includes('InsigniaReadRegistration') ? 'insignia_registration_v2' : 'insignia_policy_v2',
                  ) ?? null,
              },
            },
          });
        if (query.includes('InsigniaAvailabilityV3Product'))
          return Response.json({
            data: {
              shop: { id: shopId },
              currentAppInstallation: {
                app: { apiKey: client },
                accessScopes: ['read_products', 'write_products', 'read_publications', 'read_product_listings'].map(
                  (handle) => ({ handle }),
                ),
              },
              node: {
                __typename: 'Product',
                id: productId,
                status: 'DRAFT',
                updatedAt: '2026-10-01T00:00:00Z',
                publishedAt: null,
                onlineStoreUrl: null,
                resourcePublications: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
              },
            },
          });
        throw new Error('Unexpected synthetic Admin document');
      };
      const policy = {
        policyVersion: 'synthetic-v1',
        maxAgeMs: 300000,
        plans: [
          {
            planHandle: 'plan.m5',
            billing: 'recurring-only',
            policyId: 'synthetic-plan',
            features: ['base', 'required', 'logo', 'options', 'pricing'],
          },
        ],
      };
      const features = {
        base: 'base',
        required: 'required',
        logoLater: 'logo',
        options: 'options',
        pricing: 'pricing',
      };
      const compose = () =>
        createProductionAdminServices(
          {
            DATABASE_URL: fixtureDatabase,
            SHOPIFY_CLIENT_ID: client,
            SHOPIFY_CLIENT_SECRET: secret,
            APP_URL: origin,
            INSIGNIA_SHOPIFY_APP_ID: binding.appId,
            INSIGNIA_PARTNER_ORGANIZATION_ID: '12345',
            INSIGNIA_PARTNER_ACCESS_TOKEN: 'synthetic-partner-grant',
            INSIGNIA_M5_ENTITLEMENT_POLICY_JSON: JSON.stringify(policy),
            INSIGNIA_M5_FEATURES_JSON: JSON.stringify(features),
          },
          runtimePool ?? pool,
          () => new Date(entitlementNow),
          undefined,
          signingConfiguration,
          verificationClient,
        );
      let services = compose();
      const actor = await services.authenticate(
        new Request(origin + '/api/admin/products', {
          headers: { Authorization: `Bearer ${staffToken(shop)}` },
        }),
      );
      assert.ok(actor?.canEdit && actor.tenantShopId === tenantId);
      const created = await services.configs.create(actor, productId, 'composition-create');
      assert.equal(created.kind, 'created');
      const saved = await services.configs.save(actor, productId, {
        configId: created.configId,
        draftVersion: '1',
        draft: validDraft(),
        idempotencyKey: 'composition-save',
      });
      assert.equal(saved.kind, 'saved');
      // Recurring-only entitlement rejects an unexpected provider usage item.
      unexpectedUsageItem = true;
      const meteredRead = await services.configs.read(actor, productId);
      assert.equal(meteredRead.config.publishEligibility.allowed, false, 'an added meter denies Lean publication');
      unexpectedUsageItem = false;
      for (const [mode, allowed] of [
        ['current', true],
        ['pending', true],
        ['cancelled', true],
        ['ended', false],
        ['unrecognized', false],
      ]) {
        providerMode = mode;
        const read = await services.configs.read(actor, productId);
        assert.equal(read.config.publishEligibility.allowed, allowed, mode);
      }
      providerMode = 'cancelled';
      for (const [instant, allowed] of [
        ['2026-09-30T23:59:59.999Z', true],
        ['2026-10-01T00:00:00.000Z', false],
        ['2026-10-01T00:00:00.001Z', false],
      ]) {
        await t.test(`scheduled cancellation boundary ${instant}: allowed=${allowed}`, async () => {
          entitlementNow = instant;
          const read = await services.configs.read(actor, productId);
          assert.equal(read.config.publishEligibility.allowed, allowed);
        });
      }
      entitlementNow = '2026-09-30T23:59:59.999Z';
      providerMode = 'current';
      if (releaseMode === 'demand-success') {
        // Exercise concurrent publication after both real authentication transactions
        // commit: a sibling bootstrap transaction is not the collector's caller.
        const authenticated = Promise.withResolvers();
        void authenticated.promise.catch(() => {});
        const authenticate = services.authenticate.bind(services);
        let completed = 0;
        services = {
          ...services,
          async authenticate(request) {
            authenticationInFlight++;
            let actor;
            try {
              actor = await authenticate(request);
            } catch (error) {
              authenticated.reject(error);
              throw error;
            } finally {
              authenticationInFlight--;
            }
            if (++completed === 2) authenticated.resolve();
            await authenticated.promise;
            return actor;
          },
        };
      }
      const publishRequest = () =>
        handleAdminRequest(
          new Request(origin + '/api/admin/products/555/config', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${staffToken(shop)}`,
              Origin: origin,
              'Content-Type': 'application/json',
              'Idempotency-Key': 'composition-publish',
            },
            body: JSON.stringify({ action: 'publish', configId: created.configId, draftVersion: saved.draftVersion }),
          }),
          services,
          { kind: 'config', productId },
        );
      const responses =
        releaseMode === 'demand-success'
          ? await Promise.all([publishRequest(), publishRequest()])
          : [await publishRequest()];
      let publishResponse = responses[0];
      if (lostAcknowledgement) {
        assert.equal(publishResponse.status, 403);
        assert.equal(adminMutations, 0);
        assert.equal(
          (await pool.query('SELECT count(*)::integer n FROM signing_keys WHERE shop_id=$1', [tenantId])).rows[0].n,
          0,
        );
        assert.equal(await core.configs.getCurrentPublication(tenantId, created.configId), null);
        services = compose(); // New runtime context reads the settled immutable collector record; no redispatch.
        publishResponse = await publishRequest();
        assert.equal(collected, 1);
      }
      if (['demand-expired', 'demand-failure', 'demand-unrelated-completion'].includes(releaseMode)) {
        assert.equal(publishResponse.status, 403);
        const config = await core.configs.getConfig(tenantId, created.configId);
        assert.equal(config.effectiveRevisionId, null);
        assert.equal(await core.configs.getCurrentPublication(tenantId, created.configId), null);
        assert.equal(collected, 1);
        assert.equal(adminMutations, 0);
        return;
      }
      assert.equal(publishResponse.status, 202, await publishResponse.clone().text());
      const published = await publishResponse.json();
      if (successful) {
        assert.equal(published.state, 'ACTIVE');
        if (!lostAcknowledgement) {
          assert.equal(responses[1].status, 202);
          assert.equal((await responses[1].json()).revisionId, published.revisionId);
        }
        const effective = await core.configs.getConfig(tenantId, created.configId);
        assert.equal(effective.effectiveRevisionId, published.revisionId);
        const current = await core.configs.getCurrentPublication(tenantId, created.configId);
        assert.equal(current.status, 'activated');
        assert.equal(current.activationKind, 'RESTORED');
        const evidence = (
          await pool.query('SELECT evidence FROM m5_activation_evidence WHERE shop_id=$1 AND operation_id=$2', [
            tenantId,
            current.operationId,
          ])
        ).rows[0].evidence;
        assert.equal(evidence.version, 'm5-activation-evidence-v3');
        assert.equal(evidence.admissionClass, 'FIRST_PUBLICATION');
        assert.equal(collected, 1);
        assert.equal(
          (await pool.query('SELECT count(*)::integer n FROM signing_keys WHERE shop_id=$1', [tenantId])).rows[0].n,
          1,
        );
        assert.equal(adminMutations, 4);
        if (lostAcknowledgement) return;
        // Completed startup allocation is not part of ordinary publication.
        // Recompose without it; retained keys and current M4 evidence must suffice.
        signingConfiguration = undefined;
        services = compose();
        assert.equal(services.signingOwner, undefined);
        // Idempotent settled replay must not depend on a collector after evidence expires.
        await new Promise((resolve) => setTimeout(resolve, 31_000));
        await new Promise((resolve) => verificationServer.close(resolve));
        const replay = await handleAdminRequest(
          new Request(origin + '/api/admin/products/555/config', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${staffToken(shop)}`,
              Origin: origin,
              'Content-Type': 'application/json',
              'Idempotency-Key': 'composition-publish',
            },
            body: JSON.stringify({ action: 'publish', configId: created.configId, draftVersion: saved.draftVersion }),
          }),
          services,
          { kind: 'config', productId },
        );
        assert.equal(replay.status, 202, JSON.stringify(await replay.clone().json()));
        assert.equal((await replay.json()).state, 'ACTIVE');
        assert.equal(collected, 1);
        assert.equal(adminMutations, 4);
        // The next immutable revision needs fresh authority even though the key is already provisioned.
        await new Promise((resolve) => verificationServer.listen(join(socketDirectory, 'collector.sock'), resolve));
        const nextDraft = await services.configs.save(actor, productId, {
          configId: created.configId,
          draftVersion: saved.draftVersion,
          draft: validDraft(),
          idempotencyKey: 'composition-save-next',
        });
        assert.equal(nextDraft.kind, 'saved');
        const next = await handleAdminRequest(
          new Request(origin + '/api/admin/products/555/config', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${staffToken(shop)}`,
              Origin: origin,
              'Content-Type': 'application/json',
              'Idempotency-Key': 'composition-publish-next',
            },
            body: JSON.stringify({
              action: 'publish',
              configId: created.configId,
              draftVersion: nextDraft.draftVersion,
            }),
          }),
          services,
          { kind: 'config', productId },
        );
        assert.equal(next.status, 202);
        const activated = await next.json();
        assert.equal(activated.state, 'ACTIVE');
        assert.notEqual(activated.revisionId, published.revisionId);
        assert.equal(collected, 2);
        assert.equal(
          (await pool.query('SELECT count(*)::integer n FROM signing_keys WHERE shop_id=$1', [tenantId])).rows[0].n,
          1,
        );
        t.mock.timers.reset();
        return;
      }

      assert.equal(published.kind, 'accepted');
      assert.equal(published.state, 'ACTIVATION_WAITING_RELEASE');
      assert.equal(
        (await services.configs.read(actor, productId)).config.publication.state,
        'ACTIVATION_WAITING_RELEASE',
      );
      const pending = await core.configs.getConfig(tenantId, created.configId);
      assert.equal(pending.effectiveRevisionId, null);
      assert.equal(
        (await core.configs.getCurrentPublication(tenantId, created.configId)).activationKind,
        'WAITING_RELEASE',
      );
      assert.ok(partnerReads >= 7 && sdkExchanges === (signing ? 3 : 2));
      assert.equal(collected, releaseMode.startsWith('demand-') ? 1 : 0);
      assert.equal(adminMutations, signing ? 1 : 0, 'Only the internal signing public-config CAS may be dispatched');
      if (signing) {
        const keys = await pool.query('SELECT state FROM signing_keys WHERE shop_id=$1', [tenantId]);
        assert.deepEqual(keys.rows, [{ state: 'active' }]);
        assert.equal((await services.signingOwner.status(actor)).state, 'PROVISIONED');
        assert.equal(functionReads, 3);
      }
      assert.equal(
        functionReads > 0,
        releaseMode !== 'missing',
        'only authenticated trusted evidence permits current Function observation',
      );
    } finally {
      t.mock.timers.reset();
      globalThis.fetch = oldFetch;
      setAbstractFetchFunc(oldSdkFetch);
      await runtimePool?.end();
      await writerPool?.end();
      if (verificationServer) await new Promise((resolve) => verificationServer.close(resolve));
      if (socketDirectory) await rm(socketDirectory, { recursive: true, force: true });
      if (ownerDirectory) await rm(ownerDirectory, { recursive: true, force: true });
      await pool.query('DROP OWNED BY ' + role + '_writer').catch(() => {});
      await pool.query('DROP ROLE ' + role + '_writer').catch(() => {});
      await pool.query('DROP OWNED BY ' + role).catch(() => {});
      await pool.query('DROP ROLE ' + role).catch(() => {});
      await pool.end();
      await isolated.close();
    }
  });
