import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { Pool } from 'pg';
import { createDatabase } from '../client/database.js';
import { sha256CanonicalJson } from '../hash/canonical.js';
import { createTenantRepository } from './tenant.js';

const SHOP = 'stitchs-vat-verification-20261004.myshopify.com';
export type OwnerLifecycleDecision = {
  version: 'm5-owner-lifecycle-v1';
  decisionId: string;
  appClientId: string;
  providerShopId: string;
  shopId: string | null;
  shopDomain: string;
  installationGeneration: string | null;
  externalInstallationId: string | null;
  operation: 'OWNER_DEACTIVATION' | 'OWNER_RECEIPT_ERASURE';
  authority: { kind: 'EXPLICIT_OWNER_REQUEST'; requestEvidenceSha256: string };
  native: {
    kind: 'OWNER_NATIVE_ATTESTATION';
    evidenceSha256: string;
    preInstallationInventorySha256: string;
    destinationEffectsQualification: 'PASS_BOUND_ALLOCATED_STORE';
    exactAppShopBound: true;
    currentStatus: 'PRESENT' | 'ABSENT';
    currentExternalInstallationId: string | null;
    observedAt: string;
    noReinstallUntil?: string;
    coordination?: 'OWNER_HOLDS_NO_REINSTALL_WINDOW';
  };
  privacy?: {
    cutoff: string;
    sinks: {
      database: 'QUALIFIED';
      queue: 'QUALIFIED';
      privateCopies: 'ERASED';
      backups: 'RESTORE_EXCLUSION_QUALIFIED';
    };
    receipts: { id: string; bodySha256: string; collectedAt: string }[];
  };
};
export type OwnerLifecycleResult = {
  outcome: 'OWNER_DEACTIVATED' | 'OWNER_ALREADY_INACTIVE' | 'OWNER_NO_DURABLE_INSTALLATION' | 'OWNER_RECEIPTS_ERASED';
  erasedIds?: string[];
  restoreExclusions?: { id: string; bodySha256: string; collectedAt: string }[];
  receiptDispositionOnly?: true;
  fulfillBy?: string;
  completedLate?: boolean;
};
const hex = (x: unknown) => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
function requiredText(value: unknown): string {
  assert.equal(typeof value, 'string', 'required_string');
  return value as string;
}
const uuid = (x: unknown) =>
  typeof x === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
function instant(value: string) {
  const d = new Date(value);
  assert.ok(
    Number.isFinite(d.getTime()) &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{3})?Z$/.test(value) &&
      d.toISOString() === value.replace(/(\.\d{3})\d{3}Z$/, '$1Z'),
    'exact_utc_instant_required',
  );
  return d;
}
/** Privileged manual owner authority only. This never promotes a webhook into authority.
 * Native evidence and the no-reinstall window remain externally qualified obligations.
 * It deliberately does not claim unattended uninstall or full shop/customer redaction. */
