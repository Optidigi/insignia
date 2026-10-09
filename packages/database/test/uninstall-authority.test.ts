import { createHmac, randomUUID } from 'node:crypto';
import { verifyShopifyWebhook } from '@insignia/shopify';
import { Pool } from 'pg';
import { expect, test } from 'vitest';
import { createDurableCore } from '../src/index.js';

test.each([false, true])('M5-025 bootstrap characterization with old-body replay=%s', async (replayed) => {
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
    expect(await core.webhooks.processUninstall(removed.id)).toBe('processed');
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
