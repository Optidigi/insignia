import type {
  AcceptedQuote,
  QuoteRenewalCommand,
  QuoteRenewalIdentity,
  QuoteRenewalStore,
  RenewedQuoteResult,
} from '@insignia/application';
import { materialHash } from '@insignia/application';
import { type Kysely, sql } from 'kysely';
import type { Database } from '../client/database.js';
import {
  assertNewAuthorizationKey,
  validateAuthorizationMetadata,
  validateEconomicConservation,
} from './accepted-quote.js';

function validateIdentity(input: QuoteRenewalIdentity) {
  if (
    !input.shopId ||
    !/^[1-9][0-9]*$/.test(input.installationGeneration) ||
    !/^[a-f0-9]{64}$/.test(input.ownerBinding) ||
    !/^[a-f0-9-]{36}$/i.test(input.quoteId)
  )
    throw new Error('invalid owned quote renewal');
}

async function owned(database: Kysely<Database>, input: QuoteRenewalIdentity, update: boolean) {
  validateIdentity(input);
  const result = await sql<{ quote_value: AcceptedQuote }>`
    SELECT q.quote_value FROM accepted_quotes q
    JOIN buyer_quote_ownership b ON b.shop_id=q.shop_id AND b.installation_generation=q.installation_generation
      AND b.quote_id=q.quote_id AND b.owner_binding=${input.ownerBinding}
    JOIN shops s ON s.shop_id=q.shop_id AND s.current_generation=q.installation_generation
    JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
    WHERE q.shop_id=${input.shopId} AND q.installation_generation=${input.installationGeneration}::bigint
      AND q.quote_id=${input.quoteId}::uuid AND i.deactivated_at IS NULL
      AND q.authorization_generation=${input.authorizationGeneration}::uuid AND q.authorization_epoch=${input.authorizationEpoch}
      AND i.authorization_generation=q.authorization_generation AND i.authorization_epoch=q.authorization_epoch
    ${update ? sql`FOR UPDATE OF s,i` : sql`FOR SHARE OF s,i`}`.execute(database);
  return result.rows[0]?.quote_value ?? null;
}

