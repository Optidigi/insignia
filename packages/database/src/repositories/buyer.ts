import type { AcceptedQuote, QuoteAuthorizationSet } from '@insignia/application';
import { type Kysely, sql, type Transaction } from 'kysely';
import type { Database } from '../client/database.js';

export type BuyerScope = { shopId: string; installationGeneration: string; ownerHash: string };
export type BuyerSession = { sessionId: string; expiresAt: Date };
export type BuyerProposal = {
  id: string;
  requestDigest: string;
  materialHash: string;
  request: unknown;
  candidate: unknown;
  expiresAt: Date;
};
export class BuyerStateError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'CONFLICT' | 'RATE_LIMITED' | 'INVALID') {
    super(code);
  }
}
const fail = (code: BuyerStateError['code']): never => {
  throw new BuyerStateError(code);
};
const active = sql`EXISTS(SELECT 1 FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=b.shop_id AND s.current_generation=b.installation_generation AND i.deactivated_at IS NULL)`;
function bounded(value: unknown, bytes: number) {
  const encoded = JSON.stringify(value);
  if (!encoded || Buffer.byteLength(encoded) > bytes) fail('INVALID');
  return encoded;
}
function validScope(scope: BuyerScope) {
  if (!/^[a-f0-9]{64}$/.test(scope.ownerHash) || !/^[1-9][0-9]*$/.test(scope.installationGeneration)) fail('INVALID');
}
/** Every command serializes on the owned session, without browser-supplied tenant authority. */
export function createBuyerRepository(db: Kysely<Database>) {
  async function session(tx: Kysely<Database>, scope: BuyerScope, now: Date, lock = false) {
    validScope(scope);
    return (
      await sql<{ session_id: string; expires_at: Date; created_at: Date; write_window: Date; write_count: number }>`
      SELECT b.* FROM buyer_sessions b WHERE b.shop_id=${scope.shopId} AND b.installation_generation=${scope.installationGeneration}::bigint
      AND b.owner_hash=${scope.ownerHash} AND b.created_at<=${now} AND b.expires_at>${now} AND ${active} ${lock ? sql`FOR UPDATE` : sql``}`.execute(
        tx,
      )
    ).rows[0];
  }
  async function write<T>(
    scope: BuyerScope,
    now: Date,
    run: (tx: Transaction<Database>, row: NonNullable<Awaited<ReturnType<typeof session>>>) => Promise<T>,
  ) {
    return db.transaction().execute(async (tx) => {
      // Installation lock prevents a concurrent uninstall crossing a successful command.
      const tenant =
        await sql`SELECT i.generation FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
        WHERE s.shop_id=${scope.shopId} AND i.generation=${scope.installationGeneration}::bigint AND i.deactivated_at IS NULL FOR SHARE OF s,i`.execute(
          tx,
        );
      if (!tenant.rows.length) fail('NOT_FOUND');
      const row = await session(tx, scope, now, true);
      if (!row) return fail('NOT_FOUND');
      const reset = +now >= +row.write_window + 60000;
      if (!reset && row.write_count >= 60) fail('RATE_LIMITED');
      await sql`UPDATE buyer_sessions SET write_window=${reset ? now : row.write_window},write_count=${reset ? 1 : row.write_count + 1} WHERE session_id=${row.session_id}::uuid`.execute(
        tx,
      );
      return run(tx, row);
    });
  }
  async function count(
    tx: Transaction<Database>,
    table: 'design_drafts' | 'quote_proposals' | 'cart_applications',
    id: string,
    maximum: number,
  ) {
    const n = (
      await sql<{ n: string }>`SELECT count(*)::text n FROM ${sql.table(table)} WHERE session_id=${id}::uuid`.execute(
        tx,
      )
    ).rows[0];
    if (Number(n?.n) >= maximum) fail('RATE_LIMITED');
  }
  return {
    async issueSession(input: {
      scope: BuyerScope;
      sessionId: string;
      expiresAt: Date;
      now: Date;
    }): Promise<BuyerSession> {
      const { scope, now, expiresAt, sessionId } = input;
      validScope(scope);
      if (!(+expiresAt > +now && +expiresAt <= +now + 604800000)) fail('INVALID');
      return db.transaction().execute(async (tx) => {
        const tenant =
          await sql`SELECT s.shop_id FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation WHERE s.shop_id=${scope.shopId} AND s.current_generation=${scope.installationGeneration}::bigint AND i.deactivated_at IS NULL FOR UPDATE OF s,i`.execute(
            tx,
          );
        if (!tenant.rows.length) fail('NOT_FOUND');
        const old = await session(tx, scope, now);
        if (old) return { sessionId: old.session_id, expiresAt: old.expires_at };
        // Expired owner tokens never revive or gain a new deadline.
        const used =
          await sql`SELECT 1 FROM buyer_sessions WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint AND owner_hash=${scope.ownerHash}`.execute(
            tx,
          );
        if (used.rows.length) fail('NOT_FOUND');
        const admission = (
          await sql<{
            window_at: Date;
            issued: number;
          }>`SELECT * FROM buyer_admission WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint`.execute(
            tx,
          )
        ).rows[0];
        const reset = !admission || +now >= +admission.window_at + 60000;
        if (admission && !reset && admission.issued >= 60) fail('RATE_LIMITED');
        const n = (
          await sql<{
            n: string;
          }>`SELECT count(*)::text n FROM buyer_sessions WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint AND expires_at>${now}`.execute(
            tx,
          )
        ).rows[0];
        if (Number(n?.n) >= 1000) fail('RATE_LIMITED');
        await sql`INSERT INTO buyer_admission VALUES(${scope.shopId},${scope.installationGeneration}::bigint,${reset ? now : (admission?.window_at ?? now)},${reset ? 1 : (admission?.issued ?? 0) + 1}) ON CONFLICT(shop_id,installation_generation) DO UPDATE SET window_at=EXCLUDED.window_at,issued=EXCLUDED.issued`.execute(
          tx,
        );
        await sql`INSERT INTO buyer_sessions(session_id,shop_id,installation_generation,owner_hash,created_at,expires_at,write_window) VALUES(${sessionId}::uuid,${scope.shopId},${scope.installationGeneration}::bigint,${scope.ownerHash},${now},${expiresAt},${now})`.execute(
          tx,
        );
        return { sessionId, expiresAt };
      });
    },
    async getSession(scope: BuyerScope, now: Date): Promise<BuyerSession | null> {
      const row = await session(db, scope, now);
      return row ? { sessionId: row.session_id, expiresAt: row.expires_at } : null;
    },
    async saveDesign(
      scope: BuyerScope,
      input: { id: string; expectedVersion: number; value: unknown; now: Date; expiresAt?: Date },
    ) {
      const payload = bounded(input.value, 120000);
      if (
        !Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion < 0 ||
        input.expectedVersion >= 2147483647
      )
        fail('INVALID');
      return write(scope, input.now, async (tx, row) => {
        const expiresAt = input.expiresAt ?? row.expires_at;
        if (!(+expiresAt > +input.now && +expiresAt <= +row.expires_at)) fail('INVALID');
        if (input.expectedVersion === 0) {
          await count(tx, 'design_drafts', row.session_id, 32);
          const inserted =
            await sql`INSERT INTO design_drafts VALUES(${input.id}::uuid,${scope.shopId},${scope.installationGeneration}::bigint,${row.session_id}::uuid,1,${payload}::jsonb,${expiresAt}) ON CONFLICT(design_id) DO NOTHING RETURNING design_id`.execute(
              tx,
            );
          if (!inserted.rows.length) fail('CONFLICT');
        } else {
          const updated =
            await sql`UPDATE design_drafts SET version=version+1,payload=${payload}::jsonb,expires_at=LEAST(expires_at,${expiresAt}) WHERE design_id=${input.id}::uuid AND session_id=${row.session_id}::uuid AND version=${input.expectedVersion} AND expires_at>${input.now} RETURNING design_id`.execute(
              tx,
            );
          if (!updated.rows.length) fail('CONFLICT');
        }
        return { id: input.id, version: input.expectedVersion + 1, value: input.value };
      });
    },
    async getDesign(scope: BuyerScope, id: string, now: Date) {
      validScope(scope);
      const row = (
        await sql<{
          design_id: string;
          version: string;
          payload: unknown;
        }>`SELECT d.* FROM design_drafts d JOIN buyer_sessions b ON b.session_id=d.session_id WHERE d.design_id=${id}::uuid AND b.shop_id=${scope.shopId} AND b.installation_generation=${scope.installationGeneration}::bigint AND b.owner_hash=${scope.ownerHash} AND b.created_at<=${now} AND b.expires_at>${now} AND d.expires_at>${now} AND ${active}`.execute(
          db,
        )
      ).rows[0];
      return row ? { id: row.design_id, version: Number(row.version), value: row.payload } : null;
    },
    async putProposal(
      scope: BuyerScope,
      input: {
        id: string;
        requestDigest: string;
        materialHash: string;
        request: unknown;
        candidate: unknown;
        expiresAt: Date;
        retainPrivateUntil?: Date;
        now: Date;
      },
    ): Promise<BuyerProposal> {
      const request = bounded(input.request, 120000),
        candidate = bounded(input.candidate, 240000);
      return write(scope, input.now, async (tx, row) => {
        const retainPrivateUntil = input.retainPrivateUntil ?? row.expires_at;
        if (
          !(
            +retainPrivateUntil <= +row.expires_at &&
            +retainPrivateUntil >= +input.expiresAt &&
            +input.expiresAt > +input.now &&
            +input.expiresAt <= +input.now + 300000 &&
            +input.expiresAt <= +row.expires_at
          )
        )
          fail('INVALID');
        await sql`DELETE FROM quote_proposals WHERE session_id=${row.session_id}::uuid AND retain_private_until<=${input.now}`.execute(
          tx,
        );
        await count(tx, 'quote_proposals', row.session_id, 128);
        const result =
          await sql`INSERT INTO quote_proposals VALUES(${input.id}::uuid,${scope.shopId},${scope.installationGeneration}::bigint,${row.session_id}::uuid,${input.requestDigest},${input.materialHash},${request}::jsonb,${candidate}::jsonb,${input.now},${input.expiresAt},${retainPrivateUntil}) ON CONFLICT(proposal_id) DO NOTHING RETURNING proposal_id`.execute(
            tx,
          );
        if (!result.rows.length) fail('CONFLICT');
        return {
          id: input.id,
          requestDigest: input.requestDigest,
          materialHash: input.materialHash,
          request: input.request,
          candidate: input.candidate,
          expiresAt: input.expiresAt,
        };
      });
    },
    /** Retained reads enable completed-command replay only; expired proposals never grant new acceptance. */
    async getProposal(scope: BuyerScope, id: string, now: Date, allowExpired = false): Promise<BuyerProposal | null> {
      const row = await session(db, scope, now);
      if (!row) return null;
      const p = (
        await sql<{
          proposal_id: string;
          request_digest: string;
          material_hash: string;
          desired_request: unknown;
          candidate: unknown;
          expires_at: Date;
        }>`SELECT p.* FROM quote_proposals p JOIN buyer_sessions b ON b.session_id=p.session_id WHERE p.proposal_id=${id}::uuid AND p.session_id=${row.session_id}::uuid AND ${allowExpired ? sql`p.retain_private_until>${now}` : sql`p.expires_at>${now}`} AND b.owner_hash=${scope.ownerHash} AND b.expires_at>${now} AND ${active}`.execute(
          db,
        )
      ).rows[0];
      return p
        ? {
            id: p.proposal_id,
            requestDigest: p.request_digest,
            materialHash: p.material_hash,
            request: p.desired_request,
            candidate: p.candidate,
            expiresAt: p.expires_at,
          }
        : null;
    },
    async linkQuote(
      scope: BuyerScope,
      input: { quoteId: string; proposalId: string; ownerBinding: string; requestDigest: string; now: Date },
    ) {
      return write(scope, input.now, async (tx, row) => {
        const proposal =
          await sql`SELECT 1 FROM quote_proposals WHERE proposal_id=${input.proposalId}::uuid AND session_id=${row.session_id}::uuid AND retain_private_until>${input.now}`.execute(
            tx,
          );
        if (!proposal.rows.length) fail('NOT_FOUND');
        const q =
          await sql`SELECT quote_id FROM accepted_quotes WHERE quote_id=${input.quoteId}::uuid AND shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint AND request_digest=${input.requestDigest}`.execute(
            tx,
          );
        if (!q.rows.length) fail('NOT_FOUND');
        await sql`INSERT INTO buyer_quote_ownership VALUES(${scope.shopId},${scope.installationGeneration}::bigint,${input.quoteId}::uuid,${input.proposalId}::uuid,${input.ownerBinding},${input.requestDigest},${input.now}) ON CONFLICT DO NOTHING`.execute(
          tx,
        );
        const own =
          await sql`SELECT 1 FROM buyer_quote_ownership WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint AND quote_id=${input.quoteId}::uuid AND owner_binding=${input.ownerBinding} AND request_digest=${input.requestDigest}`.execute(
            tx,
          );
        if (!own.rows.length) fail('CONFLICT');
      });
    },
    async getOwnedQuote(scope: BuyerScope, id: string, ownerBinding: string, now: Date) {
      if (!(await session(db, scope, now))) return null;
      const row = (
        await sql<{
          quote_id: string;
          proposal_id: string;
          request_digest: string;
          owner_binding: string;
        }>`SELECT o.* FROM buyer_quote_ownership o JOIN buyer_sessions b ON b.shop_id=o.shop_id AND b.installation_generation=o.installation_generation WHERE o.shop_id=${scope.shopId} AND o.installation_generation=${scope.installationGeneration}::bigint AND o.quote_id=${id}::uuid AND o.owner_binding=${ownerBinding} AND b.owner_hash=${scope.ownerHash} AND b.expires_at>${now} AND ${active}`.execute(
          db,
        )
      ).rows[0];
      return row
        ? {
            quoteId: row.quote_id,
            proposalId: row.proposal_id,
            requestDigest: row.request_digest,
            ownerBinding: row.owner_binding,
          }
        : null;
    },
    async getQuoteDesign(scope: BuyerScope, id: string, ownerBinding: string, now: Date) {
      const row = await session(db, scope, now);
      if (!row) return null;
      const p = (
        await sql<{
          proposal_id: string;
          desired_request: unknown;
          candidate: unknown;
          material_hash: string;
        }>`SELECT p.* FROM buyer_quote_ownership o JOIN quote_proposals p ON p.proposal_id=o.proposal_id AND p.shop_id=o.shop_id AND p.installation_generation=o.installation_generation JOIN buyer_sessions b ON b.session_id=p.session_id WHERE o.shop_id=${scope.shopId} AND o.installation_generation=${scope.installationGeneration}::bigint AND o.quote_id=${id}::uuid AND o.owner_binding=${ownerBinding} AND p.session_id=${row.session_id}::uuid AND p.retain_private_until>${now} AND b.owner_hash=${scope.ownerHash} AND b.expires_at>${now} AND ${active}`.execute(
          db,
        )
      ).rows[0];
      return p
        ? {
            proposalId: p.proposal_id,
            request: p.desired_request,
            candidate: p.candidate,
            materialHash: p.material_hash,
          }
        : null;
    },
    /** Private comparison input only: this does not authorize new economics or replay signatures. */
    async getLatestOwnedQuote(
      scope: BuyerScope,
      ownerBinding: string,
      now: Date,
    ): Promise<{ quote: AcceptedQuote; request: unknown } | null> {
      validScope(scope);
      const r = (
        await sql<{ quote_value: AcceptedQuote; desired_request: unknown }>`
        SELECT q.quote_value,p.desired_request FROM buyer_quote_ownership o
        JOIN accepted_quotes q ON q.quote_id=o.quote_id AND q.shop_id=o.shop_id AND q.installation_generation=o.installation_generation
        JOIN quote_proposals p ON p.proposal_id=o.proposal_id AND p.shop_id=o.shop_id AND p.installation_generation=o.installation_generation
        JOIN buyer_sessions b ON b.session_id=p.session_id
        JOIN installation_generations i ON i.shop_id=q.shop_id AND i.generation=q.installation_generation
        WHERE o.shop_id=${scope.shopId} AND o.installation_generation=${scope.installationGeneration}::bigint AND o.owner_binding=${ownerBinding}
        AND b.owner_hash=${scope.ownerHash} AND b.created_at<=${now} AND b.expires_at>${now} AND p.retain_private_until>${now} AND ${active}
        AND i.authorization_generation=q.authorization_generation AND i.authorization_epoch=q.authorization_epoch
        ORDER BY q.created_at DESC,o.created_at DESC,q.quote_id DESC LIMIT 1
      `.execute(db)
      ).rows[0];
      return r ? { quote: r.quote_value, request: r.desired_request } : null;
    },
    async getOwnedSet(
      scope: BuyerScope,
      input: { quoteId: string; setId: string; ownerBinding: string; now: Date },
    ): Promise<{ quote: AcceptedQuote; authorization: QuoteAuthorizationSet; request: unknown } | null> {
      validScope(scope);
      const r = (
        await sql<{
          quote_value: AcceptedQuote;
          desired_request: unknown;
          set_id: string;
          key_id: string;
          public_key_fingerprint: string;
          first_valid_day: number;
          last_valid_day: number;
          valid_through_day: number;
          envelope_carrier: string;
          member_carriers: QuoteAuthorizationSet['members'];
        }>`
        SELECT q.quote_value,p.desired_request,a.* FROM buyer_quote_ownership o
        JOIN accepted_quotes q ON q.quote_id=o.quote_id AND q.shop_id=o.shop_id AND q.installation_generation=o.installation_generation
        JOIN quote_proposals p ON p.proposal_id=o.proposal_id AND p.shop_id=o.shop_id AND p.installation_generation=o.installation_generation
        JOIN buyer_sessions b ON b.session_id=p.session_id
        JOIN installation_generations i ON i.shop_id=q.shop_id AND i.generation=q.installation_generation
        JOIN quote_authorization_sets a ON a.quote_id=q.quote_id AND a.shop_id=q.shop_id AND a.installation_generation=q.installation_generation
        JOIN signing_keys k ON k.shop_id=a.shop_id AND k.installation_generation=a.installation_generation AND k.authorization_generation=a.authorization_generation AND k.key_id=a.key_id
        WHERE o.shop_id=${scope.shopId} AND o.installation_generation=${scope.installationGeneration}::bigint AND o.owner_binding=${input.ownerBinding}
        AND o.quote_id=${input.quoteId}::uuid AND a.set_id=${input.setId}::uuid AND b.owner_hash=${scope.ownerHash} AND b.created_at<=${input.now} AND b.expires_at>${input.now} AND p.retain_private_until>${input.now} AND ${active}
        AND i.authorization_generation=q.authorization_generation AND i.authorization_epoch=q.authorization_epoch
        AND a.authorization_generation=i.authorization_generation AND a.authorization_epoch=i.authorization_epoch
        AND k.state IN ('active','retiring') AND k.revoked_at IS NULL AND k.public_key_fingerprint=a.public_key_fingerprint
        AND k.first_valid_day=a.first_valid_day AND k.last_valid_day=a.last_valid_day AND k.last_valid_day>=a.valid_through_day
      `.execute(db)
      ).rows[0];
      return r
        ? {
            quote: r.quote_value,
            request: r.desired_request,
            authorization: {
              setId: r.set_id,
              keyId: Number(r.key_id),
              publicKeyFingerprint: r.public_key_fingerprint,
              firstValidDay: r.first_valid_day,
              lastValidDay: r.last_valid_day,
              validThroughDay: r.valid_through_day,
              envelopeCarrier: r.envelope_carrier,
              members: r.member_carriers,
            },
          }
        : null;
    },
    async getApplication(scope: BuyerScope, id: string, now: Date) {
      validScope(scope);
      const r = (
        await sql<{
          quote_id: string;
          expected_fingerprint: string;
          status: 'PENDING' | 'APPLIED' | 'REVIEW_REQUIRED';
        }>`SELECT a.* FROM cart_applications a JOIN buyer_sessions b ON b.session_id=a.session_id WHERE a.application_id=${id}::uuid AND b.shop_id=${scope.shopId} AND b.installation_generation=${scope.installationGeneration}::bigint AND b.owner_hash=${scope.ownerHash} AND b.created_at<=${now} AND b.expires_at>${now} AND ${active}`.execute(
          db,
        )
      ).rows[0];
      return r ? { quoteId: r.quote_id, expectedFingerprint: r.expected_fingerprint, status: r.status } : null;
    },
    async createApplication(
      scope: BuyerScope,
      input: { id: string; quoteId: string; ownerBinding: string; expectedFingerprint: string; now: Date },
    ) {
      return write(scope, input.now, async (tx, row) => {
        const own =
          await sql`SELECT 1 FROM buyer_quote_ownership WHERE shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint AND quote_id=${input.quoteId}::uuid AND owner_binding=${input.ownerBinding}`.execute(
            tx,
          );
        if (!own.rows.length) fail('NOT_FOUND');
        await count(tx, 'cart_applications', row.session_id, 64);
        const result =
          await sql`INSERT INTO cart_applications(application_id,shop_id,installation_generation,session_id,quote_id,expected_fingerprint,created_at,expires_at) VALUES(${input.id}::uuid,${scope.shopId},${scope.installationGeneration}::bigint,${row.session_id}::uuid,${input.quoteId}::uuid,${input.expectedFingerprint},${input.now},${row.expires_at}) ON CONFLICT DO NOTHING RETURNING application_id`.execute(
            tx,
          );
        if (!result.rows.length) fail('CONFLICT');
        return { id: input.id, status: 'PENDING' as const };
      });
    },
    /** Fingerprints compare server-normalized complete bucket vectors; UX reconciliation is never payment proof. */
    async confirmApplication(scope: BuyerScope, input: { id: string; observedFingerprint: string; now: Date }) {
      return write(scope, input.now, async (tx, row) => {
        const result = (
          await sql<{
            status: 'APPLIED' | 'REVIEW_REQUIRED';
          }>`UPDATE cart_applications SET observed_fingerprint=${input.observedFingerprint},status=CASE WHEN expected_fingerprint=${input.observedFingerprint} THEN 'APPLIED' ELSE 'REVIEW_REQUIRED' END WHERE application_id=${input.id}::uuid AND session_id=${row.session_id}::uuid RETURNING status`.execute(
            tx,
          )
        ).rows[0];
        if (!result) return fail('NOT_FOUND');
        return { id: input.id, status: result.status };
      });
    },
    /** Production worker uses the database clock through an EXECUTE-only erasure capability. */
    async cleanupDue(limit = 100): Promise<number> {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) fail('INVALID');
      const result = await sql<{ erased: number }>`SELECT public.cleanup_buyer_payloads(${limit}) AS erased`.execute(
        db,
      );
      return result.rows[0]?.erased ?? 0;
    },
    async cleanupExpired(now: Date, limit = 100): Promise<number> {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) fail('INVALID');
      return db.transaction().execute(async (tx) => {
        await sql`DELETE FROM design_drafts WHERE design_id IN(SELECT design_id FROM design_drafts WHERE expires_at<=${now} ORDER BY expires_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)`.execute(
          tx,
        );
        await sql`DELETE FROM quote_proposals WHERE proposal_id IN(SELECT proposal_id FROM quote_proposals WHERE retain_private_until<=${now} ORDER BY retain_private_until LIMIT ${limit} FOR UPDATE SKIP LOCKED)`.execute(
          tx,
        );
        const result =
          await sql`DELETE FROM buyer_sessions WHERE session_id IN(SELECT b.session_id FROM buyer_sessions b WHERE b.expires_at<=${now} OR NOT(${active}) ORDER BY b.expires_at LIMIT ${limit} FOR UPDATE SKIP LOCKED) RETURNING session_id`.execute(
            tx,
          );
        return result.rows.length;
      });
    },
  };
}
export type BuyerRepository = ReturnType<typeof createBuyerRepository>;
