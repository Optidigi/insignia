import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { expect, test } from 'vitest';
import { createDurableCore } from '../src/index.js';

const connectionString = process.env.DATABASE_URL;

async function fixture(url = connectionString) {
  const pool = new Pool({ connectionString: url });
  const core = createDurableCore(new Pool({ connectionString: url }));
  const shopId = randomUUID();
  const shopDomain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
  const shopifyShopId = (BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`) + 1n).toString();
  await core.transactions.run((tx) =>
    core.tenants.createShop(tx, {
      shopId,
      shopDomain,
      shopifyShopId,
      externalInstallationId: 'gid://shopify/AppInstallation/111',
    }),
  );
  const input = {
    shopDomain,
    topic: 'app/uninstalled',
    deliveryId: randomUUID(),
    apiVersion: '2026-07',
    triggeredAt: new Date(),
    eventId: null,
    name: null,
    rawBody: Buffer.from(JSON.stringify({ id: shopifyShopId, myshopify_domain: shopDomain })),
  };
  const receipt = await core.webhooks.receive(input);
  return {
    pool,
    core,
    shopId,
    input,
    receipt,
    async close() {
      await core.close();
      await pool.end();
    },
  };
}

async function expire(pool: Pool, id: string) {
  // Shorten the fixture's deadline without changing immutable collection time.
  await pool.query(`UPDATE inbox_messages SET purge_after=clock_timestamp()+interval '20 milliseconds' WHERE id=$1`, [
    id,
  ]);
  await new Promise((resolve) => setTimeout(resolve, 40));
}

test('expired signed uninstall cannot resolve or deactivate the current installation', async () => {
  const f = await fixture();
  try {
    await expire(f.pool, f.receipt.id);
    expect(await f.core.webhooks.getById(f.receipt.id)).toMatchObject({ resolution: 'expired' });
    expect(await f.core.webhooks.processUninstall(f.receipt.id)).toBe('expired');
    expect(await f.core.webhooks.pendingUninstallIds(100)).not.toContain(f.receipt.id);
    expect(await f.core.tenants.getCurrentAdminInstallation(f.shopId)).toMatchObject({ active: true });
  } finally {
    await f.close();
  }
});

test('erased uninstall evidence keeps a typed fail-closed managed-installation fence', async () => {
  const f = await fixture();
  try {
    await expire(f.pool, f.receipt.id);
    // Synthetic historical erased state: the corrected executor cannot create it.
    await f.pool.query("UPDATE inbox_messages SET payload=''::bytea,erasure_state='erased' WHERE id=$1", [
      f.receipt.id,
    ]);
    const expected = await f.core.tenants.getManagedInstallationState(f.input.shopDomain);
    await expect(
      f.core.transactions.run((tx) =>
        f.core.tenants.ensureManagedInstallation(tx, {
          shopDomain: f.input.shopDomain,
          shopifyShopId: JSON.parse(f.input.rawBody.toString()).id,
          externalInstallationId: 'gid://shopify/AppInstallation/111',
          expected,
          observationStartedAt: new Date(f.input.triggeredAt.getTime() - 1),
        }),
      ),
    ).rejects.toMatchObject({ name: 'ManagedInstallationError', kind: 'state_changed' });
    expect(await f.core.tenants.getCurrentAdminInstallation(f.shopId)).toMatchObject({ active: true, generation: '1' });
  } finally {
    await f.close();
  }
});

test('bounded maintenance preserves unqualified uninstall bytes and overdue unresolved work', async () => {
  const f = await fixture();
  try {
    const unrelatedId = randomUUID();
    await f.pool.query(
      `INSERT INTO inbox_messages(id,source,payload,payload_sha256,received_at,retention_class,purge_after)
      VALUES($1,'other',$2,$3,clock_timestamp(),'shopify-webhook',clock_timestamp()+interval '20 milliseconds')`,
      [unrelatedId, Buffer.from('synthetic unrelated payload'), 'a'.repeat(64)],
    );
    await expire(f.pool, f.receipt.id);
    const before = await f.pool.query('SELECT purge_after,collected_at FROM inbox_messages WHERE id=$1', [
      f.receipt.id,
    ]);
    const erased = await f.core.webhooks.eraseExpiredPayloads(100);
    expect(erased.erasedIds).toEqual([]);
    expect(erased.blockedUninstallIds).toContain(f.receipt.id);
    expect(erased.unresolvedExpiredIds).toContain(f.receipt.id);
    const rows = await f.pool.query(
      `SELECT octet_length(payload) AS bytes,erasure_state,state,last_error_class,
      purge_after,collected_at FROM inbox_messages WHERE id=$1`,
      [f.receipt.id],
    );
    expect(rows.rows[0]).toMatchObject({
      bytes: f.input.rawBody.length,
      erasure_state: 'retained',
      state: 'pending',
      last_error_class: null,
      purge_after: before.rows[0].purge_after,
      collected_at: before.rows[0].collected_at,
    });
    expect((await f.core.webhooks.eraseExpiredPayloads(100)).erasedIds).not.toContain(f.receipt.id);
    expect(
      (await f.pool.query('SELECT payload FROM inbox_messages WHERE id=$1', [unrelatedId])).rows[0].payload.toString(),
    ).toBe('synthetic unrelated payload');
    expect(await f.core.webhooks.processUninstall(f.receipt.id)).toBe('expired');
  } finally {
    await f.close();
  }
});

test('expired erased duplicate preserves its original deadline and never recreates retained bytes', async () => {
  const f = await fixture();
  try {
    await expire(f.pool, f.receipt.id);
    const before = (await f.pool.query('SELECT purge_after FROM inbox_messages WHERE id=$1', [f.receipt.id])).rows[0];
    // Synthetic historical erasure compatibility, not an authorized executor path.
    await f.pool.query("UPDATE inbox_messages SET payload=''::bytea,erasure_state='erased' WHERE id=$1", [
      f.receipt.id,
    ]);
    expect(await f.core.webhooks.receive(f.input)).toMatchObject({ kind: 'expired', id: f.receipt.id });
    const after = (
      await f.pool.query('SELECT purge_after,octet_length(payload) AS bytes FROM inbox_messages WHERE id=$1', [
        f.receipt.id,
      ])
    ).rows[0];
    expect(after).toEqual({ ...before, bytes: 0 });
    await expect(
      f.core.webhooks.receive({
        ...f.input,
        rawBody: Buffer.from(JSON.stringify({ id: '999', myshopify_domain: f.input.shopDomain })),
      }),
    ).rejects.toMatchObject({ name: 'ShopifyDeliveryConflictError' });
  } finally {
    await f.close();
  }
});

test('database wall clock is rechecked after an uninstall waits for the shop lock', async () => {
  const f = await fixture();
  const blocker = await f.pool.connect();
  let processing: Promise<string> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT shop_id FROM shops WHERE shop_id=$1 FOR NO KEY UPDATE', [f.shopId]);
    await f.pool.query(
      `UPDATE inbox_messages SET purge_after=clock_timestamp()+interval '250 milliseconds' WHERE id=$1`,
      [f.receipt.id],
    );
    processing = f.core.webhooks.processUninstall(f.receipt.id);
    // Observe a real lock wait, then let the database deadline pass while held.
    const deadline = Date.now() + 2_000;
    let waiting = false;
    while (Date.now() < deadline) {
      const { rows } = await f.pool.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%"shops"%') AS waiting`);
      if (rows[0].waiting) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await blocker.query('COMMIT');
    expect(await processing).toBe('expired');
    expect(await f.core.tenants.getCurrentAdminInstallation(f.shopId)).toMatchObject({ active: true });
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    if (processing) await processing;
    await f.close();
  }
});

