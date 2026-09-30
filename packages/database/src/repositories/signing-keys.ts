import { type Kysely, sql, type Transaction } from 'kysely';
import type { Database } from '../client/database.js';

export type StoredSigningKey = {
  shopId: string;
  installationGeneration: string;
  authorizationGeneration: string;
  keyId: number;
  id: number;
  publicKey: Buffer;
  publicKeyFingerprint: string;
  privateEnvelope: unknown | null;
  wrappingKeyId: string | null;
  state: 'pending' | 'active' | 'retiring' | 'revoked' | 'destroyed';
  firstDay: number;
  lastDay: number;
  createdAt: Date;
  retiredAt: Date | null;
  revokedAt: Date | null;
};
type Scope = {
  shopId: string;
  installationGeneration: string;
  authorizationGeneration: string;
  authorizationEpoch: number;
};
type KeyRow = {
  shop_id: string;
  installation_generation: string;
  authorization_generation: string;
  key_id: number;
  public_key: Buffer;
  public_key_fingerprint: string;
  private_envelope: unknown | null;
  wrapping_key_id: string | null;
  state: StoredSigningKey['state'];
  first_valid_day: number;
  last_valid_day: number;
  created_at: Date;
  retired_at: Date | null;
  revoked_at: Date | null;
};
function mapKey(row: KeyRow): StoredSigningKey {
  return {
    shopId: row.shop_id,
    installationGeneration: row.installation_generation,
    authorizationGeneration: row.authorization_generation,
    keyId: row.key_id,
    id: row.key_id,
    publicKey: row.public_key,
    publicKeyFingerprint: row.public_key_fingerprint,
    privateEnvelope: row.private_envelope,
    wrappingKeyId: row.wrapping_key_id,
    state: row.state,
    firstDay: row.first_valid_day,
    lastDay: row.last_valid_day,
    createdAt: row.created_at,
    retiredAt: row.retired_at,
    revokedAt: row.revoked_at,
  };
}
async function lockScope(tx: Transaction<Database>, shopId: string, generation: string): Promise<Scope> {
  const result = await sql<{
    shop_id: string;
    installation_generation: string;
    authorization_generation: string;
    authorization_epoch: string;
  }>`
    SELECT s.shop_id, s.current_generation::text AS installation_generation,
      i.authorization_generation::text AS authorization_generation, i.authorization_epoch::text AS authorization_epoch
    FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
    WHERE s.shop_id=${shopId} AND s.current_generation=${generation}::bigint AND i.deactivated_at IS NULL
      AND s.shopify_shop_id IS NOT NULL FOR UPDATE OF s, i`.execute(tx);
  const row = result.rows[0];
  if (!row) throw new Error('Inactive signing installation');
  return {
    shopId: row.shop_id,
    installationGeneration: row.installation_generation,
    authorizationGeneration: row.authorization_generation,
    authorizationEpoch: Number(row.authorization_epoch),
  };
}
function sameScope(a: Scope, b: Scope): void {
  if (
    a.shopId !== b.shopId ||
    a.installationGeneration !== b.installationGeneration ||
    a.authorizationGeneration !== b.authorizationGeneration ||
    a.authorizationEpoch !== b.authorizationEpoch
  )
    throw new Error('Stale authorization identity');
}
function checkedId(keyId: number): void {
  if (!Number.isInteger(keyId) || keyId < 1 || keyId > 65535) throw new TypeError('Invalid signing key ID');
}

/** All writes hold the shop and active installation locks until commit. */
export class PgSigningKeyRepository {
  constructor(private readonly database: Kysely<Database>) {}

  async getActiveScope(shopId: string, installationGeneration: string): Promise<Scope | null> {
    const row = await sql<{
      shop_id: string;
      installation_generation: string;
      authorization_generation: string;
      authorization_epoch: string;
    }>`
      SELECT s.shop_id, s.current_generation::text AS installation_generation,
        i.authorization_generation::text AS authorization_generation, i.authorization_epoch::text AS authorization_epoch
      FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
      WHERE s.shop_id=${shopId} AND s.current_generation=${installationGeneration}::bigint AND i.deactivated_at IS NULL
        AND s.shopify_shop_id IS NOT NULL`.execute(this.database);
    const value = row.rows[0];
    return value
      ? {
          shopId: value.shop_id,
          installationGeneration: value.installation_generation,
          authorizationGeneration: value.authorization_generation,
          authorizationEpoch: Number(value.authorization_epoch),
        }
      : null;
  }

