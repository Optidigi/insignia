import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createDurableCore } from '@insignia/database';
import { Pool } from 'pg';

test('actual restricted merchant LOGIN has only scoped privacy exports and no receipt/body/erasure authority', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const owner = new Pool({ connectionString: process.env.DATABASE_URL });
  const name = `privacy_merchant_${randomUUID().replaceAll('-', '')}`;
  const password = randomUUID().replaceAll('-', '');
  const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
  const shopId = randomUUID();
  const providerShop = String(BigInt(`0x${shopId.replaceAll('-', '').slice(0, 15)}`));
  let merchant;
  try {
    await owner.query(
      `CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, { shopId, shopDomain: `${shopId}.myshopify.com`, shopifyShopId: providerShop }),
    );
    const receipt = await core.webhooks.receive({
      shopDomain: 'untrusted-routing.myshopify.com',
      topic: 'customers/data_request',
      apiVersion: '2026-07',
      deliveryId: randomUUID(),
      triggeredAt: new Date(),
      eventId: null,
      name: null,
      rawBody: Buffer.from(
        `{"shop_id":${providerShop},"customer":{"id":1},"orders_requested":[],"data_request":{"id":19}}`,
      ),
    });
    await core.customerPrivacy.processInbox(receipt.id);
    const url = new URL(process.env.DATABASE_URL);
    url.username = name;
    url.password = password;
    merchant = new Pool({ connectionString: url.href });
    const identity = (
      await merchant.query('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
    ).rows[0];
    assert.deepEqual(identity, { current_user: name, rolsuper: false, rolbypassrls: false });
    await assert.rejects(
      merchant.query('SELECT read_customer_privacy_requests($1,1,NULL,NULL)', [shopId]),
      /permission denied/,
    );
    const grant = (
      await readFile(new URL('../../../scripts/privacy/merchant-runtime-grants.sql', import.meta.url), 'utf8')
    ).replaceAll('insignia_runtime', name);
    await owner.query(grant);
    const result = await merchant.query('SELECT value FROM read_customer_privacy_requests($1,1,NULL,NULL) value', [
      shopId,
    ]);
    assert.equal(result.rows[0].value.inboxId, receipt.id);
    assert.equal(
      (await merchant.query('SELECT value FROM read_customer_privacy_requests($1,2,NULL,NULL) value', [shopId]))
        .rowCount,
      0,
    );
    assert.equal(
      (
        await merchant.query('SELECT value FROM read_customer_privacy_requests($1,1,$2,NULL) value', [
          randomUUID(),
          receipt.id,
        ])
      ).rowCount,
      0,
    );
    for (const query of [
      'SELECT * FROM customer_privacy_receipts',
      'SELECT payload FROM inbox_messages',
      'SELECT process_customer_privacy_inbox(NULL)',
      'SELECT stage_shop_privacy_inbox(NULL)',
      'SELECT cleanup_customer_privacy_inboxes(100)',
      'INSERT INTO shop_privacy_fences VALUES(NULL,NULL,NULL,NULL)',
    ])
      await assert.rejects(merchant.query(query), /permission denied/);
  } finally {
    await merchant?.end();
    await core.close();
    await owner.query(`DROP OWNED BY ${name}`);
    await owner.query(`DROP ROLE ${name}`);
    await owner.end();
  }
});
