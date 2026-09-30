import { checkCompleteSet, decodeEnvelope, decodeMemberCarrier } from '@insignia/cart-authorization';
import { type Kysely, sql } from 'kysely';
import type { Database } from '../client/database.js';
import { createConfigRepository } from './config.js';

type RevisionFence = {
  configId: string;
  operationId: string;
  productId: string;
  revisionId: string;
  contentHash: string;
};
type AcceptanceInput = {
  shopId: string;
  installationGeneration: string;
  authorizationGeneration: string;
  authorizationEpoch: number;
  idempotencyKey: string;
  requestDigest: string;
  effectiveRevisions: readonly RevisionFence[];
};
type StoredResult = {
  quote: {
    quoteId: string;
    schemaVersion: string;
    shopId: string;
    installationGeneration: string;
    authorizationGeneration: string;
    authorizationEpoch: number;
    acceptedAt: string;
    acceptedDate: string;
    acceptedDay: number;
    validThroughDay: number;
    country: string;
    marketId: string;
    shopCurrency: string;
    shopTimezone: string;
    presentmentCurrency: string;
    presentmentExponent: number;
    policyVersion: string;
    recognizedPolicyId: string;
    trial: boolean;
    qualifyingUsageDisposition: string;
    economics: {
      customizedQuantity: number;
      totalMinor: string;
      lines: readonly {
        lineIndex: number;
        variantId: string;
        quantity: number;
        unitPriceMinor: string;
        lineTotalMinor: string;
      }[];
    };
  };
  authorization: {
    setId: string;
    keyId: number;
    publicKeyFingerprint: string;
    firstValidDay: number;
    lastValidDay: number;
    validThroughDay: number;
    envelopeCarrier: string;
    members: readonly { lineIndex: number; carrier: string }[];
  };
};

async function assertReplayKeyUsable(
  transaction: Kysely<Database>,
  input: Omit<AcceptanceInput, 'effectiveRevisions'>,
  keyId: number,
  fingerprint: string,
): Promise<void> {
  const key = await sql<{ state: string; public_key_fingerprint: string }>`
    SELECT state, public_key_fingerprint FROM signing_keys
    WHERE shop_id=${input.shopId} AND installation_generation=${input.installationGeneration}::bigint
      AND authorization_generation=${input.authorizationGeneration}::uuid AND key_id=${keyId}`.execute(transaction);
  if (
    !key.rows[0] ||
    !['active', 'retiring'].includes(key.rows[0].state) ||
    key.rows[0].public_key_fingerprint !== fingerprint
  )
    throw new Error('idempotency key belongs to revoked signing key');
}

function validateEconomicConservation(value: StoredResult): void {
  const { economics } = value.quote;
  if (
    !Number.isInteger(economics.customizedQuantity) ||
    economics.customizedQuantity < 1 ||
    economics.customizedQuantity > 10000 ||
    economics.lines.length < 1 ||
    economics.lines.length > 32 ||
    !/^(0|[1-9][0-9]*)$/.test(economics.totalMinor)
  )
    throw new Error('invalid accepted quote economics');
  const limit = (1n << 64n) - 1n;
  let quantity = 0;
  let total = 0n;
  for (const [index, line] of economics.lines.entries()) {
    if (
      line.lineIndex !== index ||
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      !/^(0|[1-9][0-9]*)$/.test(line.unitPriceMinor) ||
      !/^(0|[1-9][0-9]*)$/.test(line.lineTotalMinor)
    )
      throw new Error('invalid accepted quote allocation line');
    const price = BigInt(line.unitPriceMinor);
    const amount = BigInt(line.lineTotalMinor);
    if (price > limit || amount > limit || price * BigInt(line.quantity) !== amount)
      throw new Error('accepted quote allocation does not conserve money');
    quantity += line.quantity;
    total += amount;
  }
  if (
    quantity !== economics.customizedQuantity ||
    total > limit ||
    total !== BigInt(economics.totalMinor) ||
    value.authorization.members.some((member, index) => member.lineIndex !== index || !member.carrier)
  )
    throw new Error('accepted quote authorization is incomplete or nonconserving');
}

function uuidHex(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw new Error('invalid authorization UUID');
  return value.replaceAll('-', '').toLowerCase();
}