export async function applyOwnerLifecycleDecision(
  pool: Pool,
  decision: OwnerLifecycleDecision,
): Promise<OwnerLifecycleResult> {
  assert.equal(decision.version, 'm5-owner-lifecycle-v1');
  assert.ok(uuid(decision.decisionId));
  // The owner-only private dispatch separately pins the approved exact app.
  // This library never derives app authority from a browser or webhook.
  assert.match(decision.appClientId, /^[a-f0-9]{32}$/);
  assert.equal(decision.shopDomain, SHOP, 'allocated_shop_only');
  assert.match(decision.providerShopId, /^[1-9][0-9]{0,19}$/);
  if (decision.shopId === null) {
    assert.equal(decision.installationGeneration, null);
    assert.equal(decision.externalInstallationId, null);
  } else {
    assert.match(requiredText(decision.installationGeneration), /^[1-9][0-9]*$/);
    assert.match(requiredText(decision.externalInstallationId), /^gid:\/\/shopify\/AppInstallation\/[1-9][0-9]*$/);
  }
  assert.equal(decision.authority.kind, 'EXPLICIT_OWNER_REQUEST');
  assert.ok(hex(decision.authority.requestEvidenceSha256));
  assert.equal(decision.native.kind, 'OWNER_NATIVE_ATTESTATION');
  assert.equal(decision.native.exactAppShopBound, true);
  assert.ok(hex(decision.native.evidenceSha256));
  assert.ok(hex(decision.native.preInstallationInventorySha256));
  assert.equal(
    decision.native.destinationEffectsQualification,
    'PASS_BOUND_ALLOCATED_STORE',
    'native_destination_effects_unqualified',
  );
  const digest = sha256CanonicalJson(decision);
  const database = createDatabase(pool);
  return database.transaction().execute(async (tx) => {
    const auth = (
      await sql<{
        role: string;
        owner: string;
        now: Date;
      }>`select current_user as role,pg_get_userbyid(datdba) as owner,clock_timestamp() as now from pg_database where datname=current_database()`.execute(
        tx,
      )
    ).rows[0];
    assert.equal(auth?.role, 'insignia_rewrite', 'owner_only_operation');
    assert.equal(auth.owner, 'insignia_rewrite');
    await sql`set local lock_timeout='2s'`.execute(tx);
    await sql`set local statement_timeout='10s'`.execute(tx);
    await sql`select pg_advisory_xact_lock(hashtextextended(${`insignia:owner-decision:${decision.decisionId}`},0))`.execute(
      tx,
    );
    const previous = (
      await sql<{
        request_sha256: string;
        result: OwnerLifecycleResult;
      }>`select request_sha256,result from public.owner_lifecycle_decisions where decision_id=${decision.decisionId}::uuid`.execute(
        tx,
      )
    ).rows[0];
    if (previous) {
      assert.equal(previous.request_sha256, digest, 'decision_reuse_conflict');
      return previous.result;
    }
    const observed = instant(decision.native.observedAt);
    assert.ok(
      observed <= auth.now && auth.now.getTime() - observed.getTime() <= 300000,
      'fresh_native_inventory_required',
    );
    // Same provider/domain locks as reviewed first-session bootstrap; no new identity system.
    for (const key of [
      `insignia:managed-install:domain:${SHOP}`,
      `insignia:managed-install:shop:${decision.providerShopId}`,
    ].sort())
      await sql`select pg_advisory_xact_lock(hashtextextended(${key},0))`.execute(tx);
    const candidates = await tx
      .selectFrom('shops')
      .selectAll()
      .where((eb) => eb.or([eb('shop_domain', '=', SHOP), eb('shopify_shop_id', '=', decision.providerShopId)]))
      .forUpdate()
      .execute();
    const shop = candidates[0];
    assert.ok(candidates.length <= 1, 'ambiguous_shop_identity');

    if (decision.shopId === null) {
      assert.equal(candidates.length, 0, 'durable_installation_appeared');
    } else {
      assert.ok(
        shop &&
          shop.shop_id === decision.shopId &&
          shop.shop_domain === SHOP &&
          shop.shopify_shop_id === decision.providerShopId,
        'exact_shop_identity_required',
      );
      const installation = await tx
        .selectFrom('installation_generations')
        .selectAll()
        .where('shop_id', '=', decision.shopId)
        .where('generation', '=', requiredText(decision.installationGeneration))
        .forUpdate()
        .executeTakeFirst();
      assert.ok(
        installation && installation.external_installation_id === decision.externalInstallationId,
        'exact_installation_identity_required',
      );
    }
    if (decision.native.currentStatus === 'ABSENT')
      assert.equal(decision.native.currentExternalInstallationId, null, 'absence_cannot_claim_current_installation');
    else {
      assert.equal(decision.native.currentStatus, 'PRESENT');
      assert.match(
        requiredText(decision.native.currentExternalInstallationId),
        /^gid:\/\/shopify\/AppInstallation\/[1-9][0-9]*$/,
      );
      if (shop) {
        const current = await tx
          .selectFrom('installation_generations')
          .select('external_installation_id')
          .where('shop_id', '=', shop.shop_id)
          .where('generation', '=', shop.current_generation)
          .executeTakeFirst();
        assert.equal(
          current?.external_installation_id,
          decision.native.currentExternalInstallationId,
          'native_current_installation_mismatch',
        );
      }
    }
    let result: OwnerLifecycleResult;
    if (decision.operation === 'OWNER_DEACTIVATION') {
      assert.equal(decision.native.currentStatus, 'ABSENT', 'independent_native_absence_required');
      assert.equal(decision.native.coordination, 'OWNER_HOLDS_NO_REINSTALL_WINDOW');
      const expires = instant(requiredText(decision.native.noReinstallUntil));
      assert.ok(
        expires > auth.now && expires.getTime() - observed.getTime() <= 300000,
        'bounded_owner_coordination_required',
      );
      if (decision.shopId === null) result = { outcome: 'OWNER_NO_DURABLE_INSTALLATION' };
      else {
        assert.equal(shop?.current_generation, decision.installationGeneration, 'newer_generation_present');
        const outcome = await createTenantRepository(tx).deactivateCurrent(
          tx,
          decision.shopId,
          requiredText(decision.installationGeneration),
        );
        assert.ok(outcome === 'deactivated' || outcome === 'already_inactive', 'generation_changed');
        result = { outcome: outcome === 'deactivated' ? 'OWNER_DEACTIVATED' : 'OWNER_ALREADY_INACTIVE' };
      }
      const finished = (await sql<{ now: Date }>`select clock_timestamp() as now`.execute(tx)).rows[0]?.now;
      assert.ok(finished && expires > finished, 'owner_coordination_expired');
    } else {
      assert.equal(decision.operation, 'OWNER_RECEIPT_ERASURE');
      assert.ok(['PRESENT', 'ABSENT'].includes(decision.native.currentStatus));
      const privacy = decision.privacy;
      assert.ok(privacy, 'explicit_privacy_scope_required');
      assert.deepEqual(
        privacy.sinks,
        { database: 'QUALIFIED', queue: 'QUALIFIED', privateCopies: 'ERASED', backups: 'RESTORE_EXCLUSION_QUALIFIED' },
        'all_sink_and_restore_exclusions_required',
      );
      const cutoff = instant(privacy.cutoff);
      assert.ok(cutoff <= observed, 'collection_cutoff_after_inventory');
      assert.ok(
        privacy.receipts.length >= 1 &&
          privacy.receipts.length <= 100 &&
          new Set(privacy.receipts.map((r) => r.id)).size === privacy.receipts.length,
        'bounded_unique_receipts_required',
      );
      const newer =
        decision.shopId === null
          ? undefined
          : await tx
              .selectFrom('installation_generations')
              .select('activated_at')
              .where('shop_id', '=', decision.shopId)
              .where('generation', '>', requiredText(decision.installationGeneration))
              .orderBy('generation')
              .executeTakeFirst();
      if (newer) assert.ok(cutoff < newer.activated_at, 'old_scope_reaches_newer_generation');

      for (const target of [...privacy.receipts].sort((a, b) => a.id.localeCompare(b.id))) {
        assert.ok(uuid(target.id) && hex(target.bodySha256));
        const collected = instant(target.collectedAt);
        assert.ok(collected <= cutoff, 'receipt_after_cutoff');
        const receipt = await tx
          .selectFrom('inbox_messages')
          .selectAll()
          .where('id', '=', target.id)
          .forUpdate()
          .executeTakeFirst();
        assert.ok(
          receipt && receipt.source === 'shopify' && receipt.retention_class === 'shopify-webhook',
          'exact_shopify_receipt_required',
        );
        const collection: { matches: boolean } | undefined = (
          await sql<{
            matches: boolean;
          }>`select collected_at=${target.collectedAt}::timestamptz and collected_at<=${privacy.cutoff}::timestamptz as matches from inbox_messages where id=${target.id}::uuid`.execute(
            tx,
          )
        ).rows[0];
        assert.equal(collection?.matches, true, 'receipt_collection_changed_or_after_cutoff');
        assert.equal(receipt.payload_sha256, target.bodySha256, 'receipt_body_changed');
        assert.ok(
          receipt.installation_generation === null ||
            (receipt.shop_id === decision.shopId &&
              BigInt(receipt.installation_generation) <= BigInt(requiredText(decision.installationGeneration))),
          'receipt_bound_to_newer_or_other_installation',
        );
        if (receipt.erasure_state !== 'erased')
          assert.equal(
            createHash('sha256').update(receipt.payload).digest('hex'),
            target.bodySha256,
            'receipt_integrity_required',
          );
        // Extract decimal text inside PostgreSQL. Never return or log the raw body/PII,
        // and never pass large provider IDs through JavaScript numbers.
        const bodyShop = (
          await sql<{
            shop: string | null;
          }>`with body as (select case when inbox.erasure_state='erased' then facts.captured_fields else convert_from(inbox.payload,'UTF8')::jsonb end as value from inbox_messages inbox left join webhook_obligation_facts facts on facts.inbox_id=inbox.id where inbox.id=${target.id}::uuid) select case when value ? 'shop_id' then value->>'shop_id' when value ? 'myshopify_domain' then value->>'id' else null end as shop from body`.execute(
            tx,
          )
        ).rows[0]?.shop;
        assert.equal(bodyShop, decision.providerShopId, 'body_shop_binding_required');
        await tx
          .updateTable('inbox_messages')
          .set({ payload: Buffer.alloc(0), erasure_state: 'erased', lease_owner: null, lease_until: null })
          .where('id', '=', target.id)
          .execute();
        await sql`update webhook_obligation_facts set captured_fields='{}',facts_erased_at=coalesce(facts_erased_at,clock_timestamp()) where inbox_id=${target.id}::uuid`.execute(
          tx,
        );
        await tx
          .updateTable('shopify_webhook_deliveries')
          .set({ queue_cleanup_pending: true })
          .where('inbox_id', '=', target.id)
          .execute();
      }
      const deadline = (
        await sql<{
          due: string;
          late: boolean;
        }>`select to_char(min(collected_at+interval '30 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as due,clock_timestamp()>min(collected_at+interval '30 days') as late from inbox_messages where id=any(${privacy.receipts.map((r) => r.id)}::uuid[])`.execute(
          tx,
        )
      ).rows[0];
      assert.ok(deadline);
      result = {
        outcome: 'OWNER_RECEIPTS_ERASED',
        erasedIds: privacy.receipts.map((r) => r.id),
        restoreExclusions: privacy.receipts,
        receiptDispositionOnly: true,
        fulfillBy: deadline.due,
        completedLate: deadline.late,
      };
    }
    await sql`insert into owner_lifecycle_decisions(decision_id,request_sha256,app_client_id,provider_shop_id,shop_id,installation_generation,external_installation_id,operation,authority,native_evidence_sha256,result) values(${decision.decisionId}::uuid,${digest},${decision.appClientId},${decision.providerShopId},${decision.shopId},${decision.installationGeneration}::bigint,${decision.externalInstallationId},${decision.operation},'EXPLICIT_OWNER_REQUEST',${decision.native.evidenceSha256},${JSON.stringify(result)}::jsonb)`.execute(
      tx,
    );
    return result;
  });
}
