import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import type { ExpectedFunctionBuild, FunctionArtifactIdentity } from '@insignia/application';
import { SigningKeyLifecycle } from '@insignia/application';
import { createDurableCore, type DurableCore } from '@insignia/database';
import { createObservability, type PublicationTimingDiagnostic } from '@insignia/observability';
import {
  createShopifyAvailabilityHoldV3Port,
  PublicationAdminError,
  resolveRuntimeReleaseProfile,
} from '@insignia/shopify';
import { Pool } from 'pg';
import { adminAuthorityExpiry } from '../../src/server/admin/auth.ts';
import type { AdminActor } from '../../src/server/admin/contracts.ts';
import { handleAdminRequest } from '../../src/server/admin/http.ts';
import {
  createPublicationReleaseRefresh,
  lastingReleaseRecords,
  PUBLICATION_RELEASE_REFRESH_AFTER_MS,
  PUBLICATION_RELEASE_REFRESH_INTERVAL_MS,
  PUBLICATION_STEP_RELEASE_LEAD_MS,
} from '../../src/server/admin/publication-release.ts';
import {
  createDemandDrivenReleaseReader,
  createServerActivationReadiness,
} from '../../src/server/admin/release-evidence.ts';
import { RELEASE_REFRESH_LEAD_MS } from '../../src/server/admin/release-verification.ts';
import { RELEASE_FRESHNESS_MS } from '../../src/server/buyer/release-refresh.ts';
import {
  createMerchantConfigService,
  PUBLICATION_REQUEST_DEADLINE_MS,
  PUBLICATION_RESEND_VALIDITY_MS,
  PUBLICATION_STEP_MARGIN_MS,
} from '../../src/server/merchant-config.ts';
import { adminServices } from './support/fixtures.mts';
import { captureSyntheticPublicationPreviews } from './support/publication-previews.mts';

type Remote = Parameters<DurableCore['productionPublications']['create']>[0]['remote'];

const database = process.env.DATABASE_URL;
// Every synthetic provider call waits this long, so the request time reflects its serial provider work.
const latencyMs = Number(process.env.PUBLICATION_LATENCY_MS ?? 100);
const delay = () => new Promise((resolve) => setTimeout(resolve, latencyMs));
// #468: the largest step, in serial provider rounds; see PUBLICATION_STEP_MARGIN_MS.
const LARGEST_STEP_ROUNDS = 15;

/** Production's measured Admin call latency: a first publication's 69 rounds took ~24 s. */
const VIRTUAL_CALL_MS = 350;
/** A trusted release collection (spec: ~4.5–6 s). */
const COLLECTION_MS = 5_000;
/** How much earlier than its delay (real ms) the model's refresh timers fire; see releaseModel. */
const TIMER_EARLY_MS = 2;
type ReleaseModel = {
  /** Keep the record fresh in the background while the publish runs (production.ts). */
  background: boolean;
  /** Age of the stored record when the publish starts; null when there is none. */
  recordAgeMs: number | null;
  /** Collections (1-based, in start order) that stop without a record. */
  failing?: (collection: number) => boolean;
};

/**
 * Release verification as production.ts composes it for a publish, on a clock that runs
 * VIRTUAL_CALL_MS / latencyMs faster than real time, so a synthetic provider call takes production
 * time: the real demand-driven reader under the unchanged 30 s freshness, a collector that takes
 * COLLECTION_MS (and, like the collector process, reuses a record fresh for another RELEASE_REFRESH_LEAD_MS), the write
 * gate on the step's own evidence and, when enabled, the publish-scoped background refresh sharing
 * the reader's single-flight map.
 */
