import { createFunctionOwnershipReconciler, type ExpectedFunctionOwnership } from './function-ownership.js';
import { createFunctionProvisioningPort } from './function-provision.js';
import type { PublicationAdminTransport, PublicationTenant } from './publication-admin.js';

type Operation = 'READ_PRESTATE' | 'CREATE_TRANSFORM' | 'READ_TRANSFORM' | 'CREATE_VALIDATION' | 'READ_FINAL';
export type FunctionSetupJournal = {
  /** Synchronous fsync admission before transport dispatch; throws on repeat. */
  reserve(operation: Operation): boolean;
  settle(operation: Operation, outcome: 'ACK' | 'STOP', id?: string | null): void;
  finish(classification: 'FUNCTIONS_VERIFIED' | 'FUNCTION_SETUP_STOPPED'): void;
};
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
function requireFact(value: unknown): asserts value {
  if (!value) throw new Error('function_setup_stopped');
}

/** Operator-only composition. Native release/build, current install/generation and staff
 * authority must be independently verified by verifyAuthority. This verifies deployment
 * presence, not signing readiness, runtime Wasm propagation or publication eligibility. */
export async function provisionOwnedFunctions(input: {
  tenant: PublicationTenant;
  expected: ExpectedFunctionOwnership;
  functionIds: Readonly<{ transform: string; validation: string }>;
  transport: PublicationAdminTransport;
  journal: FunctionSetupJournal;
  clock: () => Date;
  /** Rechecks exact release/artifacts, current installation/generation and both app/staff
   * write grants. Returns the earliest expiry of those independently qualified facts. */
  verifyAuthority: () => Promise<Date>;
  /** Final independent Active/install/generation read; cannot extend earlier freshness. */
  verifyClosingAuthority: () => Promise<Date>;
}) {
  input = {
    ...input,
    tenant: { ...input.tenant },
    expected: { ...input.expected },
    functionIds: { ...input.functionIds },
  };
  const flags = {
    transformAttempted: false,
    validationAttempted: false,
    transformAcknowledged: false,
    validationAcknowledged: false,
  };
  let classification: 'FUNCTIONS_VERIFIED' | 'FUNCTION_SETUP_STOPPED' = 'FUNCTION_SETUP_STOPPED';
  let receiptDurable = false;
  let deadline = 0;
  const start = input.clock().getTime();
  const live = () => {
    const now = input.clock().getTime();
    requireFact(Number.isFinite(now) && now >= start && now < deadline);
  };
  async function authority() {
    const before = input.clock().getTime();
    deadline = (await input.verifyAuthority()).getTime();
    requireFact(Number.isFinite(deadline) && deadline <= before + 30_000);
    live();
  }
  async function snapshot(operation: Operation) {
    await authority();
    requireFact(input.journal.reserve(operation) === true);
    let body: unknown;
    const reconciler = createFunctionOwnershipReconciler({
      clock: input.clock,
      transport: {
        async execute(request) {
          live();
          const response = await input.transport.execute(request);
          body = response.body;
          return response;
        },
      },
    });
    const owned = await reconciler.read(input.tenant, input.expected);
    live();
    requireFact(
      owned.observation?.transform?.functionId === input.functionIds.transform &&
        owned.observation.validation?.functionId === input.functionIds.validation,
    );
    const data = object(object(body)?.data);
    const transforms = object(data?.cartTransforms)?.nodes;
    const validations = object(data?.validations)?.nodes;
    requireFact(
      Array.isArray(transforms) && Array.isArray(validations) && transforms.length <= 1 && validations.length <= 1,
    );
    // No foreign deployment may be silently ignored by the ownership filter.
    requireFact(transforms.every((item) => object(item)?.functionId === input.functionIds.transform));
    requireFact(
      validations.every((item) => object(object(item)?.shopifyFunction)?.id === input.functionIds.validation),
    );
    requireFact(['present', 'missing'].includes(owned.transform) && ['present', 'missing'].includes(owned.validation));
    requireFact(
      (owned.transform === 'present') === (transforms.length === 1) &&
        (owned.validation === 'present') === (validations.length === 1),
    );
    requireFact(
      transforms.every(
        (item) =>
          typeof object(item)?.id === 'string' &&
          /^gid:\/\/shopify\/CartTransform\/[1-9][0-9]*$/.test(String(object(item)?.id)),
      ),
    );
    requireFact(
      validations.every(
        (item) =>
          typeof object(item)?.id === 'string' &&
          /^gid:\/\/shopify\/Validation\/[1-9][0-9]*$/.test(String(object(item)?.id)),
      ),
    );
    input.journal.settle(operation, 'ACK');
    return {
      transform: owned.transform,
      validation: owned.validation,
      transformId: object(transforms[0])?.id,
      validationId: object(validations[0])?.id,
    };
  }
  try {
    const provision = createFunctionProvisioningPort({
      transport: input.transport,
      appKey: input.expected.appKey,
      functionIds: input.functionIds,
    });
    const before = await snapshot('READ_PRESTATE');
    if (before.transform === 'present' && before.validation === 'present') {
      classification = 'FUNCTIONS_VERIFIED';
    } else {
      requireFact(before.transform === 'missing' && before.validation === 'missing');
      const ids: Partial<Record<'transform' | 'validation', string>> = {};
      for (const kind of ['transform', 'validation'] as const) {
        await authority();
        const operation = kind === 'transform' ? 'CREATE_TRANSFORM' : 'CREATE_VALIDATION';
        const result = await provision.create(kind, input.tenant, () => {
          live();
          requireFact(input.journal.reserve(operation) === true);
          flags[kind === 'transform' ? 'transformAttempted' : 'validationAttempted'] = true;
          return true;
        });
        flags[kind === 'transform' ? 'transformAcknowledged' : 'validationAcknowledged'] = true;
        ids[kind] = result.id;
        input.journal.settle(operation, 'ACK', result.id);
        const observed = await snapshot(kind === 'transform' ? 'READ_TRANSFORM' : 'READ_FINAL');
        requireFact(observed.transform === 'present' && observed.transformId === ids.transform);
        requireFact(
          kind === 'transform'
            ? observed.validation === 'missing'
            : observed.validation === 'present' && observed.validationId === ids.validation,
        );
      }
      classification = 'FUNCTIONS_VERIFIED';
    }
    deadline = Math.min(deadline, (await input.verifyClosingAuthority()).getTime());
    live();
  } catch {
    classification = 'FUNCTION_SETUP_STOPPED';
  }
  try {
    input.journal.finish(classification);
    receiptDurable = true;
  } catch {
    classification = 'FUNCTION_SETUP_STOPPED';
  }
  return Object.freeze({
    classification,
    ...flags,
    receiptDurable,
    retryAuthorized: false as const,
    publicationReady: false as const,
  });
}
