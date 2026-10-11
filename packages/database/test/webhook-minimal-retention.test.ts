import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { expect, test } from 'vitest';
import { createDurableCore } from '../src/index.js';

test('expired signed bytes become minimal unqualified facts, never header-driven uninstall or privacy completion', async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
  const shopDomain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
  const rawBody = Buffer.from(
    '{"shop_id":123,"shop_domain":"body.myshopify.com","customer":{"id":9007199254740993,"email":"discard@example.test","phone":"discard"},"orders_requested":[9007199254740995],"data_request":{"id":456},"name":"unneeded PII","currency":"EUR","total_price":"00012.3400","transaction_ids":[9007199254740997]}',
  );
  try {
    const receipt = await core.webhooks.receive({
      shopDomain,
      topic: 'app/uninstalled',
      deliveryId: randomUUID(),
      apiVersion: '2026-07',
      triggeredAt: new Date('2099-01-01'),
      eventId: null,
      name: null,
      rawBody: Buffer.from('{"id":123,"myshopify_domain":null,"email":"discard@example.test"}'),
    });
    const privacy = await core.webhooks.receive({
      shopDomain,
      topic: 'customers/redact',
      deliveryId: randomUUID(),
      apiVersion: '2026-07',
      triggeredAt: new Date('2099-01-01'),
      eventId: null,
      name: null,
      rawBody,
    });
    const untouched = await core.webhooks.receive({
      shopDomain,
      topic: 'customers/data_request',
      deliveryId: randomUUID(),
      apiVersion: '2026-07',
      triggeredAt: new Date(),
      eventId: null,
      name: null,
      rawBody,
    });
    await pool.query('update inbox_messages set purge_after=clock_timestamp() where id=any($1)', [
      [receipt.id, privacy.id],
    ]);
    const result = await core.webhooks.eraseExpiredPayloads(100);
    expect(result.erasedIds).toContain(receipt.id);
    expect(result.erasedIds).toContain(privacy.id);
    const row = (await pool.query('select payload,erasure_state,state from inbox_messages where id=$1', [privacy.id]))
      .rows[0];
    expect(row.payload.length).toBe(0);
    expect(row.erasure_state).toBe('erased');
    expect(row.state).toBe('pending');
    const facts = (
      await pool.query(
        "select purpose, captured_fields, captured_fields->'customer'->>'id' as customer_id,captured_fields->'orders_requested'->>0 as order_id from webhook_obligation_facts where inbox_id=$1",
        [privacy.id],
      )
    ).rows[0];
    expect(facts.purpose).toBe('UNQUALIFIED');
    await expect(
      pool.query(
        `update webhook_obligation_facts set collected_at=collected_at+interval '1 second' where inbox_id=$1`,
        [privacy.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('delete from webhook_obligation_facts where inbox_id=$1', [privacy.id]),
    ).rejects.toMatchObject({ code: '23514' });

    expect(facts.customer_id).toBe('9007199254740993');
    expect(facts.order_id).toBe('9007199254740995');
    expect(facts.captured_fields.currency).toBe('EUR');
    expect(facts.captured_fields.total_price).toBe('00012.3400');
    expect(facts.captured_fields.transaction_ids).toEqual(['9007199254740997']);
    expect(JSON.stringify(facts.captured_fields)).not.toContain('discard');
    expect(JSON.stringify(facts.captured_fields)).not.toContain('unneeded');
    expect(
      (await pool.query('select payload from inbox_messages where id=$1', [untouched.id])).rows[0].payload.equals(
        rawBody,
      ),
    ).toBe(true);
    expect(await core.webhooks.processUninstall(receipt.id)).toBe('expired');
    const later = await core.webhooks.eraseExpiredPayloads(100);
    expect(later.erasedIds).not.toContain(privacy.id);
    expect(later.blockedPrivacyIds).toContain(privacy.id);
    expect(later.unresolvedExpiredIds).toContain(receipt.id);
  } finally {
    await Promise.all([core.close(), pool.end()]);
  }
});

test('expiration preserves email-only identity without phones, handles unknown bytes and forgets minimal PII at its original cutoff', async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
  const shopDomain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
  const input = {
    shopDomain,
    topic: 'customers/data_request',
    deliveryId: randomUUID(),
    apiVersion: '2026-07',
    triggeredAt: new Date(),
    eventId: null,
    name: null,
    rawBody: Buffer.from(
      '{"shop_id":123,"customer":{"email":"needed@example.test","phone":"unneeded"},"orders_requested":[9007199254740993,{"email":"do not retain"}]}',
    ),
  };
  try {
    const email = await core.webhooks.receive(input);
    const malformed = await core.webhooks.receive({
      ...input,
      deliveryId: randomUUID(),
      topic: 'something/unsupported',
      rawBody: Buffer.from('malformed private name@example.test'),
    });
    await pool.query('update inbox_messages set purge_after=clock_timestamp() where id=any($1)', [
      [email.id, malformed.id],
    ]);
    await core.webhooks.eraseExpiredPayloads(100);
    const fields = (
      await pool.query('select captured_fields from webhook_obligation_facts where inbox_id=$1', [email.id])
    ).rows[0].captured_fields;
    expect(fields.customer).toEqual({ email: 'needed@example.test' });
    expect(fields.orders_requested).toEqual(['9007199254740993']);
    expect(fields.unsupportedOrderIdentity).toBe(true);
    expect(
      (await pool.query('select captured_fields from webhook_obligation_facts where inbox_id=$1', [malformed.id]))
        .rows[0].captured_fields,
    ).toEqual({ unsupportedBody: true });
    // A trusted test owner deliberately shortens only this fixed field set's
    // deadline; the worker cannot mutate it or extend the original collection cap.
    await pool.query('update webhook_obligation_facts set forget_after=clock_timestamp() where inbox_id=$1', [
      email.id,
    ]);
    await core.webhooks.eraseExpiredPayloads(100);
    const forgotten = (
      await pool.query(
        'select captured_fields,facts_erased_at,purpose from webhook_obligation_facts where inbox_id=$1',
        [email.id],
      )
    ).rows[0];
    expect(forgotten.captured_fields).toEqual({});
    expect(forgotten.facts_erased_at).toBeInstanceOf(Date);
    expect(forgotten.purpose).toBe('UNQUALIFIED');
  } finally {
    await Promise.all([core.close(), pool.end()]);
  }
});