  async list(scope: Scope): Promise<StoredSigningKey[]> {
    const active = await this.getActiveScope(scope.shopId, scope.installationGeneration);
    if (!active) throw new Error('Inactive signing installation');
    sameScope(active, scope);
    const result = await sql<KeyRow>`SELECT * FROM signing_keys WHERE shop_id=${scope.shopId}
      AND installation_generation=${scope.installationGeneration}::bigint AND authorization_generation=${scope.authorizationGeneration}::uuid
      ORDER BY key_id`.execute(this.database);
    return result.rows.map(mapKey);
  }

  async createPending(input: {
    scope: Scope;
    keyId: number;
    publicKey: Uint8Array;
    publicKeyFingerprint: string;
    privateEnvelope: unknown;
    wrappingKeyId: string;
    firstDay: number;
    lastDay: number;
  }): Promise<void> {
    checkedId(input.keyId);
    if (
      input.publicKey.byteLength !== 32 ||
      !/^[0-9a-f]{64}$/.test(input.publicKeyFingerprint) ||
      !Number.isInteger(input.firstDay) ||
      !Number.isInteger(input.lastDay) ||
      input.firstDay < 0 ||
      input.lastDay > 0xffffffff ||
      input.firstDay > input.lastDay ||
      !input.wrappingKeyId ||
      !input.privateEnvelope
    )
      throw new TypeError('Invalid pending signing key');
    await this.database.transaction().execute(async (tx) => {
      sameScope(await lockScope(tx, input.scope.shopId, input.scope.installationGeneration), input.scope);
      await sql`INSERT INTO signing_keys (shop_id, installation_generation, authorization_generation, key_id,
        public_key, public_key_fingerprint, private_envelope, wrapping_key_id, state, first_valid_day, last_valid_day)
        VALUES (${input.scope.shopId}, ${input.scope.installationGeneration}::bigint, ${input.scope.authorizationGeneration}::uuid,
          ${input.keyId}, ${Buffer.from(input.publicKey)}, ${input.publicKeyFingerprint}, ${JSON.stringify(input.privateEnvelope)}::jsonb,
          ${input.wrappingKeyId}, 'pending', ${input.firstDay}, ${input.lastDay})`.execute(tx);
    });
  }

  async activate(scope: Scope, keyId: number): Promise<void> {
    checkedId(keyId);
    await this.database.transaction().execute(async (tx) => {
      sameScope(await lockScope(tx, scope.shopId, scope.installationGeneration), scope);
      const old =
        await sql<KeyRow>`SELECT * FROM signing_keys WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint AND state='active' FOR UPDATE`.execute(
          tx,
        );
      if (old.rows[0]?.key_id === keyId) return;
      const target =
        await sql<KeyRow>`SELECT * FROM signing_keys WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint AND key_id=${keyId} FOR UPDATE`.execute(
          tx,
        );
      const key = target.rows[0];
      if (
        !key ||
        key.authorization_generation !== scope.authorizationGeneration ||
        key.state !== 'pending' ||
        !key.private_envelope
      )
        throw new Error('Pending signing key required');
      if (old.rows[0])
        await sql`UPDATE signing_keys SET state='retiring', retired_at=clock_timestamp() WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint AND key_id=${old.rows[0].key_id}`.execute(
          tx,
        );
      await sql`UPDATE signing_keys SET state='active', activated_at=clock_timestamp() WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint AND key_id=${keyId}`.execute(
        tx,
      );
    });
  }

