import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeActivation, FakeAdmission, FakeInstallation, FakeRemote, MemoryJournal } from './fakes.ts';
import { Publisher } from './publisher.ts';
import type { ActivationPort, AdmissionPort, Cell, Mode, Operation, PublishIntent, RemoteState } from './publisher.ts';
import { TransportFault } from './publisher.ts';

const GENERATION = '11111111111111111111111111111111';
const OWNER = 'gid://shopify/Product/42'; // synthetic only
const NS = 'app--12345'; // synthetic resolved namespace
const established = { kind: 'established', evidence: 'synthetic isolated-model premise, not Shopify proof' } as const;
function harness(initial?: RemoteState, saved?: Operation[]) {
  const journal = new MemoryJournal(saved), remote = new FakeRemote(initial);
  const admission = new FakeAdmission(), activation = new FakeActivation();
  const installation = new FakeInstallation(GENERATION);
  const publisher = new Publisher(journal, remote, admission, activation, installation);
  return { journal, remote, admission, activation, installation, publisher };
}
function intent(mode: Mode, revision: number, state: RemoteState = { registration: null, policy: null },
  previousMode: Mode | null = null, id = `op-${revision}`): PublishIntent {
  return { operationId: id, ownerId: OWNER, namespace: NS, generationHex: GENERATION,
    revision, mode, previousMode,
    expectedPriorDigests: { registration: state.registration?.digest ?? null, policy: state.policy?.digest ?? null } };
}
async function activate(h: ReturnType<typeof harness>, i: PublishIntent) {
  h.admission.result = established; h.activation.result = established;
  assert.equal((await h.publisher.start(i)).kind, 'started');
  for (let n = 0; n < 4; n++) assert.ok(['pending', 'active'].includes((await h.publisher.advance(i.operationId)).kind));
  assert.equal(await h.publisher.newQuoteAllowed(OWNER, i.revision), true);
}

test('first managed publication journals before write and waits for both independent gates', async () => {
  const h = harness(), i = intent('required', 1);
  assert.deepEqual(await h.publisher.start(i), { kind: 'started', phase: 'prepared' });
  assert.equal(h.remote.writes.length, 0);
  assert.equal((await h.journal.get(i.operationId))?.phase, 'prepared');
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'activation-pending');
  assert.equal(h.remote.writes.length, 0);
  h.admission.result = established;
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'pending');
  assert.equal(h.remote.snapshot().registration?.value, `${GENERATION}:1:pending`);
  assert.equal(h.remote.writes[0]?.compareDigest, null); // explicit create-if-absent
  assert.equal(await h.publisher.newQuoteAllowed(OWNER, 1), false);
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'pending');
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'pending');
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'activation-pending');
  assert.equal(await h.publisher.newQuoteAllowed(OWNER, 1), false);
  h.activation.result = established;
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'active');
  assert.equal(await h.publisher.newQuoteAllowed(OWNER, 1), true);
});

test('new quote issuance rejects an active record from a prior installation generation', async () => {
  const h = harness();
  await activate(h, intent('required', 1));
  assert.equal(await h.publisher.newQuoteAllowed(OWNER, 1), true);
  h.installation.generationHex = '2'.repeat(32);
  assert.equal(await h.publisher.newQuoteAllowed(OWNER, 1), false);
  h.installation.generationHex = 'malformed';
  assert.equal(await h.publisher.newQuoteAllowed(OWNER, 1), false);
});

test('publication start and restart refuse an obsolete installation generation without mutation', async () => {
  const h = harness(), i = intent('required', 1);
  h.installation.generationHex = '2'.repeat(32);
  assert.equal((await h.publisher.start(i)).kind, 'operator-action');
  assert.equal(h.journal.snapshot().length, 0);
  h.installation.generationHex = GENERATION;
  h.admission.result = established;
  assert.equal((await h.publisher.start(i)).kind, 'started');
  h.installation.generationHex = '2'.repeat(32);
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'operator-action');
  assert.equal(h.remote.writes.length, 0);
  const restarted = harness(h.remote.snapshot(), h.journal.snapshot());
  restarted.installation.generationHex = '2'.repeat(32);
  restarted.admission.result = established;
  assert.equal((await restarted.publisher.advance(i.operationId)).kind, 'operator-action');
  assert.equal(restarted.remote.writes.length, 0);
});

