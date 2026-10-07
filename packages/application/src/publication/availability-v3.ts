import { activationDigest } from './activation.js';
import type { AvailabilityScope, ProductAvailabilitySnapshot } from './availability.js';
import type {
  EffectiveProductVisibility,
  VersionedAvailabilityHold,
  VersionedAvailabilityObservation,
  VersionedAvailabilityRestoreResult,
  VersionedProductAvailabilitySnapshot,
} from './availability-v2.js';

export const AVAILABILITY_V3_ANCHOR_LIMIT = 64;
export type EffectivePublicationAnchorV3 = Readonly<{
  publicationId: string;
  resolved: true;
  productIncluded: true;
  autoPublish: boolean;
  supportsFuturePublishing: boolean;
}>;
/** Historical export name covers future schedules and unsupported legacy non-effective records. */
export type VisiblePublicationScheduleV3 = Readonly<{
  publicationId: string;
  isPublished: boolean;
  publishDate: string;
}>;
export type ProductAvailabilitySnapshotV3 = Readonly<{
  version: 'm5-product-availability-snapshot-v3';
  scope: AvailabilityScope;
  productId: string;
  state: ProductAvailabilitySnapshot['state'];
  providerUpdatedAt: string;
  effectiveVisibility: EffectiveProductVisibility;
  /** Compatibility field name: true future schedules OR unsupported legacy false records; not V2 staged state. */
  visibleScheduledOrStaged: readonly VisiblePublicationScheduleV3[];
  effectiveAnchors: readonly EffectivePublicationAnchorV3[];
  effectiveDigest: string;
  anchorDigest: string;
  observedAt: string;
  receivedAt: string;
}>;
export type AvailabilityMutationAcknowledgementV3 = Readonly<{
  version: 'm5-availability-mutation-ack-v3';
  scope: AvailabilityScope;
  productId: string;
  state: ProductAvailabilitySnapshot['state'];
  providerUpdatedAt: string;
  effectiveVisibility: EffectiveProductVisibility;
  observedAt: string;
  receivedAt: string;
}>;
export type AvailabilityRestorationClaimV3 = Readonly<{
  version: 'm5-availability-restoration-claim-v3';
  operationId: string;
  scope: AvailabilityScope;
  productId: string;
  restoreReserved: true;
  compensationReserved: true;
}>;
export type AvailabilityCompensationReceiptV3 = Readonly<{
  version: 'm5-availability-compensation-receipt-v3';
  restoreAcknowledgement: AvailabilityMutationAcknowledgementV3;
  restored: ProductAvailabilitySnapshotV3;
  mismatch: readonly string[];
  acknowledgement: AvailabilityMutationAcknowledgementV3 | null;
  current: ProductAvailabilitySnapshotV3 | null;
}>;
export type AvailabilityRestoreResultV3 = Readonly<{
  kind: 'RESTORED' | 'NOT_DISPATCHED' | 'RESTORATION_PENDING' | 'CONFLICT' | 'REHELD_CONFLICT';
  current: ProductAvailabilitySnapshotV3 | null;
  acknowledgement?: AvailabilityMutationAcknowledgementV3;
  compensation?: AvailabilityCompensationReceiptV3;
}>;
export type AvailabilityRestorationReceiptV3 = Readonly<{
  version: 'm5-availability-restoration-receipt-v3';
  kind: AvailabilityRestoreResultV3['kind'];
  acknowledgement: AvailabilityMutationAcknowledgementV3 | null;
  current: ProductAvailabilitySnapshotV3 | null;
  compensation?: AvailabilityCompensationReceiptV3;
}>;
export type AvailabilityHoldV3 = Readonly<{
  version: 'm5-availability-hold-v3';
  operationId: string;
  before: ProductAvailabilitySnapshotV3;
  held: ProductAvailabilitySnapshotV3 | null;
  acquisitionAcknowledgement?: AvailabilityMutationAcknowledgementV3;
  restorationClaim?: AvailabilityRestorationClaimV3;
  restorationReceipt?: AvailabilityRestorationReceiptV3;
}>;
export type AnyAvailabilityHold = VersionedAvailabilityHold | AvailabilityHoldV3;
export type AnyProductAvailabilitySnapshot = VersionedProductAvailabilitySnapshot | ProductAvailabilitySnapshotV3;
export type AvailabilityObservationV3 =
  | Readonly<{ kind: 'HELD'; hold: AvailabilityHoldV3; current: ProductAvailabilitySnapshotV3 }>
  | Readonly<{
      kind: 'NOT_HELD' | 'CONFLICT';
      current: ProductAvailabilitySnapshotV3 | null;
      acknowledgement?: AvailabilityMutationAcknowledgementV3;
    }>;
