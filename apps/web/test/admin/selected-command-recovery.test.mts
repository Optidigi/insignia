import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CommandDigestConflictError } from '@insignia/application';
import { MerchantDraftSchema } from '@insignia/contracts';
import { createDurableCore, sha256CanonicalJson } from '@insignia/database';
import { Pool } from 'pg';
import { createMerchantConfigService } from '../../src/server/merchant-config.ts';
import { adminActor, required } from './support/fixtures.mts';

const database = process.env.DATABASE_URL;
test('authenticated operation reconciliation fences a late create and preserves an already committed exact operation', {
  skip: !database,
  timeout: 15000,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  const shopId = randomUUID(),
    productId = 'gid://shopify/Product/111';
  const actor = adminActor({
    tenantShopId: shopId,
    shop: `recover-${randomUUID().replaceAll('-', '')}.myshopify.com`,
    shopId: 'gid://shopify/Shop/123',
    installationGeneration: '1',
  });
  try {
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, {
        shopId,
        shopDomain: actor.shop,
        shopifyShopId: '123',
        externalInstallationId: actor.installationId,
      }),
    );
    const authority = sha256CanonicalJson(
      required(await core.tenants.getActiveAuthorizationScope({ shopId, installationGeneration: '1' })),
    );
    const service = createMerchantConfigService({
      core,
      catalog: {
        get: async () => ({ id: productId, title: 'Recovery', status: 'ACTIVE', imageUrl: null, variants: [] }),
        shopCurrency: async () => 'USD',
      },
      eligibility: async () => ({ allowed: false, reason: 'Incomplete' }),
      publication: () => {
        throw new Error('Recovery cannot publish');
      },
    });
    const abandoned = randomUUID();
    assert.deepEqual(
      await service.reconcile(actor, productId, { stage: 'create', operationKey: abandoned, authority }),
      { kind: 'resolved' },
    );
    await assert.rejects(service.create(actor, productId, `${abandoned}:create`, authority), /digest/i);
    assert.equal(await core.configs.getByProduct(shopId, '111'), null);
    const committed = randomUUID();
    const created = await service.create(actor, productId, `${committed}:create`, authority);
    assert.equal(created.kind, 'created');
    await service.reconcile(actor, productId, { stage: 'create', operationKey: committed, authority });
    assert.deepEqual(
      await service.create(actor, productId, `${committed}:create`, authority),
      created,
      'Existing command result remains replayable and immutable',
    );
    await assert.rejects(
      service.reconcile(actor, productId, { stage: 'save', operationKey: randomUUID(), authority: 'b'.repeat(64) }),
      /authority/,
    );
    await assert.rejects(
      service.reconcile({ ...actor, canEdit: false }, productId, {
        stage: 'save',
        operationKey: randomUUID(),
        authority,
      }),
      /permission/,
    );
  } finally {
    await core.close();
  }
});

async function saveRecoveryFixture() {
  const token = randomUUID();
  const shopNumber = BigInt(`0x${token.replaceAll('-', '').slice(0, 12)}`).toString();
  const shopId = randomUUID();
  const productId = 'gid://shopify/Product/111';
  const names = { save: `recovery-save-${token}`, reconcile: `recovery-fence-${token}` };
  const observer = new Pool({ connectionString: database, max: 4 });
  const core = createDurableCore(observer);
  const saveCore = createDurableCore(new Pool({ connectionString: database, application_name: names.save, max: 2 }));
  const reconcileCore = createDurableCore(
    new Pool({ connectionString: database, application_name: names.reconcile, max: 2 }),
  );
  const actor = adminActor({
    tenantShopId: shopId,
    shop: `race-${token}.myshopify.com`,
    shopId: `gid://shopify/Shop/${shopNumber}`,
    installationGeneration: '1',
  });
  let publicationCalls = 0;
  function service(target: typeof core) {
    return createMerchantConfigService({
      core: target,
      catalog: {
        get: async () => ({ id: productId, title: 'Recovery race', status: 'ACTIVE', imageUrl: null, variants: [] }),
        shopCurrency: async () => 'USD',
      },
      eligibility: async () => ({ allowed: false, reason: 'Incomplete' }),
      publication: () => {
        publicationCalls++;
        throw new Error('Recovery cannot publish');
      },
    });
  }
  try {
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, {
        shopId,
        shopDomain: actor.shop,
        shopifyShopId: shopNumber,
        externalInstallationId: actor.installationId,
      }),
    );
    const authority = sha256CanonicalJson(
      required(await core.tenants.getActiveAuthorizationScope({ shopId, installationGeneration: '1' })),
    );
    const initial = await service(core).create(actor, productId, `${randomUUID()}:create`, authority);
    assert.equal(initial.kind, 'created');
    const baseline = required(await core.configs.getByProduct(shopId, '111'));
    const draft = MerchantDraftSchema.parse(baseline.draftValue);
    const changed = MerchantDraftSchema.parse({
      ...draft,
      labels: { ...draft.labels, views: { front: 'Concurrent saved front' } },
    });
    const operationKey = randomUUID();
    const input = {
      configId: baseline.configId,
      draftVersion: baseline.draftVersion,
      draft: changed,
      idempotencyKey: `${operationKey}:save`,
      authority,
    };
    const identity = {
      shopId,
      namespace: 'm5-save-draft',
      key: input.idempotencyKey,
      requestDigest: sha256CanonicalJson({
        productId,
        configId: input.configId,
        draftVersion: input.draftVersion,
        draft: changed,
        authority,
      }),
    };
    return {
      core,
      observer,
      actor,
      productId,
      authority,
      names,
      baseline,
      changed,
      operationKey,
      input,
      identity,
      save: service(saveCore),
      reconcile: service(reconcileCore),
      publicationCalls: () => publicationCalls,
      close: async () => {
        await Promise.all([saveCore.close(), reconcileCore.close(), core.close()]);
      },
    };
  } catch (error) {
    await Promise.all([saveCore.close(), reconcileCore.close(), core.close()]);
    throw error;
  }
}

