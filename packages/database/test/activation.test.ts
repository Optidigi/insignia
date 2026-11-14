import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type {
  ActivationReadinessPort,
  ExpectedFunctionBuild,
  FunctionObjectObservation,
  ProductAvailabilityHoldV3Port as ProductAvailabilityHoldPort,
  ProductAvailabilitySnapshotV3 as ProductAvailabilitySnapshot,
} from '@insignia/application';
import {
  AvailabilityProviderUnavailableError,
  activationDigest,
  availabilitySnapshotIdentityDigest,
} from '@insignia/application';
import {
  createPublicationAdminAdapter,
  createPublicationAdminHttpTransport,
  createShopifyAvailabilityHoldPort,
  createShopifyAvailabilityHoldV3Port,
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
  // #466 test 13: when set, every UPDATE of publication progress or operation rows first records
  // whether its transaction holds a FOR UPDATE row lock on `shops` (the freeze rule's premise).
  let shopLockAudit: { text: string; locked: boolean }[] | undefined;
  const publicationWrite = /^\s*update\s+"?(m4_publication_progress|publication_operations)"?\s/i;
  beforeAll(async () => {
    database = await openTestDatabase();
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
    pool.on('connect', (client) => {
      const original = client.query.bind(client);
      client.query = ((...args: unknown[]) => {
        const input = args[0];
        const sqlText =
          typeof input === 'string'
            ? input
            : input && typeof input === 'object' && 'text' in input && typeof input.text === 'string'
              ? input.text
              : '';
        if (shopLockAudit && publicationWrite.test(sqlText)) {
          const audit = shopLockAudit;
          return (
            Reflect.apply(original, client, [
              `SELECT EXISTS(SELECT FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='relation'
                AND relation='public.shops'::regclass AND mode='RowShareLock' AND granted) AS locked`,
            ]) as Promise<{ rows: { locked: boolean }[] }>
          ).then((check) => {
            audit.push({ text: sqlText.trim().slice(0, 60), locked: check.rows[0]?.locked === true });
            return Reflect.apply(original, client, args);
          });
        }
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
    let requestDeadline = Infinity;
    const beforeWrite = () => providerClock.getTime() < requestDeadline;
    let providerDelay: { point: 'fetch' | 'body' | 'credential'; ms: number } | null = null;
    const providerWrites: string[] = [];
    const providerMutations: { status: string; at: number }[] = [];
    let calendarDelay: { at: number; call: number; ms: number; seen: number } | null = null;
    let status = providerStatus ?? 'ACTIVE';
    let version = '2026-10-01T11:00:00.000Z';
    let availabilityReads = 0;
    let restoreCredentialDelay: { afterReads: number; ms: number } | null = null;
    // Provider reads (1-based count) that answer 503: an outage that observed nothing.
    const failedReads = new Set<number>();
    // The next status mutation is sent but its response is lost (an ambiguous write).
    let failMutation = false;
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
    const dispatches: { field: string; committedPhase: string | null }[] = [];
    let beforeSet: ((field: string) => Promise<void>) | undefined;
    let beforeRead: (() => Promise<void>) | undefined;
    const syntheticRemote: ProductionPublicationRemote = {
      read: async (target) => {
        remoteReads++;
        await beforeRead?.();
        return cells.get(target.field) ?? null;
      },
      set: async (target) => {
        remoteWrites++;
        await beforeSet?.(target.field);
        // #466 test 9: the committed phase (another connection sees only committed rows).
        const committed = await sql<{ phase: string }>`SELECT phase FROM m4_publication_progress
          WHERE shop_id=${shopId} AND operation_id=${operationId}`.execute(database);
        dispatches.push({ field: target.field, committedPhase: committed.rows[0]?.phase ?? null });
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
      version: 'm5-product-availability-snapshot-v3',
      providerUpdatedAt: '2026-10-01T11:00:00.000Z',
      effectiveAnchors: [],
      visibleScheduledOrStaged: [],
      effectiveVisibility: {
        publishedPublicationIds: [],
        onlineStore: { publishedAtPresent: false, urlPresent: false },
        publicationEvidence: [],
        publishedAt: null,
        onlineStoreUrl: null,
      },
      anchorDigest: activationDigest([]),
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
    let observeFailures = 0;
    let restoreLost = false;
    let restoreUnsettled: 'pending' | 'throw' | 'original' | 'not-dispatched' | null = null;
    let restoreSettled = false;
    let acquisitions = 0;
    let restores = 0;
    const availability: ProductAvailabilityHoldPort = {
      snapshot: async (scope) => ({ ...current, scope }),
      acquire: async (_scope, hold) => {
        if (hold.version !== 'm5-availability-hold-v3') throw new Error('new acquisition requires v3');
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
        return {
          kind: 'HELD',
          current,
          hold: {
            ...hold,
            held: current,
            acquisitionAcknowledgement: {
              version: 'm5-availability-mutation-ack-v3' as const,
              scope: current.scope,
              productId: current.productId,
              state: current.state,
              providerUpdatedAt: current.providerUpdatedAt,
              effectiveVisibility: current.effectiveVisibility,
              observedAt: current.observedAt,
              receivedAt: current.receivedAt,
            },
          },
        };
      },
      observe: async (_scope, hold) => {
        if (observeFailures > 0) {
          observeFailures--;
          throw new AvailabilityProviderUnavailableError('throttled');
        }
        return current.state === 'unavailable' &&
          hold.version === 'm5-availability-hold-v3' &&
          current.anchorDigest === hold.before.anchorDigest
          ? { kind: 'HELD', current, hold: { ...hold, held: current } }
          : { kind: 'CONFLICT', current };
      },
      restore: async (_scope, hold) => {
        if (hold.version !== 'm5-availability-hold-v3') throw new Error('new restoration requires v3');
        const record = await core.productionActivations
          .create(options)
          .read({ ...identity, operationId: hold.operationId });
        expect(record?.state.kind).toBe('RESTORATION_CLAIMED');
        expect(record?.evidence).not.toBeNull();
        expect((await core.configs.getConfig(shopId, configId))?.effectiveRevisionId).not.toBeNull();
        restores++;
        if (restoreUnsettled === 'not-dispatched') return { kind: 'NOT_DISPATCHED', current: structuredClone(current) };
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
        return {
          kind: 'RESTORED',
          current,
          acknowledgement: {
            version: 'm5-availability-mutation-ack-v3' as const,
            scope: current.scope,
            productId: current.productId,
            state: current.state,
            providerUpdatedAt: current.providerUpdatedAt,
            effectiveVisibility: current.effectiveVisibility,
            observedAt: current.observedAt,
            receivedAt: current.receivedAt,
          },
        };
      },
    };
    let responsePending = false,
      restoreMismatch = false;
    const providerFetch = (async (_url: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      const mutation = request.query.startsWith('mutation');
      if (!mutation) availabilityReads++;
      if (!mutation && failedReads.delete(availabilityReads)) return new Response('', { status: 503 });
      if (mutation && failMutation) {
        failMutation = false;
        providerWrites.push(`lost:${request.variables.product.status}`);
        return new Response('', { status: 503 });
      }
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
        publishedAt:
          restoreMismatch && providerWrites.includes('ACTIVE') && status === 'ACTIVE'
            ? '2026-10-01T11:02:00.000Z'
            : null,
        onlineStoreUrl:
          restoreMismatch && providerWrites.includes('ACTIVE') && status === 'ACTIVE'
            ? 'https://synthetic.example/products/fixture'
            : null,
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
    }) as typeof fetch;
    const makeAvailability = () =>
      providerStatus
        ? createShopifyAvailabilityHoldV3Port({
            now: () => new Date(providerClock),
            beforeWrite,
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
            fetchImpl: providerFetch,
          })
        : availability;
    const providerAvailability = makeAvailability();
    let recoveryAuthority: import('@insignia/application').TrustedAvailabilityRecoveryAuthorityPort | undefined;
    const options = {
      appId: '101',
      appClientId: artifactScope.appClientId,
      remote,
      availability: providerAvailability,
      readiness,
      now: () => (providerStatus ? new Date(providerClock) : now),
      maxObservationAgeMs: 1000,
      beforeWrite,
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
      expireRequest: () => {
        requestDeadline = providerClock.getTime();
      },
      httpMutations,
      set failMutation(value: boolean) {
        failMutation = value;
      },
      /** #466 B worker pass on this fixture's fake Shopify, with a per-row port. */
      abandonment: (
        options: Partial<Parameters<DurableCore['publicationAbandonment']['create']>[0]> = {},
        via: DurableCore = core,
      ) =>
        via.publicationAbandonment.create({
          appClientId: artifactScope.appClientId,
          mode: 'restore',
          abandonAfterMs: 0,
          releaseWaitFlagMs: 0,
          claimStaleMs: 60_000,
          acquireToken: async () => ({
            kind: 'usable',
            shopDomain: 'synthetic.myshopify.com',
            accessToken: 'synthetic-offline-token',
            accessExpiresAt: new Date('2099-01-01T00:00:00Z'),
          }),
          availability: ({ credentials, isCurrent }) =>
            createShopifyAvailabilityHoldV3Port({
              now: () => new Date(providerClock),
              isCurrent,
              credentials,
              fetchImpl: providerFetch,
            }),
          ...options,
        }),
      /** The next provider read after `afterReads` more reads answers 503 (nothing observed). */
      failProviderRead: (afterReads: number) => {
        failedReads.add(availabilityReads + afterReads + 1);
      },
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
      freshProviderRestart: () =>
        core.productionActivations.create({ ...options, availability: makeAvailability(), recoveryAuthority }),
      /** Someone else changes the product's status in Shopify. */
      set providerProductStatus(value: string) {
        status = value;
      },
      set restoreMismatch(value: boolean) {
        restoreMismatch = value;
      },
      restartWithAvailability: (port: Pick<ProductAvailabilityHoldPort, 'snapshot'>) =>
        core.productionActivations.create({
          ...options,
          availability: { ...availability, snapshot: port.snapshot },
          recoveryAuthority,
        }),
      prepareHold,
      publish,
      createRevision,
      cells,
      set acquireNotSent(value: boolean) {
        acquireNotSent = value;
      },
      set observeFailures(value: number) {
        observeFailures = value;
      },
      set acquireLost(value: boolean) {
        acquireLost = value;
      },
      set restoreLost(value: boolean) {
        restoreLost = value;
      },
      set restoreUnsettled(value: 'pending' | 'throw' | 'original' | 'not-dispatched' | null) {
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
      dispatches,
      /** Gates the synthetic provider write (inside advance, while it holds the shop lock). */
      set beforeSet(value: ((field: string) => Promise<void>) | undefined) {
        beforeSet = value;
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
        const effectiveAnchors = [
          {
            publicationId: 'gid://shopify/Publication/999',
            resolved: true as const,
            productIncluded: true as const,
            autoPublish: true,
            supportsFuturePublishing: false,
          },
        ];
        current = { ...current, effectiveAnchors, anchorDigest: activationDigest(effectiveAnchors) };
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
  it('request expiry during PostgreSQL acquisition lock wait preserves hold intent without a provider mutation', async () => {
    const f = await fixture('required', 'ACTIVE');
    expect((await f.restart().advance(f.identity)).kind).toBe('WAITING_HOLD');
    let locked!: (pid: number) => void, release!: () => void;
    const acquired = new Promise<number>((resolve) => {
      locked = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = database.transaction().execute(async (tx) => {
      await sql`SELECT shop_id FROM shops WHERE shop_id=${f.identity.shopId} FOR UPDATE`.execute(tx);
      const pid = (await sql<{ pid: number }>`SELECT pg_backend_pid() pid`.execute(tx)).rows[0]?.pid;
      if (!pid) throw new Error('PostgreSQL holder missing');
      locked(pid);
      await hold;
    });
    const holder = await acquired;
    const advancement = f
      .restart()
      .advance(f.identity)
      .then(
        () => 'advanced',
        () => 'denied',
      );
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const row = await sql<{
          blocked: boolean;
        }>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${holder}=ANY(pg_blocking_pids(pid))) blocked`.execute(
          database,
        );
        if (row.rows[0]?.blocked) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(blocked).toBe(true);
      f.expireRequest();
    } finally {
      release();
      await blocker;
    }
    expect(await advancement).toBe('denied');
    expect(f.providerWrites).toEqual([]);
    expect((await f.restart().read(f.identity))?.state.kind).toBe('HOLD_INTENT');
  });

  it('expiry after effective-evidence SQL rolls back every effective pointer and preserves the held receipt', async () => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    await f.publish();
    let expired = false;
    afterSql = (text) => {
      if (text.includes('INSERT INTO m5_activation_evidence')) {
        expired = true;
        f.expireRequest();
      }
    };
    try {
      await expect(f.restart().advance(f.identity)).rejects.toThrow('Activation authority expired');
    } finally {
      afterSql = undefined;
    }
    expect(expired).toBe(true);
    expect((await core.configs.getConfig(f.identity.shopId, f.identity.configId))?.effectiveRevisionId).toBeNull();
    expect((await f.restart().read(f.identity))?.evidence).toBeNull();
    expect((await f.restart().read(f.identity))?.state.kind).toBe('HELD');
    expect(f.providerWrites).toEqual(['DRAFT']);
  });

  it('v2 JSONB remains unchanged through operator hold and exact historical trusted recovery', async () => {
    const f = await fixture();
    const legacyScope = {
      shopId: f.identity.shopId,
      installationGeneration: '1',
      shopifyShopId: `gid://shopify/Shop/${f.scope.shopifyShopId}`,
      appClientId: 'a'.repeat(32),
    };
    let requests = 0;
    const legacyPort = createShopifyAvailabilityHoldV3Port({
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
            publications: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false, endCursor: null } },
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
    const before = await legacyPort.snapshot(legacyScope, 'gid://shopify/Product/42', 'v2');
    const legacy = { version: 'm5-availability-hold-v2', operationId: f.identity.operationId, before, held: null };
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
    const resolved = await f.restartWithAvailability(legacyPort).recover({ ...f.identity, commandKey: 'recover-v2' });
    expect(resolved).toMatchObject({
      version: 'm5-availability-resolution-v2',
      originalHold: legacy,
      decision: { version: 'm5-availability-recovery-decision-v2' },
    });
    expect((await f.restart().read(f.identity))?.state).toMatchObject({ kind: 'RESOLVED', hold: legacy });
    expect(requests).toBe(3);
    expect(f.acquisitions).toBe(0);
    expect(f.restores).toBe(0);
  });
  it('v3 one-shot compensating rehold persists OPERATOR_HOLD and immutable audit across fresh adapters', async () => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    await f.publish();
    expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVATED_RESTORATION_PENDING');
    f.restoreMismatch = true;
    expect((await f.freshProviderRestart().advance(f.identity)).kind).toBe('OPERATOR_HOLD');
    const record = await f.restart().read(f.identity);
    expect(record?.state.hold).toMatchObject({
      version: 'm5-availability-hold-v3',
      restorationClaim: { restoreReserved: true, compensationReserved: true },
      restorationReceipt: {
        kind: 'REHELD_CONFLICT',
        compensation: {
          version: 'm5-availability-compensation-receipt-v3',
          mismatch: ['online_store_presence'],
          acknowledgement: { state: 'unavailable' },
          current: { state: 'unavailable' },
        },
      },
    });
    const v3 = record?.state.hold;
    if (v3?.version !== 'm5-availability-hold-v3' || !v3.restorationReceipt?.compensation?.acknowledgement)
      throw new Error('expected complete compensation audit');
    const receipt = v3.restorationReceipt,
      compensation = receipt.compensation!,
      ack = compensation.acknowledgement!;
    const unsupportedLegacy = {
      ...v3,
      restorationReceipt: {
        ...receipt,
        compensation: {
          ...compensation,
          acknowledgement: {
            ...ack,
            effectiveVisibility: {
              ...ack.effectiveVisibility,
              publicationEvidence: [
                ...ack.effectiveVisibility.publicationEvidence,
                {
                  publicationId: 'gid://shopify/Publication/999',
                  isPublished: false,
                  publishDate: '2099-01-01T00:00:00.000Z',
                },
              ],
            },
          },
        },
      },
    };
    const admits = async (hold: unknown) =>
      (
        await sql<{ admitted: boolean }>`SELECT m5_v3_hold(${JSON.stringify(hold)}::jsonb) AS admitted`.execute(
          database,
        )
      ).rows[0]!.admitted;
    expect(await admits(unsupportedLegacy)).toBe(false);
    expect(
      await admits({
        ...unsupportedLegacy,
        restorationReceipt: { ...unsupportedLegacy.restorationReceipt, kind: 'RESTORATION_PENDING' },
      }),
    ).toBe(true);
    expect(f.providerWrites).toEqual(['DRAFT', 'ACTIVE', 'DRAFT']);
    expect((await f.freshProviderRestart().advance(f.identity)).kind).toBe('OPERATOR_HOLD');
    expect(f.providerWrites).toEqual(['DRAFT', 'ACTIVE', 'DRAFT']);
    await expect(
      sql`UPDATE m5_activation_state SET hold=jsonb_set(hold,'{restorationReceipt,compensation,mismatch}','[]'::jsonb),version=version+1 WHERE shop_id=${f.identity.shopId}`.execute(
        database,
      ),
    ).rejects.toThrow('v3 availability audit is immutable');
    expect((await f.restart().read(f.identity))?.state.hold).toEqual(record?.state.hold);
  });

  it('SQL serializes settled no-dispatch recovery and retains the immutable original receipt', async () => {
    const f = await fixture();
    await f.prepareHold();
    await f.publish();
    f.restoreUnsettled = 'not-dispatched';
    await f.restart().advance(f.identity);
    await f.restart().advance(f.identity);
    const before = await f.restart().read(f.identity);
    if (
      before?.state.hold?.version !== 'm5-availability-hold-v3' ||
      before.state.hold.restorationReceipt?.kind !== 'NOT_DISPATCHED'
    )
      throw new Error('Expected no-write receipt');
    await expect(
      sql`UPDATE m5_activation_state SET hold=jsonb_set(hold,'{restorationClaim,settledNoDispatchReceiptDigest}',to_jsonb(${'a'.repeat(64)}::text)),version=version+1 WHERE shop_id=${f.identity.shopId}`.execute(
        database,
      ),
    ).rejects.toThrow('immutable');
    const rejectedAudit =
      await sql`SELECT FROM m5_restoration_no_dispatch_consumptions WHERE shop_id=${f.identity.shopId}`.execute(
        database,
      );
    expect(rejectedAudit.rows).toHaveLength(0);
    expect((await f.restart().read(f.identity))?.state.hold).toEqual(before.state.hold);
    f.restoreUnsettled = null;
    await Promise.all([f.restart().advance(f.identity), f.restart().advance(f.identity)]);
    const after = await f.restart().read(f.identity);
    expect(after?.state.kind).toBe('RESTORED');
    const audit = await sql<{
      original_claim: unknown;
      original_receipt: unknown;
      receipt_digest: string;
    }>`SELECT original_claim,original_receipt,receipt_digest FROM m5_restoration_no_dispatch_consumptions WHERE shop_id=${f.identity.shopId} AND config_id=${f.identity.configId} AND operation_id=${f.identity.operationId}`.execute(
      database,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.original_claim).toEqual(before.state.hold.restorationClaim);
    expect(audit.rows[0]?.original_receipt).toEqual(before.state.hold.restorationReceipt);
    expect(audit.rows[0]?.receipt_digest).toBe(activationDigest(before.state.hold.restorationReceipt));
    await expect(
      sql`UPDATE m5_restoration_no_dispatch_consumptions SET original_receipt='{}'::jsonb WHERE shop_id=${f.identity.shopId}`.execute(
        database,
      ),
    ).rejects.toThrow('immutable');
    await expect(
      sql`UPDATE m5_activation_state SET hold=jsonb_set(hold,'{restorationClaim,settledNoDispatchReceiptDigest}',to_jsonb(${'a'.repeat(64)}::text)),version=version+1 WHERE shop_id=${f.identity.shopId}`.execute(
        database,
      ),
    ).rejects.toThrow();
  });

  it('restricted runtime consumes through the owner trigger without direct audit privileges', async () => {
    const f = await fixture();
    await f.prepareHold();
    await f.publish();
    f.restoreUnsettled = 'not-dispatched';
    await f.restart().advance(f.identity);
    await f.restart().advance(f.identity);
    const hold = (await f.restart().read(f.identity))?.state.hold;
    if (hold?.version !== 'm5-availability-hold-v3' || hold.restorationReceipt?.kind !== 'NOT_DISPATCHED')
      throw new Error('Expected no-write receipt');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();
    const role = `restoration_${randomUUID().replaceAll('-', '')}`;
    try {
      await client.query('BEGIN');
      await client.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await client.query(`GRANT SELECT,UPDATE ON public.m5_activation_state TO ${role}`);
      await client.query(`SET LOCAL ROLE ${role}`);
      const privileges = await client.query(
        "SELECT has_table_privilege(current_user,'public.m5_restoration_no_dispatch_consumptions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') AS audit_access",
      );
      expect(privileges.rows[0]?.audit_access).toBe(false);
      const result = await client.query(
        "UPDATE public.m5_activation_state SET hold=jsonb_set(hold,'{restorationClaim,settledNoDispatchReceiptDigest}',to_jsonb($1::text)),version=version+1 WHERE shop_id=$2 RETURNING operation_id",
        [activationDigest(hold.restorationReceipt), f.identity.shopId],
      );
      expect(result.rowCount).toBe(1);
      await client.query('RESET ROLE');
      const audit = await client.query(
        'SELECT original_receipt FROM public.m5_restoration_no_dispatch_consumptions WHERE shop_id=$1',
        [f.identity.shopId],
      );
      expect(audit.rows.map((row) => row.original_receipt)).toEqual([hold.restorationReceipt]);
      await client.query(`SET LOCAL ROLE ${role}`);
      await client.query('CREATE TEMP TABLE counterfeit_activation (hold jsonb)');
      await client.query(
        'CREATE TRIGGER counterfeit BEFORE INSERT ON counterfeit_activation FOR EACH ROW EXECUTE FUNCTION public.enforce_activation_v3_audit()',
      );
      await expect(client.query("INSERT INTO counterfeit_activation VALUES ('{}'::jsonb)")).rejects.toThrow(
        'unexpected restoration audit relation',
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  });

  it('#466 N2: a failed pre-write read after activation stores NOT_DISPATCHED and the claim rearms once', async () => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    await f.publish();
    expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVATED_RESTORATION_PENDING');
    // The claim is committed. The coordinator observes the held product, then restore() rereads it
    // before the status write; that reread fails (outage), so nothing was dispatched.
    f.failProviderRead(1);
    expect((await f.freshProviderRestart().advance(f.identity)).kind).toBe('ACTIVATED_RESTORATION_PENDING');
    const stored = await f.restart().read(f.identity);
    expect(stored?.state).toMatchObject({
      kind: 'RESTORATION_CLAIMED',
      hold: { restorationReceipt: { kind: 'NOT_DISPATCHED', acknowledgement: null, current: null } },
    });
    expect(f.providerWrites).toEqual(['DRAFT']);
    // One rearm of that receipt digest, then the restore completes.
    expect((await f.freshProviderRestart().advance(f.identity)).kind).toBe('ACTIVE');
    expect(f.providerWrites).toEqual(['DRAFT', 'ACTIVE']);
    const consumed =
      await sql`SELECT FROM m5_restoration_no_dispatch_consumptions WHERE shop_id=${f.identity.shopId}`.execute(
        database,
      );
    expect(consumed.rows).toHaveLength(1);
  });

  it('#466 N2: a second no-current NOT_DISPATCHED cannot rearm the same claim again', async () => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    await f.publish();
    expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVATED_RESTORATION_PENDING');
    f.failProviderRead(1);
    expect((await f.freshProviderRestart().advance(f.identity)).kind).toBe('ACTIVATED_RESTORATION_PENDING');
    // The rearmed attempt fails the same way: same receipt digest, so no second rearm.
    f.failProviderRead(1);
    expect((await f.freshProviderRestart().advance(f.identity)).kind).toBe('ACTIVATED_RESTORATION_PENDING');
    expect((await f.freshProviderRestart().advance(f.identity)).kind).toBe('ACTIVATED_RESTORATION_PENDING');
    expect(f.providerWrites).toEqual(['DRAFT']);
    const state = (await f.restart().read(f.identity))?.state;
    expect(state?.kind).toBe('RESTORATION_CLAIMED');
    if (state?.hold?.version !== 'm5-availability-hold-v3') throw new Error('v3 hold expected');
    expect(state.hold.restorationClaim?.settledNoDispatchReceiptDigest).toBe(
      activationDigest(state.hold.restorationReceipt),
    );
  });

  // #466 part B: automatic release of an abandoned publication hold (design §8, tests 1-13).
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const activationRow = async (f: Fixture, operationId = f.identity.operationId) =>
    (
      await sql<{ kind: string; version: string; hold: Record<string, unknown> }>`SELECT kind, version::text, hold
        FROM m5_activation_state WHERE shop_id=${f.identity.shopId} AND operation_id=${operationId}`.execute(database)
    ).rows[0];
  const progressPhase = async (f: Fixture, operationId = f.identity.operationId) =>
    (
      await sql<{ phase: string }>`SELECT phase FROM m4_publication_progress
        WHERE shop_id=${f.identity.shopId} AND operation_id=${operationId}`.execute(database)
    ).rows[0]?.phase;
  const operationRow = async (f: Fixture, operationId = f.identity.operationId) =>
    (
      await sql<{ status: string; failure_class: string | null; availability_resolved_at: Date | null }>`
        SELECT status, failure_class, availability_resolved_at FROM publication_operations
        WHERE shop_id=${f.identity.shopId} AND operation_id=${operationId}`.execute(database)
    ).rows[0];
  const auditRows = async (f: Fixture) =>
    (
      await sql<{ event: string; from_kind: string; to_kind: string; detail: unknown; activation_version: string }>`
        SELECT event, from_kind, to_kind, detail, activation_version::text FROM m5_publication_abandonment_audit
        WHERE shop_id=${f.identity.shopId} ORDER BY activation_version`.execute(database)
    ).rows;
  /** A schema-owner claim built like the worker's (direct SQL, for the trigger table). */
  const directClaim = (f: Fixture, authority = 'PROVED_NOT_DISPATCHED') =>
    sql`UPDATE m5_activation_state a SET kind='ABANDON_CLAIMED', version=a.version+1, hold=a.hold||jsonb_build_object(
        'abandonmentClaim',jsonb_build_object('version','m5-publication-abandonment-claim-v1','operationId',a.operation_id,
          'scope',a.hold#>'{before,scope}','productId',a.hold#>>'{before,productId}','authority',${authority}::text,
          'quietSince','2026-11-14T12:00:00.000Z','claimedAt','2026-11-14T12:10:00.000Z'),
        'restorationClaim',jsonb_build_object('version','m5-availability-restoration-claim-v3','operationId',a.operation_id,
          'scope',a.hold#>'{before,scope}','productId',a.hold#>>'{before,productId}','restoreReserved',true,'compensationReserved',true))
      WHERE a.shop_id=${f.identity.shopId} AND a.operation_id=${f.identity.operationId}`.execute(database);
  const advanceBoth = async (f: Fixture) => [
    (await f.restart().publications.advance(f.identity.shopId, f.identity.configId, f.identity.operationId)).kind,
    (await f.restart().advance(f.identity)).kind,
  ];

  it('#466 B: a quiet prepared owned hold is claimed, restored exactly, finalized, and publishing is allowed again', async () => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    expect(f.providerWrites).toEqual(['DRAFT']);
    expect(await f.abandonment().runPass({ shopId: f.identity.shopId })).toMatchObject({
      restored: 1,
      finalized: 1,
      flagged: 0,
    });
    expect(f.providerWrites).toEqual(['DRAFT', 'ACTIVE']);
    const row = await activationRow(f);
    expect(row).toMatchObject({
      kind: 'ABANDON_RESTORED',
      hold: {
        abandonmentClaim: { authority: 'PROVED_NOT_DISPATCHED', operationId: f.identity.operationId },
        restorationClaim: { restoreReserved: true },
        restorationReceipt: { kind: 'RESTORED', current: { state: 'available' } },
      },
    });
    expect(await progressPhase(f)).toBe('abandoned');
    expect(await operationRow(f)).toMatchObject({ status: 'failed', failure_class: 'publication-abandoned' });
    expect((await operationRow(f))?.availability_resolved_at).not.toBeNull();
    expect((await auditRows(f)).map((r) => [r.event, r.from_kind, r.to_kind])).toEqual([
      ['CLAIMED', 'HELD', 'ABANDON_CLAIMED'],
      ['RECEIPT', 'ABANDON_CLAIMED', 'ABANDON_CLAIMED'],
      ['RESTORED', 'ABANDON_CLAIMED', 'ABANDON_RESTORED'],
    ]);
    // Test plan 2: the abandoned request leaves every current-publication read.
    expect(await core.configs.getCurrentPublication(f.identity.shopId, f.identity.configId)).toBeNull();
    expect(await core.configs.getAvailabilityRecovery(f.identity.shopId, f.identity.configId)).toBeNull();
    // A late merchant retry and the #452 resume path stop before any IO.
    const reads = f.remoteReads;
    expect(await advanceBoth(f)).toEqual(['ABANDONED', 'ABANDONED']);
    expect(f.remoteReads).toBe(reads);
    expect(f.providerWrites).toEqual(['DRAFT', 'ACTIVE']);
    expect(await f.abandonment().runPass({ shopId: f.identity.shopId })).toMatchObject({
      restored: 0,
      finalized: 0,
      flagged: 0,
    });
    await expect(
      sql`UPDATE m5_activation_state SET kind='OPERATOR_HOLD', version=version+1
      WHERE shop_id=${f.identity.shopId}`.execute(database),
    ).rejects.toThrow('terminal');
    await expect(
      sql`UPDATE m4_publication_progress SET phase='operator-hold', version=version+1
      WHERE shop_id=${f.identity.shopId}`.execute(database),
    ).rejects.toThrow(/terminal|only finalizes/);
    const next = randomUUID();
    await f.createRevision(next, 'required');
    await expect(
      f.restart().publications.prepare({ ...f.identity, operationId: next, revisionId: next, mode: 'required' }),
    ).resolves.toMatchObject({ phase: 'prepared' });
  });

  it('#466 B: a mode change abandoned after an effective publication passes the next prepare gap check', async () => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    await f.publish();
    await f.restart().advance(f.identity);
    expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVE');
    const second = { ...f.identity, operationId: randomUUID() };
    const revision = randomUUID();
    await f.createRevision(revision, 'optional');
    await f.restart().publications.prepare({ ...second, revisionId: revision, mode: 'optional' });
    expect((await f.restart().advance(second)).kind).toBe('WAITING_HOLD');
    expect((await f.restart().advance(second)).kind).toBe('HELD');
    expect(await f.abandonment().runPass({ shopId: f.identity.shopId })).toMatchObject({ restored: 1, finalized: 1 });
    expect(f.providerWrites).toEqual(['DRAFT', 'ACTIVE', 'DRAFT', 'ACTIVE']);
    expect((await core.configs.getCurrentPublication(f.identity.shopId, f.identity.configId))?.operationId).toBe(
      f.identity.operationId,
    );
    const third = randomUUID();
    await f.createRevision(third, 'optional');
    await expect(
      f.restart().publications.prepare({ ...f.identity, operationId: third, revisionId: third, mode: 'optional' }),
    ).resolves.toMatchObject({ phase: 'prepared' });
  });

  it('#466 B: while claimed, publication and activation return ABANDONED, key drift writes nothing, rows are frozen', async () => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    f.failProviderRead(1); // T1 observes; restore()'s pre-write read fails: nothing dispatched.
    expect(await f.abandonment().runPass({ shopId: f.identity.shopId })).toMatchObject({ restored: 0, flagged: 0 });
    const claimed = await activationRow(f);
    expect(claimed).toMatchObject({
      kind: 'ABANDON_CLAIMED',
      hold: { restorationReceipt: { kind: 'NOT_DISPATCHED', current: null } },
    });
    // Signing provisioning bumps the epoch: publication.advance would hit current() drift and
    // write `operator-hold`; it short-circuits instead and the freeze would reject the write.
    await sql`UPDATE installation_generations SET authorization_epoch=authorization_epoch+1
      WHERE shop_id=${f.identity.shopId}`.execute(database);
    const reads = f.remoteReads;
    expect(await advanceBoth(f)).toEqual(['ABANDONED', 'ABANDONED']);
    expect(f.remoteReads).toBe(reads);
    expect((await activationRow(f))?.version).toBe(claimed?.version);
    expect(await progressPhase(f)).toBe('prepared');
    await expect(
      sql`UPDATE m4_publication_progress SET phase='operator-hold', version=version+1
      WHERE shop_id=${f.identity.shopId}`.execute(database),
    ).rejects.toThrow('frozen');
    await expect(
      sql`UPDATE publication_operations SET status='superseded', superseded_at=now()
      WHERE shop_id=${f.identity.shopId}`.execute(database),
    ).rejects.toThrow('frozen');
    const other = randomUUID();
    await f.createRevision(other, 'required');
    await expect(
      f.restart().publications.prepare({ ...f.identity, operationId: other, revisionId: other, mode: 'required' }),
    ).rejects.toThrow('Availability hold requires recovery');
    // The one rearm restores; T3 still commits after the drift.
    expect(await f.abandonment().runPass({ shopId: f.identity.shopId })).toMatchObject({ restored: 1, finalized: 1 });
    expect(f.providerWrites).toEqual(['DRAFT', 'ACTIVE']);
    expect(await progressPhase(f)).toBe('abandoned');
  });

  it('#466 B: a merchant who advanced first is never restored; the quiet row is flagged fields_written', async () => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    expect(
      (await f.restart().publications.advance(f.identity.shopId, f.identity.configId, f.identity.operationId)).kind,
    ).toBe('PENDING');
    expect(await progressPhase(f)).toBe('shop-config-written');
    expect(await f.abandonment({ abandonAfterMs: 3_600_000 }).runPass({ shopId: f.identity.shopId })).toMatchObject({
      flagged: 0,
    });
    expect(await f.abandonment().runPass({ shopId: f.identity.shopId })).toMatchObject({ restored: 0, flagged: 1 });
    expect((await activationRow(f))?.kind).toBe('OPERATOR_HOLD');
    expect(await auditRows(f)).toMatchObject([
      { event: 'FLAGGED', from_kind: 'HELD', to_kind: 'OPERATOR_HOLD', detail: { reasons: ['fields_written'] } },
    ]);
    expect(f.providerWrites).toEqual(['DRAFT']);
    // A direct claim past `prepared` is rejected by the trigger too.
    await expect(directClaim(f, 'SETTLED_BY_TRUSTED_OPERATOR')).rejects.toThrow('committed phase prepared');
  });

  it('#466 B: flag mode flags only; off does nothing; a throttled E8 read skips without a claim', async () => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    expect(await f.abandonment({ mode: 'off' }).runPass({ shopId: f.identity.shopId })).toEqual({
      restored: 0,
      finalized: 0,
      flagged: 0,
      flaggedHolds: 0,
    });
    expect(await f.abandonment({ mode: 'flag' }).runPass({ shopId: f.identity.shopId })).toMatchObject({
      restored: 0,
      flagged: 0,
    });
    expect((await activationRow(f))?.kind).toBe('HELD');
    f.failProviderRead(0);
    expect(await f.abandonment().runPass({ shopId: f.identity.shopId })).toMatchObject({ restored: 0, flagged: 0 });
    expect((await activationRow(f))?.kind).toBe('HELD');
    expect(await auditRows(f)).toEqual([]);
    expect(await f.abandonment().runPass({ shopId: f.identity.shopId })).toMatchObject({ restored: 1 });
  });

  it('#466 B late completion: T1 waits on the shop lock held by a merchant write and never claims after it', async () => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    let entered!: () => void;
    let release!: () => void;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.beforeSet = async () => {
      entered();
      await gate;
    };
    const merchant = f.restart().publications.advance(f.identity.shopId, f.identity.configId, f.identity.operationId);
    await inside; // the merchant's public_config write is in flight; advance holds the shop lock
    let workerDone = false;
    const worker = f
      .abandonment()
      .runPass({ shopId: f.identity.shopId })
      .finally(() => {
        workerDone = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(workerDone).toBe(false);
    release();
    expect((await merchant).kind).toBe('PENDING');
    // T1 saw the committed shop-config-written phase: product fields may follow, so it never claims.
    expect(await worker).toMatchObject({ restored: 0 });
    f.beforeSet = undefined;
    expect(await progressPhase(f)).toBe('shop-config-written');
    expect((await activationRow(f))?.kind).not.toMatch(/^ABANDON/);
    expect(f.providerWrites).toEqual(['DRAFT']);
  });

  it('#466 B: two workers claim and restore once', async () => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    const [a, b] = await Promise.all([
      f.abandonment().runPass({ shopId: f.identity.shopId }),
      f.abandonment().runPass({ shopId: f.identity.shopId }),
    ]);
    expect(a.restored + b.restored).toBe(1);
    expect(f.providerWrites).toEqual(['DRAFT', 'ACTIVE']);
    expect(await progressPhase(f)).toBe('abandoned');
  });

  it('#466 B: an ambiguous restore goes to OPERATOR_HOLD and is never retried', async () => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    f.failMutation = true;
    expect(await f.abandonment().runPass({ shopId: f.identity.shopId })).toMatchObject({ restored: 0, flagged: 1 });
    expect(await activationRow(f)).toMatchObject({
      kind: 'OPERATOR_HOLD',
      hold: { restorationReceipt: { kind: 'RESTORATION_PENDING' } },
    });
    expect((await auditRows(f)).map((r) => r.event)).toEqual(['CLAIMED', 'RECEIPT', 'FLAGGED']);
    expect(await f.abandonment({ claimStaleMs: 0 }).runPass({ shopId: f.identity.shopId })).toMatchObject({
      restored: 0,
      flagged: 0,
    });
    expect(f.providerWrites).toEqual(['DRAFT', 'lost:ACTIVE']);
  });

  it('#466 B: one retry of a no-current NOT_DISPATCHED, then OPERATOR_HOLD after the stale bound', async () => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    f.failProviderRead(1);
    await f.abandonment().runPass({ shopId: f.identity.shopId });
    f.failProviderRead(0); // the rearmed attempt's pre-write read fails the same way
    expect(await f.abandonment().runPass({ shopId: f.identity.shopId })).toMatchObject({ restored: 0, flagged: 0 });
    expect((await activationRow(f))?.kind).toBe('ABANDON_CLAIMED');
    expect(await f.abandonment().runPass({ shopId: f.identity.shopId })).toMatchObject({ restored: 0, flagged: 0 });
    expect(await f.abandonment({ claimStaleMs: 0 }).runPass({ shopId: f.identity.shopId })).toMatchObject({
      flagged: 1,
    });
    expect((await activationRow(f))?.kind).toBe('OPERATOR_HOLD');
    expect((await auditRows(f)).at(-1)).toMatchObject({ event: 'FLAGGED', detail: { reasons: ['claim_unsettled'] } });
    expect(f.providerWrites).toEqual(['DRAFT']);
    const consumed =
      await sql`SELECT FROM m5_restoration_no_dispatch_consumptions WHERE shop_id=${f.identity.shopId}`.execute(
        database,
      );
    expect(consumed.rows).toHaveLength(1);
  });

  it('#466 B: a crash after the restore was dispatched leaves the claim, which goes stale and is never replayed', async () => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    afterSql = (text) => {
      if (text.startsWith('UPDATE m5_activation_state SET hold=')) throw new Error('crash before the receipt commits');
    };
    try {
      expect(await f.abandonment().runPass({ shopId: f.identity.shopId })).toMatchObject({ restored: 0 });
    } finally {
      afterSql = undefined;
    }
    expect(f.providerWrites).toEqual(['DRAFT', 'ACTIVE']);
    expect(await activationRow(f)).toMatchObject({ kind: 'ABANDON_CLAIMED' });
    expect((await activationRow(f))?.hold).not.toHaveProperty('restorationReceipt');
    expect(await f.abandonment().runPass({ shopId: f.identity.shopId })).toMatchObject({ restored: 0, flagged: 0 });
    expect(await f.abandonment({ claimStaleMs: 0 }).runPass({ shopId: f.identity.shopId })).toMatchObject({
      restored: 0,
      flagged: 1,
    });
    expect((await activationRow(f))?.kind).toBe('OPERATOR_HOLD');
    expect(f.providerWrites).toEqual(['DRAFT', 'ACTIVE']);
  });

  it('#466 B: a reinstall between claim and restore fences the claim without a dispatch', async () => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    f.failProviderRead(1);
    await f.abandonment().runPass({ shopId: f.identity.shopId });
    await sql`UPDATE installation_generations SET deactivated_at=now() WHERE shop_id=${f.identity.shopId}`.execute(
      database,
    );
    expect(await f.abandonment().runPass({ shopId: f.identity.shopId })).toMatchObject({ restored: 0, flagged: 1 });
    expect((await auditRows(f)).at(-1)).toMatchObject({ event: 'FLAGGED', detail: { reasons: ['claim_fenced'] } });
    expect(f.providerWrites).toEqual(['DRAFT']);
  });

  it('#466 B: an observed different product is flagged; the operator claim then gives a second FLAGGED row', async () => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    f.providerProductStatus = 'ARCHIVED';
    expect(await f.abandonment().runPass({ shopId: f.identity.shopId })).toMatchObject({ flagged: 1, restored: 0 });
    f.providerProductStatus = 'DRAFT';
    const version = Number((await activationRow(f))?.version);
    await sql`SELECT m5_operator_claim_abandoned_hold(${f.identity.shopId}, ${f.identity.configId}, ${f.identity.operationId},
      ${version}, 'cmd-1', ${'d'.repeat(64)})`.execute(database);
    expect(await activationRow(f)).toMatchObject({
      kind: 'ABANDON_CLAIMED',
      hold: { abandonmentClaim: { authority: 'SETTLED_BY_TRUSTED_OPERATOR', commandKey: 'cmd-1' } },
    });
    await sql`UPDATE installation_generations SET deactivated_at=now() WHERE shop_id=${f.identity.shopId}`.execute(
      database,
    );
    await f.abandonment().runPass({ shopId: f.identity.shopId });
    const audit = await auditRows(f);
    expect(audit.map((r) => [r.event, r.detail])).toEqual([
      ['FLAGGED', { reasons: ['product_changed'] }],
      ['CLAIMED', {}],
      ['FLAGGED', { reasons: ['claim_fenced'] }],
    ]);
    expect(new Set(audit.map((r) => r.activation_version)).size).toBe(3);
  });

  it('#466 B: trigger table — claims, receipts, terminal states and immutability', async () => {
    const f = await fixture('required', 'ACTIVE');
    // Without an activation row (nothing held yet) nothing is frozen.
    await sql`UPDATE m4_publication_progress SET retry_count=1, version=version+1 WHERE shop_id=${f.identity.shopId}`.execute(
      database,
    );
    await f.prepareHold();
    await expect(
      sql`UPDATE m4_publication_progress SET phase='abandoned', version=version+1 WHERE shop_id=${f.identity.shopId}`.execute(
        database,
      ),
    ).rejects.toThrow('requires a restored abandoned hold');
    await expect(
      sql`UPDATE publication_operations SET status='failed', failed_at=now(), failure_class='publication-abandoned'
        WHERE shop_id=${f.identity.shopId}`.execute(database),
    ).rejects.toThrow('requires a restored abandoned hold');
    // An operator authority from HELD, or a claim with a settled digest, is rejected.
    await expect(directClaim(f, 'SETTLED_BY_TRUSTED_OPERATOR')).rejects.toThrow();
    await directClaim(f);
    await expect(
      sql`UPDATE m5_activation_state SET hold=jsonb_set(hold,'{abandonmentClaim,claimedAt}','"2026-11-14T12:11:00.000Z"'),
        version=version+1 WHERE shop_id=${f.identity.shopId}`.execute(database),
    ).rejects.toThrow('immutable');
    await expect(
      sql`UPDATE m5_activation_state SET kind='ABANDON_RESTORED', version=version+1 WHERE shop_id=${f.identity.shopId}`.execute(
        database,
      ),
    ).rejects.toThrow('settled RESTORED receipt');
    await expect(
      sql`UPDATE m5_activation_state SET kind='HELD', version=version+1 WHERE shop_id=${f.identity.shopId}`.execute(
        database,
      ),
    ).rejects.toThrow('invalid activation state transition');
    await expect(
      sql`UPDATE m5_publication_abandonment_audit SET detail='{}' WHERE shop_id=${f.identity.shopId}`.execute(database),
    ).rejects.toThrow('append-only');
    await expect(
      sql`DELETE FROM m5_publication_abandonment_audit WHERE shop_id=${f.identity.shopId}`.execute(database),
    ).rejects.toThrow('append-only');
  });

  it('#466 B: runtime roles cannot claim from OPERATOR_HOLD, run the operator function or read the audit', async () => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    await sql`UPDATE m5_activation_state SET kind='OPERATOR_HOLD', version=version+1 WHERE shop_id=${f.identity.shopId}`.execute(
      database,
    );
    const version = Number((await activationRow(f))?.version);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();
    const runtime = `abandon_runtime_${randomUUID().replaceAll('-', '')}`;
    const operator = `abandon_operator_${randomUUID().replaceAll('-', '')}`;
    try {
      await client.query('BEGIN');
      await client.query(`CREATE ROLE ${runtime} NOLOGIN`);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${runtime}`);
      await client.query(
        `GRANT SELECT, UPDATE ON public.m5_activation_state, public.m4_publication_progress, public.publication_operations,
          public.product_configs, public.shops, public.installation_generations TO ${runtime}`,
      );
      await client.query(`CREATE ROLE ${operator} NOLOGIN IN ROLE insignia_publication_operator`);
      await client.query(`SET LOCAL ROLE ${runtime}`);
      const access = await client.query(
        `SELECT has_table_privilege(current_user,'public.m5_publication_abandonment_audit','SELECT,INSERT,UPDATE,DELETE') AS audit,
          has_function_privilege(current_user,'public.m5_operator_claim_abandoned_hold(text,text,text,bigint,text,text)','EXECUTE') AS fn`,
      );
      expect(access.rows[0]).toEqual({ audit: false, fn: false });
      await client.query('SAVEPOINT direct');
      await expect(
        client.query(
          `UPDATE public.m5_activation_state a SET kind='ABANDON_CLAIMED', version=a.version+1, hold=a.hold||jsonb_build_object(
            'abandonmentClaim',jsonb_build_object('version','m5-publication-abandonment-claim-v1','operationId',a.operation_id,
              'scope',a.hold#>'{before,scope}','productId',a.hold#>>'{before,productId}','authority','SETTLED_BY_TRUSTED_OPERATOR',
              'quietSince','2026-11-14T12:00:00.000Z','claimedAt','2026-11-14T12:10:00.000Z','commandKey','k','inspectDigest',$2::text),
            'restorationClaim',jsonb_build_object('version','m5-availability-restoration-claim-v3','operationId',a.operation_id,
              'scope',a.hold#>'{before,scope}','productId',a.hold#>>'{before,productId}','restoreReserved',true,'compensationReserved',true))
          WHERE a.shop_id=$1`,
          [f.identity.shopId, 'e'.repeat(64)],
        ),
      ).rejects.toThrow('requires the operator function');
      await client.query('ROLLBACK TO SAVEPOINT direct');
      await client.query('RESET ROLE');
      await client.query(`SET LOCAL ROLE ${operator}`);
      const claimed = await client.query(
        'SELECT public.m5_operator_claim_abandoned_hold($1,$2,$3,$4,$5,$6) AS version',
        [f.identity.shopId, f.identity.configId, f.identity.operationId, version, 'cmd-2', 'e'.repeat(64)],
      );
      expect(Number(claimed.rows[0]?.version)).toBe(version + 1);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  });

  it('#466 B: the worker role from queue-roles.sql runs a whole pass; it cannot reach the audit', async () => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    const role = `abandon_worker_${randomUUID().replaceAll('-', '')}`;
    const grants = (await readFile(new URL('../../../scripts/worker/queue-roles.sql', import.meta.url), 'utf8'))
      .split('-- Existing M3 uninstall/credential consumers, through the reviewed durable repositories.')[1]!
      .replace(/\nCOMMIT;\s*$/, '')
      .replaceAll('insignia_queue_consume', role);
    const owner = new Pool({ connectionString: process.env.DATABASE_URL });
    await owner.query(`CREATE ROLE ${role} NOLOGIN`);
    await owner.query(grants);
    const workerPool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c role=${role}` });
    const worker = createDurableCore(workerPool);
    try {
      const denied = await workerPool.query(
        `SELECT has_table_privilege(current_user,'public.m5_publication_abandonment_audit','SELECT') AS audit`,
      );
      expect(denied.rows[0]?.audit).toBe(false);
      const errors: unknown[] = [];
      const pass = await f
        .abandonment({ onRowError: (error) => errors.push(error) }, worker)
        .runPass({ shopId: f.identity.shopId });
      expect(errors).toEqual([]);
      expect(pass).toMatchObject({ restored: 1, finalized: 1 });
      expect(await progressPhase(f)).toBe('abandoned');
      expect(f.providerWrites).toEqual(['DRAFT', 'ACTIVE']);
    } finally {
      await worker.close();
      await owner.query(`DROP OWNED BY ${role}; DROP ROLE ${role}`);
      await owner.end();
    }
  });

  it('#466 B structural: product fields are dispatched only from a committed phase past prepared, by advance only', async () => {
    // Source boundary: the only provider write of registration/policy is PgProductionPublication.advance.
    const root = new URL('../../../', import.meta.url);
    const { readdir } = await import('node:fs/promises');
    const sources: string[] = [];
    const walk = async (dir: URL) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (['node_modules', 'dist', 'test', '.astro'].includes(entry.name)) continue;
        const next = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
        if (entry.isDirectory()) await walk(next);
        else if (/\.(ts|tsx|mts)$/.test(entry.name) && !/\.test\./.test(entry.name)) sources.push(next.pathname);
      }
    };
    for (const scope of ['apps/web/src/', 'apps/worker/src/', 'packages/database/src/', 'packages/application/src/'])
      await walk(new URL(scope, root));
    const writers: string[] = [];
    for (const file of sources) {
      const text = await readFile(file, 'utf8');
      if (/remote\.set\(/.test(text)) writers.push(file.slice(root.pathname.length));
      if (!file.endsWith('repositories/production-publication.ts'))
        expect([file, /field:\s*'(registration|policy)'[^}]*value:/.test(text)]).toEqual([file, false]);
    }
    expect(writers).toEqual(['packages/database/src/repositories/production-publication.ts']);
    const publication = await readFile(
      new URL('packages/database/src/repositories/production-publication.ts', root),
      'utf8',
    );
    expect(publication.indexOf('this.remote.set(')).toBeGreaterThan(publication.indexOf('  async advance('));

    // Runtime: through the real composition, record the committed phase at every dispatch, for a
    // first publication and a mode change (all phases), and count every set and restore.
    const f = await fixture('required');
    await f.prepareHold();
    await f.publish();
    await f.restart().advance(f.identity);
    expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVE');
    const second = { ...f.identity, operationId: randomUUID() };
    const revision = randomUUID();
    await f.createRevision(revision, 'optional');
    await f.restart().publications.prepare({ ...second, revisionId: revision, mode: 'optional' });
    await f.restart().advance(second);
    await f.restart().advance(second);
    await f.publish(second);
    expect(f.dispatches.map((d) => d.field)).toEqual([
      'public_config',
      'registration',
      'policy',
      'registration',
      'registration',
      'policy',
      'registration',
    ]);
    for (const dispatch of f.dispatches.slice(0, 4))
      if (dispatch.field !== 'public_config') expect(dispatch.committedPhase).not.toBe('prepared');
    expect(f.dispatches[0]?.committedPhase).toBe('prepared');
    expect(f.remoteWrites).toBe(f.dispatches.length);
    expect(f.restores).toBe(1);
  });

  it('#466 test 13: every writer of publication progress and operation rows holds the shop lock', async () => {
    shopLockAudit = [];
    try {
      const f = await fixture('required', 'ACTIVE');
      await f.prepareHold();
      await f.publish();
      await f.restart().advance(f.identity);
      expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVE');
      // Drift writes operator-hold through advance; activation records evidence; the worker finalizes.
      const second = { ...f.identity, operationId: randomUUID() };
      const revision = randomUUID();
      await f.createRevision(revision, 'optional');
      await f.restart().publications.prepare({ ...second, revisionId: revision, mode: 'optional' });
      await f.restart().advance(second);
      await f.restart().advance(second);
      expect(await f.abandonment().runPass({ shopId: f.identity.shopId })).toMatchObject({ finalized: 1 });
      const audit = shopLockAudit;
      expect(audit.length).toBeGreaterThan(8);
      expect(audit.filter((entry) => !entry.locked)).toEqual([]);
    } finally {
      shopLockAudit = undefined;
    }
  });

  it('#466 B: a stale activated RESTORATION_CLAIMED with a consumed no-current receipt goes to the operator', async () => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    await f.publish();
    expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVATED_RESTORATION_PENDING');
    f.failProviderRead(1);
    await f.freshProviderRestart().advance(f.identity);
    f.failProviderRead(1);
    await f.freshProviderRestart().advance(f.identity);
    expect(await f.abandonment().runPass({ shopId: f.identity.shopId })).toMatchObject({ flagged: 0 });
    expect(await f.abandonment({ claimStaleMs: 0 }).runPass({ shopId: f.identity.shopId })).toMatchObject({
      flagged: 1,
      restored: 0,
    });
    expect((await activationRow(f))?.kind).toBe('OPERATOR_HOLD');
    expect(await auditRows(f)).toMatchObject([
      { event: 'FLAGGED', from_kind: 'RESTORATION_CLAIMED', detail: { reasons: ['claim_unsettled'] } },
    ]);
    expect(f.providerWrites).toEqual(['DRAFT']);
  });

  it('a crash after compensation leaves the committed v3 claim and never replays either write', async () => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    await f.publish();
    await f.restart().advance(f.identity);
    const evidence = (await f.restart().read(f.identity))?.evidence;
    f.restoreMismatch = true;
    let updates = 0;
    afterSql = (text) => {
      if (text.startsWith('UPDATE m5_activation_state') && ++updates === 2)
        throw new Error('crash after compensation before receipt commit');
    };
    try {
      await expect(f.freshProviderRestart().advance(f.identity)).rejects.toThrow('crash after compensation');
    } finally {
      afterSql = undefined;
    }
    const state = (await f.restart().read(f.identity))?.state;
    expect(state?.kind).toBe('RESTORATION_CLAIMED');
    expect(state?.hold).toMatchObject({ restorationClaim: { restoreReserved: true, compensationReserved: true } });
    expect(state?.hold).not.toHaveProperty('restorationReceipt');
    expect(f.providerWrites).toEqual(['DRAFT', 'ACTIVE', 'DRAFT']);
    expect((await f.freshProviderRestart().advance(f.identity)).kind).toBe('ACTIVATED_RESTORATION_PENDING');
    expect(f.providerWrites).toEqual(['DRAFT', 'ACTIVE', 'DRAFT']);
    expect((await f.restart().read(f.identity))?.evidence).toEqual(evidence);
  });

  it('v3 hold/evidence/restoration audit JSONB roundtrips, remains immutable, and rejects v1 decision semantics', async () => {
    const f = await fixture('required', 'ACTIVE');
    await f.prepareHold();
    const held = (await f.restart().read(f.identity))?.state.hold;
    expect(held).toMatchObject({
      version: 'm5-availability-hold-v3',
      before: { version: 'm5-product-availability-snapshot-v3' },
      acquisitionAcknowledgement: {
        version: 'm5-availability-mutation-ack-v3',
        providerUpdatedAt: '2026-10-01T11:01:00.000Z',
      },
    });
    await expect(
      sql`UPDATE m5_activation_state SET hold=jsonb_set(hold,'{acquisitionAcknowledgement,providerUpdatedAt}','"2026-10-01T11:59:00.000Z"'::jsonb),version=version+1 WHERE shop_id=${f.identity.shopId}`.execute(
        database,
      ),
    ).rejects.toThrow('v3 availability audit is immutable');
    await f.publish();
    await f.restart().advance(f.identity);
    await f.restart().advance(f.identity);
    const record = await f.restart().read(f.identity);
    expect(record?.evidence).toMatchObject({ version: 'm5-activation-evidence-v3', decisionVersion: 3, hold: held });
    expect(record?.state.hold).toMatchObject({
      restorationReceipt: {
        version: 'm5-availability-restoration-receipt-v3',
        kind: 'RESTORED',
        acknowledgement: { providerUpdatedAt: '2026-10-01T11:02:00.000Z' },
        current: { providerUpdatedAt: '2026-10-01T11:02:00.000Z' },
      },
    });
    await expect(
      sql`UPDATE m5_activation_state SET hold=jsonb_set(hold,'{restorationReceipt,kind}','"CONFLICT"'::jsonb),version=version+1 WHERE shop_id=${f.identity.shopId}`.execute(
        database,
      ),
    ).rejects.toThrow('v3 availability audit is immutable');
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
    const insert = (value: unknown, executor = database) =>
      sql`INSERT INTO m5_activation_evidence(shop_id,config_id,operation_id,revision_id,installation_generation,operation_sequence,authorization_generation,authorization_epoch,selected_key_id,evidence_digest,evidence) VALUES (${other.identity.shopId},${other.identity.configId},${other.identity.operationId},${other.revisionId},1,1,${other.scope.authorizationGeneration}::uuid,${other.scope.authorizationEpoch},7,${activationDigest(value)},${JSON.stringify(value)}::jsonb)`.execute(
        executor,
      );
    await expect(insert({ ...evidence, decisionVersion: 1 })).rejects.toThrow('m5_014_evidence_identity');
    if (!base.hold || base.hold.version !== 'm5-availability-hold-v3' || !base.hold.held || !base.holdObservation)
      throw new Error('expected v3 held evidence');
    const nestedScope = {
      ...base.hold.before.scope,
      shopId: other.identity.shopId,
      shopifyShopId: `gid://shopify/Shop/${other.scope.shopifyShopId}`,
    };
    const before = { ...base.hold.before, scope: nestedScope };
    const nestedHeld = { ...base.hold.held, scope: nestedScope };
    if (!base.hold.acquisitionAcknowledgement) throw new Error('expected acquisition audit');
    const nestedAcknowledgement = { ...base.hold.acquisitionAcknowledgement, scope: nestedScope };
    const nestedHold = {
      ...base.hold,
      operationId: other.identity.operationId,
      before,
      held: nestedHeld,
      acquisitionAcknowledgement: nestedAcknowledgement,
    };
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
      { ...nestedEvidence, holdObservation: { ...nestedHeld, anchorDigest: '0'.repeat(64) } },
    ])
      await expect(insert(mixed)).rejects.toThrow('m5_017_evidence_v3_hold');
    await expect(
      insert(
        JSON.parse(JSON.stringify(nestedEvidence).replaceAll('gid://shopify/Product/42', 'gid://shopify/Product/999')),
      ),
    ).rejects.toThrow('v3 availability product binding');
    // Verify the counterexamples differ from a database-accepted v3 record.
    await expect(
      database.transaction().execute(async (transaction) => {
        await insert(nestedEvidence, transaction);
        throw new Error('rollback accepted v3 evidence');
      }),
    ).rejects.toThrow('rollback accepted v3 evidence');
    for (const invalidAcknowledgement of [
      { ...nestedAcknowledgement, version: 'm5-availability-mutation-ack-v1' },
      { ...nestedAcknowledgement, scope: base.hold.before.scope },
      { ...nestedAcknowledgement, productId: 'gid://shopify/Product/999' },
      { ...nestedAcknowledgement, state: 'available' },
      { ...nestedAcknowledgement, providerUpdatedAt: 123 },
    ])
      await expect(
        insert({ ...nestedEvidence, hold: { ...nestedHold, acquisitionAcknowledgement: invalidAcknowledgement } }),
      ).rejects.toThrow('m5_017_evidence_v3_hold');
    const restorationReceipt = {
      version: 'm5-availability-restoration-receipt-v3',
      kind: 'RESTORATION_PENDING',
      acknowledgement: { ...nestedAcknowledgement, state: before.state },
      current: before,
    };
    for (const invalidReceipt of [
      { ...restorationReceipt, version: 'm5-availability-restoration-receipt-v1' },
      {
        ...restorationReceipt,
        acknowledgement: { ...restorationReceipt.acknowledgement, scope: base.hold.before.scope },
      },
      { ...restorationReceipt, current: { ...before, version: 'm5-product-availability-snapshot-v1' } },
    ])
      await expect(
        insert({
          ...nestedEvidence,
          hold: {
            ...nestedHold,
            restorationClaim: {
              version: 'm5-availability-restoration-claim-v3',
              scope: nestedScope,
              productId: before.productId,
              operationId: other.identity.operationId,
              restoreReserved: true,
              compensationReserved: true,
            },
            restorationReceipt: invalidReceipt,
          },
        }),
      ).rejects.toThrow('m5_017_evidence_v3_hold');
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
    const beforeRetry = await f.restart().read(f.identity);
    const retried = await f.restart().advance(f.identity);
    if (ms < 0) {
      // The new fresh-release gate rejects backwards time before the adapter.
      expect(retried.kind).toBe('ACTIVATED_RESTORATION_PENDING');
      expect((await f.restart().read(f.identity))?.state.hold).toEqual(beforeRetry?.state.hold);
    }
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

  it('#446: a throttled observation right after the hold mutation commits HELD, and the publication resumes', async () => {
    const f = await fixture();
    expect((await f.restart().advance(f.identity)).kind).toBe('WAITING_HOLD');
    f.observeFailures = 1;
    // Before the fix the transaction rolled back to ACQUISITION_PENDING with the product Draft.
    expect((await f.restart().advance(f.identity)).kind).toBe('HELD');
    const held = await f.restart().read(f.identity);
    expect(held?.state).toMatchObject({
      kind: 'HELD',
      hold: { held: { state: 'unavailable' }, acquisitionAcknowledgement: { state: 'unavailable' } },
    });
    f.observeFailures = 1;
    await expect(f.restart().advance(f.identity)).rejects.toThrow(/Availability provider unavailable/);
    expect((await f.restart().read(f.identity))?.state.kind).toBe('HELD');
    await f.publish();
    expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVATED_RESTORATION_PENDING');
    expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVE');
    expect(f.acquisitions).toBe(1);
    expect(f.restores).toBe(1);
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
  it('SQL denies a successful held record with unsupported legacy false original but retains unheld incident evidence', async () => {
    const f = await fixture();
    await f.prepareHold();
    const hold = (await f.restart().read(f.identity))?.state.hold;
    if (hold?.version !== 'm5-availability-hold-v3') throw new Error('expected v3');
    const unsupported = {
      publicationId: 'gid://shopify/Publication/999',
      isPublished: false,
      publishDate: '2099-01-01T00:00:00.000Z',
    };
    const unsupportedLegacy = {
      ...hold,
      before: {
        ...hold.before,
        effectiveVisibility: {
          ...hold.before.effectiveVisibility,
          publicationEvidence: [...hold.before.effectiveVisibility.publicationEvidence, unsupported],
        },
        visibleScheduledOrStaged: [unsupported],
      },
    };
    const admits = async (value: unknown) =>
      (
        await sql<{ admitted: boolean }>`SELECT m5_v3_hold(${JSON.stringify(value)}::jsonb) AS admitted`.execute(
          database,
        )
      ).rows[0]!.admitted;
    expect(await admits(unsupportedLegacy)).toBe(false);
    expect(await admits({ ...unsupportedLegacy, held: null })).toBe(true);
    const onlineStore = { publishedAtPresent: true, urlPresent: true };
    const visibleDraft = {
      ...hold,
      before: {
        ...hold.before,
        state: 'unavailable' as const,
        effectiveVisibility: {
          ...hold.before.effectiveVisibility,
          onlineStore,
          publishedAt: '2026-10-01T11:00:00.000Z',
          onlineStoreUrl: 'https://synthetic.example/products/fixture',
        },
        effectiveDigest: activationDigest({
          publishedPublicationIds: hold.before.effectiveVisibility.publishedPublicationIds,
          onlineStore,
        }),
      },
    };
    expect(await admits(visibleDraft)).toBe(false);
    expect(await admits({ ...visibleDraft, held: null })).toBe(true);
  });
  it('SQL requires owned held evidence for restoration success and retains unheld incidents', async () => {
    const f = await fixture();
    await f.prepareHold();
    const hold = (await f.restart().read(f.identity))?.state.hold;
    if (hold?.version !== 'm5-availability-hold-v3' || !hold.held || !hold.acquisitionAcknowledgement)
      throw new Error('expected acquired v3');
    const unsupported = {
      publicationId: 'gid://shopify/Publication/999',
      isPublished: false,
      publishDate: '2099-01-01T00:00:00.000Z',
    };
    const draft = hold.held;
    const incident = {
      ...hold,
      before: draft,
      held: null,
      acquisitionAcknowledgement: {
        ...hold.acquisitionAcknowledgement,
        effectiveVisibility: {
          ...hold.acquisitionAcknowledgement.effectiveVisibility,
          publicationEvidence: [unsupported],
        },
      },
      restorationClaim: {
        version: 'm5-availability-restoration-claim-v3',
        operationId: hold.operationId,
        scope: draft.scope,
        productId: draft.productId,
        restoreReserved: true,
        compensationReserved: true,
      },
    };
    const receipt = {
      version: 'm5-availability-restoration-receipt-v3',
      kind: 'RESTORED',
      acknowledgement: null,
      current: draft,
    };
    const admits = async (value: unknown) =>
      (
        await sql<{ admitted: boolean }>`SELECT m5_v3_hold(${JSON.stringify(value)}::jsonb) AS admitted`.execute(
          database,
        )
      ).rows[0]!.admitted;
    expect(await admits(incident)).toBe(true);
    expect(await admits({ ...incident, restorationReceipt: receipt })).toBe(false);
    expect(await admits({ ...incident, restorationReceipt: { ...receipt, kind: 'CONFLICT' } })).toBe(true);
    const { acquisitionAcknowledgement: _ack, ...clean } = incident;
    expect(await admits({ ...clean, restorationReceipt: receipt })).toBe(false);
    expect(await admits({ ...clean, held: draft, restorationReceipt: receipt })).toBe(true);
    const owned = { ...clean, held: draft };
    const qualifiedAck = hold.acquisitionAcknowledgement;
    const unsupportedAck = incident.acquisitionAcknowledgement;
    expect(await admits({ ...owned, restorationReceipt: { ...receipt, acknowledgement: qualifiedAck } })).toBe(true);
    expect(await admits({ ...owned, restorationReceipt: { ...receipt, acknowledgement: unsupportedAck } })).toBe(false);
    expect(
      await admits({ ...owned, restorationReceipt: { ...receipt, kind: 'CONFLICT', acknowledgement: unsupportedAck } }),
    ).toBe(true);

    const unsupportedLegacy = {
      ...draft,
      effectiveVisibility: { ...draft.effectiveVisibility, publicationEvidence: [unsupported] },
      visibleScheduledOrStaged: [unsupported],
    };
    expect(
      await admits({
        ...clean,
        before: unsupportedLegacy,
        restorationReceipt: { ...receipt, current: unsupportedLegacy },
      }),
    ).toBe(false);
  });
  it('SQL rejects unsupported legacy false ACK success while retaining settled conflict audits', async () => {
    const f = await fixture();
    await f.prepareHold();
    const held = (await f.restart().read(f.identity))?.state.hold;
    if (!held || held.version !== 'm5-availability-hold-v3' || !held.acquisitionAcknowledgement)
      throw new Error('expected held v3');
    const unsupportedLegacy = (ack: NonNullable<typeof held.acquisitionAcknowledgement>) => ({
      ...ack,
      effectiveVisibility: {
        ...ack.effectiveVisibility,
        publicationEvidence: [
          ...ack.effectiveVisibility.publicationEvidence,
          {
            publicationId: 'gid://shopify/Publication/999',
            isPublished: false,
            publishDate: '2099-01-01T00:00:00.000Z',
          },
        ],
      },
    });
    const admits = async (hold: unknown) =>
      (
        await sql<{ admitted: boolean }>`SELECT m5_v3_hold(${JSON.stringify(hold)}::jsonb) AS admitted`.execute(
          database,
        )
      ).rows[0]!.admitted;
    expect(await admits(held)).toBe(true);
    expect(
      await admits({ ...held, acquisitionAcknowledgement: unsupportedLegacy(held.acquisitionAcknowledgement) }),
    ).toBe(false);
    expect(
      await admits({
        ...held,
        held: null,
        acquisitionAcknowledgement: unsupportedLegacy(held.acquisitionAcknowledgement),
      }),
    ).toBe(true);
    expect(
      await admits({
        ...held,
        before: held.held,
        acquisitionAcknowledgement: unsupportedLegacy(held.acquisitionAcknowledgement),
      }),
    ).toBe(false);
    await f.publish();
    await f.restart().advance(f.identity);
    await f.restart().advance(f.identity);
    const restored = (await f.restart().read(f.identity))?.state.hold;
    if (!restored || restored.version !== 'm5-availability-hold-v3' || !restored.restorationReceipt?.acknowledgement)
      throw new Error('expected restored v3');
    const receipt = {
      ...restored.restorationReceipt,
      acknowledgement: unsupportedLegacy(restored.restorationReceipt.acknowledgement),
    };
    expect(await admits({ ...restored, restorationReceipt: receipt })).toBe(false);
    expect(await admits({ ...restored, restorationReceipt: { ...receipt, kind: 'CONFLICT' } })).toBe(true);
  });
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
    await expect(f.restart().recover(request)).rejects.toThrow(/Original (v[23] )?availability not observed/);
    const evidence = (await f.restart().read(f.identity))?.evidence;
    f.simulateExternalOriginalState();
    const resolution = await f.restart().recover(request);
    expect((await f.restart().read(f.identity))?.state.kind).toBe('RESTORED');
    expect((await f.restart().read(f.identity))?.evidence).toEqual(evidence);
    expect((await f.restart().advance(f.identity)).kind).toBe('ACTIVE');
    expect(f.restores).toBe(1);
    if (resolution.version !== 'm5-availability-resolution-v3' || !resolution.originalHold.held)
      throw new Error('expected complete v3 recovery audit');
    const other = await fixture();
    const nestedScope = {
      ...resolution.originalHold.before.scope,
      shopId: other.identity.shopId,
      shopifyShopId: `gid://shopify/Shop/${other.scope.shopifyShopId}`,
    };
    const originalHold = {
      ...resolution.originalHold,
      operationId: other.identity.operationId,
      before: { ...resolution.originalHold.before, scope: nestedScope },
      held: { ...resolution.originalHold.held, scope: nestedScope },
      acquisitionAcknowledgement: {
        version: 'm5-availability-mutation-ack-v3' as const,
        scope: nestedScope,
        productId: resolution.originalHold.before.productId,
        state: 'unavailable' as const,
        providerUpdatedAt: resolution.originalHold.held.providerUpdatedAt,
        effectiveVisibility: resolution.originalHold.held.effectiveVisibility,
        observedAt: resolution.originalHold.held.observedAt,
        receivedAt: resolution.originalHold.held.receivedAt,
      },
      restorationClaim: resolution.originalHold.restorationClaim && {
        ...resolution.originalHold.restorationClaim,
        scope: nestedScope,
        operationId: other.identity.operationId,
      },
      restorationReceipt: resolution.originalHold.restorationReceipt && {
        ...resolution.originalHold.restorationReceipt,
        acknowledgement: resolution.originalHold.restorationReceipt.acknowledgement && {
          ...resolution.originalHold.restorationReceipt.acknowledgement,
          scope: nestedScope,
        },
        current: resolution.originalHold.restorationReceipt.current && {
          ...resolution.originalHold.restorationReceipt.current,
          scope: nestedScope,
        },
      },
    };
    const observed = { ...resolution.observed, scope: nestedScope };
    const context = {
      ...other.identity,
      commandKey: 'resolution-json-guard',
      currentScope: nestedScope,
      hold: originalHold,
      observed,
    };
    const nestedResolution = {
      ...resolution,
      ...other.identity,
      commandKey: context.commandKey,
      currentScope: nestedScope,
      originalHold,
      observed,
      reviewedObservation: observed,
      activationEvidenceDigest: null,
      decision: await syntheticRecoveryAuthority().read(context),
    };
    const insert = (value: unknown, executor = database) =>
      sql`INSERT INTO m5_availability_resolutions(shop_id,config_id,operation_id,command_key,resolution_digest,resolution) VALUES (${other.identity.shopId},${other.identity.configId},${other.identity.operationId},${context.commandKey},${activationDigest(value)},${JSON.stringify(value)}::jsonb)`.execute(
        executor,
      );
    await expect(
      database.transaction().execute(async (transaction) => {
        await insert(nestedResolution, transaction);
        throw new Error('rollback accepted v3 resolution');
      }),
    ).rejects.toThrow('rollback accepted v3 resolution');
    for (const invalidHold of [
      { ...originalHold, held: { ...originalHold.held, version: 'm5-product-availability-snapshot-v1' } },
      { ...originalHold, held: { ...originalHold.held, scope: resolution.originalHold.before.scope } },
      { ...originalHold, held: { ...originalHold.held, anchorDigest: '0'.repeat(64) } },
      {
        ...originalHold,
        acquisitionAcknowledgement: { ...originalHold.acquisitionAcknowledgement, version: 'unsupported-ack' },
      },
      {
        ...originalHold,
        acquisitionAcknowledgement: {
          ...originalHold.acquisitionAcknowledgement,
          scope: resolution.originalHold.before.scope,
        },
      },
      { ...originalHold, restorationReceipt: { ...originalHold.restorationReceipt, version: 'unsupported-receipt' } },
    ])
      await expect(insert({ ...nestedResolution, originalHold: invalidHold })).rejects.toThrow(
        'm5_014_resolution_version',
      );
    expect(await f.restart().recover(request)).toEqual(resolution);
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
      /Original (v[23] )?availability not observed/,
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
        context.hold.version === 'm5-availability-hold-v3'
          ? 'm5-availability-recovery-decision-v3'
          : context.hold.version === 'm5-availability-hold-v2'
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