/** Compare every persisted v2 claim to the immutable economic row before INSERT. */
function validateAuthorizationMetadata(value: StoredResult): void {
  const { quote, authorization } = value;
  if (!Number.isSafeInteger(authorization.keyId) || authorization.keyId < 1 || authorization.keyId > 65535)
    throw new Error('authorization key ID is not numeric u16');
  const { header } = decodeEnvelope(authorization.envelopeCarrier);
  const members = authorization.members.map(({ lineIndex, carrier }, index) => {
    if (lineIndex !== index) throw new Error('authorization member order mismatch');
    return decodeMemberCarrier(carrier);
  });
  checkCompleteSet(header, members);
  if (
    header.keyId !== authorization.keyId ||
    header.generationHex !== uuidHex(quote.authorizationGeneration) ||
    header.epoch !== quote.authorizationEpoch ||
    header.quoteHex !== uuidHex(quote.quoteId) ||
    header.setHex !== uuidHex(authorization.setId) ||
    header.count !== quote.economics.lines.length ||
    header.currency !== quote.presentmentCurrency ||
    header.exponent !== quote.presentmentExponent ||
    header.country !== quote.country ||
    header.marketId !== quote.marketId ||
    header.validThroughDay !== quote.validThroughDay ||
    header.totalQuantity !== quote.economics.customizedQuantity ||
    header.totalMinor !== quote.economics.totalMinor ||
    authorization.firstValidDay > quote.acceptedDay ||
    authorization.lastValidDay < quote.validThroughDay ||
    authorization.validThroughDay !== quote.validThroughDay
  )
    throw new Error('persisted authorization header does not match immutable quote');
  for (const [index, member] of members.entries()) {
    const line = quote.economics.lines[index];
    if (
      !line ||
      member.index !== index ||
      member.variantId !== line.variantId ||
      member.quantity !== line.quantity ||
      member.unitMinor !== line.unitPriceMinor
    )
      throw new Error('persisted authorization member does not match immutable quote');
  }
}

/** Opaque PostgreSQL facade for the application quote service. The shop row lock serializes
 * installation changes, publication activation and same-key acceptance until commit. */
export class PgAcceptedQuoteRepository {
  constructor(private readonly database: Kysely<Database>) {}

  async getActive(shopId: string, installationGeneration: string) {
    const result = await sql<{
      shop_id: string;
      generation: string;
      shopify_shop_id: string | null;
      authorization_generation: string;
      authorization_epoch: string;
    }>`
      SELECT s.shop_id, s.current_generation::text AS generation, s.shopify_shop_id,
        i.authorization_generation::text AS authorization_generation,
        i.authorization_epoch::text AS authorization_epoch
      FROM shops s JOIN installation_generations i
        ON i.shop_id = s.shop_id AND i.generation = s.current_generation
      WHERE s.shop_id = ${shopId} AND s.current_generation = ${installationGeneration}::bigint
        AND i.deactivated_at IS NULL`.execute(this.database);
    const row = result.rows[0];
    if (!row?.shopify_shop_id) return null;
    return {
      shopId: row.shop_id,
      installationGeneration: row.generation,
      shopifyShopGid: `gid://shopify/Shop/${row.shopify_shop_id}`,
      authorizationGeneration: row.authorization_generation,
      authorizationEpoch: Number(row.authorization_epoch),
    };
  }

  async findCompleted<T extends StoredResult = StoredResult>(
    input: Omit<AcceptanceInput, 'effectiveRevisions'>,
  ): Promise<T | null> {
    return this.database.transaction().execute(async (transaction) => {
      const found = await sql<{
        request_digest: string;
        authorization_generation: string;
        authorization_epoch: string;
        current_authorization_generation: string;
        current_authorization_epoch: string;
        quote_value: unknown;
        set_id: string;
        key_id: number;
        public_key_fingerprint: string;
        first_valid_day: number;
        last_valid_day: number;
        valid_through_day: number;
        envelope_carrier: string;
        member_carriers: unknown;
      }>`
      SELECT q.request_digest, q.authorization_generation::text, q.authorization_epoch::text,
        i.authorization_generation::text AS current_authorization_generation,
        i.authorization_epoch::text AS current_authorization_epoch,
        q.quote_value, a.set_id::text, a.key_id,
        a.public_key_fingerprint, a.first_valid_day, a.last_valid_day, a.valid_through_day,
        a.envelope_carrier, a.member_carriers
      FROM accepted_quotes q
      JOIN quote_authorization_sets a ON a.quote_id = q.quote_id
      JOIN shops s ON s.shop_id = q.shop_id AND s.current_generation = q.installation_generation
      JOIN installation_generations i ON i.shop_id = s.shop_id AND i.generation = s.current_generation
      WHERE q.shop_id = ${input.shopId} AND q.installation_generation = ${input.installationGeneration}::bigint
        AND i.deactivated_at IS NULL AND q.idempotency_key = ${input.idempotencyKey}
      ORDER BY a.created_at ASC LIMIT 1 FOR SHARE OF s, i`.execute(transaction);
      const row = found.rows[0];
      if (!row) return null;
      if (
        row.authorization_generation !== input.authorizationGeneration ||
        row.authorization_epoch !== String(input.authorizationEpoch) ||
        row.current_authorization_generation !== input.authorizationGeneration ||
        row.current_authorization_epoch !== String(input.authorizationEpoch)
      )
        throw new Error('idempotency key belongs to revoked authorization identity');
      if (row.request_digest !== input.requestDigest) throw new Error('idempotency digest conflict');
      await assertReplayKeyUsable(transaction, input, row.key_id, row.public_key_fingerprint);
      return {
        quote: row.quote_value,
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
      } as T;
    });
  }