test('durable handoff excludes expired callbacks and records expiration crossing queue acknowledgement', async () => {
  const f = await fixture();
  const hook = `handoff_expiry_${randomUUID().replaceAll('-', '')}`;
  try {
    // Expire this fixture at the persisted ACK boundary, not before transport
    // starts on a loaded runner. Production code and its real DB clock stay intact.
    await f.pool.query(
      `CREATE FUNCTION ${hook}() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.inbox_id=TG_ARGV[0]::uuid AND NEW.queue_handoff_state='confirmed' THEN
           UPDATE public.inbox_messages SET purge_after=clock_timestamp() WHERE id=NEW.inbox_id;
         END IF;
         RETURN NEW;
       END $$`,
    );
    const trigger = await f.pool.query(
      `SELECT format('CREATE TRIGGER %I AFTER UPDATE OF queue_handoff_state ON shopify_webhook_deliveries
        FOR EACH ROW EXECUTE FUNCTION %I(%L)', $1::text, $1::text, $2::text) AS command`,
      [hook, f.receipt.id],
    );
    await f.pool.query(trigger.rows[0].command);
    let calls = 0;
    const result = await f.core.webhooks.withQueueHandoff(f.receipt.id, async (state) => {
      expect(state).toBe('unconfirmed');
      calls++;
      return 'enqueued';
    });
    expect(result).toBe('expired');
    expect(
      await f.core.webhooks.withQueueHandoff(f.receipt.id, async () => {
        calls++;
        return 'enqueued';
      }),
    ).toBe('expired');
    expect(calls).toBe(1);
    const { rows } = await f.pool.query(
      'SELECT queue_handoff_state,queue_cleanup_pending FROM shopify_webhook_deliveries WHERE inbox_id=$1',
      [f.receipt.id],
    );
    expect(rows[0]).toEqual({ queue_handoff_state: 'confirmed', queue_cleanup_pending: true });
    expect(await f.core.webhooks.processUninstall(f.receipt.id)).toBe('expired');
  } finally {
    try {
      await f.pool.query(`DROP TRIGGER IF EXISTS ${hook} ON shopify_webhook_deliveries`);
      await f.pool.query(`DROP FUNCTION IF EXISTS ${hook}()`);
    } finally {
      await f.close();
    }
  }
});

