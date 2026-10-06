import type { AvailabilityHold, AvailabilityScope, ProductAvailabilitySnapshot } from './availability.js';

export type ConfiguredPublicationIntent = Readonly<{
  includedPublicationIds: readonly string[];
  publicationSettings: readonly Readonly<{
    publicationId: string;
    autoPublish: boolean;
    supportsFuturePublishing: boolean;
  }>[];
  scheduled: readonly Readonly<{ publicationId: string; publishDate: string }>[];
}>;
export type EffectiveProductVisibility = Readonly<{
  publishedPublicationIds: readonly string[];
  onlineStore: Readonly<{ publishedAtPresent: boolean; urlPresent: boolean }>;
  /** Dates and URL are retained observations, not membership identity. */
  publicationEvidence: readonly Readonly<{ publicationId: string; isPublished: boolean; publishDate: string }>[];
  publishedAt: string | null;
  onlineStoreUrl: string | null;
}>;
export type ProductAvailabilitySnapshotV2 = Readonly<{
  version: 'm5-product-availability-snapshot-v2';
  scope: AvailabilityScope;
  productId: string;
  state: ProductAvailabilitySnapshot['state'];
  providerUpdatedAt: string;
  configuredIntent: ConfiguredPublicationIntent;
  effectiveVisibility: EffectiveProductVisibility;
  intentDigest: string;
  effectiveDigest: string;
  observedAt: string;
  receivedAt: string;
}>;
export type AvailabilityMutationAcknowledgementV2 = Readonly<{
  version: 'm5-availability-mutation-ack-v2';
  scope: AvailabilityScope;
  productId: string;
  state: ProductAvailabilitySnapshot['state'];
  providerUpdatedAt: string;
  effectiveVisibility: EffectiveProductVisibility;
  observedAt: string;
  receivedAt: string;
}>;
export type AvailabilityRestorationReceiptV2 = Readonly<{
  version: 'm5-availability-restoration-receipt-v2';
  kind: VersionedAvailabilityRestoreResult['kind'];
  acknowledgement: AvailabilityMutationAcknowledgementV2 | null;
  current: ProductAvailabilitySnapshotV2 | null;
}>;
export type AvailabilityHoldV2 = Readonly<{
  version: 'm5-availability-hold-v2';
  operationId: string;
  before: ProductAvailabilitySnapshotV2;
  held: ProductAvailabilitySnapshotV2 | null;
  acquisitionAcknowledgement?: AvailabilityMutationAcknowledgementV2;
  restorationReceipt?: AvailabilityRestorationReceiptV2;
}>;
export type VersionedAvailabilityHold = AvailabilityHold | AvailabilityHoldV2;
export type VersionedProductAvailabilitySnapshot = ProductAvailabilitySnapshot | ProductAvailabilitySnapshotV2;
export type VersionedAvailabilityObservation =
  | Readonly<{ kind: 'HELD'; hold: VersionedAvailabilityHold; current: VersionedProductAvailabilitySnapshot }>
  | Readonly<{ kind: 'NOT_HELD'; current: VersionedProductAvailabilitySnapshot }>
  | Readonly<{
      kind: 'CONFLICT';
      current: VersionedProductAvailabilitySnapshot | null;
      acknowledgement?: AvailabilityMutationAcknowledgementV2;
    }>;
export type VersionedAvailabilityRestoreResult = Readonly<{
  kind: 'RESTORED' | 'NOT_DISPATCHED' | 'RESTORATION_PENDING' | 'CONFLICT';
  current: VersionedProductAvailabilitySnapshot | null;
  acknowledgement?: AvailabilityMutationAcknowledgementV2;
}>;
/** Default snapshot is v2; explicit v1 reads exist only for historical recovery. */
export interface VersionedProductAvailabilityHoldPort {
  snapshot(
    scope: AvailabilityScope,
    productId: string,
    version?: 'v1' | 'v2',
  ): Promise<VersionedProductAvailabilitySnapshot>;
  acquire(scope: AvailabilityScope, hold: VersionedAvailabilityHold): Promise<VersionedAvailabilityObservation>;
  observe(scope: AvailabilityScope, hold: VersionedAvailabilityHold): Promise<VersionedAvailabilityObservation>;
  restore(
    scope: AvailabilityScope,
    hold: VersionedAvailabilityHold,
    expectedCurrent: VersionedProductAvailabilitySnapshot,
    beforeSend?: () => boolean,
  ): Promise<VersionedAvailabilityRestoreResult>;
}

import { activationDigest } from './activation.js';
export const isAvailabilityV2 = (value: VersionedProductAvailabilitySnapshot): value is ProductAvailabilitySnapshotV2 =>
  'version' in value && value.version === 'm5-product-availability-snapshot-v2';
export function effectiveVisibilitySemantics(value: EffectiveProductVisibility) {
  return { publishedPublicationIds: value.publishedPublicationIds, onlineStore: value.onlineStore };
}
const canonicalIds = (ids: unknown): ids is readonly string[] =>
  Array.isArray(ids) &&
  ids.every(
    (id, i) =>
      typeof id === 'string' &&
      /^gid:\/\/shopify\/Publication\/[1-9][0-9]{0,30}$/.test(id) &&
      (i === 0 || ids[i - 1] < id),
  );
