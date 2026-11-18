import assert from 'node:assert/strict';
import { createHash, randomUUID, sign } from 'node:crypto';
import type { PurchaseObservation } from '@insignia/application';
import { decodeEnvelope, decodeMember, encodeHeader, wholeQuoteSignBytes } from '@insignia/cart-authorization';
import { canonicalDesignIdentity } from '@insignia/domain';
import { sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/client/database.js';
import { sha256CanonicalJson } from '../src/hash/canonical.js';
import { createDurableCore } from '../src/index.js';
import { PgAcceptedQuoteRepository } from '../src/repositories/accepted-quote.js';
import { createArtworkRepository } from '../src/repositories/artwork.js';
import { createPurchaseRepository, webhookIdParsingSupported } from '../src/repositories/purchase.js';
import { createTestShop, openTestDatabase } from './support/postgres.js';
import { purchaseFixture } from './support/purchase-fixture.js';

function requirePurchase(value: Awaited<ReturnType<ReturnType<typeof createPurchaseRepository>['reconcile']>>) {
  assert('purchaseId' in value, 'Expected materialized purchase');
  return value;
}

describe.runIf(Boolean(process.env.DATABASE_URL))('durable reconciled purchases', () => {
  let db: Awaited<ReturnType<typeof openTestDatabase>>;
  beforeAll(async () => {
    db = await openTestDatabase();
  });
  afterAll(async () => {
    await db?.destroy();
  });
  function represented(input: PurchaseObservation) {
    input.order.lines = input.bindings.flatMap((binding) =>
      binding.lines.map((line) => ({
        lineId: line.orderLineId,
        productId: line.productId,
        variantId: line.variantId,
        quantity: line.quantity,
        currentQuantity: line.quantity,
        originalUnitPriceMinor: line.unitPriceMinor,
        sellingPlanId: null,
        attributes: [{ key: '_insignia_quote_v2', value: 'application-verified-at-this-repository-seam' }],
      })),
    );
    return input;
  }
  async function observation(): Promise<PurchaseObservation> {
    const { shopId, generation } = await createTestShop(db);
    return {
      order: {
        shopId,
        installationGeneration: generation,
        orderId: `gid://shopify/Order/${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`)}`,
        createdAt: '2026-10-13T10:00:00.000Z',
        updatedAt: '2026-10-13T10:00:00.000Z',
        observedAt: '2026-10-13T10:01:00.000Z',
        currency: 'EUR',
        country: 'DE',
        marketId: '42',
        totalPriceMinor: '9100',
        contextVerified: true,
        test: true,
        sourceApiVersion: '2026-07',
        edited: false,
        complete: true,
        financialStatus: 'PAID',
        cancelledAt: null,
        lines: [],
        transactions: [],
        refunds: [],
      },
      bindings: [],
      exception: 'AUTHORIZATION_INCOMPLETE',
      firstPaidAt: null,
    };
  }
  it('records incomplete orders distinctly, deduplicates observations and refuses stale tenant writes', async () => {
    const input = await observation(),
      repo = createPurchaseRepository(db);
    const first = requirePurchase(await repo.reconcile(input)),
      again = requirePurchase(await repo.reconcile(input));
    expect(again.purchaseId).toBe(first.purchaseId);
    expect((await repo.get(input.order, first.purchaseId))?.observations).toHaveLength(1);
    const second = requirePurchase(
      await repo.reconcile({
        ...input,
        order: { ...input.order, orderId: `gid://shopify/Order/999${input.order.orderId.split('/').at(-1)}` },
      }),
    );
    expect(second.purchaseId).not.toBe(first.purchaseId);
    const page = await repo.list({ ...input.order, kind: 'merchant' }, { limit: 1 });
    expect(page[0]?.purchaseId).toBe(second.purchaseId);
    const next = await repo.list({ ...input.order, kind: 'merchant' }, { limit: 1, before: second.purchaseId });
    expect(next[0]?.purchaseId).toBe(first.purchaseId);
    const other = await createTestShop(db);
    expect(await repo.get({ ...input.order, shopId: other.shopId }, first.purchaseId)).toBeNull();
    await sql`UPDATE installation_generations SET deactivated_at=clock_timestamp() WHERE shop_id=${input.order.shopId}`.execute(
      db,
    );
    await expect(repo.reconcile(input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('keeps first-paid and full Shopify refunds immutable across reordered duplicate observations', async () => {
    const input = await observation(),
      repo = createPurchaseRepository(db);
    const fixture = await purchaseFixture(db);
    input.order.shopId = fixture.shopId;
    input.order.installationGeneration = fixture.generation;
    input.exception = null;
    input.bindings = [
      {
        quoteId: fixture.quote.quoteId,
        authorizationSetId: fixture.authorization.setId,
        quote: fixture.quote,
        lines: [
          {
            orderLineId: 'gid://shopify/LineItem/55',
            lineIndex: 0,
            productId: fixture.productId,
            variantId: '1',
            quantity: 1,
            unitPriceMinor: '1001',
          },
          {
            orderLineId: 'gid://shopify/LineItem/56',
            lineIndex: 1,
            productId: fixture.productId,
            variantId: '2',
            quantity: 1,
            unitPriceMinor: '1000',
          },
        ],
        designPayload: {
          version: 'm8-purchase-design-v1',
          collectedAt: '2026-10-13T09:00:00.000Z',
          request: { groups: [] },
          revisions: [],
        },
        payloadCollectedAt: '2026-10-13T09:00:00.000Z',
        payloadExpiresAt: '2026-10-20T09:00:00.000Z',
      },
    ];
    input.firstPaidAt = '2026-10-13T10:00:00.000Z';
    input.order.refunds = [
      {
        refundId: 'gid://shopify/Refund/33',
        occurredAt: '2026-10-13T10:02:00.000Z',
        currency: 'EUR',
        amountMinor: '500',
        lines: [{ lineId: 'gid://shopify/LineItem/55', quantity: 1, amountMinor: '500' }],
      },
    ];
    const result = requirePurchase(await repo.reconcile(represented(input)));
    requirePurchase(
      await repo.reconcile({
        ...input,
        firstPaidAt: null,
        order: { ...input.order, updatedAt: '2026-10-13T09:59:00.000Z', financialStatus: 'PENDING', refunds: [] },
      }),
    );
    const view = await repo.get(input.order, result.purchaseId);
    expect(view?.firstPaidAt).toBe('2026-10-13T10:00:00.000Z');
    expect(view?.refunds).toEqual(input.order.refunds);
    expect(view?.originalTotalMinor).toBe('9100');
    await expect(
      repo.reconcile({
        ...input,
        order: { ...input.order, refunds: [{ ...input.order.refunds[0]!, amountMinor: '501' }] },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  async function bound() {
    const input = await observation(),
      fixture = await purchaseFixture(db);
    input.order.shopId = fixture.shopId;
    input.order.installationGeneration = fixture.generation;
    input.exception = null;
    const now = new Date(),
      expires = new Date(+now + 604800000);
    input.bindings = [
      {
        quoteId: fixture.quote.quoteId,
        authorizationSetId: fixture.authorization.setId,
        quote: fixture.quote,
        lines: [
          {
            orderLineId: 'gid://shopify/LineItem/55',
            lineIndex: 0,
            productId: fixture.productId,
            variantId: '1',
            quantity: 1,
            unitPriceMinor: '1001',
          },
          {
            orderLineId: 'gid://shopify/LineItem/56',
            lineIndex: 1,
            productId: fixture.productId,
            variantId: '2',
            quantity: 1,
            unitPriceMinor: '1000',
          },
        ],
        designPayload: {
          version: 'm8-purchase-design-v1',
          collectedAt: now.toISOString(),
          request: {
            groups: [
              {
                group: {
                  design: {
                    placements: [{ placementId: 'front', artwork: { kind: 'deferred', intentId: 'pending' } }],
                  },
                },
              },
            ],
          },
          revisions: [],
        },
        payloadCollectedAt: now.toISOString(),
        payloadExpiresAt: expires.toISOString(),
      },
    ];
    represented(input);
    return { input, fixture, now, expires };
  }
  async function asset(shopId: string, ownerKind: 'guest' | 'merchant', now: Date) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL }),
      store = createArtworkRepository(pool),
      assetId = randomUUID(),
      claimId = randomUUID();
    try {
      await store.create({
        assetId,
        shopId,
        installationGeneration: '1',
        ownerHash: 'b'.repeat(64),
        ownerKind,
        declaredMime: 'image/png',
        declaredBytes: 10,
        state: 'UPLOADING',
        quarantineKey: `q/${assetId}`,
        originalKey: `o/${assetId}`,
        previewKey: `p/${assetId}`,
        collectedAt: now,
        uploadUntil: new Date(+now + 300000),
        expiresAt: new Date(+now + 604800000),
        claimId: null,
        manifest: null,
        rejection: null,
      });
      await store.complete({ shopId, installationGeneration: '1', kind: 'merchant' }, assetId, now);
      await store.claim(assetId, claimId, now, new Date(+now + 60000));
      await store.prepare(
        assetId,
        claimId,
        {
          version: 'm6-inspection-v1',
          mimeType: 'image/png',
          byteLength: 10,
          sha256: '1'.repeat(64),
          width: 1,
          height: 1,
          previewSha256: '2'.repeat(64),
          previewByteLength: 10,
        },
        now,
      );
      await store.settle(assetId, claimId, now);
      return assetId;
    } finally {
      await pool.end();
    }
  }
  it('permits merchant-only append replacements, serializes CAS and freezes the exact ready attachment set', async () => {
    const { input, fixture, now } = await bound(),
      repo = createPurchaseRepository(db),
      scope = { shopId: fixture.shopId, installationGeneration: '1', kind: 'merchant' as const };
    const purchase = requirePurchase(await repo.reconcile(input)),
      guest = await asset(fixture.shopId, 'guest', now),
      first = await asset(fixture.shopId, 'merchant', now),
      second = await asset(fixture.shopId, 'merchant', now);
    expect(purchase.artworkState).toBe('PENDING_ARTWORK');
    await expect(
      repo.lockArtwork(scope, { purchaseId: purchase.purchaseId, expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: 'NOT_READY' });
    await expect(
      repo.appendArtwork(scope, {
        purchaseId: purchase.purchaseId,
        expectedVersion: 0,
        groupIndex: 0,
        placementId: 'front',
        assetId: guest,
        ownerHash: 'b'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await repo.getAuthorizedArtwork(scope, { purchaseId: purchase.purchaseId, assetId: guest })).toBeNull();
    const changes = await Promise.allSettled(
      [first, second].map((assetId) =>
        repo.appendArtwork(scope, {
          purchaseId: purchase.purchaseId,
          expectedVersion: 0,
          groupIndex: 0,
          placementId: 'front',
          assetId,
          ownerHash: 'b'.repeat(64),
        }),
      ),
    );
    expect(changes.filter((c) => c.status === 'fulfilled')).toHaveLength(1);
    const ready = await repo.get(scope, purchase.purchaseId);
    expect(ready?.artworkState).toBe('READY');
    expect(ready?.artworkVersion).toBe(1);
    const replacement = await repo.appendArtwork(scope, {
      purchaseId: purchase.purchaseId,
      expectedVersion: 1,
      groupIndex: 0,
      placementId: 'front',
      assetId: second,
      ownerHash: 'b'.repeat(64),
    });
    expect(replacement.artworkEvents).toHaveLength(2);
    expect(replacement.bindings[0]?.designPayload).toEqual(purchase.bindings[0]?.designPayload);
    expect(
      (await repo.getAuthorizedArtwork(scope, { purchaseId: purchase.purchaseId, assetId: second }))?.assetId,
    ).toBe(second);
    const locked = await repo.lockArtwork(scope, { purchaseId: purchase.purchaseId, expectedVersion: 2 });
    expect(locked.artworkState).toBe('ARTWORK_LOCKED');
    await expect(
      repo.appendArtwork(scope, {
        purchaseId: purchase.purchaseId,
        expectedVersion: 3,
        groupIndex: 0,
        placementId: 'front',
        assetId: first,
        ownerHash: 'b'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(
      sql`UPDATE purchase_bindings SET economics='{}' WHERE purchase_id=${purchase.purchaseId}::uuid`.execute(db),
    ).rejects.toThrow(/immutable/);
    await sql`UPDATE installation_generations SET deactivated_at=clock_timestamp() WHERE shop_id=${fixture.shopId}`.execute(
      db,
    );
    await repo.cleanupDue(1000);
    const payload = (
      await sql<{
        payload: unknown;
        erased_at: Date | null;
      }>`SELECT payload,erased_at FROM purchase_design_payloads WHERE purchase_id=${purchase.purchaseId}::uuid`.execute(
        db,
      )
    ).rows[0];
    expect(payload?.payload).toBeNull();
    expect(payload?.erased_at).not.toBeNull();
    expect(
      (
        await sql<{
          kind: string;
          asset_id: string | null;
        }>`SELECT kind,asset_id::text FROM purchase_artwork_events WHERE purchase_id=${purchase.purchaseId}::uuid ORDER BY version`.execute(
          db,
        )
      ).rows,
    ).toEqual([
      { kind: 'ATTACH', asset_id: null },
      { kind: 'ATTACH', asset_id: null },
      { kind: 'LOCK', asset_id: null },
    ]);
  });
  it('honors original collection deadlines and records edited-order exceptions without replacing purchase economics', async () => {
    const { input, fixture, now } = await bound(),
      repo = createPurchaseRepository(db);
    const p = requirePurchase(await repo.reconcile(input));
    const changed = requirePurchase(
      await repo.reconcile({
        ...input,
        order: { ...input.order, totalPriceMinor: '9200', updatedAt: '2026-10-13T10:02:00.000Z' },
        bindings: [{ ...input.bindings[0]!, lines: [{ ...input.bindings[0]!.lines[0]!, quantity: 9 }] }],
      }),
    );
    expect(changed.originalTotalMinor).toBe('9100');
    expect(changed.bindings).toEqual(p.bindings);
    expect(changed.observations[0]?.exception).toBe('UNSUPPORTED_ORDER_EDIT');
    const oldAsset = await asset(fixture.shopId, 'merchant', new Date(+now - 8 * 86400000));
    await expect(
      repo.appendArtwork(
        { shopId: fixture.shopId, installationGeneration: '1', kind: 'merchant' },
        {
          purchaseId: p.purchaseId,
          expectedVersion: 0,
          groupIndex: 0,
          placementId: 'front',
          assetId: oldAsset,
          ownerHash: 'b'.repeat(64),
        },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(repo.cleanupDue(1001)).rejects.toThrow(/invalid purchase cleanup budget/);
  });

  it('retains economic authorization after design erasure and preserves paid qualification without reopening artwork', async () => {
    const { input, fixture } = await bound(),
      repo = createPurchaseRepository(db);
    const original = input.bindings[0]!;
    input.bindings = [
      {
        ...original,
        designPayload: null,
        payloadCollectedAt: '2026-10-01T09:00:00.000Z',
        payloadExpiresAt: '2026-10-08T09:00:00.000Z',
      },
    ];
    input.firstPaidAt = '2026-10-13T10:00:00.000Z';
    const record = requirePurchase(await repo.reconcile(input));
    const other = requirePurchase(
      await repo.reconcile({
        ...input,
        order: { ...input.order, orderId: `gid://shopify/Order/8${input.order.orderId.split('/').at(-1)}` },
      }),
    );
    expect(other.purchaseId).not.toBe(record.purchaseId);
    expect(other.bindings[0]?.authorizationSetId).toBe(record.bindings[0]?.authorizationSetId);
    expect(record.artworkState).toBe('ERASED');
    expect(record.firstPaidAt).toBe('2026-10-13T10:00:00.000Z');
    expect(record.bindings[0]?.designPayload).toBeNull();
    await sql`INSERT INTO purchase_offer_payloads(shop_id,installation_generation,quote_id,collected_at,expires_at,payload,erased_at) VALUES(${fixture.shopId},1,${original.quoteId}::uuid,'2026-10-01T09:00:00Z','2026-10-08T09:00:00Z',NULL,clock_timestamp())`.execute(
      db,
    );
    const offer = await repo.getOffer({
      shopId: fixture.shopId,
      installationGeneration: '1',
      quoteId: original.quoteId,
      authorizationSetId: original.authorizationSetId,
    });
    expect(offer?.authorization.setId).toBe(original.authorizationSetId);
    expect(offer?.designPayload).toBeNull();
    expect(offer?.payloadCollectedAt).toBe('2026-10-01T09:00:00.000Z');
    expect(offer?.payloadExpiresAt).toBe('2026-10-08T09:00:00.000Z');
  });
  /** Test clock: the receipt's backoff has elapsed (the database clock cannot be advanced). */
  async function retryDue(inboxId: string) {
    await sql`UPDATE inbox_messages SET next_attempt_at=clock_timestamp() WHERE id=${inboxId}::uuid AND next_attempt_at IS NOT NULL`.execute(
      db,
    );
  }
  const databaseNow = async () =>
    (await sql<{ now: Date }>`SELECT clock_timestamp() AS now`.execute(db)).rows[0]!.now.getTime();
  /** A confirmed signed order receipt for the observed order, ready for its first attempt. */
  async function orderReceipt(
    core: ReturnType<typeof createDurableCore>,
    input: PurchaseObservation,
    topic = 'orders/paid',
    resource = 'Order',
    numericId = false,
  ) {
    const domain = `${randomUUID()}.myshopify.com`,
      orderNumber = input.order.orderId.split('/').at(-1)!;
    await sql`UPDATE shops SET shop_domain=${domain} WHERE shop_id=${input.order.shopId}`.execute(db);
    const receipt = await core.webhooks.receive({
      shopDomain: domain,
      topic,
      apiVersion: '2026-07',
      deliveryId: randomUUID(),
      triggeredAt: new Date(),
      eventId: null,
      name: null,
      rawBody: Buffer.from(
        // Shopify sends a numeric id; its exact text needs the parser's numeric source.
        numericId
          ? `{"id":${orderNumber},"admin_graphql_api_id":"gid://shopify/${resource}/${orderNumber}"}`
          : JSON.stringify({ id: orderNumber, admin_graphql_api_id: `gid://shopify/${resource}/${orderNumber}` }),
      ),
    });
    await core.webhooks.withQueueHandoff(receipt.id, async () => 'enqueued');
    return receipt.id;
  }
  const selected = async (repo: ReturnType<typeof createPurchaseRepository>, inboxId: string) =>
    (await repo.selectPurchaseRecoveryHints(1000)).some((hint) => hint.inboxId === inboxId);
  async function failAttempt(repo: ReturnType<typeof createPurchaseRepository>, inboxId: string) {
    const claim = await repo.claimPurchaseReconciliationHint(inboxId);
    expect(claim).not.toBeNull();
    await repo.failPurchaseReconciliation({
      inboxId,
      claimToken: claim!.claimToken,
      failureClass: 'PURCHASE_RECONCILIATION_UNAVAILABLE',
    });
    return claim!.attempts;
  }
  const receiptRow = async (inboxId: string) =>
    (
      await sql<{
        state: string;
        attempts: number;
        last_error_class: string | null;
      }>`SELECT state,attempts,last_error_class FROM inbox_messages WHERE id=${inboxId}::uuid`.execute(db)
    ).rows[0];
  // Spec §11: exponential backoff from 5 seconds, cap 15 minutes, up to 12 automated attempts.
  // Delay in seconds after failed attempt 1..11; the 12th failure ends automated retries.
  const RETRY_DELAYS = [5, 10, 20, 40, 80, 160, 320, 640, 900, 900, 900];
  it('retries a failing order receipt from 5 s doubling to a 15-minute cap and stops after 12 attempts (#491)', async () => {
    const input = await observation(),
      repo = createPurchaseRepository(db),
      core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
    try {
      const id = await orderReceipt(core, input);
      const delays: number[] = [];
      for (let attempt = 1; attempt <= 12; attempt++) {
        expect(await selected(repo, id)).toBe(true);
        const failedAt = await databaseNow();
        expect(await failAttempt(repo, id)).toBe(attempt);
        if (attempt === 12) break;
        const hint = await repo.getPurchaseReconciliationHint(id);
        expect(hint).toMatchObject({ status: 'failed', attempts: attempt });
        const delay = Date.parse(hint!.nextAttemptAt!) - failedAt;
        expect(delay).toBeLessThan(RETRY_DELAYS[attempt - 1]! * 1000 + 1000);
        delays.push(Math.floor(delay / 1000));
        // Not due yet: neither the recovery pass nor a queue retry may claim it.
        expect(await selected(repo, id)).toBe(false);
        expect(await repo.claimPurchaseReconciliationHint(id)).toBeNull();
        await retryDue(id);
      }
      expect(delays).toEqual(RETRY_DELAYS);
      // Budget spent: the receipt stays failed, is never reselected and is left to discovery.
      await retryDue(id);
      expect(await selected(repo, id)).toBe(false);
      expect(await repo.claimPurchaseReconciliationHint(id)).toBeNull();
      expect(await repo.getPurchaseReconciliationHint(id)).toBeNull();
      expect(await receiptRow(id)).toEqual({
        state: 'failed',
        attempts: 12,
        last_error_class: 'PURCHASE_RECONCILIATION_UNAVAILABLE',
      });
    } finally {
      await core.close();
    }
  });
  it('a success between failures ends the receipt retries (#491)', async () => {
    const input = await observation(),
      repo = createPurchaseRepository(db),
      core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
    try {
      const id = await orderReceipt(core, input);
      for (let attempt = 1; attempt <= 3; attempt++) {
        await failAttempt(repo, id);
        await retryDue(id);
      }
      const claim = await repo.claimPurchaseReconciliationHint(id);
      expect(claim?.attempts).toBe(4);
      requirePurchase(await repo.reconcile({ ...input, inboxId: id, claimToken: claim!.claimToken }));
      expect(await receiptRow(id)).toEqual({ state: 'processed', attempts: 4, last_error_class: null });
      await retryDue(id);
      expect(await selected(repo, id)).toBe(false);
      expect(await repo.claimPurchaseReconciliationHint(id)).toBeNull();
    } finally {
      await core.close();
    }
  });
  it('a receipt retried after discovery recorded its order completes without a second write (#491)', async () => {
    const input = await observation(),
      repo = createPurchaseRepository(db),
      core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
    try {
      const id = await orderReceipt(core, input);
      await failAttempt(repo, id);
      await retryDue(id);
      await failAttempt(repo, id);
      // Meanwhile recurring discovery reconciles the same order without a receipt.
      const discovered = requirePurchase(await repo.reconcile(input));
      // The receipt still waits for its backoff, then processes against the recorded facts.
      expect(await repo.claimPurchaseReconciliationHint(id)).toBeNull();
      await retryDue(id);
      const claim = await repo.claimPurchaseReconciliationHint(id);
      expect(claim?.attempts).toBe(3);
      const retried = requirePurchase(await repo.reconcile({ ...input, inboxId: id, claimToken: claim!.claimToken }));
      expect(retried.purchaseId).toBe(discovered.purchaseId);
      expect(retried.observations).toHaveLength(1);
      expect((await receiptRow(id))?.state).toBe('processed');
      const orders = await sql<{
        count: string;
      }>`SELECT count(*)::text AS count FROM purchase_orders WHERE shop_id=${input.order.shopId} AND order_id=${input.order.orderId}`.execute(
        db,
      );
      expect(orders.rows[0]?.count).toBe('1');
    } finally {
      await core.close();
    }
  });
  it('an exhausted receipt stays failed when discovery records its order and alerts after erasure only until that evidence exists (#491, #488)', async () => {
    const input = await observation(),
      repo = createPurchaseRepository(db),
      core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
    try {
      const id = await orderReceipt(core, input, 'orders/create');
      for (let attempt = 1; attempt <= 12; attempt++) {
        await failAttempt(repo, id);
        await retryDue(id);
      }
      expect(await selected(repo, id)).toBe(false);
      await sql`UPDATE inbox_messages SET purge_after=clock_timestamp()+interval '20 milliseconds' WHERE id=${id}::uuid`.execute(
        db,
      );
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect((await core.webhooks.eraseExpiredPayloads(100)).blockedUnsupportedIds).toContain(id);
      requirePurchase(await repo.reconcile(input));
      expect((await core.webhooks.eraseExpiredPayloads(100)).blockedUnsupportedIds).not.toContain(id);
      // No fabricated processing and no further retry: still failed with its spent budget.
      expect(await receiptRow(id)).toEqual({
        state: 'failed',
        attempts: 12,
        last_error_class: 'PURCHASE_RECONCILIATION_UNAVAILABLE',
      });
      expect(await selected(repo, id)).toBe(false);
      expect(await repo.claimPurchaseReconciliationHint(id)).toBeNull();
    } finally {
      await core.close();
    }
  });
  /** Test clock: places the receipts at fixed, increasing receive times days ago, ahead of other tests' receipts. */
  async function receivedDaysAgo(ids: string[], days: number) {
    for (const [index, id] of ids.entries())
      await sql`UPDATE inbox_messages SET received_at=clock_timestamp()-make_interval(days=>${days})+make_interval(secs=>${index}) WHERE id=${id}::uuid`.execute(
        db,
      );
  }
  it('a due receipt is recovered behind more than a pass of receipts the hint rejects (#495)', async () => {
    const repo = createPurchaseRepository(db),
      core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
    try {
      // Rejected by a condition the selection can express: the installation was deactivated.
      const uninstalled = await observation();
      const stale: string[] = [];
      for (let index = 0; index < 21; index++) stale.push(await orderReceipt(core, uninstalled));
      await sql`UPDATE installation_generations SET deactivated_at=clock_timestamp() WHERE shop_id=${uninstalled.order.shopId}`.execute(
        db,
      );
      // Rejected only by the hint itself: a signed body naming another resource.
      const input = await observation();
      const malformed: string[] = [];
      for (let index = 0; index < 21; index++) malformed.push(await orderReceipt(core, input, 'orders/paid', 'Shop'));
      const due = await orderReceipt(core, input);
      await receivedDaysAgo([...stale, ...malformed], 6);
      await receivedDaysAgo([due], 5);
      for (const id of [...stale, ...malformed]) expect(await repo.getPurchaseReconciliationHint(id)).toBeNull();
      const hints = await repo.selectPurchaseRecoveryHints(20);
      expect(hints[0]?.inboxId).toBe(due);
      const claim = await repo.claimPurchaseReconciliationHint(due);
      requirePurchase(await repo.reconcile({ ...input, inboxId: due, claimToken: claim!.claimToken }));
      expect((await receiptRow(due))?.state).toBe('processed');
    } finally {
      await core.close();
    }
  });
  it('a recovery pass scans a bounded number of pages and closes receipts with unusable bodies, so a due one is reached (#495)', async () => {
    const repo = createPurchaseRepository(db),
      core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
    try {
      const input = await observation();
      const malformed: string[] = [];
      for (let index = 0; index < 105; index++) malformed.push(await orderReceipt(core, input, 'orders/paid', 'Shop'));
      const due = await orderReceipt(core, input);
      await receivedDaysAgo(malformed, 7);
      await receivedDaysAgo([due], 6);
      const identity = async () =>
        (
          await sql<{
            id: string;
            state: string;
            attempts: number;
            last_error_class: string | null;
            payload_sha256: string;
          }>`SELECT id::text,state,attempts,last_error_class,payload_sha256 FROM inbox_messages WHERE id=ANY(${malformed}::uuid[]) ORDER BY received_at`.execute(
            db,
          )
        ).rows;
      const before = await identity();
      // One pass reads at most five pages (5 x 20); every unusable body it read leaves the scan for good.
      // (Other test files share the database, so their receipts may take some of those pages.)
      const first = await repo.selectPurchaseRecoveryHints(20);
      expect(first.some((hint) => hint.inboxId === due)).toBe(false);
      const closed = (await identity()).filter((row) => row.last_error_class === 'RECEIPT_BODY_UNUSABLE');
      expect(closed.length).toBeGreaterThan(0);
      expect(closed.length).toBeLessThanOrEqual(100);
      for (const row of closed)
        expect(row).toEqual({
          ...before.find((item) => item.id === row.id),
          state: 'failed',
          last_error_class: 'RECEIPT_BODY_UNUSABLE',
        });
      // Later passes reach the due receipt.
      let reached = false;
      for (let pass = 0; pass < 5 && !reached; pass++)
        reached = (await repo.selectPurchaseRecoveryHints(20)).some((hint) => hint.inboxId === due);
      expect(reached).toBe(true);
      expect(
        (await identity()).every(
          (row) => row.state === 'failed' && row.attempts === 0 && row.last_error_class === 'RECEIPT_BODY_UNUSABLE',
        ),
      ).toBe(true);
      for (const id of malformed.slice(0, 3)) expect(await repo.claimPurchaseReconciliationHint(id)).toBeNull();
      expect((await repo.selectPurchaseRecoveryHints(1000)).some((h) => malformed.includes(h.inboxId))).toBe(false);
    } finally {
      await core.close();
    }
  });
  it('a parser without numeric source text closes no receipt as unusable (#495 review)', async () => {
    const input = await observation(),
      repo = createPurchaseRepository(db),
      core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
    const parse = JSON.parse;
    try {
      const id = await orderReceipt(core, input, 'orders/paid', 'Order', true);
      await receivedDaysAgo([id], 8);
      // Simulates a runtime whose reviver receives no `context` (no `context.source`).
      JSON.parse = (text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) =>
        parse(text, reviver && ((key, value) => reviver(key, value)));
      expect(webhookIdParsingSupported()).toBe(false);
      expect(await repo.selectPurchaseRecoveryHints(20)).not.toContainEqual(expect.objectContaining({ inboxId: id }));
      expect(await receiptRow(id)).toEqual({ state: 'pending', attempts: 0, last_error_class: null });
      JSON.parse = parse;
      expect(webhookIdParsingSupported()).toBe(true);
      expect((await repo.selectPurchaseRecoveryHints(20))[0]?.inboxId).toBe(id);
      const claim = await repo.claimPurchaseReconciliationHint(id);
      requirePurchase(await repo.reconcile({ ...input, inboxId: id, claimToken: claim!.claimToken }));
    } finally {
      JSON.parse = parse;
      await core.close();
    }
  });
  it('recovery closes a receipt whose lease expired on its last attempt as failed and never retries it (#496)', async () => {
    const input = await observation(),
      repo = createPurchaseRepository(db),
      core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
    try {
      const id = await orderReceipt(core, input, 'orders/create');
      for (let attempt = 1; attempt <= 11; attempt++) {
        await failAttempt(repo, id);
        await retryDue(id);
      }
      const identity = async () =>
        (
          await sql<{
            shop_id: string;
            installation_generation: string;
            payload_sha256: string;
            received_at: Date;
          }>`SELECT shop_id,installation_generation::text,payload_sha256,received_at FROM inbox_messages WHERE id=${id}::uuid`.execute(
            db,
          )
        ).rows[0];
      const before = await identity();
      // The worker claims the 12th attempt and crashes: no success and no failure is recorded.
      expect((await repo.claimPurchaseReconciliationHint(id))?.attempts).toBe(12);
      await repo.selectPurchaseRecoveryHints(1000);
      expect((await receiptRow(id))?.state).toBe('leased'); // An unexpired lease is still the worker's.
      await sql`UPDATE inbox_messages SET lease_until=clock_timestamp()-interval '1 second' WHERE id=${id}::uuid`.execute(
        db,
      );
      expect(await selected(repo, id)).toBe(false);
      expect(await receiptRow(id)).toEqual({
        state: 'failed',
        attempts: 12,
        last_error_class: 'ATTEMPTS_EXHAUSTED_AFTER_LEASE',
      });
      expect(await identity()).toEqual(before);
      const lease = await sql<{
        lease_owner: string | null;
        next_attempt_at: Date | null;
      }>`SELECT lease_owner,next_attempt_at FROM inbox_messages WHERE id=${id}::uuid`.execute(db);
      expect(lease.rows[0]).toEqual({ lease_owner: null, next_attempt_at: null });
      expect(await repo.claimPurchaseReconciliationHint(id)).toBeNull();
      expect(await repo.getPurchaseReconciliationHint(id)).toBeNull();
      await repo.selectPurchaseRecoveryHints(1000);
      expect(await receiptRow(id)).toEqual({
        state: 'failed',
        attempts: 12,
        last_error_class: 'ATTEMPTS_EXHAUSTED_AFTER_LEASE',
      });
      // #488/#490: a failed receipt still alerts after erasure until discovery records its order.
      await sql`UPDATE inbox_messages SET purge_after=clock_timestamp()+interval '20 milliseconds' WHERE id=${id}::uuid`.execute(
        db,
      );
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect((await core.webhooks.eraseExpiredPayloads(100)).blockedUnsupportedIds).toContain(id);
      requirePurchase(await repo.reconcile(input));
      expect((await core.webhooks.eraseExpiredPayloads(100)).blockedUnsupportedIds).not.toContain(id);
    } finally {
      await core.close();
    }
  });
  it('uses signed bodies only as bounded read hints, reserves durable attempts and commits inbox completion with facts', async () => {
    const input = await observation(),
      repo = createPurchaseRepository(db),
      pool = new Pool({ connectionString: process.env.DATABASE_URL }),
      core = createDurableCore(pool);
    const domain = `${randomUUID()}.myshopify.com`,
      orderNumber = input.order.orderId.split('/').at(-1)!;
    await sql`UPDATE shops SET shop_domain=${domain} WHERE shop_id=${input.order.shopId}`.execute(db);
    try {
      const receipt = await core.webhooks.receive({
        shopDomain: domain,
        topic: 'orders/paid',
        apiVersion: '2026-07',
        deliveryId: randomUUID(),
        triggeredAt: new Date(),
        eventId: null,
        name: null,
        rawBody: Buffer.from(
          JSON.stringify({
            id: orderNumber,
            admin_graphql_api_id: `gid://shopify/Order/${orderNumber}`,
            untrusted_price: '0.01',
          }),
        ),
      });
      const wrongPurpose = await core.webhooks.receive({
        shopDomain: domain,
        topic: 'orders/paid',
        apiVersion: '2026-07',
        deliveryId: randomUUID(),
        triggeredAt: new Date(),
        eventId: null,
        name: null,
        rawBody: Buffer.from(
          JSON.stringify({
            id: orderNumber,
            admin_graphql_api_id: `gid://shopify/Shop/${orderNumber}`,
            myshopify_domain: domain,
          }),
        ),
      });
      expect(await repo.getPurchaseReconciliationHint(wrongPurpose.id)).toBeNull();
      expect(await repo.claimPurchaseReconciliationHint(wrongPurpose.id)).toBeNull();
      expect((await core.webhooks.getById(wrongPurpose.id))?.state).toBe('pending');
      expect(await repo.getPurchaseReconciliationHint(receipt.id)).toMatchObject({
        orderId: input.order.orderId,
        shopId: input.order.shopId,
        topic: 'orders/paid',
        attempts: 0,
      });
      expect(await repo.claimPurchaseReconciliationHint(receipt.id)).toBeNull(); // No confirmed queue budget yet.
      await core.webhooks.withQueueHandoff(receipt.id, async () => 'enqueued');
      for (let index = 0; index < 4; index++) {
        const claim = await repo.claimPurchaseReconciliationHint(receipt.id);
        expect(claim?.attempts).toBe(index + 1);
        expect(await repo.claimPurchaseReconciliationHint(receipt.id)).toBeNull();
        await repo.failPurchaseReconciliation({
          inboxId: receipt.id,
          claimToken: claim!.claimToken,
          failureClass: 'PROVIDER_UNAVAILABLE',
        });
        await retryDue(receipt.id);
      }
      const final = await repo.claimPurchaseReconciliationHint(receipt.id);
      expect(final?.attempts).toBe(5);
      await expect(
        repo.reconcile({
          ...input,
          order: { ...input.order, orderId: 'gid://shopify/Order/99' },
          inboxId: receipt.id,
          claimToken: final!.claimToken,
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      requirePurchase(await repo.reconcile({ ...input, inboxId: receipt.id, claimToken: final!.claimToken }));
      expect((await core.webhooks.getById(receipt.id))?.state).toBe('processed');
      expect(await repo.getPurchaseReconciliationHint(receipt.id)).toBeNull();
      expect(await repo.claimPurchaseReconciliationHint(receipt.id)).toBeNull();
    } finally {
      await core.close();
    }
  });
  it('never silently falls back to old purchased artwork after a chosen replacement is erased', async () => {
    const { input, fixture, now } = await bound(),
      repo = createPurchaseRepository(db),
      scope = { shopId: fixture.shopId, installationGeneration: '1', kind: 'merchant' as const };
    const original = await asset(fixture.shopId, 'guest', now),
      expired = await asset(fixture.shopId, 'merchant', new Date(+now - 8 * 86400000));
    const payload = input.bindings[0]!.designPayload as {
      request: { groups: { group: { design: { placements: { artwork: unknown }[] } } }[] };
    };
    payload.request.groups[0]!.group.design.placements[0]!.artwork = { kind: 'revision', revisionId: original };
    const p = requirePurchase(await repo.reconcile(input));
    expect(p.artworkState).toBe('READY');
    await sql`INSERT INTO purchase_artwork_events(event_id,shop_id,installation_generation,purchase_id,version,kind,group_index,placement_id,asset_id,expires_at) VALUES(${randomUUID()}::uuid,${fixture.shopId},1,${p.purchaseId}::uuid,1,'ATTACH',0,'front',${expired}::uuid,clock_timestamp()-interval '1 day')`.execute(
      db,
    );
    expect((await repo.get(scope, p.purchaseId))?.artworkState).toBe('ERASED');
    await repo.cleanupDue(1000);
    expect((await repo.get(scope, p.purchaseId))?.artworkState).toBe('ERASED');
    const fresh = await asset(fixture.shopId, 'merchant', now);
    const repaired = await repo.appendArtwork(scope, {
      purchaseId: p.purchaseId,
      expectedVersion: 1,
      groupIndex: 0,
      placementId: 'front',
      assetId: fresh,
      ownerHash: 'b'.repeat(64),
    });
    expect(repaired.artworkState).toBe('READY');
  });
  it('qualifies cleanup EXECUTE without private-table or caller-selected-clock authority', async () => {
    const fixture = await purchaseFixture(db),
      pool = new Pool({ connectionString: process.env.DATABASE_URL }),
      client = await pool.connect();
    const role = `m8_cleanup_${randomUUID().replaceAll('-', '')}`;
    try {
      await client.query(`CREATE ROLE ${role} NOLOGIN`);
      await client.query(`GRANT EXECUTE ON FUNCTION public.cleanup_purchase_payloads(integer) TO ${role}`);
      await client.query(
        "INSERT INTO purchase_offer_payloads(shop_id,installation_generation,quote_id,collected_at,expires_at,payload) VALUES($1,1,$2,'2026-10-01T09:00:00Z','2026-10-08T09:00:00Z',$3::jsonb)",
        [fixture.shopId, fixture.quote.quoteId, JSON.stringify({ private: 'owned synthetic retained source' })],
      );
      await client.query(`SET ROLE ${role}`);
      await expect(client.query('SELECT payload FROM purchase_offer_payloads')).rejects.toThrow(/permission denied/);
      await expect(client.query('DELETE FROM purchase_orders')).rejects.toThrow(/permission denied/);
      await expect(
        client.query("SELECT public.cleanup_purchase_payloads(clock_timestamp()+interval '1 year',100)"),
      ).rejects.toThrow(/does not exist/);
      await expect(client.query('SELECT public.cleanup_purchase_payloads(1001)')).rejects.toThrow(
        /invalid purchase cleanup budget/,
      );
      await client.query('SELECT public.cleanup_purchase_payloads(1000)');
      await client.query('RESET ROLE');
      const result = await client.query('SELECT payload,erased_at FROM purchase_offer_payloads WHERE quote_id=$1', [
        fixture.quote.quoteId,
      ]);
      expect(result.rows[0]?.payload).toBeNull();
      expect(result.rows[0]?.erased_at).toBeInstanceOf(Date);
      const quote = await client.query('SELECT quote_value FROM accepted_quotes WHERE quote_id=$1', [
        fixture.quote.quoteId,
      ]);
      expect(quote.rows[0]?.quote_value).toEqual(fixture.quote);
    } finally {
      await client.query('RESET ROLE');
      await client.query(`DROP OWNED BY ${role}`);
      await client.query(`DROP ROLE ${role}`);
      client.release();
      await pool.end();
    }
  });
  it('skips ordinary commerce and retains known purchase facts when customized markers later disappear', async () => {
    const ordinary = await observation(),
      repo = createPurchaseRepository(db);
    ordinary.exception = null;
    ordinary.firstPaidAt = '2026-10-13T10:00:00.000Z';
    expect(await repo.reconcile(ordinary)).toEqual({ kind: 'not_customized' });
    expect(await repo.list({ shopId: ordinary.order.shopId, installationGeneration: '1', kind: 'merchant' })).toEqual(
      [],
    );
    const { input, fixture } = await bound();
    input.firstPaidAt = '2026-10-13T10:00:00.000Z';
    const original = requirePurchase(await repo.reconcile(input));
    const result = requirePurchase(
      await repo.reconcile({
        ...input,
        bindings: [],
        order: {
          ...input.order,
          updatedAt: '2026-10-13T10:05:00.000Z',
          lines: input.order.lines.map((line) => ({ ...line, attributes: [] })),
          refunds: [
            {
              refundId: 'gid://shopify/Refund/99',
              occurredAt: '2026-10-13T10:06:00.000Z',
              currency: 'EUR',
              amountMinor: '200',
              lines: [],
            },
          ],
        },
      }),
    );
    if ('kind' in result) throw new Error('lost customized purchase');
    expect(result.purchaseId).toBe(original.purchaseId);
    expect(result.bindings).toEqual(original.bindings);
    expect(result.firstPaidAt).toBe(original.firstPaidAt);
    expect(result.observations[0]?.exception).toBe('CUSTOMIZATION_MARKERS_MISSING');
    expect(result.refunds[0]?.amountMinor).toBe('200');
  });
  it('reads numeric Order and Refund identities losslessly and denies ambiguous or out-of-u64 ID literals', async () => {
    const { shopId } = await createTestShop(db),
      pool = new Pool({ connectionString: process.env.DATABASE_URL }),
      core = createDurableCore(pool),
      repo = createPurchaseRepository(db);
    const domain = `${randomUUID()}.myshopify.com`;
    await sql`UPDATE shops SET shop_domain=${domain} WHERE shop_id=${shopId}`.execute(db);
    async function receipt(topic: string, body: string) {
      return core.webhooks.receive({
        shopDomain: domain,
        topic,
        apiVersion: '2026-07',
        deliveryId: randomUUID(),
        triggeredAt: new Date(),
        eventId: null,
        name: null,
        rawBody: Buffer.from(body),
      });
    }
    try {
      const order = await receipt(
        'orders/create',
        '{"id":1234567890123456789,"admin_graphql_api_id":"gid://shopify/Order/1234567890123456789"}',
      );
      expect(await repo.getPurchaseReconciliationHint(order.id)).toMatchObject({
        orderId: 'gid://shopify/Order/1234567890123456789',
        attempts: 0,
      });
      const refund = await receipt(
        'refunds/create',
        '{"id":2234567890123456789,"order_id":1234567890123456789,"admin_graphql_api_id":"gid://shopify/Refund/2234567890123456789"}',
      );
      expect(await repo.getPurchaseReconciliationHint(refund.id)).toMatchObject({
        orderId: 'gid://shopify/Order/1234567890123456789',
        topic: 'refunds/create',
      });
      const max = await receipt(
        'orders/paid',
        '{"id":18446744073709551615,"admin_graphql_api_id":"gid://shopify/Order/18446744073709551615"}',
      );
      expect(await repo.getPurchaseReconciliationHint(max.id)).toMatchObject({
        orderId: 'gid://shopify/Order/18446744073709551615',
      });
      for (const literal of [
        '1234567890123456789',
        '18446744073709551616',
        '-1',
        '1.0',
        '1e3',
        '0',
        '"001"',
        '"18446744073709551616"',
      ]) {
        const invalid = await receipt(
          'orders/paid',
          `{"id":${literal},"admin_graphql_api_id":"gid://shopify/Order/1"}`,
        );
        expect(await repo.getPurchaseReconciliationHint(invalid.id)).toBeNull();
        expect(await repo.claimPurchaseReconciliationHint(invalid.id)).toBeNull();
        expect((await core.webhooks.getById(invalid.id))?.state).toBe('pending');
      }
      for (const [literal, gid] of [
        ['1e3', '1000'],
        ['1234.0', '1234'],
        ['18446744073709551616', '18446744073709551616'],
        ['"18446744073709551616"', '18446744073709551616'],
      ]) {
        const invalid = await receipt(
          'orders/paid',
          `{"id":${literal},"admin_graphql_api_id":"gid://shopify/Order/${gid}"}`,
        );
        expect(await repo.getPurchaseReconciliationHint(invalid.id)).toBeNull();
      }
      const mismatch = await receipt(
        'refunds/create',
        '{"id":2234567890123456789,"order_id":1234567890123456789,"admin_graphql_api_id":"gid://shopify/Refund/2234567890123456768"}',
      );
      expect(await repo.getPurchaseReconciliationHint(mismatch.id)).toBeNull();
    } finally {
      await core.close();
    }
  });
  it('reserves one lock event at the artwork response budget and denies further attachment before effects', async () => {
    const { input, fixture, now } = await bound(),
      repo = createPurchaseRepository(db),
      scope = { shopId: fixture.shopId, installationGeneration: '1', kind: 'merchant' as const };
    const p = requirePurchase(await repo.reconcile(input));
    if ('kind' in p) throw new Error('missing customized purchase');
    const usable = await asset(fixture.shopId, 'merchant', now);
    await sql`INSERT INTO purchase_artwork_events(event_id,shop_id,installation_generation,purchase_id,version,kind,group_index,placement_id,asset_id,expires_at)
      SELECT gen_random_uuid(),${fixture.shopId},1,${p.purchaseId}::uuid,version,'ATTACH',0,'front',${usable}::uuid,${new Date(+now + 604800000)} FROM generate_series(1,999) AS version`.execute(
      db,
    );
    expect((await repo.get(scope, p.purchaseId))?.artworkVersion).toBe(999);
    await expect(
      repo
        .appendArtwork(scope, {
          purchaseId: p.purchaseId,
          expectedVersion: 999,
          groupIndex: 0,
          placementId: 'front',
          assetId: usable,
          ownerHash: 'b'.repeat(64),
        })
        .then(() => 'committed'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const unchanged = await repo.get(scope, p.purchaseId);
    expect(unchanged?.artworkVersion).toBe(999);
    expect(unchanged?.artworkEvents).toHaveLength(999);
    const locked = await repo.lockArtwork(scope, { purchaseId: p.purchaseId, expectedVersion: 999 });
    expect(locked.artworkState).toBe('ARTWORK_LOCKED');
    expect(locked.artworkVersion).toBe(1000);
    expect(locked.artworkEvents).toHaveLength(1000);
  });
  it('returns one accepted historical group for identical designs split across reversed raw variant entries', async () => {
    const fixture = await purchaseFixture(db),
      repo = createPurchaseRepository(db),
      now = new Date();
    const design = {
      placements: [
        {
          placementId: 'front',
          methodId: 'method',
          stepId: 'step',
          artwork: { kind: 'revision' as const, revisionId: randomUUID() },
        },
      ],
      options: [],
    };
    const group = {
      version: 'm2-customization-group-v1' as const,
      shopId: fixture.shopId,
      productId: fixture.productId,
      configRevisionId: fixture.revisionId,
      revisionContentHash: fixture.contentHash,
      design,
      variants: [{ variantId: '2', quantity: 1 }],
    };
    const rawRequest = {
      shopId: fixture.shopId,
      installationGeneration: '1',
      idempotencyKey: 'split-design',
      country: 'US',
      marketId: '42',
      capacity: { ordinaryLineCount: 0, inputBytes: 1 },
      groups: [{ group }, { group: { ...group, variants: [{ variantId: '1', quantity: 1 }] } }],
    };
    const quoteId = randomUUID(),
      setId = randomUUID(),
      quote = {
        ...fixture.quote,
        quoteId,
        physicalGroups: [
          {
            ...fixture.quote.physicalGroups[0]!,
            canonicalIdentitySha256: createHash('sha256').update(canonicalDesignIdentity(group)).digest('hex'),
          },
        ],
      };
    const header = {
      ...decodeEnvelope(fixture.authorization.envelopeCarrier).header,
      quoteHex: quoteId.replaceAll('-', ''),
      setHex: setId.replaceAll('-', ''),
    };
    const members = fixture.authorization.members.map((member) =>
      decodeMember(Buffer.from(member.carrier, 'base64url')),
    );
    const authorization = {
      ...fixture.authorization,
      setId,
      envelopeCarrier: Buffer.concat([
        encodeHeader(header),
        sign(null, wholeQuoteSignBytes(header, members), fixture.keys.privateKey),
      ]).toString('base64url'),
    };
    await new PgAcceptedQuoteRepository(db).accept(
      {
        shopId: fixture.shopId,
        installationGeneration: '1',
        authorizationGeneration: fixture.authorizationGeneration,
        authorizationEpoch: fixture.authorizationEpoch,
        idempotencyKey: 'split-design',
        requestDigest: 'c'.repeat(64),
        effectiveRevisions: quote.effectiveRevisions,
      },
      async () => ({ quote, authorization }),
    );
    const geometry = {
      version: 'm5-geometry-v1',
      views: [
        {
          id: 'front',
          variantImages: [],
          placements: [{ id: 'front', rect: { centerX: 0.5, centerY: 0.5, width: 0.3, height: 0.3 } }],
        },
      ],
      steps: [{ id: 'step', widthFraction: 0.5, heightFraction: 0.5 }],
    };
    const presentation = {
      version: 'm5-presentation-v1',
      labels: { methods: { method: 'Method' }, placements: { front: 'Front' }, steps: { step: 'Step' } },
    };
    await sql`INSERT INTO config_revision_geometry(shop_id,config_id,revision_id,schema_version,mode,geometry_value,content_hash) VALUES(${fixture.shopId},${fixture.configId},${fixture.revisionId},'m5-geometry-v1','optional',${JSON.stringify(geometry)}::jsonb,${sha256CanonicalJson(geometry)})`.execute(
      db,
    );
    await sql`INSERT INTO config_revision_presentation(shop_id,config_id,revision_id,schema_version,presentation_value,content_hash) VALUES(${fixture.shopId},${fixture.configId},${fixture.revisionId},'m5-presentation-v1',${JSON.stringify(presentation)}::jsonb,${sha256CanonicalJson(presentation)})`.execute(
      db,
    );
    await sql`INSERT INTO purchase_offer_payloads(shop_id,installation_generation,quote_id,collected_at,expires_at,payload) VALUES(${fixture.shopId},1,${quoteId}::uuid,${now},${new Date(+now + 604800000)},${JSON.stringify(rawRequest)}::jsonb)`.execute(
      db,
    );
    const offer = await repo.getOffer({
      shopId: fixture.shopId,
      installationGeneration: '1',
      quoteId,
      authorizationSetId: setId,
    });
    expect(offer).not.toBeNull();
    const payload = offer?.designPayload as {
      request: { groups: { group: { design: unknown; variants: unknown } }[] };
      revisions: { revisionId: string }[];
    };
    expect(payload.request.groups).toHaveLength(1);
    expect(payload.request.groups[0]?.group.variants).toEqual([
      { variantId: '1', quantity: 1 },
      { variantId: '2', quantity: 1 },
    ]);
    expect(payload.request.groups[0]?.group.design).toEqual(design);
    expect(payload.revisions[0]?.revisionId).toBe(fixture.revisionId);
    const original = (
      await sql<{
        payload: unknown;
      }>`SELECT payload FROM purchase_offer_payloads WHERE quote_id=${quoteId}::uuid`.execute(db)
    ).rows[0]?.payload;
    expect(original).toEqual(rawRequest); // Historical read normalization does not rewrite collection evidence.
    if (!offer) throw new Error('missing verified historical offer');
    const observed = await observation();
    observed.order = {
      ...observed.order,
      shopId: fixture.shopId,
      currency: 'USD',
      country: 'US',
      marketId: '42',
      totalPriceMinor: '2001',
    };
    observed.exception = null;
    observed.bindings = [
      {
        quoteId,
        authorizationSetId: setId,
        quote: offer.quote,
        designPayload: offer.designPayload,
        payloadCollectedAt: offer.payloadCollectedAt,
        payloadExpiresAt: offer.payloadExpiresAt,
        lines: quote.economics.lines.map((line) => ({
          orderLineId: `gid://shopify/LineItem/${55 + line.lineIndex}`,
          lineIndex: line.lineIndex,
          productId: fixture.productId,
          variantId: line.variantId,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
        })),
      },
    ];
    const purchase = requirePurchase(await repo.reconcile(represented(observed)));
    if ('kind' in purchase) throw new Error('lost complete purchase');
    expect(purchase.bindings[0]?.designPayload?.request.groups).toHaveLength(1);
    expect(purchase.bindings[0]?.lines.map((line) => line.variantId)).toEqual(['1', '2']);
  });
  it('attaches and locks artwork through one PostgreSQL connection without acquiring a nested pool connection', async () => {
    const { input, fixture, now } = await bound(),
      setup = createPurchaseRepository(db),
      purchase = requirePurchase(await setup.reconcile(input));
    if ('kind' in purchase) throw new Error('missing customized purchase');
    const usable = await asset(fixture.shopId, 'merchant', now);
    const single = createDatabase(
        new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 250 }),
      ),
      repo = createPurchaseRepository(single),
      scope = { shopId: fixture.shopId, installationGeneration: '1', kind: 'merchant' as const };
    try {
      const attached = await repo.appendArtwork(scope, {
        purchaseId: purchase.purchaseId,
        expectedVersion: 0,
        groupIndex: 0,
        placementId: 'front',
        assetId: usable,
        ownerHash: 'b'.repeat(64),
      });
      expect(attached.artworkState).toBe('READY');
      expect(attached.artworkVersion).toBe(1);
      const locked = await repo.lockArtwork(scope, { purchaseId: purchase.purchaseId, expectedVersion: 1 });
      expect(locked.artworkState).toBe('ARTWORK_LOCKED');
      expect(locked.artworkVersion).toBe(2);
    } finally {
      await single.destroy();
    }
  });

  it('preserves independently read non-test authority and flags later test-status drift without rewriting it', async () => {
    const { input, fixture } = await bound(),
      repo = createPurchaseRepository(db);
    input.order.test = false;
    const original = requirePurchase(await repo.reconcile(input));
    if ('kind' in original) throw new Error('missing customized purchase');
    expect(original.isTest).toBe(false);
    const changed = requirePurchase(
      await repo.reconcile({
        ...input,
        order: { ...input.order, test: true, updatedAt: '2026-10-13T10:10:00.000Z' },
      }),
    );
    if ('kind' in changed) throw new Error('lost customized purchase');
    expect(changed.isTest).toBe(false);
    expect(changed.observations[0]?.exception).toBe('UNSUPPORTED_ORDER_EDIT');
    const legacyId = randomUUID();
    await sql`INSERT INTO purchase_orders(purchase_id,shop_id,installation_generation,order_id,order_created_at,currency,original_total_minor) VALUES(${legacyId}::uuid,${fixture.shopId},1,'gid://shopify/Order/99900999',clock_timestamp(),'EUR',9100)`.execute(
      db,
    );
    expect((await repo.get({ shopId: fixture.shopId, installationGeneration: '1' }, legacyId))?.isTest).toBeNull();
  });

  it('a subset order needs artwork only for ordered designs and keeps signed design indices', async () => {
    const { input, fixture, now } = await bound(),
      repo = createPurchaseRepository(db),
      scope = { shopId: fixture.shopId, installationGeneration: '1', kind: 'merchant' as const };
    const binding = input.bindings[0];
    if (!binding) throw new Error('missing binding');
    const design = (variantId: string, placementId: string) => ({
      group: {
        productId: fixture.productId,
        configRevisionId: fixture.revisionId,
        variants: [{ variantId, quantity: 1 }],
        design: { placements: [{ placementId, artwork: { kind: 'deferred', intentId: placementId } }] },
      },
    });
    // Two signed designs; the v3 order contains only design 1 (economics line 1) at a new quantity.
    input.bindings = [
      {
        ...binding,
        lines: [
          {
            orderLineId: 'gid://shopify/LineItem/56',
            lineIndex: 1,
            productId: fixture.productId,
            variantId: '2',
            quantity: 3,
            unitPriceMinor: '1000',
          },
        ],
        designPayload: {
          ...(binding.designPayload as Record<string, unknown>),
          request: { groups: [design('1', 'front'), design('2', 'back')] },
        },
      },
    ];
    represented(input);
    const purchase = requirePurchase(await repo.reconcile(input));
    if ('kind' in purchase) throw new Error('missing customized purchase');
    expect(purchase.bindings[0]?.lines.map((line) => [line.lineIndex, line.quantity])).toEqual([[1, 3]]);
    expect(purchase.artworkState).toBe('PENDING_ARTWORK');
    const usable = await asset(fixture.shopId, 'merchant', now);
    const attach = (groupIndex: number, placementId: string, expectedVersion: number) =>
      repo.appendArtwork(scope, {
        purchaseId: purchase.purchaseId,
        expectedVersion,
        groupIndex,
        placementId,
        assetId: usable,
        ownerHash: 'b'.repeat(64),
      });
    // The unordered design (signed index 0) is not production work: no attachment slot.
    await expect(attach(0, 'front', 0)).rejects.toMatchObject({ code: 'EXPIRED' });
    const attached = await attach(1, 'back', 0);
    expect(attached.artworkState).toBe('READY');
    expect(attached.artworkEvents[0]?.groupIndex).toBe(1);
    const complete = await repo.list(scope, { artwork: 'complete' });
    expect(complete.map((p) => p?.purchaseId)).toContain(purchase.purchaseId);
    const locked = await repo.lockArtwork(scope, { purchaseId: purchase.purchaseId, expectedVersion: 1 });
    expect(locked.artworkState).toBe('ARTWORK_LOCKED');
  });
  // Spec §10.4: 7 days is for unfinished work; a recorded order keeps its production detail until six
  // calendar months after collection (less a 2-day time-zone margin), never longer.
  async function retention(purchaseId: string, assetIds: string[]) {
    const payload = (
      await sql<{
        expires_at: Date;
        deadline: Date;
        max: Date;
      }>`SELECT expires_at,public.purchased_retention_deadline(collected_at) AS deadline,collected_at+interval '6 months' AS max FROM purchase_design_payloads WHERE purchase_id=${purchaseId}::uuid`.execute(
        db,
      )
    ).rows[0]!;
    const assets = (
      await sql<{
        asset_id: string;
        expires_at: Date;
        deadline: Date;
        week: Date;
      }>`SELECT asset_id::text,expires_at,least(public.purchased_retention_deadline(collected_at),${payload.expires_at}::timestamptz) AS deadline,collected_at+interval '7 days' AS week FROM artwork_assets WHERE asset_id=ANY(${assetIds}::uuid[])`.execute(
        db,
      )
    ).rows;
    return { payload, assets: Object.fromEntries(assets.map((a) => [a.asset_id, a])) };
  }
  function referencing(input: PurchaseObservation, assetId: string) {
    const payload = input.bindings[0]!.designPayload as {
      request: { groups: { group: { design: { placements: { artwork: unknown }[] } } }[] };
    };
    payload.request.groups[0]!.group.design.placements[0]!.artwork = { kind: 'revision', revisionId: assetId };
  }
  it('keeps a recorded unpaid order’s artwork and design six calendar months; unreferenced uploads keep 7 days', async () => {
    const { input, fixture, now } = await bound(),
      repo = createPurchaseRepository(db),
      pool = new Pool({ connectionString: process.env.DATABASE_URL }),
      store = createArtworkRepository(pool);
    try {
      input.order.financialStatus = 'PENDING';
      const used = await asset(fixture.shopId, 'guest', now),
        draft = await asset(fixture.shopId, 'guest', now);
      referencing(input, used);
      const p = requirePurchase(await repo.reconcile(input));
      expect(p.firstPaidAt).toBeNull();
      const { payload, assets } = await retention(p.purchaseId, [used, draft]);
      expect(payload.expires_at).toEqual(payload.deadline);
      expect(+payload.expires_at).toBeLessThanOrEqual(+payload.max);
      expect(+payload.expires_at).toBeGreaterThan(+now + 170 * 86400000);
      expect(p.bindings[0]?.payloadExpiresAt).toBe(payload.expires_at.toISOString());
      expect(assets[used]?.expires_at).toEqual(assets[used]?.deadline);
      expect(+assets[draft]!.expires_at).toBeLessThanOrEqual(+assets[draft]!.week);
      // The inspector's retention sweep, eight days on: the abandoned upload goes, the order's stays.
      const later = new Date(+now + 8 * 86400000);
      expect(await store.markDeleting(used, later)).toBeNull();
      expect((await store.markDeleting(draft, later))?.assetId).toBe(draft);
      await repo.cleanupDue(1000);
      const kept = await repo.get(input.order, p.purchaseId);
      expect(kept?.bindings[0]?.designPayload).not.toBeNull();
      expect(kept?.artworkState).toBe('READY');
    } finally {
      await pool.end();
    }
  });
  it('extends merchant replacement artwork with its attachment, never past the order’s design', async () => {
    const { input, fixture, now } = await bound(),
      repo = createPurchaseRepository(db),
      scope = { shopId: fixture.shopId, installationGeneration: '1', kind: 'merchant' as const };
    const p = requirePurchase(await repo.reconcile(input));
    const replacement = await asset(fixture.shopId, 'merchant', now);
    const attached = await repo.appendArtwork(scope, {
      purchaseId: p.purchaseId,
      expectedVersion: 0,
      groupIndex: 0,
      placementId: 'front',
      assetId: replacement,
      ownerHash: 'b'.repeat(64),
    });
    const { payload, assets } = await retention(p.purchaseId, [replacement]);
    expect(assets[replacement]?.expires_at).toEqual(assets[replacement]?.deadline);
    expect(+assets[replacement]!.expires_at).toBeLessThanOrEqual(+payload.expires_at);
    expect(attached.artworkEvents[0]?.expiresAt).toBe(assets[replacement]?.expires_at.toISOString());
  });
  it('backfills already-recorded orders once and guards every deadline against other changes', async () => {
    const { input, fixture, now } = await bound(),
      repo = createPurchaseRepository(db);
    const used = await asset(fixture.shopId, 'guest', now);
    referencing(input, used);
    const p = requirePurchase(await repo.reconcile(input));
    const extended = await retention(p.purchaseId, [used]);
    // Rewind to the pre-migration state: recorded with the session's 7-day deadlines.
    await db.transaction().execute(async (tx) => {
      await sql`ALTER TABLE artwork_assets DISABLE TRIGGER artwork_identity_guard`.execute(tx);
      await sql`ALTER TABLE purchase_design_payloads DISABLE TRIGGER purchase_payload_guard`.execute(tx);
      await sql`UPDATE artwork_assets SET expires_at=collected_at+interval '7 days' WHERE asset_id=${used}::uuid`.execute(
        tx,
      );
      await sql`UPDATE purchase_design_payloads SET expires_at=collected_at+interval '7 days' WHERE purchase_id=${p.purchaseId}::uuid`.execute(
        tx,
      );
      await sql`ALTER TABLE purchase_design_payloads ENABLE TRIGGER purchase_payload_guard`.execute(tx);
      await sql`ALTER TABLE artwork_assets ENABLE TRIGGER artwork_identity_guard`.execute(tx);
    });
    const backfill = async () =>
      (
        await sql<{
          changed: number;
        }>`SELECT public.retain_purchased_detail(${p.purchaseId}::uuid) AS changed`.execute(db)
      ).rows[0]?.changed;
    expect(await backfill()).toBe(2);
    expect(await backfill()).toBe(0);
    expect(await retention(p.purchaseId, [used])).toEqual(extended);
    // No writer can shorten a deadline or pass the six-month CHECK; new uploads start at 7 days at most.
    await expect(
      sql`UPDATE artwork_assets SET expires_at=expires_at-interval '1 day' WHERE asset_id=${used}::uuid`.execute(db),
    ).rejects.toThrow(/immutable/);
    await expect(
      sql`UPDATE purchase_design_payloads SET expires_at=collected_at+interval '6 months 1 day' WHERE purchase_id=${p.purchaseId}::uuid`.execute(
        db,
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      sql`UPDATE artwork_assets SET expires_at=collected_at+interval '6 months 1 day' WHERE asset_id=${used}::uuid`.execute(
        db,
      ),
    ).rejects.toThrow(/check constraint/);
    const late = randomUUID();
    await expect(
      sql`INSERT INTO artwork_assets(asset_id,shop_id,installation_generation,owner_hash,owner_kind,declared_mime,declared_bytes,state,quarantine_key,original_key,preview_key,collected_at,upload_until,expires_at) VALUES(${late}::uuid,${fixture.shopId},1,${'a'.repeat(64)},'guest','image/png',10,'UPLOADING',${`q/${late}`},${`o/${late}`},${`p/${late}`},clock_timestamp(),clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '8 days')`.execute(
        db,
      ),
    ).rejects.toThrow(/at most 7 days/);
  });
  it('attaches one artwork to two orders concurrently without a deadlock', async () => {
    const { input, fixture, now } = await bound(),
      repo = createPurchaseRepository(db),
      scope = { shopId: fixture.shopId, installationGeneration: '1', kind: 'merchant' as const };
    const p = requirePurchase(await repo.reconcile(input));
    const shared = await asset(fixture.shopId, 'merchant', now);
    // Another attachment of the same artwork: it has read the asset and is about to extend it.
    const pool = new Pool({ connectionString: process.env.DATABASE_URL }),
      other = await pool.connect();
    try {
      await other.query('BEGIN');
      await other.query('SELECT 1 FROM artwork_assets WHERE asset_id=$1 FOR SHARE', [shared]);
      const attach = repo.appendArtwork(scope, {
        purchaseId: p.purchaseId,
        expectedVersion: 0,
        groupIndex: 0,
        placementId: 'front',
        assetId: shared,
        ownerHash: 'b'.repeat(64),
      });
      const settled = attach.then(
        () => 'committed',
        (error: unknown) => String((error as { code?: string }).code ?? error),
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      // A shared read before the extension would make these two wait on each other (40P01).
      await other.query('UPDATE artwork_assets SET updated_at=clock_timestamp() WHERE asset_id=$1', [shared]);
      await other.query('COMMIT');
      expect(await settled).toBe('committed');
    } finally {
      await other.query('ROLLBACK').catch(() => undefined);
      other.release();
      await pool.end();
    }
  });
  it('an order recorded after the 7-day deadline but within 72 hours of acceptance keeps its artwork', async () => {
    const { input, fixture, now } = await bound(),
      repo = createPurchaseRepository(db),
      pool = new Pool({ connectionString: process.env.DATABASE_URL }),
      store = createArtworkRepository(pool);
    try {
      // Uploaded and collected 6.5 days ago; accepted now, so its 7-day deadline is 12 hours away.
      const collected = new Date(+now - 6.5 * 86400000),
        art = await asset(fixture.shopId, 'guest', collected);
      referencing(input, art);
      const request = (input.bindings[0]!.designPayload as { request: unknown }).request;
      await sql`INSERT INTO purchase_offer_payloads VALUES(${fixture.shopId},1,${fixture.quote.quoteId}::uuid,${collected},${new Date(+collected + 7 * 86400000)},${JSON.stringify(request)}::jsonb,NULL)`.execute(
        db,
      );
      const offer = (
        await sql<{
          expires_at: Date;
          asset_until: Date;
        }>`SELECT o.expires_at,a.expires_at AS asset_until FROM purchase_offer_payloads o,artwork_assets a WHERE o.quote_id=${fixture.quote.quoteId}::uuid AND a.asset_id=${art}::uuid`.execute(
          db,
        )
      ).rows[0]!;
      expect(+offer.expires_at).toBeGreaterThan(+now + 71 * 3600000);
      expect(+offer.expires_at).toBeLessThanOrEqual(Date.now() + 72 * 3600000);
      expect(offer.asset_until).toEqual(offer.expires_at);
      // Never recorded: the inspector deletes it once the grace ends, not before.
      expect(await store.markDeleting(art, new Date(+now + 86400000))).toBeNull();
      // orders/create processed a day later, past the original 7-day deadline.
      const binding = input.bindings[0]!;
      binding.payloadCollectedAt = collected.toISOString();
      binding.payloadExpiresAt = offer.expires_at.toISOString();
      (binding.designPayload as { collectedAt: string }).collectedAt = collected.toISOString();
      input.order.observedAt = new Date(+now + 86400000).toISOString();
      const p = requirePurchase(await repo.reconcile(input));
      expect(p.bindings[0]?.designPayload).not.toBeNull();
      const { payload, assets } = await retention(p.purchaseId, [art]);
      expect(payload.expires_at).toEqual(payload.deadline);
      expect(assets[art]?.expires_at).toEqual(assets[art]?.deadline);
      expect(await store.markDeleting(art, new Date(+now + 30 * 86400000))).toBeNull();
    } finally {
      await pool.end();
    }
  });
  it('an accepted quote never ordered loses its artwork when the 72-hour grace ends', async () => {
    const fixture = await purchaseFixture(db),
      now = new Date(),
      pool = new Pool({ connectionString: process.env.DATABASE_URL }),
      store = createArtworkRepository(pool);
    try {
      const collected = new Date(+now - 6.5 * 86400000),
        art = await asset(fixture.shopId, 'guest', collected),
        fresh = await asset(fixture.shopId, 'guest', now);
      const request = {
        groups: [art, fresh].map((revisionId) => ({
          group: { design: { placements: [{ artwork: { kind: 'revision', revisionId } }] } },
        })),
      };
      await sql`INSERT INTO purchase_offer_payloads VALUES(${fixture.shopId},1,${fixture.quote.quoteId}::uuid,${collected},${new Date(+collected + 7 * 86400000)},${JSON.stringify(request)}::jsonb,NULL)`.execute(
        db,
      );
      const until = (
        await sql<{
          asset_id: string;
          expires_at: Date;
        }>`SELECT asset_id::text,expires_at FROM artwork_assets WHERE asset_id IN (${art}::uuid,${fresh}::uuid)`.execute(
          db,
        )
      ).rows;
      const graceEnd = until.find((r) => r.asset_id === art)!.expires_at;
      expect(+graceEnd).toBeLessThanOrEqual(Date.now() + 72 * 3600000);
      expect(+graceEnd).toBeGreaterThan(+now + 71 * 3600000);
      // An upload already kept past the grace is not changed.
      expect(+until.find((r) => r.asset_id === fresh)!.expires_at).toBe(+now + 7 * 86400000);
      expect(await store.markDeleting(art, new Date(+graceEnd - 1000))).toBeNull();
      expect((await store.markDeleting(art, new Date(+graceEnd + 1000)))?.assetId).toBe(art);
    } finally {
      await pool.end();
    }
  });
  it('runtime roles cannot move a deadline or call the retention functions', async () => {
    const { input, fixture, now } = await bound(),
      repo = createPurchaseRepository(db);
    const used = await asset(fixture.shopId, 'guest', now);
    referencing(input, used);
    const p = requirePurchase(await repo.reconcile(input));
    const pool = new Pool({ connectionString: process.env.DATABASE_URL }),
      client = await pool.connect(),
      role = `retention_probe_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const refused = async (statement: string, pattern: RegExp) => {
      await client.query('SAVEPOINT probe');
      await expect(client.query(statement)).rejects.toThrow(pattern);
      await client.query('ROLLBACK TO SAVEPOINT probe');
    };
    try {
      // Created, granted and dropped inside one rolled-back transaction.
      await client.query('BEGIN');
      await client.query(`CREATE ROLE ${role} NOLOGIN`);
      await client.query(
        `GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT,UPDATE ON artwork_assets,purchase_design_payloads,purchase_artwork_events,purchase_offer_payloads TO ${role}`,
      );
      await client.query(`SET LOCAL ROLE ${role}`);
      await refused(
        `UPDATE artwork_assets SET expires_at=expires_at+interval '1 day' WHERE asset_id='${used}'`,
        /retention deadline are immutable/,
      );
      await refused(
        `UPDATE purchase_design_payloads SET expires_at=expires_at+interval '1 day' WHERE purchase_id='${p.purchaseId}'`,
        /erasure tombstone/,
      );
      await refused(`SELECT public.retain_purchased_detail('${p.purchaseId}')`, /permission denied/);
      await refused(
        `SELECT public.retain_accepted_offer('${fixture.shopId}',1,'${fixture.quote.quoteId}',clock_timestamp())`,
        /permission denied/,
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  });
  it('a month-end deadline still erases in any session time zone', async () => {
    const fixture = await purchaseFixture(db),
      purchaseId = randomUUID();
    // A UTC day whose next day clamps to the same day six months on (e.g. 30 Aug -> 28 Feb).
    const days = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const today = new Date();
    let collected = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 2, 23));
    while (
      !(
        collected.getUTCDate() >= days(collected.getUTCFullYear(), collected.getUTCMonth() + 6) &&
        collected.getUTCDate() < days(collected.getUTCFullYear(), collected.getUTCMonth())
      )
    )
      collected = new Date(+collected - 86400000);
    await sql`INSERT INTO purchase_orders(purchase_id,shop_id,installation_generation,order_id,order_created_at,currency,original_total_minor) VALUES(${purchaseId}::uuid,${fixture.shopId},1,${`gid://shopify/Order/${BigInt(`0x${purchaseId.replaceAll('-', '').slice(0, 12)}`)}`},clock_timestamp(),'USD',2001)`.execute(
      db,
    );
    await sql`INSERT INTO purchase_bindings VALUES(${fixture.shopId},1,${purchaseId}::uuid,${fixture.quote.quoteId}::uuid,${fixture.authorization.setId}::uuid,'{}'::jsonb)`.execute(
      db,
    );
    await sql`INSERT INTO purchase_design_payloads VALUES(${fixture.shopId},1,${purchaseId}::uuid,${fixture.authorization.setId}::uuid,${collected},clock_timestamp()+interval '1 day','{"request":{"groups":[]}}'::jsonb,NULL)`.execute(
      db,
    );
    await db.transaction().execute(async (tx) => {
      await sql`SET LOCAL TimeZone='Pacific/Kiritimati'`.execute(tx);
      const bound = (
        await sql<{
          local: Date;
          utc: Date;
          kept: Date;
        }>`SELECT collected_at+interval '6 months' AS local,(collected_at AT TIME ZONE 'UTC'+interval '6 months') AT TIME ZONE 'UTC' AS utc,expires_at AS kept FROM purchase_design_payloads WHERE purchase_id=${purchaseId}::uuid`.execute(
          tx,
        )
      ).rows[0]!;
      // This zone's CHECK bound is a day short of the UTC calendar date; the margin keeps erasure valid.
      expect(+bound.local).toBeLessThan(+bound.utc);
      expect(+bound.kept).toBeLessThanOrEqual(+bound.local);
      await sql`UPDATE purchase_design_payloads SET payload=NULL,erased_at=clock_timestamp() WHERE purchase_id=${purchaseId}::uuid`.execute(
        tx,
      );
    });
  });
});