function releaseModel(config: ReleaseModel) {
  const scale = VIRTUAL_CALL_MS / latencyMs;
  const origin = performance.now();
  const base = Date.parse('2026-10-01T12:00:00.000Z');
  const clock = () => base + (performance.now() - origin) * scale;
  const iso = (ms: number) => new Date(ms).toISOString();
  let stored: { recordId: string; observedAt: number } | null =
    config.recordAgeMs === null ? null : { recordId: randomUUID(), observedAt: clock() - config.recordAgeMs };
  const evidenceAt = (at: number) =>
    stored && stored.observedAt <= at && at - stored.observedAt <= RELEASE_FRESHNESS_MS
      ? ({
          record: {
            recordId: stored.recordId,
            attestation: {
              observedAt: iso(stored.observedAt),
              expiresAt: iso(stored.observedAt + RELEASE_FRESHNESS_MS),
            },
          },
        } as never as Awaited<ReturnType<ReturnType<typeof createDemandDrivenReleaseReader>['read']>>)
      : null;
  const stats = {
    /** Collections started by a publication step, which waits for them. */
    synchronous: 0,
    /** Collections started by the background refresh. */
    background: 0,
    maxConcurrent: 0,
    /** Virtual time the publish spent in its release checks (critical path). */
    waitMs: 0,
    /** Each release check's virtual wait, in order (a request's first check is its preparation). */
    waits: [] as number[],
    /** Synchronous collections each release check started, in the same order. */
    collectedBy: [] as number[],
    /** Virtual start time of each background collection. */
    backgroundStarts: [] as number[],
    checks: 0,
    /** Writes the release write gate refused because the step's own evidence lapsed mid-step. */
    refusedWrites: 0,
    /** Of those, writes refused within PUBLICATION_STEP_RELEASE_LEAD_MS of their step's release check:
     * the step rule makes this impossible, however slow the runner. */
    refusedWithinLead: 0,
  };
  let running = 0;
  const collector = (kind: 'synchronous' | 'background') => ({
    async collect(request: { requestId: string }) {
      const reusable = evidenceAt(clock() + RELEASE_REFRESH_LEAD_MS);
      if (reusable)
        return { requestId: request.requestId, recordId: reusable.record.recordId, state: 'COMPLETE' as const };
      stats[kind]++;
      if (kind === 'background') stats.backgroundStarts.push(clock());
      stats.maxConcurrent = Math.max(stats.maxConcurrent, ++running);
      const begun = clock();
      try {
        await new Promise((resolve) => setTimeout(resolve, COLLECTION_MS / scale));
      } finally {
        running--;
      }
      if (config.failing?.(stats.synchronous + stats.background))
        return { requestId: request.requestId, recordId: null, state: 'STOPPED' as const };
      stored = { recordId: randomUUID(), observedAt: begun + 1_000 };
      return { requestId: request.requestId, recordId: stored.recordId, state: 'COMPLETE' as const };
    },
  });
  const binding = {
    shopId: 'synthetic-tenant',
    installationGeneration: '1',
    appClientId: 'a'.repeat(32),
    authorizationGeneration: randomUUID(),
    authorizationEpoch: 0,
    externalInstallationId: 'gid://shopify/AppInstallation/1',
  };
  const activeVersionRef = resolveRuntimeReleaseProfile().activeVersionRef;
  const collecting = new Map<string, Promise<string | null>>();
  const reader = (refreshAhead: boolean) =>
    createDemandDrivenReleaseReader({
      // As production.ts: the refresh reads 13 s ahead (asks at 17 s of age); a step reuses only a record that outlasts its writes.
      records: refreshAhead
        ? {
            read: async (request) =>
              evidenceAt(+request.now + RELEASE_FRESHNESS_MS - PUBLICATION_RELEASE_REFRESH_AFTER_MS),
          }
        : lastingReleaseRecords({ read: async (request) => evidenceAt(+request.now) }),
      binding,
      collector: collector(refreshAhead ? 'background' : 'synchronous'),
      isCurrent: async () => {},
      deadline: () => clock() + 300_000,
      now: () => new Date(clock()),
      inFlight: collecting,
      // As production.ts: a publication step that joined a collection it did not start, which ended
      // without a record, collects once on its own; the background refresh does not.
      ...(refreshAhead ? {} : { collectAfterJoinedMiss: true }),
    });
  const read = (target: ReturnType<typeof reader>) =>
    target.read({ scope: binding, expectedActiveAppVersionRef: activeVersionRef, now: new Date(clock()) });
  const publishing = reader(false);
  let verified: ReturnType<typeof evidenceAt> = null;
  let checkedAt = Number.NEGATIVE_INFINITY;
  const refreshing = reader(true);
  const refresh = createPublicationReleaseRefresh<AdminActor>({
    async refresh() {
      const evidence = await read(refreshing);
      return evidence ? Date.parse(evidence.record.attestation.observedAt) : null;
    },
    async observedAt() {
      const evidence = evidenceAt(clock());
      return evidence ? Date.parse(evidence.record.attestation.observedAt) : null;
    },
    clock,
    // Node runs a timer up to ~2 ms before its delay as performance.now() measures it (and 1 ms by
    // Date.now()); always firing that early keeps the refresh's due-time guard exercised on any runner.
    setTimer: (run, delayMs) => setTimeout(run, Math.max(0, delayMs / scale - TIMER_EARLY_MS)),
  });
  return {
    stats,
    clock,
    /** A publication step's release check, as production.ts `verifyPublicationRelease`. */
    async verify() {
      const started = clock();
      const collected = stats.synchronous;
      stats.checks++;
      try {
        checkedAt = started;
        verified = await read(publishing);
        return verified !== null;
      } finally {
        stats.waitMs += clock() - started;
        stats.waits.push(Math.round(clock() - started));
        // Checks run one at a time, so a synchronous collection belongs to the check in progress.
        stats.collectedBy.push(stats.synchronous - collected);
      }
    },
    /** The release part of production.ts `publicationAuthorityFresh`, on the step's own evidence. */
    fresh() {
      const at = clock();
      const observed = Date.parse(verified?.record.attestation.observedAt ?? '');
      const fresh = Number.isFinite(observed) && observed <= at && at - observed <= RELEASE_FRESHNESS_MS;
      if (!fresh) stats.refusedWrites++;
      if (!fresh && verified && at - checkedAt <= PUBLICATION_STEP_RELEASE_LEAD_MS) stats.refusedWithinLead++;
      return fresh;
    },
    begin: (actor: AdminActor) => (config.background ? refresh.begin(actor) : () => {}),
    close: () => refresh.close(),
  };
}

/**
 * A first publication (ACTIVE product, so the owned availability hold and restore really
 * dispatch) through the real admin HTTP route, merchant-config loop and PG activation coordinator.
 * Every provider port is a counted double with the same latency, so the provider-call budget is
 * the request's serial wait. `authenticate` answers the current `actor` (one per request session).
 * With `tokens` set it models session tokens instead: a request's bearer names its token's expiry
 * (`Bearer synthetic-identity.<ms>`), an expired one is rejected, and the actor's authority is derived
 * as auth.ts derives it (`legacy`: the rule before the owner decision of 25 Nov 2026, ending with the token).
 */
