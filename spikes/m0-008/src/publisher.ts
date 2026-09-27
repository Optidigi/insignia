/** Local publication use case. No adapter here makes a Shopify propagation claim. */
export type Mode = 'required' | 'optional';
export type Field = 'registration' | 'policy';
export type Digest = string | null;
export type Phase = 'prepared' | 'pending-written' | 'policy-written' | 'ready-written' | 'activation-pending' | 'active';

export interface PublishIntent {
  operationId: string;
  ownerId: string;
  namespace: string; // resolved app--<id> namespace, verified on readback
  generationHex: string;
  revision: number;
  mode: Mode;
  previousMode: Mode | null;
  expectedPriorDigests: { registration: Digest; policy: Digest };
}
export interface Cell { value: string; digest: string }
export interface RemoteState { registration: Cell | null; policy: Cell | null }
export type WriteResult = { kind: 'ack' } | { kind: 'user-errors'; errors: readonly { code: string; message: string }[] };
export interface PolicyTransport {
  read(intent: PublishIntent): Promise<RemoteState>;
  set(intent: PublishIntent, field: Field, value: string, compareDigest: Digest): Promise<WriteResult>;
}
export type Check = { kind: 'established'; evidence: string } | { kind: 'pending'; prerequisite: string };
/** Must cover every purchasing channel and carts already in flight, not just Admin status. */
export interface AdmissionPort { check(intent: PublishIntent, previous: Previous): Promise<Check> }
/** A sampled Function invocation or repeated Admin read is insufficient to return established. */
export interface ActivationPort { check(intent: PublishIntent, previous: Previous, admin: RemoteState): Promise<Check> }
export type Previous = { revision: number; mode: Mode } | null;

export interface Operation {
  intent: PublishIntent;
  fingerprint: string;
  previous: Previous;
  phase: Phase;
  retries: number;
  activationEvidence: string | null;
}
export interface Journal {
  get(operationId: string): Promise<Operation | null>;
  currentFor(ownerId: string): Promise<Operation | null>;
  insertIfAbsent(operation: Operation): Promise<boolean>;
  save(operation: Operation): Promise<void>;
}
export type StartResult =
  | { kind: 'started' | 'replayed'; phase: Phase }
  | { kind: 'conflict' | 'operator-action'; reason: string };
export type StepResult =
  | { kind: 'pending' | 'active'; phase: Phase }
  | { kind: 'activation-pending'; prerequisite: string }
  | { kind: 'retry-later'; reason: string; attempts: number }
  | { kind: 'conflict' | 'operator-action'; reason: string };

export class TransportFault extends Error {
  readonly kind: 'timeout' | 'malformed-response' | 'network';
  constructor(kind: 'timeout' | 'malformed-response' | 'network', message: string) {
    super(message); this.kind = kind;
  }
}
const MAX_RETRIES = 3;
const GID = /^gid:\/\/shopify\/Product\/[1-9][0-9]*$/;
const NAMESPACE = /^app--[1-9][0-9]*$/;
const HEX = /^[0-9a-f]{32}$/;
const DIGEST = /^[0-9a-f]{64}$/;

function validIntent(i: PublishIntent): boolean {
  return i.operationId.length > 0 && i.operationId.length <= 128 && GID.test(i.ownerId) &&
    NAMESPACE.test(i.namespace) && HEX.test(i.generationHex) && Number.isInteger(i.revision) &&
    i.revision > 0 && i.revision <= 0xffffffff && (i.mode === 'required' || i.mode === 'optional') &&
    (i.previousMode === null || i.previousMode === 'required' || i.previousMode === 'optional') &&
    Object.values(i.expectedPriorDigests).every(d => d === null || DIGEST.test(d));
}
function value(i: PublishIntent, state: 'pending' | 'ready' | Mode): string {
  return `${i.generationHex}:${i.revision}:${state}`;
}
function parse(value: string): { generation: string; revision: number; state: string } | null {
  const match = /^([0-9a-f]{32}):([1-9][0-9]*):(pending|ready|required|optional)$/.exec(value);
  if (!match) return null;
  const revision = Number(match[2]);
  return Number.isInteger(revision) && revision <= 0xffffffff && revision > 0
    ? { generation: match[1]!, revision, state: match[3]! } : null;
}
function prior(i: PublishIntent, remote: RemoteState): Previous | 'invalid' {
  if (!remote.registration && !remote.policy) return null;
  if (!remote.registration || !remote.policy) return 'invalid';
  const r = parse(remote.registration.value), p = parse(remote.policy.value);
  if (!r || !p || r.generation !== i.generationHex || p.generation !== i.generationHex ||
      r.revision !== p.revision || r.state !== 'ready' || !['required', 'optional'].includes(p.state)) return 'invalid';
  return { revision: r.revision, mode: p.state as Mode };
}
function sameDigest(cell: Cell | null, digest: Digest): boolean { return (cell?.digest ?? null) === digest; }
function needsAdmission(previous: Previous, intent: PublishIntent): boolean {
  return previous === null || previous.mode !== intent.mode;
}
function fingerprint(i: PublishIntent): string {
  return JSON.stringify([i.operationId, i.ownerId, i.namespace, i.generationHex, i.revision,
    i.mode, i.previousMode, i.expectedPriorDigests.registration, i.expectedPriorDigests.policy]);
}

