import {
  buildProductPolicyProjection,
  buildPublicConfig,
  newOutboxEvent,
  type ProductPolicyMode,
  publicKeyFingerprint,
} from '@insignia/application';
import { type Kysely, sql } from 'kysely';
import type { Database } from '../client/database.js';
import { PgOutboxRepository } from './delivery/pg-outbox-repository.js';
import { createPublicationRepository } from './publication.js';

type Field = 'public_config' | 'registration' | 'policy';
type Tenant = {
  shopId: string;
  installationGeneration: string;
  shopifyShopId: string;
  appId: string;
};
type Target = Tenant & { field: Field; productId?: string };
type Observed = { ownerId: string; namespace: string; key: string; type: string; value: string; compareDigest: string };
export type ProductionPublicationRemote = {
  read(target: Target): Promise<Observed | null>;
  set(target: Target & { value: string; compareDigest: string | null }): Promise<{ observed: Observed }>;
};
type Projection = {
  version: 'm4-publication-v1';
  productId: string;
  shopifyShopId: string;
  generationHex: string;
  epoch: number;
  mode: ProductPolicyMode;
  publicConfig: string;
  registrationPending: string;
  registrationReady: string;
  policy: string;
};
type ProgressPhase =
  | 'prepared'
  | 'shop-config-written'
  | 'pending-written'
  | 'policy-written'
  | 'ready-written'
  | 'activation-pending'
  | 'conflict'
  | 'operator-hold'
  | 'active';
type Progress = {
  phase: ProgressPhase;
  version: string;
  mode: ProductPolicyMode;
  prior_registration_digest: string | null;
  prior_policy_digest: string | null;
  prior_public_config_digest: string | null;
  prior_mode: ProductPolicyMode | null;
  retry_count: number;
};
type Stored = {
  operation: {
    shopId: string;
    configId: string;
    operationId: string;
    revisionId: string;
    installationGeneration: string;
    operationSequence: string;
    expectedProjection: unknown;
  };
  progress: Progress;
};
export type PublicationAdvanceResult =
  | { kind: 'PENDING'; phase: ProgressPhase }
  | { kind: 'ACTIVE'; phase: 'active' }
  | { kind: 'ADMISSION_PENDING'; phase: ProgressPhase }
  | { kind: 'REMOTE_READY_ACTIVATION_PENDING'; phase: 'activation-pending' }
  | { kind: 'CONFLICT' | 'OPERATOR_HOLD'; phase: ProgressPhase };

const uuidHex = (uuid: string) => uuid.replaceAll('-', '');
const productGid = (id: string) => `gid://shopify/Product/${id}`;
function projection(value: unknown): Projection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Publication projection missing');
  const p = value as Partial<Projection>;
  if (
    p.version !== 'm4-publication-v1' ||
    !/^[1-9][0-9]*$/.test(p.productId ?? '') ||
    !/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(p.shopifyShopId ?? '') ||
    !/^[0-9a-f]{32}$/.test(p.generationHex ?? '') ||
    !Number.isSafeInteger(p.epoch) ||
    (p.mode !== 'required' && p.mode !== 'optional') ||
    typeof p.publicConfig !== 'string' ||
    typeof p.registrationPending !== 'string' ||
    typeof p.registrationReady !== 'string' ||
    typeof p.policy !== 'string'
  )
    throw new Error('Publication projection malformed');
  return p as Projection;
}
function exact(observed: Observed | null, target: Target, expected: string): boolean {
  if (!observed) return false;
  const key =
    target.field === 'public_config'
      ? 'insignia_public_config_v2'
      : target.field === 'registration'
        ? 'insignia_registration_v2'
        : 'insignia_policy_v2';
  const ownerId = target.field === 'public_config' ? target.shopifyShopId : target.productId;
  return (
    observed.ownerId === ownerId &&
    observed.namespace === `app--${target.appId}` &&
    observed.key === key &&
    observed.type === (target.field === 'public_config' ? 'json' : 'single_line_text_field') &&
    observed.value === expected &&
    /^[a-f0-9]{64}$/.test(observed.compareDigest)
  );
}
function parsePrior(
  registration: Observed | null,
  policy: Observed | null,
  generationHex: string,
): ProductPolicyMode | null {
  if (!registration && !policy) return null;
  if (!registration || !policy) throw new Error('Partial product enforcement anchors require operator hold');
  const r = /^([0-9a-f]{32}):([1-9][0-9]*):ready$/.exec(registration.value);
  const p = /^([0-9a-f]{32}):([1-9][0-9]*):(required|optional)$/.exec(policy.value);
  if (!r || !p || r[1] !== generationHex || p[1] !== generationHex || r[2] !== p[2])
    throw new Error('Product enforcement anchors drifted or belong to another installation');
  return p[3] as ProductPolicyMode;
}

