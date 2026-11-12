import { createAdminReadCredentialSource, type EntitlementPolicyConfig } from '@insignia/application';
import { type CredentialKeyRing, createDurableCore, type DurableCore } from '@insignia/database';
import {
  createActiveSubscriptionClient,
  createPartnerGraphqlTransport,
  createShopifyOfflineRefreshTransport,
  resolveRuntimeReleaseProfile,
} from '@insignia/shopify';
import { Pool, type PoolConfig } from 'pg';
import { loadCredentialKeys } from '../../../../worker/src/config.ts';
import { credentialLifecycle } from '../../../../worker/src/handlers.ts';
import { createDemandDrivenReleaseReader, type ReleaseVerificationCollector } from '../admin/release-evidence.ts';
import { createReleaseVerificationClient } from '../admin/release-verification.ts';
import { createSignerClient, type SignerClient } from '../signer-client.ts';
import { proposalStage } from './diagnostics.ts';
import { createProductionBuyerServices, type ProductionBuyerInputs } from './production.ts';
import { createReleaseRefresher, RELEASE_FRESHNESS_MS, RELEASE_REFRESH_AFTER_MS } from './release-refresh.ts';
import type { BuyerServices } from './service.ts';
import { fenceGuardedFetch } from './signing-fence.ts';
import { createSubscriptionCache } from './subscription-cache.ts';

type BootstrapSeam = {
  createCore?(options: PoolConfig, config: { credentialKeys: CredentialKeyRing }): DurableCore;
  createServices?(input: ProductionBuyerInputs): BuyerServices;
  releaseCollector?: ReleaseVerificationCollector;
  signer?: SignerClient;
  releaseRefreshTimer?: Parameters<typeof createReleaseRefresher>[0]['setTimer'];
  fetchImpl?: typeof fetch;
  clock?: () => Date;
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Buyer configuration unavailable');
  return value as Record<string, unknown>;
}
function nonempty(value: unknown, maximum = 128): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    [...value].every((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
  );
}
function exact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new Error('Buyer configuration unavailable');
}
function policy(text: string): EntitlementPolicyConfig {
  if (text.length > 16384) throw new Error('Buyer configuration unavailable');
  const value = record(JSON.parse(text));
  exact(value, ['policyVersion', 'maxAgeMs', 'plans']);
  if (
    !nonempty(value.policyVersion) ||
    !Number.isSafeInteger(value.maxAgeMs) ||
    Number(value.maxAgeMs) < 1 ||
    Number(value.maxAgeMs) > 300000 ||
    !Array.isArray(value.plans) ||
    value.plans.length < 1 ||
    value.plans.length > 8
  )
    throw new Error('Buyer configuration unavailable');
  const handles = new Set<string>(),
    ids = new Set<string>();
  for (const raw of value.plans) {
    const plan = record(raw);
    exact(plan, ['billing', 'planHandle', 'policyId', 'features'], ['shopId']);
    if (
      plan.billing !== 'recurring-only' ||
      !nonempty(plan.planHandle) ||
      !nonempty(plan.policyId) ||
      handles.has(plan.planHandle) ||
      ids.has(plan.policyId) ||
      !Array.isArray(plan.features) ||
      plan.features.length > 32 ||
      plan.features.some((feature) => !nonempty(feature)) ||
      ('shopId' in plan &&
        (typeof plan.shopId !== 'string' || !/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(plan.shopId)))
    )
      throw new Error('Buyer configuration unavailable');
    handles.add(plan.planHandle);
    ids.add(plan.policyId);
  }
  return value as unknown as EntitlementPolicyConfig;
}
/**
 * Only `appKey` is required. Expected Function input queries come from the
 * trusted release record, so they change with each Function release without an
 * operator edit. The former query fields are still accepted (shape-checked,
 * then ignored) so an existing configuration keeps working; remove them at a
 * convenient deployment.
 */
function expectedFunctions(text: string, appKey: string): { appKey: string } {
  if (text.length > 4096) throw new Error('Buyer configuration unavailable');
  const value = record(JSON.parse(text));
  exact(value, ['appKey'], ['transformInputQuerySha256', 'validationInputQuerySha256', 'observationVersion']);
  const digest = (field: unknown) => field === undefined || (typeof field === 'string' && /^[a-f0-9]{64}$/.test(field));
  if (
    value.appKey !== appKey ||
    (value.observationVersion !== undefined && value.observationVersion !== 2) ||
    !digest(value.transformInputQuerySha256) ||
    !digest(value.validationInputQuerySha256)
  )
    throw new Error('Buyer configuration unavailable');
  return { appKey };
}

/** Explicit runtime enable gate; no provisioning or manufactured release evidence.
 * Bound reads request independent collection and preserve durable timestamps.
 * The caller owns one cached bootstrap promise, including an unavailable result. */