export type AnyAvailabilityObservation = VersionedAvailabilityObservation | AvailabilityObservationV3;
export type AnyAvailabilityRestoreResult = VersionedAvailabilityRestoreResult | AvailabilityRestoreResultV3;
/** Historical versions remain explicit. New operations default to v3. Mutations require caller-owned durable one-use claims. */
export interface ProductAvailabilityHoldV3Port {
  snapshot(
    scope: AvailabilityScope,
    productId: string,
    version?: 'v1' | 'v2' | 'v3',
    anchorIds?: readonly string[],
  ): Promise<AnyProductAvailabilitySnapshot>;
  acquire(scope: AvailabilityScope, hold: AnyAvailabilityHold): Promise<AnyAvailabilityObservation>;
  observe(scope: AvailabilityScope, hold: AnyAvailabilityHold): Promise<AnyAvailabilityObservation>;
  restore(
    scope: AvailabilityScope,
    hold: AnyAvailabilityHold,
    expected: AnyProductAvailabilitySnapshot,
    beforeSend?: () => boolean,
  ): Promise<AnyAvailabilityRestoreResult>;
}
export const isAvailabilityV3 = (value: unknown): value is ProductAvailabilitySnapshotV3 =>
  Boolean(
    value &&
      typeof value === 'object' &&
      Object.getOwnPropertyDescriptor(value, 'version')?.value === 'm5-product-availability-snapshot-v3',
  );
const iso = (v: unknown): v is string =>
  typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
export const canonicalPublicationIdsV3 = (v: unknown): v is readonly string[] =>
  Array.isArray(v) &&
  v.length <= AVAILABILITY_V3_ANCHOR_LIMIT &&
  v.every(
    (id, i) =>
      typeof id === 'string' &&
      /^gid:\/\/shopify\/Publication\/[1-9][0-9]{0,30}$/.test(id) &&
      (i === 0 || v[i - 1] < id),
  );
export function effectiveSemanticsV3(v: EffectiveProductVisibility) {
  return { publishedPublicationIds: v.publishedPublicationIds, onlineStore: v.onlineStore };
}
/** Legacy ResourcePublication: true may be scheduled; false is non-effective, not V2 staged intent.
 * False records remain unsupported blocking evidence. Classify timing at completed receipt, without tolerance. */
export function visibleSchedulesV3(v: EffectiveProductVisibility, receivedAt: string): VisiblePublicationScheduleV3[] {
  return v.publicationEvidence.filter((p) => !p.isPublished || p.publishDate > receivedAt).map((p) => ({ ...p }));
}
export function scheduleSemanticsV3(v: readonly VisiblePublicationScheduleV3[]) {
  return v.map((p) => ({ publicationId: p.publicationId, isPublished: p.isPublished }));
}
const factsFields = [
  'version',
  'scope',
  'productId',
  'state',
  'providerUpdatedAt',
  'effectiveVisibility',
  'observedAt',
  'receivedAt',
];
const snapshotFields = [
  ...factsFields,
  'visibleScheduledOrStaged',
  'effectiveAnchors',
  'effectiveDigest',
  'anchorDigest',
];
const keys = (value: unknown, expected: readonly string[]) =>
  Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === expected.length &&
      Object.keys(value).every((k) => expected.includes(k)),
  );
