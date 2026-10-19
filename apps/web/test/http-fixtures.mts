import type {
  ArtworkManifest,
  ArtworkRecord,
  createArtworkService,
  EffectiveQuoteRevision,
} from '@insignia/application';
import { createDurableCore, type DurableCore, type PurchaseRecord } from '@insignia/database';
import { Pool } from 'pg';
import type { AdminActor } from '../src/server/admin/contracts.js';
import type { createBuyerServices } from '../src/server/buyer/service.ts';
import type { PurchaseServices } from '../src/server/purchase/service.ts';

type Overrides = { [K in keyof DurableCore]?: Partial<DurableCore[K]> };
export type MutableCore = { -readonly [K in keyof DurableCore]: DurableCore[K] };
export function coreFixture(overrides: Overrides): MutableCore {
  const pool = new Pool();
  const deny = () => {
    throw new Error('Unexpected SQL in HTTP unit fixture');
  };
  Object.defineProperty(pool, 'query', { value: deny });
  Object.defineProperty(pool, 'connect', { value: deny });
  const core = createDurableCore(pool);
  for (const key in overrides) {
    const value: unknown = Object.getOwnPropertyDescriptor(overrides, key)?.value;
    const replacement = typeof value === 'function' ? value : Object.assign({}, Reflect.get(core, key), value);
    if (!Reflect.set(core, key, replacement)) throw new Error('HTTP repository override unavailable');
  }
  return core;
}
export function releaseEvidenceFixture(
  observedAt = '2000-01-01T00:00:00.000Z',
  expiresAt = '2000-01-01T00:00:30.000Z',
): NonNullable<Awaited<ReturnType<DurableCore['trustedReleaseRecords']['read']>>> {
  const build = {
    schemaVersion: 2 as const,
    shopId: 'tenant',
    installationGeneration: '1',
    appClientId: 'synthetic-app',
    sourceCommit: 'a'.repeat(40),
    appVersionRef: '100',
    devPreviewRef: null,
    transform: {
      functionId: 'transform',
      handle: 'transform',
      apiType: 'cart_transform' as const,
      apiVersion: '2026-07',
      inputQuerySha256: 'a'.repeat(64),
      wasmSha256: 'b'.repeat(64),
    },
    validation: {
      functionId: 'validation',
      handle: 'validation',
      apiType: 'cart_checkout_validation' as const,
      apiVersion: '2026-07',
      inputQuerySha256: 'c'.repeat(64),
      wasmSha256: 'd'.repeat(64),
    },
    targetModules: {
      transform: { moduleId: 'transform', target: 'cart.transform.run', export: 'cart_transform_run' },
      validation: {
        moduleId: 'validation',
        target: 'cart.validations.generate.run',
        export: 'cart_validations_generate_run',
      },
    },
  };
  return {
    expectedBuild: build,
    record: {
      version: 'm5-trusted-release-v1',
      recordId: '00000000-0000-4000-8000-000000000001',
      activeAppVersionRef: '100',
      attestation: { ...build, evidenceKind: 'RELEASE_BOUND', observedAt, expiresAt, targetObservedAt: observedAt },
    },
    activeVersionEvidenceSha256: 'e'.repeat(64),
    evidenceDigest: 'f'.repeat(64),
  };
}
type ArtworkService = ReturnType<typeof createArtworkService>;
export function artworkStatus(
  overrides: Partial<Awaited<ReturnType<ArtworkService['status']>>> = {},
): Awaited<ReturnType<ArtworkService['status']>> {
  return {
    assetId: 'a',
    state: 'UPLOADING',
    mimeType: 'image/png',
    width: null,
    height: null,
    expiresAt: '2099-01-01T00:00:00Z',
    rejection: null,
    ...overrides,
  };
}
export function artworkAdmission(
  overrides: Partial<Awaited<ReturnType<ArtworkService['begin']>>> = {},
): Awaited<ReturnType<ArtworkService['begin']>> {
  return {
    ...artworkStatus(),
    upload: { url: 'https://private.example/quarantine', headers: {} },
    uploadUntil: '2099-01-01T00:00:00Z',
    ...overrides,
  };
}
export function effectiveRevision(overrides: Partial<EffectiveQuoteRevision> = {}): EffectiveQuoteRevision {
  return {
    configId: 'configuration',
    operationId: 'publication',
    config: {
      version: 'm2-published-config-v1',
      shopId: 'tenant',
      productId: '123',
      revisionId: 'revision',
      revisionContentHash: 'a'.repeat(64),
      shopCurrency: 'USD',
      methods: [{ id: 'method' }],
      placements: [{ id: 'front', allowedMethodIds: ['method'], allowedStepIds: ['step'], logoLaterAllowed: true }],
      productionOptions: [],
      pricingRules: [],
    },
    ...overrides,
  };
}
type BuyerServices = ReturnType<typeof createBuyerServices>;
export function buyerFixture(
  overrides: Omit<Partial<BuyerServices>, 'guest'> & { guest?: Partial<BuyerServices['guest']> },
): BuyerServices {
  const deny = async (): Promise<never> => {
    throw new Error('Unexpected buyer operation in HTTP fixture');
  };
  return {
    store: coreFixture({}).buyers,
    clock: () => new Date(),
    config: deny,
    session: deny,
    design: deny,
    propose: deny,
    accept: deny,
    renew: deny,
    confirm: deny,
    cartState: deny,
    ...overrides,
    guest: { resolve: deny, issue: deny, verify: deny, ...overrides.guest },
  };
}
export function purchaseHttpFixture(overrides: Partial<PurchaseServices>): PurchaseServices {
  const deny = async (): Promise<never> => {
    throw new Error('Unexpected purchase operation in HTTP fixture');
  };
  return {
    appOrigin: 'https://app.example',
    authenticate: deny,
    privacyRequests: deny,
    privacyRequest: deny,
    privacyOrder: deny,
    list: deny,
    get: deny,
    attach: deny,
    lock: deny,
    reconcile: deny,
    download: deny,
    preview: deny,
    ...overrides,
  };
}
export function purchaseRecord(overrides: Partial<PurchaseRecord>): PurchaseRecord {
  return {
    purchaseId: 'd841ee12-2075-4101-b3bc-429ad31a4059',
    shopId: 'tenant',
    installationGeneration: '1',
    orderId: 'gid://shopify/Order/1',
    orderCreatedAt: '2026-10-13T10:00:00Z',
    currency: 'USD',
    originalTotalMinor: '100',
    isTest: true,
    bindings: [],
    observations: [],
    firstPaidAt: null,
    refunds: [],
    artworkEvents: [],
    artworkVersion: 0,
    artworkState: 'PENDING_ARTWORK',
    ...overrides,
  };
}
export function actorFixture(overrides: Partial<AdminActor>): AdminActor {
  return {
    shop: 'synthetic.myshopify.com',
    shopId: 'gid://shopify/Shop/1',
    installationId: 'installation',
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
export function artworkFixture(overrides: Partial<ArtworkService>): ArtworkService {
  const deny = async (): Promise<never> => {
    throw new Error('Unexpected artwork operation in HTTP unit fixture');
  };
  return {
    begin: deny,
    complete: deny,
    status: deny,
    preview: deny,
    download: deny,
    process: deny,
    cleanup: deny,
    quoteArtworkFor: () => {
      throw new Error('Unexpected quote artwork operation');
    },
    ...overrides,
  };
}
export function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Incomplete HTTP fixture');
  return value;
}
export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected response object');
  return Object.fromEntries(Object.entries(value));
}
export function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected response text');
  return value;
}

export const artworkManifest: ArtworkManifest = {
  version: 'm6-inspection-v1',
  mimeType: 'image/png',
  byteLength: 3,
  sha256: 'a'.repeat(64),
  width: 1,
  height: 1,
  previewSha256: 'b'.repeat(64),
  previewByteLength: 8,
};
export function artworkRow(overrides: Partial<ArtworkRecord> = {}): ArtworkRecord {
  return {
    assetId: 'asset',
    shopId: 'shop',
    installationGeneration: '1',
    ownerHash: 'a'.repeat(64),
    declaredMime: 'image/png',
    declaredBytes: 3,
    state: 'USABLE',
    quarantineKey: 'quarantine/key',
    originalKey: 'originals/key',
    previewKey: 'previews/key.png',
    collectedAt: new Date('2026-10-12T12:00:00Z'),
    uploadUntil: new Date('2026-10-12T12:05:00Z'),
    expiresAt: new Date('2026-10-19T12:00:00Z'),
    claimId: null,
    manifest: null,
    rejection: null,
    ...overrides,
  };
}