test('installation rollover between admission and write prevents external mutation', async () => {
  const h = harness(), i = intent('required', 1);
  h.admission.check = async () => {
    h.installation.generationHex = '2'.repeat(32);
    return established;
  };
  assert.equal((await h.publisher.start(i)).kind, 'started');
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'operator-action');
  assert.equal(h.remote.writes.length, 0);
});

test('journal failures return typed operator action before any external write', async () => {
  const i = intent('required', 1);
  const onStart = harness();
  onStart.journal.get = async () => { throw new Error('synthetic journal outage'); };
  assert.equal((await onStart.publisher.start(i)).kind, 'operator-action');
  assert.equal(onStart.remote.writes.length, 0);

  const onAdvance = harness();
  assert.equal((await onAdvance.publisher.start(i)).kind, 'started');
  onAdvance.journal.get = async () => { throw new Error('synthetic journal outage'); };
  assert.equal((await onAdvance.publisher.advance(i.operationId)).kind, 'operator-action');
  assert.equal(onAdvance.remote.writes.length, 0);
});

test('required revisions and both policy directions preserve old effective boundary until activation', async () => {
  const h = harness();
  await activate(h, intent('required', 1));
  for (const [mode, needsBarrier] of [['required', false], ['optional', true], ['required', true]] as const) {
    const priorState = h.remote.snapshot();
    const priorMode = mode === 'required' && priorState.policy?.value.endsWith(':optional') ? 'optional'
      : mode === 'optional' ? 'required' : 'required';
    const rev = Number(priorState.registration?.value.split(':')[1]) + 1;
    const i = intent(mode, rev, priorState, priorMode);
    h.activation.result = { kind: 'pending', prerequisite: 'synthetic propagation boundary absent' };
    if (needsBarrier) h.admission.result = { kind: 'pending', prerequisite: 'all channels and carts' };
    assert.equal((await h.publisher.start(i)).kind, 'started');
    assert.equal(await h.publisher.newQuoteAllowed(OWNER, rev), false);
    if (needsBarrier) {
      assert.equal((await h.publisher.advance(i.operationId)).kind, 'activation-pending');
      assert.deepEqual(h.remote.snapshot(), priorState);
      h.admission.result = established;
    }
    for (let n = 0; n < 3; n++) assert.equal((await h.publisher.advance(i.operationId)).kind, 'pending');
    assert.equal((await h.publisher.advance(i.operationId)).kind, 'activation-pending');
    assert.equal(await h.publisher.newQuoteAllowed(OWNER, rev), false);
    h.activation.result = established;
    assert.equal((await h.publisher.advance(i.operationId)).kind, 'active');
  }
});

test('ambiguous after-commit timeout re-reads exact desired value before retry', async () => {
  const h = harness(), i = intent('required', 1);
  h.admission.result = established;
  assert.equal((await h.publisher.start(i)).kind, 'started');
  h.remote.failNext = 'timeout-after';
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'retry-later');
  assert.equal(h.remote.writes.length, 1);
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'pending');
  assert.equal(h.remote.writes.length, 1, 'must not blind-write after ambiguous commit');
  h.remote.failNext = 'timeout-after';
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'retry-later');
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'pending');
  assert.equal(h.remote.writes.length, 2);
  h.remote.failNext = 'timeout-after';
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'retry-later');
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'pending');
  assert.equal(h.remote.writes.length, 3);
});