test('publication reconciliation distinguishes immutable original intents from absent, rejected and unresolved operations', {
  skip: !database,
  timeout: 15000,
}, async () => {
  const f = await saveRecoveryFixture();
  try {
    for (const resultRef of [
      `${randomUUID()}:required`,
      `${randomUUID()}:optional`,
      'conflict',
      'invalid',
      'reconciled:no-effect',
      'not-a-uuid:required',
      null,
    ]) {
      const operationKey = randomUUID();
      const identity = {
        shopId: f.actor.tenantShopId,
        namespace: 'm5-publish-config',
        key: `${operationKey}:publish`,
        requestDigest: sha256CanonicalJson({ original: operationKey }),
      };
      if (resultRef)
        await f.core.transactions.run(async (tx) => {
          assert.equal((await f.core.commands.reserve(tx, identity)).kind, 'reserved');
          await f.core.commands.complete(tx, identity, resultRef);
        });
      const before = await f.core.commands.lookup(identity);
      const actual = await f.reconcile.reconcile(f.actor, f.productId, {
        stage: 'publish',
        operationKey,
        authority: f.authority,
      });
      assert.deepEqual(actual, {
        kind: 'resolved',
        publicationRecorded: !!resultRef && /^[a-f0-9-]{36}:(required|optional)$/.test(resultRef),
      });
      const after = await f.core.commands.lookup(identity);
      if (before) assert.deepEqual(after, before, 'Original receipts are never rewritten');
      else {
        assert.equal(after?.resultRef, 'reconciled:no-effect');
        assert.equal(
          await f.core.transactions.run(async (tx) => (await f.core.commands.reserve(tx, identity)).kind),
          'digest_conflict',
          'An absent original cannot reserve after the barrier',
        );
      }
    }
    const operationKey = randomUUID();
    const identity = {
      shopId: f.actor.tenantShopId,
      namespace: 'm5-publish-config',
      key: `${operationKey}:publish`,
      requestDigest: sha256CanonicalJson({ original: operationKey }),
    };
    await f.core.transactions.run(async (tx) => {
      assert.equal((await f.core.commands.reserve(tx, identity)).kind, 'reserved');
    });
    const original = await f.core.commands.lookup(identity);
    await assert.rejects(
      f.reconcile.reconcile(f.actor, f.productId, { stage: 'publish', operationKey, authority: f.authority }),
      /requires reconciliation/,
    );
    assert.deepEqual(await f.core.commands.lookup(identity), original);
    assert.equal(f.publicationCalls(), 0);
  } finally {
    await f.close();
  }
});

