import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createDurableCore } from '@insignia/database';
import { Pool } from 'pg';

test('actual restricted LOGIN can stage only a retained body-bound erasure through the exact queue grant', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  assert(process.env.DATABASE_URL);
  const owner = new Pool({ connectionString: process.env.DATABASE_URL });
  const cap = `privacy_cap_${randomUUID().replaceAll('-', '')}`;
  const login = `privacy_login_${randomUUID().replaceAll('-', '')}`;
  const password = randomUUID().replaceAll('-', '');
  const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
  const shopId = randomUUID();
  const providerShopId = String(BigInt(`0x${shopId.replaceAll('-', '').slice(0, 15)}`));
  const grant = (
    await readFile(new URL('../../../scripts/privacy/runtime-grants.sql', import.meta.url), 'utf8')
  ).replaceAll('insignia_queue_consume', cap);
  let worker: Pool | undefined;
  try {
    await owner.query(
      `CREATE ROLE ${cap} NOLOGIN; CREATE ROLE ${login} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; GRANT ${cap} TO ${login}`,
    );
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, {
        shopId,
        shopDomain: `${shopId}.myshopify.com`,
        shopifyShopId: providerShopId,
      }),
    );
    const receipt = await core.webhooks.receive({
      shopDomain: 'untrusted-routing.myshopify.com',
      topic: 'customers/data_request',
      deliveryId: randomUUID(),
      apiVersion: '2026-07',
      triggeredAt: new Date(),
      eventId: null,
      name: null,
      rawBody: Buffer.from(`{"shop_id":${providerShopId},"customer":{"id":1},"orders_to_redact":[99]}`),
    });
    const url = new URL(process.env.DATABASE_URL);
    url.username = login;
    url.password = password;
    worker = new Pool({ connectionString: url.href });
    const identity = (
      await worker.query(
        'SELECT current_user,session_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user',
      )
    ).rows[0];
    assert.deepEqual(identity, { current_user: login, session_user: login, rolsuper: false, rolbypassrls: false });
    await assert.rejects(worker.query('SELECT process_customer_privacy_inbox($1)', [receipt.id]), /permission denied/);
    await owner.query(grant);
    const result = (await worker.query('SELECT process_customer_privacy_inbox($1) AS value', [receipt.id])).rows[0]
      .value;
    assert.equal(result.kind, 'ERASURE_STAGED');
    assert.equal(result.shopId, shopId);
    assert.deepEqual(
      (await worker.query('SELECT process_customer_privacy_inbox($1) AS value', [receipt.id])).rows[0].value,
      result,
    );
    assert.equal(
      (await owner.query('SELECT count(*)::integer AS n FROM customer_order_erasure_fences WHERE shop_id=$1', [shopId]))
        .rows[0].n,
      1,
    );
    for (const query of [
      'SELECT * FROM customer_privacy_receipts',
      'SELECT original_key FROM artwork_assets',
      'DELETE FROM customer_order_erasure_fences',
      'SELECT customer_privacy_fence_asset(NULL,NULL,NULL)',
      'SELECT customer_privacy_fence_quote(NULL,NULL,NULL)',
    ])
      await assert.rejects(worker.query(query), /permission denied/);
    await assert.rejects(
      worker.query('SELECT process_customer_privacy_inbox($1)', [randomUUID()]),
      /privacy inbox not found/,
    );
  } finally {
    await worker?.end();
    await core.close();
    await owner.query(`DROP OWNED BY ${login},${cap}; DROP ROLE ${login}; DROP ROLE ${cap}`);
    await owner.end();
  }
});
