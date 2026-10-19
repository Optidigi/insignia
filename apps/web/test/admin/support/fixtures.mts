import assert from 'node:assert/strict';
import type { AdminServices } from '../../../src/server/admin/contracts.js';
export function required<T>(value: T | null | undefined): T {
  assert.ok(value !== null && value !== undefined, 'Required fixture value missing');
  return value;
}
export function record(value: unknown): Record<string, unknown> {
  const isRecord = (input: unknown): input is Record<string, unknown> =>
    input !== null && typeof input === 'object' && !Array.isArray(input);
  assert.ok(isRecord(value));
  return value;
}
export function jsonRecord(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  return record(value);
}
export const unexpected = (): never => {
  throw new Error('Unexpected fixture boundary');
};
type AdminOverrides = Omit<Partial<AdminServices>, 'catalog' | 'configs' | 'methods'> & {
  catalog?: Partial<AdminServices['catalog']>;
  configs?: Partial<AdminServices['configs']>;
  methods?: Partial<NonNullable<AdminServices['methods']>>;
};
export function adminServices(overrides: AdminOverrides = {}): AdminServices {
  return {
    appOrigin: 'https://app.example',
    authenticate: unexpected,
    ...overrides,
    methods: overrides.methods
      ? { list: unexpected, create: unexpected, rename: unexpected, delete: unexpected, ...overrides.methods }
      : undefined,
    catalog: { list: unexpected, get: unexpected, ...overrides.catalog },
    configs: {
      read: unexpected,
      create: unexpected,
      save: unexpected,
      copy: unexpected,
      publish: unexpected,
      ...overrides.configs,
    },
  };
}
export function adminActor(
  overrides: Partial<import('../../../src/server/admin/contracts.js').AdminActor> = {},
): import('../../../src/server/admin/contracts.js').AdminActor {
  return {
    shop: 'synthetic.myshopify.com',
    shopId: 'gid://shopify/Shop/1',
    installationId: 'installation-1',
    tenantShopId: 'tenant',
    installationGeneration: '1',
    staffId: 'staff',
    sessionId: 'session',
    expiresAtMs: Date.now() + 60000,
    canRead: true,
    canEdit: true,
    ...overrides,
  };
}
export function calendarCandidate(
  scope: import('@insignia/application').FunctionArtifactScope,
): import('@insignia/application').ActivationCandidate {
  const keyScope = {
    shopId: scope.shopId,
    installationGeneration: scope.installationGeneration,
    authorizationGeneration: '11111111-1111-4111-8111-111111111111',
    authorizationEpoch: 0,
  };
  return {
    shopId: scope.shopId,
    configId: 'synthetic-config',
    operationId: 'synthetic-operation',
    revisionId: 'synthetic-revision',
    revisionHash: 'a'.repeat(64),
    operationSequence: '1',
    scope: keyScope,
    availabilityScope: { ...scope, shopifyShopId: 'gid://shopify/Shop/1' },
    productId: 'gid://shopify/Product/1',
    mode: 'optional',
    prior: null,
    phase: 'prepared',
    status: 'prepared',
    desiredProjection: {},
    desiredProjectionDigest: 'b'.repeat(64),
    observedProjectionDigest: null,
    publicConfig: { value: '{}', digest: 'c'.repeat(64), scope: keyScope, keys: [] },
    selectedKeyId: 7,
    state: { kind: 'WAITING_RELEASE', hold: null, evidenceDigest: null },
  };
}
export function array(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}
export function text(value: unknown): string {
  assert.ok(typeof value === 'string');
  return value;
}
export function number(value: unknown): number {
  assert.ok(typeof value === 'number' && Number.isFinite(value));
  return value;
}
export function configRecord(
  overrides: Partial<import('@insignia/database').ConfigRecord> = {},
): import('@insignia/database').ConfigRecord {
  return {
    shopId: 'shop-1',
    configId: 'config-1',
    externalProductId: '555',
    draftSchemaVersion: 'm3-config-draft-v1',
    draftValue: {},
    draftVersion: '2',
    effectiveRevisionId: null,
    effectiveOperationId: null,
    publicationSequence: '0',
    ...overrides,
  };
}
export function revisionRecord(
  overrides: Partial<import('@insignia/database').RevisionRecord> = {},
): import('@insignia/database').RevisionRecord {
  return {
    shopId: 'shop-1',
    configId: 'config-1',
    revisionId: 'synthetic-revision',
    schemaVersion: 'm2-published-config-v1',
    publishedValue: {},
    contentHash: 'a'.repeat(64),
    createdAt: new Date('2026-10-01T12:00:00Z'),
    ...overrides,
  };
}
// Deliberately invalid opaque handle, confined to mocked repositories for service ordering tests.
// Actual PostgreSQL cases use core.transactions.run; this token must never enter a real adapter.
export const fixtureTransaction = Object.freeze({}) as import('@insignia/database').DurableTransaction;
