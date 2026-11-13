import { type Kysely, sql, type Transaction } from 'kysely';
import type { Database } from '../client/database.js';
import { fenceReader } from '../client/fence-reads.js';

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
  private_envelope?: unknown | null;
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
    privateEnvelope: row.private_envelope ?? null,
    wrappingKeyId: row.wrapping_key_id,
    state: row.state,
    firstDay: row.first_valid_day,
    lastDay: row.last_valid_day,
    createdAt: row.created_at,
    retiredAt: row.retired_at,
    revokedAt: row.revoked_at,
  };
}
type ScopeRow = {
  shop_id: string;
  installation_generation: string;
  authorization_generation: string;
  authorization_epoch: string;
};
function mapScope(row: ScopeRow | undefined): Scope | null {
  return row
    ? {
        shopId: row.shop_id,
        installationGeneration: row.installation_generation,
        authorizationGeneration: row.authorization_generation,
        authorizationEpoch: Number(row.authorization_epoch),
      }
    : null;
}
/** Active scope through the definer function (migration 58); `lock` holds shop and installation rows. */
async function readScope(
  executor: Kysely<Database> | Transaction<Database>,
  shopId: string,
  generation: string,
  lock: boolean,
): Promise<Scope | null> {
  const result =
    await sql<ScopeRow>`SELECT * FROM public.signing_key_scope(${shopId}, ${generation}::bigint, ${lock})`.execute(
      executor,
    );
  return mapScope(result.rows[0]);
}
async function lockScope(tx: Transaction<Database>, shopId: string, generation: string): Promise<Scope> {
  const scope = await readScope(tx, shopId, generation, true);
  if (!scope) throw new Error('Inactive signing installation');
  return scope;
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
  /**
   * `privateHalves` is for the signer process only: the web runtime has no SELECT on
   * `private_envelope`, so by default the column is never read and `privateEnvelope` is null.
   */
  constructor(
    private readonly database: Kysely<Database>,
    private readonly options: { privateHalves?: boolean } = {},
  ) {}

  async getActiveScope(shopId: string, installationGeneration: string): Promise<Scope | null> {
    return readScope(fenceReader(this.database), shopId, installationGeneration, false);
  }

  private columns() {
    return sql.raw(
      `shop_id, installation_generation, authorization_generation, key_id, public_key, public_key_fingerprint,
      wrapping_key_id, state, first_valid_day, last_valid_day, created_at, retired_at, revoked_at${
        this.options.privateHalves ? ', private_envelope' : ''
      }`,
    );
  }

  async list(scope: Scope): Promise<StoredSigningKey[]> {
    const active = await this.getActiveScope(scope.shopId, scope.installationGeneration);
    if (!active) throw new Error('Inactive signing installation');
    sameScope(active, scope);
    const result = await sql<KeyRow>`SELECT ${this.columns()} FROM signing_keys WHERE shop_id=${scope.shopId}
      AND installation_generation=${scope.installationGeneration}::bigint AND authorization_generation=${scope.authorizationGeneration}::uuid
      ORDER BY key_id`.execute(fenceReader(this.database));
    return result.rows.map(mapKey);
  }

  /**
   * Signer: `FOR SHARE` conflicts with every lifecycle UPDATE (they take FOR NO KEY UPDATE; FOR KEY
   * SHARE would not), so a revoke waits for an in-flight signature and the signature waits for an
   * uncommitted revoke, then re-reads the committed row. The scope is read unlocked: a web fence
   * holds the shop and installation rows while it calls the signer, and nothing that holds a
   * conflicting key-row lock waits on the fence, so no lock cycle forms.
   */
  async holdForSigning<T>(
    scope: Scope,
    keyId: number,
    use: (key: StoredSigningKey | undefined) => Promise<T>,
  ): Promise<T> {
    checkedId(keyId);
    return this.database.transaction().execute(async (tx) => {
      const active = await readScope(tx, scope.shopId, scope.installationGeneration, false);
      if (!active) throw new Error('Inactive signing installation');
      sameScope(active, scope);
      const result = await sql<KeyRow>`SELECT ${this.columns()} FROM signing_keys WHERE shop_id=${scope.shopId}
        AND installation_generation=${scope.installationGeneration}::bigint AND authorization_generation=${scope.authorizationGeneration}::uuid
        AND key_id=${keyId} FOR SHARE`.execute(tx);
      return use(result.rows[0] ? mapKey(result.rows[0]) : undefined);
    });
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
    beforeWrite?: () => boolean;
  }): Promise<void> {
    checkedId(input.keyId);
    if (
      input.publicKey.byteLength !== 32 ||
      !/^[0-9a-f]{64}$/.test(input.publicKeyFingerprint) ||
      !Number.isInteger(input.firstDay) ||
      !Number.isInteger(input.lastDay) ||
      input.firstDay < 0 ||
      input.lastDay > 0x7fffffff ||
      input.firstDay > input.lastDay ||
      !input.wrappingKeyId ||
      !input.privateEnvelope
    )
      throw new TypeError('Invalid pending signing key');
    await this.database.transaction().execute(async (tx) => {
      sameScope(await lockScope(tx, input.scope.shopId, input.scope.installationGeneration), input.scope);
      const capacity = await sql<{ count: string }>`SELECT count(*)::text AS count FROM signing_keys
        WHERE shop_id=${input.scope.shopId}
          AND installation_generation=${input.scope.installationGeneration}::bigint
          AND authorization_generation=${input.scope.authorizationGeneration}::uuid
          AND state <> 'destroyed'`.execute(tx);
      if (Number(capacity.rows[0]?.count) >= 4) throw new Error('Function public config signing key capacity reached');
      if (input.beforeWrite && !input.beforeWrite()) throw new Error('Signing write authority expired');
      await sql`INSERT INTO signing_keys (shop_id, installation_generation, authorization_generation, key_id,
        public_key, public_key_fingerprint, private_envelope, wrapping_key_id, state, first_valid_day, last_valid_day)
        VALUES (${input.scope.shopId}, ${input.scope.installationGeneration}::bigint, ${input.scope.authorizationGeneration}::uuid,
          ${input.keyId}, ${Buffer.from(input.publicKey)}, ${input.publicKeyFingerprint}, ${JSON.stringify(input.privateEnvelope)}::jsonb,
          ${input.wrappingKeyId}, 'pending', ${input.firstDay}, ${input.lastDay})`.execute(tx);
      if (input.beforeWrite && !input.beforeWrite()) throw new Error('Signing write authority expired');
    });
  }

  async activate(scope: Scope, keyId: number, beforeWrite?: () => boolean): Promise<void> {
    checkedId(keyId);
    await this.database.transaction().execute(async (tx) => {
      sameScope(await lockScope(tx, scope.shopId, scope.installationGeneration), scope);
      const old =
        await sql<KeyRow>`SELECT ${this.columns()} FROM signing_keys WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint AND state='active' FOR UPDATE`.execute(
          tx,
        );
      if (old.rows[0]?.key_id === keyId) return;
      const target =
        await sql<KeyRow>`SELECT ${this.columns()} FROM signing_keys WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint AND key_id=${keyId} FOR UPDATE`.execute(
          tx,
        );
      const key = target.rows[0];
      if (
        !key ||
        key.authorization_generation !== scope.authorizationGeneration ||
        key.state !== 'pending' ||
        !key.wrapping_key_id
      )
        throw new Error('Pending signing key required');
      if (beforeWrite && !beforeWrite()) throw new Error('Signing write authority expired');
      if (old.rows[0])
        // Backstop: a retired key never stays verifiable forever. UTC day + 4 is never earlier than
        // the owner flow's scheduled shop-local day + 3 (a shop-local day is at most UTC day + 1).
        // The retired key's private half is scrubbed in the same transaction (one-way); its public
        // key and window stay so outstanding carts keep verifying until the window closes.
        await sql`UPDATE signing_keys SET state='retiring', retired_at=clock_timestamp(),
          private_envelope=NULL, wrapping_key_id=NULL,
          last_valid_day=LEAST(last_valid_day, GREATEST(first_valid_day, floor(extract(epoch from clock_timestamp()) / 86400)::int + 4)) WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint AND key_id=${old.rows[0].key_id}`.execute(
          tx,
        );
      if (beforeWrite && !beforeWrite()) throw new Error('Signing write authority expired');
      await sql`UPDATE signing_keys SET state='active', activated_at=clock_timestamp() WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint AND key_id=${keyId}`.execute(
        tx,
      );
      if (beforeWrite && !beforeWrite()) throw new Error('Signing write authority expired');
    });
  }

  /**
   * Shortens the still-active key's window before a rotation publishes it, so the published and
   * stored configs agree when activation makes it retiring. Only shortens; never extends.
   */
  async scheduleRetirement(scope: Scope, keyId: number, lastDay: number, beforeWrite?: () => boolean): Promise<void> {
    checkedId(keyId);
    if (!Number.isInteger(lastDay) || lastDay < 0 || lastDay > 0x7fffffff)
      throw new TypeError('Invalid retirement day');
    await this.database.transaction().execute(async (tx) => {
      sameScope(await lockScope(tx, scope.shopId, scope.installationGeneration), scope);
      if (beforeWrite && !beforeWrite()) throw new Error('Signing write authority expired');
      const result = await sql`UPDATE signing_keys SET last_valid_day=GREATEST(first_valid_day, ${lastDay}::int)
        WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint
          AND authorization_generation=${scope.authorizationGeneration}::uuid AND key_id=${keyId}
          AND state='active' AND last_valid_day > GREATEST(first_valid_day, ${lastDay}::int)`.execute(tx);
      const row = (
        await sql<{
          state: string;
          last_valid_day: number;
          first_valid_day: number;
        }>`SELECT state, last_valid_day, first_valid_day
          FROM signing_keys WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint
          AND key_id=${keyId}`.execute(tx)
      ).rows[0];
      if (row?.state !== 'active' || row.last_valid_day > Math.max(row.first_valid_day, lastDay))
        throw new Error('Active signing key required for retirement scheduling');
      if (result.numAffectedRows === undefined) throw new Error('Retirement scheduling unresolved');
      if (beforeWrite && !beforeWrite()) throw new Error('Signing write authority expired');
    });
  }

  /** Replaces an envelope sealed under `expectedWrappingKeyId` (KEK rotation); identity is untouched. */
  async rewrap(scope: Scope, keyId: number, expectedWrappingKeyId: string, envelope: { kid: string }): Promise<void> {
    checkedId(keyId);
    if (!expectedWrappingKeyId || !envelope?.kid) throw new TypeError('Invalid signing envelope rewrap');
    await this.database.transaction().execute(async (tx) => {
      sameScope(await lockScope(tx, scope.shopId, scope.installationGeneration), scope);
      const result =
        await sql`UPDATE signing_keys SET private_envelope=${JSON.stringify(envelope)}::jsonb, wrapping_key_id=${envelope.kid}
        WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint
          AND authorization_generation=${scope.authorizationGeneration}::uuid AND key_id=${keyId}
          AND state IN ('pending','active') AND wrapping_key_id=${expectedWrappingKeyId}`.execute(tx);
      if (result.numAffectedRows !== 1n) throw new Error('Signing envelope changed during rewrap');
    });
  }

  async revoke(scope: Scope, keyId: number, commandKey: string, reason: string): Promise<void> {
    checkedId(keyId);
    if (!commandKey || commandKey.length > 200 || !reason.trim() || reason.length > 500)
      throw new TypeError('Auditable revocation command required');
    await this.database.transaction().execute(async (tx) => {
      sameScope(await lockScope(tx, scope.shopId, scope.installationGeneration), scope);
      const result =
        await sql`UPDATE signing_keys SET state='revoked', revoked_at=clock_timestamp(), revocation_command_key=${commandKey}, revocation_reason=${reason},
          private_envelope=NULL, wrapping_key_id=NULL,
          last_valid_day=LEAST(last_valid_day, GREATEST(first_valid_day, floor(extract(epoch from clock_timestamp()) / 86400)::int + 3))
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

  /**
   * Worker maintenance: retired or revoked keys whose window closed become destroyed (same
   * conservative UTC rule as `destroy`). Runs through a definer function; no key material is read.
   */
  async destroyExpired(maximumRows = 100): Promise<number> {
    if (!Number.isInteger(maximumRows) || maximumRows < 1 || maximumRows > 100)
      throw new TypeError('Invalid signing key destruction limit');
    const result = await sql<{
      count: number;
    }>`SELECT public.destroy_expired_signing_keys(${maximumRows}) AS count`.execute(this.database);
    return Number(result.rows[0]?.count ?? 0);
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