test('fixed expiry capability cannot erase fresh bytes or grant direct payload/fact writes', async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
  const role = `m5_expiry_${randomUUID().replaceAll('-', '')}`;
  const client = await pool.connect();
  let roleCreated = false;
  try {
    const receipt = await core.webhooks.receive({
      shopDomain: `m${randomUUID().replaceAll('-', '')}.myshopify.com`,
      topic: 'app/uninstalled',
      deliveryId: randomUUID(),
      apiVersion: '2026-07',
      triggeredAt: new Date('2099-01-01'),
      eventId: null,
      name: null,
      rawBody: Buffer.from('{"id":123,"myshopify_domain":null}'),
    });
    await client.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
    roleCreated = true;
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await client.query(`SET ROLE ${role}`);
    await expect(client.query('select expire_shopify_webhook_bytes($1)', [receipt.id])).rejects.toMatchObject({
      code: '42501',
    });
    await client.query('RESET ROLE');
    await client.query(
      `GRANT EXECUTE ON FUNCTION expire_shopify_webhook_bytes(uuid),expire_shopify_webhook_facts(integer),pending_shopify_webhook_obligations(integer) TO ${role}`,
    );
    await client.query(`SET ROLE ${role}`);
    expect((await client.query('select expire_shopify_webhook_bytes($1) as erased', [receipt.id])).rows[0].erased).toBe(
      false,
    );
    await expect(client.query("update inbox_messages set payload='' where id=$1", [receipt.id])).rejects.toMatchObject({
      code: '42501',
    });
    await expect(client.query('select captured_fields from webhook_obligation_facts')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(client.query('select pending_shopify_webhook_obligations(null)')).rejects.toThrow();
    await client.query('RESET ROLE');
    await client.query('update inbox_messages set purge_after=clock_timestamp() where id=$1', [receipt.id]);
    await client.query(`SET ROLE ${role}`);
    expect((await client.query('select expire_shopify_webhook_bytes($1) as erased', [receipt.id])).rows[0].erased).toBe(
      true,
    );
    expect(
      (await client.query('select id from pending_shopify_webhook_obligations(100)')).rows.map((row) => row.id),
    ).toContain(receipt.id);
    await expect(
      client.query("update webhook_obligation_facts set captured_fields='{}' where inbox_id=$1", [receipt.id]),
    ).rejects.toMatchObject({ code: '42501' });
    await client.query('RESET ROLE');
    expect((await client.query('select state from inbox_messages where id=$1', [receipt.id])).rows[0].state).toBe(
      'pending',
    );
  } finally {
    await client.query('RESET ROLE');
    if (roleCreated) {
      await client.query(`DROP OWNED BY ${role}`);
      await client.query(`DROP ROLE ${role}`);
    }
    client.release();
    await Promise.all([core.close(), pool.end()]);
  }
});

