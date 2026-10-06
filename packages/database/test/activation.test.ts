import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import type {
  ActivationReadinessPort,
  ExpectedFunctionBuild,
  FunctionObjectObservation,
  VersionedProductAvailabilityHoldPort as ProductAvailabilityHoldPort,
  ProductAvailabilitySnapshotV2 as ProductAvailabilitySnapshot,
} from '@insignia/application';
import { activationDigest, availabilitySnapshotIdentityDigest } from '@insignia/application';
import {
  createPublicationAdminAdapter,
  createPublicationAdminHttpTransport,
  createShopifyAvailabilityHoldPort,
  createShopifyAvailabilityHoldV2Port,
} from '@insignia/shopify';
import { type Kysely, sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/client/database.js';
import type { DurableCore } from '../src/durable-core.js';
import { createDurableCore } from '../src/index.js';
import { CONFIG_DRAFT_STORAGE_VERSION } from '../src/repositories/config.js';
import type { ProductionPublicationRemote } from '../src/repositories/production-publication.js';
import { createPublicationRepository } from '../src/repositories/publication.js';
import { openTestDatabase } from './support/postgres.js';

// No persisted production release record: these are injected synthetic premises only.
const now = new Date('2026-10-01T12:00:00.000Z');
const fieldKeys = {
  public_config: 'insignia_public_config_v2',
  registration: 'insignia_registration_v2',
  policy: 'insignia_policy_v2',
};
describe.runIf(Boolean(process.env.DATABASE_URL))('PG18 scoped production activation', () => {
  let database: Kysely<Database>;
  let core: DurableCore;
  let afterSql: ((text: string) => void) | undefined;
  beforeAll(async () => {
    database = await openTestDatabase();
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
    pool.on('connect', (client) => {
      const original = client.query.bind(client);
      client.query = ((...args: unknown[]) => {
        const result: unknown = Reflect.apply(original, client, args);
        if (result instanceof Promise)
          return result.then((rows) => {
            const input = args[0];
            const text =
              typeof input === 'string'
                ? input
                : input && typeof input === 'object' && 'text' in input && typeof input.text === 'string'
                  ? input.text
                  : '';
            afterSql?.(text);
            return rows;
          });
        return result;
      }) as typeof client.query;
    });
    core = createDurableCore(pool);
  });
  afterAll(async () => {
    await core?.close();
    await database?.destroy();
  });

  async function fixture(
    initialMode: 'required' | 'optional' = 'required',
    providerStatus?: string,
    httpPublication = false,
  ) {
    let providerClock = new Date(now);
    let providerDelay: { point: 'fetch' | 'body' | 'credential'; ms: number } | null = null;
    const providerWrites: string[] = [];
    const providerMutations: { status: string; at: number }[] = [];
    let calendarDelay: { at: number; call: number; ms: number; seen: number } | null = null;
    let status = providerStatus ?? 'ACTIVE';
    let version = '2026-10-01T11:00:00.000Z';
    let availabilityReads = 0;
    let restoreCredentialDelay: { afterReads: number; ms: number } | null = null;
    const shopId = randomUUID();
    const providerShop = BigInt(`0x${shopId.replaceAll('-', '').slice(0, 12)}`).toString();
    const configId = randomUUID();
    const revisionId = randomUUID();
    const operationId = randomUUID();
    await core.transactions.run(async (tx) => {
      await core.tenants.createShop(tx, { shopId, shopDomain: `${shopId}.test.example`, shopifyShopId: providerShop });
      await core.configs.createConfig(tx, {
        shopId,
        configId,
        externalProductId: '42',
        draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
        draftValue: {},
      });
    });
    const scope = await core.tenants.getActiveAuthorizationScope({ shopId, installationGeneration: '1' });
    if (!scope) throw new Error('Synthetic shop missing');
    const pair = generateKeyPairSync('ed25519');
    const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    await sql`INSERT INTO signing_keys (shop_id, installation_generation, authorization_generation, key_id,
      public_key, public_key_fingerprint, private_envelope, wrapping_key_id, state, first_valid_day, last_valid_day)
      VALUES (${shopId}, 1, ${scope.authorizationGeneration}::uuid, 7, ${publicKey},
        ${createHash('sha256').update(publicKey).digest('hex')}, '{"v":1}'::jsonb, 'synthetic', 'active', 20000, 30000)`.execute(
      database,
    );
    const createRevision = async (id: string, mode: 'required' | 'optional') =>
      core.transactions.run((tx) =>
        core.configs.createValidatedRevision(tx, {
          shopId,
          configId,
          revisionId: id,
          mode,
          sourceDraftVersion: '1',
          sourceInstallationGeneration: '1',
          createdByRef: 'synthetic',
          publishedValue: {
            version: 'm2-published-config-v1',
            shopId,
            productId: '42',
            revisionId: id,
            shopCurrency: 'USD',
            methods: [],
            placements: [],
            productionOptions: [],
            pricingRules: [],
          },
          geometry: {
            version: 'm5-geometry-v1',
            value: {
              version: 'm5-geometry-v1',
              views: [{ id: 'front', variantImages: [], placements: [] }],
              steps: [],
            },
          },
          presentation: { version: 'm5-presentation-v1', labels: {} },
        }),
      );
    await createRevision(revisionId, initialMode);
    const cells = new Map<
      string,
      { ownerId: string; namespace: string; key: string; type: string; value: string; compareDigest: string }
    >();
    let remoteReads = 0;
    let remoteWrites = 0;
    let beforeRead: (() => Promise<void>) | undefined;
    const syntheticRemote: ProductionPublicationRemote = {
      read: async (target) => {
        remoteReads++;
        await beforeRead?.();
        return cells.get(target.field) ?? null;
      },
      set: async (target) => {
        remoteWrites++;
        if ((cells.get(target.field)?.compareDigest ?? null) !== target.compareDigest)
          throw new Error('Synthetic CAS mismatch');
        const observed = {
          ownerId: target.productId ?? target.shopifyShopId,
          namespace: `app--${target.appId}`,
          key: fieldKeys[target.field],
          type: target.field === 'public_config' ? 'json' : 'single_line_text_field',
          value: target.value,
          compareDigest: createHash('sha256').update(target.value).digest('hex'),
        };
        cells.set(target.field, observed);
        return { observed };
      },
    };
    const httpMutations: { field: string; value: string; at: number }[] = [];
    let publicationCredentialCalls = 0;
    let publicationCredentialDelay: { call: number; ms: number; failure?: 'inactive' | 'error' | 'late' } | null = null;
    let releasePublicationCredential: (() => void) | undefined;
    const remote: ProductionPublicationRemote = httpPublication
      ? createPublicationAdminAdapter({
          transport: createPublicationAdminHttpTransport({
            now: () => new Date(providerClock),
            timeoutMs: 100,
            credentials: {
              acquire: async () => {
                publicationCredentialCalls++;
                if (publicationCredentialDelay?.call === publicationCredentialCalls) {
                  const delay = publicationCredentialDelay;
                  providerClock = new Date(providerClock.getTime() + delay.ms);
                  publicationCredentialDelay = null;
                  if (delay.failure === 'inactive') return { kind: 'inactive' };
                  if (delay.failure === 'error') throw new Error('Synthetic credential boundary failure');
                  if (delay.failure === 'late')
                    await new Promise<void>((resolve) => {
                      releasePublicationCredential = resolve;
                    });
                }
                return {
                  kind: 'usable',
                  shopDomain: 'synthetic.myshopify.com',
                  accessToken: 'synthetic-token',
                  accessExpiresAt: new Date('2099-01-01T00:00:00Z'),
                };
              },
            },
            fetchImpl: (async (_url, init) => {
              const request = JSON.parse(String(init?.body));
              let data: unknown;
              if (request.query.startsWith('mutation')) {
                const field = request.variables.metafields[0];
                const name = Object.entries(fieldKeys).find(([, key]) => key === field.key)?.[0];
                if (!name) throw new Error('Unexpected synthetic field');
                httpMutations.push({ field: name, value: field.value, at: providerClock.getTime() });
                remoteWrites++;
                if ((cells.get(name)?.compareDigest ?? null) !== field.compareDigest)
                  return Response.json({
                    data: { metafieldsSet: { metafields: [], userErrors: [{ code: 'STALE_OBJECT' }] } },
                  });
                const value = {
                  ownerId: field.ownerId,
                  namespace: 'app--101',
                  key: field.key,
                  type: field.type,
                  value: field.value,
                  compareDigest: createHash('sha256').update(field.value).digest('hex'),
                };
                cells.set(name, value);
                data = { metafieldsSet: { metafields: [{ ...value, owner: { id: value.ownerId } }], userErrors: [] } };
              } else {
                remoteReads++;
                await beforeRead?.();
                const name = request.query.includes('insignia_public_config_v2')
                  ? 'public_config'
                  : request.query.includes('insignia_registration_v2')
                    ? 'registration'
                    : 'policy';
                const value = cells.get(name);
                const field = value ? { ...value, owner: { id: value.ownerId } } : null;
                data =
                  name === 'public_config'
                    ? { shop: { id: `gid://shopify/Shop/${providerShop}`, field } }
                    : { node: { __typename: 'Product', id: 'gid://shopify/Product/42', field } };
              }
              return Response.json({ data });
            }) as typeof fetch,
          }),
        })
      : syntheticRemote;
    const artifactScope = {
      shopId,
      installationGeneration: '1',
      appClientId: 'a'.repeat(32),
    };
    const transform = {
      functionId: 'transform',
      handle: 'transform',
      apiType: 'cart_transform' as const,
      apiVersion: '2026-07',
      inputQuerySha256: 'a'.repeat(64),
      wasmSha256: 'b'.repeat(64),
    };
    const validation = {
      ...transform,
      functionId: 'validation',
      handle: 'validation',
      apiType: 'cart_checkout_validation' as const,
    };
    const build: ExpectedFunctionBuild = {
      ...artifactScope,
      schemaVersion: 1,
      sourceCommit: 'c'.repeat(40),
      appVersionRef: 'synthetic-release',
      devPreviewRef: null,
      transform,
      validation,
    };
    const { wasmSha256: _t, ...transformObject } = transform;
    const { wasmSha256: _v, ...validationObject } = validation;
    const observation: FunctionObjectObservation = {
      ...artifactScope,
      observedAt: now.toISOString(),
      transform: transformObject,
      validation: validationObject,
    };
    let releaseMissing = false;
    const readiness: Omit<ActivationReadinessPort, 'observeProjection'> = {
      expectedBuild: { read: async () => build },
      trustedEvidence: {
        read: async () =>
          releaseMissing
            ? null
            : {
                ...build,
                evidenceKind: 'RELEASE_BOUND',
                observedAt: now.toISOString(),
                expiresAt: '2026-10-02T12:00:00.000Z',
              },
      },
      observeFunctions: async () => ({ transform: 'present', validation: 'present', observation }),
      currentDay: () => {
        if (calendarDelay?.at === providerClock.getTime() && ++calendarDelay.seen === calendarDelay.call) {
          providerClock = new Date(providerClock.getTime() + calendarDelay.ms);
          calendarDelay = null;
        }
        return 20727;
      },
    };
    const availabilityScope = { ...artifactScope, shopifyShopId: `gid://shopify/Shop/${providerShop}` };
    let current: ProductAvailabilitySnapshot = {
      scope: availabilityScope,
      productId: 'gid://shopify/Product/42',
      state: 'available',
      version: 'm5-product-availability-snapshot-v2',
      providerUpdatedAt: '2026-10-01T11:00:00.000Z',
      configuredIntent: { includedPublicationIds: [], publicationSettings: [], scheduled: [] },
      effectiveVisibility: {
        publishedPublicationIds: [],
        onlineStore: { publishedAtPresent: false, urlPresent: false },
        publicationEvidence: [],
        publishedAt: null,
        onlineStoreUrl: null,
      },
      intentDigest: activationDigest({ includedPublicationIds: [], publicationSettings: [], scheduled: [] }),
      effectiveDigest: activationDigest({
        publishedPublicationIds: [],
        onlineStore: { publishedAtPresent: false, urlPresent: false },
      }),
      receivedAt: now.toISOString(),
      observedAt: now.toISOString(),
    };
    const originalAvailability = current;
    let acquireNotSent = false;
    let acquireLost = false;
    let restoreLost = false;
    let restoreUnsettled: 'pending' | 'throw' | 'original' | null = null;
    let restoreSettled = false;
    let acquisitions = 0;
    let restores = 0;
    const availability: ProductAvailabilityHoldPort = {
      snapshot: async (scope) => ({ ...current, scope }),
      acquire: async (_scope, hold) => {
        const receipt = await sql<{
          kind: string;
        }>`SELECT kind FROM m5_activation_state WHERE shop_id=${shopId} AND operation_id=${hold.operationId}`.execute(
          database,
        );
        expect(receipt.rows[0]?.kind).toBe('ACQUISITION_PENDING');
        if (acquireNotSent) {
          acquireNotSent = false;
          throw new Error('crash before provider dispatch');
        }
        acquisitions++;
        current = { ...current, state: 'unavailable', providerUpdatedAt: '2026-10-01T11:01:00.000Z' };
        if (acquireLost) {
          acquireLost = false;
          throw new Error('lost acquisition response');
        }
        return { kind: 'HELD', current, hold: { ...hold, held: current } };
      },
      observe: async (_scope, hold) =>
        current.state === 'unavailable' && current.intentDigest === hold.before.intentDigest
          ? { kind: 'HELD', current, hold: { ...hold, held: current } }
          : { kind: 'CONFLICT', current },
      restore: async (_scope, hold) => {
        const record = await core.productionActivations
          .create(options)
          .read({ ...identity, operationId: hold.operationId });
        expect(record?.state.kind).toBe('RESTORATION_CLAIMED');
        expect(record?.evidence).not.toBeNull();
        expect((await core.configs.getConfig(shopId, configId))?.effectiveRevisionId).not.toBeNull();
        restores++;
        if (restoreUnsettled === 'pending') return { kind: 'RESTORATION_PENDING', current: null };
        if (restoreUnsettled === 'throw') throw new Error('unsettled restore response');
        if (restoreUnsettled === 'original') {
          current = { ...hold.before, providerUpdatedAt: '2026-10-01T11:02:00.000Z' };
          return { kind: 'RESTORATION_PENDING', current };
        }
        current = { ...hold.before, providerUpdatedAt: '2026-10-01T11:02:00.000Z' };
        if (restoreLost) {
          restoreLost = false;
          throw new Error('lost restore response');
        }
        return { kind: 'RESTORED', current };
      },
    };
    let responsePending = false;
    const providerAvailability = providerStatus
      ? createShopifyAvailabilityHoldV2Port({
          now: () => new Date(providerClock),
          isCurrent: async () => true,
          credentials: {
            acquire: async () => {
              if (!responsePending && restoreCredentialDelay?.afterReads === availabilityReads) {
                providerClock = new Date(providerClock.getTime() + restoreCredentialDelay.ms);
                restoreCredentialDelay = null;
              }
              if (responsePending && providerDelay?.point === 'credential') {
                providerClock = new Date(providerClock.getTime() + providerDelay.ms);
                providerDelay = null;
              }
              responsePending = false;
              return {
                kind: 'usable',
                shopDomain: 'synthetic.myshopify.com',
                accessToken: 'synthetic-token',
                accessExpiresAt: new Date('2099-01-01T00:00:00Z'),
              };
            },
          },
          fetchImpl: (async (_url, init) => {
            const request = JSON.parse(String(init?.body));
            const mutation = request.query.startsWith('mutation');
            if (!mutation) availabilityReads++;
            if (mutation) {
              status = request.variables.product.status;
              providerWrites.push(status);
              providerMutations.push({ status, at: providerClock.getTime() });
              version = status === 'DRAFT' ? '2026-10-01T11:01:00.000Z' : '2026-10-01T11:02:00.000Z';
            }
            const product = {
              __typename: 'Product',
              id: 'gid://shopify/Product/42',
              status,
              updatedAt: version,
              publishedAt: null,
              onlineStoreUrl: null,
              resourcePublications: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
              unpublishedPublications: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
            };
            const data = mutation
              ? { productUpdate: { product, userErrors: [] } }
              : {
                  shop: { id: availabilityScope.shopifyShopId },
                  currentAppInstallation: {
                    app: { apiKey: availabilityScope.appClientId },
                    accessScopes: [
                      { handle: 'read_products' },
                      { handle: 'write_products' },
                      { handle: 'read_publications' },
                    ],
                  },
                  node: product,
                  publications: {
                    nodes: [],
                    pageInfo: { hasNextPage: false, hasPreviousPage: false, endCursor: null },
                  },
                };
            const bytes = new TextEncoder().encode(JSON.stringify({ data }));
            if (providerDelay?.point === 'fetch') {
              providerClock = new Date(providerClock.getTime() + providerDelay.ms);
              providerDelay = null;
            }
            responsePending = true;
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(bytes);
                },
                pull(controller) {
                  if (providerDelay?.point === 'body') {
                    providerClock = new Date(providerClock.getTime() + providerDelay.ms);
                    providerDelay = null;
                  }
                  controller.close();
                },
              }),
              { status: 200 },
            );
          }) as typeof fetch,
        })
      : availability;
    let recoveryAuthority: import('@insignia/application').TrustedAvailabilityRecoveryAuthorityPort | undefined;
    const options = {
      appId: '101',
      appClientId: artifactScope.appClientId,
      remote,
      availability: providerAvailability,
      readiness,
      now: () => (providerStatus ? new Date(providerClock) : now),
      maxObservationAgeMs: 1000,
    };
    const identity = { shopId, configId, operationId };
    const restart = () => core.productionActivations.create({ ...options, recoveryAuthority });
    const activation = restart();
    await activation.publications.prepare({ ...identity, revisionId, mode: initialMode });
    const prepareHold = async () => {
      expect((await restart().advance(identity)).kind).toBe('WAITING_HOLD');
      expect((await restart().advance(identity)).kind).toBe('HELD');
    };
    const publish = async (id = identity) => {
      for (let i = 0; i < 5; i++) await restart().publications.advance(id.shopId, id.configId, id.operationId);
    };
    return {
      identity,
      httpMutations,
      expireRestoreCredential: (ms: number) => {
        // Caller observes held status once; restore rereads it before status mutation preparation.
        restoreCredentialDelay = { afterReads: availabilityReads + 2, ms };
      },
      failPublicationCredential: (failure: 'inactive' | 'error' | 'late') => {
        publicationCredentialDelay = { call: publicationCredentialCalls + 4, ms: 0, failure };
      },
      releasePublicationCredential: () => {
        releasePublicationCredential?.();
      },
      expirePublicationCredential: (ms: number) => {
        // Advance performs three projection HTTP reads, then prepares the actual mutation.
        publicationCredentialDelay = { call: publicationCredentialCalls + 4, ms };
      },
      scope,
      remote,
      providerWrites,
      providerMutations,
      delayCalendar: (offsetMs: number, ms: number, call: number) => {
        calendarDelay = { at: providerClock.getTime() + offsetMs, ms, call, seen: 0 };
      },
      set providerDelay(value: { point: 'fetch' | 'body' | 'credential'; ms: number } | null) {
        providerDelay = value;
      },
      advanceProviderClock: (ms: number) => {
        providerClock = new Date(providerClock.getTime() + ms);
      },
      set recoveryAuthority(value:
        | import('@insignia/application').TrustedAvailabilityRecoveryAuthorityPort
        | undefined) {
        recoveryAuthority = value;
      },
      revisionId,
      restart,
      restartWithAvailability: (port: ProductAvailabilityHoldPort) =>
        core.productionActivations.create({ ...options, availability: port, recoveryAuthority }),
      prepareHold,
      publish,
      createRevision,
      cells,
      set acquireNotSent(value: boolean) {
        acquireNotSent = value;
      },
      set acquireLost(value: boolean) {
        acquireLost = value;
      },
      set restoreLost(value: boolean) {
        restoreLost = value;
      },
      set restoreUnsettled(value: 'pending' | 'throw' | 'original' | null) {
        restoreUnsettled = value;
      },
      get restoreSettled() {
        return restoreSettled;
      },
      completeUnsettledRestore: () => {
        current = { ...current, state: 'available', providerUpdatedAt: '2026-10-01T11:02:00.000Z' };
        restoreSettled = true;
      },
      set releaseMissing(value: boolean) {
        releaseMissing = value;
      },
      set beforeRead(value: (() => Promise<void>) | undefined) {
        beforeRead = value;
      },
      get acquisitions() {
        return acquisitions;
      },
      get restores() {
        return restores;
      },
      get remoteWrites() {
        return remoteWrites;
      },
      get remoteReads() {
        return remoteReads;
      },
      simulateExternalOriginalState: () => {
        current = {
          ...originalAvailability,
          state: 'available',
          providerUpdatedAt: '2026-10-01T11:02:00.000Z',
        };
      },
      drift: () => {
        const configuredIntent = {
          includedPublicationIds: ['gid://shopify/Publication/999'],
          publicationSettings: [
            { publicationId: 'gid://shopify/Publication/999', autoPublish: true, supportsFuturePublishing: false },
          ],
          scheduled: [],
        };
        current = { ...current, configuredIntent, intentDigest: activationDigest(configuredIntent) };
      },
    };
  }

  it('v1 JSONB remains unchanged through operator hold and exact historical trusted recovery', async () => {
    const f = await fixture();
    const legacyScope = {
      shopId: f.identity.shopId,
      installationGeneration: '1',
      shopifyShopId: `gid://shopify/Shop/${f.scope.shopifyShopId}`,
      appClientId: 'a'.repeat(32),
    };
    let requests = 0;
    const legacyPort = createShopifyAvailabilityHoldPort({
      now: () => now,
      isCurrent: async () => true,
      credentials: {
        acquire: async () => ({
          kind: 'usable',
          shopDomain: 'synthetic.myshopify.com',
          accessToken: 'synthetic-token',
          accessExpiresAt: new Date('2099-01-01T00:00:00Z'),
        }),
      },
      fetchImpl: (async (_url, init) => {
        requests++;
        expect(JSON.parse(String(init?.body)).query).not.toMatch(/^mutation/);
        return Response.json({
          data: {
            shop: { id: legacyScope.shopifyShopId },
            currentAppInstallation: {
              app: { apiKey: legacyScope.appClientId },
              accessScopes: ['read_products', 'write_products', 'read_publications', 'read_product_listings'].map(
                (handle) => ({ handle }),
              ),
            },
            node: {
              __typename: 'Product',
              id: 'gid://shopify/Product/42',
              status: 'ACTIVE',
              updatedAt: '2026-10-01T11:00:00Z',
              publishedAt: null,
              onlineStoreUrl: null,
              resourcePublications: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
              unpublishedPublications: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
            },
          },
        });
      }) as typeof fetch,
    });
    const before = await legacyPort.snapshot(legacyScope, 'gid://shopify/Product/42');
    const legacy = { version: 'm5-availability-hold-v1', operationId: f.identity.operationId, before, held: null };
    await sql`INSERT INTO m5_activation_state(shop_id,config_id,operation_id,kind,hold) VALUES (${f.identity.shopId},${f.identity.configId},${f.identity.operationId},'ACQUISITION_PENDING',${JSON.stringify(legacy)}::jsonb)`.execute(
      database,
    );
    expect((await f.restart().read(f.identity))?.state.hold).toEqual(legacy);
    expect((await f.restart().advance(f.identity)).kind).toBe('OPERATOR_HOLD');
    expect((await f.restart().read(f.identity))?.state.hold).toEqual(legacy);
    expect(f.acquisitions).toBe(0);
    expect(f.restores).toBe(0);
    expect(f.remoteWrites).toBe(0);
    f.recoveryAuthority = syntheticRecoveryAuthority();
    const resolved = await f.restartWithAvailability(legacyPort).recover({ ...f.identity, commandKey: 'recover-v1' });
    expect(resolved).toMatchObject({
      version: 'm5-availability-resolution-v1',
      originalHold: legacy,
      decision: { version: 'm5-availability-recovery-decision-v1' },
    });
    expect((await f.restart().read(f.identity))?.state).toMatchObject({ kind: 'RESOLVED', hold: legacy });
    expect(requests).toBe(3);
    expect(f.acquisitions).toBe(0);
    expect(f.restores).toBe(0);
  });
  it('v2 hold/evidence/restoration audit JSONB roundtrips, remains immutable, and rejects v1 decision semantics', async () => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    const held = (await f.restart().read(f.identity))?.state.hold;
    expect(held).toMatchObject({
      version: 'm5-availability-hold-v2',
      before: { version: 'm5-product-availability-snapshot-v2' },
      acquisitionAcknowledgement: {
        version: 'm5-availability-mutation-ack-v2',
        providerUpdatedAt: '2026-10-01T11:01:00.000Z',
      },
    });
    await expect(
      sql`UPDATE m5_activation_state SET hold=jsonb_set(hold,'{acquisitionAcknowledgement,providerUpdatedAt}','"2026-10-01T11:59:00.000Z"'::jsonb),version=version+1 WHERE shop_id=${f.identity.shopId}`.execute(
        database,
      ),
    ).rejects.toThrow('v2 availability audit is immutable');
    await f.publish();
    await f.restart().advance(f.identity);
    await f.restart().advance(f.identity);
    const record = await f.restart().read(f.identity);
    expect(record?.evidence).toMatchObject({ version: 'm5-activation-evidence-v2', decisionVersion: 2, hold: held });
    expect(record?.state.hold).toMatchObject({
      restorationReceipt: {
        version: 'm5-availability-restoration-receipt-v2',
        kind: 'RESTORED',
        acknowledgement: { providerUpdatedAt: '2026-10-01T11:02:00.000Z' },
        current: { providerUpdatedAt: '2026-10-01T11:02:00.000Z' },
      },
    });
    await expect(
      sql`UPDATE m5_activation_state SET hold=jsonb_set(hold,'{restorationReceipt,kind}','"CONFLICT"'::jsonb),version=version+1 WHERE shop_id=${f.identity.shopId}`.execute(
        database,
      ),
    ).rejects.toThrow('v2 availability audit is immutable');
    // A separate synthetic publication supplies the foreign-key identity for compatibility inserts.
    const other = await fixture();
    const base = record?.evidence;
    if (!base) throw new Error('missing synthetic evidence');
    const evidence = {
      ...base,
      ...other.identity,
      revisionId: other.revisionId,
      authorizationGeneration: other.scope.authorizationGeneration,
      authorizationEpoch: other.scope.authorizationEpoch,
      admissionClass: 'SAME_MODE',
      hold: null,
      holdObservation: null,
    };
    const insert = (value: unknown) =>
      sql`INSERT INTO m5_activation_evidence(shop_id,config_id,operation_id,revision_id,installation_generation,operation_sequence,authorization_generation,authorization_epoch,selected_key_id,evidence_digest,evidence) VALUES (${other.identity.shopId},${other.identity.configId},${other.identity.operationId},${other.revisionId},1,1,${other.scope.authorizationGeneration}::uuid,${other.scope.authorizationEpoch},7,${activationDigest(value)},${JSON.stringify(value)}::jsonb)`.execute(
        database,
      );
    await expect(insert({ ...evidence, decisionVersion: 1 })).rejects.toThrow('m5_014_evidence_identity');
    if (!base.hold || base.hold.version !== 'm5-availability-hold-v2' || !base.hold.held || !base.holdObservation)
      throw new Error('expected v2 held evidence');
    const nestedScope = { ...base.hold.before.scope, shopId: other.identity.shopId };
    const before = { ...base.hold.before, scope: nestedScope };
    const nestedHeld = { ...base.hold.held, scope: nestedScope };
    const nestedHold = { ...base.hold, operationId: other.identity.operationId, before, held: nestedHeld };
    const nestedEvidence = {
      ...evidence,
      admissionClass: 'FIRST_PUBLICATION',
      hold: nestedHold,
      holdObservation: nestedHeld,
    };
    for (const mixed of [
      { ...nestedEvidence, hold: { ...nestedHold, version: 'm5-availability-hold-v1' } },
      {
        ...nestedEvidence,
        hold: { ...nestedHold, before: { ...before, version: 'm5-product-availability-snapshot-v1' } },
      },
      { ...nestedEvidence, holdObservation: { ...nestedHeld, version: 'm5-product-availability-snapshot-v1' } },
      { ...nestedEvidence, holdObservation: { ...nestedHeld, intentDigest: '0'.repeat(64) } },
    ])
      await expect(insert(mixed)).rejects.toThrow('m5_014_evidence_v2_hold');
    const v1 = { ...evidence, version: 'm5-activation-evidence-v1', decisionVersion: 1 };
    await insert(v1);
    await sql`INSERT INTO m5_activation_state(shop_id,config_id,operation_id,kind,evidence_digest) VALUES (${other.identity.shopId},${other.identity.configId},${other.identity.operationId},'RESTORED',${activationDigest(v1)})`.execute(
      database,
    );
    expect((await other.restart().read(other.identity))?.evidence).toEqual(v1);
    expect(await f.restart().read(f.identity)).toEqual(record);
  });

  it.each(['fetch', 'body', 'credential'] as const)(
    'R1 public publication rejects stale %s hold observation without any policy write',
    async (point) => {
      const f = await fixture('required', 'ACTIVE');
      await f.prepareHold();
      f.providerDelay = { point, ms: 2000 };
      expect(
        await f.restart().publications.advance(f.identity.shopId, f.identity.configId, f.identity.operationId),
      ).toEqual({ kind: 'ADMISSION_PENDING', phase: 'prepared' });
      expect(f.remoteWrites).toBe(0);
      expect((await f.restart().read(f.identity))?.evidence).toBeNull();
      expect((await core.configs.getConfig(f.identity.shopId, f.identity.configId))?.effectiveRevisionId).toBeNull();
      expect(f.providerWrites).toEqual(['DRAFT']);
    },
  );
  it.each([0, 999, 1000])('R1 public publication permits exact within-budget %s ms observation', async (ms) => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    f.providerDelay = { point: 'fetch', ms };
    await f.restart().publications.advance(f.identity.shopId, f.identity.configId, f.identity.operationId);
    expect(f.remoteWrites).toBe(1);
  });

  it.each(['prepared', 'shop-config-written', 'pending-written', 'policy-written'] as const)(
    'R1 dispatch rejects admission expiring during projection reads at %s',
    async (phase) => {
      const f = await fixture('required', 'ACTIVE');
      await f.prepareHold();
      const phases = ['prepared', 'shop-config-written', 'pending-written', 'policy-written'];
      for (let i = 0; i < phases.indexOf(phase); i++)
        await f.restart().publications.advance(f.identity.shopId, f.identity.configId, f.identity.operationId);
      const writes = f.remoteWrites;
      let delayed = false;
      f.beforeRead = async () => {
        if (!delayed) {
          delayed = true;
          f.advanceProviderClock(2000);
        }
      };
      expect(
        await f.restart().publications.advance(f.identity.shopId, f.identity.configId, f.identity.operationId),
      ).toEqual({ kind: 'ADMISSION_PENDING', phase });
      expect(f.remoteWrites).toBe(writes);
      expect((await f.restart().read(f.identity))?.evidence).toBeNull();
      expect((await core.configs.getConfig(f.identity.shopId, f.identity.configId))?.effectiveRevisionId).toBeNull();
    },
  );
  it.each([0, 999, 1000])('R1 dispatch retains the exact %s ms projection-read boundary', async (ms) => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    let delayed = false;
    f.beforeRead = async () => {
      if (!delayed) {
        delayed = true;
        f.advanceProviderClock(ms);
      }
    };
    expect(
      await f.restart().publications.advance(f.identity.shopId, f.identity.configId, f.identity.operationId),
    ).toEqual({ kind: 'PENDING', phase: 'shop-config-written' });
    expect(f.remoteWrites).toBe(1);
  });
  it('R1 dispatch rejects a reversed clock after fresh hold admission', async () => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    let reversed = false;
    f.beforeRead = async () => {
      if (!reversed) {
        reversed = true;
        f.advanceProviderClock(-1);
      }
    };
    expect(
      await f.restart().publications.advance(f.identity.shopId, f.identity.configId, f.identity.operationId),
    ).toEqual({ kind: 'ADMISSION_PENDING', phase: 'prepared' });
    expect(f.remoteWrites).toBe(0);
  });

  it.each(
    ['prepared', 'shop-config-written', 'pending-written', 'policy-written'].flatMap((phase, index) =>
      [0, 999, 1000, 1001, 2000, -1].map((ms) => ({ phase, index, ms })),
    ),
  )('R1-T actual HTTP phase $phase credential delay $ms ms', async ({ phase, index, ms }) => {
    const f = await fixture('required', 'ACTIVE', true);
    await f.prepareHold();
    for (let i = 0; i < index; i++)
      await f.restart().publications.advance(f.identity.shopId, f.identity.configId, f.identity.operationId);
    const before = f.httpMutations.length;
    f.expirePublicationCredential(ms);
    const result = await f
      .restart()
      .publications.advance(f.identity.shopId, f.identity.configId, f.identity.operationId);
    const permitted = ms >= 0 && ms <= 1000;
    expect(f.httpMutations).toHaveLength(before + (permitted ? 1 : 0));
    expect(result).toEqual(
      permitted
        ? {
            kind: 'PENDING',
            phase: ['shop-config-written', 'pending-written', 'policy-written', 'ready-written'][index],
          }
        : { kind: 'ADMISSION_PENDING', phase },
    );
    if (permitted)
      expect(f.httpMutations.at(-1)?.field).toBe(['public_config', 'registration', 'policy', 'registration'][index]);
    expect((await f.restart().read(f.identity))?.evidence).toBeNull();
    expect((await core.configs.getConfig(f.identity.shopId, f.identity.configId))?.effectiveRevisionId).toBeNull();
  });

  it('R1-T actual final PostgreSQL key read cannot renew admission', async () => {
    const f = await fixture('required', 'ACTIVE', true);
    await f.prepareHold();
    let armed = false;
    let delayed = false;
    let reads = 0;
    f.beforeRead = async () => {
      if (++reads === 3) armed = true;
    };
    afterSql = (text) => {
      if (armed && !delayed && text.includes('FROM signing_keys')) {
        delayed = true;
        f.advanceProviderClock(2000);
      }
    };
    try {
      const result = await f
        .restart()
        .publications.advance(f.identity.shopId, f.identity.configId, f.identity.operationId);
      expect(delayed).toBe(true);
      expect(result).toEqual({ kind: 'ADMISSION_PENDING', phase: 'prepared' });
      expect(f.httpMutations).toHaveLength(0);
    } finally {
      afterSql = undefined;
    }
  });

  it.each(['inactive', 'error', 'late'] as const)(
    'R1-T actual HTTP credential %s remains not sent',
    async (failure) => {
      const f = await fixture('required', 'ACTIVE', true);
      await f.prepareHold();
      f.failPublicationCredential(failure);
      const result = await f
        .restart()
        .publications.advance(f.identity.shopId, f.identity.configId, f.identity.operationId);
      expect(result).toEqual(
        failure === 'inactive'
          ? { kind: 'OPERATOR_HOLD', phase: 'operator-hold' }
          : { kind: 'ADMISSION_PENDING', phase: 'prepared' },
      );
      f.releasePublicationCredential();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(f.httpMutations).toHaveLength(0);
      expect((await f.restart().read(f.identity))?.evidence).toBeNull();
    },
  );

  it.each([0, 999, 1000, 1001, 2000, -1])('R1-T real restoration credential delay %s ms', async (ms) => {
    const f = await fixture('required', 'ACTIVE', true);
    await f.prepareHold();
    await f.publish();
    expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVATED_RESTORATION_PENDING');
    const evidence = (await f.restart().read(f.identity))?.evidence;
    f.expireRestoreCredential(ms);
    const result = await f.restart().advance(f.identity);
    console.info('R1_T_RESTORE_HTTP_OBSERVATION', JSON.stringify({ result, statusMutations: f.providerWrites }));
    const permitted = ms >= 0 && ms <= 1000;
    expect(f.providerWrites).toEqual(permitted ? ['DRAFT', 'ACTIVE'] : ['DRAFT']);
    expect(result.kind).toBe(permitted ? 'ACTIVE' : 'ACTIVATED_RESTORATION_PENDING');
    expect((await f.restart().read(f.identity))?.evidence).toEqual(evidence);
    expect((await f.restart().read(f.identity))?.state.kind).toBe(permitted ? 'RESTORED' : 'RESTORATION_CLAIMED');
    if (ms < 0) await expect(f.restart().advance(f.identity)).rejects.toMatchObject({ kind: 'invalid_request' });
    else await f.restart().advance(f.identity);
    expect(f.providerWrites).toEqual(permitted ? ['DRAFT', 'ACTIVE'] : ['DRAFT']);
  });

  it.each(
    [1, 2].flatMap((call) =>
      [
        { credential: 950, calendar: 0, age: 950, allowed: true },
        { credential: 950, calendar: 49, age: 999, allowed: true },
        { credential: 950, calendar: 50, age: 1000, allowed: true },
        { credential: 950, calendar: 51, age: 1001, allowed: false },
        { credential: 950, calendar: 100, age: 1050, allowed: false },
        { credential: 999, calendar: 2, age: 1001, allowed: false },
      ].map((row) => ({ ...row, call })),
    ),
  )(
    'R1-T calendar call $call consumes remaining restoration budget at age $age',
    async ({ credential, calendar, call, age, allowed }) => {
      const f = await fixture('required', 'ACTIVE', true);
      await f.prepareHold();
      await f.publish();
      expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVATED_RESTORATION_PENDING');
      const evidence = (await f.restart().read(f.identity))?.evidence;
      f.expireRestoreCredential(credential);
      f.delayCalendar(credential, calendar, call);
      const result = await f.restart().advance(f.identity);
      const restores = f.providerMutations.filter((entry) => entry.status === 'ACTIVE');
      expect(restores).toHaveLength(allowed ? 1 : 0);
      if (allowed) expect(restores[0]?.at).toBe(now.getTime() + age);
      expect(result.kind).toBe(allowed ? 'ACTIVE' : 'ACTIVATED_RESTORATION_PENDING');
      expect((await f.restart().read(f.identity))?.evidence).toEqual(evidence);
      expect((await f.restart().read(f.identity))?.state.kind).toBe(allowed ? 'RESTORED' : 'RESTORATION_CLAIMED');
      await f.restart().advance(f.identity);
      expect(f.providerMutations.filter((entry) => entry.status === 'ACTIVE')).toHaveLength(allowed ? 1 : 0);
    },
  );

  it.each(
    [3, 4].flatMap((call) =>
      [
        { calendar: 49, age: 999, allowed: true },
        { calendar: 50, age: 1000, allowed: true },
        { calendar: 51, age: 1001, allowed: false },
        { calendar: 100, age: 1050, allowed: false },
      ].map((row) => ({ ...row, call })),
    ),
  )(
    'R1-T calendar call $call validates same-mode activation at final age $age',
    async ({ calendar, call, age, allowed }) => {
      const f = await fixture('required', 'ACTIVE', true);
      await f.prepareHold();
      await f.publish();
      await f.restart().advance(f.identity);
      await f.restart().advance(f.identity);
      const revisionId = randomUUID();
      const identity = { ...f.identity, operationId: randomUUID() };
      await f.createRevision(revisionId, 'required');
      await f.restart().publications.prepare({ ...identity, revisionId, mode: 'required' });
      await f.publish(identity);
      f.advanceProviderClock(950);
      f.delayCalendar(0, calendar, call);
      if (allowed) {
        expect((await f.restart().advance(identity)).kind).toBe('ACTIVE');
        expect((await f.restart().read(identity))?.evidence?.createdAt).toBe(
          new Date(now.getTime() + age).toISOString(),
        );
        expect((await core.configs.getConfig(identity.shopId, identity.configId))?.effectiveRevisionId).toBe(
          revisionId,
        );
      } else {
        await expect(f.restart().advance(identity)).rejects.toThrow('Function artifact evidence invalid or mismatched');
        expect((await f.restart().read(identity))?.evidence).toBeNull();
        expect((await core.configs.getConfig(identity.shopId, identity.configId))?.effectiveRevisionId).toBe(
          f.revisionId,
        );
      }
      expect(f.providerWrites).toEqual(['DRAFT', 'ACTIVE']);
    },
  );

  it('R2 UNLISTED hold survives public read/restart and restores exact original status after activation', async () => {
    const f = await fixture('required', 'UNLISTED');
    await f.prepareHold();
    const held = await f.restart().read(f.identity);
    expect(held?.state.hold?.before).toMatchObject({
      state: 'unlisted',
      observedAt: now.toISOString(),
      receivedAt: now.toISOString(),
    });
    expect(held?.state.hold?.held?.state).toBe('unavailable');
    await f.publish();
    expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVATED_RESTORATION_PENDING');
    const evidence = (await f.restart().read(f.identity))?.evidence;
    expect(evidence?.hold?.before.state).toBe('unlisted');
    expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVE');
    expect(f.providerWrites).toEqual(['DRAFT', 'UNLISTED']);
    expect((await f.restart().read(f.identity))?.evidence).toEqual(evidence);
    expect((await core.configs.getConfig(f.identity.shopId, f.identity.configId))?.effectiveRevisionId).toBe(
      f.revisionId,
    );
  });

  it('first publication stays pending until the owned hold is reobserved', async () => {
    const f = await fixture();
    expect(
      (await f.restart().publications.advance(f.identity.shopId, f.identity.configId, f.identity.operationId)).kind,
    ).toBe('ADMISSION_PENDING');
    expect(f.remoteReads).toBe(3); // Only prepare's reads; no policy dispatch without admission.
    await f.prepareHold();
    await f.publish();
    expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVATED_RESTORATION_PENDING');
    const record = await f.restart().read(f.identity);
    expect(record?.evidence).toMatchObject({
      admissionClass: 'FIRST_PUBLICATION',
      operationSequence: '1',
      selectedKeyId: 7,
      hold: { held: { state: 'unavailable' } },
    });
    expect((await core.configs.getConfig(f.identity.shopId, f.identity.configId))?.effectiveRevisionId).toBe(
      f.revisionId,
    );
    expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVE');
    expect(f.acquisitions).toBe(1);
    expect(f.restores).toBe(1);
  });
  it('immutable evidence refuses updates and deletes', async () => {
    const f = await fixture();
    await f.prepareHold();
    await f.publish();
    await f.restart().advance(f.identity);
    for (const statement of [
      sql`UPDATE m5_activation_evidence SET evidence='{}'::jsonb WHERE shop_id=${f.identity.shopId}`,
      sql`DELETE FROM m5_activation_evidence WHERE shop_id=${f.identity.shopId}`,
    ])
      await expect(statement.execute(database)).rejects.toThrow('activation evidence is immutable');
  });
  it('concurrent attempts commit one evidence row and one effective operation', async () => {
    const f = await fixture();
    await f.prepareHold();
    await f.publish();
    const attempts = await Promise.all([
      f.restart().advance(f.identity),
      f.restart().advance(f.identity),
      f.restart().advance(f.identity),
    ]);
    expect(attempts.every((attempt) => ['ACTIVATED_RESTORATION_PENDING', 'ACTIVE'].includes(attempt.kind))).toBe(true);
    expect(new Set(attempts.map((attempt) => attempt.evidenceDigest)).size).toBe(1);
    const evidence = await sql<{
      count: string;
    }>`SELECT count(*)::text AS count FROM m5_activation_evidence WHERE shop_id=${f.identity.shopId}`.execute(database);
    expect(evidence.rows[0]?.count).toBe('1');
    expect(f.restores).toBe(1);
    expect((await core.configs.getConfig(f.identity.shopId, f.identity.configId))?.effectiveOperationId).toBe(
      f.identity.operationId,
    );
  });
  it('same-mode second revision activates without acquiring another hold', async () => {
    const f = await fixture('required', 'ACTIVE', true);
    await f.prepareHold();
    await f.publish();
    await f.restart().advance(f.identity);
    await f.restart().advance(f.identity);
    const revisionId = randomUUID();
    const identity = { ...f.identity, operationId: randomUUID() };
    await f.createRevision(revisionId, 'required');
    await f.restart().publications.prepare({ ...identity, revisionId, mode: 'required' });
    await f.publish(identity);
    expect((await f.restart().advance(identity)).kind).toBe('ACTIVE');
    expect(f.providerWrites).toEqual(['DRAFT', 'ACTIVE']);
    expect((await f.restart().read(identity))?.evidence).toMatchObject({
      admissionClass: 'SAME_MODE',
      hold: null,
      operationSequence: '2',
    });
  });
  it.each(['required-to-optional', 'optional-to-required'])(
    'policy transition requires its own hold (%s)',
    async (transition) => {
      const f = await fixture();
      await f.prepareHold();
      await f.publish();
      await f.restart().advance(f.identity);
      await f.restart().advance(f.identity);
      const publishMode = async (mode: 'optional' | 'required') => {
        const revisionId = randomUUID();
        const identity = { ...f.identity, operationId: randomUUID() };
        await f.createRevision(revisionId, mode);
        await f.restart().publications.prepare({ ...identity, revisionId, mode });
        expect(
          (await f.restart().publications.advance(identity.shopId, identity.configId, identity.operationId)).kind,
        ).toBe('ADMISSION_PENDING');
        expect((await f.restart().advance(identity)).kind).toBe('WAITING_HOLD');
        // Acquisition receipt checks the currently selected operation.
        await f.restart().advance(identity);
        await f.publish(identity);
        expect((await f.restart().advance(identity)).kind).toBe('ACTIVATED_RESTORATION_PENDING');
        expect((await f.restart().read(identity))?.evidence?.admissionClass).toBe('MODE_CHANGE');
        await f.restart().advance(identity);
      };
      await publishMode('optional');
      if (transition === 'optional-to-required') await publishMode('required');
    },
  );
  it('a failure after evidence insert rolls evidence and effective activation back atomically', async () => {
    const f = await fixture();
    await f.prepareHold();
    await f.publish();
    // Isolated synthetic fault, scoped by shop; other concurrent test fixtures cannot hit it.
    await sql`CREATE FUNCTION m5_test_activation_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.shop_id = ${sql.lit(f.identity.shopId)} AND NEW.status='activated' THEN
        RAISE EXCEPTION 'synthetic activation crash'; END IF; RETURN NEW; END $$`.execute(database);
    await sql`CREATE TRIGGER m5_test_activation_fail BEFORE UPDATE ON publication_operations FOR EACH ROW EXECUTE FUNCTION m5_test_activation_fail()`.execute(
      database,
    );
    try {
      await expect(f.restart().advance(f.identity)).rejects.toThrow('synthetic activation crash');
      expect((await f.restart().read(f.identity))?.evidence).toBeNull();
      expect((await core.configs.getConfig(f.identity.shopId, f.identity.configId))?.effectiveRevisionId).toBeNull();
    } finally {
      await sql`DROP TRIGGER m5_test_activation_fail ON publication_operations`.execute(database);
      await sql`DROP FUNCTION m5_test_activation_fail()`.execute(database);
    }
    expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVATED_RESTORATION_PENDING');
  });
  it('persisted acquisition pending with an unsent mutation is observed and requires operator recovery', async () => {
    const f = await fixture();
    await f.restart().advance(f.identity);
    f.acquireNotSent = true;
    await expect(f.restart().advance(f.identity)).rejects.toThrow('crash before provider dispatch');
    expect((await f.restart().read(f.identity))?.state.kind).toBe('ACQUISITION_PENDING');
    expect((await f.restart().advance(f.identity)).kind).toBe('OPERATOR_HOLD');
    expect(f.acquisitions).toBe(0);
  });
  it('lost acquisition remains unattributable after restart without a second mutation', async () => {
    const f = await fixture();
    await f.restart().advance(f.identity);
    f.acquireLost = true;
    await expect(f.restart().advance(f.identity)).rejects.toThrow('lost acquisition response');
    expect((await f.restart().read(f.identity))?.state.kind).toBe('ACQUISITION_PENDING');
    expect((await f.restart().advance(f.identity)).kind).toBe('OPERATOR_HOLD');
    expect(f.acquisitions).toBe(1);
    expect((await f.restart().read(f.identity))?.evidence).toBeNull();
  });
  it('lost restore response and merchant drift retain effective activation and immutable evidence', async () => {
    const f = await fixture();
    await f.prepareHold();
    await f.publish();
    await f.restart().advance(f.identity);
    const record = await f.restart().read(f.identity);
    f.restoreLost = true;
    await expect(f.restart().advance(f.identity)).rejects.toThrow('lost restore response');
    f.drift();
    expect((await f.restart().advance(f.identity)).kind).toBe('OPERATOR_HOLD');
    expect(f.restores).toBe(1);
    expect((await f.restart().read(f.identity))?.evidence).toEqual(record?.evidence);
    expect((await core.configs.getConfig(f.identity.shopId, f.identity.configId))?.effectiveRevisionId).toBe(
      f.revisionId,
    );
  });
  it.each(['pending', 'throw'] as const)(
    'restart never redispatches an unsettled %s restore over unchanged readback',
    async (outcome) => {
      const f = await fixture();
      await f.prepareHold();
      await f.publish();
      await f.restart().advance(f.identity);
      const evidence = (await f.restart().read(f.identity))?.evidence;
      f.restoreUnsettled = outcome;
      if (outcome === 'throw')
        await expect(f.restart().advance(f.identity)).rejects.toThrow('unsettled restore response');
      else expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVATED_RESTORATION_PENDING');
      for (let i = 0; i < 3; i++)
        expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVATED_RESTORATION_PENDING');
      expect(f.restores).toBe(1);
      expect((await f.restart().read(f.identity))?.evidence).toEqual(evidence);
    },
  );
  it('claimed ambiguous restoration needs independently settled original-state recovery', async () => {
    const f = await fixture();
    await f.prepareHold();
    await f.publish();
    await f.restart().advance(f.identity);
    f.restoreUnsettled = 'pending';
    await f.restart().advance(f.identity);
    expect((await f.restart().read(f.identity))?.state.kind).toBe('RESTORATION_CLAIMED');
    f.recoveryAuthority = syntheticRecoveryAuthority();
    const request = { ...f.identity, commandKey: 'settle-claimed' };
    await expect(f.restart().recover(request)).rejects.toThrow(/Original (v2 )?availability not observed/);
    const evidence = (await f.restart().read(f.identity))?.evidence;
    f.simulateExternalOriginalState();
    await f.restart().recover(request);
    expect((await f.restart().read(f.identity))?.state.kind).toBe('RESTORED');
    expect((await f.restart().read(f.identity))?.evidence).toEqual(evidence);
    expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVE');
    expect(f.restores).toBe(1);
  });
  it('original-state change with an outstanding restore blocks a later publication until trusted settlement', async () => {
    const f = await fixture();
    await f.prepareHold();
    await f.publish();
    await f.restart().advance(f.identity);
    f.restoreUnsettled = 'original';
    expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVATED_RESTORATION_PENDING');
    expect((await f.restart().read(f.identity))?.state.kind).toBe('RESTORATION_CLAIMED');
    const evidence = (await f.restart().read(f.identity))?.evidence;
    const revisionId = randomUUID();
    await f.createRevision(revisionId, 'required');
    const next = { ...f.identity, operationId: randomUUID(), revisionId, mode: 'required' as const };
    await expect(f.restart().publications.prepare(next)).rejects.toThrow('Availability hold requires recovery');
    const authority = syntheticRecoveryAuthority();
    f.recoveryAuthority = { read: async (context) => (f.restoreSettled ? authority.read(context) : null) };
    const recovery = { ...f.identity, commandKey: 'settle-late-original' };
    await expect(f.restart().recover(recovery)).rejects.toThrow('Trusted availability recovery decision');
    f.completeUnsettledRestore();
    await f.restart().recover(recovery);
    expect((await f.restart().read(f.identity))?.state.kind).toBe('RESTORED');
    expect((await f.restart().read(f.identity))?.evidence).toEqual(evidence);
    await expect(f.restart().publications.prepare(next)).resolves.toMatchObject({ phase: 'prepared' });
    expect(f.restores).toBe(1);
  });

  it.each([
    ['required', 'optional'],
    ['optional', 'required'],
  ] as const)(
    'resolved unsent %s to %s request permits a distinct safely fenced publication',
    async (priorMode, nextMode) => {
      const f = await fixture(priorMode);
      await f.prepareHold();
      await f.publish();
      await f.restart().advance(f.identity);
      await f.restart().advance(f.identity);
      const effective = (await core.configs.getConfig(f.identity.shopId, f.identity.configId))?.effectiveRevisionId;
      const abandoned = { ...f.identity, operationId: randomUUID() };
      const revisionId = randomUUID();
      await f.createRevision(revisionId, nextMode);
      await f.restart().publications.prepare({ ...abandoned, revisionId, mode: nextMode });
      await f.restart().advance(abandoned);
      f.acquireNotSent = true;
      await expect(f.restart().advance(abandoned)).rejects.toThrow();
      expect((await f.restart().advance(abandoned)).kind).toBe('OPERATOR_HOLD');
      f.recoveryAuthority = syntheticRecoveryAuthority();
      await f.restart().recover({ ...abandoned, commandKey: 'close-mode-change' });
      const next = { ...f.identity, operationId: randomUUID() };
      await expect(f.restart().publications.prepare({ ...next, revisionId, mode: nextMode })).resolves.toMatchObject({
        phase: 'prepared',
      });
      const writes = f.remoteWrites;
      expect(await f.restart().publications.advance(next.shopId, next.configId, next.operationId)).toMatchObject({
        kind: 'ADMISSION_PENDING',
      });
      expect(f.remoteWrites).toBe(writes);
      expect((await core.configs.getConfig(f.identity.shopId, f.identity.configId))?.effectiveRevisionId).toBe(
        effective,
      );
      expect(
        await core.acceptedQuotes.getEffective(
          f.identity.shopId,
          (await core.configs.getConfig(f.identity.shopId, f.identity.configId))!.externalProductId,
        ),
      ).toBeNull();
      expect((await f.restart().advance(next)).kind).toBe('WAITING_HOLD');
      expect((await f.restart().advance(next)).kind).toBe('HELD');
    },
  );
  it.each(['before commit', 'before restore'])(
    'fresh exact policy drift while held blocks unsafe progress (%s)',
    async (boundary) => {
      const f = await fixture();
      await f.prepareHold();
      await f.publish();
      if (boundary === 'before restore') await f.restart().advance(f.identity);
      const policy = f.cells.get('policy');
      if (!policy) throw new Error('Synthetic policy missing');
      f.cells.set('policy', { ...policy, value: 'synthetic-drift', compareDigest: 'f'.repeat(64) });
      expect((await f.restart().advance(f.identity)).kind).toBe('OPERATOR_HOLD');
      expect(f.restores).toBe(0);
      const record = await f.restart().read(f.identity);
      expect(record?.state.kind).toBe('OPERATOR_HOLD');
      expect(Boolean(record?.evidence)).toBe(boundary === 'before restore');
    },
  );
  it('revoked selected key cannot activate or restore a held product', async () => {
    const f = await fixture();
    await f.prepareHold();
    await f.publish();
    await core.signingKeys.revoke(f.scope, 7, 'synthetic-revocation', 'Synthetic emergency');
    expect((await f.restart().advance(f.identity)).kind).toBe('OPERATOR_HOLD');
    expect(f.restores).toBe(0);
    expect((await f.restart().read(f.identity))?.evidence).toBeNull();
  });
  it('missing release evidence leaves the hold intact and never activates', async () => {
    const f = await fixture();
    await f.prepareHold();
    await f.publish();
    f.releaseMissing = true;
    expect((await f.restart().advance(f.identity)).kind).toBe('WAITING_RELEASE');
    expect((await f.restart().read(f.identity))?.state.kind).toBe('WAITING_RELEASE');
    expect((await core.configs.getConfig(f.identity.shopId, f.identity.configId))?.effectiveRevisionId).toBeNull();
  });
  it.each(['reinstall', 'epoch', 'supersession'])(
    'fences %s before activation and preserves an operator hold',
    async (race) => {
      const f = await fixture();
      await f.prepareHold();
      await f.publish();
      if (race === 'reinstall')
        await core.transactions.run((tx) => core.tenants.startInstallation(tx, f.identity.shopId));
      if (race === 'epoch')
        await core.signingKeys.incrementEpoch({
          scope: f.scope,
          commandKey: 'synthetic-epoch',
          requestDigest: 'e'.repeat(64),
        });
      if (race === 'supersession')
        await database.transaction().execute((tx) =>
          createPublicationRepository(tx).request({
            ...f.identity,
            operationId: randomUUID(),
            revisionId: f.revisionId,
            installationGeneration: '1',
            expectedProjection: { synthetic: 'superseding' },
          }),
        );
      expect((await f.restart().advance(f.identity)).kind).toBe('OPERATOR_HOLD');
      expect(f.restores).toBe(0);
      expect((await f.restart().read(f.identity))?.state.kind).toBe('OPERATOR_HOLD');
      expect((await f.restart().read(f.identity))?.evidence).toBeNull();
      expect(await core.configs.getAvailabilityRecovery(f.identity.shopId, f.identity.configId)).toEqual({
        operationId: f.identity.operationId,
        kind: 'OPERATOR_HOLD',
        installationGeneration: '1',
      });
    },
  );
  it.each(['epoch', 'reinstall', 'supersession'])('locks the final read/commit against concurrent %s', async (race) => {
    const f = await fixture();
    await f.prepareHold();
    await f.publish();
    let entered!: () => void;
    let release!: () => void;
    const atRead = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const continueRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.beforeRead = async () => {
      entered();
      await continueRead;
    };
    const activating = f.restart().advance(f.identity);
    await atRead;
    let changed = false;
    const changing = (
      race === 'epoch'
        ? core.signingKeys.incrementEpoch({
            scope: f.scope,
            commandKey: 'synthetic-race',
            requestDigest: 'f'.repeat(64),
          })
        : race === 'reinstall'
          ? core.transactions.run((tx) => core.tenants.startInstallation(tx, f.identity.shopId))
          : database.transaction().execute((tx) =>
              createPublicationRepository(tx).request({
                ...f.identity,
                operationId: randomUUID(),
                revisionId: f.revisionId,
                installationGeneration: '1',
                expectedProjection: { synthetic: 'new' },
              }),
            )
    ).then(() => {
      changed = true;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(changed).toBe(false);
    } finally {
      release();
    }
    expect((await activating).kind).toBe('ACTIVATED_RESTORATION_PENDING');
    await changing;
    expect(changed).toBe(true);
    f.beforeRead = undefined;
    expect((await f.restart().advance(f.identity)).kind).toBe('OPERATOR_HOLD');
    expect(f.restores).toBe(0);
  });
  it('a lost restoration response can complete through trusted observation-only operator recovery', async () => {
    const f = await fixture();
    await f.prepareHold();
    await f.publish();
    await f.restart().advance(f.identity);
    const historical = (await f.restart().read(f.identity))?.evidence;
    f.restoreLost = true;
    await expect(f.restart().advance(f.identity)).rejects.toThrow('lost restore response');
    expect((await f.restart().advance(f.identity)).kind).toBe('OPERATOR_HOLD');
    await expect(f.restart().recover({ ...f.identity, commandKey: 'synthetic-recovery' })).rejects.toThrow();
    f.recoveryAuthority = syntheticRecoveryAuthority();
    const resolution = await f.restart().recover({ ...f.identity, commandKey: 'synthetic-recovery' });
    expect(resolution.outcome).toBe('ORIGINAL_STATE_OBSERVED');
    if (process.env.M5_RECOVERY_EXAMPLE_PATH)
      await (await import('node:fs/promises')).writeFile(
        process.env.M5_RECOVERY_EXAMPLE_PATH,
        JSON.stringify(resolution, null, 2) + '\n',
      );
    expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVE');
    expect((await f.restart().read(f.identity))?.evidence).toEqual(historical);
    expect(await core.configs.getAvailabilityRecovery(f.identity.shopId, f.identity.configId)).toBeNull();
    expect(f.restores).toBe(1);
    expect(await f.restart().recover({ ...f.identity, commandKey: 'synthetic-recovery' })).toEqual(resolution);
    await expect(f.restart().recover({ ...f.identity, commandKey: 'different' })).rejects.toThrow();
  });

  it('unsent acquisition can be abandoned only after an exact trusted settled-write review', async () => {
    const f = await fixture();
    await f.restart().advance(f.identity);
    f.acquireNotSent = true;
    await expect(f.restart().advance(f.identity)).rejects.toThrow('crash before provider dispatch');
    expect((await f.restart().advance(f.identity)).kind).toBe('OPERATOR_HOLD');
    f.recoveryAuthority = syntheticRecoveryAuthority();
    const resolution = await f.restart().recover({ ...f.identity, commandKey: 'abandon-unsent' });
    expect(resolution.activationEvidenceDigest).toBeNull();
    expect((await f.restart().read(f.identity))?.state.kind).toBe('RESOLVED');
    expect(await core.configs.getCurrentPublication(f.identity.shopId, f.identity.configId)).toBeNull();
    expect(await core.configs.getAvailabilityRecovery(f.identity.shopId, f.identity.configId)).toBeNull();
    expect((await core.configs.getConfig(f.identity.shopId, f.identity.configId))?.effectiveRevisionId).toBeNull();
    expect(f.acquisitions).toBe(0);
    expect(f.restores).toBe(0);
    expect((await f.restart().advance(f.identity)).kind).toBe('OPERATOR_HOLD');
    // The old request is never revived. A distinct new request is now permitted.
    expect(
      await f
        .restart()
        .publications.prepare({ ...f.identity, operationId: randomUUID(), revisionId: f.revisionId, mode: 'required' }),
    ).toMatchObject({ phase: 'prepared' });
  });

  it.each(['reinstall', 'supersession'] as const)('operator recovery preserves newer work after %s', async (race) => {
    const f = await fixture();
    await f.prepareHold();
    let newerOperation: string | null = null;
    if (race === 'reinstall')
      await core.transactions.run((tx) => core.tenants.startInstallation(tx, f.identity.shopId));
    else {
      newerOperation = randomUUID();
      await database.transaction().execute((tx) =>
        createPublicationRepository(tx).request({
          ...f.identity,
          operationId: newerOperation as string,
          revisionId: f.revisionId,
          installationGeneration: '1',
          expectedProjection: { synthetic: 'newer' },
        }),
      );
    }
    expect((await f.restart().advance(f.identity)).kind).toBe('OPERATOR_HOLD');
    const before = await core.configs.getConfig(f.identity.shopId, f.identity.configId);
    f.simulateExternalOriginalState();
    f.recoveryAuthority = syntheticRecoveryAuthority();
    const resolution = await f.restart().recover({ ...f.identity, commandKey: 'recover-old' });
    expect(resolution.currentScope.installationGeneration).toBe(race === 'reinstall' ? '2' : '1');
    expect((await f.restart().read(f.identity))?.state.kind).toBe('RESOLVED');
    expect(await core.configs.getConfig(f.identity.shopId, f.identity.configId)).toEqual(before);
    expect(await core.configs.getAvailabilityRecovery(f.identity.shopId, f.identity.configId)).toBeNull();
    if (newerOperation)
      expect(
        (
          await database
            .selectFrom('publication_operations')
            .select('status')
            .where('shop_id', '=', f.identity.shopId)
            .where('operation_id', '=', newerOperation)
            .executeTakeFirst()
        )?.status,
      ).toBe('requested');
    expect(f.acquisitions).toBe(1);
    expect(f.restores).toBe(0);
  });

  it('current drift and mismatched trusted decisions never clear an operator hold', async () => {
    const f = await fixture();
    await f.prepareHold();
    await f.publish();
    await f.restart().advance(f.identity);
    f.drift();
    expect((await f.restart().advance(f.identity)).kind).toBe('OPERATOR_HOLD');
    f.recoveryAuthority = syntheticRecoveryAuthority();
    await expect(f.restart().recover({ ...f.identity, commandKey: 'reject-drift' })).rejects.toThrow(
      /Original (v2 )?availability not observed/,
    );
    f.simulateExternalOriginalState();
    const authority = syntheticRecoveryAuthority();
    f.recoveryAuthority = {
      read: async (context) => ({ ...((await authority.read(context)) as object), currentScopeDigest: '0'.repeat(64) }),
    };
    await expect(f.restart().recover({ ...f.identity, commandKey: 'reject-authority' })).rejects.toThrow(
      'Trusted availability recovery decision',
    );
    expect((await f.restart().read(f.identity))?.state.kind).toBe('OPERATOR_HOLD');
    expect(await core.configs.getAvailabilityRecovery(f.identity.shopId, f.identity.configId)).not.toBeNull();
    expect(f.restores).toBe(0);
  });

  it('concurrent recovery commits one immutable audited resolution with no provider mutation', async () => {
    const f = await fixture();
    await f.restart().advance(f.identity);
    f.acquireNotSent = true;
    await expect(f.restart().advance(f.identity)).rejects.toThrow();
    await f.restart().advance(f.identity);
    let reviews = 0;
    const authority = syntheticRecoveryAuthority();
    f.recoveryAuthority = {
      read: async (context) => {
        reviews++;
        return authority.read(context);
      },
    };
    const request = { ...f.identity, commandKey: 'concurrent-resolve' };
    const [a, b] = await Promise.all([f.restart().recover(request), f.restart().recover(request)]);
    expect(a).toEqual(b);
    expect(reviews).toBe(1);
    await expect(
      sql`UPDATE publication_operations SET availability_resolved_at=NULL WHERE shop_id=${f.identity.shopId} AND operation_id=${f.identity.operationId}`.execute(
        database,
      ),
    ).rejects.toThrow('immutable resolved evidence');
    await expect(
      sql`UPDATE publication_operations SET failure_class='rewrite-history' WHERE shop_id=${f.identity.shopId} AND operation_id=${f.identity.operationId}`.execute(
        database,
      ),
    ).rejects.toThrow('terminal publication operation is immutable');
    await expect(
      sql`UPDATE m5_availability_resolutions SET resolution=resolution WHERE shop_id=${f.identity.shopId} AND operation_id=${f.identity.operationId}`.execute(
        database,
      ),
    ).rejects.toThrow('immutable');
    await expect(
      sql`DELETE FROM m5_availability_resolutions WHERE shop_id=${f.identity.shopId} AND operation_id=${f.identity.operationId}`.execute(
        database,
      ),
    ).rejects.toThrow('immutable');
    expect(f.acquisitions).toBe(0);
    expect(f.restores).toBe(0);
  });

  it.each([
    ['required', 'optional'],
    ['optional', 'required'],
  ] as const)('public spoofed admission cannot dispatch a %s to %s mode change', async (priorMode, nextMode) => {
    const f = await fixture(priorMode);
    await f.prepareHold();
    await f.publish();
    await f.restart().advance(f.identity);
    await f.restart().advance(f.identity);
    const revisionId = randomUUID();
    const operationId = randomUUID();
    await f.createRevision(revisionId, nextMode);
    let callbacks = 0;
    const input = {
      appId: '101',
      remote: f.remote,
      admission: {
        established: async () => {
          callbacks++;
          return true;
        },
      },
    };
    const publication = core.productionPublications.create(input);
    await publication.prepare({ ...f.identity, operationId, revisionId, mode: nextMode });
    const writes = f.remoteWrites;
    for (let i = 0; i < 3; i++)
      expect(await publication.advance(f.identity.shopId, f.identity.configId, operationId)).toMatchObject({
        kind: 'ADMISSION_PENDING',
        phase: 'prepared',
      });
    expect(callbacks).toBe(0);
    expect(f.remoteWrites).toBe(writes);
    expect(f.acquisitions).toBe(1);
    expect((await core.configs.getConfig(f.identity.shopId, f.identity.configId))?.effectiveRevisionId).toBe(
      f.revisionId,
    );
  });

  it('a pending owned hold prevents another production publication from hiding recovery', async () => {
    const f = await fixture();
    await f.prepareHold();
    await f.publish();
    await f.restart().advance(f.identity);
    await expect(
      f
        .restart()
        .publications.prepare({ ...f.identity, operationId: randomUUID(), revisionId: f.revisionId, mode: 'required' }),
    ).rejects.toThrow('Availability hold requires recovery');
  });
});

function syntheticRecoveryAuthority(): import('@insignia/application').TrustedAvailabilityRecoveryAuthorityPort {
  return {
    read: async (context) => ({
      version:
        context.hold.version === 'm5-availability-hold-v2'
          ? 'm5-availability-recovery-decision-v2'
          : 'm5-availability-recovery-decision-v1',
      shopId: context.shopId,
      configId: context.configId,
      operationId: context.operationId,
      commandKey: context.commandKey,
      decisionRef: 'synthetic-owner-review',
      actorRef: 'synthetic-owner',
      currentScopeDigest: activationDigest(context.currentScope),
      holdDigest: activationDigest(context.hold),
      observedSnapshotDigest: availabilitySnapshotIdentityDigest(context.observed),
      outstandingWrites: 'SETTLED_BY_TRUSTED_OPERATOR',
      reviewedAt: now.toISOString(),
      expiresAt: '2026-10-01T12:00:01.000Z',
    }),
  };
}
