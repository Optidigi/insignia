import { classifyUsageDeliveryOutcome, type UsageDeliveryOutcome } from '@insignia/domain';
import { type Kysely, sql } from 'kysely';
import type { Database } from '../client/database.js';
import { createUsageDeliveryIntentRepository, type UsageDeliveryIntent } from './usage-delivery-intent.js';
import type { UsageLedgerScope } from './usage-ledger.js';

/** Original-generation financial history. It grants no provider credential or dispatch authority. */
export interface UsageDeliveryAttempt {
  readonly attemptId: string;
  readonly purchaseId: string;
  readonly ordinal: number;
  readonly bodySha256: string;
  readonly createdAt: string;
  readonly outcome: UsageDeliveryOutcome | null;
  readonly settledAt: string | null;
  readonly status: ReturnType<typeof classifyUsageDeliveryOutcome>;
}
export type UsageDeliveryAttemptBegin =
  | { kind: 'STARTED'; intent: UsageDeliveryIntent; attempt: UsageDeliveryAttempt }
  | { kind: 'HELD'; attempt: UsageDeliveryAttempt };
export class UsageDeliveryAttemptStateError extends Error {
  constructor(readonly code: 'INVALID' | 'NOT_FOUND' | 'CONFLICT') {
    super(code);
  }
}
const fail = (code: UsageDeliveryAttemptStateError['code']): never => {
  throw new UsageDeliveryAttemptStateError(code);
};
const uuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
function validate(scope: UsageLedgerScope, purchaseId: string) {
  if (
    !scope ||
    typeof scope.shopId !== 'string' ||
    !scope.shopId ||
    scope.shopId.length > 256 ||
    /[\s\p{Cc}]/u.test(scope.shopId) ||
    typeof scope.installationGeneration !== 'string' ||
    !/^[1-9][0-9]{0,18}$/.test(scope.installationGeneration) ||
    BigInt(scope.installationGeneration) > 9223372036854775807n ||
    !uuid(purchaseId)
  )
    fail('INVALID');
}
interface Row {
  attempt_id: string;
  purchase_id: string;
  ordinal: number;
  body_sha256: string;
  created_at: Date;
  outcome: UsageDeliveryOutcome | null;
  settled_at: Date | null;
}
function map(row: Row): UsageDeliveryAttempt {
  return {
    attemptId: row.attempt_id,
    purchaseId: row.purchase_id,
    ordinal: row.ordinal,
    bodySha256: row.body_sha256,
    createdAt: row.created_at.toISOString(),
    outcome: row.outcome,
    settledAt: row.settled_at?.toISOString() ?? null,
    status: classifyUsageDeliveryOutcome(row.outcome),
  };
}
async function history(
  db: Kysely<Database>,
  scope: UsageLedgerScope,
  purchaseId: string,
): Promise<UsageDeliveryAttempt[]> {
  const rows =
    await sql<Row>`SELECT a.attempt_id::text,a.purchase_id::text,a.ordinal,a.body_sha256,a.created_at,a.outcome,a.settled_at
    FROM m9_usage_delivery_attempts a JOIN m9_usage_delivery_intents i ON i.purchase_id=a.purchase_id
    WHERE i.purchase_id=${purchaseId}::uuid AND i.shop_id=${scope.shopId} AND i.installation_generation=${scope.installationGeneration}::bigint
    ORDER BY a.ordinal`.execute(db);
  return rows.rows.map(map);
}
async function getAttempt(
  db: Kysely<Database>,
  scope: UsageLedgerScope,
  purchaseId: string,
  attemptId?: string,
): Promise<UsageDeliveryAttempt | null> {
  const filter = attemptId === undefined ? sql`` : sql`AND a.attempt_id=${attemptId}::uuid`;
  const row = (
    await sql<Row>`SELECT a.attempt_id::text,a.purchase_id::text,a.ordinal,a.body_sha256,a.created_at,a.outcome,a.settled_at
    FROM m9_usage_delivery_attempts a JOIN m9_usage_delivery_intents i ON i.purchase_id=a.purchase_id
    WHERE i.purchase_id=${purchaseId}::uuid AND i.shop_id=${scope.shopId} AND i.installation_generation=${scope.installationGeneration}::bigint
    ${filter} ORDER BY a.ordinal DESC LIMIT 1`.execute(db)
  ).rows[0];
  return row ? map(row) : null;
}
function normalize(outcome: UsageDeliveryOutcome): UsageDeliveryOutcome {
  try {
    if (outcome === null) return fail('INVALID');
    const snapshot = { ...outcome };
    classifyUsageDeliveryOutcome(snapshot);
    if (snapshot.kind === 'RECEIPT') return { kind: 'RECEIPT', httpStatus: 202 };
    if (snapshot.kind === 'HTTP') return { kind: 'HTTP', httpStatus: snapshot.httpStatus };
    return { kind: snapshot.kind };
  } catch {
    return fail('INVALID');
  }
}
async function conflict<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof UsageDeliveryAttemptStateError) throw error;
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (['23505', '23514', '23503', '22003'].includes(String(code))) return fail('CONFLICT');
    throw error;
  }
}
export function createUsageDeliveryAttemptRepository(db: Kysely<Database>) {
  async function locked(tx: Kysely<Database>, scope: UsageLedgerScope, purchaseId: string) {
    const identity = await sql`SELECT purchase_id FROM m9_usage_delivery_intents WHERE purchase_id=${purchaseId}::uuid
      AND shop_id=${scope.shopId} AND installation_generation=${scope.installationGeneration}::bigint FOR UPDATE`.execute(
      tx,
    );
    if (!identity.rows.length) fail('NOT_FOUND');
  }
  return {
    async get(scope: UsageLedgerScope, purchaseId: string): Promise<UsageDeliveryAttempt | null> {
      validate(scope, purchaseId);
      return getAttempt(db, { ...scope }, purchaseId);
    },
    async list(scope: UsageLedgerScope, purchaseId: string): Promise<UsageDeliveryAttempt[]> {
      validate(scope, purchaseId);
      return history(db, { ...scope }, purchaseId);
    },
    async begin(
      callerScope: UsageLedgerScope,
      input: { purchaseId: string; bodySha256: string },
    ): Promise<UsageDeliveryAttemptBegin> {
      validate(callerScope, input?.purchaseId);
      if (typeof input.bodySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.bodySha256)) fail('INVALID');
      const scope = { ...callerScope },
        purchaseId = input.purchaseId,
        bodySha256 = input.bodySha256;
      return conflict(() =>
        db.transaction().execute(async (tx) => {
          await locked(tx, scope, purchaseId);
          const latest = await getAttempt(tx, scope, purchaseId);
          if (latest && latest.bodySha256 !== bodySha256) return fail('CONFLICT');
          if (latest && latest.outcome?.kind !== 'NOT_DISPATCHED') return { kind: 'HELD', attempt: latest };
          await sql`INSERT INTO m9_usage_delivery_attempts(purchase_id,body_sha256) VALUES(${purchaseId}::uuid,${bodySha256})`.execute(
            tx,
          );
          const attempt = await getAttempt(tx, scope, purchaseId),
            intent = await createUsageDeliveryIntentRepository(tx).get(scope, purchaseId);
          if (!attempt || !intent) return fail('CONFLICT');
          return { kind: 'STARTED', intent, attempt };
        }),
      );
    },
    /** Settlement is permanent. Later correlated reconciliation requires separate evidence, never a rewritten outcome. */
    async recordOutcome(
      callerScope: UsageLedgerScope,
      input: { purchaseId: string; attemptId: string; outcome: UsageDeliveryOutcome },
    ): Promise<UsageDeliveryAttempt> {
      validate(callerScope, input?.purchaseId);
      if (!uuid(input.attemptId)) fail('INVALID');
      const scope = { ...callerScope },
        purchaseId = input.purchaseId,
        attemptId = input.attemptId.toLowerCase(),
        outcome = normalize(input.outcome);
      return conflict(() =>
        db.transaction().execute(async (tx) => {
          await locked(tx, scope, purchaseId);
          const attempt = await getAttempt(tx, scope, purchaseId, attemptId);
          if (!attempt) return fail('NOT_FOUND');
          if (attempt.outcome !== null) {
            if (JSON.stringify(normalize(attempt.outcome)) !== JSON.stringify(outcome)) return fail('CONFLICT');
            return attempt;
          }
          if ((await getAttempt(tx, scope, purchaseId))?.attemptId !== attemptId) return fail('CONFLICT');
          await sql`UPDATE m9_usage_delivery_attempts SET outcome=${JSON.stringify(outcome)}::jsonb
          WHERE attempt_id=${attemptId}::uuid AND outcome IS NULL`.execute(tx);
          const settled = await getAttempt(tx, scope, purchaseId, attemptId);
          if (!settled?.outcome) return fail('CONFLICT');
          return settled;
        }),
      );
    },
  };
}
export type UsageDeliveryAttemptRepository = ReturnType<typeof createUsageDeliveryAttemptRepository>;
