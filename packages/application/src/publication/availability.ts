/** Product-wide provider availability, not proof that in-flight checkout has drained. */
export type AvailabilityScope = Readonly<{
  shopId: string;
  installationGeneration: string;
  shopifyShopId: string;
  appClientId: string;
}>;
export type ProductAvailabilitySnapshot = Readonly<{
  scope: AvailabilityScope;
  productId: string;
  state: 'available' | 'unavailable' | 'archived' | 'unlisted';
  providerVersion: string;
  visibilityDigest: string;
  /** Conservative observation origin captured before provider/credential I/O. */
  observedAt: string;
  /** Completion bound for provider version validation; absent on legacy snapshots.
   * Never used to renew freshness or reinterpret the stored legacy origin. */
  receivedAt?: string;
}>;
/** Persist this intent before dispatch. Recovery observes it, never blindly repeats a mutation. */
export type AvailabilityHold = Readonly<{
  version: 'm5-availability-hold-v1';
  operationId: string;
  before: ProductAvailabilitySnapshot;
  held: ProductAvailabilitySnapshot | null;
}>;
export type AvailabilityHoldObservation =
  | Readonly<{ kind: 'HELD'; hold: AvailabilityHold; current: ProductAvailabilitySnapshot }>
  | Readonly<{ kind: 'NOT_HELD' | 'CONFLICT'; current: ProductAvailabilitySnapshot }>;
export type AvailabilityRestoreResult =
  | Readonly<{ kind: 'RESTORED'; current: ProductAvailabilitySnapshot }>
  | Readonly<{ kind: 'RESTORATION_PENDING' | 'CONFLICT'; current: ProductAvailabilitySnapshot | null }>;
export interface ProductAvailabilityHoldPort {
  snapshot(scope: AvailabilityScope, productId: string): Promise<ProductAvailabilitySnapshot>;
  acquire(scope: AvailabilityScope, hold: AvailabilityHold): Promise<AvailabilityHoldObservation>;
  observe(scope: AvailabilityScope, hold: AvailabilityHold): Promise<AvailabilityHoldObservation>;
  restore(
    scope: AvailabilityScope,
    hold: AvailabilityHold,
    expectedCurrent: ProductAvailabilitySnapshot,
  ): Promise<AvailabilityRestoreResult>;
}
