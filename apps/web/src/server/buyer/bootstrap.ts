import { createM3AdminReadCredentialSource, type EntitlementPolicyConfig } from '@insignia/application';
import { type CredentialKeyRing, createDurableCore, type DurableCore } from '@insignia/database';
import {
  createActiveSubscriptionClient,
  createPartnerGraphqlTransport,
  createShopifyOfflineRefreshTransport,
  type ExpectedFunctionOwnership,
} from '@insignia/shopify';
import { Pool, type PoolConfig } from 'pg';
import { loadCredentialKeys } from '../../../../worker/src/config.ts';
import { credentialLifecycle } from '../../../../worker/src/handlers.ts';
import { createProductionBuyerServices, type ProductionBuyerInputs } from './production.ts';
import type { BuyerServices } from './service.ts';

/** Existing accepted Active version from M5 production readiness, not environment-supplied release trust. */
const acceptedActiveAppVersionRef = '1163229200385';
type BootstrapSeam = {
  createCore?(options: PoolConfig, config: { credentialKeys: CredentialKeyRing }): DurableCore;
  createServices?(input: ProductionBuyerInputs): BuyerServices;
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
    exact(plan, ['planHandle', 'usageHandle', 'policyId', 'features', 'includedUsage'], ['shopId']);
    if (
      !nonempty(plan.planHandle) ||
      !nonempty(plan.usageHandle) ||
      !nonempty(plan.policyId) ||
      plan.planHandle === plan.usageHandle ||
      handles.has(plan.planHandle) ||
      ids.has(plan.policyId) ||
      !Array.isArray(plan.features) ||
      plan.features.length > 32 ||
      plan.features.some((feature) => !nonempty(feature)) ||
      !Number.isSafeInteger(plan.includedUsage) ||
      Number(plan.includedUsage) < 0 ||
      ('shopId' in plan &&
        (typeof plan.shopId !== 'string' || !/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(plan.shopId)))
    )
      throw new Error('Buyer configuration unavailable');
    handles.add(plan.planHandle);
    ids.add(plan.policyId);
  }
  return value as unknown as EntitlementPolicyConfig;
}
function expectedFunctions(text: string, appKey: string): ExpectedFunctionOwnership {
  if (text.length > 4096) throw new Error('Buyer configuration unavailable');
  const value = record(JSON.parse(text));
  exact(value, ['appKey', 'transformInputQuerySha256', 'validationInputQuerySha256', 'observationVersion']);
  if (
    value.appKey !== appKey ||
    value.observationVersion !== 2 ||
    typeof value.transformInputQuerySha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.transformInputQuerySha256) ||
    typeof value.validationInputQuerySha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.validationInputQuerySha256)
  )
    throw new Error('Buyer configuration unavailable');
  return value as unknown as ExpectedFunctionOwnership;
}

/** Runtime bootstrap has one explicit enable gate. It never provisions resources, collects a release
 * or upgrades stored evidence. The caller owns one cached promise, including an unavailable result. */
export async function createBuyerBootstrap(
  env: NodeJS.ProcessEnv = process.env,
  seam: BootstrapSeam = {},
): Promise<BuyerServices | undefined> {
  if (env.INSIGNIA_M7_BUYER_ENABLED !== '1') return undefined;
  let core: DurableCore | undefined;
  let pool: Pool | undefined;
  let credentialKeys: CredentialKeyRing | undefined;
  let ring: ProductionBuyerInputs['ring'] | undefined;
  try {
    const required = (key: string, maximum = 8192) => {
      const value = env[key];
      if (!nonempty(value, maximum)) throw new Error('Buyer configuration unavailable');
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
    const entitlementPolicy = policy(required('INSIGNIA_M5_ENTITLEMENT_POLICY_JSON', 16384));
    const functions = expectedFunctions(required('INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON', 4096), clientId);
    const organizationId = required('INSIGNIA_PARTNER_ORGANIZATION_ID', 128),
      accessToken = required('INSIGNIA_PARTNER_ACCESS_TOKEN');
    if (!/^[1-9][0-9]*$/.test(organizationId) || (env.INSIGNIA_CREDENTIAL_PREVIOUS_KEYS_JSON?.length ?? 0) > 8192)
      throw new Error('Buyer configuration unavailable');
    credentialKeys = loadCredentialKeys(env);
    ring = {
      currentKeyId: credentialKeys.currentKeyId,
      keys: Object.fromEntries(Object.entries(credentialKeys.keys).map(([id, key]) => [id, Buffer.from(key)])),
    };
    const clock = seam.clock ?? (() => new Date());
    const refresh = createShopifyOfflineRefreshTransport({
      clientId,
      clientSecret,
      fetchImpl: seam.fetchImpl,
      now: clock,
    });
    const partner = createActiveSubscriptionClient({
      transport: createPartnerGraphqlTransport({ organizationId, accessToken, fetchImpl: seam.fetchImpl }),
      now: clock,
    });
    // All configuration and actual adapter constructors qualify before allocating a pool/core.
    const poolOptions = {
      connectionString,
      max: 4,
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
    const credentials = createM3AdminReadCredentialSource({
      tenants: core.tenants,
      credentials: credentialLifecycle(core),
      refresh,
      now: clock,
    });
    const read = (scope: { shopId: string; installationGeneration: string; appClientId: string }) =>
      scope.appClientId === clientId
        ? ownedCore.trustedReleaseRecords.read({
            scope: {
              shopId: scope.shopId,
              installationGeneration: scope.installationGeneration,
              appClientId: clientId,
            },
            expectedActiveAppVersionRef: acceptedActiveAppVersionRef,
            now: clock(),
          })
        : Promise.resolve(null);
    return (seam.createServices ?? createProductionBuyerServices)({
      core,
      env,
      ring,
      entitlementPolicy,
      credentials,
      readSubscription: (target) => partner.read(target),
      expectedFunctions: functions,
      maxObservationAgeMs: 30000,
      clock,
      fetchImpl: seam.fetchImpl,
      artifactPorts: {
        expectedBuild: { read: async (scope) => (await read(scope))?.expectedBuild ?? null },
        trustedEvidence: { read: async (scope) => (await read(scope))?.record.attestation ?? null },
      },
    });
  } catch {
    if (core) await core.close().catch(() => {});
    else await pool?.end().catch(() => {});
    for (const key of Object.values(ring?.keys ?? {})) key.fill(0);
    for (const key of Object.values(credentialKeys?.keys ?? {})) key.fill(0);
    return undefined;
  }
}