async function completed(database: Kysely<Database>, input: QuoteRenewalCommand, quote: AcceptedQuote) {
  const found = await sql<{
    quote_id: string;
    owner_binding: string;
    request_digest: string;
    material_hash: string;
    set_id: string;
    key_id: number;
    public_key_fingerprint: string;
    first_valid_day: number;
    last_valid_day: number;
    valid_through_day: number;
    envelope_carrier: string;
    member_carriers: RenewedQuoteResult['authorization']['members'];
    issued_at: Date;
    issued_day: number;
    shop_timezone: string;
    key_state: string | null;
    key_fingerprint: string | null;
  }>`SELECT r.quote_id::text,r.owner_binding,r.request_digest,r.material_hash,r.issued_at,r.issued_day,r.shop_timezone,
      a.set_id::text,a.key_id,a.public_key_fingerprint,a.first_valid_day,a.last_valid_day,a.valid_through_day,
      a.envelope_carrier,a.member_carriers,k.state AS key_state,k.public_key_fingerprint AS key_fingerprint
    FROM quote_authorization_renewals r JOIN quote_authorization_sets a ON a.set_id=r.set_id
    LEFT JOIN signing_keys k ON k.shop_id=a.shop_id AND k.installation_generation=a.installation_generation
      AND k.authorization_generation=a.authorization_generation AND k.key_id=a.key_id
    WHERE r.shop_id=${input.shopId} AND r.installation_generation=${input.installationGeneration}::bigint
      AND r.idempotency_key=${input.idempotencyKey}`.execute(database);
  const row = found.rows[0];
  if (!row) return null;
  if (
    row.quote_id !== input.quoteId ||
    row.owner_binding !== input.ownerBinding ||
    row.request_digest !== input.requestDigest ||
    row.material_hash !== input.materialHash
  )
    throw new Error('renewal idempotency digest conflict');
  if (
    !row.key_state ||
    !['active', 'retiring'].includes(row.key_state) ||
    row.key_fingerprint !== row.public_key_fingerprint
  )
    throw new Error('renewal signer revoked');
  return {
    quote,
    authorization: {
      setId: row.set_id,
      keyId: row.key_id,
      publicKeyFingerprint: row.public_key_fingerprint,
      firstValidDay: row.first_valid_day,
      lastValidDay: row.last_valid_day,
      validThroughDay: row.valid_through_day,
      envelopeCarrier: row.envelope_carrier,
      members: row.member_carriers,
    },
    issuance: {
      issuedAt: row.issued_at.toISOString(),
      issuedDay: row.issued_day,
      validThroughDay: row.valid_through_day,
      shopTimezone: row.shop_timezone,
    },
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

/** Private facade: serialize renewal with installation/publication fences, preserve the original immutable quote. */
export class PgQuoteRenewalRepository implements QuoteRenewalStore {
  constructor(private readonly database: Kysely<Database>) {}

  getOwned(input: QuoteRenewalIdentity) {
    return owned(this.database, input, false);
  }

  findCompleted(input: QuoteRenewalCommand) {
    return this.database.transaction().execute(async (transaction) => {
      const quote = await owned(transaction, input, false);
      if (!quote) throw new Error('quote ownership unavailable');
      return completed(transaction, input, quote);
    });
  }

  renew(input: QuoteRenewalCommand, commit: () => Promise<RenewedQuoteResult>) {
    if (
      !/^[a-f0-9]{64}$/.test(input.requestDigest) ||
      !/^[a-f0-9]{64}$/.test(input.materialHash) ||
      !input.idempotencyKey ||
      input.idempotencyKey.length > 128 ||
      !input.effectiveRevisions.length
    )
      throw new Error('invalid renewal command');
    return this.database.transaction().execute(async (transaction) => {
      const quote = await owned(transaction, input, true);
      if (!quote) throw new Error('quote ownership unavailable');
      const replay = await completed(transaction, input, quote);
      if (replay) return replay;
      if (materialHash(quote) !== input.materialHash) throw new Error('renewal material mismatch');
      for (const revision of [...input.effectiveRevisions].sort((a, b) => a.configId.localeCompare(b.configId))) {
        const fence = await sql<{ config_id: string }>`SELECT c.config_id FROM product_configs c
          JOIN config_revisions r ON r.shop_id=c.shop_id AND r.config_id=c.config_id AND r.revision_id=c.effective_revision_id
          JOIN publication_operations p ON p.shop_id=c.shop_id AND p.config_id=c.config_id AND p.operation_id=c.effective_operation_id
          WHERE c.shop_id=${input.shopId} AND c.config_id=${revision.configId} AND c.external_product_id=${revision.productId}
            AND r.revision_id=${revision.revisionId} AND r.content_hash=${revision.contentHash}
            AND p.operation_id=${revision.operationId} AND p.revision_id=r.revision_id
            AND p.installation_generation=${input.installationGeneration}::bigint AND p.status='activated'
            AND p.operation_sequence=c.publication_sequence AND p.observed_projection=p.expected_projection
            AND p.observed_projection_digest=p.expected_projection_digest FOR UPDATE OF c`.execute(transaction);
        if (!fence.rows[0]) throw new Error('effective publication changed before renewal');
      }
      const result = await commit();
      if (
        canonical(result.quote) !== canonical(quote) ||
        result.issuance.shopTimezone !== quote.shopTimezone ||
        result.issuance.validThroughDay !== result.issuance.issuedDay + 2
      )
        throw new Error('renewal modified accepted history or issuance window');
      // Ephemeral validation view covers new signatures; it is never written as accepted history.
      const signingView = {
        quote: { ...quote, acceptedDay: result.issuance.issuedDay, validThroughDay: result.issuance.validThroughDay },
        authorization: result.authorization,
      };
      validateEconomicConservation(signingView);
      validateAuthorizationMetadata(signingView);
      await assertNewAuthorizationKey(transaction, signingView);
      const { authorization, issuance } = result;
      await sql`INSERT INTO quote_authorization_renewals(set_id,quote_id,shop_id,installation_generation,
        owner_binding,idempotency_key,request_digest,material_hash,issued_at,issued_date,issued_day,shop_timezone,valid_through_day)
        VALUES(${authorization.setId}::uuid,${quote.quoteId}::uuid,${quote.shopId},${quote.installationGeneration}::bigint,
          ${input.ownerBinding},${input.idempotencyKey},${input.requestDigest},${input.materialHash},${issuance.issuedAt}::timestamptz,
          (timezone(${issuance.shopTimezone},${issuance.issuedAt}::timestamptz))::date,${issuance.issuedDay},${issuance.shopTimezone},${issuance.validThroughDay})`.execute(
        transaction,
      );
      await sql`INSERT INTO quote_authorization_sets(set_id,quote_id,shop_id,installation_generation,authorization_generation,
        authorization_epoch,key_id,public_key_fingerprint,first_valid_day,last_valid_day,valid_through_day,envelope_carrier,member_carriers)
        VALUES(${authorization.setId}::uuid,${quote.quoteId}::uuid,${quote.shopId},${quote.installationGeneration}::bigint,
          ${quote.authorizationGeneration}::uuid,${quote.authorizationEpoch},${authorization.keyId},${authorization.publicKeyFingerprint},
          ${authorization.firstValidDay},${authorization.lastValidDay},${authorization.validThroughDay},${authorization.envelopeCarrier},
          ${JSON.stringify(authorization.members)}::jsonb)`.execute(transaction);
      return result;
    });
  }
}