test('real terminal queue failure is durable exhaustion without payload erasure or successful processing', async () => {
  const f = await fixture();
  try {
    expect(await f.core.webhooks.withQueueHandoff(f.receipt.id, async () => 'exhausted')).toBe('exhausted');
    let calls = 0;
    expect(
      await f.core.webhooks.withQueueHandoff(f.receipt.id, async () => {
        calls++;
        return 'enqueued';
      }),
    ).toBe('exhausted');
    expect(calls).toBe(0);
    expect(await f.core.webhooks.pendingUninstallIds(100)).not.toContain(f.receipt.id);
    const { rows } = await f.pool.query(
      'SELECT state,erasure_state,last_error_class,octet_length(payload) AS bytes FROM inbox_messages WHERE id=$1',
      [f.receipt.id],
    );
    expect(rows[0]).toMatchObject({
      state: 'failed',
      erasure_state: 'retained',
      last_error_class: 'webhook_queue_exhausted',
    });
    expect(rows[0].bytes).toBeGreaterThan(0);
    expect(await f.core.webhooks.processUninstall(f.receipt.id)).toBe('exhausted');
    expect(await f.core.tenants.getCurrentAdminInstallation(f.shopId)).toMatchObject({ active: true });
  } finally {
    await f.close();
  }
});

test.each(['pending', 'processed'])(
  'unsigned uninstall topic cannot authorize erasure of uncaptured mixed obligations in %s state',
  async (state) => {
    const f = await fixture();
    try {
      const rawBody = Buffer.from(
        JSON.stringify({
          ...JSON.parse(f.input.rawBody.toString()),
          customer: { id: '456' },
          orders_to_redact: ['789'],
          currency: 'EUR',
          total_price: '12.34',
        }),
      );
      const receipt = await f.core.webhooks.receive({ ...f.input, deliveryId: randomUUID(), rawBody });
      if (state === 'processed') {
        // Historical processed evidence only; quarantine cannot create this state.
        await f.pool.query("UPDATE inbox_messages SET state='processed' WHERE id=$1", [receipt.id]);
      }
      await expire(f.pool, receipt.id);
      const before = (
        await f.pool.query('SELECT payload,purge_after,state,erasure_state FROM inbox_messages WHERE id=$1', [
          receipt.id,
        ])
      ).rows[0];
      const result = await f.core.webhooks.eraseExpiredPayloads(100);
      expect(result.erasedIds).not.toContain(receipt.id);
      expect(result.blockedUninstallIds).toContain(receipt.id);
      expect(
        (
          await f.pool.query('SELECT payload,purge_after,state,erasure_state FROM inbox_messages WHERE id=$1', [
            receipt.id,
          ])
        ).rows[0],
      ).toEqual(before);
      expect(before.payload).toEqual(rawBody);
      expect(before.state).toBe(state);
    } finally {
      await f.close();
    }
  },
);

