import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test } from 'vitest';
import { createDurableCore } from '../src/index.js';

test('generic cleanup accounting freezes its local ceiling and cannot use an old callback to cover an active reinstall', async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
  const shopId = randomUUID(),
    shopDomain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
  const provider = (BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`) + 1n).toString();
  const delivery = (body: unknown, topic = 'app/uninstalled') => ({
    shopDomain,
    topic,
    apiVersion: '2026-07',
    deliveryId: randomUUID(),
    triggeredAt: new Date(),
    eventId: null,
    name: null,
    rawBody: Buffer.from(JSON.stringify(body)),
  });
  const shopBody = { id: provider, myshopify_domain: shopDomain };
  async function destination(generation: string, externalInstallationId: string) {
    const digest = createHash('sha256').update(randomBytes(32)).digest('hex');
    const scope = { shopId, installationGeneration: generation, externalInstallationId, capabilityDigest: digest };
    await core.uninstallLifecycle.reserve(scope);
    await core.uninstallLifecycle.dispatch(scope);
    return digest;
  }
  try {
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, {
        shopId,
        shopDomain,
        shopifyShopId: provider,
        externalInstallationId: 'gid://shopify/AppInstallation/111',
      }),
    );
    const oldDigest = await destination('1', 'gid://shopify/AppInstallation/111');
    const first = await core.webhooks.receive(delivery(shopBody));
    await core.transactions.run((tx) =>
      core.tenants.startInstallation(tx, shopId, 'gid://shopify/AppInstallation/222'),
    );
    const currentDigest = await destination('2', 'gid://shopify/AppInstallation/222');
    const second = await core.webhooks.receive(delivery(shopBody));
    const privacy = await core.webhooks.receive(
      delivery({ shop_id: provider, shop_domain: shopDomain }, 'shop/redact'),
    );
    expect((await core.customerPrivacy.processInbox(privacy.id)).kind).toBe('SHOP_ERASURE_BLOCKED');
    const old = await core.webhooks.receive({ ...delivery(shopBody), uninstallCapabilityDigest: oldDigest });
    expect(await core.webhooks.processUninstall(old.id)).toBe('stale');
    await core.uninstallPrivacy.recoverPending();
    await core.uninstallLifecycle.coverGenericCleanup();
    expect((await core.webhooks.getById(first.id))?.state).toBe('processed');
    expect((await core.webhooks.getById(second.id))?.state).toBe('pending');
    expect(await core.tenants.getCurrentAdminInstallation(shopId)).toMatchObject({ generation: '2', active: true });
    const current = await core.webhooks.receive({ ...delivery(shopBody), uninstallCapabilityDigest: currentDigest });
    expect(await core.webhooks.processUninstall(current.id)).toBe('deactivated');
    await core.uninstallPrivacy.recoverPending();
    await core.uninstallLifecycle.coverGenericCleanup();
    expect((await core.webhooks.getById(second.id))?.state).toBe('processed');
    expect(
      (await pool.query('SELECT classification FROM generic_uninstall_dispositions WHERE inbox_id=$1', [second.id]))
        .rows,
    ).toEqual([{ classification: 'GENERATION_PRIVATE_CLEANUP_STAGED' }]);
    expect(
      (await pool.query('SELECT operation FROM customer_privacy_receipts WHERE inbox_id=$1', [privacy.id])).rows,
    ).toEqual([{ operation: 'SHOP_ERASURE_BLOCKED' }]);
    await core.transactions.run((tx) =>
      core.tenants.startInstallation(tx, shopId, 'gid://shopify/AppInstallation/333'),
    );
    await core.uninstallLifecycle.coverGenericCleanup();
    expect(await core.tenants.getCurrentAdminInstallation(shopId)).toMatchObject({ generation: '3', active: true });
  } finally {
    await core.close();
    await pool.end();
  }
});
