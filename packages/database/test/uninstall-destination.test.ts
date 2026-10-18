import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test } from 'vitest';
import { createDurableCore } from '../src/index.js';

test('exclusive dispatched destination deactivates exactly its generation; generic and old callbacks cannot deactivate a reinstall', async () => {
  const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
  const shopId = randomUUID();
  const shopDomain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
  const shopifyShopId = (BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`) + 1n).toString();
  const externalInstallationId = 'gid://shopify/AppInstallation/123';
  const capabilityDigest = randomBytes(32).toString('hex');
  const delivery = () => ({
    shopDomain,
    topic: 'app/uninstalled',
    apiVersion: '2026-07',
    deliveryId: randomUUID(),
    triggeredAt: new Date('2099-01-01'),
    eventId: null,
    name: null,
    rawBody: Buffer.from(JSON.stringify({ id: shopifyShopId, myshopify_domain: shopDomain })),
  });
  try {
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, { shopId, shopDomain, shopifyShopId, externalInstallationId }),
    );
    const scope = { shopId, installationGeneration: '1', externalInstallationId, capabilityDigest };
    await core.uninstallLifecycle.reserve(scope);
    await expect(
      core.webhooks.receive({ ...delivery(), uninstallCapabilityDigest: capabilityDigest }),
    ).rejects.toThrow();
    expect(await core.uninstallLifecycle.dispatch(scope)).toBe(true);
    expect(await core.uninstallLifecycle.dispatch(scope)).toBe(false);
    const generic = await core.webhooks.receive(delivery());
    expect(await core.webhooks.processUninstall(generic.id)).toBe('unqualified');
    const receipt = await core.webhooks.receive({ ...delivery(), uninstallCapabilityDigest: capabilityDigest });
    expect(await core.webhooks.processUninstall(receipt.id)).toBe('deactivated');
    expect(await core.tenants.getCurrentAdminInstallation(shopId)).toMatchObject({ active: false, generation: '1' });
    expect(await core.webhooks.processUninstall(receipt.id)).toBe('already_processed');
    await core.transactions.run((tx) =>
      core.tenants.startInstallation(tx, shopId, 'gid://shopify/AppInstallation/456'),
    );
    const delayed = await core.webhooks.receive({ ...delivery(), uninstallCapabilityDigest: capabilityDigest });
    expect(await core.webhooks.processUninstall(delayed.id)).toBe('stale');
    expect(await core.tenants.getCurrentAdminInstallation(shopId)).toMatchObject({ active: true, generation: '2' });
    await expect(core.uninstallLifecycle.reserve({ ...scope, installationGeneration: '2' })).rejects.toThrow();
    await expect(core.webhooks.receive({ ...delivery(), uninstallCapabilityDigest: 'b'.repeat(64) })).rejects.toThrow();
  } finally {
    await core.close();
  }
});