/** One production seam: callers select immutable revision and mode, never remote values. */
export class PgProductionPublication {
  constructor(
    private readonly database: Kysely<Database>,
    private readonly remote: ProductionPublicationRemote,
    private readonly appId: string,
    private readonly admission?: {
      established(input: {
        productId: string;
        priorMode: ProductPolicyMode | null;
        nextMode: ProductPolicyMode;
      }): Promise<boolean>;
    },
  ) {
    if (!/^[1-9][0-9]*$/.test(appId)) throw new Error('Invalid trusted app identity');
  }

  private async load(
    shopId: string,
    configId: string,
    operationId: string,
    database: Kysely<Database> = this.database,
  ): Promise<Stored | null> {
    const result = await sql<{
      shop_id: string;
      config_id: string;
      operation_id: string;
      revision_id: string;
      installation_generation: string;
      operation_sequence: string;
      expected_projection: unknown;
      phase: ProgressPhase;
      version: string;
      mode: ProductPolicyMode;
      prior_registration_digest: string | null;
      prior_policy_digest: string | null;
      prior_public_config_digest: string | null;
      prior_mode: ProductPolicyMode | null;
      retry_count: number;
    }>`SELECT o.shop_id, o.config_id, o.operation_id, o.revision_id,
      o.installation_generation::text, o.operation_sequence::text, o.expected_projection,
      p.phase, p.version::text, p.mode, p.prior_registration_digest, p.prior_policy_digest,
      p.prior_public_config_digest, p.prior_mode, p.retry_count
      FROM publication_operations o JOIN m4_publication_progress p USING (shop_id, config_id, operation_id)
      WHERE o.shop_id=${shopId} AND o.config_id=${configId} AND o.operation_id=${operationId}`.execute(database);
    const row = result.rows[0];
    return row
      ? {
          operation: {
            shopId: row.shop_id,
            configId: row.config_id,
            operationId: row.operation_id,
            revisionId: row.revision_id,
            installationGeneration: row.installation_generation,
            operationSequence: row.operation_sequence,
            expectedProjection: row.expected_projection,
          },
          progress: row,
        }
      : null;
  }

  private target(tenant: Tenant, field: Field, productId: string): Target {
    return field === 'public_config' ? { ...tenant, field } : { ...tenant, field, productId: productGid(productId) };
  }