export class Publisher {
  private readonly journal: Journal;
  private readonly remote: PolicyTransport;
  private readonly admission: AdmissionPort;
  private readonly activation: ActivationPort;
  constructor(journal: Journal, remote: PolicyTransport, admission: AdmissionPort, activation: ActivationPort) {
    this.journal = journal; this.remote = remote; this.admission = admission; this.activation = activation;
  }

  async start(intent: PublishIntent): Promise<StartResult> {
    if (!validIntent(intent)) return { kind: 'operator-action', reason: 'invalid publication identity or digest' };
    const old = await this.journal.get(intent.operationId);
    if (old) return old.fingerprint === fingerprint(intent)
      ? { kind: 'replayed', phase: old.phase }
      : { kind: 'conflict', reason: 'same operation ID has different immutable payload' };
    const open = await this.journal.currentFor(intent.ownerId);
    if (open && open.phase !== 'active') return { kind: 'conflict', reason: 'another publication is pending for product' };
    let state: RemoteState;
    try { state = await this.remote.read(intent); }
    catch (e) { return this.errorResult(e); }
    const previous = prior(intent, state);
    if (previous === 'invalid') return { kind: 'operator-action', reason: 'partial, malformed, stale, or wrong-generation prior state' };
    if (open?.phase === 'active' && previous === null)
      return { kind: 'operator-action', reason: 'previously managed product lost both trusted policy anchors; incident, not first publication' };
    if (open?.phase === 'active' && previous !== null &&
        (previous.revision !== open.intent.revision || previous.mode !== open.intent.mode ||
         intent.generationHex !== open.intent.generationHex))
      return { kind: 'operator-action', reason: 'Admin state rolled back or differs from last effective publication' };
    if ((previous?.mode ?? null) !== intent.previousMode ||
      (previous !== null && intent.revision <= previous.revision) ||
      (previous === null && intent.revision !== 1) ||
      !sameDigest(state.registration, intent.expectedPriorDigests.registration) ||
      !sameDigest(state.policy, intent.expectedPriorDigests.policy))
      return { kind: 'conflict', reason: 'revision or expected prior digest changed' };
    const operation: Operation = { intent, fingerprint: fingerprint(intent), previous,
      phase: 'prepared', retries: 0, activationEvidence: null };
    if (!await this.journal.insertIfAbsent(operation)) return { kind: 'conflict', reason: 'journal claim raced' };
    return { kind: 'started', phase: 'prepared' };
  }

