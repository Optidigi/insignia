// Explicitly synthetic collector/SDK fixtures; no native provider operation.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import baseline from '../../deployment/m5-runtime/native-function-module-baseline.json' with { type: 'json' };
import type { ReleaseAppendInput } from './append.mts';
import { qualifyReleaseAppendInput } from './append.mts';
import type { CollectorBinding, Reservation } from './collector.mts';
import { recordPhaseName } from './collector.mts';
import { object, text } from './validation.mts';

const versions = [
  '1163229200385',
  '1162611916801',
  '1158986629121',
  '1158837927937',
  '1153019904001',
  '1152880803841',
  '1146748534785',
].map((id, i) => ({
  versionId: `gid://shopify/Version/${id}`,
  versionTag: i ? `synthetic-inactive-${i}` : 'm5-functions-9c2e56b42fbf',
  status: i ? 'inactive' : 'active',
}));
export interface FixtureOverrides {
  root?: string;
  recordId?: string;
  time?: number;
  binding?: Partial<CollectorBinding>;
  functionIds?: { transform?: string; validation?: string };
}
export async function fixture(overrides: FixtureOverrides = {}) {
  const root = overrides.root ?? (await mkdtemp(join(tmpdir(), 'trusted-release-collector-')));
  const config = {
    directory: join(root, recordPhaseName(overrides.recordId ?? '11111111-1111-4111-8111-111111111111')),
    recordId: overrides.recordId ?? '11111111-1111-4111-8111-111111111111',
    operator: { user: 'insignia_release_append', password: 'a'.repeat(64) },
  };
  const time = overrides.time ?? Date.parse('2026-10-11T12:00:00.000Z');
  const binding = {
    shop: 'insignia-rewrite-dev.myshopify.com',
    tenantShopId: 'synthetic-tenant',
    installationGeneration: '1',
    shopId: 'gid://shopify/Shop/123',
    externalInstallationId: 'gid://shopify/AppInstallation/321',
    authorizationGeneration: '22222222-2222-4222-8222-222222222222',
    authorizationEpoch: 0,
    ...overrides.binding,
  };
  const functions: {
    transform: string;
    validation: string;
    runtimeIdentity: string;
    readiness: string;
    observation: ReleaseAppendInput['readiness']['functions']['observation'];
  } = {
    transform: 'present',
    validation: 'present',
    runtimeIdentity: 'unverifiable',
    readiness: 'unknown',
    observation: {
      shopId: binding.tenantShopId,
      installationGeneration: '1',
      appClientId: '1443cf6d03d39edae7c101a943c5c684',
      observedAt: new Date(time).toISOString(),
      transform: {
        functionId: overrides.functionIds?.transform ?? 'synthetic-transform',
        handle: 'insignia-experimental-v2-transform',
        apiType: 'cart_transform',
        apiVersion: '2026-07',
        inputQuerySha256: '8d93a08697dd56e4aa3f857c3509e4d828a5f4195cb2e8cd878749c3e5729053',
      },
      validation: {
        functionId: overrides.functionIds?.validation ?? 'synthetic-validation',
        handle: 'insignia-experimental-v2-validation',
        apiType: 'cart_checkout_validation',
        apiVersion: '2026-07',
        inputQuerySha256: 'a0cd5d7262514c134efc8e9ce964b25b877ce56fc10d0cba6bdd1af82f2dc8c5',
      },
    },
  };
  let appends = 0,
    acquisitions = 0;
  const ports = {
    now: () => time,
    readTenant: async () => ({ ...binding }),
    management: {
      async authenticate() {},
      async open(reserve: Reservation): Promise<{
        versions: ReleaseAppendInput['activeObservation']['versions'];
        totalResults: number;
        moduleObservation: ReleaseAppendInput['moduleObservation'];
      }> {
        for (const op of ['ActiveAppReleaseFromApiKey', 'AppVersions', 'AppVersionByTag']) await reserve(op);
        return {
          versions,
          totalResults: 7,
          moduleObservation: {
            appId: '429028933633',
            appClientId: '1443cf6d03d39edae7c101a943c5c684',
            versionId: '1163229200385',
            versionTag: 'm5-functions-9c2e56b42fbf',
            observedAt: new Date(time).toISOString(),
            modules: structuredClone(baseline),
          },
        };
      },
      async close(reserve: Reservation) {
        await reserve('AppVersions');
        return { versions, totalResults: 7, observedAt: new Date(time).toISOString() };
      },
    },
    acquireToken: async () => {
      acquisitions++;
      return 'SYNTHETIC_ACCESS_TOKEN';
    },
    readInstallation: async () => ({
      shop: binding.shop,
      shopId: binding.shopId,
      installationId: binding.externalInstallationId,
      appId: '429028933633',
      appClientId: '1443cf6d03d39edae7c101a943c5c684',
      grants: [
        'write_products',
        'read_products',
        'read_publications',
        'read_product_listings',
        'read_cart_transforms',
        'read_validations',
        'write_cart_transforms',
        'write_validations',
      ],
    }),
    readFunctions: async (_token: string, _binding: CollectorBinding): Promise<unknown> => structuredClone(functions),
    async append(input: unknown) {
      appends++;
      qualifyReleaseAppendInput(input, time);
      return {
        classification: 'TRUSTED_RELEASE_APPEND_ACK_RUNTIME_QUALIFIED',
        recordId: text(object(input).recordId),
        writeAttempted: true,
        writeAcknowledged: true,
      };
    },
  };
  return {
    root,
    config,
    ports,
    binding,
    functions,
    get appends() {
      return appends;
    },
    get acquisitions() {
      return acquisitions;
    },
    close: () => rm(root, { recursive: true, force: true }),
  };
}