  async prepare(input: {
    shopId: string;
    configId: string;
    revisionId: string;
    operationId: string;
    mode: ProductPolicyMode;
  }): Promise<{ operationId: string; phase: ProgressPhase }> {
    if (
      !input.shopId ||
      !input.configId ||
      !input.revisionId ||
      !input.operationId ||
      input.operationId.length > 128 ||
      (input.mode !== 'required' && input.mode !== 'optional')
    )
      throw new Error('Invalid publication request');
    const existing = await this.load(input.shopId, input.configId, input.operationId);
    if (existing) {
      if (existing.operation.revisionId !== input.revisionId || existing.progress.mode !== input.mode)
        throw new Error('Publication operation idempotency conflict');
      return { operationId: input.operationId, phase: existing.progress.phase };
    }
    const preliminary = await sql<{
      generation: string;
      authorization_generation: string;
      authorization_epoch: string;
      shopify_shop_id: string;
      product_id: string;
      publication_sequence: string;
      effective_operation_id: string | null;
    }>`SELECT s.current_generation::text AS generation,
      i.authorization_generation::text, i.authorization_epoch::text, s.shopify_shop_id,
      c.external_product_id AS product_id, c.publication_sequence::text, c.effective_operation_id
      FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
      JOIN product_configs c ON c.shop_id=s.shop_id
      JOIN config_revisions r ON r.shop_id=c.shop_id AND r.config_id=c.config_id
      WHERE s.shop_id=${input.shopId} AND c.config_id=${input.configId} AND r.revision_id=${input.revisionId}
        AND i.deactivated_at IS NULL`.execute(this.database);
    const first = preliminary.rows[0];
    if (!first?.shopify_shop_id || !/^[1-9][0-9]*$/.test(first.product_id))
      throw new Error('Active installation and immutable Shopify Product revision required');
    const tenant: Tenant = {
      shopId: input.shopId,
      installationGeneration: first.generation,
      shopifyShopId: `gid://shopify/Shop/${first.shopify_shop_id}`,
      appId: this.appId,
    };
    const productId = first.product_id;
    const [priorConfig, priorRegistration, priorPolicy] = await Promise.all([
      this.remote.read(this.target(tenant, 'public_config', productId)),
      this.remote.read(this.target(tenant, 'registration', productId)),
      this.remote.read(this.target(tenant, 'policy', productId)),
    ]);
    const priorMode = parsePrior(priorRegistration, priorPolicy, uuidHex(first.authorization_generation));
    if ((first.effective_operation_id === null) !== (priorMode === null))
      throw new Error('Remote product management state conflicts with durable effective record');
    if (first.effective_operation_id) {
      const prior = await sql<{ expected_projection: unknown; operation_sequence: string; status: string }>`
        SELECT expected_projection, operation_sequence::text, status FROM publication_operations
        WHERE shop_id=${input.shopId} AND config_id=${input.configId}
          AND operation_id=${first.effective_operation_id}`.execute(this.database);
      const effective = prior.rows[0];
      if (effective?.status !== 'activated' || effective.operation_sequence !== first.publication_sequence)
        throw new Error('Durable effective publication is not coherent');
      const old = projection(effective.expected_projection);
      if (
        old.productId !== productId ||
        old.shopifyShopId !== tenant.shopifyShopId ||
        old.generationHex !== uuidHex(first.authorization_generation) ||
        old.mode !== priorMode ||
        !exact(priorRegistration, this.target(tenant, 'registration', productId), old.registrationReady) ||
        !exact(priorPolicy, this.target(tenant, 'policy', productId), old.policy)
      )
        throw new Error('Remote product policy differs from durable effective publication');
    }

    return this.database.transaction().execute(async (tx) => {
      const locked = await sql<{
        generation: string;
        authorization_generation: string;
        authorization_epoch: string;
        shopify_shop_id: string;
        product_id: string;
        publication_sequence: string;
        effective_operation_id: string | null;
        revision_id: string;
      }>`SELECT s.current_generation::text AS generation, i.authorization_generation::text,
        i.authorization_epoch::text, s.shopify_shop_id, c.external_product_id AS product_id,
        c.publication_sequence::text, c.effective_operation_id, r.revision_id
        FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
        JOIN product_configs c ON c.shop_id=s.shop_id
        JOIN config_revisions r ON r.shop_id=c.shop_id AND r.config_id=c.config_id
        WHERE s.shop_id=${input.shopId} AND c.config_id=${input.configId} AND r.revision_id=${input.revisionId}
          AND i.deactivated_at IS NULL FOR UPDATE OF s, i, c`.execute(tx);
      const row = locked.rows[0];
      if (
        !row ||
        row.generation !== first.generation ||
        row.authorization_generation !== first.authorization_generation ||
        row.authorization_epoch !== first.authorization_epoch ||
        row.shopify_shop_id !== first.shopify_shop_id ||
        row.product_id !== productId ||
        row.effective_operation_id !== first.effective_operation_id
      )
        throw new Error('Publication installation or revision changed while preparing');
      const replay = await sql<{ revision_id: string; mode: ProductPolicyMode; phase: ProgressPhase }>`
        SELECT o.revision_id, p.mode, p.phase FROM publication_operations o
        JOIN m4_publication_progress p USING (shop_id, config_id, operation_id)
        WHERE o.shop_id=${input.shopId} AND o.config_id=${input.configId}
          AND o.operation_id=${input.operationId}`.execute(tx);
      if (replay.rows[0]) {
        if (replay.rows[0].revision_id !== input.revisionId || replay.rows[0].mode !== input.mode)
          throw new Error('Publication operation idempotency conflict');
        return { operationId: input.operationId, phase: replay.rows[0].phase };
      }
      const open = await sql<{ operation_id: string }>`SELECT p.operation_id FROM m4_publication_progress p
        JOIN publication_operations o USING (shop_id, config_id, operation_id)
        WHERE p.shop_id=${input.shopId} AND p.config_id=${input.configId}
          AND p.phase NOT IN ('active','conflict','operator-hold')
        LIMIT 1`.execute(tx);
      if (open.rows[0]) throw new Error('Another publication is pending');
      const priorRevision = priorRegistration?.value.split(':')[1];
      const nextSequence = (BigInt(row.publication_sequence) + 1n).toString();
      if (priorRevision && BigInt(priorRevision) >= BigInt(nextSequence))
        throw new Error('Remote publication revision is not older than durable sequence');
      const keys = await sql<{
        key_id: number;
        public_key: Buffer;
        public_key_fingerprint: string;
        state: 'pending' | 'active' | 'retiring' | 'revoked' | 'destroyed';
        first_valid_day: number;
        last_valid_day: number;
      }>`SELECT key_id, public_key, public_key_fingerprint, state, first_valid_day, last_valid_day
        FROM signing_keys WHERE shop_id=${input.shopId} AND installation_generation=${row.generation}::bigint
          AND authorization_generation=${row.authorization_generation}::uuid ORDER BY key_id`.execute(tx);
      for (const key of keys.rows)
        if (publicKeyFingerprint(key.public_key) !== key.public_key_fingerprint)
          throw new Error('Durable public signing key fingerprint drift');
      const publicConfig = buildPublicConfig({
        scope: {
          shopId: input.shopId,
          installationGeneration: row.generation,
          authorizationGeneration: row.authorization_generation,
          authorizationEpoch: Number(row.authorization_epoch),
        },
        keys: keys.rows.map((key) => ({
          id: key.key_id,
          publicKey: key.public_key,
          state: key.state,
          firstDay: key.first_valid_day,
          lastDay: key.last_valid_day,
        })),
      });
      const product = buildProductPolicyProjection({
        authorizationGeneration: row.authorization_generation,
        publicationSequence: nextSequence,
        mode: input.mode,
      });
      const expected: Projection = {
        version: 'm4-publication-v1',
        productId,
        shopifyShopId: tenant.shopifyShopId,
        generationHex: uuidHex(row.authorization_generation),
        epoch: Number(row.authorization_epoch),
        mode: input.mode,
        publicConfig: publicConfig.value,
        ...product,
      };
      const operation = await createPublicationRepository(tx).request({
        shopId: input.shopId,
        configId: input.configId,
        operationId: input.operationId,
        revisionId: input.revisionId,
        installationGeneration: row.generation,
        expectedProjection: expected,
      });
      await sql`INSERT INTO m4_publication_progress (shop_id, config_id, operation_id, mode,
        prior_registration_digest, prior_policy_digest, prior_public_config_digest, prior_mode)
        VALUES (${input.shopId}, ${input.configId}, ${input.operationId}, ${input.mode},
          ${priorRegistration?.compareDigest ?? null}, ${priorPolicy?.compareDigest ?? null},
          ${priorConfig?.compareDigest ?? null}, ${priorMode})`.execute(tx);
      const now = new Date();
      await new PgOutboxRepository(this.database).add(
        tx,
        newOutboxEvent({
          shopId: input.shopId,
          installationGeneration: row.generation,
          eventType: 'publication.requested',
          schemaVersion: 1,
          aggregateRef: input.configId,
          payload: {
            configId: input.configId,
            revisionId: input.revisionId,
            operationId: input.operationId,
            expectedProjectionDigest: operation.expectedProjectionDigest,
          },
          businessKey: input.operationId,
          occurredAt: now,
          availableAt: now,
          retentionClass: 'publication-intent',
          purgeAfter: new Date(now.getTime() + 180 * 86400000),
        }),
      );
      return { operationId: input.operationId, phase: 'prepared' as const };
    });
  }

