import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { Pool } from 'pg';
import { expect, test } from 'vitest';
import { createDurableCore } from '../src/index.js';
import { createTenantRepository } from '../src/repositories/tenant.js';
import { openTestDatabase } from './support/postgres.js';

const connectionString = process.env.DATABASE_URL;

test.each(['current', 'historical', 'wrong-signed-shop'])(
  'inactive predecessor and processed uninstall cannot resurrect a removed installation: %s',
  async (era) => {
    const core = createDurableCore(new Pool({ connectionString }));
    const provider = identity();
    try {
      const first = await core.transactions.run((tx) =>
        core.tenants.ensureManagedInstallation(tx, {
          ...provider,
          expected: null,
          observationStartedAt: new Date(),
        }),
      );
      await core.transactions.run((tx) => core.tenants.deactivateCurrent(tx, first.state.shopId, '1'));
      const before = await core.tenants.getManagedInstallationState(provider.shopDomain);
      const observationStartedAt = new Date();
      const delivery = await core.webhooks.receive({
        shopDomain: provider.shopDomain,
        deliveryId: randomUUID(),
        topic: 'app/uninstalled',
        apiVersion: '2026-07',
        triggeredAt: new Date(observationStartedAt.getTime() + (era === 'historical' ? -1000 : 0)),
        eventId: randomUUID(),
        name: null,
        rawBody: Buffer.from(
          JSON.stringify({
            id: era === 'wrong-signed-shop' ? '9999999999999999999' : provider.shopifyShopId,
            myshopify_domain: provider.shopDomain,
          }),
        ),
      });
      expect(await core.webhooks.processUninstall(delivery.id)).toBe('stale');
      const historical = await core.webhooks.getById(delivery.id);
      const next = { ...provider, externalInstallationId: `${provider.externalInstallationId}6` };
      const attempt = core.transactions.run((tx) =>
        core.tenants.ensureManagedInstallation(tx, {
          ...next,
          expected: before,
          confirmation: next,
          observationStartedAt,
        }),
      );
      if (era === 'current') {
        await expect(attempt).rejects.toThrow('Managed installation state changed');
        expect(await core.tenants.getManagedInstallationState(provider.shopDomain)).toEqual(before);
      } else expect((await attempt).state).toMatchObject({ currentGeneration: '2', active: true });
      expect(await core.webhooks.getById(delivery.id)).toMatchObject({
        id: historical!.id,
        kind: historical!.kind,
        state: historical!.state,
      });
    } finally {
      await core.close();
    }
  },
);

