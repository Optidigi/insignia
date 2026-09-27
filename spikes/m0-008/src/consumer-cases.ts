/** Deterministic remote states emitted by the TS publisher for the Rust consumer. */
import { FakeActivation, FakeAdmission, FakeRemote, MemoryJournal } from './fakes.ts';
import { Publisher } from './publisher.ts';
import type { Mode, PublishIntent, RemoteState } from './publisher.ts';

const generationHex = '11'.repeat(16);
const ownerId = 'gid://shopify/Product/42'; // synthetic, never a staging resource
const namespace = 'app--12345';
const established = { kind: 'established', evidence: 'synthetic isolated admission premise' } as const;

export async function consumerCases(): Promise<string> {
  const remote = new FakeRemote();
  const journal = new MemoryJournal();
  const admission = new FakeAdmission();
  const activation = new FakeActivation();
  admission.result = established;
  activation.result = established;
  const publisher = new Publisher(journal, remote, admission, activation);
  const rows = ['case|registration|policy|plain|signed'];
  const capture = (name: string, plain: string, signed: boolean): void => {
    const { registration, policy } = remote.snapshot();
    rows.push([name, registration?.value ?? '-', policy?.value ?? '-', plain, String(signed)].join('|'));
  };
  const intent = (mode: Mode, revision: number, previousMode: Mode | null): PublishIntent => {
    const state: RemoteState = remote.snapshot();
    return {
      operationId: `consumer-op-${revision}`, ownerId, namespace, generationHex, revision, mode,
      previousMode,
      expectedPriorDigests: {
        registration: state.registration?.digest ?? null,
        policy: state.policy?.digest ?? null
      }
    };
  };
  const first = intent('required', 1, null);
  if ((await publisher.start(first)).kind !== 'started') throw new Error('first operation not started');
  capture('before_first_publication', 'Unmanaged', true); // Option A joint-loss shape
  await publisher.advance(first.operationId);
  capture('first_registration_pending', 'Uncertain', true);
  await publisher.advance(first.operationId);
  capture('first_policy_written', 'Uncertain', true);
  await publisher.advance(first.operationId);
  capture('first_required_ready', 'Required', true);
  await publisher.advance(first.operationId);

  const next = intent('required', 2, 'required');
  if ((await publisher.start(next)).kind !== 'started') throw new Error('revision not started');
  await publisher.advance(next.operationId);
  capture('rev1_signed_offer_during_rev2_pending', 'Uncertain', true);
  await publisher.advance(next.operationId);
  capture('required_revision_policy_written', 'Uncertain', true);
  await publisher.advance(next.operationId);
  capture('required_revision_ready', 'Required', true);
  await publisher.advance(next.operationId);

  const optional = intent('optional', 3, 'required');
  if ((await publisher.start(optional)).kind !== 'started') throw new Error('optional operation not started');
  await publisher.advance(optional.operationId);
  capture('rev1_signed_offer_during_optional_pending', 'Uncertain', true);
  await publisher.advance(optional.operationId);
  capture('optional_policy_written', 'Uncertain', true);
  await publisher.advance(optional.operationId);
  capture('optional_ready', 'Optional', true);
  await publisher.advance(optional.operationId);

  const requiredAgain = intent('required', 4, 'optional');
  if ((await publisher.start(requiredAgain)).kind !== 'started') throw new Error('required operation not started');
  await publisher.advance(requiredAgain.operationId);
  capture('optional_to_required_registration_pending', 'Uncertain', true);
  await publisher.advance(requiredAgain.operationId);
  capture('optional_to_required_policy_written', 'Uncertain', true);
  await publisher.advance(requiredAgain.operationId);
  capture('optional_to_required_ready', 'Required', true);

  remote.corrupt('registration', null);
  capture('one_anchor_missing', 'Uncertain', true);
  remote.corrupt('registration', {
    value: `${'22'.repeat(16)}:4:ready`, digest: 'a'.repeat(64)
  });
  capture('wrong_generation', 'WrongGeneration', false);
  remote.corrupt('registration', null);
  remote.corrupt('policy', null);
  capture('unsupported_joint_loss', 'Unmanaged', true);
  return `${rows.join('\n')}\n`;
}