test.each(['customers/data_request', 'customers/redact', 'shop/redact'])(
  'unfulfilled expired %s receipt blocks purge instead of destroying its only subject identity',
  async (topic) => {
    const f = await fixture();
    try {
      const receipt = await f.core.webhooks.receive({
        ...f.input,
        topic,
        deliveryId: randomUUID(),
        rawBody: Buffer.from(JSON.stringify({ customer: { id: '456' }, orders_to_redact: ['789'] })),
      });
      await expire(f.pool, receipt.id);
      const before = (await f.pool.query('SELECT payload,purge_after FROM inbox_messages WHERE id=$1', [receipt.id]))
        .rows[0];
      const result = await f.core.webhooks.eraseExpiredPayloads(100);
      expect(result.erasedIds).not.toContain(receipt.id);
      expect(result.blockedPrivacyIds).toContain(receipt.id);
      const { rows } = await f.pool.query(
        'SELECT state,erasure_state,octet_length(payload) AS bytes,purge_after<clock_timestamp() AS overdue FROM inbox_messages WHERE id=$1',
        [receipt.id],
      );
      expect(rows[0]).toMatchObject({ state: 'pending', erasure_state: 'retained', overdue: true });
      expect(rows[0].bytes).toBeGreaterThan(0);
      expect(
        (await f.pool.query('SELECT payload,purge_after FROM inbox_messages WHERE id=$1', [receipt.id])).rows[0],
      ).toEqual(before);
      expect(await f.core.webhooks.getById(receipt.id)).toMatchObject({ resolution: 'expired' });
    } finally {
      await f.close();
    }
  },
);

test.each(['orders/paid', 'orders/create', 'refunds/create'])(
  'expired unsupported %s and uninstall sole facts both survive',
  async (topic) => {
    const f = await fixture();
    try {
      const receipt = await f.core.webhooks.receive({
        ...f.input,
        topic,
        deliveryId: randomUUID(),
        rawBody: Buffer.from(
          JSON.stringify({ id: '123', currency: 'EUR', total_price: '12.34', transaction_ids: ['456'] }),
        ),
      });
      expect(await f.core.webhooks.getById(receipt.id)).toMatchObject({ state: 'pending' });
      await expire(f.pool, receipt.id);
      const before = (await f.pool.query('SELECT payload,purge_after FROM inbox_messages WHERE id=$1', [receipt.id]))
        .rows[0];
      await expire(f.pool, f.receipt.id);
      const result = await f.core.webhooks.eraseExpiredPayloads(100);
      expect(result.erasedIds).not.toContain(receipt.id);
      expect(result.blockedUnsupportedIds).toContain(receipt.id);
      expect(result.blockedUninstallIds).toContain(f.receipt.id);
      expect(
        (await f.pool.query('SELECT payload,purge_after FROM inbox_messages WHERE id=$1', [receipt.id])).rows[0],
      ).toEqual(before);
      expect(
        (
          await f.pool.query(
            'SELECT state,erasure_state,purge_after<clock_timestamp() AS overdue FROM inbox_messages WHERE id=$1',
            [receipt.id],
          )
        ).rows[0],
      ).toEqual({ state: 'pending', erasure_state: 'retained', overdue: true });
      expect(
        (
          await f.pool.query('SELECT octet_length(payload) AS bytes,erasure_state FROM inbox_messages WHERE id=$1', [
            f.receipt.id,
          ])
        ).rows[0],
      ).toEqual({ bytes: f.input.rawBody.length, erasure_state: 'retained' });
    } finally {
      await f.close();
    }
  },
);

