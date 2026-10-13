import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
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
    if (
      address.hostname !== '127.0.0.1' ||
      address.port !== '58199' ||
      address.username !== 'synthetic_m8_owner' ||
      address.pathname !== '/postgres'
    )
      throw new Error('Allocated synthetic PostgreSQL qualification required');
    const suffix = randomUUID().replaceAll('-', '');
    const name = `synthetic_web_acl_${suffix}`,
      login = `synthetic_web_${suffix}`,
      queue = `synthetic_queue_${suffix}`,
      inspector = `synthetic_inspect_${suffix}`,
      extra = `synthetic_extra_${suffix}`,
      worker = `synthetic_purchase_${suffix}`;
    const admin = new Pool({ connectionString: address.href, max: 1 });
    const target = new URL(address);
    target.pathname = `/${name}`;
    let owner: Pool | undefined, web: Pool | undefined, purchaseWorker: Pool | undefined;
    let ownerDb: ReturnType<typeof createDatabase> | undefined;
    let created = false;
    try {
      expect(Number((await admin.query('show server_version_num')).rows[0].server_version_num)).toBeGreaterThanOrEqual(
        180000,
      );
      await admin.query(`CREATE DATABASE ${name}`);
      created = true;
      owner = new Pool({ connectionString: target.href });
      await owner.query(
        `CREATE ROLE ${login} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; CREATE ROLE ${queue} NOLOGIN; CREATE ROLE ${extra} NOLOGIN`,
      );
      const migrations = new URL('../migrations/', import.meta.url);
      const names = (await readdir(migrations)).filter((n) => n.endsWith('.sql')).sort();
      expect(names).toHaveLength(31);
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
      webAddress.password = '';
      web = new Pool({ connectionString: webAddress.href });
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
      ).replaceAll('insignia_runtime', login);
      await owner.query(script);
      await owner.query(script); // Reapplication must retain the same bounded authority.
      expect((await web.query('SELECT current_user')).rows[0].current_user).toBe(login);
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
      await owner.query(
        `CREATE ROLE ${worker} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; GRANT ${queue} TO ${worker}`,
      );
      const workerAddress = new URL(target);
      workerAddress.username = worker;
      workerAddress.password = '';
      purchaseWorker = new Pool({ connectionString: workerAddress.href });
      for (const query of [
        'SELECT original_key FROM artwork_assets',
        'SELECT * FROM buyer_sessions',
        'SELECT private_envelope FROM signing_keys',
      ])
        await expect(purchaseWorker.query(query)).rejects.toMatchObject({ code: '42501' });
      await owner.query(script);
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
      await purchaseWorker?.end();
      await web?.end();
      if (ownerDb) await ownerDb.destroy();
      else await owner?.end();
      if (created) await admin.query(`DROP DATABASE ${name}`);
      for (const role of [worker, login, queue, inspector, extra]) await admin.query(`DROP ROLE IF EXISTS ${role}`);
      await admin.end();
    }
  },
  30000,
);