test('bound uninstall waits for the shop lock then resolves the committed generation and observation boundary', async () => {
  const database = await openTestDatabase();
  const provider = identity();
  const appName = `uninstall-bound-${randomUUID()}`;
  const peer = createDurableCore(new Pool({ connectionString, application_name: appName }));
  const shopId = randomUUID();
  let pending: Promise<unknown> | undefined;
  try {
    await database.transaction().execute((tx) => createTenantRepository(tx).createShop(tx, { shopId, ...provider }));
    const observationStartedAt = new Date();
    const receipt = await peer.webhooks.receive({
      shopDomain: provider.shopDomain,
      deliveryId: randomUUID(),
      topic: 'app/uninstalled',
      apiVersion: '2026-07',
      triggeredAt: observationStartedAt,
      eventId: randomUUID(),
      name: null,
      rawBody: Buffer.from(JSON.stringify({ id: provider.shopifyShopId, myshopify_domain: provider.shopDomain })),
    });
    await database.transaction().execute(async (tx) => {
      await tx
        .selectFrom('shops')
        .select('shop_id')
        .where('shop_id', '=', shopId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      pending = peer.webhooks.processUninstall(receipt.id);
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const activity = await sql<{ n: string }>`SELECT count(*)::text AS n FROM pg_stat_activity
          WHERE application_name=${appName} AND wait_event_type='Lock'`.execute(database);
        if (Number(activity.rows[0]?.n) > 0) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await createTenantRepository(tx).startInstallation(
        tx,
        shopId,
        `${provider.externalInstallationId}9`,
        observationStartedAt,
      );
    });
    expect(await pending).toBe('processed');
    expect(await peer.tenants.getManagedInstallationState(provider.shopDomain)).toMatchObject({
      currentGeneration: '2',
      active: false,
    });
  } finally {
    await pending?.catch(() => {});
    await Promise.all([peer.close(), database.destroy()]);
  }
});

test.each(['current', 'historical'])('first bootstrap preserves uninstall ordering: %s', async (era) => {
  const core = createDurableCore(new Pool({ connectionString }));
  const provider = identity();
  // The trusted server starts a provider observation. The signed uninstall
  // arrives after that observation but before the tenant transaction exists.
  const observationStartedAt = new Date(Date.now() - 1000);
  const triggeredAt = new Date(observationStartedAt.getTime() + (era === 'current' ? 500 : -500));
  try {
    expect(await core.tenants.getManagedInstallationState(provider.shopDomain)).toBeNull();
    const delivery = await core.webhooks.receive({
      shopDomain: provider.shopDomain,
      deliveryId: randomUUID(),
      topic: 'app/uninstalled',
      apiVersion: '2026-07',
      triggeredAt,
      eventId: randomUUID(),
      name: null,
      rawBody: Buffer.from(
        JSON.stringify({ id: Number(provider.shopifyShopId), myshopify_domain: provider.shopDomain }),
      ),
    });
    expect(await core.webhooks.processUninstall(delivery.id)).toBe('unresolved');
    const attempt = core.transactions.run((tx) =>
      core.tenants.ensureManagedInstallation(tx, { ...provider, expected: null, observationStartedAt }),
    );
    if (era === 'current') {
      await expect(attempt).rejects.toThrow('Managed installation state changed');
      expect(await core.tenants.getManagedInstallationState(provider.shopDomain)).toBeNull();
      expect(await core.webhooks.processUninstall(delivery.id)).toBe('unresolved');
    } else {
      const installed = await attempt;
      expect(await core.webhooks.processUninstall(delivery.id)).toBe('stale');
      expect(await core.tenants.getManagedInstallationState(provider.shopDomain)).toMatchObject({
        shopId: installed.state.shopId,
        currentGeneration: '1',
        active: true,
      });
    }
  } finally {
    await core.close();
  }
});
function identity() {
  const value = randomUUID().replaceAll('-', '');
  return {
    shopDomain: `m${value}.myshopify.com`,
    shopifyShopId: (BigInt(`0x${value.slice(0, 12)}`) + 1n).toString(),
    externalInstallationId: `gid://shopify/AppInstallation/${BigInt(`0x${value.slice(12, 24)}`) + 1n}`,
  };
}

test.each(['current', 'historical'])('confirmed reinstall preserves uninstall ordering: %s', async (era) => {
  const core = createDurableCore(new Pool({ connectionString }));
  const provider = identity();
  try {
    const first = await core.transactions.run((tx) =>
      core.tenants.ensureManagedInstallation(tx, {
        ...provider,
        expected: null,
        observationStartedAt: new Date(),
      }),
    );
    const next = { ...provider, externalInstallationId: `${provider.externalInstallationId}8` };
    const observationStartedAt = new Date();
    const triggeredAt = new Date(observationStartedAt.getTime() + (era === 'current' ? 0 : -1000));
    const delivery = await core.webhooks.receive({
      shopDomain: provider.shopDomain,
      deliveryId: randomUUID(),
      topic: 'app/uninstalled',
      apiVersion: '2026-07',
      triggeredAt,
      eventId: randomUUID(),
      name: null,
      rawBody: Buffer.from(
        JSON.stringify({ id: Number(provider.shopifyShopId), myshopify_domain: provider.shopDomain }),
      ),
    });
    const attempt = core.transactions.run((tx) =>
      core.tenants.ensureManagedInstallation(tx, {
        ...next,
        expected: first.state,
        confirmation: next,
        observationStartedAt,
      }),
    );
    if (era === 'current') {
      await expect(attempt).rejects.toThrow('Managed installation state changed');
      expect(await core.webhooks.processUninstall(delivery.id)).toBe('processed');
      expect(await core.tenants.getManagedInstallationState(provider.shopDomain)).toMatchObject({
        currentGeneration: '1',
        active: false,
      });
    } else {
      expect((await attempt).state.currentGeneration).toBe('2');
      expect(await core.webhooks.processUninstall(delivery.id)).toBe('stale');
      expect((await core.tenants.getManagedInstallationState(provider.shopDomain))?.active).toBe(true);
    }
  } finally {
    await core.close();
  }
});

test.each([new Date(Number.NaN), new Date('2099-01-01T00:00:00Z')])(
  'untrusted invalid/future observation time cannot create a tenant',
  async (observationStartedAt) => {
    const core = createDurableCore(new Pool({ connectionString }));
    const provider = identity();
    try {
      await expect(
        core.transactions.run((tx) =>
          core.tenants.ensureManagedInstallation(tx, {
            ...provider,
            expected: null,
            observationStartedAt,
          }),
        ),
      ).rejects.toThrow(/Managed installation/);
      expect(await core.tenants.getManagedInstallationState(provider.shopDomain)).toBeNull();
    } finally {
      await core.close();
    }
  },
);

test('first authenticated provider installation creates one durable tenant and generation, then reuses it', async () => {
  const core = createDurableCore(new Pool({ connectionString }));
  const provider = identity();
  try {
    const expected = await core.tenants.getManagedInstallationState(provider.shopDomain);
    expect(expected).toBeNull();
    const created = await core.transactions.run((tx) =>
      core.tenants.ensureManagedInstallation(tx, { observationStartedAt: new Date(), ...provider, expected }),
    );
    expect(created.outcome).toBe('CREATED');
    expect(created.state).toMatchObject({ ...provider, currentGeneration: '1', active: true });
    expect(await core.tenants.getManagedInstallationState(provider.shopDomain)).toEqual(created.state);
    const again = await core.transactions.run((tx) =>
      core.tenants.ensureManagedInstallation(tx, {
        observationStartedAt: new Date(),
        ...provider,
        expected: created.state,
      }),
    );
    expect(again).toEqual({ outcome: 'REUSED', state: created.state });
  } finally {
    await core.close();
  }
});

test('confirmed reinstall advances once through the reviewed lifecycle and old installations cannot return', async () => {
  const core = createDurableCore(new Pool({ connectionString }));
  const provider = identity();
  try {
    const first = await core.transactions.run((tx) =>
      core.tenants.ensureManagedInstallation(tx, { observationStartedAt: new Date(), ...provider, expected: null }),
    );
    const next = { ...provider, externalInstallationId: `${provider.externalInstallationId}1` };
    const installed = await core.transactions.run((tx) =>
      core.tenants.ensureManagedInstallation(tx, {
        observationStartedAt: new Date(),
        ...next,
        expected: first.state,
        confirmation: next,
      }),
    );
    expect(installed.outcome).toBe('REINSTALLED');
    expect(installed.state).toMatchObject({
      shopId: first.state.shopId,
      currentGeneration: '2',
      active: true,
      externalInstallationId: next.externalInstallationId,
    });
    const replay = await core.transactions.run((tx) =>
      core.tenants.ensureManagedInstallation(tx, {
        observationStartedAt: new Date(),
        ...next,
        expected: first.state,
        confirmation: next,
      }),
    );
    expect(replay).toEqual({ outcome: 'REUSED', state: installed.state });
    await expect(
      core.transactions.run((tx) =>
        core.tenants.ensureManagedInstallation(tx, {
          observationStartedAt: new Date(),
          ...provider,
          expected: installed.state,
          confirmation: provider,
        }),
      ),
    ).rejects.toThrow('Managed installation state changed');
    expect(await core.tenants.getManagedInstallationState(provider.shopDomain)).toEqual(installed.state);
  } finally {
    await core.close();
  }
});

test.each(['matching', 'wrong-shop-id', 'wrong-installation', 'wrong-domain', 'inactive'])(
  'a uniqueness loser compares the independently committed tenant: %s',
  async (mode) => {
    const provider = identity();
    const pool = new Pool({ connectionString });
    const core = createDurableCore(new Pool({ connectionString }));
    const tenantId = randomUUID();
    const appName = `bootstrap-${randomUUID()}`;
    const candidate = createDurableCore(new Pool({ connectionString, application_name: appName }));
    let releaseWinner = () => {};
    const held = new Promise<void>((resolve) => {
      releaseWinner = resolve;
    });
    let ready = () => {};
    const inserted = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let loser: Promise<unknown> | undefined;
    const winner = core.transactions.run(async (tx) => {
      await core.tenants.createShop(tx, {
        shopId: tenantId,
        ...provider,
        shopifyShopId: mode === 'wrong-shop-id' ? `${provider.shopifyShopId}7` : provider.shopifyShopId,
        externalInstallationId:
          mode === 'wrong-installation' ? `${provider.externalInstallationId}7` : provider.externalInstallationId,
        shopDomain: mode === 'wrong-domain' ? `other${provider.shopDomain}` : provider.shopDomain,
      });
      if (mode === 'inactive') await core.tenants.deactivateCurrent(tx, tenantId, '1');
      ready();
      await held;
    });
    try {
      await Promise.race([
        inserted,
        winner.then(() => {
          throw new Error('Winner settled before barrier');
        }),
      ]);
      loser = candidate.transactions.run((tx) =>
        candidate.tenants.ensureManagedInstallation(tx, {
          observationStartedAt: new Date(),
          ...provider,
          expected: null,
        }),
      );
      const settled = loser.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      let waiting = false;
      for (let i = 0; i < 500; i++) {
        const row = await pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
          [appName],
        );
        if (row.rowCount === 1) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      releaseWinner();
      await winner;
      if (mode === 'matching')
        expect(await settled).toMatchObject({
          value: {
            outcome: 'REUSED',
            state: {
              shopId: tenantId,
              currentGeneration: '1',
              externalInstallationId: provider.externalInstallationId,
              active: true,
            },
          },
        });
      else expect(await settled).toMatchObject({ error: { kind: 'identity_mismatch' } });
      expect(
        (
          await core.tenants.getManagedInstallationState(
            mode === 'wrong-domain' ? `other${provider.shopDomain}` : provider.shopDomain,
          )
        )?.shopId,
      ).toBe(tenantId);
    } finally {
      releaseWinner();
      await winner;
      await loser?.catch(() => {});
      await candidate.close();
      await core.close();
      await pool.end();
    }
  },
);

test('concurrent first sessions and concurrent reinstall converge without extra generations', async () => {
  const core = createDurableCore(new Pool({ connectionString }));
  const provider = identity();
  const sessions = Number(process.env.M5_BOOTSTRAP_STRESS_SESSIONS ?? 24);
  try {
    const first = await Promise.all(
      Array.from({ length: sessions }, () =>
        core.transactions.run((tx) =>
          core.tenants.ensureManagedInstallation(tx, { observationStartedAt: new Date(), ...provider, expected: null }),
        ),
      ),
    );
    expect(first.filter((x) => x.outcome === 'CREATED')).toHaveLength(1);
    expect(new Set(first.map((x) => x.state.shopId)).size).toBe(1);
    expect(first.every((x) => x.state.currentGeneration === '1')).toBe(true);
    const before = first[0]!.state;
    const next = { ...provider, externalInstallationId: `${provider.externalInstallationId}2` };
    const installed = await Promise.all(
      Array.from({ length: sessions }, () =>
        core.transactions.run((tx) =>
          core.tenants.ensureManagedInstallation(tx, {
            observationStartedAt: new Date(),
            ...next,
            expected: before,
            confirmation: next,
          }),
        ),
      ),
    );
    expect(installed.filter((x) => x.outcome === 'REINSTALLED')).toHaveLength(1);
    expect(installed.every((x) => x.state.shopId === before.shopId && x.state.currentGeneration === '2')).toBe(true);
    expect(
      await core.tenants.getActiveAuthorizationScope({ shopId: before.shopId, installationGeneration: '1' }),
    ).toBeNull();
  } finally {
    await core.close();
  }
});

test('identity disagreement, unconfirmed reinstall, stale state and inactive old install fail closed', async () => {
  const core = createDurableCore(new Pool({ connectionString }));
  const provider = identity();
  try {
    const first = await core.transactions.run((tx) =>
      core.tenants.ensureManagedInstallation(tx, { observationStartedAt: new Date(), ...provider, expected: null }),
    );
    for (const mismatch of [
      { ...provider, shopifyShopId: `${provider.shopifyShopId}1` },
      { ...provider, shopDomain: `other${provider.shopDomain}` },
    ])
      await expect(
        core.transactions.run((tx) =>
          core.tenants.ensureManagedInstallation(tx, {
            observationStartedAt: new Date(),
            ...mismatch,
            expected: first.state,
          }),
        ),
      ).rejects.toThrow('Managed installation identity mismatch');
    const next = { ...provider, externalInstallationId: `${provider.externalInstallationId}3` };
    await expect(
      core.transactions.run((tx) =>
        core.tenants.ensureManagedInstallation(tx, {
          observationStartedAt: new Date(),
          ...next,
          expected: first.state,
        }),
      ),
    ).rejects.toThrow('Managed installation confirmation required');
    await expect(
      core.transactions.run((tx) =>
        core.tenants.ensureManagedInstallation(tx, {
          observationStartedAt: new Date(),
          ...next,
          expected: first.state,
          confirmation: provider,
        }),
      ),
    ).rejects.toThrow('Managed installation confirmation required');
    const installed = await core.transactions.run((tx) =>
      core.tenants.ensureManagedInstallation(tx, {
        observationStartedAt: new Date(),
        ...next,
        expected: first.state,
        confirmation: next,
      }),
    );
    const newer = { ...provider, externalInstallationId: `${provider.externalInstallationId}4` };
    await expect(
      core.transactions.run((tx) =>
        core.tenants.ensureManagedInstallation(tx, {
          observationStartedAt: new Date(),
          ...newer,
          expected: first.state,
          confirmation: newer,
        }),
      ),
    ).rejects.toThrow('Managed installation state changed');
    await core.transactions.run((tx) => core.tenants.deactivateCurrent(tx, installed.state.shopId, '2'));
    await expect(
      core.transactions.run((tx) =>
        core.tenants.ensureManagedInstallation(tx, {
          observationStartedAt: new Date(),
          ...next,
          expected: installed.state,
          confirmation: next,
        }),
      ),
    ).rejects.toThrow('Managed installation state changed');
    const inactive = await core.tenants.getManagedInstallationState(provider.shopDomain);
    const reinstalled = await core.transactions.run((tx) =>
      core.tenants.ensureManagedInstallation(tx, {
        observationStartedAt: new Date(),
        ...newer,
        expected: inactive,
        confirmation: newer,
      }),
    );
    expect(reinstalled.state).toMatchObject({
      currentGeneration: '3',
      active: true,
      externalInstallationId: newer.externalInstallationId,
    });
  } finally {
    await core.close();
  }
});

test('bootstrap transaction failure leaves no partial durable tenant', async () => {
  const core = createDurableCore(new Pool({ connectionString }));
  const provider = identity();
  try {
    await expect(
      core.transactions.run(async (tx) => {
        await core.tenants.ensureManagedInstallation(tx, {
          observationStartedAt: new Date(),
          ...provider,
          expected: null,
        });
        throw new Error('synthetic transaction abort');
      }),
    ).rejects.toThrow('synthetic transaction abort');
    expect(await core.tenants.getShopByDomain(provider.shopDomain)).toBeNull();
    expect(await core.tenants.getManagedInstallationState(provider.shopDomain)).toBeNull();
  } finally {
    await core.close();
  }
});