  async advance(operationId: string): Promise<StepResult> {
    const op = await this.journal.get(operationId);
    if (!op) return { kind: 'operator-action', reason: 'no durable operation intent' };
    if (op.phase === 'active') return { kind: 'active', phase: 'active' };
    const i = op.intent;
    try {
      if (needsAdmission(op.previous, i)) {
        const gate = await this.admission.check(i, op.previous);
        if (gate.kind === 'pending') return { kind: 'activation-pending', prerequisite: gate.prerequisite };
      }
      let state = await this.remote.read(i);
      if (op.phase === 'prepared') {
        if (!this.matchesPriorOrDesired(op, state, 'registration'))
          return { kind: 'conflict', reason: 'registration differs from prior or desired pending state' };
        if (!sameDigest(state.policy, i.expectedPriorDigests.policy))
          return { kind: 'conflict', reason: 'policy changed before pending registration' };
        const w = await this.ensure(i, 'registration', value(i, 'pending'),
          i.expectedPriorDigests.registration, state.registration);
        if (w) return w;
        state = await this.remote.read(i);
        if (state.registration?.value !== value(i, 'pending'))
          return { kind: 'operator-action', reason: 'pending registration absent or mismatched on exact Admin readback' };
        op.phase = 'pending-written';
      } else if (op.phase === 'pending-written') {
        if (state.registration?.value !== value(i, 'pending'))
          return { kind: 'operator-action', reason: 'known management pending anchor missing or malformed' };
        if (!this.matchesPriorOrDesired(op, state, 'policy'))
          return { kind: 'conflict', reason: 'policy differs from prior or intended revision' };
        const w = await this.ensure(i, 'policy', value(i, i.mode), i.expectedPriorDigests.policy, state.policy);
        if (w) return w;
        state = await this.remote.read(i);
        if (state.registration?.value !== value(i, 'pending') || state.policy?.value !== value(i, i.mode))
          return { kind: 'operator-action', reason: 'partial or stale policy readback' };
        op.phase = 'policy-written';
      } else if (op.phase === 'policy-written') {
        if (state.policy?.value !== value(i, i.mode) ||
            ![value(i, 'pending'), value(i, 'ready')].includes(state.registration?.value ?? ''))
          return { kind: 'operator-action', reason: 'desired policy or management anchor not intact' };
        const w = await this.ensure(i, 'registration', value(i, 'ready'), state.registration?.digest ?? null, state.registration);
        if (w) return w;
        state = await this.remote.read(i);
        if (state.registration?.value !== value(i, 'ready') || state.policy?.value !== value(i, i.mode))
          return { kind: 'operator-action', reason: 'ready pair absent or mismatched on exact Admin readback' };
        op.phase = 'ready-written';
      } else {
        if (state.registration?.value !== value(i, 'ready') || state.policy?.value !== value(i, i.mode))
          return { kind: 'operator-action', reason: 'ready pair regressed before activation' };
        const gate = await this.activation.check(i, op.previous, state);
        if (gate.kind === 'pending') {
          op.phase = 'activation-pending';
          await this.journal.save(op);
          return { kind: 'activation-pending', prerequisite: gate.prerequisite };
        }
        op.phase = 'active'; op.activationEvidence = gate.evidence;
      }
      op.retries = 0;
      await this.journal.save(op);
      return op.phase === 'active' ? { kind: 'active', phase: 'active' } : { kind: 'pending', phase: op.phase };
    } catch (e) {
      if (e instanceof TransportFault && (e.kind === 'timeout' || e.kind === 'network')) {
        op.retries += 1;
        await this.journal.save(op);
        return op.retries <= MAX_RETRIES
          ? { kind: 'retry-later', reason: 'ambiguous transport; exact re-read required before retry', attempts: op.retries }
          : { kind: 'operator-action', reason: 'transport retry budget exhausted; preserve journal and management evidence' };
      }
      return this.errorResult(e);
    }
  }

  /** This checks issuance eligibility, not quote authenticity or price; the signer remains separate. */
  async newQuoteAllowed(ownerId: string, revision: number): Promise<boolean> {
    const op = await this.journal.currentFor(ownerId);
    return op !== null && op.phase === 'active' && op.intent.revision === revision && op.activationEvidence !== null;
  }

  private matchesPriorOrDesired(op: Operation, state: RemoteState, field: Field): boolean {
    const cell = state[field]; const i = op.intent;
    if (cell?.value === value(i, field === 'registration' ? 'pending' : i.mode)) return true;
    const expected = i.expectedPriorDigests[field];
    return sameDigest(cell, expected);
  }
  private async ensure(i: PublishIntent, field: Field, desired: string, expected: Digest,
    observed: Cell | null): Promise<StepResult | null> {
    if (observed?.value === desired) return null; // uncertain prior write: exact read beats a blind replay
    if (!sameDigest(observed, expected)) return { kind: 'conflict', reason: `${field} compare digest changed` };
    const result = await this.remote.set(i, field, desired, expected);
    if (result.kind === 'user-errors') {
      const stale = result.errors.some(e => ['STALE_OBJECT', 'INVALID_COMPARE_DIGEST', 'COMPARE_DIGEST_MISMATCH'].includes(e.code));
      return stale ? { kind: 'conflict', reason: `${field} compare digest rejected` }
        : { kind: 'operator-action', reason: `${field} mutation user errors: ${result.errors.map(e => e.code).join(',')}` };
    }
    return null;
  }
  private errorResult(error: unknown): { kind: 'operator-action'; reason: string } {
    return { kind: 'operator-action', reason: error instanceof TransportFault
      ? `${error.kind}: ${error.message}` : 'unexpected local adapter failure' };
  }
}
