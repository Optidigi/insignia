import { createHmac, randomUUID } from 'node:crypto';
import { verifyShopifyWebhook } from '@insignia/shopify';
import { Pool } from 'pg';
import { expect, test } from 'vitest';
import { createDurableCore } from '../src/index.js';

test('generic uninstall refuses both fresh and legacy header-derived generation authority', async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
  const shopId = randomUUID();
  const shopDomain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
  const shopifyShopId = (BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`) + 1n).toString();
  const rawBody = Buffer.from(JSON.stringify({ id: shopifyShopId, myshopify_domain: shopDomain }));
  try {
    await core.transactions.run((tx) => core.tenants.createShop(tx, { shopId, shopDomain, shopifyShopId }));
    await core.transactions.run((tx) => core.tenants.startInstallation(tx, shopId));
    const beforeBacklog = await core.webhooks.unresolvedBacklogCount();
    const receipt = await core.webhooks.receive({
      shopDomain,
      topic: 'app/uninstalled',
      apiVersion: '2026-07',
      deliveryId: randomUUID(),
      triggeredAt: new Date('2099-01-01T00:00:00Z'),
      eventId: randomUUID(),
      name: null,
      rawBody,
    });
    expect(await core.webhooks.processUninstall(receipt.id)).toBe('unqualified');
    expect(await core.webhooks.getById(receipt.id)).toMatchObject({
      state: 'pending',
      resolution: 'unqualified',
      installationGeneration: null,
    });
    // Synthetic legacy pending row: its old binding is evidence, not authority.
    await pool.query('UPDATE inbox_messages SET shop_id=$1,installation_generation=2 WHERE id=$2', [
      shopId,
      receipt.id,
    ]);
    expect(await core.webhooks.processUninstall(receipt.id)).toBe('unqualified');
    expect(await core.webhooks.getById(receipt.id)).toMatchObject({ state: 'pending', installationGeneration: null });
    expect(await core.tenants.getCurrentAdminInstallation(shopId)).toMatchObject({ generation: '2', active: true });
    expect(await core.webhooks.unresolvedBacklogCount()).toBe(beforeBacklog + 1);
    const stored = (
      await pool.query('SELECT state,attempts,payload,installation_generation FROM inbox_messages WHERE id=$1', [
        receipt.id,
      ])
    ).rows[0];
    expect(stored).toEqual({ state: 'pending', attempts: 0, payload: rawBody, installation_generation: '2' });
  } finally {
    await core.close();
    await pool.end();
  }
});

test.each([false, true])('M5-025 conservative bootstrap fence with old-body replay=%s', async (replayed) => {
  const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
  const shopDomain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
  const shopifyShopId = (BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`) + 1n).toString();
  const identity = { shopDomain, shopifyShopId, externalInstallationId: 'gid://shopify/AppInstallation/111' };
  const secret = 'synthetic-m5-025-bootstrap-replay';
  const body = Buffer.from(JSON.stringify({ id: shopifyShopId, myshopify_domain: shopDomain }));
  const hmac = createHmac('sha256', secret).update(body).digest('base64');
  const delivery = (at: Date) =>
    verifyShopifyWebhook(
      body,
      {
        'x-shopify-hmac-sha256': hmac,
        'x-shopify-topic': 'app/uninstalled',
        'x-shopify-shop-domain': shopDomain,
        'x-shopify-api-version': '2026-07',
        'x-shopify-webhook-id': randomUUID(),
        'x-shopify-event-id': randomUUID(),
        'x-shopify-triggered-at': at.toISOString(),
      },
      [secret],
    );
  try {
    const first = await core.transactions.run((tx) =>
      core.tenants.ensureManagedInstallation(tx, {
        ...identity,
        expected: null,
        observationStartedAt: new Date(),
      }),
    );
    const removed = await core.webhooks.receive(delivery(new Date()));
    expect(await core.webhooks.processUninstall(removed.id)).toBe('unqualified');
    // Trusted local fixture removal, not authority inferred from the receipt.
    await core.transactions.run((tx) => core.tenants.deactivateCurrent(tx, first.state.shopId, '1'));
    const expected = await core.tenants.getManagedInstallationState(shopDomain);
    // Ensure the original delivery predates the next trusted observation.
    await new Promise((resolve) => setTimeout(resolve, 2));
    const observationStartedAt = new Date();
    const replacement = { ...identity, externalInstallationId: 'gid://shopify/AppInstallation/222' };
    if (replayed) await core.webhooks.receive(delivery(observationStartedAt));
    const operation = core.transactions.run((tx) =>
      core.tenants.ensureManagedInstallation(tx, {
        ...replacement,
        expected,
        confirmation: replacement,
        observationStartedAt,
      }),
    );
    if (replayed) {
      await expect(operation).rejects.toMatchObject({ kind: 'state_changed' });
      expect(await core.tenants.getCurrentAdminInstallation(first.state.shopId)).toMatchObject({
        generation: '1',
        active: false,
      });
    } else {
      expect(await operation).toMatchObject({
        outcome: 'REINSTALLED',
        state: { currentGeneration: '2', active: true },
      });
    }
    // Synthetic provider-bound inputs exercise the repository seam. They do
    // not establish a native reinstall or justify changing the bootstrap fence.
  } finally {
    await core.close();
  }
});

test('historical processed uninstall evidence remains unchanged and cannot affect a replacement', async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
  const shopId = randomUUID();
  const shopDomain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
  const shopifyShopId = (BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`) + 1n).toString();
  try {
    await core.transactions.run((tx) => core.tenants.createShop(tx, { shopId, shopDomain, shopifyShopId }));
    const input = {
      shopDomain,
      topic: 'app/uninstalled',
      apiVersion: '2026-07',
      deliveryId: randomUUID(),
      triggeredAt: new Date(),
      eventId: null,
      name: null,
      rawBody: Buffer.from(JSON.stringify({ id: shopifyShopId, myshopify_domain: shopDomain })),
    };
    const receipt = await core.webhooks.receive(input);
    // Explicit historical fixture, never claimed as a new qualified outcome.
    await pool.query(
      "UPDATE inbox_messages SET shop_id=$1,installation_generation=1,state='processed',attempts=1 WHERE id=$2",
      [shopId, receipt.id],
    );
    await core.transactions.run((tx) => core.tenants.startInstallation(tx, shopId));
    const before = (await pool.query('SELECT * FROM inbox_messages WHERE id=$1', [receipt.id])).rows[0];
    expect(await core.webhooks.receive(input)).toMatchObject({ kind: 'processed', id: receipt.id });
    expect(await core.webhooks.processUninstall(receipt.id)).toBe('already_processed');
    expect((await pool.query('SELECT * FROM inbox_messages WHERE id=$1', [receipt.id])).rows[0]).toEqual(before);
    expect(await core.tenants.getCurrentAdminInstallation(shopId)).toMatchObject({ generation: '2', active: true });
  } finally {
    await core.close();
    await pool.end();
  }
});