type Preparation = (actor: AdminActor) => Promise<{ ready: boolean; reason: string | null }>;
async function firstPublication(
  core: DurableCore,
  options: { preparePublication?: Preparation; release?: ReturnType<typeof releaseModel> } = {},
) {
  const release = options.release;
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
  let tokens: { legacy: boolean; grantExpiresAtMs: number } | null = null;
  // Shopify refuses every call with a revoked online staff token.
  let grantRevoked = false;
  // Runs after each acknowledged provider write, between two persisted publication steps.
  let afterWrite: ((label: string) => void) | undefined;
  // Runs as each provider call starts, inside a publication step.
  let beforeCall: ((label: string) => void) | undefined;
  // A round is a stretch of time with at least one provider call in flight: calls made
  // concurrently share a round, so rounds x latency is the request's provider wait.
  let inFlight = 0;
  let rounds = 0;
  const count = async (label: string) => {
    if (grantRevoked) throw new PublicationAdminError('unauthorized');
    beforeCall?.(label);
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
    set: async (target, beforeSend?: () => boolean) => {
      // As composed in production.ts: a field write is sent only while the staff session is current.
      if (!authorityFresh() || beforeSend?.() === false) throw new PublicationAdminError('not_dispatched');
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
    beforeWrite: () => authorityFresh(),
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
    fetchImpl: (url, init) => providerFetch(url, init),
  });
  async function providerFetch(_url: unknown, init?: RequestInit): Promise<Response> {
    {
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
    }
  }
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
    beforeWrite: () => authorityFresh(),
  });
  // Each publication or activation advance is one step between persisted states (#468 margin).
  const steps: { kind: string; ms: number; rounds: number }[] = [];
  const step =
    <A extends unknown[], R>(kind: string, advance: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const started = performance.now();
      const before = rounds;
      try {
        return await advance(...args);
      } finally {
        steps.push({ kind, ms: Math.round(performance.now() - started), rounds: rounds - before });
      }
    };
  // As production.ts: each advance first checks (and if stale collects) its own release record.
  const releaseChecked =
    <A extends unknown[], R>(advance: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      if (release && !(await release.verify())) throw new Error('Publication verification unavailable');
      return advance(...args);
    };
  const measured = {
    ...activation,
    advance: step('activation', releaseChecked(activation.advance)),
    publications: {
      ...activation.publications,
      advance: step('publication', releaseChecked(activation.publications.advance)),
    },
  };
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
  // The session part of production.ts's publicationAuthorityFresh, checked before every write.
  const authorityFresh = () => actor.expiresAtMs > Date.now() && (release?.fresh() ?? true);
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
    publication: () => measured.publications,
    activation: () => measured,
    capturePublicationPreviews: (owner, input) => captureSyntheticPublicationPreviews(core, owner, input),
    ...(options.preparePublication ? { preparePublication: options.preparePublication } : {}),
    ...(release
      ? {
          preparePublication: async () =>
            (await release.verify())
              ? { ready: true, reason: null }
              : { ready: false, reason: 'Publication verification is unavailable. Contact support.' },
        }
      : {}),
  });
  const timings: PublicationTimingDiagnostic[] = [];
  const services = adminServices({
    appOrigin: 'https://synthetic.example',
    recordPublicationTiming: (timing) => timings.push(timing),
    authenticate: async (request, options) => {
      const bearer = /^Bearer synthetic-identity\.([0-9]+)$/.exec(request.headers.get('Authorization') ?? '')?.[1];
      if (!tokens || bearer === undefined) return actor;
      const tokenExpiresAtMs = Number(bearer);
      if (tokenExpiresAtMs <= Date.now()) return null;
      actor = {
        ...actor,
        expiresAtMs: adminAuthorityExpiry(tokenExpiresAtMs, tokens.grantExpiresAtMs, tokens.legacy ? {} : options),
        sessionTokenExpiresAtMs: tokenExpiresAtMs,
      };
      return actor;
    },
    catalog,
    configs: {
      ...configs,
      // As production.ts: the background refresh runs while this publish request is in progress.
      async publish(...args: Parameters<typeof configs.publish>) {
        const end = release?.begin(args[0]) ?? (() => {});
        try {
          return await configs.publish(...args);
        } finally {
          end();
        }
      },
    },
  });
  const publish = (key: string, authorization = 'Bearer synthetic-identity') =>
    handleAdminRequest(
      new Request(`https://synthetic.example/api/admin/products/${productId}/config`, {
        method: 'POST',
        headers: {
          Authorization: authorization,
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
    configs,
    productGid: `gid://shopify/Product/${productId}`,
    /** #466 B: the worker pass with a per-row port on this store's synthetic Shopify. */
    worker: () =>
      core.publicationAbandonment.create({
        appClientId: clientId,
        mode: 'restore',
        abandonAfterMs: 0,
        releaseWaitFlagMs: 0,
        claimStaleMs: 60_000,
        acquireToken: async () => ({
          kind: 'usable',
          shopDomain: 'synthetic.myshopify.com',
          accessToken: 'synthetic-offline-token',
          accessExpiresAt: new Date(Date.now() + 3_600_000),
        }),
        availability: ({ credentials, isCurrent }) =>
          createShopifyAvailabilityHoldV3Port({ now, credentials, isCurrent, fetchImpl: providerFetch }),
      }),
    calls,
    rounds: () => rounds,
    status: () => status,
    actor: () => actor,
    session: (next: Partial<AdminActor>) => {
      actor = { ...actor, ...next };
      return actor;
    },
    /** Model session tokens (see above); the online staff grant lasts `grantMs` from now (24 h by default). */
    tokens: (model: { legacy?: boolean; grantMs?: number } = {}) => {
      tokens = { legacy: model.legacy === true, grantExpiresAtMs: Date.now() + (model.grantMs ?? 86_399_000) };
    },
    revokeGrant: () => {
      grantRevoked = true;
    },
    afterWrite: (hook: (label: string) => void) => {
      afterWrite = hook;
    },
    beforeCall: (hook: (label: string) => void) => {
      beforeCall = hook;
    },
    steps,
    timings,
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
    const {
      publish,
      calls,
      rounds: roundCount,
      status: currentStatus,
      setDenials,
      steps,
      timings,
    } = await firstPublication(core);
    const started = performance.now();
    const response = await publish('m5-436-first-publication');
    const rounds = roundCount();
    const status = currentStatus();
    const elapsed = Math.round(performance.now() - started);
    assert.equal(response.status, 202);
    assert.equal((await response.json()).state, 'ACTIVE');
    assert.equal(status, 'ACTIVE', 'the owned hold was acquired and restored');
    // One timing line per publish request, through the production log whitelist.
    assert.equal(timings.length, 1);
    const [timing] = timings;
    assert.ok(timing);
    let line = '';
    createObservability({
      stream: new Writable({
        write(chunk, _encoding, callback) {
          line += chunk;
          callback();
        },
      }),
    }).logger.info('publication_request_timing', { publicationTiming: timing });
    assert.match(line, /"event":"publication_request_timing"/);
    assert.equal(timing.outcome, 'accepted');
    assert.equal(timing.state, 'ACTIVE');
    assert.equal(timing.truncated, false);
    assert.ok(timing.totalMs >= rounds * latencyMs && timing.totalMs <= elapsed, `${timing.totalMs}`);
    const byStage = new Map<string, { count: number; ms: number }>();
    for (const span of timing.spans) {
      const entry = byStage.get(span.stage) ?? { count: 0, ms: 0 };
      byStage.set(span.stage, { count: entry.count + 1, ms: entry.ms + span.durationMs });
      assert.equal(span.outcome, 'success');
    }
    t.diagnostic(`timing ${timing.totalMs} ms ${JSON.stringify(Object.fromEntries(byStage))}`);
    assert.deepEqual(
      [...byStage.keys()],
      [
        'authentication',
        'product-read',
        'eligibility',
        'shop-currency',
        'preview-capture',
        'preview-verify',
        'command',
        'publication-prepare',
        'publication-advance',
        'activation-advance',
      ],
    );
    assert.equal(
      byStage.get('publication-advance')?.count,
      steps.filter((entry) => entry.kind === 'publication').length,
    );
    assert.equal(byStage.get('activation-advance')?.count, steps.filter((entry) => entry.kind === 'activation').length);
    const budget = Object.fromEntries([...calls].sort());
    const total = [...calls.values()].reduce((sum, value) => sum + value, 0);
    t.diagnostic(
      `latency ${latencyMs} ms/call: ${elapsed} ms, ${rounds} serial provider rounds, ${total} calls ${JSON.stringify(budget)}`,
    );
    // #468: the step margin must cover the largest single step (one publication or activation advance).
    const largest = steps.reduce((max, entry) => (entry.rounds > max.rounds ? entry : max));
    t.diagnostic(`steps ${JSON.stringify(steps.map((entry) => `${entry.kind[0]}${entry.rounds}r/${entry.ms}ms`))}`);
    t.diagnostic(`largest step: ${largest.kind} ${largest.rounds} serial provider rounds, ${largest.ms} ms`);
    assert.ok(largest.rounds <= LARGEST_STEP_ROUNDS, JSON.stringify(largest));
    // Sequencing work stays: hold and restore status writes, four field writes, each read back.
    assert.equal(calls.get('product status write'), 2);
    assert.equal(calls.get('metafield write'), 4);
    // Repeated gates within one request do not: an allowed subscription check and the shop
    // currency are reused, not read again before every publication step.
    assert.ok((calls.get('subscription read') ?? 0) <= 2, JSON.stringify(budget));
    assert.equal(calls.get('shop currency read'), 1);
    // A held-product observation reads its four sales channels together, and is not repeated
    // between two field writes. Before #436 this publication took 146 rounds.
    // The shop currency and subscription reads before the command are independent: one round.
    assert.ok(rounds <= 69, `${rounds} rounds ${JSON.stringify(budget)}`);

    // A denial is never reused: the next request reads the subscription again and proceeds.
    const read = () => calls.get('subscription read') ?? 0;
    setDenials(1);
    let before = read();
    assert.equal((await publish('m5-436-denied')).status, 422);
    assert.equal(read() - before, 1);
    before = read();
    const republished = await publish('m5-436-after-denial');
    assert.equal(republished.status, 202, await republished.clone().text());
    assert.ok(read() - before >= 1, 'the request after a denial reads the subscription again');
  } finally {
    await core.close();
  }
});

/** #468: the staff session ends while a step runs; the server answers `resend` at the next stop point. */
async function interruptedPublication(core: DurableCore, key: string) {
  const f = await firstPublication(core);
  let writes = 0;
  f.afterWrite(() => {
    // The request's session token runs out right after the second acknowledged provider write.
    if (++writes === 2) f.actor().expiresAtMs = Date.now() + 50;
  });
  const response = await f.publish(key);
  f.afterWrite(() => {});
  assert.equal(response.status, 202, await response.clone().text());
  const body = await response.json();
  assert.equal(body.kind, 'resend', JSON.stringify(body));
  assert.equal(body.minimumValidityMs, PUBLICATION_RESEND_VALIDITY_MS);
  assert.match(body.revisionId, /^[a-f0-9-]{36}$/);
  assert.equal(f.timings.at(-1)?.outcome, 'resend');
  // Its progress is persisted: the publication operation stays open, not failed or held.
  const progress = await core.configs.getCurrentPublication(f.shopId, f.configId);
  assert.equal(progress?.operationId, body.revisionId);
  assert.notEqual(progress?.phase, 'active');
  assert.notEqual(progress?.status, 'failed');
  assert.equal(writesSoFar(f), 2, 'it stopped at the step boundary after the write in flight');
  return { ...f, revisionId: body.revisionId as string };
}
const writesSoFar = (f: Awaited<ReturnType<typeof firstPublication>>) =>
  (f.calls.get('product status write') ?? 0) + (f.calls.get('metafield write') ?? 0);
async function resumesOnce(
  core: DurableCore,
  f: Awaited<ReturnType<typeof firstPublication>>,
  key: string,
  revisionId: string,
) {
  const resumed = await f.publish(key);
  assert.equal(resumed.status, 202, await resumed.clone().text());
  const body = await resumed.json();
  assert.equal(body.kind, 'accepted', JSON.stringify(body));
  assert.equal(body.state, 'ACTIVE');
  assert.equal(body.revisionId, revisionId);
  assert.equal(f.status(), 'ACTIVE', 'the owned hold was acquired once and restored');
  // The writes of one uninterrupted publication, each exactly once: none repeated or replayed.
  assert.equal(f.calls.get('product status write'), 2);
  assert.equal(f.calls.get('metafield write'), 4);
  const config = await core.configs.getConfig(f.shopId, f.configId);
  assert.equal(config?.effectiveOperationId, revisionId);
}

test('#468: a session that ends between publication steps is resent with the next session, exactly once', {
  skip: !database,
  timeout: 120000,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  try {
    const f = await interruptedPublication(core, 'm5-468-continue');
    // Same staff member, new session token: the same idempotent request resumes from the persisted step.
    f.session({ sessionId: 'synthetic-session-2', expiresAtMs: Date.now() + 60000 });
    await resumesOnce(core, f, 'm5-468-continue', f.revisionId);
  } finally {
    await core.close();
  }
});

test('#468: another staff member with edit permission can resend and finish the publication', {
  skip: !database,
  timeout: 120000,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  try {
    const f = await interruptedPublication(core, 'm5-468-other-staff');
    // Custody is keyed by shop and product, so another staff member in the same browser profile
    // resends it; the route's fresh online exchange proves their own authority.
    f.session({ staffId: 'synthetic-other-staff', sessionId: 'synthetic-session-3', expiresAtMs: Date.now() + 60000 });
    await resumesOnce(core, f, 'm5-468-other-staff', f.revisionId);
  } finally {
    await core.close();
  }
});

test('#468: a publication cannot be resent after a reinstall', { skip: !database, timeout: 120000 }, async () => {
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
    assert.equal(refused.status, 422, await refused.clone().text());
    assert.equal((await refused.clone().json()).code, 'INSTALLATION_CHANGED');
    assert.equal(writesSoFar(f), 2, 'nothing was written under the new installation');
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
    assert.equal(body.kind, 'resend');
    assert.equal(body.revisionId, undefined, 'nothing was admitted yet');
    // Only the route's own product check ran; no publication read, capture or write.
    assert.deepEqual(Object.fromEntries(f.calls), { 'product read': 1 });
  } finally {
    await core.close();
  }
});