function validFacts(value: unknown): boolean {
  try {
    const s = value as AvailabilityMutationAcknowledgementV3;
    activationDigest(s);
    const e = s.effectiveVisibility;
    if (
      !keys(s, s.version === 'm5-availability-mutation-ack-v3' ? factsFields : snapshotFields) ||
      !keys(s.scope, ['shopId', 'installationGeneration', 'shopifyShopId', 'appClientId']) ||
      !keys(e, ['publishedPublicationIds', 'onlineStore', 'publicationEvidence', 'publishedAt', 'onlineStoreUrl']) ||
      !keys(e.onlineStore, ['publishedAtPresent', 'urlPresent'])
    )
      return false;
    return (
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
      canonicalPublicationIdsV3(e.publishedPublicationIds) &&
      typeof e.onlineStore.publishedAtPresent === 'boolean' &&
      typeof e.onlineStore.urlPresent === 'boolean' &&
      e.onlineStore.publishedAtPresent === (e.publishedAt !== null) &&
      e.onlineStore.urlPresent === (e.onlineStoreUrl !== null) &&
      (e.publishedAt === null || iso(e.publishedAt)) &&
      (e.onlineStoreUrl === null ||
        (typeof e.onlineStoreUrl === 'string' &&
          e.onlineStoreUrl.length <= 2048 &&
          (() => {
            const u = new URL(e.onlineStoreUrl!);
            return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash;
          })())) &&
      Array.isArray(e.publicationEvidence) &&
      e.publicationEvidence.length <= 250 &&
      e.publicationEvidence.every(
        (p, i) =>
          keys(p, ['publicationId', 'isPublished', 'publishDate']) &&
          /^gid:\/\/shopify\/Publication\/[1-9][0-9]{0,30}$/.test(p.publicationId) &&
          (i === 0 || e.publicationEvidence[i - 1]!.publicationId < p.publicationId) &&
          typeof p.isPublished === 'boolean' &&
          iso(p.publishDate),
      ) &&
      activationDigest(e.publicationEvidence.filter((p) => p.isPublished).map((p) => p.publicationId)) ===
        activationDigest(e.publishedPublicationIds)
    );
  } catch {
    return false;
  }
}
export function validAvailabilityV3(value: unknown): value is ProductAvailabilitySnapshotV3 {
  try {
    const s = value as ProductAvailabilitySnapshotV3;
    return (
      isAvailabilityV3(s) &&
      !Object.hasOwn(s, 'configuredIntent') &&
      validFacts(s) &&
      canonicalPublicationIdsV3(s.effectiveAnchors.map((p) => p.publicationId)) &&
      s.effectiveAnchors.every(
        (p) =>
          keys(p, ['publicationId', 'resolved', 'productIncluded', 'autoPublish', 'supportsFuturePublishing']) &&
          p.resolved === true &&
          p.productIncluded === true &&
          typeof p.autoPublish === 'boolean' &&
          typeof p.supportsFuturePublishing === 'boolean',
      ) &&
      s.effectiveVisibility.publishedPublicationIds.every((id) =>
        s.effectiveAnchors.some((p) => p.publicationId === id),
      ) &&
      activationDigest(s.visibleScheduledOrStaged) ===
        activationDigest(visibleSchedulesV3(s.effectiveVisibility, s.receivedAt)) &&
      s.anchorDigest === activationDigest(s.effectiveAnchors) &&
      s.effectiveDigest === activationDigest(effectiveSemanticsV3(s.effectiveVisibility))
    );
  } catch {
    return false;
  }
}
export const validAvailabilityAcknowledgementV3 = (value: unknown): value is AvailabilityMutationAcknowledgementV3 =>
  Boolean(
    value &&
      Object.getOwnPropertyDescriptor(value, 'version')?.value === 'm5-availability-mutation-ack-v3' &&
      validFacts(value),
  );
export const availabilityV3Qualified = (value: ProductAvailabilitySnapshotV3): boolean =>
  validAvailabilityV3(value) && value.visibleScheduledOrStaged.length === 0;
export function availabilityV3HeldSafe(
  value: ProductAvailabilitySnapshotV3,
  before?: ProductAvailabilitySnapshotV3,
): boolean {
  return (
    availabilityV3Qualified(value) &&
    value.state === 'unavailable' &&
    value.effectiveVisibility.publishedPublicationIds.length === 0 &&
    !value.effectiveVisibility.onlineStore.publishedAtPresent &&
    !value.effectiveVisibility.onlineStore.urlPresent &&
    (!before ||
      (availabilityV3Qualified(before) &&
        activationDigest(value.scope) === activationDigest(before.scope) &&
        value.productId === before.productId &&
        value.anchorDigest === before.anchorDigest))
  );
}
export function sameAvailabilityV3(a: ProductAvailabilitySnapshotV3, b: ProductAvailabilitySnapshotV3): boolean {
  return (
    validAvailabilityV3(a) &&
    validAvailabilityV3(b) &&
    activationDigest(a.scope) === activationDigest(b.scope) &&
    a.productId === b.productId &&
    a.state === b.state &&
    a.effectiveDigest === b.effectiveDigest &&
    a.anchorDigest === b.anchorDigest &&
    activationDigest(scheduleSemanticsV3(a.visibleScheduledOrStaged)) ===
      activationDigest(scheduleSemanticsV3(b.visibleScheduledOrStaged))
  );
}

/** Structurally settled ACKs remain evidence even when scheduling prevents success. */
export function availabilityV3AcknowledgementQualified(value: unknown): value is AvailabilityMutationAcknowledgementV3 {
  return (
    validAvailabilityAcknowledgementV3(value) &&
    visibleSchedulesV3(value.effectiveVisibility, value.receivedAt).length === 0
  );
}

/** A safe status read never attributes a previously ambiguous acquisition. */
export function availabilityV3OwnedHeld(hold: AvailabilityHoldV3): boolean {
  const ack = hold.acquisitionAcknowledgement;
  return Boolean(
    hold.held &&
      availabilityV3HeldSafe(hold.held, hold.before) &&
      (hold.before.state !== 'unavailable' || availabilityV3HeldSafe(hold.before)) &&
      (ack === undefined
        ? hold.before.state === 'unavailable'
        : availabilityV3AcknowledgementQualified(ack) &&
          ack.state === 'unavailable' &&
          ack.productId === hold.before.productId &&
          activationDigest(ack.scope) === activationDigest(hold.before.scope)),
  );
}