test('populated minimal-obligation evidence blocks migration down and preserves its guards', async () => {
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  const name = `m5facts_${randomUUID().replaceAll('-', '')}`;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Owned PostgreSQL DATABASE_URL is required');
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const migrate = (direction: string) =>
    promisify(execFile)(
      `${root}node_modules/.bin/dbmate`,
      ['--no-dump-schema', '--migrations-dir', `${root}packages/database/migrations`, direction],
      { cwd: root, env: { ...process.env, DATABASE_URL: url.href }, timeout: 30000 },
    );
  let core: ReturnType<typeof createDurableCore> | undefined;
  let pool: Pool | undefined;
  let created = false;
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    created = true;
    await migrate('up');
    await migrate('rollback');
    await migrate('up');
    pool = new Pool({ connectionString: url.href });
    core = createDurableCore(new Pool({ connectionString: url.href }));
    const receipt = await core.webhooks.receive({
      shopDomain: 'synthetic-facts.myshopify.com',
      topic: 'customers/data_request',
      deliveryId: randomUUID(),
      apiVersion: '2026-07',
      triggeredAt: new Date(),
      eventId: null,
      name: null,
      rawBody: Buffer.from('{"shop_id":123,"customer":{"id":456}}'),
    });
    await pool.query('update inbox_messages set purge_after=clock_timestamp() where id=$1', [receipt.id]);
    await core.webhooks.eraseExpiredPayloads(100);
    const before = (await pool.query('select * from webhook_obligation_facts where inbox_id=$1', [receipt.id])).rows[0];
    await expect(migrate('rollback')).rejects.toThrow('webhook obligation evidence prevents rollback');
    expect(
      (await pool.query('select * from webhook_obligation_facts where inbox_id=$1', [receipt.id])).rows[0],
    ).toEqual(before);
    await expect(pool.query('truncate webhook_obligation_facts')).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('delete from webhook_obligation_facts where inbox_id=$1', [receipt.id]),
    ).rejects.toMatchObject({ code: '23514' });
    expect((await pool.query('select count(*)::int as count from webhook_obligation_facts')).rows[0].count).toBe(1);
  } finally {
    await core?.close();
    await pool?.end();
    if (created) await admin.query(`DROP DATABASE ${name}`);
    await admin.end();
  }
}, 60000);