test('#468: a session that ends inside a step: the provider write is refused before dispatch, then resent cleanly', {
  skip: !database,
  timeout: 120000,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  try {
    const f = await firstPublication(core);
    let armed = true;
    f.beforeCall((label) => {
      // The step started with enough session; it runs out during the read that precedes the hold mutation.
      if (armed && label === 'product availability read') {
        armed = false;
        f.actor().expiresAtMs = Date.now() + 50;
      }
    });
    const response = await f.publish('m5-468-refused');
    const body = await response.json();
    assert.equal(response.status, 202, JSON.stringify(body));
    assert.equal(body.kind, 'resend', JSON.stringify(body));
    assert.equal(writesSoFar(f), 0, 'the refused hold mutation was never dispatched');
    const held = await core.configs.getCurrentPublication(f.shopId, f.configId);
    assert.notEqual(held?.activationKind, 'OPERATOR_HOLD');
    f.session({ sessionId: 'synthetic-session-6', expiresAtMs: Date.now() + 60000 });
    await resumesOnce(core, f, 'm5-468-refused', body.revisionId);
  } finally {
    await core.close();
  }
});

test('#468: preparation cut short by the ending session is resent, not denied; a genuine refusal stays a 422 rejection', {
  skip: !database,
  timeout: 120000,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  try {
    let cutShort = true;
    const f = await firstPublication(core, {
      async preparePublication(actor) {
        if (!cutShort) return { ready: true, reason: null };
        // Release collection is bounded by the session deadline: it reaches it and reports not ready.
        cutShort = false;
        actor.expiresAtMs = Date.now() + 20;
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { ready: false, reason: 'Publication verification is unavailable. Contact support.' };
      },
    });
    const first = await f.publish('m5-468-preparation');
    const body = await first.json();
    assert.equal(first.status, 202, JSON.stringify(body));
    assert.equal(body.kind, 'resend');
    assert.equal(body.revisionId, undefined, 'the durable command was not committed');
    f.session({ sessionId: 'synthetic-session-7', expiresAtMs: Date.now() + 60000 });
    const resumed = await f.publish('m5-468-preparation');
    assert.equal((await resumed.json()).state, 'ACTIVE');

    const denied = await firstPublication(core, {
      preparePublication: async () => ({ ready: false, reason: 'Publication verification is unavailable.' }),
    });
    const refused = await denied.publish('m5-468-denied');
    assert.equal(refused.status, 422, 'with session time left a refusal is reported, not resent');
    assert.equal((await refused.clone().json()).code, 'PUBLICATION_UNAVAILABLE');
  } finally {
    await core.close();
  }
});

