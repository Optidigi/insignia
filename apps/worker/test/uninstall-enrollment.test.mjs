import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { isolatedDatabase } from '../../web/test/support/isolated-database.mjs';
import {
  createAutomaticUninstallEnrollment,
  createUninstallEnrollmentReconciliation,
} from '../src/uninstall-enrollment.ts';

if (!process.env.DATABASE_URL) {
  try {
    process.env.DATABASE_URL = JSON.parse(readFileSync('/tmp/insignia-lifecycle-pg.json', 'utf8')).url;
  } catch {
    /* Explicit database opt-in remains required in other environments. */
  }
}
const options = {
  skip: !process.env.DATABASE_URL && process.env.INSIGNIA_REQUIRE_POSTGRES_TEST !== '1',
  timeout: 30_000,
};
const origin = 'https://lifecycle.example.test';
async function fixture(t) {
  assert.ok(process.env.DATABASE_URL);
  const database = await isolatedDatabase('uninstall_enroll');
  const pool = new Pool({ connectionString: database.connectionString });
  const core = createDurableCore(new Pool({ connectionString: database.connectionString }));
  t.after(async () => {
    await core.close();
    await pool.end();
    await database.close();
  });
  async function shop(prefix = 'a', numeric = '101') {
    const shopId = `${prefix}-${randomUUID()}`,
      domain = `s${randomUUID().replaceAll('-', '')}.myshopify.com`;
    const externalInstallationId = `gid://shopify/AppInstallation/${numeric}`;
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, { shopId, shopDomain: domain, shopifyShopId: numeric, externalInstallationId }),
    );
    return {
      grant: { shop: domain, accessToken: 'synthetic-offline-only-token' },
      scope: {
        shopId,
        installationGeneration: '1',
        externalInstallationId,
        providerShopId: `gid://shopify/Shop/${numeric}`,
      },
    };
  }
  return {
    core,
    pool,
    shop,
    rows: async () =>
      (
        await pool.query(
          'SELECT capability_digest,state,subscription_id FROM uninstall_destinations ORDER BY created_at,capability_digest',
        )
      ).rows,
    enroll: (client) =>
      createAutomaticUninstallEnrollment({
        core,
        appOrigin: origin,
        appClientId: 'synthetic-client',
        appSecret: 'synthetic-lifecycle-secret',
        client,
      }),
  };
}
const subscription = (id, uri) => ({ id: `gid://shopify/WebhookSubscription/${id}`, topic: 'APP_UNINSTALLED', uri });

test(
  'definite no-dispatch rejection can retry the same durable destination and register only after readback',
  options,
  async (t) => {
    const f = await fixture(t),
      shop = await f.shop();
    let creates = 0,
      uri;
    const enroll = f.enroll({
      create: async (_grant, _scope, callback) => {
        uri = callback;
        return ++creates === 1
          ? { kind: 'rejected', reason: 'not_dispatched' }
          : { kind: 'acknowledged', subscription: subscription(1, callback) };
      },
      read: async () => subscription(1, uri),
      reconcile: async () => {
        throw Error('rejected operations must not become unknown');
      },
    });
    await assert.rejects(enroll(shop.grant, shop.scope));
    assert.equal((await f.rows())[0].state, 'rejected');
    await enroll(shop.grant, shop.scope);
    assert.equal(creates, 2);
    assert.deepEqual(
      (await f.rows()).map((row) => row.state),
      ['registered'],
    );
    const events = (
      await f.pool.query('SELECT next_state FROM uninstall_destination_events ORDER BY event_id')
    ).rows.map((row) => row.next_state);
    assert.deepEqual(events, ['dispatched', 'rejected', 'prepared', 'dispatched', 'registered']);
  },
);

test(
  'unknown create never redispatches and settles only the exact destination observed independently',
  options,
  async (t) => {
    const f = await fixture(t),
      shop = await f.shop();
    let creates = 0,
      reconciles = 0,
      expectedUri;
    const enroll = f.enroll({
      create: async (_grant, _scope, uri) => {
        creates++;
        expectedUri = uri;
        return { kind: 'unknown' };
      },
      read: async () => {
        throw Error('no acknowledged subscription ID');
      },
      reconcile: async (grant, scope, uri) => {
        reconciles++;
        assert.deepEqual(grant, shop.grant);
        assert.equal(scope.installationId, shop.scope.externalInstallationId);
        assert.equal(uri, expectedUri);
        return reconciles === 1 ? null : subscription(2, uri);
      },
    });
    await assert.rejects(enroll(shop.grant, shop.scope));
    await assert.rejects(enroll(shop.grant, shop.scope));
    assert.equal((await f.rows())[0].state, 'dispatched');
    await enroll(shop.grant, shop.scope);
    assert.equal(creates, 1);
    assert.equal(reconciles, 2);
    assert.equal((await f.rows())[0].subscription_id, 'gid://shopify/WebhookSubscription/2');
  },
);