test('lost admission premise freezes subsequent writes and quote issuance', async () => {
  const h = harness(), i = intent('required', 1);
  h.admission.result = established;
  await h.publisher.start(i);
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'pending');
  h.admission.result = { kind: 'pending', prerequisite: 'synthetic all-channel admission guarantee withdrawn' };
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'activation-pending');
  assert.equal(h.remote.writes.length, 1);
  assert.equal(h.remote.snapshot().registration?.value, `${GENERATION}:1:pending`);
  assert.equal(await h.publisher.newQuoteAllowed(OWNER, 1), false);
});

test('journal snapshot resumes after every write/readback boundary without duplicate mutation', async () => {
  for (const boundary of [0, 1, 2, 3] as const) {
    let h = harness(), i = intent('required', 1);
    h.admission.result = established; h.activation.result = established;
    assert.equal((await h.publisher.start(i)).kind, 'started');
    for (let n = 0; n < boundary; n++) await h.publisher.advance(i.operationId);
    // Simulate a new process with journal snapshot and the independently persisted remote state.
    const journalCopy = h.journal.snapshot(), remoteCopy = h.remote.snapshot();
    const writesBefore = h.remote.writes.length;
    h = harness(remoteCopy, journalCopy);
    h.admission.result = established; h.activation.result = established;
    for (let n = boundary; n < 4; n++) await h.publisher.advance(i.operationId);
    assert.equal((await h.journal.get(i.operationId))?.phase, 'active');
    assert.equal(h.remote.writes.length, 3 - writesBefore);
  }
});

test('crash after remote write but before journal save resumes from exact remote readback', async () => {
  for (const after of [0, 1, 2]) {
    const h = harness(), i = intent('required', 1);
    h.admission.result = established; h.activation.result = established;
    await h.publisher.start(i);
    for (let n = 0; n < after; n++) await h.publisher.advance(i.operationId);
    const before = h.journal.snapshot();
    const originalSave = h.journal.save.bind(h.journal);
    let fail = true;
    h.journal.save = async (record, version) => {
      if (fail) { fail = false; throw new Error('synthetic process crash'); }
      return originalSave(record, version);
    };
    assert.equal((await h.publisher.advance(i.operationId)).kind, 'operator-action');
    const resumed = harness(h.remote.snapshot(), before);
    resumed.admission.result = established; resumed.activation.result = established;
    for (let n = after; n < 4; n++) await resumed.publisher.advance(i.operationId);
    assert.equal((await resumed.journal.get(i.operationId))?.phase, 'active');
    assert.equal(resumed.remote.writes.length, 2 - after);
  }
});

test('same operation replays; same ID or revision with changed payload and concurrent op conflict', async () => {
  const h = harness(), i = intent('required', 1);
  assert.equal((await h.publisher.start(i)).kind, 'started');
  assert.equal((await h.publisher.start(i)).kind, 'replayed');
  const reordered: PublishIntent = { expectedPriorDigests: { policy: null, registration: null },
    previousMode: null, mode: 'required', revision: 1, generationHex: GENERATION,
    namespace: NS, ownerId: OWNER, operationId: i.operationId };
  assert.equal((await h.publisher.start(reordered)).kind, 'replayed');
  assert.equal((await h.publisher.start({ ...i, mode: 'optional' })).kind, 'conflict');
  assert.equal((await h.publisher.start({ ...i, operationId: 'other', mode: 'optional' })).kind, 'conflict');
});

test('concurrent owner claims admit only one prepared operation in the local journal', async () => {
  const h = harness();
  const [a, b] = await Promise.all([
    h.publisher.start(intent('required', 1, undefined, null, 'race-a')),
    h.publisher.start(intent('required', 1, undefined, null, 'race-b'))
  ]);
  assert.deepEqual([a.kind, b.kind].sort(), ['conflict', 'started']);
  assert.equal(h.journal.snapshot().length, 1);
  assert.equal(h.remote.writes.length, 0);
});