test('#466 B with #468: an abandoned request is answered, never resent or resumed; Publish works again', {
  skip: !database,
  timeout: 120000,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  try {
    const f = await firstPublication(core);
    let writes = 0;
    // The session ends right after the hold (the first product status write); then the tab closes.
    f.afterWrite(() => {
      if (++writes === 1) f.actor().expiresAtMs = Date.now() + 50;
    });
    const first = await (await f.publish('m5-466-abandon')).json();
    f.afterWrite(() => {});
    assert.equal(first.kind, 'resend', JSON.stringify(first));
    assert.equal(f.status(), 'DRAFT');
    assert.equal((await core.configs.getCurrentPublication(f.shopId, f.configId))?.phase, 'prepared');
    // After the quiet period the worker restores the product exactly and finalizes the request.
    assert.deepEqual(
      { ...(await f.worker().runPass({ shopIds: [f.shopId] })), flaggedHolds: 0 },
      { restored: 1, finalized: 1, flagged: 0, flaggedHolds: 0 },
    );
    assert.equal(f.status(), 'ACTIVE');
    const writesAfterRestore = writesSoFar(f);
    assert.equal(writesAfterRestore, 2, 'hold and restore only; no metafield write');
    // The journal resends the original request with a new session: answered, not resumed.
    f.session({ sessionId: 'synthetic-session-466', expiresAtMs: Date.now() + 60000 });
    const resent = await (await f.publish('m5-466-abandon')).json();
    assert.deepEqual(
      [resent.kind, resent.state, resent.revisionId],
      ['accepted', 'ABANDONED_RESTORED', first.revisionId],
    );
    // A session too short for a step does not turn the abandoned request into `resend` either.
    f.session({ expiresAtMs: Date.now() + PUBLICATION_STEP_MARGIN_MS - 1000 });
    const short = await (await f.publish('m5-466-abandon')).json();
    assert.deepEqual([short.kind, short.state], ['accepted', 'ABANDONED_RESTORED']);
    assert.equal(writesSoFar(f), writesAfterRestore);
    // The editor names the abandoned request (so its journal settles) and allows Publish.
    f.session({ expiresAtMs: Date.now() + 60000 });
    const view = await f.configs.read(f.actor(), f.productGid);
    assert.equal(view.config?.publication.state, 'ABANDONED_RESTORED');
    assert.equal(view.config?.publication.revisionId, first.revisionId);
    assert.equal(view.config?.publication.requestKey, 'm5-466-abandon');
    assert.equal(view.config?.publication.reason, null);
    assert.equal(view.config?.publishEligibility.allowed, true);
    // Publish again: a new request runs to ACTIVE.
    const again = await (await f.publish('m5-466-again')).json();
    assert.deepEqual([again.kind, again.state], ['accepted', 'ACTIVE']);
  } finally {
    await core.close();
  }
});