test('create acknowledgement remains dispatched until independent readback qualifies it', options, async (t) => {
  const f = await fixture(t),
    shop = await f.shop();
  let readStarted,
    releaseRead,
    uri,
    creates = 0;
  const started = new Promise((resolve) => {
    readStarted = resolve;
  });
  const released = new Promise((resolve) => {
    releaseRead = resolve;
  });
  const enroll = f.enroll({
    create: async (_grant, _scope, callback) => {
      creates++;
      uri = callback;
      return { kind: 'acknowledged', subscription: subscription(3, uri) };
    },
    read: async () => {
      readStarted();
      await released;
      return null;
    },
    reconcile: async () => subscription(3, uri),
  });
  const pending = enroll(shop.grant, shop.scope);
  await started;
  assert.deepEqual(
    (await f.rows()).map((row) => row.state),
    ['dispatched'],
  );
  releaseRead();
  await assert.rejects(pending);
  assert.equal((await f.rows())[0].state, 'dispatched');
  await enroll(shop.grant, shop.scope);
  assert.equal(creates, 1);
  assert.equal((await f.rows())[0].state, 'registered');
});

for (const drift of ['missing', 'different-uri'])
  test(
    `registered destination ${drift} creates a new immutable capability after positive readback`,
    options,
    async (t) => {
      const f = await fixture(t),
        shop = await f.shop(),
        created = [];
      let change = false;
      const enroll = f.enroll({
        create: async (_grant, _scope, uri) => {
          const entry = subscription(created.length + 10, uri);
          created.push(entry);
          return { kind: 'acknowledged', subscription: entry };
        },
        read: async (_grant, _scope, id) => {
          const item = created.find((entry) => entry.id === id);
          return change && id === created[0].id
            ? drift === 'missing'
              ? null
              : { ...item, uri: `${origin}/api/webhooks/uninstall/${'0'.repeat(64)}` }
            : item;
        },
        reconcile: async () => {
          throw Error('registered drift is a definite independent observation');
        },
      });
      await enroll(shop.grant, shop.scope);
      const before = (await f.rows())[0];
      change = true;
      await enroll(shop.grant, shop.scope);
      const rows = await f.rows();
      assert.equal(created.length, 2);
      assert.notEqual(created[0].uri, created[1].uri);
      assert.deepEqual(
        rows.map((row) => row.state),
        ['retired', 'registered'],
      );
      assert.equal(rows[0].capability_digest, before.capability_digest);
      assert.equal(rows[0].subscription_id, before.subscription_id);
    },
  );

test('registered read errors neither retire nor repair a destination', options, async (t) => {
  const f = await fixture(t),
    shop = await f.shop();
  let creates = 0,
    uri,
    error = false;
  const enroll = f.enroll({
    create: async (_grant, _scope, callback) => {
      creates++;
      uri = callback;
      return { kind: 'acknowledged', subscription: subscription(20, uri) };
    },
    read: async () => {
      if (error) throw Error('provider read unavailable');
      return subscription(20, uri);
    },
    reconcile: async () => null,
  });
  await enroll(shop.grant, shop.scope);
  const before = await f.rows();
  error = true;
  await assert.rejects(enroll(shop.grant, shop.scope));
  assert.equal(creates, 1);
  assert.deepEqual(await f.rows(), before);
});

test(
  'background reconciliation uses offline credentials without staff requests and advances past unavailable shops',
  options,
  async (t) => {
    const f = await fixture(t),
      unavailable = await f.shop('a', '201'),
      available = await f.shop('b', '202');
    const acquired = [],
      enrolled = [];
    const reconciliation = createUninstallEnrollmentReconciliation({
      core: f.core,
      credentials: {
        acquire: async (scope) => {
          acquired.push(scope.shopId);
          return scope.shopId === unavailable.scope.shopId
            ? { kind: 'reauth_required' }
            : {
                kind: 'usable',
                shopDomain: available.grant.shop,
                accessToken: available.grant.accessToken,
                accessExpiresAt: new Date(Date.now() + 60_000),
              };
        },
      },
      enroll: async (grant, scope) => {
        enrolled.push(scope.shopId);
        assert.deepEqual(grant, available.grant);
      },
    });
    await assert.rejects(reconciliation.runOnce());
    await reconciliation.runOnce();
    await assert.rejects(reconciliation.runOnce());
    assert.deepEqual(acquired, [unavailable.scope.shopId, available.scope.shopId, unavailable.scope.shopId]);
    assert.deepEqual(enrolled, [available.scope.shopId]);
  },
);
