import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { reconcilePurchase } from '@insignia/application';
import { handlePurchaseRequest } from '../src/server/purchase/http.ts';
import { createPurchaseServices } from '../src/server/purchase/service.ts';
import { fixture } from './support/buyer-fixture.mjs';

const database = process.env.DATABASE_URL;
async function purchase(t) {
  const f = await fixture(t, { demo91: true, clock: () => new Date() });
  const body = structuredClone(f.body);
  body.groups[0].variants[0].quantity = 3;
  const proposed = await f.http('quote-proposals', body);
  assert.equal(proposed.status, 200, await proposed.clone().text());
  const proposal = await proposed.json();
  assert.equal(proposal.totalMinor, '9100');
  const acceptedResponse = await f.http(`quote-proposals/${proposal.proposalId}/accept`, {
    capability: f.session.capability,
    hash: proposal.hash,
    idempotencyKey: randomUUID(),
  });
  assert.equal(acceptedResponse.status, 200, await acceptedResponse.clone().text());
  const accepted = await acceptedResponse.json();
  const offer = await f.core.purchases.getOffer({
    shopId: f.shopId,
    installationGeneration: '1',
    quoteId: accepted.quoteId,
    authorizationSetId: accepted.setId,
  });
  assert.ok(offer);
  const order = {
    shopId: f.shopId,
    installationGeneration: '1',
    orderId: `gid://shopify/Order/${BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 14))}`,
    createdAt: new Date(+f.now() + 1000).toISOString(),
    updatedAt: new Date(+f.now() + 2000).toISOString(),
    observedAt: new Date(+f.now() + 3000).toISOString(),
    currency: 'EUR',
    country: 'NL',
    marketId: '42',
    contextVerified: true,
    sourceApiVersion: '2026-07',
    complete: true,
    edited: false,
    totalPriceMinor: '9100',
    test: false,
    financialStatus: 'PAID',
    cancelledAt: null,
    lines: accepted.buckets.map((bucket, index) => ({
      lineId: `gid://shopify/LineItem/${index + 100}`,
      productId: f.productId,
      variantId: bucket.variantId,
      quantity: bucket.quantity,
      currentQuantity: bucket.quantity,
      originalUnitPriceMinor: offer.quote.economics.lines[index].unitPriceMinor,
      sellingPlanId: null,
      attributes: Object.entries(bucket.properties).map(([key, value]) => ({ key, value })),
    })),
    transactions: [
      {
        transactionId: 'gid://shopify/OrderTransaction/901',
        kind: 'SALE',
        status: 'SUCCESS',
        occurredAt: new Date(+f.now() + 1500).toISOString(),
        amountMinor: '9100',
        currency: 'EUR',
      },
    ],
    refunds: [],
  };
  const ports = {
    orders: { read: async () => structuredClone(order) },
    offers: { get: (input) => f.core.purchases.getOffer(input) },
    store: { reconcile: (observation) => f.core.purchases.reconcile(observation) },
  };
  const actor = {
    shop: 'synthetic.myshopify.com',
    shopId: 'gid://shopify/Shop/1',
    installationId: 'actual',
    tenantShopId: f.shopId,
    installationGeneration: '1',
    staffId: 'owner',
    sessionId: 'verified',
    expiresAtMs: Date.now() + 60000,
    canRead: true,
    canEdit: true,
    canReadArtwork: true,
    canUploadArtwork: true,
    canReadOrders: true,
  };
  let currentActor = actor;
  const presigns = [];
  const services = createPurchaseServices({
    core: f.core,
    appOrigin: 'https://app.example.test',
    authenticate: async () => currentActor,
    orders: ports.orders,
    clock: f.now,
    storage: {
      presignRead: async (input) => {
        presigns.push(input);
        return 'https://private.example/' + encodeURIComponent(input.key);
      },
    },
  });
  const http = (route = '', data, method = data === undefined ? 'GET' : 'POST') =>
    handlePurchaseRequest(
      new Request('https://app.example.test/api/purchases/v1/' + route, {
        method,
        headers: {
          Authorization: 'Bearer independently-verified-owner',
          Origin: 'https://app.example.test',
          ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      }),
      services,
      route,
    );
  return {
    ...f,
    order,
    offer,
    accepted,
    ports,
    actor,
    services,
    http,
    presigns,
    asActor: (value) => {
      currentActor = value;
    },
  };
}

test('actual quote/signing/PG purchase authority is independent from cart confirmation and supports distinct orders and refunds', {
  skip: !database,
}, async (t) => {
  const f = await purchase(t);
  assert.deepEqual(
    await f.core.purchases.list({ shopId: f.shopId, installationGeneration: '1', kind: 'merchant' }),
    [],
  );
  await f.http('quote-proposals'); // No private request can create an order from a browser quote hint.
  const result = await reconcilePurchase(
    { shopId: f.shopId, installationGeneration: '1', orderId: f.order.orderId },
    f.ports,
  );
  assert.equal(result.bindings.length, 1);
  assert.equal(result.firstPaidAt, f.order.transactions[0].occurredAt);
  const response = await f.http(result.purchaseId);
  assert.equal(response.status, 200, await response.clone().text());
  const view = await response.json();
  assert.equal(view.originalTotalMinor, '9100');
  assert.equal(view.groups[0].configRevisionId, f.group.configRevisionId);
  assert.equal(view.groups[0].variants[0].quantity, 3);
  assert.equal(
    view.lines.reduce((sum, line) => sum + BigInt(line.unitPriceMinor) * BigInt(line.quantity), 0n),
    9100n,
  );
  assert.equal(view.artworkState, 'READY');
  assert.equal(
    (await reconcilePurchase({ shopId: f.shopId, installationGeneration: '1', orderId: f.order.orderId }, f.ports))
      .purchaseId,
    result.purchaseId,
  );
  f.order.orderId = f.order.orderId + '1';
  const second = await reconcilePurchase(
    { shopId: f.shopId, installationGeneration: '1', orderId: f.order.orderId },
    f.ports,
  );
  assert.notEqual(second.purchaseId, result.purchaseId);
  f.order.financialStatus = 'PARTIALLY_REFUNDED';
  f.order.updatedAt = new Date(+f.now() + 4000).toISOString();
  f.order.observedAt = new Date(+f.now() + 5000).toISOString();
  f.order.refunds = [
    {
      refundId: 'gid://shopify/Refund/999',
      occurredAt: new Date(+f.now() + 3500).toISOString(),
      currency: 'EUR',
      amountMinor: '3033',
      lines: [{ lineId: f.order.lines[0].lineId, quantity: 1, amountMinor: '3033' }],
    },
  ];
  const refunded = await reconcilePurchase(
    { shopId: f.shopId, installationGeneration: '1', orderId: f.order.orderId },
    f.ports,
  );
  assert.equal(refunded.firstPaidAt, second.firstPaidAt);
  assert.equal(refunded.refunds[0].amountMinor, '3033');
  assert.equal(refunded.bindings[0].economics.economics.totalMinor, '9100');
  const original = await f.http(
    `${result.purchaseId}/artwork/${f.group.design.placements[0].artwork.revisionId}/download`,
  );
  assert.equal(original.status, 200, await original.clone().text());
  assert.match(f.presigns.at(-1).downloadFilename, /\.png$/);
  assert.equal(f.presigns.at(-1).key, `synthetic/${f.group.design.placements[0].artwork.revisionId}/o`);
});

test('merchant HTTP rejects forged tenant/body/origin and foreign asset; verified provenance attaches with CAS and locks', {
  skip: !database,
}, async (t) => {
  const f = await purchase(t);
  const result = await reconcilePurchase(
    { shopId: f.shopId, installationGeneration: '1', orderId: f.order.orderId },
    f.ports,
  );
  f.asActor({ ...f.actor, canReadOrders: false });
  assert.equal((await f.http(result.purchaseId)).status, 403);
  f.asActor(f.actor);
  assert.equal(
    (
      await f.http(`${result.purchaseId}/artwork`, {
        expectedVersion: 0,
        groupIndex: 0,
        placementId: 'front',
        assetId: f.group.design.placements[0].artwork.revisionId,
        shopId: 'forged',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.http(`${result.purchaseId}/artwork`, {
        expectedVersion: 0,
        groupIndex: 0,
        placementId: 'front',
        assetId: f.group.design.placements[0].artwork.revisionId,
      })
    ).status,
    410,
  );
  const badOrigin = await handlePurchaseRequest(
    new Request('https://app.example.test/api/purchases/v1/' + result.purchaseId + '/lock', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer verified',
        Origin: 'https://elsewhere.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expectedVersion: 0 }),
    }),
    f.services,
    result.purchaseId + '/lock',
  );
  assert.equal(badOrigin.status, 403);
  const scope = { shopId: f.shopId, installationGeneration: '1', kind: 'merchant' };
  const assetId = randomUUID();
  const now = new Date();
  const record = {
    assetId,
    shopId: f.shopId,
    installationGeneration: '1',
    ownerKind: 'merchant',
    ownerHash: 'a'.repeat(64),
    declaredMime: 'image/png',
    declaredBytes: 68,
    state: 'UPLOADING',
    quarantineKey: 'synthetic/' + assetId,
    originalKey: 'originals/' + assetId,
    previewKey: 'previews/' + assetId,
    collectedAt: now,
    uploadUntil: new Date(+now + 300000),
    expiresAt: new Date(+now + 3600000),
    claimId: null,
    manifest: null,
    rejection: null,
  };
  await f.core.artwork.create(record);
  await f.core.artwork.complete(scope, assetId, now);
  const claimId = randomUUID();
  assert.ok(await f.core.artwork.claim(assetId, claimId, now, new Date(+now + 360000)));
  const manifest = {
    version: 'm6-inspection-v1',
    mimeType: 'image/png',
    byteLength: 68,
    sha256: 'c'.repeat(64),
    width: 1,
    height: 1,
    previewSha256: 'd'.repeat(64),
    previewByteLength: 68,
  };
  await f.core.artwork.prepare(assetId, claimId, manifest, now);
  await f.core.artwork.settle(assetId, claimId, now);
  const command = { expectedVersion: 0, groupIndex: 0, placementId: 'front', assetId };
  const attached = await f.http(`${result.purchaseId}/artwork`, command);
  assert.equal(attached.status, 200, await attached.clone().text());
  const view = await attached.json();
  assert.equal(view.artworkVersion, 1);
  assert.equal(view.groups[0].placements[0].currentAssetId, assetId);
  assert.equal(
    view.groups[0].placements[0].originalArtwork.revisionId,
    f.group.design.placements[0].artwork.revisionId,
  );
  assert.equal((await f.http(`${result.purchaseId}/artwork`, command)).status, 409);
  const locked = await f.http(`${result.purchaseId}/lock`, { expectedVersion: 1 });
  assert.equal(locked.status, 200, await locked.clone().text());
  assert.equal((await locked.json()).artworkState, 'ARTWORK_LOCKED');
  assert.equal((await f.http(`${result.purchaseId}/artwork`, { ...command, expectedVersion: 2 })).status, 409);
  assert.equal((await f.http(`${result.purchaseId}/artwork/${randomUUID()}/download`)).status, 410);
  const before = (await f.http(result.purchaseId).then((r) => r.json())).lines;
  f.order.edited = true;
  f.order.updatedAt = new Date(+f.now() + 8000).toISOString();
  f.order.observedAt = new Date(+f.now() + 9000).toISOString();
  await reconcilePurchase({ shopId: f.shopId, installationGeneration: '1', orderId: f.order.orderId }, f.ports);
  const edited = await f.http(result.purchaseId).then((r) => r.json());
  assert.ok(edited.exceptions.includes('UNSUPPORTED_ORDER_EDIT'));
  assert.deepEqual(edited.lines, before);
});