/** Observe a real PostgreSQL row-lock wait before queuing the other operation; no timing guess orders the race. */
async function waitingOnTenant(pool: Pool, applicationName: string) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const state = await pool.query<{ pid: number }>(
      "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND state='active' AND wait_event_type='Lock'",
      [applicationName],
    );
    if (state.rows.length === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Expected ${applicationName} to wait on the owned tenant lock`);
}

for (const winner of ['save', 'reconcile'] as const) {
  test(`concurrent save and reconciliation serialize ${winner} first on the original tenant and stage key`, {
    skip: !database,
    timeout: 20000,
  }, async () => {
    const f = await saveRecoveryFixture();
    const blocker = await f.observer.connect();
    let save: Promise<PromiseSettledResult<Awaited<ReturnType<typeof f.save.save>>>> | undefined;
    let reconcile: Promise<{ kind: 'resolved' }> | undefined;
    const startSave = () => {
      const write = f.save.save(f.actor, f.productId, f.input);
      return write.then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason: unknown) => ({ status: 'rejected' as const, reason }),
      );
    };
    const startReconcile = () =>
      f.reconcile.reconcile(f.actor, f.productId, {
        stage: 'save',
        operationKey: f.operationKey,
        authority: f.authority,
      });
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT shop_id FROM shops WHERE shop_id=$1 FOR UPDATE', [f.actor.tenantShopId]);
      if (winner === 'save') {
        save = startSave();
        await waitingOnTenant(f.observer, f.names.save);
        reconcile = startReconcile();
        await waitingOnTenant(f.observer, f.names.reconcile);
      } else {
        reconcile = startReconcile();
        await waitingOnTenant(f.observer, f.names.reconcile);
        save = startSave();
        await waitingOnTenant(f.observer, f.names.save);
      }
      await blocker.query('COMMIT');
      const [saved, reconciled] = await Promise.all([required(save), required(reconcile)]);
      assert.deepEqual(reconciled, { kind: 'resolved' });
      const receipt = required(await f.core.commands.lookup(f.identity));
      assert.equal(receipt.status, 'completed');
      const current = required(await f.core.configs.getByProduct(f.actor.tenantShopId, '111'));
      if (winner === 'save') {
        assert.equal(saved.status, 'fulfilled');
        assert.deepEqual(saved.value, { kind: 'saved', draftVersion: '2' });
        assert.equal(receipt.requestDigest, f.identity.requestDigest);
        assert.equal(receipt.resultRef, 'saved:2');
        assert.equal(current.draftVersion, '2');
        assert.deepEqual(current.draftValue, f.changed);
        assert.deepEqual(
          await f.save.save(f.actor, f.productId, f.input),
          saved.value,
          'Exact original retry replays the completed receipt',
        );
      } else {
        assert.equal(saved.status, 'rejected');
        assert.ok(saved.reason instanceof CommandDigestConflictError);
        assert.notEqual(receipt.requestDigest, f.identity.requestDigest);
        assert.equal(receipt.resultRef, 'reconciled:no-effect');
        assert.equal(current.draftVersion, f.baseline.draftVersion);
        assert.deepEqual(current.draftValue, f.baseline.draftValue);
        await assert.rejects(f.save.save(f.actor, f.productId, f.input), CommandDigestConflictError);
      }
      await f.reconcile.reconcile(f.actor, f.productId, {
        stage: 'save',
        operationKey: f.operationKey,
        authority: f.authority,
      });
      assert.deepEqual(
        await f.core.commands.lookup(f.identity),
        receipt,
        'Reconciliation never rewrites an immutable original or barrier receipt',
      );
      const next = await f.save.save(f.actor, f.productId, {
        ...f.input,
        draftVersion: current.draftVersion,
        idempotencyKey: `${randomUUID()}:save`,
      });
      assert.deepEqual(
        next,
        { kind: 'saved', draftVersion: String(Number(current.draftVersion) + 1) },
        'The barrier affects only its original stage key',
      );
      const stale = await f.save.save(f.actor, f.productId, {
        ...f.input,
        draftVersion: current.draftVersion,
        draft: { ...f.changed, labels: { ...f.changed.labels, views: { front: 'Stale must never win' } } },
        idempotencyKey: `${randomUUID()}:save`,
      });
      assert.equal(stale.kind, 'conflict', 'A new command still obeys the unchanged draft CAS');
      const afterStale = required(await f.core.configs.getByProduct(f.actor.tenantShopId, '111'));
      assert.equal(afterStale.draftVersion, String(Number(current.draftVersion) + 1));
      assert.deepEqual(afterStale.draftValue, f.changed);
      assert.deepEqual(await f.core.commands.lookup(f.identity), receipt);
      assert.equal(f.publicationCalls(), 0);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await Promise.allSettled([save, reconcile].filter((value) => value !== undefined));
      await f.close();
    }
  });
}