  async getEffective(shopId: string, productId: string) {
    const result = await sql<{ config_id: string; revision_id: string; operation_id: string }>`
      SELECT c.config_id, c.effective_revision_id AS revision_id,
        c.effective_operation_id AS operation_id
      FROM product_configs c
      JOIN shops s ON s.shop_id = c.shop_id
      JOIN installation_generations i ON i.shop_id = s.shop_id AND i.generation = s.current_generation
      JOIN publication_operations p ON p.shop_id = c.shop_id AND p.config_id = c.config_id
        AND p.operation_id = c.effective_operation_id
      WHERE c.shop_id = ${shopId} AND c.external_product_id = ${productId}
        AND i.deactivated_at IS NULL AND p.installation_generation = s.current_generation
        AND p.status = 'activated' AND p.revision_id = c.effective_revision_id
        AND p.operation_sequence = c.publication_sequence
        AND p.observed_projection = p.expected_projection
        AND p.observed_projection_digest = p.expected_projection_digest`.execute(this.database);
    const row = result.rows[0];
    if (!row) return null;
    const revision = await createConfigRepository(this.database).getValidatedPublishedRevision(shopId, row.revision_id);
    if (!revision || revision.configId !== row.config_id || revision.publishedValue.productId !== productId)
      throw new Error('effective published revision integrity mismatch');
    return { config: revision.publishedValue, configId: row.config_id, operationId: row.operation_id };
  }

