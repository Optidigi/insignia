import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { type TestContext, test } from 'node:test';

type Client = ReturnType<typeof createUninstallSubscriptionClient>;
type Subscription = NonNullable<Awaited<ReturnType<Client['read']>>>;
function required<T>(value: T | undefined): T {
  assert(value !== undefined);
  return value;
}
function record(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
}

import { createDurableCore } from '@insignia/database';
import { createUninstallSubscriptionClient } from '@insignia/shopify';
import { Pool } from 'pg';
import { isolatedDatabase } from '../../web/test/support/isolated-database.mts';
import {
  createAutomaticUninstallEnrollment,
  createUninstallEnrollmentReconciliation,
} from '../src/uninstall-enrollment.ts';

const options = {
  skip: !process.env.DATABASE_URL && process.env.INSIGNIA_REQUIRE_POSTGRES_TEST !== '1',
  timeout: 30_000,
};
const origin = 'https://lifecycle.example.test';
async function fixture(t: TestContext) {
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
        await pool.query<{ capability_digest: string; state: string; subscription_id: string | null }>(
          'SELECT capability_digest,state,subscription_id FROM uninstall_destinations ORDER BY created_at,capability_digest',
        )
      ).rows,
    enroll: (client: Client) =>
      createAutomaticUninstallEnrollment({
        core,
        appOrigin: origin,
        appClientId: 'synthetic-client',
        appSecret: 'synthetic-lifecycle-secret',
        client,
      }),
  };
}
const subscription = (id: number | string, uri: unknown): Subscription => {
  assert(typeof uri === 'string');
  return { id: `gid://shopify/WebhookSubscription/${id}`, topic: 'APP_UNINSTALLED', uri };
};

test(
  'real Shopify adapter observes foreign-origin drift and enrollment replaces only that immutable binding',
  options,
  async (t) => {
    const f = await fixture(t),
      shop = await f.shop(),
      remote = new Map<string, Subscription>();
    let creates = 0;
    const client = createUninstallSubscriptionClient({
      expectedOrigin: origin,
      fetchImpl: async (url, init) => {
        assert.equal(url, `https://${shop.grant.shop}/admin/api/2026-07/graphql.json`);
        assert(typeof init?.body === 'string');
        const raw: unknown = JSON.parse(init.body);
        const { query, variables: rawVariables } = record(raw);
        assert(typeof query === 'string');
        const variables = record(rawVariables);
        if (query.includes('LifecycleIdentity'))
          return Response.json({
            data: {
              shop: { id: shop.scope.providerShopId, myshopifyDomain: shop.grant.shop },
              currentAppInstallation: { id: shop.scope.externalInstallationId, app: { apiKey: 'synthetic-client' } },
            },
          });
        if (query.includes('LifecycleSubscribe')) {
          const value = subscription(++creates, variables.uri);
          remote.set(value.id, value);
          return Response.json({ data: { webhookSubscriptionCreate: { webhookSubscription: value, userErrors: [] } } });
        }
        if (query.includes('LifecycleReadback')) {
          assert(typeof variables.id === 'string');
          return Response.json({ data: { webhookSubscription: remote.get(variables.id) ?? null } });
        }
        throw Error('Unexpected injected provider operation');
      },
    });
    const enroll = f.enroll(client);
    await enroll(shop.grant, shop.scope);
    const original = required(remote.get('gid://shopify/WebhookSubscription/1'));
    remote.set(original.id, { ...original, uri: 'https://old-app.example/webhooks' });
    await enroll(shop.grant, shop.scope);
    assert.equal(creates, 2);
    assert.deepEqual(
      (await f.rows()).map((row) => row.state),
      ['retired', 'registered'],
    );
    assert.notEqual(required(remote.get('gid://shopify/WebhookSubscription/2')).uri, original.uri);
  },
);

test(
  'definite no-dispatch rejection can retry the same durable destination and register only after readback',
  options,
  async (t) => {
    const f = await fixture(t),
      shop = await f.shop();
    let creates = 0,
      uri: string | undefined;
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
    assert.equal(required((await f.rows())[0]).state, 'rejected');
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
      expectedUri: string | undefined;
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
    assert.equal(required((await f.rows())[0]).state, 'dispatched');
    await enroll(shop.grant, shop.scope);
    assert.equal(creates, 1);
    assert.equal(reconciles, 2);
    assert.equal(required((await f.rows())[0]).subscription_id, 'gid://shopify/WebhookSubscription/2');
  },
);

test(
  'concurrent enrollment waits for the same confirmed subscription without duplicate dispatch',
  options,
  async (t) => {
    const f = await fixture(t),
      shop = await f.shop();
    let releaseCreate: () => void = () => {
      throw new Error('Fixture not started');
    };
    let uri: string | undefined;
    let creates = 0;
    const released = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const enroll = f.enroll({
      create: async (_grant, _scope, callback) => {
        creates++;
        uri = callback;
        await released;
        return { kind: 'acknowledged', subscription: subscription(88, uri) };
      },
      read: async () => subscription(88, uri),
      reconcile: async () => null,
    });
    const pending = Promise.all(Array.from({ length: 24 }, () => enroll(shop.grant, shop.scope)));
    // A provider create remains pending while competing verified sessions enroll.
    const timer = setTimeout(() => releaseCreate(), 100);
    try {
      await pending;
      assert.equal(creates, 1);
      assert.equal(required((await f.rows())[0]).state, 'registered');
    } finally {
      clearTimeout(timer);
      releaseCreate();
    }
  },
);

test('create acknowledgement remains dispatched until independent readback qualifies it', options, async (t) => {
  const f = await fixture(t),
    shop = await f.shop();
  let readStarted: () => void = () => {
    throw new Error('Fixture not started');
  };
  let releaseRead: () => void = () => {
    throw new Error('Fixture not started');
  };
  let uri: string | undefined;
  let creates = 0;
  const started = new Promise<void>((resolve) => {
    readStarted = resolve;
  });
  const released = new Promise<void>((resolve) => {
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
  assert.equal(required((await f.rows())[0]).state, 'dispatched');
  await enroll(shop.grant, shop.scope);
  assert.equal(creates, 1);
  assert.equal(required((await f.rows())[0]).state, 'registered');
});

for (const drift of ['missing', 'different-uri'])
  test(
    `registered destination ${drift} creates a new immutable capability after positive readback`,
    options,
    async (t) => {
      const f = await fixture(t),
        shop = await f.shop(),
        created: Subscription[] = [];
      let change = false;
      const enroll = f.enroll({
        create: async (_grant, _scope, uri) => {
          const entry = subscription(created.length + 10, uri);
          created.push(entry);
          return { kind: 'acknowledged', subscription: entry };
        },
        read: async (_grant, _scope, id) => {
          const item = required(created.find((entry) => entry.id === id));
          return change && id === required(created[0]).id
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
      const before = required((await f.rows())[0]);
      change = true;
      await enroll(shop.grant, shop.scope);
      const rows = await f.rows();
      assert.equal(created.length, 2);
      assert.notEqual(required(created[0]).uri, required(created[1]).uri);
      assert.deepEqual(
        rows.map((row) => row.state),
        ['retired', 'registered'],
      );
      assert.equal(required(rows[0]).capability_digest, before.capability_digest);
      assert.equal(required(rows[0]).subscription_id, before.subscription_id);
    },
  );

test('registered read errors neither retire nor repair a destination', options, async (t) => {
  const f = await fixture(t),
    shop = await f.shop();
  let creates = 0;
  let uri: string | undefined;
  let error = false;
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
    const acquired: string[] = [],
      enrolled: string[] = [];
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