const bearer = (tokenExpiresAtMs: number) => `Bearer synthetic-identity.${tokenExpiresAtMs}`;

test('owner decision 25 Nov 2026: a publish whose session token expires mid-way finishes every step in one request', {
  skip: !database,
  timeout: 120000,
}, async (t) => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  try {
    // Before the decision a token with 3 s left could not start a step: the request answered `resend`.
    const legacy = await firstPublication(core);
    legacy.tokens({ legacy: true });
    const refused = await (await legacy.publish('m5-deadline-legacy', bearer(Date.now() + 3_000))).json();
    assert.equal(refused.kind, 'resend', JSON.stringify(refused));
    // Only the route's own product check ran; no publication read, capture or write.
    assert.deepEqual(Object.fromEntries(legacy.calls), { 'product read': 1 });

    const f = await firstPublication(core);
    f.tokens();
    const started = Date.now();
    const tokenExpiresAtMs = started + 3_000;
    const response = await f.publish('m5-deadline-one-request', bearer(tokenExpiresAtMs));
    const finished = Date.now();
    const body = await response.json();
    t.diagnostic(`token expired ${tokenExpiresAtMs - started} ms in; publish took ${finished - started} ms`);
    assert.equal(response.status, 202, JSON.stringify(body));
    assert.deepEqual([body.kind, body.state], ['accepted', 'ACTIVE']);
    assert.ok(finished > tokenExpiresAtMs, 'the token expired while the publish ran');
    assert.ok(finished - started < PUBLICATION_REQUEST_DEADLINE_MS);
    // One request, no resend: every write once, the owned hold acquired and restored.
    assert.equal(f.timings.length, 1);
    assert.equal(f.timings[0]?.outcome, 'accepted');
    assert.equal(f.calls.get('product status write'), 2);
    assert.equal(f.calls.get('metafield write'), 4);
    assert.equal(f.status(), 'ACTIVE');
  } finally {
    await core.close();
  }
});

test('owner decision 25 Nov 2026: no step starts within the step margin of 60 s after acceptance; the request is resent between steps', {
  skip: !database,
  timeout: 120000,
}, async (t) => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  try {
    const f = await firstPublication(core);
    f.tokens();
    // The server's clock jumps 46 s ahead right after the second acknowledged write: 14 s remain of
    // the request's 60 s, less than the step margin, so the next step must not start.
    const realNow = Date.now.bind(Date);
    let offset = 0;
    t.mock.method(Date, 'now', () => realNow() + offset);
    let writes = 0;
    f.afterWrite(() => {
      if (++writes === 2) offset = PUBLICATION_REQUEST_DEADLINE_MS - PUBLICATION_STEP_MARGIN_MS + 1_000;
    });
    // The token itself has plenty of life left (it is not what stops the publish).
    const response = await f.publish('m5-deadline-cap', bearer(realNow() + 10 * 60_000));
    f.afterWrite(() => {});
    const body = await response.json();
    assert.equal(response.status, 202, JSON.stringify(body));
    assert.equal(body.kind, 'resend', JSON.stringify(body));
    assert.equal(body.minimumValidityMs, PUBLICATION_RESEND_VALIDITY_MS);
    assert.match(body.revisionId, /^[a-f0-9-]{36}$/);
    assert.equal(writesSoFar(f), 2, 'it stopped at the step boundary after the write in flight');
    // The resend authenticates with a new valid token and finishes from the persisted step, each write once.
    const resumed = await (await f.publish('m5-deadline-cap', bearer(Date.now() + 60_000))).json();
    assert.deepEqual([resumed.kind, resumed.state, resumed.revisionId], ['accepted', 'ACTIVE', body.revisionId]);
    assert.equal(f.calls.get('product status write'), 2);
    assert.equal(f.calls.get('metafield write'), 4);
  } finally {
    await core.close();
  }
});

test('owner decision 25 Nov 2026: a publish whose session token is expired on arrival is rejected as before', {
  skip: !database,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  try {
    const f = await firstPublication(core);
    f.tokens();
    const response = await f.publish('m5-deadline-expired', bearer(Date.now() - 1));
    assert.equal(response.status, 401);
    assert.equal(f.calls.size, 0, 'no provider call');
  } finally {
    await core.close();
  }
});

test('owner decision 25 Nov 2026: an online staff grant that becomes invalid mid-publish stops its writes', {
  skip: !database,
  timeout: 120000,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  try {
    // Revoked in Shopify after the first acknowledged write: the remaining writes fail closed.
    const revoked = await firstPublication(core);
    revoked.tokens();
    revoked.afterWrite(() => revoked.revokeGrant());
    const response = await revoked.publish('m5-deadline-revoked', bearer(Date.now() + 3_000));
    const body = await response.json();
    assert.equal(writesSoFar(revoked), 1, 'no write after the grant was revoked');
    // As today for a refused write: the publication never reaches ACTIVE; the held product is left to
    // operator reconciliation (or the request fails), never published on a revoked grant.
    assert.ok(
      response.status === 503 || (body.kind === 'accepted' && body.state === 'OPERATOR_HOLD'),
      JSON.stringify(body),
    );
    assert.equal(revoked.status(), 'DRAFT', 'the product stays held');

    // A grant that expires soon bounds the publish too: no step starts near its end; the request is resent.
    const expiring = await firstPublication(core);
    expiring.tokens({ grantMs: 30_000 + PUBLICATION_STEP_MARGIN_MS - 1_000 });
    const stopped = await (await expiring.publish('m5-deadline-grant', bearer(Date.now() + 60_000))).json();
    assert.equal(stopped.kind, 'resend', JSON.stringify(stopped));
    assert.deepEqual(Object.fromEntries(expiring.calls), { 'product read': 1 });
  } finally {
    await core.close();
  }
});

/** App Bridge as measured on production (PR #665): `idToken()` returns a 60 s token unchanged until it
 * expires; the next is issued about 1 s later. `firstExpiresAtMs` is the expiry of the token at the click. */