  private async save(
    input: Stored,
    phase: ProgressPhase,
    observed: unknown,
    retries = 0,
    database: Kysely<Database> = this.database,
  ): Promise<boolean> {
    const result = await sql`UPDATE m4_publication_progress SET phase=${phase}, version=version+1,
      last_observed=${JSON.stringify(observed)}::jsonb, last_observed_at=clock_timestamp(), retry_count=${retries}
      WHERE shop_id=${input.operation.shopId} AND config_id=${input.operation.configId}
        AND operation_id=${input.operation.operationId} AND version=${input.progress.version}::bigint`.execute(
      database,
    );
    return result.numAffectedRows === 1n;
  }

  private async current(input: Stored, database: Kysely<Database> = this.database): Promise<boolean> {
    const result = await sql<{ generation: string; authorization_generation: string; epoch: string; sequence: string }>`
      SELECT s.current_generation::text AS generation, i.authorization_generation::text,
        i.authorization_epoch::text AS epoch, c.publication_sequence::text AS sequence
      FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
      JOIN product_configs c ON c.shop_id=s.shop_id
      WHERE s.shop_id=${input.operation.shopId} AND c.config_id=${input.operation.configId}
        AND i.deactivated_at IS NULL`.execute(database);
    const row = result.rows[0];
    const expected = projection(input.operation.expectedProjection);
    if (
      !(
        row &&
        row.generation === input.operation.installationGeneration &&
        row.authorization_generation.replaceAll('-', '') === expected.generationHex &&
        Number(row.epoch) === expected.epoch &&
        row.sequence === input.operation.operationSequence
      )
    )
      return false;
    const keys = await sql<{
      key_id: number;
      public_key: Buffer;
      public_key_fingerprint: string;
      state: 'pending' | 'active' | 'retiring' | 'revoked' | 'destroyed';
      first_valid_day: number;
      last_valid_day: number;
    }>`SELECT key_id, public_key, public_key_fingerprint, state, first_valid_day, last_valid_day
      FROM signing_keys WHERE shop_id=${input.operation.shopId}
        AND installation_generation=${row.generation}::bigint
        AND authorization_generation=${row.authorization_generation}::uuid
      ORDER BY key_id`.execute(database);
    if (keys.rows.some((key) => publicKeyFingerprint(key.public_key) !== key.public_key_fingerprint)) return false;
    const currentConfig = buildPublicConfig({
      scope: {
        shopId: input.operation.shopId,
        installationGeneration: row.generation,
        authorizationGeneration: row.authorization_generation,
        authorizationEpoch: Number(row.epoch),
      },
      keys: keys.rows.map((key) => ({
        id: key.key_id,
        publicKey: key.public_key,
        state: key.state,
        firstDay: key.first_valid_day,
        lastDay: key.last_valid_day,
      })),
    });
    return currentConfig.value === expected.publicConfig;
  }

