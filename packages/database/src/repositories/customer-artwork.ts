import { randomUUID } from 'node:crypto';
import type {
  CustomerArtworkAttach,
  CustomerArtworkGrant,
  CustomerArtworkNotification,
  CustomerArtworkNotificationStore,
  CustomerArtworkSlot,
  CustomerArtworkStore,
  PurchaseMerchant,
} from '@insignia/application';
import { type Kysely, sql, type Transaction } from 'kysely';
import type { Database } from '../client/database.js';
import { sha256CanonicalJson } from '../hash/canonical.js';
import { createPurchaseRepository, type PurchaseRecord } from './purchase.js';

type Executor = Kysely<Database> | Transaction<Database>;
type GrantRow = {
  capability_hash: string;
  shop_id: string;
  installation_generation: string;
  purchase_id: string;
  request_id: string;
  purpose: CustomerArtworkGrant['purpose'];
  slots: CustomerArtworkSlot[];
  expires_at: Date;
  revoked_at: Date | null;
};
function unavailable(): never {
  throw new Error('CUSTOMER_ARTWORK_UNAVAILABLE');
}
function missing(record: PurchaseRecord) {
  if (
    record.artworkState === 'ARTWORK_LOCKED' ||
    record.artworkState === 'ERASED' ||
    record.bindings.some((binding) => !binding.designPayload || binding.erasedAt) ||
    record.artworkEvents.some(
      (event) =>
        event.erasedAt ||
        (event.kind === 'ATTACH' &&
          (!event.expiresAt ||
            Date.parse(event.expiresAt) <= Date.now() ||
            event.groupIndex === null ||
            event.placementId === null ||
            event.assetId === null)),
    ) ||
    record.observations[0]?.cancelledAt
  )
    unavailable();
  const slots: CustomerArtworkSlot[] = [];
  let groupIndex = 0;
  for (const binding of record.bindings) {
    for (const { group } of binding.designPayload?.request.groups ?? []) {
      for (const placement of group.design.placements) {
        if (
          placement.artwork.kind === 'deferred' &&
          !record.artworkEvents.some(
            (event) =>
              event.kind === 'ATTACH' && event.groupIndex === groupIndex && event.placementId === placement.placementId,
          )
        )
          slots.push({
            groupIndex,
            placementId: placement.placementId,
            productId: group.productId,
            revisionId: group.configRevisionId,
            methodId: placement.methodId,
            stepId: placement.stepId,
          });
      }
      groupIndex++;
    }
  }
  return slots;
}
async function lockedPurchase(
  db: Executor,
  scope: Pick<PurchaseMerchant, 'shopId' | 'installationGeneration'>,
  purchaseId: string,
) {
  const tenant =
    await sql`SELECT 1 FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=${scope.shopId} AND s.current_generation=${scope.installationGeneration}::bigint AND i.deactivated_at IS NULL FOR SHARE OF s,i`.execute(
      db,
    );
  if (!tenant.rows.length) unavailable();
  const order =
    await sql`SELECT 1 FROM purchase_orders WHERE purchase_id=${purchaseId}::uuid AND shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint FOR UPDATE`.execute(
      db,
    );
  if (!order.rows.length) unavailable();
  const record = await createPurchaseRepository(db).get(scope, purchaseId);
  if (!record || record.installationGeneration !== scope.installationGeneration) unavailable();
  return record;
}
function project(row: GrantRow, record: PurchaseRecord): CustomerArtworkGrant {
  const current = missing(record);
  const allowed = new Set(row.slots.map((slot) => JSON.stringify([slot.groupIndex, slot.placementId])));
  return {
    shopId: row.shop_id,
    installationGeneration: row.installation_generation,
    purchaseId: row.purchase_id,
    capabilityHash: row.capability_hash,
    requestId: row.request_id,
    purpose: row.purpose,
    expiresAt: row.expires_at.toISOString(),
    artworkVersion: record.artworkVersion,
    slots: current.filter((slot) => allowed.has(JSON.stringify([slot.groupIndex, slot.placementId]))),
  };
}
/** All customer attachment decisions serialize with the same purchase lock used by merchant attachment/lock. */
export function createCustomerArtworkRepository(db: Kysely<Database>) {
  async function grant(executor: Executor, hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) unavailable();
    return (
      (
        await sql<GrantRow>`SELECT capability_hash,shop_id,installation_generation::text,purchase_id::text,request_id::text,purpose,slots,expires_at,revoked_at FROM customer_artwork_grants WHERE capability_hash=${hash} AND revoked_at IS NULL AND expires_at>clock_timestamp()`.execute(
          executor,
        )
      ).rows[0] ?? null
    );
  }
  async function issue(
    executor: Executor,
    scope: PurchaseMerchant,
    input: Parameters<CustomerArtworkStore['issue']>[1],
  ) {
    if (scope.kind !== 'merchant') unavailable();
    const record = await lockedPurchase(executor, scope, input.purchaseId);
    const slots = missing(record);
    const saved = (
      await sql<GrantRow>`SELECT capability_hash,shop_id,installation_generation::text,purchase_id::text,request_id::text,purpose,slots,expires_at,revoked_at FROM customer_artwork_grants WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint AND purchase_id=${input.purchaseId}::uuid AND request_id=${input.requestId}::uuid AND purpose=${input.purpose}`.execute(
        executor,
      )
    ).rows[0];
    if (saved) {
      if (saved.revoked_at || saved.expires_at <= new Date() || saved.capability_hash !== input.capabilityHash)
        unavailable();
      return project(saved, record);
    }
    if (!slots.length || (input.purpose === 'paid-email' && !record.firstPaidAt)) return null;
    const expiresAt = new Date(Math.min(...record.bindings.map((binding) => Date.parse(binding.payloadExpiresAt))));
    if (!(expiresAt > new Date())) unavailable();
    const row = (
      await sql<GrantRow>`INSERT INTO customer_artwork_grants(capability_hash,shop_id,installation_generation,purchase_id,request_id,purpose,slots,expires_at) VALUES(${input.capabilityHash},${scope.shopId},${scope.installationGeneration}::bigint,${input.purchaseId}::uuid,${input.requestId}::uuid,${input.purpose},${JSON.stringify(slots)}::jsonb,${expiresAt}) RETURNING capability_hash,shop_id,installation_generation::text,purchase_id::text,request_id::text,purpose,slots,expires_at,revoked_at`.execute(
        executor,
      )
    ).rows[0];
    if (!row) unavailable();
    return project(row, record);
  }
  return {
    async epoch() {
      return (
        (await sql<{ value: string }>`SELECT value::text FROM customer_artwork_epoch WHERE singleton=true`.execute(db))
          .rows[0]?.value ?? unavailable()
      );
    },
    issue: (scope: PurchaseMerchant, input: Parameters<CustomerArtworkStore['issue']>[1]) =>
      db.transaction().execute((tx) => issue(tx, scope, input)),
    async resolve(hash: string) {
      return db.transaction().execute(async (tx) => {
        const row = await grant(tx, hash);
        if (!row) return null;
        const record = await lockedPurchase(
          tx,
          { shopId: row.shop_id, installationGeneration: row.installation_generation },
          row.purchase_id,
        );
        // Revocation serializes on the purchase lock; discard any pre-lock authority observation.
        if (!(await grant(tx, hash))) return null;
        return project(row, record);
      });
    },
    async attach(hash: string, input: CustomerArtworkAttach) {
      return db.transaction().execute(async (tx) => {
        const row = await grant(tx, hash);
        if (!row) return unavailable();
        const scope = {
          kind: 'merchant' as const,
          shopId: row.shop_id,
          installationGeneration: row.installation_generation,
        };
        let record = await lockedPurchase(tx, scope, row.purchase_id);
        if (!(await grant(tx, hash))) unavailable();
        const requestDigest = sha256CanonicalJson(input);
        const replay = (
          await sql<{
            request_digest: string;
          }>`SELECT request_digest FROM customer_artwork_submissions WHERE capability_hash=${hash} AND request_id=${input.requestId}::uuid`.execute(
            tx,
          )
        ).rows[0];
        if (replay) {
          if (replay.request_digest !== requestDigest) unavailable();
          return project(row, record);
        }
        if (record.artworkVersion !== input.expectedVersion || record.artworkVersion >= 999) unavailable();
        if (
          !project(row, record).slots.some(
            (slot) => slot.groupIndex === input.groupIndex && slot.placementId === input.placementId,
          )
        )
          unavailable();
        const asset = (
          await sql<{
            expires_at: Date;
          }>`SELECT expires_at FROM artwork_assets WHERE asset_id=${input.assetId}::uuid AND shop_id=${row.shop_id} AND installation_generation=${row.installation_generation}::bigint AND owner_kind='guest' AND owner_hash=${hash} AND state='USABLE' AND expires_at>clock_timestamp() FOR SHARE`.execute(
            tx,
          )
        ).rows[0];
        if (!asset) unavailable();
        const eventId = randomUUID();
        await sql`INSERT INTO purchase_artwork_events(event_id,shop_id,installation_generation,purchase_id,version,kind,group_index,placement_id,asset_id,expires_at) VALUES(${eventId}::uuid,${row.shop_id},${row.installation_generation}::bigint,${row.purchase_id}::uuid,${record.artworkVersion + 1},'ATTACH',${input.groupIndex},${input.placementId},${input.assetId}::uuid,${asset.expires_at})`.execute(
          tx,
        );
        await sql`INSERT INTO customer_artwork_submissions(capability_hash,request_id,request_digest,event_id) VALUES(${hash},${input.requestId}::uuid,${requestDigest},${eventId}::uuid)`.execute(
          tx,
        );
        record = (await createPurchaseRepository(tx).get(scope, row.purchase_id)) ?? unavailable();
        return project(row, record);
      });
    },
    async revoke(scope: PurchaseMerchant, purchaseId: string) {
      await db.transaction().execute(async (tx) => {
        if (scope.kind !== 'merchant') unavailable();
        await lockedPurchase(tx, scope, purchaseId);
        await sql`UPDATE customer_artwork_grants SET revoked_at=clock_timestamp() WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint AND purchase_id=${purchaseId}::uuid AND revoked_at IS NULL`.execute(
          tx,
        );
      });
    },
    async pendingNotifications(limit: number) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) unavailable();
      const candidates = (
        await sql<{
          notification_id: string;
          shop_id: string;
          installation_generation: string;
          purchase_id: string;
          order_id: string;
        }>`SELECT n.notification_id::text,n.shop_id,n.installation_generation::text,n.purchase_id::text,p.order_id FROM customer_artwork_notifications n JOIN purchase_orders p USING(purchase_id) JOIN shops s ON s.shop_id=n.shop_id AND s.current_generation=n.installation_generation JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation AND i.deactivated_at IS NULL WHERE n.state IN ('PENDING','NO_EFFECT') AND (n.retry_at IS NULL OR n.retry_at<=clock_timestamp()) AND EXISTS(SELECT 1 FROM purchase_design_payloads d WHERE d.purchase_id=n.purchase_id AND d.payload IS NOT NULL AND d.expires_at>clock_timestamp()) ORDER BY coalesce(n.retry_at,n.created_at),n.notification_id LIMIT ${limit}`.execute(
          db,
        )
      ).rows.map(
        (row): CustomerArtworkNotification => ({
          notificationId: row.notification_id,
          shopId: row.shop_id,
          installationGeneration: row.installation_generation,
          purchaseId: row.purchase_id,
          orderId: row.order_id,
        }),
      );
      const pending: CustomerArtworkNotification[] = [];
      for (const notice of candidates) {
        let keep = false;
        try {
          keep = await db.transaction().execute(async (tx) => {
            const record = await lockedPurchase(
              tx,
              { shopId: notice.shopId, installationGeneration: notice.installationGeneration },
              notice.purchaseId,
            );
            return !!record.firstPaidAt && missing(record).length > 0;
          });
        } catch (error) {
          if (!(error instanceof Error) || error.message !== 'CUSTOMER_ARTWORK_UNAVAILABLE') throw error;
        }
        if (keep) pending.push(notice);
        else
          await sql`UPDATE customer_artwork_notifications SET state='CANCELLED',settled_at=clock_timestamp() WHERE notification_id=${notice.notificationId}::uuid AND state IN ('PENDING','NO_EFFECT')`.execute(
            db,
          );
      }
      return pending;
    },
    async deferNotification(notificationId: string) {
      await sql`UPDATE customer_artwork_notifications SET retry_at=GREATEST(coalesce(retry_at,clock_timestamp()),clock_timestamp()+CASE WHEN attempts>=12 THEN interval '1 hour' ELSE interval '5 minutes' END) WHERE notification_id=${notificationId}::uuid AND state IN ('PENDING','NO_EFFECT')`.execute(
        db,
      );
    },
    async claimNotification(notificationId: string, capabilityHash: string) {
      return db.transaction().execute(async (tx) => {
        const notice = (
          await sql<{
            shop_id: string;
            installation_generation: string;
            purchase_id: string;
          }>`SELECT shop_id,installation_generation::text,purchase_id::text FROM customer_artwork_notifications WHERE notification_id=${notificationId}::uuid AND state IN ('PENDING','NO_EFFECT')`.execute(
            tx,
          )
        ).rows[0];
        if (!notice) return false;
        const scope = {
          kind: 'merchant' as const,
          shopId: notice.shop_id,
          installationGeneration: notice.installation_generation,
        };
        const record = await lockedPurchase(tx, scope, notice.purchase_id);
        const access = await grant(tx, capabilityHash);
        if (
          !record.firstPaidAt ||
          !missing(record).length ||
          !access ||
          access.purchase_id !== notice.purchase_id ||
          access.purpose !== 'paid-email' ||
          access.request_id !== notificationId
        )
          return false;
        const claimed =
          await sql`UPDATE customer_artwork_notifications SET state='DISPATCHING',attempts=attempts+1,claimed_at=clock_timestamp(),capability_hash=${capabilityHash} WHERE notification_id=${notificationId}::uuid AND state IN ('PENDING','NO_EFFECT') AND (retry_at IS NULL OR retry_at<=clock_timestamp()) RETURNING notification_id`.execute(
            tx,
          );
        return claimed.rows.length === 1;
      });
    },
    async settleNotification(notificationId: string, state: 'SENT' | 'NO_EFFECT' | 'UNCERTAIN', receipt?: string) {
      if (
        !['SENT', 'NO_EFFECT', 'UNCERTAIN'].includes(state) ||
        (receipt !== undefined && (!receipt || receipt.length > 512 || /[\r\n\0]/.test(receipt)))
      )
        unavailable();
      const settled =
        await sql`UPDATE customer_artwork_notifications SET state=${state},settled_at=clock_timestamp(),retry_at=CASE WHEN ${state}='NO_EFFECT' THEN clock_timestamp()+CASE WHEN attempts>=12 THEN interval '1 hour' ELSE interval '5 minutes' END ELSE retry_at END,provider_receipt=${receipt ?? null} WHERE notification_id=${notificationId}::uuid AND state='DISPATCHING' RETURNING notification_id`.execute(
          db,
        );
      if (settled.rows.length !== 1) unavailable();
    },
  } satisfies CustomerArtworkStore & CustomerArtworkNotificationStore & Record<string, unknown>;
}
