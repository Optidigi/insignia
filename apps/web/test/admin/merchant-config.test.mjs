import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CONFIG_DRAFT_STORAGE_VERSION, createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { handleAdminRequest } from '../../src/server/admin/http.ts';
import { createMerchantConfigService } from '../../src/server/merchant-config.ts';

const database = process.env.DATABASE_URL;
const productA = 'gid://shopify/Product/111';
const productB = 'gid://shopify/Product/222';
const productC = 'gid://shopify/Product/333';
const productD = 'gid://shopify/Product/444';
const sharedId = 's'.repeat(128);
function baseDraft() {
  return {
    version: 'm5-merchant-draft-v1',
    mode: 'optional',
    shopCurrency: 'USD',
    methods: [{ id: sharedId }],
    placements: [{ id: sharedId, allowedMethodIds: [sharedId], allowedStepIds: [sharedId], logoLaterAllowed: true }],
    productionOptions: [
      { id: sharedId, allowedValueIds: [sharedId] },
      { id: 'second-option', allowedValueIds: [sharedId] },
    ],
    pricingRules: [],
    labels: {
      methods: { [sharedId]: 'Screen print' },
      placements: { [sharedId]: 'Front chest' },
      steps: { [sharedId]: 'Small' },
      views: { 'front-view': 'Front image' },
      options: { [sharedId]: 'Thread color', 'second-option': 'Ink color' },
      values: { [sharedId]: { [sharedId]: 'Navy thread' }, 'second-option': { [sharedId]: 'Navy ink' } },
    },
    geometry: {
      version: 'm5-geometry-v1',
      views: [
        {
          id: 'front-view',
          image: { revisionId: 'product_111', width: 800, height: 1000 },
          variantImages: [{ variantId: 'variant_11', image: { revisionId: 'variant_11', width: 700, height: 900 } }],
          placements: [
            {
              id: sharedId,
              rect: { centerX: 0.5, centerY: 0.5, width: 0.4, height: 0.3 },
              variantOverrides: [
                { variantId: 'variant_11', rect: { centerX: 0.4, centerY: 0.4, width: 0.2, height: 0.2 } },
              ],
            },
          ],
        },
      ],
      steps: [{ id: sharedId, widthFraction: 0.5, heightFraction: 0.5 }],
    },
  };
}
function item(id) {
  return { id, title: 'Synthetic garment', status: 'ACTIVE', imageUrl: null, variants: [] };
}
function actor(shopId, shop, shopifyShopId) {
  return {
    shop,
    shopId: 'gid://shopify/Shop/' + shopifyShopId,
    tenantShopId: shopId,
    installationGeneration: '1',
    installationId: 'gid://shopify/AppInstallation/123',
    staffId: 'staff-1',
    sessionId: 'session-1',
    expiresAtMs: Date.now() + 60000,
    canRead: true,
    canEdit: true,
  };
}
test('overlapping distinct-key M5 creates serialize before the command FK lock upgrade', {
  skip: !database,
  timeout: 15000,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  const shopId = randomUUID();
  const shop = 'm' + randomUUID().replaceAll('-', '') + '.myshopify.com';
  const shopifyShopId = String(BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12)) + 1n);
  const staff = actor(shopId, shop, shopifyShopId);
  try {
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, {
        shopId,
        shopDomain: shop,
        shopifyShopId,
        externalInstallationId: staff.installationId,
      }),
    );
    let arrivals = 0;
    let release;
    const bothReserved = new Promise((resolve) => {
      release = resolve;
    });
    const delayed = {
      ...core,
      commands: {
        ...core.commands,
        async reserve(tx, identity) {
          const result = await core.commands.reserve(tx, identity);
          if (++arrivals === 2) release();
          // Bound a pause after reservation. The correct tenant-first path serializes
          // before the second reservation, so this gate must also release by time.
          await Promise.race([bothReserved, new Promise((resolve) => setTimeout(resolve, 100))]);
          return result;
        },
      },
    };
    const service = createMerchantConfigService({
      core: delayed,
      catalog: { get: async (_actor, id) => (id === productA ? item(id) : null), shopCurrency: async () => 'USD' },
      eligibility: async () => ({ allowed: false, reason: 'Synthetic' }),
      publication: () => {
        throw new Error('create must not publish');
      },
    });
    const results = await Promise.all([
      service.create(staff, productA, 'overlap-one'),
      service.create(staff, productA, 'overlap-two'),
    ]);
    assert.deepEqual(results.map((result) => result.kind).sort(), ['conflict', 'created']);
    const created = results.find((result) => result.kind === 'created');
    assert.equal((await core.configs.getByProduct(shopId, '111')).configId, created.configId);
    assert.equal((await service.read(staff, productA)).config.draftVersion, '1');
  } finally {
    await core.close();
  }
});
test('currency precision rejects invalid saved and legacy publication amounts without rounding or durable intent', {
  skip: !database,
  timeout: 30000,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  try {
    for (const [currency, valid, invalid] of [
      ['USD', '1.23', '1.230'],
      ['JPY', '1', '1.0'],
      ['KWD', '1.234', '1.2345'],
    ]) {
      const shopId = randomUUID();
      const shop = 'm' + randomUUID().replaceAll('-', '') + '.myshopify.com';
      const shopifyShopId = String(BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12)) + 1n);
      const staff = actor(shopId, shop, shopifyShopId);
      await core.transactions.run((tx) =>
        core.tenants.createShop(tx, {
          shopId,
          shopDomain: shop,
          shopifyShopId,
          externalInstallationId: staff.installationId,
        }),
      );
      let prepares = 0;
      const service = createMerchantConfigService({
        core,
        catalog: { get: async (_actor, id) => (id === productA ? item(id) : null), shopCurrency: async () => currency },
        eligibility: async () => ({ allowed: true, reason: null }),
        publication: () => ({
          prepare: async () => {
            prepares++;
            throw new Error('invalid draft must not prepare');
          },
          advance: async () => {
            throw new Error('invalid draft must not advance');
          },
        }),
      });
      const created = await service.create(staff, productA, 'create-money');
      assert.equal(created.kind, 'created');
      const draft = {
        ...baseDraft(),
        shopCurrency: currency,
        pricingRules: [
          {
            id: 'setup',
            role: 'setup',
            scope: { kind: 'general' },
            rate: { kind: 'fixed', amount: { shopDecimal: valid, presentmentOverrides: [] } },
          },
          {
            id: 'signed-adjustment',
            role: 'unit',
            scope: { kind: 'placement', placementId: sharedId },
            rate: { kind: 'fixed', amount: { shopDecimal: '-' + valid, presentmentOverrides: [] } },
          },
        ],
      };
      const saved = await service.save(staff, productA, {
        configId: created.configId,
        draftVersion: '1',
        draft,
        idempotencyKey: 'valid-money',
      });
      assert.deepEqual(saved, { kind: 'saved', draftVersion: '2' });
      const badCases = [];
      const fixed = structuredClone(draft);
      fixed.pricingRules[0].rate.amount.shopDecimal = invalid;
      badCases.push(fixed);
      for (const [overrideCurrency, decimal] of [
        ['USD', '1.230'],
        ['JPY', '1.0'],
        ['ZZZ', '0'],
      ]) {
        if (overrideCurrency === currency) continue;
        const override = structuredClone(draft);
        override.pricingRules[0].rate.amount.presentmentOverrides = [{ currency: overrideCurrency, decimal }];
        badCases.push(override);
      }
      const tiers = structuredClone(draft);
      tiers.pricingRules = [
        {
          id: 'tier',
          role: 'unit',
          scope: { kind: 'placement', placementId: sharedId },
          rate: {
            kind: 'allUnits',
            tiers: [
              { minQuantity: 1, amount: { shopDecimal: '0', presentmentOverrides: [] } },
              { minQuantity: 100, amount: { shopDecimal: '-' + invalid, presentmentOverrides: [] } },
            ],
          },
        },
      ];
      badCases.push(tiers);
      for (const [index, bad] of badCases.entries()) {
        const invalid = await service.save(staff, productA, {
          configId: created.configId,
          draftVersion: '2',
          draft: bad,
          idempotencyKey: 'invalid-money-' + index,
        });
        assert.equal(invalid.kind, 'invalid', currency + ' case ' + index);
        assert.ok(invalid.validationIssues.some((issue) => issue.path.startsWith('pricingRules')));
      }
      assert.equal((await core.configs.getConfig(shopId, created.configId)).draftVersion, '2');
      // A draft written before the precision guard must also fail at the public publish command.
      const legacy = structuredClone(draft);
      legacy.pricingRules[0].rate.amount.presentmentOverrides = [{ currency: 'JPY', decimal: '0.000' }];
      if (currency === 'JPY')
        legacy.pricingRules[0].rate.amount.presentmentOverrides = [{ currency: 'USD', decimal: '0.000' }];
      await core.transactions.run((tx) =>
        core.configs.updateDraft(tx, {
          shopId,
          configId: created.configId,
          expectedVersion: '2',
          schemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
          draftValue: legacy,
        }),
      );
      assert.equal((await service.read(staff, productA)).config.publishEligibility.allowed, false);
      assert.equal(
        (
          await service.publish(staff, productA, {
            configId: created.configId,
            draftVersion: '3',
            idempotencyKey: 'publish-invalid-money',
          })
        ).kind,
        'invalid',
      );
      assert.equal(await core.configs.getCurrentPublication(shopId, created.configId), null);
      assert.equal(prepares, 0);
    }
  } finally {
    await core.close();
  }
});
test('durable editor CAS, exact-key replay, independent copy, immutable geometry, and reinstall fence', {
  skip: !database,
  timeout: 30000,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: database }));
  const shopId = randomUUID();
  const shop = 'm' + randomUUID().replaceAll('-', '') + '.myshopify.com';
  const shopifyShopId = String(BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12)) + 1n);
  const staff = actor(shopId, shop, shopifyShopId);
  await core.transactions.run((tx) =>
    core.tenants.createShop(tx, {
      shopId,
      shopDomain: shop,
      shopifyShopId,
      externalInstallationId: staff.installationId,
    }),
  );
  let paused = false;
  let failPrepareOnce = false;
  let currentCurrency = 'USD';
  let release;
  let entered;
  const enteredPromise = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const service = createMerchantConfigService({
    core,
    catalog: {
      async get(_actor, id) {
        if (paused) {
          entered();
          await gate;
        }
        return [productA, productB, productC, productD].includes(id) ? item(id) : null;
      },
      async shopCurrency() {
        return currentCurrency;
      },
    },
    async eligibility() {
      return { allowed: true, reason: null };
    },
    publication() {
      return {
        async prepare(input) {
          if (failPrepareOnce) {
            failPrepareOnce = false;
            throw new Error('synthetic crash after immutable intent commit');
          }
          return { operationId: input.operationId, phase: 'prepared' };
        },
        async advance() {
          return { phase: 'activation-pending' };
        },
      };
    },
  });
  try {
    const created = await service.create(staff, productA, 'create-key-01');
    assert.equal(created.kind, 'created');
    assert.deepEqual(await service.create(staff, productA, 'create-key-01'), created);
    assert.equal((await service.create(staff, productA, 'create-key-02')).kind, 'conflict');
    const concurrent = await Promise.all([
      service.create(staff, productD, 'create-concurrent-01'),
      service.create(staff, productD, 'create-concurrent-02'),
    ]);
    assert.deepEqual(concurrent.map((item) => item.kind).sort(), ['conflict', 'created']);
    const draft = baseDraft();
    const saved = await service.save(staff, productA, {
      configId: created.configId,
      draftVersion: '1',
      draft,
      idempotencyKey: 'save-key-01',
    });
    assert.deepEqual(saved, { kind: 'saved', draftVersion: '2' });
    assert.deepEqual(
      await service.save(staff, productA, {
        configId: created.configId,
        draftVersion: '1',
        draft,
        idempotencyKey: 'save-key-01',
      }),
      saved,
    );
    const origin = 'https://synthetic-admin.example.test';
    const services = {
      appOrigin: origin,
      authenticate: async () => staff,
      catalog: { get: async (_actor, id) => (id === productA ? item(id) : null) },
      configs: service,
    };
    const saveThroughHttp = (value) =>
      handleAdminRequest(
        new Request(origin + '/api/admin/products/111/config', {
          method: 'PUT',
          headers: {
            Authorization: 'Bearer synthetic',
            Origin: origin,
            'Content-Type': 'application/json',
            'Idempotency-Key': 'save-key-01',
          },
          body: JSON.stringify({ action: 'save', configId: created.configId, draftVersion: '1', draft: value }),
        }),
        services,
        { kind: 'config', productId: productA },
      );
    assert.equal((await saveThroughHttp(draft)).status, 200, 'exact durable request replays through HTTP');
    const changedKeyBody = structuredClone(draft);
    changedKeyBody.labels.methods[sharedId] = 'Different valid name';
    const keyConflict = await saveThroughHttp(changedKeyBody);
    assert.equal(keyConflict.status, 409, 'different valid body with the same command key is a conflict');
    assert.equal((await keyConflict.json()).kind, 'conflict');
    const unchanged = (await service.read(staff, productA)).config;
    assert.equal(unchanged.draftVersion, '2');
    assert.equal(unchanged.draft.labels.methods[sharedId], 'Screen print');
    assert.equal(
      (
        await service.save(staff, productA, {
          configId: created.configId,
          draftVersion: '1',
          draft,
          idempotencyKey: 'save-stale-01',
        })
      ).kind,
      'conflict',
    );
    const invalid = structuredClone(draft);
    invalid.geometry.views[0].placements[0].rect.centerX = 0.99;
    assert.equal(
      (
        await service.save(staff, productA, {
          configId: created.configId,
          draftVersion: '2',
          draft: invalid,
          idempotencyKey: 'save-invalid-01',
        })
      ).kind,
      'invalid',
    );
    currentCurrency = 'EUR';
    assert.equal(
      (
        await service.save(staff, productA, {
          configId: created.configId,
          draftVersion: '2',
          draft,
          idempotencyKey: 'save-wrong-currency',
        })
      ).kind,
      'invalid',
    );
    assert.equal(
      (
        await service.publish(staff, productA, {
          configId: created.configId,
          draftVersion: '2',
          idempotencyKey: 'publish-wrong-currency',
        })
      ).kind,
      'invalid',
    );
    currentCurrency = 'USD';
    const copy = await service.copy(staff, productA, productB, 'copy-key-01');
    assert.equal(copy.kind, 'created');
    assert.equal((await service.copy(staff, productA, productB, 'copy-key-02')).kind, 'conflict');
    const copied = (await service.read(staff, productB)).config;
    assert.notEqual(copied.configId, created.configId);
    assert.notEqual(copied.draft.placements[0].id, draft.placements[0].id);
    assert.deepEqual(copied.draft.geometry.views[0].variantImages, []);
    assert.equal(copied.draft.labels.methods[copied.draft.methods[0].id], 'Screen print');
    assert.equal(copied.draft.labels.placements[copied.draft.placements[0].id], 'Front chest');
    assert.equal(copied.draft.labels.steps[copied.draft.geometry.steps[0].id], 'Small');
    assert.equal(copied.draft.labels.options[copied.draft.productionOptions[0].id], 'Thread color');
    assert.equal(
      copied.draft.labels.values[copied.draft.productionOptions[0].id][
        copied.draft.productionOptions[0].allowedValueIds[0]
      ],
      'Navy thread',
    );
    assert.equal(
      copied.draft.labels.values[copied.draft.productionOptions[1].id][
        copied.draft.productionOptions[1].allowedValueIds[0]
      ],
      'Navy ink',
    );
    assert.equal(copied.draft.labels.methods[sharedId], undefined);
    assert.deepEqual(copied.draft.geometry.views[0].placements[0].variantOverrides, []);
    assert.equal(copied.draft.geometry.views[0].image, undefined);
    const competing = await Promise.all([
      service.publish(staff, productB, {
        configId: copy.configId,
        draftVersion: '1',
        idempotencyKey: 'publish-copy-race-01',
      }),
      service.publish(staff, productB, {
        configId: copy.configId,
        draftVersion: '1',
        idempotencyKey: 'publish-copy-race-02',
      }),
    ]);
    assert.deepEqual(competing.map((result) => result.kind).sort(), ['accepted', 'conflict']);
    const winningKey = competing[0].kind === 'accepted' ? 'publish-copy-race-01' : 'publish-copy-race-02';
    const winningRevision = competing.find((result) => result.kind === 'accepted').revisionId;
    const copyIntent = await core.configs.getCurrentPublication(shopId, copy.configId);
    assert.equal(copyIntent.revisionId, winningRevision);
    assert.equal(copyIntent.requestKey, winningKey);
    const copyHistory = new Pool({ connectionString: database });
    try {
      const count = await copyHistory.query(
        'SELECT count(*)::int AS count FROM config_revisions WHERE shop_id=$1 AND config_id=$2',
        [shopId, copy.configId],
      );
      assert.equal(count.rows[0].count, 1, 'different publish keys must commit only one immutable intent');
      // Retained synthetic history exercises the keyed current pointer without altering old rows.
      await copyHistory.query(
        `INSERT INTO config_revisions
          (shop_id, config_id, revision_id, schema_version, published_value, content_hash, created_by_ref)
          SELECT shop_id, config_id, 'retained-history-' || n::text || '-' || $3,
            schema_version, published_value, content_hash, created_by_ref
          FROM config_revisions CROSS JOIN generate_series(1, 128) AS n
          WHERE shop_id=$1 AND config_id=$2 AND revision_id=$3`,
        [shopId, copy.configId, winningRevision],
      );
      assert.equal((await core.configs.getCurrentPublication(shopId, copy.configId)).revisionId, winningRevision);
    } finally {
      await copyHistory.end();
    }
    const recovered = await service.publish(staff, productB, {
      configId: copy.configId,
      draftVersion: '1',
      idempotencyKey: winningKey,
    });
    assert.equal(recovered.kind, 'accepted');
    assert.equal(recovered.revisionId, winningRevision, 'same key must recover original immutable intent');
    const changed = { ...draft, mode: 'required' };
    assert.equal(
      (
        await service.save(staff, productA, {
          configId: created.configId,
          draftVersion: '2',
          draft: changed,
          idempotencyKey: 'save-key-02',
        })
      ).kind,
      'saved',
    );
    assert.deepEqual(await service.copy(staff, productA, productB, 'copy-key-01'), copy);
    assert.equal((await service.read(staff, productB)).config.draft.mode, 'optional');
    failPrepareOnce = true;
    await assert.rejects(
      service.publish(staff, productA, {
        configId: created.configId,
        draftVersion: '3',
        idempotencyKey: 'publish-key-01',
      }),
      /synthetic crash after immutable intent commit/,
    );
    const intent = (await service.read(staff, productA)).config.publication;
    assert.equal(intent.state, 'PUBLISH_REQUESTED');
    assert.equal(intent.sourceDraftVersion, '3');
    assert.equal(intent.requestKey, 'publish-key-01');
    const durableIntents = await core.outbox.claim(
      shopId,
      new Date(),
      'm5-018-intent-proof',
      new Date(Date.now() + 30000),
      100,
    );
    const persistedIntent = durableIntents.filter(
      (event) => event.eventType === 'm5.publication.intent' && event.businessKey === intent.revisionId,
    );
    assert.equal(persistedIntent.length, 1, 'Immutable request and outbox commit before provider preparation');
    assert.deepEqual(persistedIntent[0].payload, {
      configId: created.configId,
      revisionId: intent.revisionId,
      installationGeneration: '1',
      sourceDraftVersion: '3',
      idempotencyKey: 'publish-key-01',
    });
    assert.equal(
      (
        await service.save(staff, productA, {
          configId: created.configId,
          draftVersion: '3',
          draft: changed,
          idempotencyKey: 'save-after-intent',
        })
      ).kind,
      'saved',
    );
    const published = await service.publish(staff, productA, {
      configId: created.configId,
      draftVersion: '3',
      idempotencyKey: 'publish-key-01',
    });
    assert.equal(published.kind, 'accepted');
    assert.equal(published.revisionId, intent.revisionId);
    assert.equal(published.state, 'REMOTE_READY_ACTIVATION_PENDING');
    const geometry = await core.configs.getRevisionGeometry(shopId, published.revisionId);
    const presentation = await core.configs.getRevisionPresentation(shopId, published.revisionId);
    assert.equal(presentation.version, 'm5-presentation-v1');
    assert.equal(presentation.labels.methods[sharedId], 'Screen print');
    assert.equal(presentation.labels.values['second-option'][sharedId], 'Navy ink');
    assert.equal(geometry.mode, 'required');
    assert.equal(geometry.value.views[0].image.revisionId, 'product_111');
    assert.equal(
      (await core.configs.getRevision(shopId, published.revisionId)).publishedValue.version,
      'm2-published-config-v1',
    );
    const revision = await core.configs.getRevision(shopId, published.revisionId);
    await assert.rejects(
      core.transactions.run((tx) =>
        core.configs.createValidatedRevision(tx, {
          shopId,
          configId: created.configId,
          revisionId: randomUUID(),
          publishedValue: { ...revision.publishedValue, revisionId: randomUUID() },
          geometry: { version: 'm5-geometry-v1', value: invalid.geometry },
          presentation: { version: 'm5-presentation-v1', labels: invalid.labels ?? {} },
          sourceDraftVersion: '3',
          sourceInstallationGeneration: staff.installationGeneration,
          mode: 'required',
          createdByRef: 'staff-1',
        }),
      ),
    );
    const newerDraft = { ...changed, mode: 'optional' };
    assert.equal(
      (
        await service.save(staff, productA, {
          configId: created.configId,
          draftVersion: '4',
          draft: newerDraft,
          idempotencyKey: 'save-key-03',
        })
      ).kind,
      'saved',
    );
    const sql = new Pool({ connectionString: database });
    try {
      await assert.rejects(
        sql.query('UPDATE config_revision_presentation SET presentation_value=$1 WHERE shop_id=$2 AND revision_id=$3', [
          { version: 'm5-presentation-v1', labels: {} },
          shopId,
          published.revisionId,
        ]),
        /immutable/,
      );
      const digest = '0'.repeat(64);
      await sql.query(
        'INSERT INTO publication_operations (shop_id,config_id,operation_id,revision_id,installation_generation,operation_sequence,expected_projection,expected_projection_digest,status,acknowledged_at,observed_at,observed_projection,observed_projection_digest,activated_at) VALUES ($1,$2,$3,$4,1,1,$5,$6,$7,now(),now(),$5,$6,now())',
        [shopId, created.configId, published.revisionId, published.revisionId, {}, digest, 'activated'],
      );
      await sql.query(
        'INSERT INTO m4_publication_progress (shop_id,config_id,operation_id,phase,mode,activation_evidence) VALUES ($1,$2,$3,$4,$5,$6)',
        [shopId, created.configId, published.revisionId, 'active', 'required', 'synthetic-reviewed-test'],
      );
      await sql.query(
        'UPDATE product_configs SET effective_revision_id=$1,effective_operation_id=$2,publication_sequence=1 WHERE shop_id=$3 AND config_id=$4',
        [published.revisionId, published.revisionId, shopId, created.configId],
      );
      const newer = await service.publish(staff, productA, {
        configId: created.configId,
        draftVersion: '5',
        idempotencyKey: 'publish-key-02',
      });
      assert.equal(newer.kind, 'accepted', 'an active older operation permits a newer revision');
      await sql.query(
        'INSERT INTO publication_operations (shop_id,config_id,operation_id,revision_id,installation_generation,operation_sequence,expected_projection,expected_projection_digest) VALUES ($1,$2,$3,$4,1,2,$5,$6)',
        [shopId, created.configId, newer.revisionId, newer.revisionId, {}, digest],
      );
      await sql.query(
        'INSERT INTO m4_publication_progress (shop_id,config_id,operation_id,phase,mode) VALUES ($1,$2,$3,$4,$5)',
        [shopId, created.configId, newer.revisionId, 'prepared', 'optional'],
      );
      await sql.query('UPDATE product_configs SET publication_sequence=2 WHERE shop_id=$1 AND config_id=$2', [
        shopId,
        created.configId,
      ]);
      assert.equal(
        (
          await service.save(staff, productA, {
            configId: created.configId,
            draftVersion: '5',
            draft: {
              ...newerDraft,
              labels: { ...newerDraft.labels, methods: { ...newerDraft.labels?.methods, [sharedId]: 'New name' } },
            },
            idempotencyKey: 'save-key-after-publish',
          })
        ).kind,
        'saved',
      );
      const observed = (await service.read(staff, productA)).config.publication;
      assert.equal(observed.state, 'PUBLISH_REQUESTED');
      assert.equal(observed.revisionId, newer.revisionId);
      assert.equal(observed.activeRevisionId, published.revisionId);
      assert.equal(observed.sourceDraftVersion, '5');
      assert.equal((await service.read(staff, productA)).config.draftVersion, '6');
    } finally {
      await sql.end();
    }
    const productDConfig = await core.configs.getByProduct(shopId, '444');
    const productDDraft = structuredClone(baseDraft());
    productDDraft.geometry.views[0].image.revisionId = 'product_444';
    productDDraft.geometry.views[0].variantImages = [];
    productDDraft.geometry.views[0].placements[0].variantOverrides = [];
    assert.equal(
      (
        await service.save(staff, productD, {
          configId: productDConfig.configId,
          draftVersion: '1',
          draft: productDDraft,
          idempotencyKey: 'save-productD',
        })
      ).kind,
      'saved',
    );
    failPrepareOnce = true;
    await assert.rejects(
      service.publish(staff, productD, {
        configId: productDConfig.configId,
        draftVersion: '2',
        idempotencyKey: 'publish-productD-before-prepare',
      }),
      /synthetic crash after immutable intent commit/,
    );
    assert.equal((await core.configs.getCurrentPublication(shopId, productDConfig.configId)).phase, 'intent');
    paused = true;
    const racing = service.copy(staff, productA, productC, 'copy-key-race');
    await enteredPromise;
    await core.transactions.run((tx) =>
      core.tenants.startInstallation(tx, shopId, 'gid://shopify/AppInstallation/456'),
    );
    release();
    await assert.rejects(racing, /Current tenant installation required/);
    assert.equal(await core.configs.getByProduct(shopId, '333'), null);
    assert.equal(
      await core.configs.getCurrentPublication(shopId, created.configId),
      null,
      'prior-generation M4 progress must not become the new installation current publication',
    );
    assert.equal(
      await core.configs.getCurrentPublication(shopId, productDConfig.configId),
      null,
      'old installation unprepared intent must disappear from current readback',
    );
    const reinstalledStaff = {
      ...staff,
      installationGeneration: '2',
      installationId: 'gid://shopify/AppInstallation/456',
    };
    assert.equal(
      (
        await service.publish(reinstalledStaff, productA, {
          configId: created.configId,
          draftVersion: '3',
          idempotencyKey: 'publish-key-01',
        })
      ).kind,
      'forbidden',
      'an old-generation immutable intent must not resume in the new installation',
    );
  } finally {
    await core.close();
  }
});