test('mutation user errors, stale CAS, and bounded timeout preserve journal and anchors', async () => {
  for (const [fault, expected] of [['user-error', 'operator-action'], ['stale', 'conflict']] as const) {
    const h = harness(), i = intent('required', 1);
    h.admission.result = established;
    await h.publisher.start(i);
    h.remote.failNext = fault;
    assert.equal((await h.publisher.advance(i.operationId)).kind, expected);
    assert.equal((await h.journal.get(i.operationId))?.phase, 'prepared');
    assert.deepEqual(h.remote.snapshot(), { registration: null, policy: null });
  }
  const h = harness(), i = intent('required', 1);
  h.admission.result = established; await h.publisher.start(i);
  for (let n = 1; n <= 4; n++) {
    h.remote.failNext = 'timeout-before';
    assert.equal((await h.publisher.advance(i.operationId)).kind, n < 4 ? 'retry-later' : 'operator-action');
  }
  assert.equal((await h.journal.get(i.operationId))?.phase, 'retry-exhausted');
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'operator-action');
  assert.equal(h.remote.writes.length, 0, 'fifth call must not retry the external write');
  const restarted = harness(h.remote.snapshot(), h.journal.snapshot());
  restarted.admission.result = established;
  assert.equal((await restarted.publisher.advance(i.operationId)).kind, 'operator-action');
  assert.equal(restarted.remote.writes.length, 0);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

test('stale activation-pending save cannot overwrite a concurrent active journal decision', async () => {
  const h = harness(), i = intent('required', 1);
  h.admission.result = established; h.activation.result = established;
  await h.publisher.start(i);
  for (let n = 0; n < 3; n++) await h.publisher.advance(i.operationId);
  const entered = deferred<void>(), release = deferred<void>();
  const slowActivation: ActivationPort = { check: async () => {
    entered.resolve(); await release.promise;
    return { kind: 'pending', prerequisite: 'stale synthetic observation' };
  } };
  const slow = new Publisher(h.journal, h.remote, h.admission, slowActivation, h.installation);
  const staleStep = slow.advance(i.operationId);
  await entered.promise;
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'active');
  release.resolve();
  assert.equal((await staleStep).kind, 'conflict');
  assert.equal((await h.journal.get(i.operationId))?.phase, 'active');
  assert.equal(await h.publisher.newQuoteAllowed(OWNER, 1), true);
});

test('stale timeout save cannot overwrite a concurrent active journal decision', async () => {
  const h = harness(), i = intent('required', 1);
  h.admission.result = established; h.activation.result = established;
  await h.publisher.start(i);
  for (let n = 0; n < 3; n++) await h.publisher.advance(i.operationId);
  const entered = deferred<void>(), release = deferred<void>();
  const slowAdmission: AdmissionPort = { check: async () => {
    entered.resolve(); await release.promise;
    throw new TransportFault('timeout', 'synthetic stale check timeout');
  } };
  const slow = new Publisher(h.journal, h.remote, slowAdmission, h.activation, h.installation);
  const staleStep = slow.advance(i.operationId);
  await entered.promise;
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'active');
  release.resolve();
  assert.equal((await staleStep).kind, 'conflict');
  assert.equal((await h.journal.get(i.operationId))?.phase, 'active');
});

test('saved activation-pending phase survives restart and never self-activates', async () => {
  let h = harness(); const i = intent('required', 1);
  h.admission.result = established;
  await h.publisher.start(i);
  for (let n = 0; n < 3; n++) await h.publisher.advance(i.operationId);
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'activation-pending');
  assert.equal((await h.journal.get(i.operationId))?.phase, 'activation-pending');
  h = harness(h.remote.snapshot(), h.journal.snapshot());
  h.admission.result = established;
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'activation-pending');
  assert.equal(await h.publisher.newQuoteAllowed(OWNER, 1), false);
  h.activation.result = established;
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'active');
});

