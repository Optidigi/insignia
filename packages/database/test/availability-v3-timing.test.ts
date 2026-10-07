import {
  type AvailabilityHoldV3,
  activationDigest,
  availabilityV3AcknowledgementQualified,
  availabilityV3Qualified,
  type ProductAvailabilitySnapshotV3,
  validAvailabilityV3,
} from '@insignia/application';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { openTestDatabase } from './support/postgres.js';

const observedAt = '2026-10-07T12:09:54.968Z';
const receivedAt = '2026-10-07T12:09:57.978Z';
const scope = {
  shopId: 'timing-shop',
  installationGeneration: '1',
  shopifyShopId: 'gid://shopify/Shop/1',
  appClientId: 'a'.repeat(32),
};
const productId = 'gid://shopify/Product/42';
const publicationId = 'gid://shopify/Publication/339456917787';
const anchors = [
  {
    publicationId,
    resolved: true as const,
    productIncluded: true as const,
    autoPublish: true,
    supportsFuturePublishing: false,
  },
];
function snapshot(publishDate: string, isPublished: boolean, blocking: boolean): ProductAvailabilitySnapshotV3 {
  const entry = { publicationId, isPublished, publishDate };
  const effectiveVisibility = {
    publishedPublicationIds: isPublished ? [publicationId] : [],
    onlineStore: { publishedAtPresent: false, urlPresent: false },
    publicationEvidence: [entry],
    publishedAt: null,
    onlineStoreUrl: null,
  };
  return {
    version: 'm5-product-availability-snapshot-v3',
    scope,
    productId,
    state: 'available',
    providerUpdatedAt: '2026-10-07T12:09:56.000Z',
    effectiveVisibility,
    effectiveAnchors: anchors,
    effectiveDigest: activationDigest({
      publishedPublicationIds: effectiveVisibility.publishedPublicationIds,
      onlineStore: effectiveVisibility.onlineStore,
    }),
    anchorDigest: activationDigest(anchors),
    observedAt,
    receivedAt,
    visibleScheduledOrStaged: blocking ? [entry] : [],
  };
}
describe.runIf(Boolean(process.env.DATABASE_URL))('PG18 completed v3 observation timing', () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  beforeAll(async () => {
    database = await openTestDatabase();
  });
  afterAll(async () => {
    await database?.destroy();
  });
  test.each([
    {
      name: 'canonical publication inside interval',
      publishDate: '2026-10-07T12:09:56.000Z',
      isPublished: true,
      qualified: true,
    },
    { name: 'exact completion equality', publishDate: receivedAt, isPublished: true, qualified: true },
    {
      name: 'genuine future one millisecond after completion',
      publishDate: '2026-10-07T12:09:57.979Z',
      isPublished: true,
      qualified: false,
    },
    {
      name: 'legacy false is non-effective unsupported evidence, not V2 staged intent',
      publishDate: '2026-10-07T12:09:56.000Z',
      isPublished: false,
      qualified: false,
    },
  ])('application and SQL snapshot, ACK and restoration fence agree: $name', async (control) => {
    const current = snapshot(control.publishDate, control.isPublished, !control.qualified);
    const {
      effectiveAnchors: _,
      effectiveDigest: _e,
      anchorDigest: _a,
      visibleScheduledOrStaged: _s,
      ...facts
    } = current;
    const ack = { ...facts, version: 'm5-availability-mutation-ack-v3' as const };
    const before = snapshot('2026-10-07T12:00:00.000Z', true, false);
    const effectiveVisibility = { ...before.effectiveVisibility, publishedPublicationIds: [], publicationEvidence: [] };
    const held = {
      ...before,
      state: 'unavailable' as const,
      effectiveVisibility,
      effectiveDigest: activationDigest({ publishedPublicationIds: [], onlineStore: effectiveVisibility.onlineStore }),
    };
    const acquisitionAcknowledgement = { ...ack, state: 'unavailable' as const, effectiveVisibility };
    const hold: AvailabilityHoldV3 = {
      version: 'm5-availability-hold-v3',
      operationId: 'timing-operation',
      before,
      held,
      acquisitionAcknowledgement,
      restorationClaim: {
        version: 'm5-availability-restoration-claim-v3',
        scope,
        productId,
        operationId: 'timing-operation',
        restoreReserved: true,
        compensationReserved: true,
      },
      restorationReceipt: {
        version: 'm5-availability-restoration-receipt-v3',
        kind: 'RESTORED',
        acknowledgement: ack,
        current,
      },
    };
    expect(validAvailabilityV3(current)).toBe(true);
    expect(availabilityV3Qualified(current)).toBe(control.qualified);
    expect(availabilityV3AcknowledgementQualified(ack)).toBe(control.qualified);
    const result = await sql<{ snapshot: boolean; ack: boolean; hold: boolean }>`SELECT
      m5_v3_snapshot(${JSON.stringify(current)}::jsonb) AS snapshot,
      m5_v3_ack_qualified(${JSON.stringify(ack)}::jsonb) AS ack,
      m5_v3_hold(${JSON.stringify(hold)}::jsonb) AS hold`.execute(database);
    expect(result.rows[0]).toEqual({ snapshot: true, ack: control.qualified, hold: control.qualified });
    // Exercise the production hold predicate as an insert fence in an isolated disposable temporary table.
    const insertion = database.transaction().execute(async (transaction) => {
      await sql`CREATE TEMP TABLE timing_hold (hold jsonb NOT NULL CHECK (m5_v3_hold(hold))) ON COMMIT DROP`.execute(
        transaction,
      );
      await sql`INSERT INTO timing_hold(hold) VALUES (${JSON.stringify(hold)}::jsonb)`.execute(transaction);
    });
    if (control.qualified) await expect(insertion).resolves.toBeUndefined();
    else await expect(insertion).rejects.toThrow('timing_hold_hold_check');
    expect(current.observedAt).toBe('2026-10-07T12:09:54.968Z');
  });
});