export function validAvailabilityV2(value: unknown): value is ProductAvailabilitySnapshotV2 {
  try {
    if (!value || typeof value !== 'object') return false;
    const s = value as ProductAvailabilitySnapshotV2;
    activationDigest(s);
    const iso = (v: unknown) =>
      typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
    const intent = s.configuredIntent,
      effective = s.effectiveVisibility;
    return (
      s.version === 'm5-product-availability-snapshot-v2' &&
      Boolean(s.scope) &&
      /^[A-Za-z0-9_-]{1,128}$/.test(s.scope.shopId) &&
      /^[1-9][0-9]{0,19}$/.test(s.scope.installationGeneration) &&
      /^gid:\/\/shopify\/Shop\/[1-9][0-9]{0,30}$/.test(s.scope.shopifyShopId) &&
      /^[a-f0-9]{32}$/.test(s.scope.appClientId) &&
      /^gid:\/\/shopify\/Product\/[1-9][0-9]{0,30}$/.test(s.productId) &&
      ['available', 'unavailable', 'archived', 'unlisted'].includes(s.state) &&
      iso(s.providerUpdatedAt) &&
      iso(s.observedAt) &&
      iso(s.receivedAt) &&
      s.receivedAt >= s.observedAt &&
      s.providerUpdatedAt <= s.receivedAt &&
      canonicalIds(intent.includedPublicationIds) &&
      Array.isArray(intent.publicationSettings) &&
      intent.publicationSettings.length === intent.includedPublicationIds.length &&
      intent.publicationSettings.every(
        (p, i) =>
          p.publicationId === intent.includedPublicationIds[i] &&
          typeof p.autoPublish === 'boolean' &&
          typeof p.supportsFuturePublishing === 'boolean',
      ) &&
      Array.isArray(intent.scheduled) &&
      intent.scheduled.every(
        (p, i) =>
          intent.includedPublicationIds.includes(p.publicationId) &&
          iso(p.publishDate) &&
          (i === 0 || (intent.scheduled[i - 1]?.publicationId ?? '') < p.publicationId),
      ) &&
      canonicalIds(effective.publishedPublicationIds) &&
      effective.publishedPublicationIds.every((id) => intent.includedPublicationIds.includes(id)) &&
      typeof effective.onlineStore.publishedAtPresent === 'boolean' &&
      typeof effective.onlineStore.urlPresent === 'boolean' &&
      effective.onlineStore.publishedAtPresent === (effective.publishedAt !== null) &&
      effective.onlineStore.urlPresent === (effective.onlineStoreUrl !== null) &&
      (effective.publishedAt === null || iso(effective.publishedAt)) &&
      (effective.onlineStoreUrl === null || typeof effective.onlineStoreUrl === 'string') &&
      Array.isArray(effective.publicationEvidence) &&
      canonicalIds(effective.publicationEvidence.map((p) => p.publicationId)) &&
      effective.publicationEvidence.every(
        (p) =>
          intent.includedPublicationIds.includes(p.publicationId) &&
          typeof p.isPublished === 'boolean' &&
          iso(p.publishDate),
      ) &&
      activationDigest(effective.publicationEvidence.filter((p) => p.isPublished).map((p) => p.publicationId)) ===
        activationDigest(effective.publishedPublicationIds) &&
      activationDigest(intent.scheduled) ===
        activationDigest(
          effective.publicationEvidence
            .filter((p) => !p.isPublished)
            .map((p) => ({ publicationId: p.publicationId, publishDate: p.publishDate })),
        ) &&
      s.intentDigest === activationDigest(intent) &&
      s.effectiveDigest === activationDigest(effectiveVisibilitySemantics(effective))
    );
  } catch {
    return false;
  }
}
/** Future-capable included publications and observed schedules are unqualified for holds.
 * Capability is retained explicitly; absence of V2 nodes cannot qualify future intent. */
export function availabilityV2IntentQualified(value: ProductAvailabilitySnapshotV2): boolean {
  return (
    validAvailabilityV2(value) &&
    value.configuredIntent.scheduled.length === 0 &&
    value.configuredIntent.publicationSettings.every((p) => !p.supportsFuturePublishing)
  );
}
export function availabilityV2HeldSafe(value: ProductAvailabilitySnapshotV2): boolean {
  return (
    availabilityV2IntentQualified(value) &&
    value.state === 'unavailable' &&
    value.effectiveVisibility.publishedPublicationIds.length === 0 &&
    !value.effectiveVisibility.onlineStore.publishedAtPresent &&
    !value.effectiveVisibility.onlineStore.urlPresent
  );
}
export function sameAvailabilityV2(a: ProductAvailabilitySnapshotV2, b: ProductAvailabilitySnapshotV2): boolean {
  return (
    validAvailabilityV2(a) &&
    validAvailabilityV2(b) &&
    activationDigest(a.scope) === activationDigest(b.scope) &&
    a.productId === b.productId &&
    a.state === b.state &&
    a.intentDigest === b.intentDigest &&
    a.effectiveDigest === b.effectiveDigest
  );
}

export function validAvailabilityAcknowledgementV2(value: unknown): value is AvailabilityMutationAcknowledgementV2 {
  try {
    const ack = value as AvailabilityMutationAcknowledgementV2;
    if (ack.version !== 'm5-availability-mutation-ack-v2') return false;
    const includedPublicationIds = ack.effectiveVisibility.publicationEvidence.map((p) => p.publicationId);
    const configuredIntent: ConfiguredPublicationIntent = {
      includedPublicationIds,
      publicationSettings: includedPublicationIds.map((publicationId) => ({
        publicationId,
        autoPublish: false,
        supportsFuturePublishing: false,
      })),
      scheduled: ack.effectiveVisibility.publicationEvidence
        .filter((p) => !p.isPublished)
        .map((p) => ({ publicationId: p.publicationId, publishDate: p.publishDate })),
    };
    return validAvailabilityV2({
      ...ack,
      version: 'm5-product-availability-snapshot-v2',
      configuredIntent,
      intentDigest: activationDigest(configuredIntent),
      effectiveDigest: activationDigest(effectiveVisibilitySemantics(ack.effectiveVisibility)),
    });
  } catch {
    return false;
  }
}