function appBridge(firstExpiresAtMs: number) {
  const tokenAt = (at: number) => {
    let expiresAtMs = firstExpiresAtMs;
    while (at >= expiresAtMs) {
      if (at < expiresAtMs + 1_000) return null;
      expiresAtMs += 61_000;
    }
    return expiresAtMs;
  };
  return {
    /** readFreshBridgeToken: poll until a token with at least `validityMs` left is available. */
    async token(validityMs: number) {
      for (;;) {
        const at = Date.now();
        const expiresAtMs = tokenAt(at);
        if (expiresAtMs !== null && expiresAtMs - at >= validityMs) return expiresAtMs;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    },
  };
}
/** The editor's sendUntilAccepted: send with the ordinary 2 s token floor, then resend (at most three
 * times) with the validity a `resend` names. Times are wall clock, including the token waits. */
async function editorPublish(
  f: Awaited<ReturnType<typeof firstPublication>>,
  bridge: ReturnType<typeof appBridge>,
  key: string,
) {
  const started = Date.now();
  let tokenWaitMs = 0;
  let requests = 0;
  const send = async (validityMs: number) => {
    const waiting = Date.now();
    const expiresAtMs = await bridge.token(validityMs);
    tokenWaitMs += Date.now() - waiting;
    requests++;
    return (await f.publish(key, bearer(expiresAtMs))).json();
  };
  let body = await send(2_000);
  for (let resent = 0; body.kind === 'resend' && resent < 3; resent++) body = await send(body.minimumValidityMs);
  return { ms: Date.now() - started, tokenWaitMs, requests, kind: body.kind, state: body.state };
}

test('owner decision 25 Nov 2026: with App Bridge tokens, a first publish and a republish each take one request', {
  skip: !database,
  timeout: 600000,
}, async (t) => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  try {
    const results: Record<string, Awaited<ReturnType<typeof editorPublish>>> = {};
    for (const legacy of [true, false]) {
      // At production call latency the release model runs in real time, with its ~5 s collections; at a
      // faster latency its virtual clock would not match the session tokens' wall clock, so it is left out.
      const release = latencyMs === VIRTUAL_CALL_MS ? releaseModel({ background: true, recordAgeMs: null }) : undefined;
      try {
        const f = await firstPublication(core, release ? { release } : {});
        f.tokens({ legacy });
        // The click comes with 30 s left on the current token; the republish follows at once.
        const bridge = appBridge(Date.now() + 30_000);
        const label = legacy ? 'before' : 'after';
        results[`${label} first`] = await editorPublish(f, bridge, `m5-deadline-${label}-first`);
        results[`${label} republish`] = await editorPublish(f, bridge, `m5-deadline-${label}-again`);
      } finally {
        release?.close();
      }
    }
    for (const [label, result] of Object.entries(results)) t.diagnostic(`${label} ${JSON.stringify(result)}`);
    for (const label of ['after first', 'after republish']) {
      const result = results[label];
      assert.deepEqual([result?.kind, result?.state, result?.requests], ['accepted', 'ACTIVE', 1], label);
    }
  } finally {
    await core.close();
  }
});

/** One publish request with the release model; times are virtual (production call latency). */
async function measuredPublication(core: DurableCore, config: ReleaseModel) {
  const release = releaseModel(config);
  try {
    const f = await firstPublication(core, { release });
    const run = async (key: string) => {
      const started = release.clock();
      const before = {
        ...release.stats,
        waits: [...release.stats.waits],
        collectedBy: [...release.stats.collectedBy],
        backgroundStarts: [...release.stats.backgroundStarts],
      };
      const rounds = f.rounds();
      const steps = f.steps.length;
      const response = await f.publish(key);
      const body = await response.json();
      return {
        status: response.status,
        state: body.state as string | undefined,
        kind: body.kind as string,
        ms: Math.round(release.clock() - started),
        rounds: f.rounds() - rounds,
        synchronousCollections: release.stats.synchronous - before.synchronous,
        backgroundCollections: release.stats.background - before.background,
        releaseWaitMs: Math.round(release.stats.waitMs - before.waitMs),
        stepWaitsMs: release.stats.waits.slice(before.waits.length),
        collectedBy: release.stats.collectedBy.slice(before.collectedBy.length),
        backgroundStartsMs: release.stats.backgroundStarts
          .slice(before.backgroundStarts.length)
          .map((at) => Math.round(at - started)),
        checks: release.stats.checks - before.checks,
        refusedWrites: release.stats.refusedWrites - before.refusedWrites,
        refusedWithinLead: release.stats.refusedWithinLead - before.refusedWithinLead,
        steps: f.steps.length - steps,
        timing: f.timings.at(-1),
      };
    };
    const first = await run('d3-first');
    // Republish: the same merchant publishes again right away (a new request on a fresh record).
    const again = await run('d3-again');
    return { first, again, maxConcurrent: release.stats.maxConcurrent };
  } finally {
    release.close();
  }
}

