import { randomUUID } from 'node:crypto';
import { type Kysely, sql, type Transaction } from 'kysely';
import type { Database } from '../client/database.js';
import { type CredentialKeyRing, openCredential, sealCredential } from '../credentials/envelope.js';

export type ExpiringOfflinePair = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  scopes: string | null;
};

export type CredentialIdentity = { shopId: string; installationGeneration: string };
export type AcquisitionIdentity = CredentialIdentity & {
  authorizationGeneration: string;
  authorizationEpoch: number;
  externalInstallationId: string;
};
export type AcquisitionAttempt = CredentialIdentity & { attemptId: string };
export type AcquisitionReservation =
  | { kind: 'reserved'; attemptId: string; shopDomain: string }
  | { kind: 'existing' | 'busy' | 'unresolved' | 'inactive' };

export type ClaimIdentity = CredentialIdentity & { claimId: string; credentialVersion: string };

export type CredentialAcquire =
  | { kind: 'usable'; accessToken: string; accessExpiresAt: Date }
  | {
      kind: 'claimed';
      shopDomain: string;
      claimId: string;
      credentialVersion: string;
      refreshToken: string;
      refreshExpiresAt: Date;
    }
  | { kind: 'busy'; retryAt: Date }
  | { kind: 'reauth_required' | 'inactive' | 'missing' };

function validatePair(pair: ExpiringOfflinePair, now: Date): void {
  if (
    !pair ||
    typeof pair.accessToken !== 'string' ||
    pair.accessToken.length < 1 ||
    pair.accessToken.length > 8192 ||
    typeof pair.refreshToken !== 'string' ||
    pair.refreshToken.length < 1 ||
    pair.refreshToken.length > 8192 ||
    !(pair.accessExpiresAt instanceof Date) ||
    !(pair.refreshExpiresAt instanceof Date) ||
    !Number.isFinite(pair.accessExpiresAt.getTime()) ||
    !Number.isFinite(pair.refreshExpiresAt.getTime()) ||
    pair.accessExpiresAt <= now ||
    pair.refreshExpiresAt <= now ||
    (pair.scopes !== null && (typeof pair.scopes !== 'string' || pair.scopes.length > 4096))
  ) {
    throw new TypeError('Invalid expiring offline credential pair');
  }
}

async function databaseNow(tx: Transaction<Database>): Promise<Date> {
  const result = await sql<{ now: Date }>`select clock_timestamp() as now`.execute(tx);
  const value = result.rows[0]?.now;
  if (!(value instanceof Date)) throw new Error('Database clock unavailable');
  return value;
}

async function activeInstallation(
  tx: Transaction<Database>,
  input: CredentialIdentity,
): Promise<{ shopDomain: string } | null> {
  // Match installation lifecycle lock order: shop first, then its generation.
  // The shop lock also serializes issuance when no credential row exists yet.
  const shop = await tx
    .selectFrom('shops')
    .select(['shop_domain', 'current_generation'])
    .where('shop_id', '=', input.shopId)
    .forUpdate()
    .executeTakeFirst();
  if (!shop || shop.current_generation !== input.installationGeneration) return null;
  const installation = await tx
    .selectFrom('installation_generations')
    .select('deactivated_at')
    .where('shop_id', '=', input.shopId)
    .where('generation', '=', input.installationGeneration)
    .forUpdate()
    .executeTakeFirst();
  if (!installation || installation.deactivated_at !== null) return null;
  return { shopDomain: shop.shop_domain };
}

async function currentAcquisition(tx: Transaction<Database>, input: CredentialIdentity) {
  return tx
    .selectFrom('shop_credential_acquisitions')
    .selectAll()
    .where('shop_id', '=', input.shopId)
    .where('installation_generation', '=', input.installationGeneration)
    .where('state', 'in', ['reserved', 'dispatched'])
    .executeTakeFirst();
}

