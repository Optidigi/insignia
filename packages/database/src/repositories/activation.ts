import {
  type ActivationCandidate,
  type ActivationEvidence,
  ActivationFenceError,
  type ActivationIdentity,
  type ActivationSession,
  type ActivationState,
  type ActivationStore,
  activationDigest,
  availabilityV2HeldSafe,
  buildPublicConfig,
  classifyPublicationAdmission,
  isAvailabilityV2,
  publicKeyFingerprint,
  sameAvailabilityV2,
} from '@insignia/application';
import { type Kysely, sql, type Transaction } from 'kysely';
import type { Database } from '../client/database.js';
import { canonicalJson, sha256CanonicalJson } from '../hash/canonical.js';
import { createConfigRepositoryInternal } from './config.js';
import { publicationProjection } from './production-publication.js';
import { createPublicationRepository } from './publication.js';
import { createTenantRepository } from './tenant.js';

/** Never exported from the database package. Only the production coordinator receives this store. */
export class PgActivationStore implements ActivationStore {
  constructor(
    private readonly database: Kysely<Database>,
    private readonly appClientId: string,
  ) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(appClientId)) throw new Error('Invalid trusted app client identity');
  }
  private async load(tx: Transaction<Database>, identity: ActivationIdentity): Promise<ActivationCandidate> {
    const shop = await tx
      .selectFrom('shops')
      .selectAll()
      .where('shop_id', '=', identity.shopId)
      .forUpdate()
      .executeTakeFirst();
    if (!shop?.shopify_shop_id) throw new ActivationFenceError('Shop unavailable');
    const scope = await createTenantRepository(tx).lockActiveAuthorizationScope({
      shopId: identity.shopId,
      installationGeneration: shop.current_generation,
    });
    if (!scope) throw new ActivationFenceError('Installation inactive');
    const config = await tx
      .selectFrom('product_configs')
      .selectAll()
      .where('shop_id', '=', identity.shopId)
      .where('config_id', '=', identity.configId)
      .forUpdate()
      .executeTakeFirst();
    const operation = await tx
      .selectFrom('publication_operations')
      .selectAll()
      .where('shop_id', '=', identity.shopId)
      .where('config_id', '=', identity.configId)
      .where('operation_id', '=', identity.operationId)
      .forUpdate()
      .executeTakeFirst();
    if (
      !config ||
      !operation ||
      operation.installation_generation !== scope.installationGeneration ||
      operation.operation_sequence !== config.publication_sequence ||
      !['requested', 'acknowledged', 'observed', 'activated'].includes(operation.status)
    )
      throw new ActivationFenceError('Publication superseded or inactive');
    const progress = await sql<{
      phase: string;
      mode: 'required' | 'optional';
      prior_mode: 'required' | 'optional' | null;
      activation_evidence: string | null;
    }>`
      SELECT phase, mode, prior_mode, activation_evidence FROM m4_publication_progress
      WHERE shop_id=${identity.shopId} AND config_id=${identity.configId} AND operation_id=${identity.operationId} FOR UPDATE`.execute(
      tx,
    );
    const p = progress.rows[0];
    if (!p || ['operator-hold', 'conflict'].includes(p.phase))
      throw new ActivationFenceError('Publication not eligible');
    if (
      operation.status === 'activated' &&
      (config.effective_operation_id !== operation.operation_id ||
        config.effective_revision_id !== operation.revision_id ||
        p.phase !== 'active')
    )
      throw new ActivationFenceError('Effective pointer mismatch');
    const expected = publicationProjection(operation.expected_projection);
    if (
      expected.productId !== config.external_product_id ||
      expected.shopifyShopId !== `gid://shopify/Shop/${scope.shopifyShopId}` ||
      expected.generationHex !== scope.authorizationGeneration.replaceAll('-', '') ||
      expected.epoch !== scope.authorizationEpoch ||
      expected.mode !== p.mode ||
      activationDigest(operation.expected_projection) !== operation.expected_projection_digest
    )
      throw new ActivationFenceError('Publication projection identity changed');
    const revision = await createConfigRepositoryInternal(tx).getValidatedPublishedRevision(
      identity.shopId,
      operation.revision_id,
    );
    if (!revision || revision.configId !== identity.configId) throw new ActivationFenceError('Revision mismatch');
    const companion = await sql<{
      mode: string;
      geometry_version: string;
      geometry_value: unknown;
      geometry_hash: string;
      presentation_version: string;
      presentation_value: unknown;
      presentation_hash: string;
      source_generation: string | null;
      source_version: string | null;
    }>`
      SELECT g.mode, g.schema_version AS geometry_version, g.geometry_value, g.content_hash AS geometry_hash,
        p.schema_version AS presentation_version, p.presentation_value, p.content_hash AS presentation_hash,
        p.source_installation_generation::text AS source_generation, p.source_draft_version::text AS source_version
      FROM config_revision_geometry g JOIN config_revision_presentation p USING (shop_id, config_id, revision_id)
      WHERE g.shop_id=${identity.shopId} AND g.config_id=${identity.configId} AND g.revision_id=${operation.revision_id}`.execute(
      tx,
    );
    const metadata = companion.rows[0];
    if (
      !metadata ||
      metadata.mode !== expected.mode ||
      metadata.geometry_version !== 'm5-geometry-v1' ||
      metadata.presentation_version !== 'm5-presentation-v1' ||
      metadata.source_generation !== scope.installationGeneration ||
      !metadata.source_version ||
      sha256CanonicalJson(metadata.geometry_value) !== metadata.geometry_hash ||
      sha256CanonicalJson(metadata.presentation_value) !== metadata.presentation_hash
    )
      throw new ActivationFenceError('Immutable M5 revision metadata mismatch');
    const keys = await sql<{
      key_id: number;
      public_key: Buffer;
      public_key_fingerprint: string;
      state: 'pending' | 'active' | 'retiring' | 'revoked' | 'destroyed';
      first_valid_day: number;
      last_valid_day: number;
    }>`
      SELECT key_id, public_key, public_key_fingerprint, state, first_valid_day, last_valid_day FROM signing_keys
      WHERE shop_id=${identity.shopId} AND installation_generation=${scope.installationGeneration}::bigint
        AND authorization_generation=${scope.authorizationGeneration}::uuid ORDER BY key_id FOR UPDATE`.execute(tx);
    for (const key of keys.rows)
      if (publicKeyFingerprint(key.public_key) !== key.public_key_fingerprint)
        throw new ActivationFenceError('Public key fingerprint drift');
    const publicConfig = buildPublicConfig({
      scope,
      keys: keys.rows.map((key) => ({
        id: key.key_id,
        publicKey: key.public_key,
        state: key.state,
        firstDay: key.first_valid_day,
        lastDay: key.last_valid_day,
      })),
    });
    if (publicConfig.value !== expected.publicConfig) throw new ActivationFenceError('Key registry changed');
    let prior: ActivationCandidate['prior'] = null;
    if (config.effective_operation_id && operation.status !== 'activated') {
      const effective = await tx
        .selectFrom('publication_operations')
        .selectAll()
        .where('shop_id', '=', identity.shopId)
        .where('config_id', '=', identity.configId)
        .where('operation_id', '=', config.effective_operation_id)
        .executeTakeFirst();
      if (effective?.status !== 'activated' || effective.revision_id !== config.effective_revision_id)
        throw new ActivationFenceError('Prior effective publication invalid');
      prior = {
        mode: publicationProjection(effective.expected_projection).mode,
        installationGeneration: effective.installation_generation,
      };
    }
    if (operation.status !== 'activated' && (prior?.mode ?? null) !== p.prior_mode)
      throw new ActivationFenceError('Prior effective mode differs from publication intent');
    await sql`INSERT INTO m5_activation_state (shop_id, config_id, operation_id)
      VALUES (${identity.shopId}, ${identity.configId}, ${identity.operationId}) ON CONFLICT DO NOTHING`.execute(tx);
    const state = await sql<{
      kind: ActivationState['kind'];
      hold: ActivationState['hold'];
      evidence_digest: string | null;
    }>`
      SELECT kind, hold, evidence_digest FROM m5_activation_state
      WHERE shop_id=${identity.shopId} AND config_id=${identity.configId} AND operation_id=${identity.operationId} FOR UPDATE`.execute(
      tx,
    );
    const row = state.rows[0];
    if (!row) throw new Error('Activation state missing');
    if (operation.status === 'activated' && (!row.evidence_digest || row.evidence_digest !== p.activation_evidence))
      throw new ActivationFenceError('Durable activation evidence missing');
    return {
      ...identity,
      revisionId: revision.revisionId,
      revisionHash: revision.contentHash,
      operationSequence: operation.operation_sequence,
      scope,
      availabilityScope: {
        shopId: identity.shopId,
        installationGeneration: scope.installationGeneration,
        shopifyShopId: expected.shopifyShopId,
        appClientId: this.appClientId,
      },
      productId: `gid://shopify/Product/${expected.productId}`,
      mode: expected.mode,
      prior,
      phase: p.phase,
      status: operation.status,
      desiredProjection: operation.expected_projection,
      desiredProjectionDigest: operation.expected_projection_digest,
      observedProjectionDigest: operation.observed_projection_digest,
      publicConfig,
      selectedKeyId: keys.rows.find((key) => key.state === 'active')?.key_id ?? 0,
      state: { kind: row.kind, hold: row.hold, evidenceDigest: row.evidence_digest },
    };
  }
  async locked<T>(identity: ActivationIdentity, action: (session: ActivationSession) => Promise<T>): Promise<T> {
    return this.database
      .transaction()
      .execute(async (tx) => {
        let candidate = await this.load(tx, identity);
        let valid = true;
        const guard = () => {
          if (!valid) throw new Error('Activation session expired');
        };
        const save = async (state: ActivationState) => {
          guard();
          await sql`UPDATE m5_activation_state SET kind=${state.kind}, hold=${state.hold === null ? null : JSON.stringify(state.hold)}::jsonb,
          evidence_digest=${state.evidenceDigest}, version=version+1 WHERE shop_id=${identity.shopId}
          AND config_id=${identity.configId} AND operation_id=${identity.operationId}`.execute(tx);
          candidate = { ...candidate, state };
        };
        const session: ActivationSession = {
          get candidate() {
            return candidate;
          },
          save,
          commit: async (evidence: ActivationEvidence) => {
            guard();
            const admission = classifyPublicationAdmission({
              prior: candidate.prior,
              proposed: { mode: candidate.mode, installationGeneration: candidate.scope.installationGeneration },
              phase: candidate.phase,
            });
            if (
              candidate.phase !== 'activation-pending' ||
              candidate.status !== 'observed' ||
              evidence.shopId !== identity.shopId ||
              evidence.configId !== identity.configId ||
              evidence.operationId !== identity.operationId ||
              evidence.version !== 'm5-activation-evidence-v2' ||
              evidence.decisionVersion !== 2 ||
              evidence.revisionId !== candidate.revisionId ||
              evidence.revisionHash !== candidate.revisionHash ||
              evidence.operationSequence !== candidate.operationSequence ||
              evidence.installationGeneration !== candidate.scope.installationGeneration ||
              evidence.authorizationGeneration !== candidate.scope.authorizationGeneration ||
              evidence.authorizationEpoch !== candidate.scope.authorizationEpoch ||
              evidence.selectedKeyId !== candidate.selectedKeyId ||
              evidence.desiredProjectionDigest !== candidate.desiredProjectionDigest ||
              evidence.observedProjectionDigest !== candidate.observedProjectionDigest ||
              evidence.observedProjectionDigest !== evidence.desiredProjectionDigest ||
              evidence.admissionClass !== admission ||
              (admission === 'SAME_MODE'
                ? evidence.hold !== null || evidence.holdObservation !== null
                : candidate.state.kind !== 'HELD' ||
                  !evidence.hold?.held ||
                  !evidence.holdObservation ||
                  evidence.holdObservation.productId !== candidate.productId ||
                  evidence.holdObservation.state !== 'unavailable' ||
                  evidence.hold.version !== 'm5-availability-hold-v2' ||
                  !isAvailabilityV2(evidence.holdObservation) ||
                  !sameAvailabilityV2(evidence.holdObservation, evidence.hold.held) ||
                  !availabilityV2HeldSafe(evidence.holdObservation) ||
                  canonicalJson(evidence.holdObservation.scope) !== canonicalJson(candidate.availabilityScope) ||
                  canonicalJson(evidence.hold) !== canonicalJson(candidate.state.hold))
            )
              throw new ActivationFenceError('Activation commit binding mismatch');
            const digest = activationDigest(evidence);
            await sql`INSERT INTO m5_activation_evidence (shop_id, config_id, operation_id, revision_id,
            installation_generation, operation_sequence, authorization_generation, authorization_epoch, selected_key_id, evidence_digest, evidence)
            VALUES (${identity.shopId}, ${identity.configId}, ${identity.operationId}, ${evidence.revisionId},
              ${evidence.installationGeneration}::bigint, ${evidence.operationSequence}::bigint, ${evidence.authorizationGeneration}::uuid,
              ${evidence.authorizationEpoch}, ${evidence.selectedKeyId}, ${digest}, ${JSON.stringify(evidence)}::jsonb)`.execute(
              tx,
            );
            await sql`UPDATE m4_publication_progress SET phase='active', activation_evidence=${digest}, version=version+1
            WHERE shop_id=${identity.shopId} AND config_id=${identity.configId} AND operation_id=${identity.operationId}`.execute(
              tx,
            );
            if (
              (await createPublicationRepository(tx).activate(
                identity.shopId,
                identity.configId,
                identity.operationId,
              )) !== 'activated'
            )
              throw new ActivationFenceError('Effective activation stale');
            await save({
              ...candidate.state,
              kind: evidence.hold ? 'RESTORATION_PENDING' : 'RESTORED',
              evidenceDigest: digest,
            });
            return digest;
          },
        };
        try {
          return await action(session);
        } finally {
          valid = false;
        }
      })
      .catch(async (error: unknown) => {
        if (error instanceof ActivationFenceError) {
          // No provider action is authorized after fencing. Retain a visible operator state,
          // including when an old-generation hold survives reinstall or supersession.
          await sql`UPDATE m5_activation_state SET kind='OPERATOR_HOLD', version=version+1
          WHERE shop_id=${identity.shopId} AND config_id=${identity.configId} AND operation_id=${identity.operationId}
            AND kind NOT IN ('RESTORED','RESOLVED','OPERATOR_HOLD')`.execute(this.database);
        }
        throw error;
      });
  }
  async read(
    identity: ActivationIdentity,
  ): Promise<{ state: ActivationState; evidence: ActivationEvidence | null } | null> {
    const rows = await sql<{
      kind: ActivationState['kind'];
      hold: ActivationState['hold'];
      evidence_digest: string | null;
      evidence: ActivationEvidence | null;
    }>`
      SELECT s.kind, s.hold, s.evidence_digest, e.evidence FROM m5_activation_state s
      LEFT JOIN m5_activation_evidence e USING (shop_id, config_id, operation_id)
      WHERE s.shop_id=${identity.shopId} AND s.config_id=${identity.configId} AND s.operation_id=${identity.operationId}`.execute(
      this.database,
    );
    const row = rows.rows[0];
    if (!row) return null;
    if (row.evidence && activationDigest(row.evidence) !== row.evidence_digest)
      throw new Error('Activation evidence digest mismatch');
    return { state: { kind: row.kind, hold: row.hold, evidenceDigest: row.evidence_digest }, evidence: row.evidence };
  }
}