  async revoke(scope: Scope, keyId: number, commandKey: string, reason: string): Promise<void> {
    checkedId(keyId);
    if (!commandKey || commandKey.length > 200 || !reason.trim() || reason.length > 500)
      throw new TypeError('Auditable revocation command required');
    await this.database.transaction().execute(async (tx) => {
      sameScope(await lockScope(tx, scope.shopId, scope.installationGeneration), scope);
      const result =
        await sql`UPDATE signing_keys SET state='revoked', revoked_at=clock_timestamp(), revocation_command_key=${commandKey}, revocation_reason=${reason}
        WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint AND key_id=${keyId}
          AND authorization_generation=${scope.authorizationGeneration}::uuid AND state IN ('pending','active','retiring')`.execute(
          tx,
        );
      if (result.numAffectedRows !== 1n) throw new Error('Revocable signing key required');
    });
  }

  async destroy(scope: Scope, keyId: number): Promise<void> {
    checkedId(keyId);
    await this.database.transaction().execute(async (tx) => {
      sameScope(await lockScope(tx, scope.shopId, scope.installationGeneration), scope);
      const result =
        await sql`UPDATE signing_keys SET state='destroyed', private_envelope=NULL, wrapping_key_id=NULL, destroyed_at=clock_timestamp()
        WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint AND key_id=${keyId}
          AND authorization_generation=${scope.authorizationGeneration}::uuid AND state IN ('retiring','revoked')
          AND last_valid_day < (floor(extract(epoch from clock_timestamp()) / 86400)::int - 1)`.execute(tx);
      if (result.numAffectedRows !== 1n) throw new Error('Signing key destruction window is not closed');
    });
  }

  /** Deactivation itself invalidates all authorizations from that installation. */
  async destroyInactiveInstallationKeys(shopId: string, installationGeneration: string): Promise<number> {
    return this.database.transaction().execute(async (tx) => {
      const status = await sql<{ deactivated_at: Date | null }>`
        SELECT i.deactivated_at FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id
        WHERE s.shop_id=${shopId} AND i.generation=${installationGeneration}::bigint
        FOR UPDATE OF s, i`.execute(tx);
      if (!status.rows[0]?.deactivated_at) throw new Error('Installation remains active');
      const result = await sql`UPDATE signing_keys SET state='destroyed', private_envelope=NULL,
        wrapping_key_id=NULL, destroyed_at=clock_timestamp()
        WHERE shop_id=${shopId} AND installation_generation=${installationGeneration}::bigint
          AND state <> 'destroyed'`.execute(tx);
      return Number(result.numAffectedRows ?? 0n);
    });
  }

  async incrementEpoch(input: { scope: Scope; commandKey: string; requestDigest: string }): Promise<number> {
    if (!input.commandKey || input.commandKey.length > 128 || !/^[0-9a-f]{64}$/.test(input.requestDigest))
      throw new TypeError('Invalid epoch command');
    return this.database.transaction().execute(async (tx) => {
      const current = await lockScope(tx, input.scope.shopId, input.scope.installationGeneration);
      if (current.authorizationGeneration !== input.scope.authorizationGeneration)
        throw new Error('Stale authorization identity');
      const previous = await sql<{
        request_digest: string;
        resulting_epoch: string;
      }>`SELECT request_digest, resulting_epoch::text FROM authorization_epoch_commands
        WHERE shop_id=${input.scope.shopId} AND installation_generation=${input.scope.installationGeneration}::bigint AND command_key=${input.commandKey}`.execute(
        tx,
      );
      if (previous.rows[0]) {
        if (previous.rows[0].request_digest !== input.requestDigest) throw new Error('Epoch command digest conflict');
        return Number(previous.rows[0].resulting_epoch);
      }
      sameScope(current, input.scope);
      if (current.authorizationEpoch === 0xffffffff) throw new Error('Authorization epoch overflow');
      const next = current.authorizationEpoch + 1;
      await sql`UPDATE installation_generations SET authorization_epoch=${next}
        WHERE shop_id=${input.scope.shopId} AND generation=${input.scope.installationGeneration}::bigint`.execute(tx);
      await sql`INSERT INTO authorization_epoch_commands (shop_id, installation_generation, command_key, request_digest, previous_epoch, resulting_epoch)
        VALUES (${input.scope.shopId}, ${input.scope.installationGeneration}::bigint, ${input.commandKey}, ${input.requestDigest}, ${current.authorizationEpoch}, ${next})`.execute(
        tx,
      );
      return next;
    });
  }
}