async function acquisitionAuthority(tx: Transaction<Database>, input: AcquisitionIdentity): Promise<boolean> {
  const row = await tx
    .selectFrom('installation_generations')
    .selectAll()
    .where('shop_id', '=', input.shopId)
    .where('generation', '=', input.installationGeneration)
    .executeTakeFirst();
  return (
    !!row &&
    row.deactivated_at === null &&
    row.authorization_generation === input.authorizationGeneration &&
    row.authorization_epoch === String(input.authorizationEpoch) &&
    row.external_installation_id === input.externalInstallationId
  );
}

async function writePair(
  tx: Transaction<Database>,
  keys: CredentialKeyRing | undefined,
  input: CredentialIdentity & { pair: ExpiringOfflinePair },
  now: Date,
): Promise<string> {
  validatePair(input.pair, now);
  const existing = await tx
    .selectFrom('shop_credentials')
    .selectAll()
    .where('shop_id', '=', input.shopId)
    .where('installation_generation', '=', input.installationGeneration)
    .forUpdate()
    .executeTakeFirst();
  if (existing && existing.state !== 'reauth-required') throw new Error('Credential already active or refreshing');
  const version = existing ? (BigInt(existing.credential_version) + 1n).toString() : '1';
  const access = sealCredential(
    keys,
    input.shopId,
    input.installationGeneration,
    version,
    'access',
    input.pair.accessToken,
  );
  const refresh = sealCredential(
    keys,
    input.shopId,
    input.installationGeneration,
    version,
    'refresh',
    input.pair.refreshToken,
  );
  const values = {
    state: 'active' as const,
    access_expires_at: input.pair.accessExpiresAt,
    refresh_expires_at: input.pair.refreshExpiresAt,
    scopes: input.pair.scopes,
    wrapping_key_id: access.kid,
    access_envelope: access,
    refresh_envelope: refresh,
    refresh_claim_id: null,
    refresh_claim_until: null,
    credential_version: version,
    updated_at: now,
  };
  if (existing)
    await tx
      .updateTable('shop_credentials')
      .set(values)
      .where('shop_id', '=', input.shopId)
      .where('installation_generation', '=', input.installationGeneration)
      .execute();
  else
    await tx
      .insertInto('shop_credentials')
      .values({
        ...values,
        shop_id: input.shopId,
        installation_generation: input.installationGeneration,
        schema_version: 1,
        created_at: now,
      })
      .execute();
  return version;
}