test('missing, partial, malformed, stale and wrong-generation states cannot become optional', async () => {
  const cell = (value: string): Cell => ({ value, digest: 'a'.repeat(64) });
  const states: RemoteState[] = [
    { registration: cell(`${GENERATION}:1:ready`), policy: null },
    { registration: null, policy: cell(`${GENERATION}:1:optional`) },
    { registration: cell('garbage'), policy: cell(`${GENERATION}:1:optional`) },
    { registration: cell(`${GENERATION}:1:ready`), policy: cell(`${GENERATION}:2:optional`) },
    { registration: cell(`${'2'.repeat(32)}:1:ready`), policy: cell(`${GENERATION}:1:optional`) }
  ];
  for (const state of states) {
    const h = harness(state), i = intent('optional', 2, state, 'optional');
    assert.equal((await h.publisher.start(i)).kind, 'operator-action');
    assert.equal(h.remote.writes.length, 0);
  }
  const h = harness(), i = intent('required', 1);
  h.admission.result = established;
  await h.publisher.start(i); await h.publisher.advance(i.operationId);
  h.remote.corrupt('registration', null);
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'operator-action');
  assert.equal(h.remote.writes.length, 1);
});

test('wrong-generation or missing exact ready pair after write prevents activation', async () => {
  const h = harness(), i = intent('required', 1);
  h.admission.result = established; h.activation.result = established;
  await h.publisher.start(i);
  for (let n = 0; n < 3; n++) assert.equal((await h.publisher.advance(i.operationId)).kind, 'pending');
  h.remote.corrupt('policy', { value: `${'2'.repeat(32)}:1:required`, digest: 'c'.repeat(64) });
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'operator-action');
  assert.equal(await h.publisher.newQuoteAllowed(OWNER, 1), false);
  h.remote.corrupt('policy', null);
  assert.equal((await h.publisher.advance(i.operationId)).kind, 'operator-action');
});

test('stale prior digest and conflicting ready revision never overwrite foreign state', async () => {
  const h = harness(), i = intent('required', 1);
  await activate(h, i);
  const state = h.remote.snapshot();
  const next = intent('optional', 2, state, 'required');
  next.expectedPriorDigests.policy = 'f'.repeat(64);
  assert.equal((await h.publisher.start(next)).kind, 'conflict');
  const valid = intent('optional', 2, state, 'required');
  assert.equal((await h.publisher.start(valid)).kind, 'started');
  h.remote.corrupt('registration', { value: `${GENERATION}:3:ready`, digest: 'e'.repeat(64) });
  assert.equal((await h.publisher.advance(valid.operationId)).kind, 'conflict');
  assert.equal(h.remote.writes.length, 3);
});

test('complete loss and coherent rollback are explicit unsupported-fault fixtures', async () => {
  const h = harness(); await activate(h, intent('required', 1));
  // Option A accepts that a Function observing both fields absent cannot identify required merchandise.
  const lost = { registration: null, policy: null };
  const rollback = { registration: { value: `${GENERATION}:1:ready`, digest: 'a'.repeat(64) },
    policy: { value: `${GENERATION}:1:optional`, digest: 'b'.repeat(64) } };
  assert.deepEqual(lost, { registration: null, policy: null });
  assert.equal(rollback.policy.value.endsWith(':optional'), true);
  assert.equal(await h.publisher.newQuoteAllowed(OWNER, 2), false);
  h.remote.corrupt('registration', null); h.remote.corrupt('policy', null);
  assert.equal((await h.publisher.start(intent('optional', 1, h.remote.snapshot(), null, 'new-op'))).kind,
    'operator-action', 'journal knowledge must not normalize joint loss as unmanaged first publication');
  h.remote.corrupt('registration', rollback.registration); h.remote.corrupt('policy', rollback.policy);
  assert.equal((await h.publisher.start(intent('required', 2, h.remote.snapshot(), 'optional', 'other-op'))).kind,
    'operator-action', 'journal knowledge must flag coherent rollback');
});
