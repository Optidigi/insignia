import { createHash } from 'node:crypto';
import type { ActivationPort, AdmissionPort, Cell, Check, Digest, Field, Journal, Operation,
  PolicyTransport, Previous, PublishIntent, RemoteState, WriteResult } from './publisher.ts';
import { TransportFault } from './publisher.ts';

function clone<T>(value: T): T { return structuredClone(value); }
export class MemoryJournal implements Journal {
  private records = new Map<string, Operation>();
  constructor(snapshot: readonly Operation[] = []) {
    for (const record of snapshot) this.records.set(record.intent.operationId, clone(record));
  }
  snapshot(): Operation[] { return clone([...this.records.values()]); }
  async get(id: string): Promise<Operation | null> { return clone(this.records.get(id) ?? null); }
  async currentFor(ownerId: string): Promise<Operation | null> {
    const list = [...this.records.values()].filter(r => r.intent.ownerId === ownerId);
    return clone(list.at(-1) ?? null);
  }
  async insertIfAbsent(record: Operation): Promise<boolean> {
    if (this.records.has(record.intent.operationId)) return false;
    // Atomic within this single-process fake: no await between owner check and insert.
    // Production durability/fencing requires a real transactional journal.
    const open = [...this.records.values()].filter(r => r.intent.ownerId === record.intent.ownerId).at(-1);
    if (open && open.phase !== 'active') return false;
    this.records.set(record.intent.operationId, clone(record)); return true;
  }
  async save(record: Operation, expectedVersion: number): Promise<boolean> {
    const current = this.records.get(record.intent.operationId);
    if (!current || current.version !== expectedVersion || record.version !== expectedVersion + 1) return false;
    this.records.set(record.intent.operationId, clone(record));
    return true;
  }
}

export class FakeRemote implements PolicyTransport {
  state: RemoteState;
  writes: { field: Field; desired: string; compareDigest: Digest }[] = [];
  failNext: 'timeout-before' | 'timeout-after' | 'user-error' | 'stale' | null = null;
  constructor(initial: RemoteState = { registration: null, policy: null }) { this.state = clone(initial); }
  snapshot(): RemoteState { return clone(this.state); }
  async read(_intent: PublishIntent): Promise<RemoteState> { return this.snapshot(); }
  async set(_intent: PublishIntent, field: Field, value: string, compareDigest: Digest): Promise<WriteResult> {
    const fault = this.failNext; this.failNext = null;
    if (fault === 'timeout-before') throw new TransportFault('timeout', 'synthetic before-commit timeout');
    if (fault === 'user-error') return { kind: 'user-errors', errors: [{ code: 'INVALID_VALUE', message: 'synthetic' }] };
    if (fault === 'stale') return { kind: 'user-errors', errors: [{ code: 'STALE_OBJECT', message: 'synthetic' }] };
    const observed = this.state[field];
    if ((observed?.digest ?? null) !== compareDigest)
      return { kind: 'user-errors', errors: [{ code: 'STALE_OBJECT', message: 'synthetic CAS' }] };
    this.writes.push({ field, desired: value, compareDigest });
    this.state[field] = { value, digest: createHash('sha256').update(value).digest('hex') };
    if (fault === 'timeout-after') throw new TransportFault('timeout', 'synthetic after-commit timeout');
    return { kind: 'ack' };
  }
  corrupt(field: Field, cell: Cell | null): void { this.state[field] = clone(cell); }
}

/** These controls model explicit assumptions; neither is a real Shopify implementation. */
export class FakeAdmission implements AdmissionPort {
  result: Check = { kind: 'pending', prerequisite: 'prove all-channel unavailability and in-flight cart drain' };
  async check(_intent: PublishIntent, _previous: Previous): Promise<Check> { return this.result; }
}
export class FakeActivation implements ActivationPort {
  result: Check = { kind: 'pending', prerequisite: 'establish admission/Function projection boundary beyond Admin readback and samples' };
  async check(_intent: PublishIntent, _previous: Previous, _admin: RemoteState): Promise<Check> { return this.result; }
}