  async accept<T extends StoredResult>(input: AcceptanceInput, commit: () => Promise<T>): Promise<T> {
    if (
      !input.shopId ||
      !/^[1-9][0-9]*$/.test(input.installationGeneration) ||
      !/^[0-9a-f]{64}$/.test(input.requestDigest) ||
      !input.idempotencyKey ||
      input.effectiveRevisions.length === 0
    )
      throw new Error('invalid accepted quote command');
    return this.database.transaction().execute(async (transaction) => {
      const active = await sql<{ generation: string; authorization_generation: string; authorization_epoch: string }>`
        SELECT s.current_generation::text AS generation,
          i.authorization_generation::text AS authorization_generation,
          i.authorization_epoch::text AS authorization_epoch
        FROM shops s JOIN installation_generations i
          ON i.shop_id = s.shop_id AND i.generation = s.current_generation
        WHERE s.shop_id = ${input.shopId} AND i.deactivated_at IS NULL
        FOR UPDATE OF s, i`.execute(transaction);
      const current = active.rows[0];
      if (
        !current ||
        current.generation !== input.installationGeneration ||
        current.authorization_generation !== input.authorizationGeneration ||
        current.authorization_epoch !== String(input.authorizationEpoch)
      )
        throw new Error('inactive tenant or installation authorization fence');

      const previous = await sql<{
        request_digest: string;
        authorization_generation: string;
        authorization_epoch: string;
        quote_value: unknown;
        set_id: string;
        key_id: number;
        public_key_fingerprint: string;
        first_valid_day: number;
        last_valid_day: number;
        valid_through_day: number;
        envelope_carrier: string;
        member_carriers: unknown;
      }>`
        SELECT q.request_digest, q.authorization_generation::text, q.authorization_epoch::text,
          q.quote_value, a.set_id::text, a.key_id,
          a.public_key_fingerprint, a.first_valid_day, a.last_valid_day, a.valid_through_day,
          a.envelope_carrier, a.member_carriers
        FROM accepted_quotes q JOIN quote_authorization_sets a ON a.quote_id = q.quote_id
        WHERE q.shop_id = ${input.shopId} AND q.installation_generation = ${input.installationGeneration}::bigint
          AND q.idempotency_key = ${input.idempotencyKey}
        ORDER BY a.created_at ASC LIMIT 1`.execute(transaction);
      if (previous.rows[0]) {
        const row = previous.rows[0];
        if (
          row.authorization_generation !== input.authorizationGeneration ||
          row.authorization_epoch !== String(input.authorizationEpoch)
        )
          throw new Error('idempotency key belongs to revoked authorization identity');
        if (row.request_digest !== input.requestDigest) throw new Error('idempotency digest conflict');
        await assertReplayKeyUsable(transaction, input, row.key_id, row.public_key_fingerprint);
        return {
          quote: row.quote_value,
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
        } as T;
      }

      for (const revision of [...input.effectiveRevisions].sort((a, b) => a.configId.localeCompare(b.configId))) {
        const effective = await sql<{ config_id: string }>`
          SELECT c.config_id FROM product_configs c
          JOIN config_revisions r ON r.shop_id = c.shop_id AND r.config_id = c.config_id
            AND r.revision_id = c.effective_revision_id
          JOIN publication_operations p ON p.shop_id = c.shop_id AND p.config_id = c.config_id
            AND p.operation_id = c.effective_operation_id
          WHERE c.shop_id = ${input.shopId} AND c.config_id = ${revision.configId}
            AND c.external_product_id = ${revision.productId}
            AND r.revision_id = ${revision.revisionId} AND r.content_hash = ${revision.contentHash}
            AND p.operation_id = ${revision.operationId} AND p.revision_id = r.revision_id
            AND p.installation_generation = ${input.installationGeneration}::bigint
            AND p.status = 'activated' AND p.operation_sequence = c.publication_sequence
            AND p.observed_projection = p.expected_projection
            AND p.observed_projection_digest = p.expected_projection_digest
          FOR UPDATE OF c`.execute(transaction);
        if (!effective.rows[0]) throw new Error('effective publication changed before quote acceptance');
      }

      const result = await commit();
      validateEconomicConservation(result);
      validateAuthorizationMetadata(result);
      const { quote, authorization } = result;
      if (
        quote.shopId !== input.shopId ||
        quote.installationGeneration !== input.installationGeneration ||
        quote.authorizationGeneration !== input.authorizationGeneration ||
        quote.authorizationEpoch !== input.authorizationEpoch ||
        quote.validThroughDay !== quote.acceptedDay + 2 ||
        authorization.validThroughDay !== quote.validThroughDay ||
        authorization.firstValidDay > quote.acceptedDay ||
        authorization.lastValidDay < quote.validThroughDay ||
        authorization.members.length !== quote.economics.lines.length
      )
        throw new Error('quote persistence identity or validity mismatch');
      await sql`
        INSERT INTO accepted_quotes (quote_id, shop_id, installation_generation, authorization_generation,
          authorization_epoch, idempotency_key, request_digest, schema_version, accepted_at, accepted_date,
          accepted_day, valid_through_day, country, market_id, shop_currency, shop_timezone,
          presentment_currency, presentment_exponent, policy_version, recognized_policy_id,
          trial, qualifying_usage_disposition, customized_quantity, total_minor, quote_value)
        VALUES (${quote.quoteId}::uuid, ${quote.shopId}, ${quote.installationGeneration}::bigint,
          ${quote.authorizationGeneration}::uuid, ${quote.authorizationEpoch}::bigint,
          ${input.idempotencyKey}, ${input.requestDigest}, ${quote.schemaVersion}, ${quote.acceptedAt}::timestamptz,
          ${quote.acceptedDate}::date, ${quote.acceptedDay}, ${quote.validThroughDay}, ${quote.country},
          ${quote.marketId}::numeric, ${quote.shopCurrency}, ${quote.shopTimezone}, ${quote.presentmentCurrency},
          ${quote.presentmentExponent}, ${quote.policyVersion}, ${quote.recognizedPolicyId}, ${quote.trial},
          ${quote.qualifyingUsageDisposition}, ${quote.economics.customizedQuantity},
          ${quote.economics.totalMinor}::numeric, ${JSON.stringify(quote)}::jsonb)`.execute(transaction);
      await sql`
        INSERT INTO quote_authorization_sets (set_id, quote_id, shop_id, installation_generation,
          authorization_generation, authorization_epoch, key_id, public_key_fingerprint,
          first_valid_day, last_valid_day, valid_through_day, envelope_carrier, member_carriers)
        VALUES (${authorization.setId}::uuid, ${quote.quoteId}::uuid, ${quote.shopId},
          ${quote.installationGeneration}::bigint, ${quote.authorizationGeneration}::uuid,
          ${quote.authorizationEpoch}::bigint, ${authorization.keyId}, ${authorization.publicKeyFingerprint},
          ${authorization.firstValidDay}, ${authorization.lastValidDay}, ${authorization.validThroughDay},
          ${authorization.envelopeCarrier},
          ${JSON.stringify(authorization.members)}::jsonb)`.execute(transaction);
      return result;
    });
  }
}