export async function createBuyerBootstrap(
  env: NodeJS.ProcessEnv = process.env,
  seam: BootstrapSeam = {},
): Promise<BuyerServices | undefined> {
  if (env.INSIGNIA_M7_BUYER_ENABLED !== '1') return undefined;
  let core: DurableCore | undefined;
  let pool: Pool | undefined;
  let credentialKeys: CredentialKeyRing | undefined;
  try {
    const releaseProfile = resolveRuntimeReleaseProfile(env.INSIGNIA_RELEASE_PROFILE);
    const required = (key: string, maximum = 8192) => {
      const value = env[key];
      if (!nonempty(value, maximum)) throw new Error('Buyer configuration unavailable');
      return value;
    };
    // Structured JSON permits its normal whitespace; identifiers and credentials
    // still use the stricter single-line reader above. The parsers below retain
    // their exact schemas and document-size bounds before allocating resources.
    const jsonConfiguration = (key: string, maximum: number) => {
      const value = env[key];
      if (typeof value !== 'string' || value.length === 0 || value.length > maximum)
        throw new Error('Buyer configuration unavailable');
      return value;
    };
    const connectionString = required('DATABASE_URL');
    const databaseUrl = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) || !databaseUrl.hostname)
      throw new Error('Buyer configuration unavailable');
    const clientId = required('SHOPIFY_CLIENT_ID', 128),
      clientSecret = required('SHOPIFY_CLIENT_SECRET');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(clientId)) throw new Error('Buyer configuration unavailable');
    const appOrigin = new URL(required('APP_URL'));
    if (appOrigin.protocol !== 'https:' || appOrigin.username || appOrigin.password)
      throw new Error('Buyer configuration unavailable');
    if (
      !/^\/apps\/[a-z0-9-]{1,64}$/.test(required('ARTWORK_PROXY_PATH_PREFIX')) ||
      !/^[1-9][0-9]*$/.test(required('INSIGNIA_SHOPIFY_APP_ID'))
    )
      throw new Error('Buyer configuration unavailable');
    const entitlementPolicy = policy(jsonConfiguration('INSIGNIA_M5_ENTITLEMENT_POLICY_JSON', 16384));
    const functions = expectedFunctions(jsonConfiguration('INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON', 4096), clientId);
    const organizationId = required('INSIGNIA_PARTNER_ORGANIZATION_ID', 128),
      accessToken = required('INSIGNIA_PARTNER_ACCESS_TOKEN');
    if (!/^[1-9][0-9]*$/.test(organizationId) || (env.INSIGNIA_CREDENTIAL_PREVIOUS_KEYS_JSON?.length ?? 0) > 8192)
      throw new Error('Buyer configuration unavailable');
    credentialKeys = loadCredentialKeys(env);
    // Fail closed instead of starting with a wrapping key: signing belongs to the signer process.
    if (env.INSIGNIA_SIGNING_WRAP_KEY_BASE64 || env.INSIGNIA_SIGNING_WRAP_KEY_ID)
      throw new Error('Buyer configuration unavailable');
    const signer = seam.signer ?? createSignerClient();
    const clock = seam.clock ?? (() => new Date());
    // Token refresh and Partner reads are provider IO too: refused inside a signing fence (#390).
    const providerFetch = fenceGuardedFetch(seam.fetchImpl ?? fetch);
    const refresh = createShopifyOfflineRefreshTransport({
      clientId,
      clientSecret,
      fetchImpl: providerFetch,
      now: clock,
    });
    const partner = createActiveSubscriptionClient({
      transport: createPartnerGraphqlTransport({ organizationId, accessToken, fetchImpl: providerFetch }),
      now: clock,
    });
    // All configuration and actual adapter constructors qualify before allocating a pool/core.
    // Ten connections: an acceptance's or renewal's fence holder reads only on its own fence connection (#381, #386),
    // beside concurrent buyer requests. Postgres keeps its default max_connections
    // (100); the web process's other pools (runtime/admin 10 each, purchase 4, notification 2) and
    // the worker/verifier pools stay well below it.
    const poolOptions = {
      connectionString,
      max: 10,
      connectionTimeoutMillis: 5000,
      query_timeout: 10000,
      statement_timeout: 10000,
    };
    if (seam.createCore) core = seam.createCore(poolOptions, { credentialKeys });
    else {
      pool = new Pool(poolOptions);
      core = createDurableCore(pool, { credentialKeys });
    }
    const ownedCore = core;
    const credentials = createAdminReadCredentialSource({
      tenants: core.tenants,
      credentials: credentialLifecycle(core),
      refresh,
      now: clock,
    });
    const collector =
      seam.releaseCollector ?? createReleaseVerificationClient(undefined, releaseProfile.activeVersionRef);
    const collecting = new Map<string, Promise<string | null>>();
    type ArtifactScope = { shopId: string; installationGeneration: string; appClientId: string };
    const read = async (scope: ArtifactScope, refreshAhead = false) => {
      if (scope.appClientId !== clientId) return null;
      const current = await ownedCore.tenants.getActiveAuthorizationScope(scope);
      if (!current) return null;
      const managed = await ownedCore.tenants.getManagedInstallationState(current.shopDomain);
      if (
        !managed?.active ||
        managed.shopId !== scope.shopId ||
        managed.currentGeneration !== scope.installationGeneration ||
        !managed.externalInstallationId
      )
        return null;
      const credential = await credentials.acquire(scope);
      if (
        credential.kind !== 'usable' ||
        credential.shopDomain !== current.shopDomain ||
        !Number.isFinite(+credential.accessExpiresAt) ||
        +credential.accessExpiresAt <= +clock() + 30000
      )
        return null;
      const deadlineMs = Math.min(+clock() + 300000, +credential.accessExpiresAt - 30000);
      const reader = createDemandDrivenReleaseReader({
        // A background refresh treats a record older than RELEASE_REFRESH_AFTER_MS as missing, so
        // it collects ahead of expiry. Shared `collecting` keeps it single-flight with acceptance,
        // which still reads its own record under the unchanged 30-second bound.
        records: refreshAhead
          ? {
              read: (request) =>
                ownedCore.trustedReleaseRecords.read({
                  ...request,
                  now: new Date(+request.now + RELEASE_FRESHNESS_MS - RELEASE_REFRESH_AFTER_MS),
                }),
            }
          : ownedCore.trustedReleaseRecords,
        releaseProfile: releaseProfile.name,
        // A request-path collection is its own timing span; a background refresh has none.
        collector: refreshAhead
          ? collector
          : { collect: (request) => proposalStage('release-collect', () => collector.collect(request)) },
        inFlight: collecting,
        binding: {
          shopId: scope.shopId,
          installationGeneration: scope.installationGeneration,
          appClientId: clientId,
          authorizationGeneration: current.authorizationGeneration,
          authorizationEpoch: current.authorizationEpoch,
          externalInstallationId: managed.externalInstallationId,
        },
        deadline: () => deadlineMs,
        now: clock,
        async isCurrent() {
          const after = await ownedCore.tenants.getActiveAuthorizationScope(scope);
          const installed = await ownedCore.tenants.getManagedInstallationState(current.shopDomain);
          if (
            !installed?.active ||
            installed.shopId !== scope.shopId ||
            installed.currentGeneration !== scope.installationGeneration ||
            installed.externalInstallationId !== managed.externalInstallationId ||
            after?.authorizationGeneration !== current.authorizationGeneration ||
            after.authorizationEpoch !== current.authorizationEpoch
          )
            throw new Error('Buyer release authority changed');
        },
      });
      return reader.read({ scope, expectedActiveAppVersionRef: releaseProfile.activeVersionRef, now: clock() });
    };
    // The expected-build and evidence ports of one readiness observation read the same record:
    // concurrent reads for one scope share a single read instead of repeating it.
    const reading = new Map<string, ReturnType<typeof read>>();
    const sharedRead = (scope: ArtifactScope) => {
      const key = JSON.stringify([scope.shopId, scope.installationGeneration, scope.appClientId]);
      const pending = reading.get(key);
      if (pending) return pending;
      const next = read(scope).finally(() => {
        if (reading.get(key) === next) reading.delete(key);
      });
      reading.set(key, next);
      return next;
    };
    const refresher = createReleaseRefresher({
      refresh: async (scope) => {
        const evidence = await read({ ...scope, appClientId: clientId }, true);
        const observedAt = evidence ? Date.parse(evidence.record.attestation.observedAt) : Number.NaN;
        return Number.isFinite(observedAt) ? observedAt : null;
      },
      clock: () => +clock(),
      ...(seam.releaseRefreshTimer ? { setTimer: seam.releaseRefreshTimer } : {}),
    });
    const close = ownedCore.close.bind(ownedCore);
    ownedCore.close = async () => {
      refresher.close();
      await close();
    };
    return (seam.createServices ?? createProductionBuyerServices)({
      core,
      env,
      signer,
      entitlementPolicy,
      credentials,
      // Final pre-signing catalog and stock checks only. Never inside a signing fence, where production
      // refuses every credential acquisition, so these reads need no fence routing (#390).
      passiveCredentials: {
        async acquire(scope) {
          const current = await ownedCore.tenants.getActiveProviderScope(scope);
          if (!current) return { kind: 'inactive' };
          const pair = await ownedCore.credentials.readUsable({ ...scope, minimumRemainingMs: 30000 });
          return pair ? { ...pair, shopDomain: current.shopDomain } : { kind: 'temporarily_unavailable' };
        },
      },
      readSubscription: createSubscriptionCache(
        (target) => partner.read(target),
        entitlementPolicy.maxAgeMs,
        () => +clock(),
      ),
      releaseRefresh: (scope, activeUntil) => refresher.touch(scope, activeUntil),
      expectedFunctions: functions,
      maxObservationAgeMs: 30000,
      clock,
      fetchImpl: seam.fetchImpl,
      artifactPorts: {
        expectedBuild: { read: async (scope) => (await sharedRead(scope))?.expectedBuild ?? null },
        trustedEvidence: { read: async (scope) => (await sharedRead(scope))?.record.attestation ?? null },
      },
    });
  } catch {
    if (core) await core.close().catch(() => {});
    else await pool?.end().catch(() => {});
    for (const key of Object.values(credentialKeys?.keys ?? {})) key.fill(0);
    return undefined;
  }
}