test('JSONB content conversion failures cannot retain expired authenticated bytes or poison an ordinary batch', async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
  try {
    const ids: string[] = [];
    for (const body of [
      '{"shop_id":123,"value":1e1000000}',
      '{"shop_id":123,"value":"\\u0000"}',
      '{"shop_id":123,"customer":{"id":456}}',
    ]) {
      const receipt = await core.webhooks.receive({
        shopDomain: `m${randomUUID().replaceAll('-', '')}.myshopify.com`,
        topic: 'customers/redact',
        deliveryId: randomUUID(),
        apiVersion: '2026-07',
        triggeredAt: new Date(),
        eventId: null,
        name: null,
        rawBody: Buffer.from(body),
      });
      ids.push(receipt.id);
    }
    await pool.query('update inbox_messages set purge_after=clock_timestamp() where id=any($1)', [ids]);
    const result = await core.webhooks.eraseExpiredPayloads(100);
    expect(result.erasedIds).toEqual(expect.arrayContaining(ids));
    const rows = (
      await pool.query(
        'select inbox.id,inbox.payload,inbox.erasure_state,inbox.state,facts.purpose,facts.captured_fields from inbox_messages inbox join webhook_obligation_facts facts on facts.inbox_id=inbox.id where inbox.id=any($1)',
        [ids],
      )
    ).rows;
    for (const row of rows) {
      expect(row.payload.length).toBe(0);
      expect(row.erasure_state).toBe('erased');
      expect(row.state).toBe('pending');
      expect(row.purpose).toBe('UNQUALIFIED');
    }
    expect(rows.find((row) => row.id === ids[0]).captured_fields).toEqual({ unsupportedBody: true });
    expect(rows.find((row) => row.id === ids[1]).captured_fields).toEqual({ unsupportedBody: true });
    expect(rows.find((row) => row.id === ids[2]).captured_fields.customer.id).toBe('456');
  } finally {
    await core.close();
    await pool.end();
  }
});

test('complete diagnostic category counts expose newer privacy obligations beyond 100 immutable erased historical facts after restart', async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
  try {
    const before = await core.webhooks.eraseExpiredPayloads(100);
    const ids: string[] = [];
    for (let index = 0; index < 105; index++) {
      const receipt = await core.webhooks.receive({
        shopDomain: `m${randomUUID().replaceAll('-', '')}.myshopify.com`,
        topic: 'orders/create',
        deliveryId: randomUUID(),
        apiVersion: '2026-07',
        triggeredAt: new Date(),
        eventId: null,
        name: null,
        rawBody: Buffer.from('{"shop_id":123}'),
      });
      ids.push(receipt.id);
    }
    await pool.query("update inbox_messages set purge_after=clock_timestamp(),state='processed' where id=any($1)", [
      ids,
    ]);
    await core.webhooks.eraseExpiredPayloads(100);
    await core.webhooks.eraseExpiredPayloads(100);
    await pool.query('update webhook_obligation_facts set forget_after=clock_timestamp() where inbox_id=any($1)', [
      ids,
    ]);
    await core.webhooks.eraseExpiredPayloads(100);
    await core.webhooks.eraseExpiredPayloads(100);
    const privacy = await core.webhooks.receive({
      shopDomain: `m${randomUUID().replaceAll('-', '')}.myshopify.com`,
      topic: 'shop/redact',
      deliveryId: randomUUID(),
      apiVersion: '2026-07',
      triggeredAt: new Date(),
      eventId: null,
      name: null,
      rawBody: Buffer.from('{"shop_id":123}'),
    });
    await pool.query('update inbox_messages set purge_after=clock_timestamp() where id=$1', [privacy.id]);
    await core.webhooks.eraseExpiredPayloads(100);
    await core.close();
    core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
    const result = await core.webhooks.eraseExpiredPayloads(100);
    expect(result.blockedPrivacyIds).toContain(privacy.id);
    expect(result.blockedPrivacyCount).toBe(before.blockedPrivacyCount + 1);
    expect(result.blockedUnsupportedCount).toBe(before.blockedUnsupportedCount + 105);
    expect(result.blockedUnsupportedIds.length).toBeLessThanOrEqual(100);
    expect(
      (
        await pool.query(
          'select count(*)::int as count from webhook_obligation_facts where inbox_id=any($1) and facts_erased_at is not null',
          [ids],
        )
      ).rows[0].count,
    ).toBe(105);
  } finally {
    await core.close();
    await pool.end();
  }
}, 60000);