test('decision 3: a publish keeps its release record fresh in the background instead of collecting on its steps', {
  skip: !database,
  timeout: 300000,
}, async (t) => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  try {
    for (const [scenario, recordAgeMs] of [
      ['cold (no record)', null],
      ['aging record (20 s old)', 20_000],
    ] as const) {
      const [before, after] = [
        await measuredPublication(core, { background: false, recordAgeMs }),
        await measuredPublication(core, { background: true, recordAgeMs }),
      ];
      for (const [label, result] of [
        ['before', before],
        ['after', after],
      ] as const)
        for (const [request, value] of [
          ['first', result.first],
          ['republish', result.again],
        ] as const) {
          const { timing, ...shown } = value;
          t.diagnostic(`${scenario} ${label} ${request} ${JSON.stringify({ ...shown, outcome: timing?.outcome })}`);
        }
      // Today a step collects on the request path: preparation without a record, a later step once it lapses.
      assert.ok(before.first.synchronousCollections >= 1);
      for (const value of [after.first, after.again]) {
        // Most collections run in the background. Under load a step can still reach a lapsed record before the
        // deferred refresh starts (or within the per-shop 25 s interval) and collect once itself, as today.
        assert.ok(value.synchronousCollections <= 1, JSON.stringify(value));
        // Timing spans are still emitted for every request.
        assert.ok(value.timing && value.timing.spans.length > 0, JSON.stringify(value));
        // A step reuses a record only while it stays fresh for PUBLICATION_STEP_RELEASE_LEAD_MS, so no
        // write is refused within that long of its step's release check, however slow the runner.
        assert.equal(value.refusedWithinLead, 0, JSON.stringify(value));
        // Not asserted: the outcome. This harness runs its virtual clock 3.5x faster than real time at
        // the default latency, so on a loaded runner a step's database work can stretch it past the
        // lead (production's largest step is 4.6 s) and see its write refused (`refusedWrites`), then
        // either recover on a fresh record (ACTIVE) or fail without effect (503).
        // Preparation and every advance still check their own record.
        if (value.state === 'ACTIVE') {
          assert.equal(value.checks, value.steps + 1);
          assert.ok(value.timing?.spans.some((span) => span.stage === 'preparation'));
        }
      }
      assert.equal(after.maxConcurrent, 1, 'never more than one collection per shop');
      // The first publish's collection always runs in the background: at begin without a record, and
      // just past 22 s of age for the aging one, so before it lapses (a refresh run any earlier would
      // find nothing to collect yet use up the shop's 25 s interval: the CI flake of 24-25 Nov).
      assert.ok(after.first.backgroundCollections >= 1, JSON.stringify(after.first));
      // The refresh moves collection off the request path in aggregate; exact counts depend on runner timing.
      assert.ok(
        after.first.synchronousCollections + after.again.synchronousCollections <
          before.first.synchronousCollections + before.again.synchronousCollections ||
          after.first.releaseWaitMs + after.again.releaseWaitMs <=
            before.first.releaseWaitMs + before.again.releaseWaitMs,
        JSON.stringify({ before, after }, (key, value) => (key === 'timing' ? undefined : value)),
      );
    }
  } finally {
    await core.close();
  }
});

test('decision 3: a background refresh that fails leaves the publish to collect on its step, as today', {
  skip: !database,
  timeout: 120000,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  try {
    // Steps stop reusing the record 3 s in; the background refresh, started at begin, stops without one.
    const { first, maxConcurrent } = await measuredPublication(core, {
      background: true,
      recordAgeMs: 20_000,
      failing: (collection) => collection === 1,
    });
    assert.equal(maxConcurrent, 1);
    // The failed refresh started near begin (within 5 s virtual, allowing a loaded runner). Any later
    // one (the routine refresh of the record a step collected) started no sooner than the 15 s publish
    // interval after it, on the same virtual clock (less 1 s for the async steps between the refresh's
    // start and its collector call on a loaded runner).
    assert.ok((first.backgroundStartsMs[0] ?? Number.POSITIVE_INFINITY) < 5_000, JSON.stringify(first));
    for (let i = 1; i < first.backgroundStartsMs.length; i++)
      assert.ok(
        (first.backgroundStartsMs[i] ?? 0) - (first.backgroundStartsMs[i - 1] ?? 0) >=
          PUBLICATION_RELEASE_REFRESH_INTERVAL_MS - 1_000,
        JSON.stringify(first.backgroundStartsMs),
      );
    // A step never starts on a record that lapses within the step lead (see the measurement test).
    assert.equal(first.refusedWithinLead, 0, JSON.stringify(first));
    if (first.refusedWrites > 0) {
      // Only a step the loaded runner stretched past the lead (virtual clock 3.5x real time) can see its
      // write refused; it either recovers on a fresh record and the publish reaches ACTIVE, or it fails
      // without effect (503).
      assert.ok((first.status === 202 && first.state === 'ACTIVE') || first.status === 503, JSON.stringify(first));
      return;
    }
    assert.deepEqual([first.status, first.state], [202, 'ACTIVE'], JSON.stringify(first));
    // Exactly one check collected, once: the first step that found the record within its lead of lapsing.
    assert.deepEqual(
      first.collectedBy.filter((count) => count > 0),
      [1],
      JSON.stringify(first.collectedBy),
    );
  } finally {
    await core.close();
  }
});

test('decision 3: a cold publish whose background collection fails collects once on its own step and reaches ACTIVE', {
  skip: !database,
  timeout: 120000,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  try {
    // No record: the refresh starts collecting at begin and preparation joins it; it stops without one.
    const { first, maxConcurrent } = await measuredPublication(core, {
      background: true,
      recordAgeMs: null,
      failing: (collection) => collection === 1,
    });
    assert.deepEqual([first.status, first.state], [202, 'ACTIVE'], JSON.stringify(first));
    // The failed collection started near begin; the routine refresh of the record preparation collected
    // starts once that record is 17 s old, at least the 15 s interval later, on the same virtual clock.
    assert.ok(
      (first.backgroundStartsMs[0] ?? Number.POSITIVE_INFINITY) < 5_000,
      JSON.stringify(first.backgroundStartsMs),
    );
    for (let i = 1; i < first.backgroundStartsMs.length; i++)
      assert.ok(
        (first.backgroundStartsMs[i] ?? 0) - (first.backgroundStartsMs[i - 1] ?? 0) >=
          PUBLICATION_RELEASE_REFRESH_INTERVAL_MS - 1_000,
        JSON.stringify(first.backgroundStartsMs),
      );
    // Preparation collected exactly once, after the collection it joined failed.
    assert.equal(first.collectedBy[0], 1, JSON.stringify(first.collectedBy));
    // A later step collects (once) only if a loaded runner delays that routine refresh past the 23 s at
    // which steps stop reusing the record; preparation's never runs twice.
    assert.ok(
      first.collectedBy.slice(1).reduce((sum, count) => sum + count, 0) <= 1,
      JSON.stringify(first.collectedBy),
    );
    assert.equal(maxConcurrent, 1);
  } finally {
    await core.close();
  }
});

test('decision 3: without any record the publish still fails closed before a provider write', {
  skip: !database,
  timeout: 120000,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  try {
    for (const background of [false, true]) {
      const release = releaseModel({ background, recordAgeMs: null, failing: () => true });
      try {
        const f = await firstPublication(core, { release });
        const response = await f.publish('d3-unavailable');
        assert.equal(response.status, 422, await response.clone().text());
        assert.equal((await response.json()).code, 'PUBLICATION_UNAVAILABLE');
        assert.equal(writesSoFar(f), 0);
      } finally {
        release.close();
      }
    }
  } finally {
    await core.close();
  }
});