export function createShopCredentialRepository(database: Kysely<Database>, keys?: CredentialKeyRing) {
  return {
    async install(input: CredentialIdentity & { pair: ExpiringOfflinePair }): Promise<string> {
      return database.transaction().execute(async (tx) => {
        if (!(await activeInstallation(tx, input))) throw new Error('Inactive installation cannot receive credentials');
        if (await currentAcquisition(tx, input)) throw new Error('Credential acquisition pending');
        return writePair(tx, keys, input, await databaseNow(tx));
      });
    },

    async reserveAcquisition(input: AcquisitionIdentity & { claimLeaseMs: number }): Promise<AcquisitionReservation> {
      if (!Number.isInteger(input.claimLeaseMs) || input.claimLeaseMs < 10_000 || input.claimLeaseMs > 300_000)
        throw new TypeError('Invalid acquisition claim window');
      return database.transaction().execute(async (tx) => {
        const installation = await activeInstallation(tx, input);
        if (!installation || !(await acquisitionAuthority(tx, input))) return { kind: 'inactive' };
        const now = await databaseNow(tx);
        const pending = await currentAcquisition(tx, input);
        if (pending?.state === 'dispatched') return { kind: 'unresolved' };
        if (pending && pending.reserved_until > now) return { kind: 'busy' };
        if (pending)
          await tx
            .updateTable('shop_credential_acquisitions')
            .set({ state: 'abandoned', completed_at: now })
            .where('attempt_id', '=', pending.attempt_id)
            .execute();
        const credential = await tx
          .selectFrom('shop_credentials')
          .selectAll()
          .where('shop_id', '=', input.shopId)
          .where('installation_generation', '=', input.installationGeneration)
          .forUpdate()
          .executeTakeFirst();
        if (credential && credential.state !== 'reauth-required') return { kind: 'existing' };
        // Fail before dispatch if the actual current wrapping key is absent or invalid.
        sealCredential(keys, input.shopId, input.installationGeneration, '1', 'access', 'key-check');
        const attemptId = randomUUID();
        await tx
          .insertInto('shop_credential_acquisitions')
          .values({
            attempt_id: attemptId,
            shop_id: input.shopId,
            installation_generation: input.installationGeneration,
            authorization_generation: input.authorizationGeneration,
            authorization_epoch: String(input.authorizationEpoch),
            external_installation_id: input.externalInstallationId,
            state: 'reserved',
            reserved_until: new Date(now.getTime() + input.claimLeaseMs),
            dispatched_at: null,
            completed_at: null,
          })
          .execute();
        return { kind: 'reserved', attemptId, shopDomain: installation.shopDomain };
      });
    },

    async dispatchAcquisition(input: AcquisitionAttempt): Promise<boolean> {
      return database.transaction().execute(async (tx) => {
        if (!(await activeInstallation(tx, input))) return false;
        const row = await currentAcquisition(tx, input);
        const now = await databaseNow(tx);
        if (
          !row ||
          row.attempt_id !== input.attemptId ||
          row.state !== 'reserved' ||
          row.reserved_until <= now ||
          !(await acquisitionAuthority(tx, {
            ...input,
            authorizationGeneration: row.authorization_generation,
            authorizationEpoch: Number(row.authorization_epoch),
            externalInstallationId: row.external_installation_id,
          }))
        )
          return false;
        const credential = await tx
          .selectFrom('shop_credentials')
          .select('state')
          .where('shop_id', '=', input.shopId)
          .where('installation_generation', '=', input.installationGeneration)
          .executeTakeFirst();
        if (credential && credential.state !== 'reauth-required') return false;
        sealCredential(keys, input.shopId, input.installationGeneration, '1', 'access', 'key-check');
        await tx
          .updateTable('shop_credential_acquisitions')
          .set({ state: 'dispatched', dispatched_at: now })
          .where('attempt_id', '=', row.attempt_id)
          .execute();
        return true;
      });
    },

    async completeAcquisition(
      input: AcquisitionAttempt & { pair: ExpiringOfflinePair },
    ): Promise<'installed' | 'stale' | 'inactive'> {
      return database.transaction().execute(async (tx) => {
        if (!(await activeInstallation(tx, input))) return 'inactive';
        const row = await currentAcquisition(tx, input);
        if (
          !row ||
          row.attempt_id !== input.attemptId ||
          row.state !== 'dispatched' ||
          !(await acquisitionAuthority(tx, {
            ...input,
            authorizationGeneration: row.authorization_generation,
            authorizationEpoch: Number(row.authorization_epoch),
            externalInstallationId: row.external_installation_id,
          }))
        )
          return 'stale';
        const credential = await tx
          .selectFrom('shop_credentials')
          .select('state')
          .where('shop_id', '=', input.shopId)
          .where('installation_generation', '=', input.installationGeneration)
          .executeTakeFirst();
        if (credential && credential.state !== 'reauth-required') return 'stale';
        const now = await databaseNow(tx);
        await writePair(tx, keys, input, now);
        await tx
          .updateTable('shop_credential_acquisitions')
          .set({ state: 'installed', completed_at: now })
          .where('attempt_id', '=', row.attempt_id)
          .execute();
        return 'installed';
      });
    },

    async rejectAcquisition(input: AcquisitionAttempt): Promise<boolean> {
      return database.transaction().execute(async (tx) => {
        if (!(await activeInstallation(tx, input))) return false;
        const row = await currentAcquisition(tx, input);
        if (
          !row ||
          row.attempt_id !== input.attemptId ||
          row.state !== 'dispatched' ||
          !(await acquisitionAuthority(tx, {
            ...input,
            authorizationGeneration: row.authorization_generation,
            authorizationEpoch: Number(row.authorization_epoch),
            externalInstallationId: row.external_installation_id,
          }))
        )
          return false;
        await tx
          .updateTable('shop_credential_acquisitions')
          .set({ state: 'rejected', completed_at: await databaseNow(tx) })
          .where('attempt_id', '=', row.attempt_id)
          .execute();
        return true;
      });
    },

    async acquire(
      input: CredentialIdentity & { minimumRemainingMs: number; claimLeaseMs: number },
    ): Promise<CredentialAcquire> {
      if (
        !Number.isInteger(input.minimumRemainingMs) ||
        input.minimumRemainingMs < 0 ||
        input.minimumRemainingMs > 300_000 ||
        !Number.isInteger(input.claimLeaseMs) ||
        input.claimLeaseMs < 10_000 ||
        input.claimLeaseMs > 300_000
      )
        throw new TypeError('Invalid credential validity or claim window');
      return database.transaction().execute(async (tx) => {
        const installation = await activeInstallation(tx, input);
        if (!installation) return { kind: 'inactive' };
        const pending = await currentAcquisition(tx, input);
        if (pending) return { kind: 'busy', retryAt: pending.reserved_until };
        const row = await tx
          .selectFrom('shop_credentials')
          .selectAll()
          .where('shop_id', '=', input.shopId)
          .where('installation_generation', '=', input.installationGeneration)
          .forUpdate()
          .executeTakeFirst();
        if (!row) return { kind: 'missing' };
        if (row.schema_version !== 1) throw new Error('Unsupported credential schema version');
        if (row.state === 'reauth-required' || row.state === 'revoked') return { kind: 'reauth_required' };
        const now = await databaseNow(tx);
        if (row.refresh_expires_at <= now) {
          await tx
            .updateTable('shop_credentials')
            .set({ state: 'reauth-required', refresh_claim_id: null, refresh_claim_until: null, updated_at: now })
            .where('shop_id', '=', input.shopId)
            .where('installation_generation', '=', input.installationGeneration)
            .executeTakeFirstOrThrow();
          return { kind: 'reauth_required' };
        }
        if (row.state === 'refresh-in-progress' && row.refresh_claim_until && row.refresh_claim_until > now)
          return { kind: 'busy', retryAt: row.refresh_claim_until };
        if (row.state === 'active' && row.access_expires_at.getTime() - now.getTime() > input.minimumRemainingMs) {
          return {
            kind: 'usable',
            accessToken: openCredential(
              keys,
              input.shopId,
              input.installationGeneration,
              row.credential_version,
              'access',
              row.access_envelope,
            ),
            accessExpiresAt: row.access_expires_at,
          };
        }
        const claimId = randomUUID();
        const claimUntil = new Date(now.getTime() + input.claimLeaseMs);
        const refreshToken = openCredential(
          keys,
          input.shopId,
          input.installationGeneration,
          row.credential_version,
          'refresh',
          row.refresh_envelope,
        );
        await tx
          .updateTable('shop_credentials')
          .set({
            state: 'refresh-in-progress',
            refresh_claim_id: claimId,
            refresh_claim_until: claimUntil,
            updated_at: now,
          })
          .where('shop_id', '=', input.shopId)
          .where('installation_generation', '=', input.installationGeneration)
          .executeTakeFirstOrThrow();
        return {
          kind: 'claimed',
          shopDomain: installation.shopDomain,
          claimId,
          credentialVersion: row.credential_version,
          refreshToken,
          refreshExpiresAt: row.refresh_expires_at,
        };
      });
    },

    async replaceClaim(
      input: ClaimIdentity & { pair: ExpiringOfflinePair },
    ): Promise<'replaced' | 'stale' | 'inactive'> {
      return database.transaction().execute(async (tx) => {
        if (!(await activeInstallation(tx, input))) return 'inactive';
        const row = await tx
          .selectFrom('shop_credentials')
          .selectAll()
          .where('shop_id', '=', input.shopId)
          .where('installation_generation', '=', input.installationGeneration)
          .forUpdate()
          .executeTakeFirst();
        const now = await databaseNow(tx);
        if (
          row?.state !== 'refresh-in-progress' ||
          row.credential_version !== input.credentialVersion ||
          row.refresh_claim_id !== input.claimId ||
          !row.refresh_claim_until ||
          row.refresh_claim_until <= now
        )
          return 'stale';
        validatePair(input.pair, now);
        const version = (BigInt(row.credential_version) + 1n).toString();
        const access = sealCredential(
          keys,
          input.shopId,
          input.installationGeneration,
          version,
          'access',
          input.pair.accessToken,
        );
        const refresh = sealCredential(
          keys,
          input.shopId,
          input.installationGeneration,
          version,
          'refresh',
          input.pair.refreshToken,
        );
        await tx
          .updateTable('shop_credentials')
          .set({
            credential_version: version,
            state: 'active',
            access_expires_at: input.pair.accessExpiresAt,
            refresh_expires_at: input.pair.refreshExpiresAt,
            scopes: input.pair.scopes,
            wrapping_key_id: access.kid,
            access_envelope: access,
            refresh_envelope: refresh,
            refresh_claim_id: null,
            refresh_claim_until: null,
            updated_at: now,
          })
          .where('shop_id', '=', input.shopId)
          .where('installation_generation', '=', input.installationGeneration)
          .executeTakeFirstOrThrow();
        return 'replaced';
      });
    },

    async releaseClaim(input: ClaimIdentity): Promise<boolean> {
      return database.transaction().execute(async (tx) => {
        if (!(await activeInstallation(tx, input))) return false;
        const result = await tx
          .updateTable('shop_credentials')
          .set({
            state: 'active',
            refresh_claim_id: null,
            refresh_claim_until: null,
            updated_at: sql<Date>`clock_timestamp()`,
          })
          .where('shop_id', '=', input.shopId)
          .where('installation_generation', '=', input.installationGeneration)
          .where('credential_version', '=', input.credentialVersion)
          .where('refresh_claim_id', '=', input.claimId)
          .where('state', '=', 'refresh-in-progress')
          .executeTakeFirst();
        return result.numUpdatedRows === 1n;
      });
    },

    async markReauthRequired(input: ClaimIdentity): Promise<boolean> {
      return database.transaction().execute(async (tx) => {
        if (!(await activeInstallation(tx, input))) return false;
        const result = await tx
          .updateTable('shop_credentials')
          .set({
            state: 'reauth-required',
            access_envelope: null,
            refresh_envelope: null,
            refresh_claim_id: null,
            refresh_claim_until: null,
            updated_at: sql<Date>`clock_timestamp()`,
          })
          .where('shop_id', '=', input.shopId)
          .where('installation_generation', '=', input.installationGeneration)
          .where('credential_version', '=', input.credentialVersion)
          .where('refresh_claim_id', '=', input.claimId)
          .where('state', '=', 'refresh-in-progress')
          .executeTakeFirst();
        return result.numUpdatedRows === 1n;
      });
    },

    async metadata(input: CredentialIdentity) {
      return database
        .selectFrom('shop_credentials')
        .select([
          'shop_id',
          'installation_generation',
          'schema_version',
          'credential_version',
          'state',
          'access_expires_at',
          'refresh_expires_at',
          'scopes',
          'wrapping_key_id',
          'refresh_claim_until',
        ])
        .where('shop_id', '=', input.shopId)
        .where('installation_generation', '=', input.installationGeneration)
        .executeTakeFirst();
    },
  };
}
