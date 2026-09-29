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
  const shop = await tx
    .selectFrom('shops')
    .innerJoin('installation_generations as i', (join) =>
      join.onRef('i.shop_id', '=', 'shops.shop_id').onRef('i.generation', '=', 'shops.current_generation'),
    )
    .select(['shops.shop_domain', 'shops.current_generation', 'i.deactivated_at'])
    .where('shops.shop_id', '=', input.shopId)
    .forUpdate('shops')
    .executeTakeFirst();
  if (!shop || shop.current_generation !== input.installationGeneration || shop.deactivated_at !== null) return null;
  return { shopDomain: shop.shop_domain };
}

export function createShopCredentialRepository(database: Kysely<Database>, keys?: CredentialKeyRing) {
  return {
    async install(input: CredentialIdentity & { pair: ExpiringOfflinePair }): Promise<string> {
      return database.transaction().execute(async (tx) => {
        if (!(await activeInstallation(tx, input))) throw new Error('Inactive installation cannot receive credentials');
        const now = await databaseNow(tx);
        validatePair(input.pair, now);
        const existing = await tx
          .selectFrom('shop_credentials')
          .select('credential_version')
          .where('shop_id', '=', input.shopId)
          .where('installation_generation', '=', input.installationGeneration)
          .forUpdate()
          .executeTakeFirst();
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
        };
        if (existing) {
          await tx
            .updateTable('shop_credentials')
            .set({ ...values, credential_version: version, refresh_claim_until: null, updated_at: now })
            .where('shop_id', '=', input.shopId)
            .where('installation_generation', '=', input.installationGeneration)
            .executeTakeFirstOrThrow();
        } else {
          await tx
            .insertInto('shop_credentials')
            .values({
              ...values,
              shop_id: input.shopId,
              installation_generation: input.installationGeneration,
              schema_version: 1,
              credential_version: version,
              refresh_claim_until: null,
              created_at: now,
              updated_at: now,
            })
            .executeTakeFirstOrThrow();
        }
        return version;
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