  private async observe(tenant: Tenant, productId: string) {
    const [publicConfig, registration, policy] = await Promise.all([
      this.remote.read(this.target(tenant, 'public_config', productId)),
      this.remote.read(this.target(tenant, 'registration', productId)),
      this.remote.read(this.target(tenant, 'policy', productId)),
    ]);
    return { publicConfig, registration, policy };
  }

  async advance(shopId: string, configId: string, operationId: string): Promise<PublicationAdvanceResult> {
    return this.database.transaction().execute(async (tx) => {
      // Serialize bounded provider dispatch with key, epoch, installation and publication changes.
      await sql`SELECT s.shop_id FROM shops s
      JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
      JOIN product_configs c ON c.shop_id=s.shop_id
      WHERE s.shop_id=${shopId} AND c.config_id=${configId}
      FOR UPDATE OF s, i, c`.execute(tx);
      const stored = await this.load(shopId, configId, operationId, tx);
      if (!stored) return { kind: 'OPERATOR_HOLD', phase: 'operator-hold' };
      const { operation, progress } = stored;
      const hold = async (observed: unknown): Promise<PublicationAdvanceResult> => {
        if (!(await this.save(stored, 'operator-hold', observed, 0, tx)))
          return { kind: 'CONFLICT', phase: progress.phase };
        return { kind: 'OPERATOR_HOLD', phase: 'operator-hold' };
      };
      if (progress.phase === 'conflict') return { kind: 'CONFLICT', phase: progress.phase };
      if (progress.phase === 'operator-hold') return { kind: 'OPERATOR_HOLD', phase: progress.phase };
      if (progress.phase === 'active') {
        if (!(await this.current(stored, tx))) return { kind: 'OPERATOR_HOLD', phase: 'active' };
        const activated = await sql<{ status: string; effective_operation_id: string | null }>`
          SELECT o.status, c.effective_operation_id FROM publication_operations o
          JOIN product_configs c ON c.shop_id=o.shop_id AND c.config_id=o.config_id
          WHERE o.shop_id=${shopId} AND o.config_id=${configId} AND o.operation_id=${operationId}`.execute(tx);
        if (activated.rows[0]?.status !== 'activated' || activated.rows[0]?.effective_operation_id !== operationId)
          return { kind: 'OPERATOR_HOLD', phase: 'active' };
        const expectedActive = projection(operation.expectedProjection);
        const observedActive = await this.observe(
          {
            shopId,
            installationGeneration: operation.installationGeneration,
            shopifyShopId: expectedActive.shopifyShopId,
            appId: this.appId,
          },
          expectedActive.productId,
        );
        const tenant = {
          shopId,
          installationGeneration: operation.installationGeneration,
          shopifyShopId: expectedActive.shopifyShopId,
          appId: this.appId,
        };
        return exact(
          observedActive.publicConfig,
          this.target(tenant, 'public_config', expectedActive.productId),
          expectedActive.publicConfig,
        ) &&
          exact(
            observedActive.registration,
            this.target(tenant, 'registration', expectedActive.productId),
            expectedActive.registrationReady,
          ) &&
          exact(observedActive.policy, this.target(tenant, 'policy', expectedActive.productId), expectedActive.policy)
          ? { kind: 'ACTIVE', phase: 'active' }
          : { kind: 'OPERATOR_HOLD', phase: 'active' };
      }
      if (!(await this.current(stored, tx))) return hold(null);
      const expected = projection(operation.expectedProjection);
      const tenant: Tenant = {
        shopId,
        installationGeneration: operation.installationGeneration,
        shopifyShopId: expected.shopifyShopId,
        appId: this.appId,
      };
      const productId = expected.productId;
      if (progress.prior_mode === null || progress.prior_mode !== progress.mode) {
        const established = this.admission
          ? await this.admission.established({
              productId: productGid(productId),
              priorMode: progress.prior_mode,
              nextMode: progress.mode,
            })
          : false;
        if (!established) return { kind: 'ADMISSION_PENDING', phase: progress.phase };
      }
      const remote = await this.observe(tenant, productId);
      const byField = {
        public_config: remote.publicConfig,
        registration: remote.registration,
        policy: remote.policy,
      };
      const desired =
        progress.phase === 'prepared'
          ? {
              field: 'public_config' as const,
              value: expected.publicConfig,
              prior: progress.prior_public_config_digest,
              next: 'shop-config-written' as const,
            }
          : progress.phase === 'shop-config-written'
            ? {
                field: 'registration' as const,
                value: expected.registrationPending,
                prior: progress.prior_registration_digest,
                next: 'pending-written' as const,
              }
            : progress.phase === 'pending-written'
              ? {
                  field: 'policy' as const,
                  value: expected.policy,
                  prior: progress.prior_policy_digest,
                  next: 'policy-written' as const,
                }
              : progress.phase === 'policy-written'
                ? {
                    field: 'registration' as const,
                    value: expected.registrationReady,
                    prior: remote.registration?.compareDigest ?? null,
                    next: 'ready-written' as const,
                  }
                : null;
      if (!desired) {
        if (
          !exact(remote.publicConfig, this.target(tenant, 'public_config', productId), expected.publicConfig) ||
          !exact(remote.registration, this.target(tenant, 'registration', productId), expected.registrationReady) ||
          !exact(remote.policy, this.target(tenant, 'policy', productId), expected.policy)
        )
          return hold(remote);
        if (progress.phase === 'ready-written') {
          if (!(await this.current(stored, tx))) return hold(remote);
          const journal = createPublicationRepository(tx);
          const acknowledged = await journal.acknowledge(shopId, configId, operationId);
          if (acknowledged !== 'acknowledged') throw new Error('M3 publication acknowledgement stale');
          const observed = await journal.observe({ shopId, configId, operationId, projection: expected });
          if (observed !== 'observed') throw new Error('M3 publication projection mismatch');
          if (!(await this.save(stored, 'activation-pending', remote, 0, tx)))
            return { kind: 'CONFLICT', phase: progress.phase };
        }
        return { kind: 'REMOTE_READY_ACTIVATION_PENDING', phase: 'activation-pending' };
      }
      const target = this.target(tenant, desired.field, productId);
      const actual = byField[desired.field];
      if (
        desired.field === 'policy' &&
        !exact(remote.registration, this.target(tenant, 'registration', productId), expected.registrationPending)
      )
        return hold(remote);
      if (
        desired.field === 'registration' &&
        progress.phase === 'policy-written' &&
        (!exact(remote.policy, this.target(tenant, 'policy', productId), expected.policy) ||
          (!exact(remote.registration, this.target(tenant, 'registration', productId), expected.registrationPending) &&
            !exact(remote.registration, this.target(tenant, 'registration', productId), expected.registrationReady)))
      )
        return hold(remote);
      if (!exact(actual, target, desired.value)) {
        if ((actual?.compareDigest ?? null) !== desired.prior) {
          await this.save(stored, 'conflict', remote, 0, tx);
          return { kind: 'CONFLICT', phase: 'conflict' };
        }
        if (!(await this.current(stored, tx))) return hold(remote);
        try {
          const written = await this.remote.set({ ...target, value: desired.value, compareDigest: desired.prior });
          if (!exact(written.observed, target, desired.value)) throw new Error('Exact Admin readback failed');
        } catch (error) {
          const kind = error && typeof error === 'object' && 'kind' in error ? (error as { kind: unknown }).kind : null;
          if (kind === 'cas_conflict') {
            await this.save(stored, 'conflict', remote, 0, tx);
            return { kind: 'CONFLICT', phase: 'conflict' };
          }
          if (kind === 'network_or_timeout' || kind === 'ambiguous_write' || kind === 'provider_unavailable') {
            const retries = progress.retry_count + 1;
            if (retries >= 3) {
              await this.save(stored, 'operator-hold', remote, retries, tx);
              return { kind: 'OPERATOR_HOLD', phase: 'operator-hold' };
            }
            await this.save(stored, progress.phase, remote, retries, tx);
            return { kind: 'PENDING', phase: progress.phase };
          }
          await this.save(stored, 'operator-hold', remote, 0, tx);
          return { kind: 'OPERATOR_HOLD', phase: 'operator-hold' };
        }
      }
      const readback = await this.observe(tenant, productId);
      const done =
        desired.field === 'public_config'
          ? readback.publicConfig
          : desired.field === 'registration'
            ? readback.registration
            : readback.policy;
      if (!exact(done, target, desired.value)) return hold(readback);
      if (!(await this.save(stored, desired.next, readback, 0, tx))) return { kind: 'CONFLICT', phase: progress.phase };
      return { kind: 'PENDING', phase: desired.next };
    });
  }
}