test('unindexed overdue Shopify bytes remain an explicit unknown blocker', async () => {
  const f = await fixture();
  try {
    const id = randomUUID();
    const payload = Buffer.from('synthetic unknown payload');
    await f.pool.query(
      `INSERT INTO inbox_messages(id,source,payload,payload_sha256,received_at,retention_class,purge_after)
      VALUES($1,'shopify',$2,$3,clock_timestamp(),'shopify-webhook',clock_timestamp()+interval '20 milliseconds')`,
      [id, payload, createHash('sha256').update(payload).digest('hex')],
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    const before = (await f.pool.query('SELECT payload,purge_after FROM inbox_messages WHERE id=$1', [id])).rows[0];
    await expire(f.pool, f.receipt.id);
    const result = await f.core.webhooks.eraseExpiredPayloads(100);
    expect(result.blockedUnknownIds).toContain(id);
    expect(result.blockedUnsupportedIds).not.toContain(id);
    expect(result.blockedPrivacyIds).not.toContain(id);
    expect(result.blockedUninstallIds).toContain(f.receipt.id);
    expect((await f.pool.query('SELECT payload,purge_after FROM inbox_messages WHERE id=$1', [id])).rows[0]).toEqual(
      before,
    );
    expect(
      (
        await f.pool.query(
          'SELECT state,erasure_state,purge_after<clock_timestamp() AS overdue FROM inbox_messages WHERE id=$1',
          [id],
        )
      ).rows[0],
    ).toEqual({ state: 'pending', erasure_state: 'retained', overdue: true });
  } finally {
    await f.close();
  }
});

test('unqualified uninstall observations are bounded without discarding facts or extending deadlines', async () => {
  const f = await fixture();
  try {
    await expire(f.pool, f.receipt.id);
    const before = (
      await f.pool.query('SELECT payload,purge_after,state,erasure_state FROM inbox_messages WHERE id=$1', [
        f.receipt.id,
      ])
    ).rows[0];
    const result = await f.core.webhooks.eraseExpiredPayloads(1);
    expect(result.erasedIds).toEqual([]);
    expect(result.blockedUninstallIds).toHaveLength(1);
    expect(
      result.blockedPrivacyIds.length + result.blockedUnknownIds.length + result.blockedUnsupportedIds.length,
    ).toBeLessThanOrEqual(1);
    expect(
      (
        await f.pool.query('SELECT payload,purge_after,state,erasure_state FROM inbox_messages WHERE id=$1', [
          f.receipt.id,
        ])
      ).rows[0],
    ).toEqual(before);
  } finally {
    await f.close();
  }
});

test('deadline is checked after waiting for the inbox row before quarantine resolution', async () => {
  const f = await fixture();
  const blocker = await f.pool.connect();
  let processing: Promise<string> | undefined;
  try {
    await f.pool.query(
      `UPDATE inbox_messages SET purge_after=clock_timestamp()+interval '250 milliseconds' WHERE id=$1`,
      [f.receipt.id],
    );
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM inbox_messages WHERE id=$1 FOR UPDATE', [f.receipt.id]);
    processing = f.core.webhooks.processUninstall(f.receipt.id);
    const deadline = Date.now() + 2_000;
    let waiting = false;
    while (Date.now() < deadline) {
      const { rows } = await f.pool.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%"inbox_messages"%') AS waiting`);
      if (rows[0].waiting) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await blocker.query('COMMIT');
    expect(await processing).toBe('expired');
    expect(await f.core.tenants.getCurrentAdminInstallation(f.shopId)).toMatchObject({ active: true });
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    if (processing) await processing;
    await f.close();
  }
});

test('retention migration preserves legacy ambiguity, new defaults and populated rollback fences', async () => {
  if (!connectionString) throw new Error('Owned PostgreSQL DATABASE_URL is required');
  const admin = new Pool({ connectionString });
  const name = `m5retention_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(connectionString);
  url.pathname = '/' + name;
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const execute = promisify(execFile);
  const migrate = (direction: string) =>
    execute(
      root + 'node_modules/.bin/dbmate',
      ['--no-dump-schema', '--migrations-dir', root + 'packages/database/migrations', direction],
      { cwd: root, env: { ...process.env, DATABASE_URL: url.href }, timeout: 30_000 },
    );
  let pool: Pool | undefined;
  let fresh: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    await admin.query('CREATE DATABASE ' + name);
    await migrate('up');
    await migrate('rollback'); // Unselected transport diagnostic44 can roll back.
    await migrate('rollback'); // Rehearse original43 legacy reservation contract.
    pool = new Pool({ connectionString: url.href });
    expect(
      (
        await pool.query(`SELECT column_name FROM information_schema.columns
      WHERE table_name='shopify_webhook_deliveries' AND column_name='queue_handoff_state'`)
      ).rowCount,
    ).toBe(0);
    const legacyId = randomUUID();
    const body = Buffer.from(JSON.stringify({ id: '123', myshopify_domain: null }));
    await pool.query(
      `INSERT INTO inbox_messages(id,source,external_delivery_id,payload,payload_sha256,received_at,retention_class,purge_after)
      VALUES($1::text::uuid,'shopify',$1::text,$2,$3,clock_timestamp(),'shopify-webhook',clock_timestamp()+interval '7 days')`,
      [legacyId, body, createHash('sha256').update(body).digest('hex')],
    );
    await pool.query(
      `INSERT INTO shopify_webhook_deliveries(inbox_id,shop_domain,delivery_id,topic,api_version,triggered_at)
      VALUES($1::text::uuid,'legacy.myshopify.com',$1::text,'app/uninstalled','2026-07',clock_timestamp())`,
      [legacyId],
    );
    await migrate('up');
    expect(
      (await pool.query('SELECT queue_handoff_state FROM shopify_webhook_deliveries WHERE inbox_id=$1', [legacyId]))
        .rows[0].queue_handoff_state,
    ).toBe('unknown');
    fresh = await fixture(url.href);
    expect(
      (
        await pool.query('SELECT queue_handoff_state FROM shopify_webhook_deliveries WHERE inbox_id=$1', [
          fresh.receipt.id,
        ])
      ).rows[0].queue_handoff_state,
    ).toBe('unconfirmed');
    expect(
      await fresh.core.webhooks.withQueueHandoff(legacyId, async (state) => {
        expect(state).toBe('unknown');
        return 'missing';
      }),
    ).toBe('missing');
    await migrate('rollback'); // No selection occurred:44 has no progress to erase.
    await expect(migrate('rollback')).rejects.toThrow('durable webhook queue evidence prevents rollback');
    expect((await pool.query("SELECT version FROM schema_migrations WHERE version='20261009000100'")).rowCount).toBe(1);
    expect(
      (await pool.query('SELECT queue_handoff_state FROM shopify_webhook_deliveries WHERE inbox_id=$1', [legacyId]))
        .rows[0].queue_handoff_state,
    ).toBe('exhausted');
  } finally {
    await fresh?.close();
    await pool?.end();
    await admin.query('DROP DATABASE IF EXISTS ' + name);
    await admin.end();
  }
}, 60_000);

test('recovery selection migration44 preserves progress and grants only its transport column', async () => {
  if (!connectionString) throw new Error('Owned PostgreSQL DATABASE_URL is required');
  const admin = new Pool({ connectionString });
  const name = `m5recovery_migration_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const migrate = (direction: string) =>
    promisify(execFile)(
      `${root}node_modules/.bin/dbmate`,
      ['--no-dump-schema', '--migrations-dir', `${root}packages/database/migrations`, direction],
      { cwd: root, env: { ...process.env, DATABASE_URL: url.href }, timeout: 30_000 },
    );
  let pool: Pool | undefined;
  let f: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    // This fixed NOLOGIN transport group is local fixture provisioning; production
    // installer/role ownership remains separate from schema qualification.
    await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='insignia_queue_consume')
      THEN CREATE ROLE insignia_queue_consume NOLOGIN; END IF; END $$`);
    await admin.query(`CREATE DATABASE ${name}`);
    await migrate('up');
    await migrate('rollback');
    await migrate('up');
    pool = new Pool({ connectionString: url.href });
    expect(
      (
        await pool.query(`SELECT has_column_privilege('insignia_queue_consume','shopify_webhook_deliveries','queue_recovery_selected_at','UPDATE') AS selected,
      has_column_privilege('insignia_queue_consume','shopify_webhook_deliveries','delivery_id','UPDATE') AS identity`)
      ).rows[0],
    ).toEqual({ selected: true, identity: false });
    f = await fixture(url.href);
    expect(await f.core.webhooks.pendingUninstallIds(100)).toContain(f.receipt.id);
    expect(
      (
        await pool.query('SELECT queue_recovery_selected_at FROM shopify_webhook_deliveries WHERE inbox_id=$1', [
          f.receipt.id,
        ])
      ).rows[0].queue_recovery_selected_at,
    ).toBeNull();
    const before = (
      await pool.query('SELECT payload,purge_after,state,attempts FROM inbox_messages WHERE id=$1', [f.receipt.id])
    ).rows[0];
    await expect(f.core.webhooks.selectUninstallRecoveryIds(0)).rejects.toThrow('Invalid uninstall recovery limit');
    await expect(f.core.webhooks.selectUninstallRecoveryIds(101)).rejects.toThrow('Invalid uninstall recovery limit');
    expect(await f.core.webhooks.selectUninstallRecoveryIds(1)).toEqual([f.receipt.id]);
    expect(
      (
        await pool.query(
          'SELECT queue_handoff_state,isfinite(queue_recovery_selected_at) AS finite FROM shopify_webhook_deliveries WHERE inbox_id=$1',
          [f.receipt.id],
        )
      ).rows[0],
    ).toEqual({ queue_handoff_state: 'unconfirmed', finite: true });
    expect(
      (await pool.query('SELECT payload,purge_after,state,attempts FROM inbox_messages WHERE id=$1', [f.receipt.id]))
        .rows[0],
    ).toEqual(before);
    await expect(migrate('rollback')).rejects.toThrow('durable webhook recovery selection evidence prevents rollback');
    expect((await pool.query("SELECT version FROM schema_migrations WHERE version='20261009000200'")).rowCount).toBe(1);
    expect((await f.core.tenants.getCurrentAdminInstallation(f.shopId))?.active).toBe(true);
  } finally {
    await f?.close();
    await pool?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.end();
  }
}, 60_000);
