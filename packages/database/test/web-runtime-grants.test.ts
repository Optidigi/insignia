import { randomBytes, randomUUID, sign } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { ArtworkError, createMerchantPreviewCapture } from '@insignia/application';
import { encodeHeader, wholeQuoteSignBytes } from '@insignia/cart-authorization';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { createDatabase } from '../src/client/database.js';
import { createDurableCore } from '../src/index.js';
import { purchaseFixture } from './support/purchase-fixture.js';

// Creates/removes only its own disposable DB and unique roles on the allocated local PG18 cluster.
it.runIf(Boolean(process.env.WEB_RUNTIME_GRANTS_TEST_URL))(
  'qualifies real web LOGIN artwork/buyer/purchase access without release or worker authority',
  async () => {
    const address = new URL(process.env.WEB_RUNTIME_GRANTS_TEST_URL ?? '');
    const allocatedLocal =
      address.hostname === '127.0.0.1' &&
      address.port === '58199' &&
      address.username === 'synthetic_m8_owner' &&
      address.pathname === '/postgres';
    const durableCi =
      ['localhost', '127.0.0.1'].includes(address.hostname) &&
      address.port === '5432' &&
      address.username === 'insignia_test' &&
      address.pathname === '/insignia_test';
    if (
      !['postgres:', 'postgresql:'].includes(address.protocol) ||
      !(allocatedLocal || durableCi) ||
      address.hash ||
      address.searchParams.size > 1 ||
      [...address.searchParams.keys()].some((key) => key !== 'sslmode') ||
      (address.searchParams.has('sslmode') && address.searchParams.get('sslmode') !== 'disable')
    )
      throw new Error('Allocated synthetic PostgreSQL qualification required');
    const webPassword = randomBytes(32).toString('hex'),
      workerPassword = randomBytes(32).toString('hex'),
      inspectorPassword = randomBytes(32).toString('hex');
    const suffix = randomUUID().replaceAll('-', '');
    const name = `synthetic_web_acl_${suffix}`,
      login = `synthetic_web_${suffix}`,
      queue = `synthetic_queue_${suffix}`,
      inspector = `synthetic_inspect_${suffix}`,
      inspectorLogin = `synthetic_inspect_login_${suffix}`,
      extra = `synthetic_extra_${suffix}`,
      worker = `synthetic_purchase_${suffix}`,
      enqueue = `synthetic_enqueue_${suffix}`;
    const admin = new Pool({ connectionString: address.href, max: 1, connectionTimeoutMillis: 5000 });
    const target = new URL(address);
    target.pathname = `/${name}`;
    let owner: Pool | undefined,
      web: Pool | undefined,
      purchaseWorker: Pool | undefined,
      inspectionWorker: Pool | undefined;
    let ownerDb: ReturnType<typeof createDatabase> | undefined;
    let created = false;
    try {
      expect(Number((await admin.query('show server_version_num')).rows[0].server_version_num)).toBeGreaterThanOrEqual(
        180000,
      );
      await admin.query(`CREATE DATABASE ${name}`);
      created = true;
      owner = new Pool({ connectionString: target.href, connectionTimeoutMillis: 5000 });
      await owner.query(
        `CREATE ROLE ${login} LOGIN PASSWORD '${webPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; CREATE ROLE ${queue} NOLOGIN; CREATE ROLE ${extra} NOLOGIN; CREATE ROLE ${enqueue} NOLOGIN; GRANT ${enqueue} TO ${login}`,
      );
      const migrations = new URL('../migrations/', import.meta.url);
      const names = (await readdir(migrations)).filter((n) => n.endsWith('.sql')).sort();
      expect(names).toHaveLength(38);
      expect(names.at(-1)).toBe('20261015000600_lean_recurring_quote.sql');
      for (const file of names.slice(0, 20))
        await owner.query((await readFile(new URL(file, migrations), 'utf8')).split('-- migrate:down')[0]!);
      await owner.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
      await owner.query(`GRANT USAGE ON SCHEMA public TO ${login}`);
      // Model historical M5 grants explicitly before new tables exist; never apply broad grants after migration20.
      const oldTables = (
        await owner.query(
          "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND relkind='r' AND relname NOT IN ('trusted_release_records','webhook_obligation_facts')",
        )
      ).rows;
      for (const { relname } of oldTables)
        await owner.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON public."${relname}" TO ${login}`);
      await owner.query(`GRANT SELECT ON trusted_release_records TO ${login}`);
      for (const file of names.slice(20))
        await owner.query((await readFile(new URL(file, migrations), 'utf8')).split('-- migrate:down')[0]!);
      const webAddress = new URL(target);
      webAddress.username = login;
      webAddress.password = webPassword;
      web = new Pool({ connectionString: webAddress.href, connectionTimeoutMillis: 5000 });
      const core = createDurableCore(web);
      ownerDb = createDatabase(owner);
      const fixture = await purchaseFixture(ownerDb);
      const { shopId, generation } = fixture;
      const now = new Date(),
        assetId = randomUUID(),
        ownerHash = 'a'.repeat(64);
      const authority = { shopId, installationGeneration: generation, kind: 'merchant' as const };
      const asset = {
        assetId,
        shopId,
        installationGeneration: generation,
        ownerHash,
        ownerKind: 'merchant' as const,
        declaredMime: 'image/png' as const,
        declaredBytes: 10,
        state: 'UPLOADING' as const,
        quarantineKey: `quarantine/${assetId}`,
        originalKey: `original/${assetId}`,
        previewKey: `preview/${assetId}`,
        collectedAt: now,
        uploadUntil: new Date(+now + 60000),
        expiresAt: new Date(+now + 86400000),
        claimId: null,
        manifest: null,
        rejection: null,
      };
      // Existing installation privileges fail on the real new repositories, not a SQL double.
      await expect(core.artwork.create(asset)).rejects.toMatchObject({ code: '42501' });
      const buyerScope = { shopId, installationGeneration: generation, ownerHash };
      await expect(
        core.buyers.issueSession({
          scope: buyerScope,
          sessionId: randomUUID(),
          now,
          expiresAt: new Date(+now + 86400000),
        }),
      ).rejects.toMatchObject({ code: '42501' });
      const script = (
        await readFile(new URL('../../../deployment/m8-journey/web-runtime-grants.sql', import.meta.url), 'utf8')
      )
        .replaceAll('insignia_runtime', login)
        .replaceAll('insignia_queue_enqueue', enqueue);
      await owner.query(script);
      await owner.query(script); // Reapplication must retain the same bounded authority.
      expect((await web.query('SELECT current_user')).rows[0].current_user).toBe(login);
      // Initial authorization inserts execute the renewal-aware trigger even when
      // no renewal exists. Exercise it as the real restricted LOGIN, not the owner.
      const initialSetId = randomUUID();
      const initialHeader = {
        keyId: fixture.authorization.keyId,
        generationHex: fixture.authorizationGeneration.replaceAll('-', ''),
        epoch: fixture.authorizationEpoch,
        quoteHex: fixture.quote.quoteId.replaceAll('-', ''),
        setHex: initialSetId.replaceAll('-', ''),
        count: fixture.quote.economics.lines.length,
        currency: fixture.quote.presentmentCurrency,
        exponent: fixture.quote.presentmentExponent,
        country: fixture.quote.country,
        marketId: fixture.quote.marketId,
        validThroughDay: fixture.quote.validThroughDay,
        totalQuantity: fixture.quote.economics.customizedQuantity,
        totalMinor: fixture.quote.economics.totalMinor,
      };
      const initialMembers = fixture.quote.economics.lines.map((line) => ({
        index: line.lineIndex,
        variantId: line.variantId,
        quantity: line.quantity,
        unitMinor: line.unitPriceMinor,
      }));
      const initialEnvelope = Buffer.concat([
        encodeHeader(initialHeader),
        sign(null, wholeQuoteSignBytes(initialHeader, initialMembers), fixture.keys.privateKey),
      ]).toString('base64url');
      expect(
        (
          await web.query(
            `INSERT INTO quote_authorization_sets(set_id,quote_id,shop_id,installation_generation,
              authorization_generation,authorization_epoch,key_id,public_key_fingerprint,first_valid_day,
              last_valid_day,valid_through_day,envelope_carrier,member_carriers)
            SELECT $1,quote_id,shop_id,installation_generation,authorization_generation,authorization_epoch,
              key_id,public_key_fingerprint,first_valid_day,last_valid_day,valid_through_day,$2,member_carriers
            FROM quote_authorization_sets WHERE set_id=$3 RETURNING set_id,envelope_carrier,member_carriers`,
            [initialSetId, initialEnvelope, fixture.authorization.setId],
          )
        ).rows,
      ).toEqual([
        { set_id: initialSetId, envelope_carrier: initialEnvelope, member_carriers: fixture.authorization.members },
      ]);
      expect(
        (await web.query('SELECT * FROM quote_authorization_renewals WHERE set_id=$1', [initialSetId])).rows,
      ).toEqual([]);
      expect((await core.artwork.create(asset)).assetId).toBe(assetId);
      expect((await core.artwork.complete(authority, assetId, now)).state).toBe('QUEUED');
      expect((await core.artwork.get(authority, assetId))?.originalKey).toBe(asset.originalKey);
      expect(await core.artwork.get({ ...authority, shopId: randomUUID() }, assetId)).toBeNull();
      expect(await core.artwork.get({ ...authority, kind: 'guest', ownerHash: 'b'.repeat(64) }, assetId)).toBeNull();
      const session = await core.buyers.issueSession({
        scope: buyerScope,
        sessionId: randomUUID(),
        now,
        expiresAt: new Date(+now + 86400000),
      });
      const design = randomUUID();
      await core.buyers.saveDesign(buyerScope, { id: design, expectedVersion: 0, value: { placements: [] }, now });
      await core.buyers.saveDesign(buyerScope, {
        id: design,
        expectedVersion: 1,
        value: { placements: ['updated'] },
        now,
      });
      expect((await core.buyers.getDesign(buyerScope, design, now))?.version).toBe(2);
      expect(await core.buyers.getSession({ ...buyerScope, ownerHash: 'b'.repeat(64) }, now)).toBeNull();
      const proposalId = randomUUID();
      await core.buyers.putProposal(buyerScope, {
        id: proposalId,
        requestDigest: 'b'.repeat(64),
        materialHash: 'c'.repeat(64),
        request: { groups: [] },
        candidate: {},
        expiresAt: new Date(+now + 60000),
        now,
      });
      expect((await core.buyers.getProposal(buyerScope, proposalId, now))?.id).toBe(proposalId);
      await core.buyers.reserveCommand(buyerScope, { kind: 'accept', key: 'one', requestDigest: 'a'.repeat(64), now });
      await core.buyers.linkQuote(buyerScope, {
        quoteId: fixture.quote.quoteId,
        proposalId,
        ownerBinding: ownerHash,
        requestDigest: 'a'.repeat(64),
        now,
      });
      const applicationId = randomUUID();
      await core.buyers.finishApplication(buyerScope, {
        kind: 'accept',
        key: 'one',
        requestDigest: 'a'.repeat(64),
        id: applicationId,
        quoteId: fixture.quote.quoteId,
        ownerBinding: ownerHash,
        expectedFingerprint: 'd'.repeat(64),
        now,
      });
      expect(
        (
          await core.buyers.confirmApplication(buyerScope, {
            id: applicationId,
            observedFingerprint: 'd'.repeat(64),
            now,
          })
        ).status,
      ).toBe('APPLIED');
      expect(
        (await web.query('SELECT payload FROM purchase_offer_payloads WHERE quote_id=$1', [fixture.quote.quoteId]))
          .rows[0].payload,
      ).toEqual({ groups: [] });
      // Seed economic facts only as owner; web can read and append merchant artwork events, never reconcile.
      const purchaseId = randomUUID();
      await owner.query(
        'INSERT INTO purchase_orders(purchase_id,shop_id,installation_generation,order_id,order_created_at,currency,original_total_minor,is_test) VALUES($1,$2,1,$3,$4,$5,100,true)',
        [purchaseId, shopId, 'gid://shopify/Order/123', now, 'USD'],
      );
      expect((await core.purchases.get(authority, purchaseId))?.originalTotalMinor).toBe('100');
      const manifest = {
        version: 'm6-inspection-v1',
        mimeType: 'image/png',
        byteLength: 10,
        sha256: 'a'.repeat(64),
        width: 2,
        height: 2,
        previewSha256: 'b'.repeat(64),
        previewByteLength: 15,
      };
      await owner.query("UPDATE artwork_assets SET state='USABLE',manifest=$2 WHERE asset_id=$1", [assetId, manifest]);
      await owner.query('INSERT INTO purchase_bindings VALUES($1,1,$2,$3,$4,$5)', [
        shopId,
        purchaseId,
        fixture.quote.quoteId,
        fixture.authorization.setId,
        {},
      ]);
      await owner.query('INSERT INTO purchase_design_payloads VALUES($1,1,$2,$3,$4,$5,$6,NULL)', [
        shopId,
        purchaseId,
        fixture.authorization.setId,
        now,
        new Date(+now + 86400000),
        {
          version: 'm8-purchase-design-v1',
          collectedAt: now.toISOString(),
          request: {
            groups: [
              {
                group: {
                  design: {
                    placements: [{ placementId: 'front', artwork: { kind: 'revision', revisionId: assetId } }],
                  },
                },
              },
            ],
          },
          revisions: [],
        },
      ]);
      expect((await core.purchases.getAuthorizedArtwork(authority, { purchaseId, assetId }))?.originalKey).toBe(
        asset.originalKey,
      );
      expect(await core.purchases.getAuthorizedArtwork(authority, { purchaseId, assetId: randomUUID() })).toBeNull();
      await core.purchases.appendArtwork(
        { ...authority, ownerHash },
        { purchaseId, expectedVersion: 0, groupIndex: 0, placementId: 'front', assetId, ownerHash },
      );
      await core.purchases.lockArtwork(authority, { purchaseId, expectedVersion: 1 });
      expect((await core.purchases.get(authority, purchaseId))?.artworkState).toBe('ARTWORK_LOCKED');

      expect(await core.purchases.list(authority, { limit: 10 })).toHaveLength(1);
      const claimToken = randomUUID();
      await owner.query(
        `INSERT INTO purchase_reconciliation_cursors(shop_id,installation_generation,watermark,window_since,window_until,page_cursor,claim_token,claim_until,next_attempt_at,last_error_class) VALUES($1,1,clock_timestamp()-interval '1 day',clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day','owned-page',$2,clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '1 day','preserved')`,
        [shopId, claimToken],
      );
      const beforeCursor = (
        await owner.query('SELECT * FROM purchase_reconciliation_cursors WHERE shop_id=$1', [shopId])
      ).rows[0];
      await core.purchases.requestReconciliation(authority, purchaseId);
      const afterCursor = (
        await owner.query('SELECT * FROM purchase_reconciliation_cursors WHERE shop_id=$1', [shopId])
      ).rows[0];
      expect(+afterCursor.next_attempt_at).toBeLessThan(+beforeCursor.next_attempt_at);
      delete beforeCursor.next_attempt_at;
      delete afterCursor.next_attempt_at;
      expect(afterCursor).toEqual(beforeCursor);
      await expect(core.purchases.requestReconciliation(authority, randomUUID())).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(
        core.purchases.requestReconciliation({ ...authority, shopId: randomUUID() }, purchaseId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await owner.query('UPDATE installation_generations SET deactivated_at=clock_timestamp() WHERE shop_id=$1', [
        shopId,
      ]);
      await expect(core.purchases.requestReconciliation(authority, purchaseId)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await owner.query('UPDATE installation_generations SET deactivated_at=NULL WHERE shop_id=$1', [shopId]);

      await expect(core.purchases.get({ ...authority, shopId: randomUUID() }, purchaseId)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await web.query('SELECT * FROM purchase_orders WHERE purchase_id=$1 FOR UPDATE', [purchaseId]);
      const denied = [
        'INSERT INTO quote_authorization_renewals DEFAULT VALUES',
        'UPDATE quote_authorization_renewals SET material_hash=material_hash',
        'DELETE FROM quote_authorization_renewals',
        'TRUNCATE quote_authorization_renewals',
        'INSERT INTO trusted_release_records DEFAULT VALUES',
        'UPDATE trusted_release_records SET created_at=created_at',
        'DELETE FROM trusted_release_records',
        'TRUNCATE trusted_release_records',
        'INSERT INTO purchase_orders DEFAULT VALUES',
        'DELETE FROM purchase_orders',
        'UPDATE purchase_orders SET currency=currency',
        'TRUNCATE purchase_paid_facts',
        'INSERT INTO purchase_paid_facts DEFAULT VALUES',
        'UPDATE purchase_design_payloads SET payload=NULL',
        'DELETE FROM purchase_offer_payloads',
        'UPDATE buyer_sessions SET owner_hash=owner_hash',
        'UPDATE purchase_reconciliation_cursors SET claim_token=claim_token',
        'UPDATE purchase_reconciliation_cursors SET watermark=watermark',
        'SELECT claim_token FROM purchase_reconciliation_cursors',
        'INSERT INTO purchase_reconciliation_cursors DEFAULT VALUES',
        'UPDATE artwork_assets SET original_key=original_key',
        'UPDATE artwork_assets SET manifest=manifest',
        'DELETE FROM artwork_assets',
        'SELECT public.cleanup_buyer_payloads(1)',
        'SELECT public.cleanup_purchase_payloads(1)',
        `SELECT public.read_purchase_offer_history('${shopId}',1,'${randomUUID()}','${randomUUID()}')`,
      ];
      for (const query of denied) await expect(web.query(query)).rejects.toMatchObject({ code: '42501' });
      await expect(
        web.query('UPDATE purchase_orders SET purchase_id=purchase_id WHERE purchase_id=$1', [purchaseId]),
      ).rejects.toMatchObject({ code: '23000' });
      // Installation rejects unexpected inherited/definer/economic mutation authority rather than laundering it.
      await owner.query(`GRANT ${extra} TO ${login}`);
      await expect(owner.query(script)).rejects.toThrow('unqualified_web_membership');
      await owner.query('ROLLBACK');
      await owner.query(`REVOKE ${extra} FROM ${login}`);
      await owner.query(`GRANT EXECUTE ON FUNCTION cleanup_purchase_payloads(integer) TO ${login}`);
      await expect(owner.query(script)).rejects.toThrow('unqualified_web_security_definer');
      await owner.query('ROLLBACK');
      await owner.query(`REVOKE EXECUTE ON FUNCTION cleanup_purchase_payloads(integer) FROM ${login}`);
      await owner.query(`GRANT INSERT ON purchase_paid_facts TO ${login}`);
      await expect(owner.query(script)).rejects.toThrow('unqualified_web_purchase_mutation');
      await owner.query('ROLLBACK');
      await owner.query(`REVOKE INSERT ON purchase_paid_facts FROM ${login}`);
      await owner.query(`GRANT SELECT(claim_token) ON purchase_reconciliation_cursors TO ${login}`);
      await expect(owner.query(script)).rejects.toThrow('unqualified_web_cursor_access');
      await owner.query('ROLLBACK');
      await owner.query(`REVOKE SELECT(claim_token) ON purchase_reconciliation_cursors FROM ${login}`);
      const payloadHazards = [
        {
          grant: `GRANT TRUNCATE ON purchase_artwork_events TO PUBLIC`,
          revoke: `REVOKE TRUNCATE ON purchase_artwork_events FROM PUBLIC`,
          probe: 'TRUNCATE purchase_artwork_events',
        },
        {
          grant: `GRANT DELETE ON purchase_offer_payloads TO ${login}`,
          revoke: `REVOKE DELETE ON purchase_offer_payloads FROM ${login}`,
          probe: 'DELETE FROM purchase_offer_payloads WHERE false',
        },
        {
          grant: `GRANT UPDATE(erased_at) ON purchase_artwork_events TO ${login}`,
          revoke: `REVOKE UPDATE(erased_at) ON purchase_artwork_events FROM ${login}`,
          probe: 'UPDATE purchase_artwork_events SET erased_at=clock_timestamp() WHERE false',
        },
        {
          grant: `GRANT UPDATE(payload) ON purchase_offer_payloads TO ${login}`,
          revoke: `REVOKE UPDATE(payload) ON purchase_offer_payloads FROM ${login}`,
          probe: 'UPDATE purchase_offer_payloads SET payload=NULL WHERE false',
        },
        {
          grant: `GRANT INSERT(erased_at) ON purchase_artwork_events TO ${login}`,
          revoke: `REVOKE INSERT(erased_at) ON purchase_artwork_events FROM ${login}`,
          probe: 'INSERT INTO purchase_artwork_events(erased_at) SELECT clock_timestamp() WHERE false',
        },
        {
          grant: `GRANT INSERT(erased_at) ON purchase_offer_payloads TO ${login}`,
          revoke: `REVOKE INSERT(erased_at) ON purchase_offer_payloads FROM ${login}`,
          probe: 'INSERT INTO purchase_offer_payloads(erased_at) SELECT clock_timestamp() WHERE false',
        },
      ];
      for (const hazard of payloadHazards) {
        await owner.query(hazard.grant);
        const actualLogin = await web.connect();
        try {
          await actualLogin.query('BEGIN');
          await actualLogin.query(hazard.probe);
        } finally {
          await actualLogin.query('ROLLBACK');
          actualLogin.release();
        }
        await expect.soft(owner.query(script)).rejects.toThrow('unqualified_web_payload_mutation');
        await owner.query('ROLLBACK');
        await owner.query(hazard.revoke);
        await expect.soft(web.query(hazard.probe)).rejects.toMatchObject({ code: '42501' });
      }
      await owner.query(`ALTER ROLE ${enqueue} CREATEROLE`);
      await expect.soft(owner.query(script)).rejects.toThrow('unqualified_web_enqueue_capability');
      await owner.query('ROLLBACK');
      await owner.query(`ALTER ROLE ${enqueue} NOCREATEROLE`);
      for (const path of [
        '../../../scripts/m6-artwork/runtime-grants.sql',
        '../../../scripts/m7-storefront/runtime-grants.sql',
        '../../../scripts/m8-purchase/runtime-grants.sql',
      ]) {
        const other = (await readFile(new URL(path, import.meta.url), 'utf8'))
          .replaceAll('insignia_queue_consume', queue)
          .replaceAll('insignia_artwork_inspect', inspector);
        await owner.query(other);
      }
      // Merchant preview permissions are additive only after qualified existing capabilities.
      const previewScript = (
        await readFile(
          new URL('../../../deployment/m8-journey/merchant-preview-runtime-grants.sql', import.meta.url),
          'utf8',
        )
      )
        .replaceAll('insignia_runtime', login)
        .replaceAll('insignia_queue_enqueue', enqueue)
        .replaceAll('insignia_artwork_inspect', inspector);
      await expect(web.query('SELECT * FROM merchant_preview_assets')).rejects.toMatchObject({ code: '42501' });
      await owner.query(
        `CREATE ROLE ${inspectorLogin} LOGIN PASSWORD '${inspectorPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; GRANT ${inspector} TO ${inspectorLogin}`,
      );
      const inspectorAddress = new URL(target);
      inspectorAddress.username = inspectorLogin;
      inspectorAddress.password = inspectorPassword;
      inspectionWorker = new Pool({ connectionString: inspectorAddress.href, connectionTimeoutMillis: 5000 });
      await expect(inspectionWorker.query('SELECT * FROM merchant_preview_assets')).rejects.toMatchObject({
        code: '42501',
      });
      await owner.query(previewScript);
      await owner.query(previewScript);
      expect((await inspectionWorker.query('SELECT current_user')).rows[0].current_user).toBe(inspectorLogin);
      const previewId = randomUUID(),
        previewConfigId = randomUUID(),
        previewRevisionId = randomUUID();
      await core.transactions.run((tx) =>
        core.configs.createConfig(tx, {
          shopId,
          configId: previewConfigId,
          externalProductId: '42',
          draftSchemaVersion: 'm3-config-draft-v1',
          draftValue: {},
        }),
      );
      const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      const objects = new Map<string, Uint8Array>();
      // Only provider storage/decoding are doubles; capture, LOGIN, triggers and revision binding are real.
      const capture = createMerchantPreviewCapture({
        store: core.merchantPreviews,
        clock: () => now,
        readImage: async () => png,
        inspect: async () => ({
          version: 'm6-inspection-v1',
          mimeType: 'image/png',
          width: 100,
          height: 100,
          originalSha256: '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6',
          preview: png,
          previewMimeType: 'image/png',
        }),
        storage: {
          async read({ key }) {
            const bytes = objects.get(key);
            if (!bytes) throw new ArtworkError('NOT_FOUND');
            return bytes;
          },
          async putImmutable({ key, bytes }) {
            if (objects.has(key)) throw new ArtworkError('CONFLICT');
            objects.set(key, Uint8Array.from(bytes));
          },
          async remove({ key }) {
            objects.delete(key);
          },
        },
      });
      expect(
        (await capture.capture(authority, { assetId: previewId, productId: '42', imageRevisionId: 'product_42' }))
          ?.state,
      ).toBe('USABLE');
      expect(objects.size).toBe(2);
      await core.transactions.run((tx) =>
        core.configs.createValidatedRevision(tx, {
          shopId,
          configId: previewConfigId,
          revisionId: previewRevisionId,
          mode: 'optional',
          sourceDraftVersion: '1',
          sourceInstallationGeneration: generation,
          createdByRef: 'synthetic',
          publishedValue: {
            version: 'm2-published-config-v1',
            shopId,
            productId: '42',
            revisionId: previewRevisionId,
            shopCurrency: 'USD',
            methods: [],
            placements: [],
            productionOptions: [],
            pricingRules: [],
          },
          geometry: {
            version: 'm5-geometry-v1',
            value: {
              version: 'm5-geometry-v1',
              views: [
                {
                  id: 'front',
                  image: { revisionId: 'product_42', width: 100, height: 100 },
                  variantImages: [],
                  placements: [],
                },
              ],
              steps: [],
            },
          },
          presentation: { version: 'm5-presentation-v1', labels: {} },
          previewAssets: [{ imageRevisionId: 'product_42', assetId: previewId }],
        }),
      );
      expect(
        (
          await web.query('SELECT asset_id FROM config_revision_preview_assets WHERE revision_id=$1', [
            previewRevisionId,
          ])
        ).rows,
      ).toEqual([{ asset_id: previewId }]);
      const cleanup = createDurableCore(inspectionWorker).merchantPreviews;
      const later = new Date(+now + 8 * 86400000);
      expect(await cleanup.markDeleting(previewId, later)).toBeNull(); // Referenced current assets do not expire.
      const abandonedId = randomUUID();
      await capture.capture(authority, { assetId: abandonedId, productId: '42', imageRevisionId: 'product_42' });
      expect((await cleanup.markDeleting(abandonedId, later))?.state).toBe('DELETING');
      await cleanup.finishDeleting(abandonedId, later);
      expect(
        (
          await inspectionWorker.query('SELECT state,manifest FROM merchant_preview_assets WHERE asset_id=$1', [
            abandonedId,
          ])
        ).rows,
      ).toEqual([{ state: 'DELETED', manifest: null }]);
      for (const query of [
        'UPDATE merchant_preview_assets SET manifest=manifest WHERE false',
        'UPDATE merchant_preview_assets SET collected_at=collected_at WHERE false',
        'UPDATE merchant_preview_assets SET abandon_at=abandon_at WHERE false',
        'UPDATE merchant_preview_assets SET original_key=original_key WHERE false',
        'INSERT INTO merchant_preview_assets(claim_id) SELECT NULL WHERE false',
        'DELETE FROM merchant_preview_assets WHERE false',
        'TRUNCATE merchant_preview_assets',
        'UPDATE config_revision_preview_assets SET asset_id=asset_id WHERE false',
        'DELETE FROM config_revision_preview_assets WHERE false',
      ])
        await expect(web.query(query)).rejects.toMatchObject({ code: '42501' });
      for (const query of [
        'INSERT INTO merchant_preview_assets DEFAULT VALUES',
        'UPDATE merchant_preview_assets SET claim_id=claim_id WHERE false',
        'UPDATE merchant_preview_assets SET original_key=original_key WHERE false',
        'UPDATE merchant_preview_assets SET abandon_at=abandon_at WHERE false',
        'DELETE FROM merchant_preview_assets WHERE false',
        'TRUNCATE merchant_preview_assets',
        'INSERT INTO config_revision_preview_assets DEFAULT VALUES',
        'UPDATE config_revision_preview_assets SET asset_id=asset_id WHERE false',
        'DELETE FROM config_revision_preview_assets WHERE false',
      ])
        await expect(inspectionWorker.query(query)).rejects.toMatchObject({ code: '42501' });
      // Unexpected effective privileges abort the entire additive grant transaction; none are silently revoked.
      for (const hazard of [
        {
          grant: 'GRANT SELECT ON merchant_preview_assets TO PUBLIC',
          revoke: 'REVOKE SELECT ON merchant_preview_assets FROM PUBLIC',
          error: 'unqualified_preview_public_access',
        },
        {
          grant: `GRANT UPDATE(manifest) ON merchant_preview_assets TO ${login}`,
          revoke: `REVOKE UPDATE(manifest) ON merchant_preview_assets FROM ${login}`,
          error: 'unqualified_preview_column_access',
        },
        {
          grant: `GRANT INSERT(claim_id) ON merchant_preview_assets TO ${login}`,
          revoke: `REVOKE INSERT(claim_id) ON merchant_preview_assets FROM ${login}`,
          error: 'unqualified_preview_column_access',
        },
        {
          grant: `GRANT UPDATE(claim_id) ON merchant_preview_assets TO ${inspector}`,
          revoke: `REVOKE UPDATE(claim_id) ON merchant_preview_assets FROM ${inspector}`,
          error: 'unqualified_preview_column_access',
        },
        {
          grant: `GRANT INSERT ON config_revision_preview_assets TO ${inspector}`,
          revoke: `REVOKE INSERT ON config_revision_preview_assets FROM ${inspector}`,
          error: 'unqualified_preview_column_access',
        },
        {
          grant: `GRANT TRUNCATE ON merchant_preview_assets TO ${login}`,
          revoke: `REVOKE TRUNCATE ON merchant_preview_assets FROM ${login}`,
          error: 'unqualified_preview_column_access',
        },
      ]) {
        await owner.query(hazard.grant);
        await expect(owner.query(previewScript)).rejects.toThrow(hazard.error);
        await owner.query('ROLLBACK');
        await owner.query(hazard.revoke);
      }
      await owner.query(
        `CREATE ROLE ${worker} LOGIN PASSWORD '${workerPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; GRANT ${queue} TO ${worker}`,
      );
      // Model the M5 worker baseline used by the usage ledger's installation read/row lock.
      // Existing production grants: scripts/m5-024/queue-roles.sql; this fixture grants only the needed subset.
      await owner.query(`GRANT SELECT ON public.shops,public.installation_generations TO ${queue}`);
      await owner.query(`GRANT UPDATE(deactivated_at) ON public.installation_generations TO ${queue}`);
      const workerAddress = new URL(target);
      workerAddress.username = worker;
      workerAddress.password = workerPassword;
      purchaseWorker = new Pool({ connectionString: workerAddress.href, connectionTimeoutMillis: 5000 });
      for (const query of [
        'SELECT original_key FROM artwork_assets',
        'SELECT * FROM buyer_sessions',
        'SELECT private_envelope FROM signing_keys',
      ])
        await expect(purchaseWorker.query(query)).rejects.toMatchObject({ code: '42501' });
      await owner.query(script);
      // The local ledger is not activated for any deployed runtime role.
      for (const runtime of [web, purchaseWorker, inspectionWorker])
        for (const query of [
          'SELECT * FROM m9_usage_delivery_attempts',
          'INSERT INTO m9_usage_delivery_attempts DEFAULT VALUES',
          'UPDATE m9_usage_delivery_attempts SET outcome=outcome WHERE false',
          'DELETE FROM m9_usage_delivery_attempts WHERE false',
          'TRUNCATE m9_usage_delivery_attempts',
          'SELECT * FROM m9_usage_delivery_intents',
          'INSERT INTO m9_usage_delivery_intents DEFAULT VALUES',
          'UPDATE m9_usage_delivery_intents SET idempotency_key=idempotency_key WHERE false',
          'DELETE FROM m9_usage_delivery_intents WHERE false',
          'TRUNCATE m9_usage_delivery_intents',
          'SELECT * FROM m9_order_usage',
          'INSERT INTO m9_order_usage DEFAULT VALUES',
          'UPDATE m9_order_usage SET history_policy_hash=history_policy_hash WHERE false',
          'DELETE FROM m9_order_usage WHERE false',
          'TRUNCATE m9_order_usage',
        ])
          await expect(runtime.query(query)).rejects.toMatchObject({ code: '42501' });
      // Optional M9 qualification grant: run only after the baseline deny probes above.
      await owner.query('CREATE TABLE schema_migrations(version varchar(128) PRIMARY KEY)');
      for (const file of names)
        await owner.query('INSERT INTO schema_migrations(version) VALUES($1)', [file.split('_')[0]]);
      const usageScript = (
        await readFile(new URL('../../../scripts/m9-usage/runtime-grants.sql', import.meta.url), 'utf8')
      ).replaceAll('insignia_queue_consume', queue);
      await owner.query(`ALTER ROLE ${queue} CREATEROLE`);
      await expect(owner.query(usageScript)).rejects.toThrow('unqualified_usage_runtime_role');
      await owner.query('ROLLBACK');
      await owner.query(`ALTER ROLE ${queue} NOCREATEROLE`);
      await owner.query(`GRANT ${extra} TO ${queue}`);
      await expect(owner.query(usageScript)).rejects.toThrow('unqualified_usage_runtime_membership');
      await owner.query('ROLLBACK');
      await owner.query(`REVOKE ${extra} FROM ${queue}`);
      await owner.query('DELETE FROM schema_migrations WHERE version=$1', [names.at(-1)?.split('_')[0]]);
      await expect(owner.query(usageScript)).rejects.toThrow('exact_usage_schema38_required');
      await owner.query('ROLLBACK');
      await owner.query('INSERT INTO schema_migrations(version) VALUES($1)', [names.at(-1)?.split('_')[0]]);
      await owner.query('GRANT UPDATE(purchase_id) ON m9_order_usage TO PUBLIC');
      await expect(owner.query(usageScript)).rejects.toThrow('unqualified_usage_public_access');
      await owner.query('ROLLBACK');
      await owner.query('REVOKE UPDATE(purchase_id) ON m9_order_usage FROM PUBLIC');
      for (const table of ['m9_order_usage', 'm9_usage_delivery_intents', 'm9_usage_delivery_attempts'])
        for (const privilege of ['SELECT', 'UPDATE(decision)'].filter(
          (p) => table === 'm9_order_usage' || p === 'SELECT',
        )) {
          await owner.query(`GRANT ${privilege} ON ${table} TO PUBLIC`);
          await expect(owner.query(usageScript)).rejects.toThrow('unqualified_usage_public_access');
          await owner.query('ROLLBACK');
          await owner.query(`REVOKE ${privilege} ON ${table} FROM PUBLIC`);
        }
      await owner.query(usageScript);
      for (const runtime of [web, purchaseWorker, inspectionWorker])
        for (const query of [
          'SELECT * FROM m9_usage_delivery_attempts',
          'INSERT INTO m9_usage_delivery_attempts DEFAULT VALUES',
          'UPDATE m9_usage_delivery_attempts SET outcome=outcome WHERE false',
          'DELETE FROM m9_usage_delivery_attempts WHERE false',
          'TRUNCATE m9_usage_delivery_attempts',
        ])
          await expect(runtime.query(query)).rejects.toMatchObject({ code: '42501' });
      await owner.query(usageScript);
      await owner.query(
        'INSERT INTO purchase_paid_facts(shop_id,installation_generation,purchase_id,occurred_at) VALUES($1,1,$2,$3)',
        [shopId, purchaseId, now],
      );
      const usageScope = { shopId, installationGeneration: generation };
      const usageInput = { purchaseId, policy: null, history: { kind: 'UNVERIFIED' as const } };
      const workerCore = createDurableCore(purchaseWorker);
      expect(
        (await workerCore.usageLedger.selectPending(usageScope, { limit: 20, afterPurchaseId: null })).purchases,
      ).toContainEqual({ ...usageScope, purchaseId });
      const usage = await workerCore.usageLedger.record(usageScope, usageInput);
      expect(usage.decision).toEqual({ kind: 'EXCLUDED', units: 0, reason: 'TEST_ORDER' });
      expect(await workerCore.usageLedger.record(usageScope, usageInput)).toEqual(usage);
      await purchaseWorker.end();
      purchaseWorker = new Pool({ connectionString: workerAddress.href, connectionTimeoutMillis: 5000 });
      const reopenedWorker = createDurableCore(purchaseWorker);
      expect(await reopenedWorker.usageLedger.record(usageScope, usageInput)).toEqual(usage);
      expect(
        (await reopenedWorker.usageLedger.selectPending(usageScope, { limit: 20, afterPurchaseId: null })).purchases,
      ).not.toContainEqual({ ...usageScope, purchaseId });
      expect((await purchaseWorker.query('SELECT count(*)::int AS n FROM m9_order_usage')).rows[0].n).toBe(1);
      expect((await purchaseWorker.query('SELECT count(*)::int AS n FROM m9_usage_delivery_intents')).rows[0].n).toBe(
        0,
      );
      for (const query of [
        'SELECT * FROM m9_usage_delivery_attempts',
        'INSERT INTO m9_usage_delivery_attempts DEFAULT VALUES',
        'UPDATE m9_usage_delivery_attempts SET outcome=outcome WHERE false',
        'DELETE FROM m9_usage_delivery_attempts WHERE false',
        'TRUNCATE m9_usage_delivery_attempts',
        'UPDATE m9_order_usage SET purchase_id=purchase_id',
        'DELETE FROM m9_order_usage',
        'TRUNCATE m9_order_usage',
        'INSERT INTO m9_usage_delivery_intents DEFAULT VALUES',
      ])
        await expect(purchaseWorker.query(query)).rejects.toMatchObject({ code: '42501' });
      await expect(purchaseWorker.query('UPDATE m9_order_usage SET decision=decision')).rejects.toMatchObject({
        code: '23514',
      });
      for (const runtime of [web, inspectionWorker]) {
        await expect(runtime.query('SELECT * FROM m9_order_usage')).rejects.toMatchObject({ code: '42501' });
        await expect(runtime.query('SELECT * FROM m9_usage_delivery_intents')).rejects.toMatchObject({ code: '42501' });
      }
      expect(
        (
          await owner.query(
            "SELECT has_column_privilege($1,'artwork_assets','original_key','SELECT') AS original,has_table_privilege($1,'buyer_sessions','SELECT') AS buyer,has_column_privilege($1,'signing_keys','private_envelope','SELECT') AS signing",
            [queue],
          )
        ).rows[0],
      ).toEqual({ original: false, buyer: false, signing: false });
      expect(session.sessionId).toBeTruthy();
    } finally {
      await inspectionWorker?.end();
      await purchaseWorker?.end();
      await web?.end();
      if (ownerDb) await ownerDb.destroy();
      else await owner?.end();
      if (created) await admin.query(`DROP DATABASE ${name}`);
      for (const role of [worker, inspectorLogin, login, queue, inspector, extra, enqueue])
        await admin.query(`DROP ROLE IF EXISTS ${role}`);
      await admin.end();
    }
  },
  30000,
);
