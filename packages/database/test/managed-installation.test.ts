import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test } from 'vitest';
import { createDurableCore } from '../src/index.js';

const connectionString = process.env.DATABASE_URL;
function identity() {
  const value = randomUUID().replaceAll('-', '');
  return {
    shopDomain: `m${value}.myshopify.com`,
    shopifyShopId: (BigInt(`0x${value.slice(0, 12)}`) + 1n).toString(),
    externalInstallationId: `gid://shopify/AppInstallation/${BigInt(`0x${value.slice(12, 24)}`) + 1n}`,
  };
}

test('first authenticated provider installation creates one durable tenant and generation, then reuses it', async () => {
  const core = createDurableCore(new Pool({ connectionString }));
  const provider = identity();
  try {
    const expected = await core.tenants.getManagedInstallationState(provider.shopDomain);
    expect(expected).toBeNull();
    const created = await core.transactions.run((tx) =>
      core.tenants.ensureManagedInstallation(tx, { ...provider, expected }),
    );
    expect(created.outcome).toBe('CREATED');
    expect(created.state).toMatchObject({ ...provider, currentGeneration: '1', active: true });
    expect(await core.tenants.getManagedInstallationState(provider.shopDomain)).toEqual(created.state);
    const again = await core.transactions.run((tx) =>
      core.tenants.ensureManagedInstallation(tx, { ...provider, expected: created.state }),
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
      core.tenants.ensureManagedInstallation(tx, { ...provider, expected: null }),
    );
    const next = { ...provider, externalInstallationId: `${provider.externalInstallationId}1` };
    const installed = await core.transactions.run((tx) =>
      core.tenants.ensureManagedInstallation(tx, { ...next, expected: first.state, confirmation: next }),
    );
    expect(installed.outcome).toBe('REINSTALLED');
    expect(installed.state).toMatchObject({
      shopId: first.state.shopId,
      currentGeneration: '2',
      active: true,
      externalInstallationId: next.externalInstallationId,
    });
    const replay = await core.transactions.run((tx) =>
      core.tenants.ensureManagedInstallation(tx, { ...next, expected: first.state, confirmation: next }),
    );
    expect(replay).toEqual({ outcome: 'REUSED', state: installed.state });
    await expect(
      core.transactions.run((tx) =>
        core.tenants.ensureManagedInstallation(tx, { ...provider, expected: installed.state, confirmation: provider }),
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
        candidate.tenants.ensureManagedInstallation(tx, { ...provider, expected: null }),
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
        core.transactions.run((tx) => core.tenants.ensureManagedInstallation(tx, { ...provider, expected: null })),
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
          core.tenants.ensureManagedInstallation(tx, { ...next, expected: before, confirmation: next }),
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
      core.tenants.ensureManagedInstallation(tx, { ...provider, expected: null }),
    );
    for (const mismatch of [
      { ...provider, shopifyShopId: `${provider.shopifyShopId}1` },
      { ...provider, shopDomain: `other${provider.shopDomain}` },
    ])
      await expect(
        core.transactions.run((tx) =>
          core.tenants.ensureManagedInstallation(tx, { ...mismatch, expected: first.state }),
        ),
      ).rejects.toThrow('Managed installation identity mismatch');
    const next = { ...provider, externalInstallationId: `${provider.externalInstallationId}3` };
    await expect(
      core.transactions.run((tx) => core.tenants.ensureManagedInstallation(tx, { ...next, expected: first.state })),
    ).rejects.toThrow('Managed installation confirmation required');
    await expect(
      core.transactions.run((tx) =>
        core.tenants.ensureManagedInstallation(tx, { ...next, expected: first.state, confirmation: provider }),
      ),
    ).rejects.toThrow('Managed installation confirmation required');
    const installed = await core.transactions.run((tx) =>
      core.tenants.ensureManagedInstallation(tx, { ...next, expected: first.state, confirmation: next }),
    );
    const newer = { ...provider, externalInstallationId: `${provider.externalInstallationId}4` };
    await expect(
      core.transactions.run((tx) =>
        core.tenants.ensureManagedInstallation(tx, { ...newer, expected: first.state, confirmation: newer }),
      ),
    ).rejects.toThrow('Managed installation state changed');
    await core.transactions.run((tx) => core.tenants.deactivateCurrent(tx, installed.state.shopId, '2'));
    await expect(
      core.transactions.run((tx) =>
        core.tenants.ensureManagedInstallation(tx, { ...next, expected: installed.state, confirmation: next }),
      ),
    ).rejects.toThrow('Managed installation state changed');
    const inactive = await core.tenants.getManagedInstallationState(provider.shopDomain);
    const reinstalled = await core.transactions.run((tx) =>
      core.tenants.ensureManagedInstallation(tx, { ...newer, expected: inactive, confirmation: newer }),
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
        await core.tenants.ensureManagedInstallation(tx, { ...provider, expected: null });
        throw new Error('synthetic transaction abort');
      }),
    ).rejects.toThrow('synthetic transaction abort');
    expect(await core.tenants.getShopByDomain(provider.shopDomain)).toBeNull();
    expect(await core.tenants.getManagedInstallationState(provider.shopDomain)).toBeNull();
  } finally {
    await core.close();
  }
});
