import assert from 'node:assert/strict';
import { randomBytes, randomUUID, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import type { VerifiedOrder } from '@insignia/application';
import { createAdminReadCredentialSource } from '@insignia/application';
import { decodeEnvelope, decodeMember, encodeHeader, wholeQuoteSignBytes } from '@insignia/cart-authorization';
import { createDurableCore, type DurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { createDatabase } from '../../../packages/database/dist/client/database.js';
import { installQueue } from '../../../scripts/database/install-queue.mts';
import { qualifyArtworkRuntimeRole } from '../dist/artwork-role.js';
import { credentialLifecycle } from '../dist/handlers.js';
import { createPurchaseRunner } from '../dist/purchase-runner.js';
import { purchaseFixture } from './support/purchase-role-fixture.mts';

function required<T>(value: T | null | undefined): T {
  assert(value != null);
  return value;
}
function record(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
}
type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T;

test('actual queue-member login reconciles signed initial and renewed offers, paid/refund history, replay and tenant fences', {
  skip: !process.env.M8_RUNTIME_DATABASE_URL,
}, async () => {
  const ownerUrl = process.env.M8_RUNTIME_DATABASE_URL;
  assert(ownerUrl);
  const isolatedUrl = new URL(ownerUrl);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(isolatedUrl.hostname));
  assert.match(isolatedUrl.pathname, /^\/synthetic_m8_runtime[a-z0-9_]*$/);
  const owner = new Pool({ connectionString: ownerUrl });
  const db = createDatabase(new Pool({ connectionString: ownerUrl }));
  const keys = { currentKeyId: 'synthetic-runtime', keys: { 'synthetic-runtime': randomBytes(32) } };
  const seed = createDurableCore(new Pool({ connectionString: ownerUrl }), { credentialKeys: keys });
  const login = `m8_runtime_${randomUUID().replaceAll('-', '')}`;
  const loginPassword = randomBytes(32).toString('hex');
  const inspectorLogin = `m6_inspector_${randomUUID().replaceAll('-', '')}`;
  const inspectorPassword = randomBytes(32).toString('hex');
  let runtime: DurableCore | undefined,
    restricted: Pool | undefined,
    inspector: Pool | undefined,
    inspectionCore: DurableCore | undefined;
  let inspectorCreated = false;
  try {
    assert.equal(
      Math.floor(Number(required(await owner.query('SHOW server_version_num')).rows[0].server_version_num) / 10000),
      18,
    );
    await installQueue(ownerUrl);
    await owner.query(await readFile(new URL('../../../scripts/m5-024/queue-roles.sql', import.meta.url), 'utf8'));
    // Qualification uses a new real session login, inheriting the actual intended capability role.
    await owner.query(
      // CREATE ROLE cannot bind parameters; generated hex contains no SQL quote characters.
      `CREATE ROLE ${login} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD '${loginPassword}'`,
    );
    await owner.query(`GRANT insignia_queue_consume TO ${login}`);
    const url = new URL(ownerUrl);
    url.username = login;
    url.password = loginPassword;
    restricted = new Pool({ connectionString: url.toString() });
    runtime = createDurableCore(new Pool({ connectionString: url.toString() }), { credentialKeys: keys });
    const identity = required(await restricted.query('SELECT session_user,current_user')).rows[0];
    assert.deepEqual(identity, { session_user: login, current_user: login });
    const flags = required(
      await restricted.query(
        'SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname=current_user',
      ),
    ).rows[0];
    assert.deepEqual(flags, {
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false,
      rolcanlogin: true,
    });
    await assert.rejects(restricted.query(`SET ROLE ${isolatedUrl.username}`), /permission denied/);

    const fixture = await purchaseFixture(db);
    const other = await purchaseFixture(db);
    await owner.query("UPDATE installation_generations SET activated_at='2026-09-01T00:00:00Z' WHERE shop_id=$1", [
      fixture.shopId,
    ]);
    await owner.query(
      "INSERT INTO purchase_offer_payloads(shop_id,installation_generation,quote_id,collected_at,expires_at,payload,erased_at) VALUES($1,1,$2,'2026-09-29T11:00:00Z','2026-10-06T11:00:00Z',NULL,'2026-10-06T11:00:00Z')",
      [fixture.shopId, fixture.quote.quoteId],
    );
    await seed.credentials.install({
      shopId: fixture.shopId,
      installationGeneration: '1',
      pair: {
        accessToken: 'owned-local-access',
        refreshToken: 'owned-local-refresh',
        accessExpiresAt: new Date(Date.now() + 3600000),
        refreshExpiresAt: new Date(Date.now() + 7200000),
        scopes: 'read_orders',
      },
    });
    assert.equal(
      required(
        await required(runtime).credentials.acquire({
          shopId: fixture.shopId,
          installationGeneration: '1',
          minimumRemainingMs: 1000,
          claimLeaseMs: 10000,
        }),
      ).kind,
      'usable',
    );

    const collectedAt = new Date(Date.now() - 86400000),
      expiresAt = new Date(Date.now() + 604800000);
    const request = {
      shopId: other.shopId,
      installationGeneration: '1',
      country: 'US',
      marketId: '42',
      idempotencyKey: 'retained-runtime',
      groups: [{ group: other.group }],
      capacity: { ordinaryLineCount: 0, inputBytes: 1 },
    };
    await owner.query(
      'INSERT INTO purchase_offer_payloads(shop_id,installation_generation,quote_id,collected_at,expires_at,payload) VALUES($1,1,$2,$3,$4,$5)',
      [other.shopId, other.quote.quoteId, collectedAt, expiresAt, request],
    );
    const geometry = {
      version: 'm5-geometry-v1',
      views: [
        {
          id: 'front',
          variantImages: [],
          placements: [{ id: 'front', rect: { centerX: 0.5, centerY: 0.5, width: 0.3, height: 0.3 } }],
        },
      ],
      steps: [{ id: 'step', widthFraction: 0.5, heightFraction: 0.5 }],
    };
    const presentation = {
      version: 'm5-presentation-v1',
      labels: { methods: { method: 'Method' }, placements: { front: 'Front' }, steps: { step: 'Step' } },
    };
    await owner.query(
      "INSERT INTO config_revision_geometry(shop_id,config_id,revision_id,schema_version,mode,geometry_value,content_hash) VALUES($1,$2,$3,'m5-geometry-v1','optional',$4,$5)",
      [other.shopId, other.configId, other.revisionId, geometry, 'b'.repeat(64)],
    );
    await owner.query(
      "INSERT INTO config_revision_presentation(shop_id,config_id,revision_id,schema_version,presentation_value,content_hash) VALUES($1,$2,$3,'m5-presentation-v1',$4,$5)",
      [other.shopId, other.configId, other.revisionId, presentation, 'c'.repeat(64)],
    );
    let providerRefreshes = 0;
    const credentials = createAdminReadCredentialSource({
      tenants: required(runtime).tenants,
      credentials: credentialLifecycle(runtime),
      refresh: {
        async refresh(input) {
          assert.equal(input.shopDomain, `${fixture.shopId}.myshopify.com`);
          providerRefreshes++;
          return {
            schemaVersion: 'm3-offline-credential-v1',
            accessToken: 'owned-local-composed-access',
            refreshToken: 'owned-local-composed-refresh',
            accessExpiresAt: new Date(Date.now() + 3600000),
            refreshExpiresAt: new Date(Date.now() + 7200000),
            scopes: 'read_orders',
          };
        },
      },
    });
    const order: Mutable<VerifiedOrder> = {
      shopId: fixture.shopId,
      installationGeneration: '1',
      orderId: 'gid://shopify/Order/901',
      createdAt: '2026-09-29T13:00:00.000Z',
      updatedAt: '2026-09-29T13:00:00.000Z',
      observedAt: '2026-10-13T12:00:00.000Z',
      currency: 'USD',
      country: 'US',
      marketId: '42',
      contextVerified: true,
      test: true,
      totalPriceMinor: '2001',
      sourceApiVersion: '2026-07',
      complete: true,
      edited: false,
      financialStatus: 'PAID',
      cancelledAt: null,
      lines: fixture.quote.economics.lines.map((line) => ({
        lineId: `gid://shopify/LineItem/${55 + line.lineIndex}`,
        productId: '101',
        variantId: line.variantId,
        quantity: 1,
        currentQuantity: 1,
        originalUnitPriceMinor: line.unitPriceMinor,
        sellingPlanId: null,
        attributes: [
          { key: '_insignia_quote_v2', value: fixture.authorization.envelopeCarrier },
          { key: '_insignia_member_v2', value: required(fixture.authorization.members[line.lineIndex]).carrier },
        ],
      })),
      transactions: [
        {
          transactionId: 'gid://shopify/OrderTransaction/1',
          kind: 'SALE',
          status: 'SUCCESS',
          occurredAt: '2026-09-29T13:01:00.000Z',
          currency: 'USD',
          amountMinor: '2001',
        },
      ],
      refunds: [],
    };
    let checkoutReady = true;
    const runner = createPurchaseRunner({
      core: runtime,
      // Explicit local admission double: real broker/provider qualification is not asserted.
      checkout: {
        admit: async ({ order: observed }) =>
          checkoutReady && observed.checkoutOrigin?.creatorAppId === 'gid://shopify/App/77'
            ? { creatorAppId: 'gid://shopify/App/77', enforcementObservedAt: observed.observedAt }
            : null,
      },
      orders: {
        async read(target) {
          assert.equal(target.shopId, fixture.shopId);
          const acquired = await credentials.acquire(target);
          assert.equal(acquired.kind, 'usable');
          assert.equal(acquired.shopDomain, `${fixture.shopId}.myshopify.com`);
          assert.equal(required(await required(runtime).credentials.metadata(target)).scopes, 'read_orders');
          const unknownContext = ['/904', '/905'].some((suffix) => target.orderId.endsWith(suffix));
          return {
            ...order,
            orderId: target.orderId,
            ...(unknownContext
              ? {
                  country: null,
                  marketId: null,
                  contextVerified: false,
                  checkoutOrigin: {
                    creatorAppId: 'gid://shopify/App/77',
                    sourceName: 'web',
                    checkoutTokenDigest: 'a'.repeat(64),
                  },
                }
              : {}),
          };
        },
      },
    });
    async function deliver(id = '901') {
      const receipt = await seed.webhooks.receive({
        shopDomain: `${fixture.shopId}.myshopify.com`,
        topic: 'orders/paid',
        apiVersion: '2026-07',
        deliveryId: randomUUID(),
        triggeredAt: new Date(),
        eventId: null,
        name: null,
        rawBody: Buffer.from(
          JSON.stringify({ id, admin_graphql_api_id: `gid://shopify/Order/${id}`, total_price: '0.01' }),
        ),
      });
      await seed.webhooks.withQueueHandoff(receipt.id, async () => 'enqueued');
      return receipt.id;
    }
    const receipt = await deliver();
    await assert.rejects(
      restricted.query('SELECT trusted_record FROM public.trusted_release_records LIMIT 1'),
      /permission denied/,
    );
    // Missing M8 grants must fail at the real runtime seam (the baseline RED).
    if (!process.env.M8_RUNTIME_EXPECT_RED) {
      const grants = await Promise.all(
        ['m6-artwork', 'm7-storefront', 'm8-purchase'].map((name) =>
          readFile(new URL(`../../../scripts/${name}/runtime-grants.sql`, import.meta.url), 'utf8'),
        ),
      );
      // Actual sequential application must preserve both independently scoped capabilities.
      // Reconcile legacy M6 table and column privileges explicitly, never hide them.
      await owner.query('GRANT SELECT ON artwork_assets TO insignia_queue_consume');
      await owner.query('GRANT SELECT(original_key), UPDATE(expires_at) ON artwork_assets TO insignia_queue_consume');
      for (const script of grants) await owner.query(script);
      for (const script of [required(grants[2]), required(grants[0]), required(grants[1]), required(grants[2])])
        await owner.query(script);
      assert.deepEqual(
        required(await restricted.query('SELECT trusted_record FROM public.trusted_release_records LIMIT 1')).rows,
        [],
      );
      for (const query of [
        'INSERT INTO trusted_release_records DEFAULT VALUES',
        'UPDATE trusted_release_records SET trusted_record=trusted_record',
        'DELETE FROM trusted_release_records',
        'TRUNCATE trusted_release_records',
      ])
        await assert.rejects(restricted.query(query), /permission denied/);
      for (const table of ['signing_keys', 'buyer_sessions']) {
        const grant = table === 'signing_keys' ? 'SELECT(private_envelope)' : 'SELECT';
        await owner.query(`GRANT ${grant} ON ${table} TO insignia_artwork_inspect`);
        await assert.rejects(owner.query(required(grants[0])), /unqualified_artwork_private_access/);
        await owner.query('ROLLBACK');
        await owner.query(`REVOKE ${grant} ON ${table} FROM insignia_artwork_inspect`);
      }
      await owner.query(
        'GRANT EXECUTE ON FUNCTION public.cleanup_purchase_payloads(integer) TO insignia_artwork_inspect',
      );
      await assert.rejects(owner.query(required(grants[0])), /unqualified_artwork_private_access/);
      await owner.query('ROLLBACK');
      await owner.query(
        'REVOKE EXECUTE ON FUNCTION public.cleanup_purchase_payloads(integer) FROM insignia_artwork_inspect',
      );
      await owner.query('GRANT DELETE ON shops TO insignia_artwork_inspect');
      await owner.query('GRANT UPDATE(generation) ON installation_generations TO insignia_artwork_inspect');
      await owner.query(required(grants[0]));
      assert.equal(
        required(await owner.query("SELECT has_table_privilege('insignia_artwork_inspect','shops','DELETE') AS bad"))
          .rows[0].bad,
        false,
      );
      assert.equal(
        required(
          await owner.query(
            "SELECT has_column_privilege('insignia_artwork_inspect','installation_generations','generation','UPDATE') AS bad",
          ),
        ).rows[0].bad,
        false,
      );
      assert.equal(
        required(
          await restricted.query(
            "SELECT has_column_privilege(current_user,'artwork_assets','original_key','SELECT') AS original",
          ),
        ).rows[0].original,
        false,
      );
      await assert.rejects(restricted.query('SELECT original_key FROM artwork_assets LIMIT 1'), /permission denied/);
      assert.equal(
        required(
          await owner.query(
            "SELECT pg_has_role('insignia_queue_consume','insignia_artwork_inspect','MEMBER') AS inspection",
          ),
        ).rows[0].inspection,
        false,
      );
      await owner.query(
        `CREATE ROLE ${inspectorLogin} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD '${inspectorPassword}'`,
      );
      inspectorCreated = true;
      await owner.query(`GRANT insignia_artwork_inspect TO ${inspectorLogin}`);
      const inspectorUrl = new URL(ownerUrl);
      inspectorUrl.username = inspectorLogin;
      inspectorUrl.password = inspectorPassword;
      inspector = new Pool({ connectionString: inspectorUrl.toString() });
      inspectionCore = createDurableCore(new Pool({ connectionString: inspectorUrl.toString() }));
      assert.deepEqual(required(await inspector.query('SELECT session_user,current_user')).rows[0], {
        session_user: inspectorLogin,
        current_user: inspectorLogin,
      });
      await qualifyArtworkRuntimeRole(inspector);
      for (const grant of [
        'EXECUTE ON FUNCTION public.cleanup_purchase_payloads(integer)',
        'EXECUTE ON FUNCTION public.read_purchase_offer_history(text,bigint,uuid,uuid)',
        'UPDATE(original_key) ON artwork_assets',
        'INSERT ON artwork_assets',
        'DELETE ON artwork_assets',
        'DELETE ON shops',
        'UPDATE(generation) ON installation_generations',
      ]) {
        await owner.query(`GRANT ${grant} TO ${inspectorLogin}`);
        await assert.rejects(qualifyArtworkRuntimeRole(inspector), /Inspection database role unavailable/);
        await owner.query(`REVOKE ${grant} FROM ${inspectorLogin}`);
      }
      const extraRole = `m6_extra_${randomUUID().replaceAll('-', '')}`;
      await owner.query(`CREATE ROLE ${extraRole} NOLOGIN`);
      try {
        await owner.query(`GRANT ${extraRole} TO ${inspectorLogin}`);
        await assert.rejects(qualifyArtworkRuntimeRole(inspector), /Inspection database role unavailable/);
        await owner.query(`REVOKE ${extraRole} FROM ${inspectorLogin}`);
        await owner.query(`GRANT ${extraRole} TO insignia_artwork_inspect`);
        await assert.rejects(qualifyArtworkRuntimeRole(inspector), /Inspection database role unavailable/);
        await owner.query(`REVOKE ${extraRole} FROM insignia_artwork_inspect`);
        await owner.query(`GRANT insignia_artwork_inspect TO ${inspectorLogin} WITH ADMIN OPTION`);
        await assert.rejects(qualifyArtworkRuntimeRole(inspector), /Inspection database role unavailable/);
        await owner.query(`REVOKE ADMIN OPTION FOR insignia_artwork_inspect FROM ${inspectorLogin}`);
      } finally {
        await owner.query(`DROP ROLE ${extraRole}`);
      }
      await owner.query('ALTER ROLE insignia_artwork_inspect CREATEROLE');
      await assert.rejects(qualifyArtworkRuntimeRole(inspector), /Inspection database role unavailable/);
      await owner.query('ALTER ROLE insignia_artwork_inspect NOCREATEROLE');
      await owner.query('REVOKE UPDATE(state) ON artwork_assets FROM insignia_artwork_inspect');
      await assert.rejects(qualifyArtworkRuntimeRole(inspector), /Inspection database role unavailable/);
      await owner.query(required(grants[0]));
      await qualifyArtworkRuntimeRole(inspector);
      await assert.rejects(inspector.query('SET ROLE insignia_queue_consume'), /permission denied/);
      await inspector.query('SELECT original_key FROM artwork_assets LIMIT 1');
      for (const sql of [
        'SELECT private_envelope FROM signing_keys LIMIT 1',
        'SELECT * FROM buyer_sessions LIMIT 1',
        'SELECT * FROM shop_credentials LIMIT 1',
        'DELETE FROM purchase_orders',
        'DELETE FROM artwork_assets',
      ])
        await assert.rejects(inspector.query(sql), /permission denied/);
      await qualifyInspectionLifecycle(seed, inspectionCore, inspector, other.shopId);
      await qualifyMerchantPreviewProfile(owner, inspector, inspectorLogin);
    }
    const retained = required(
      await required(runtime).purchases.getOffer({
        shopId: other.shopId,
        installationGeneration: '1',
        quoteId: other.quote.quoteId,
        authorizationSetId: other.authorization.setId,
      }),
    );
    const payload = record(retained.designPayload);
    const groups = record(payload.request).groups;
    assert(Array.isArray(groups));
    assert.deepEqual(record(record(groups[0]).group).design, other.group.design);
    const revisions = payload.revisions;
    assert(Array.isArray(revisions));
    assert.equal(record(revisions[0]).revisionId, other.revisionId);
    assert.equal(retained.payloadExpiresAt, expiresAt.toISOString());
    assert.equal(
      required(
        await restricted.query('SELECT * FROM public.read_purchase_revision_history($1,1,$2,$3,$4,$5)', [
          fixture.shopId,
          fixture.quote.quoteId,
          fixture.authorization.setId,
          other.revisionId,
          other.contentHash,
        ]),
      ).rowCount,
      0,
    );
    await runner.processInbox(receipt);
    const scope = { shopId: fixture.shopId, installationGeneration: '1', kind: 'merchant' as const };
    const first = required((await required(runtime).purchases.list(scope))[0]);
    assert.equal(first.bindings.length, 1);
    assert.equal(first.isTest, true);
    assert.equal(first.originalTotalMinor, '2001');
    assert.equal(first.firstPaidAt, '2026-09-29T13:01:00.000Z');
    assert.equal(required(first.bindings[0]).designPayload, null);
    assert.equal(required(await required(runtime).webhooks.getById(receipt)).state, 'processed');
    assert.equal(await runner.processInbox(receipt), 'deferred');
    assert.equal(await required(runtime).purchases.get({ ...scope, shopId: other.shopId }, first.purchaseId), null);
    assert.equal(
      await required(runtime).purchases.getOffer({
        shopId: other.shopId,
        installationGeneration: '1',
        quoteId: fixture.quote.quoteId,
        authorizationSetId: fixture.authorization.setId,
      }),
      null,
    );

    order.refunds = [
      {
        refundId: 'gid://shopify/Refund/77',
        occurredAt: '2026-09-29T14:00:00.000Z',
        currency: 'USD',
        amountMinor: '1000',
        lines: [],
      },
    ];
    order.updatedAt = '2026-09-29T14:00:00.000Z';
    order.lines.reverse();
    await runner.processInbox(await deliver());
    order.refunds = [];
    order.updatedAt = '2026-09-29T13:00:00.000Z';
    await runner.processInbox(await deliver());
    const stable = required(await required(runtime).purchases.get(scope, first.purchaseId));
    assert.equal(stable.firstPaidAt, first.firstPaidAt);
    assert.equal(stable.bindings.length, 1);
    assert.equal(required(stable.refunds[0]).amountMinor, '1000');
    await runner.processInbox(await deliver('902'));
    const replay = required((await required(runtime).purchases.list(scope)).find((p) => p?.orderId.endsWith('/902')));
    assert.equal(replay.bindings.length, 1);
    assert.equal(replay.firstPaidAt, first.firstPaidAt);

    await runner.processInbox(await deliver('904'));
    const matched = required((await required(runtime).purchases.list(scope)).find((p) => p?.orderId.endsWith('/904')));
    assert.equal(matched.bindings.length, 1);
    assert.equal(matched.firstPaidAt, first.firstPaidAt);
    assert.deepEqual(record(required(required(matched.bindings[0])).economics).purchaseEvidence, {
      kind: 'signed_offer_order_match',
      creatorAppId: 'gid://shopify/App/77',
      checkoutTokenDigest: 'a'.repeat(64),
      enforcementObservedAt: order.observedAt,
      checkoutContext: null,
    });
    assert.equal(record(required(required(matched.bindings[0])).economics).version, 'm8-purchase-economics-v2');
    assert.equal(record(required(required(matched.bindings[0])).economics).contextSource, 'authorized_quote');
    // Later enforcement refusal records an exception, never rewrites already bound evidence.
    checkoutReady = false;
    await runner.processInbox(await deliver('904'));
    const retainedProof = required(await required(runtime).purchases.get(scope, matched.purchaseId));
    assert.deepEqual(required(retainedProof.bindings[0]).economics, required(matched.bindings[0]).economics);
    await runner.processInbox(await deliver('905'));
    const denied = required((await required(runtime).purchases.list(scope)).find((p) => p?.orderId.endsWith('/905')));
    assert.equal(denied.bindings.length, 0);
    assert.equal(required(denied.observations.at(-1)).exception, 'CHECKOUT_ENFORCEMENT_UNVERIFIED');
    checkoutReady = true;

    // A renewed signature is verified against its own issuance day, preserving original quote/retention.
    const renewedSet = randomUUID(),
      issuedDay = fixture.quote.acceptedDay + 1;
    const header = {
      ...decodeEnvelope(fixture.authorization.envelopeCarrier).header,
      setHex: renewedSet.replaceAll('-', ''),
      validThroughDay: issuedDay + 2,
    };
    const members = fixture.authorization.members.map((member) =>
      decodeMember(Buffer.from(member.carrier, 'base64url')),
    );
    const renewedEnvelope = Buffer.concat([
      encodeHeader(header),
      sign(null, wholeQuoteSignBytes(header, members), fixture.keys.privateKey),
    ]).toString('base64url');
    await owner.query("INSERT INTO buyer_quote_ownership VALUES($1,1,$2,$3,$4,$4,'2026-09-29T12:00:00Z')", [
      fixture.shopId,
      fixture.quote.quoteId,
      randomUUID(),
      'a'.repeat(64),
    ]);
    const renewalClient = await owner.connect();
    try {
      await renewalClient.query('BEGIN');
      await renewalClient.query(
        "INSERT INTO quote_authorization_renewals(set_id,quote_id,shop_id,installation_generation,owner_binding,idempotency_key,request_digest,material_hash,issued_at,issued_date,issued_day,shop_timezone,valid_through_day) VALUES($1,$2,$3,1,$4,'renewed-runtime',$4,$4,'2026-09-30T12:00:00Z','2026-09-30',$5,'America/New_York',$6)",
        [renewedSet, fixture.quote.quoteId, fixture.shopId, 'a'.repeat(64), issuedDay, issuedDay + 2],
      );
      await renewalClient.query(
        'INSERT INTO quote_authorization_sets(set_id,quote_id,shop_id,installation_generation,authorization_generation,authorization_epoch,key_id,public_key_fingerprint,first_valid_day,last_valid_day,valid_through_day,envelope_carrier,member_carriers) SELECT $1,quote_id,shop_id,installation_generation,authorization_generation,authorization_epoch,key_id,public_key_fingerprint,first_valid_day,last_valid_day,$2,$3,member_carriers FROM quote_authorization_sets WHERE set_id=$4',
        [renewedSet, issuedDay + 2, renewedEnvelope, fixture.authorization.setId],
      );
      await renewalClient.query('COMMIT');
    } finally {
      await renewalClient.query('ROLLBACK');
      renewalClient.release();
    }
    order.test = false;
    order.createdAt = '2026-09-30T13:00:00.000Z';
    order.updatedAt = order.createdAt;
    required(order.transactions[0]).occurredAt = '2026-09-30T13:01:00.000Z';
    order.lines.forEach((line) => {
      required(line.attributes[0]).value = renewedEnvelope;
    });
    await runner.processInbox(await deliver('903'));
    const renewed = required((await required(runtime).purchases.list(scope)).find((p) => p?.orderId.endsWith('/903')));
    assert.equal(renewed.isTest, false);
    assert.equal(required(renewed.bindings[0]).authorizationSetId, renewedSet);
    assert.equal(renewed.firstPaidAt, '2026-09-30T13:01:00.000Z');
    assert.equal(required(renewed.bindings[0]).payloadExpiresAt, '2026-10-06T11:00:00.000Z');
    // Existing M3 refresh permissions remain real runtime capability, with synthetic encrypted credentials.
    await owner.query(
      "UPDATE shop_credentials SET access_expires_at=clock_timestamp()-interval '1 second' WHERE shop_id=$1",
      [fixture.shopId],
    );
    const refresh = await required(runtime).credentials.acquire({
      shopId: fixture.shopId,
      installationGeneration: '1',
      minimumRemainingMs: 1000,
      claimLeaseMs: 10000,
    });
    assert.equal(refresh.kind, 'claimed');
    assert.equal(
      await required(runtime).credentials.replaceClaim({
        shopId: fixture.shopId,
        installationGeneration: '1',
        claimId: refresh.claimId,
        credentialVersion: refresh.credentialVersion,
        pair: {
          accessToken: 'owned-local-replaced',
          refreshToken: 'owned-local-next-refresh',
          accessExpiresAt: new Date(Date.now() + 3600000),
          refreshExpiresAt: new Date(Date.now() + 7200000),
          scopes: 'read_orders',
        },
      }),
      'replaced',
    );
    await owner.query(
      "UPDATE shop_credentials SET access_expires_at=clock_timestamp()-interval '1 second' WHERE shop_id=$1",
      [fixture.shopId],
    );
    assert.equal(required(await credentials.acquire(scope)).kind, 'usable');
    assert.equal(providerRefreshes, 1);
    const claim = required(
      (await required(runtime).purchases.claimPurchaseDiscovery(20)).find((c) => c.shopId === fixture.shopId),
    );
    assert.equal(claim.shopId, fixture.shopId);
    await required(runtime).purchases.completePurchaseDiscovery({ ...claim, nextCursor: 'owned-local-next-page' });
    const nextPage = required(
      (await required(runtime).purchases.claimPurchaseDiscovery(20)).find((c) => c.shopId === fixture.shopId),
    );
    assert.equal(nextPage.cursor, 'owned-local-next-page');
    await required(runtime).purchases.failPurchaseDiscovery(nextPage);
    assert.equal(await required(runtime).purchases.cleanupDue(1), 0);
    for (const query of [
      'SELECT private_envelope FROM signing_keys',
      'SELECT * FROM buyer_sessions',
      'SELECT quote_value FROM accepted_quotes',
      'SELECT payload FROM purchase_offer_payloads',
      'SELECT owner_binding FROM buyer_quote_ownership',
      'SELECT * FROM quote_proposals',
      'SELECT original_key FROM artwork_assets',
      'UPDATE purchase_paid_facts SET occurred_at=clock_timestamp()',
      'DELETE FROM purchase_orders',
      'INSERT INTO purchase_artwork_events DEFAULT VALUES',
      'UPDATE purchase_design_payloads SET payload=NULL',
      'UPDATE shops SET current_generation=2',
      'CREATE TABLE forbidden_runtime_table(id integer)',
    ]) {
      await assert.rejects(restricted.query(query), /permission denied/);
    }
    await owner.query('UPDATE installation_generations SET deactivated_at=clock_timestamp() WHERE shop_id=$1', [
      fixture.shopId,
    ]);
    await assert.rejects(required(runtime).purchases.list(scope), /NOT_FOUND/);
    assert.equal(required(await credentials.acquire(scope)).kind, 'inactive');
    assert.equal(
      await required(runtime)
        .purchases.getOffer({
          ...scope,
          quoteId: fixture.quote.quoteId,
          authorizationSetId: fixture.authorization.setId,
        })
        .catch((e) => e.message),
      'NOT_FOUND',
    );
  } finally {
    await inspectionCore?.close();
    await inspector?.end();
    await runtime?.close();
    await restricted?.end();
    await seed.close();
    await db.destroy();
    if (inspectorCreated) {
      await owner.query(`DROP OWNED BY ${inspectorLogin}`);
      await owner.query(`DROP ROLE IF EXISTS ${inspectorLogin}`);
    }
    await owner.query(`DROP OWNED BY ${login}`);
    await owner.query(`DROP ROLE IF EXISTS ${login}`);
    await owner.end();
  }
});

async function qualifyInspectionLifecycle(
  owner: DurableCore,
  inspection: DurableCore,
  restricted: Pool,
  shopId: string,
) {
  const assetId = randomUUID(),
    now = new Date(),
    claimId = randomUUID();
  const record: Parameters<DurableCore['artwork']['create']>[0] = {
    assetId,
    shopId,
    installationGeneration: '1',
    ownerHash: 'a'.repeat(64),
    declaredMime: 'image/png',
    declaredBytes: 10,
    state: 'UPLOADING' as const,
    quarantineKey: `quarantine/${assetId}`,
    originalKey: `originals/${assetId}`,
    previewKey: `previews/${assetId}`,
    collectedAt: now,
    uploadUntil: new Date(+now + 60000),
    expiresAt: new Date(+now + 604800000),
    claimId: null,
    manifest: null,
    rejection: null,
  };
  const scope = { shopId, installationGeneration: '1', kind: 'merchant' as const };
  await owner.artwork.create(record);
  await owner.artwork.complete(scope, assetId, now);
  assert.ok(required(await inspection.artwork.selectPending(100, now)).includes(assetId));
  assert.equal(
    required(await inspection.artwork.claim(assetId, claimId, now, new Date(+now + 60000))).state,
    'INSPECTING',
  );
  await inspection.artwork.prepare(
    assetId,
    claimId,
    {
      version: 'm6-inspection-v1',
      mimeType: 'image/png',
      byteLength: 10,
      sha256: 'c'.repeat(64),
      width: 2,
      height: 2,
      previewSha256: 'd'.repeat(64),
      previewByteLength: 15,
    },
    now,
  );
  assert.equal(await inspection.artwork.settle(assetId, claimId, now), true);
  assert.equal(required(await inspection.artwork.get(scope, assetId)).originalKey, record.originalKey);
  assert.ok(
    required(await inspection.artwork.selectQuarantineCleanup(100, record.uploadUntil)).some(
      (row) => row.assetId === assetId,
    ),
  );
  assert.equal(await inspection.artwork.markQuarantineCleanupAttempt(assetId, record.uploadUntil), true);
  await inspection.artwork.markQuarantineCleaned(assetId, record.uploadUntil);
  assert.ok(
    required(await inspection.artwork.selectExpired(100, record.expiresAt)).some((row) => row.assetId === assetId),
  );
  assert.equal(required(await inspection.artwork.markDeleting(assetId, record.expiresAt)).state, 'DELETING');
  await inspection.artwork.finishDeleting(assetId, record.expiresAt);
  assert.equal(required(await inspection.artwork.get(scope, assetId)).state, 'DELETED');
  for (const sql of [
    "UPDATE artwork_assets SET expires_at=expires_at+interval '1 day' WHERE asset_id=$1",
    'UPDATE artwork_assets SET original_key=original_key WHERE asset_id=$1',
    'UPDATE artwork_assets SET shop_id=shop_id WHERE asset_id=$1',
  ])
    await assert.rejects(restricted.query(sql, [assetId]), /permission denied/);
  await assert.rejects(inspection.artwork.create({ ...record, assetId: randomUUID() }), /permission denied/);
}

async function qualifyMerchantPreviewProfile(owner: Pool, inspector: Pool, login: string) {
  const profile = { merchantPreviews: true };
  await assert.rejects(qualifyArtworkRuntimeRole(inspector, profile), /Inspection database role unavailable/);
  await owner.query(
    'GRANT SELECT ON merchant_preview_assets,config_revision_preview_assets TO insignia_artwork_inspect',
  );
  await owner.query('GRANT UPDATE(state,manifest,updated_at) ON merchant_preview_assets TO insignia_artwork_inspect');
  try {
    await qualifyArtworkRuntimeRole(inspector, profile);
    await assert.rejects(qualifyArtworkRuntimeRole(inspector), /Inspection database role unavailable/);
    for (const grant of [
      'MAINTAIN ON merchant_preview_assets',
      'MAINTAIN ON shop_credentials',
      'INSERT ON merchant_preview_assets',
      'DELETE ON merchant_preview_assets',
      'UPDATE(original_key) ON merchant_preview_assets',
      'UPDATE(abandon_at) ON merchant_preview_assets',
      'UPDATE(claim_id) ON merchant_preview_assets',
      'INSERT ON config_revision_preview_assets',
      'UPDATE(asset_id) ON config_revision_preview_assets',
    ]) {
      await owner.query(`GRANT ${grant} TO ${login}`);
      await assert.rejects(qualifyArtworkRuntimeRole(inspector, profile), /Inspection database role unavailable/);
      await owner.query(`REVOKE ${grant} FROM ${login}`);
    }
    await owner.query('REVOKE UPDATE(manifest) ON merchant_preview_assets FROM insignia_artwork_inspect');
    await assert.rejects(qualifyArtworkRuntimeRole(inspector, profile), /Inspection database role unavailable/);
    await owner.query('GRANT UPDATE(manifest) ON merchant_preview_assets TO insignia_artwork_inspect');
    await qualifyArtworkRuntimeRole(inspector, profile);
    await inspector.query('SELECT original_key FROM merchant_preview_assets LIMIT 1');
    await assert.rejects(inspector.query('DELETE FROM merchant_preview_assets'), /permission denied/);
    await assert.rejects(
      inspector.query('UPDATE merchant_preview_assets SET original_key=original_key'),
      /permission denied/,
    );
  } finally {
    await owner.query(
      'REVOKE SELECT ON merchant_preview_assets,config_revision_preview_assets FROM insignia_artwork_inspect',
    );
    await owner.query(
      'REVOKE UPDATE(state,manifest,updated_at) ON merchant_preview_assets FROM insignia_artwork_inspect',
    );
  }
  await qualifyArtworkRuntimeRole(inspector);
}
