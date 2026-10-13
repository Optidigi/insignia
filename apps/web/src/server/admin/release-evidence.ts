import { randomUUID } from 'node:crypto';
import type { ActivationReadinessPort } from '@insignia/application';
import {
  createTrustedReleaseEvidencePort,
  type ExpectedFunctionBuild,
  type FunctionArtifactScope,
  localDay,
  type TrustedReleaseRecordSource,
} from '@insignia/application';
import type { DurableCore } from '@insignia/database';
import { type RuntimeReleaseProfileName, resolveRuntimeReleaseProfile } from '@insignia/shopify';

/** Server-only composition. Operator-owned immutable evidence supplies the
 * capability; HTTP controllers, browser payloads and environment JSON do not.
 * Omitting it deliberately leaves activation waiting for RELEASE_BOUND.
 * This module neither creates releases nor manufactures release attestations.
 */
export function createServerActivationReadiness(
  observations: Omit<ActivationReadinessPort, 'trustedEvidence' | 'observeProjection'>,
  releaseSource?: TrustedReleaseRecordSource,
): Omit<ActivationReadinessPort, 'observeProjection'> {
  return Object.freeze({
    expectedBuild: observations.expectedBuild,
    observeFunctions: observations.observeFunctions,
    currentDay: observations.currentDay,
    trustedEvidence: createTrustedReleaseEvidencePort(releaseSource),
  });
}

/** Authenticated provider context is preloaded; no async IO or browser timezone at the decision. */
export function createTrustedMerchantCalendar(
  scope: FunctionArtifactScope,
  ianaTimezone: string,
): ActivationReadinessPort['currentDay'] {
  try {
    if (
      typeof ianaTimezone !== 'string' ||
      ianaTimezone.length > 128 ||
      !/^[A-Za-z_][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+){0,3}$/.test(ianaTimezone)
    )
      throw new Error('Invalid timezone');
    localDay(new Date(0), ianaTimezone);
  } catch {
    throw new Error('Trusted merchant calendar unavailable');
  }
  const bound = Object.freeze({ ...scope });
  return (candidate, now) => {
    if (
      candidate.shopId !== bound.shopId ||
      candidate.scope.installationGeneration !== bound.installationGeneration ||
      candidate.availabilityScope.appClientId !== bound.appClientId
    )
      throw new Error('Trusted merchant calendar scope mismatch');
    return localDay(now, ianaTimezone).ordinal;
  };
}

export function createBoundProductionActivationReadiness(input: {
  scope: FunctionArtifactScope;
  ianaTimezone: string | null;
  records: DurableCore['trustedReleaseRecords'];
  observeFunctions: (
    scope: FunctionArtifactScope,
    expected: ExpectedFunctionBuild,
  ) => ReturnType<ActivationReadinessPort['observeFunctions']>;
  now?: () => Date;
  releaseProfile?: RuntimeReleaseProfileName;
}): Omit<ActivationReadinessPort, 'observeProjection'> {
  const acceptedActiveAppVersionRef = resolveRuntimeReleaseProfile(input.releaseProfile).activeVersionRef;
  const bound = Object.freeze({ ...input.scope });
  const matches = (scope: FunctionArtifactScope) =>
    scope.shopId === bound.shopId &&
    scope.installationGeneration === bound.installationGeneration &&
    scope.appClientId === bound.appClientId;
  const read = (scope: FunctionArtifactScope) =>
    matches(scope)
      ? input.records.read({
          scope: bound,
          expectedActiveAppVersionRef: acceptedActiveAppVersionRef,
          now: (input.now ?? (() => new Date()))(),
        })
      : Promise.resolve(null);
  const expectedBuild = { read: async (scope: FunctionArtifactScope) => (await read(scope))?.expectedBuild ?? null };
  const calendar: ActivationReadinessPort['currentDay'] =
    input.ianaTimezone === null
      ? () => {
          throw new Error('Trusted merchant calendar unavailable');
        }
      : createTrustedMerchantCalendar(bound, input.ianaTimezone);
  return createServerActivationReadiness(
    {
      expectedBuild,
      observeFunctions: async (scope) => {
        const expected = await expectedBuild.read(scope);
        return expected
          ? input.observeFunctions(bound, expected)
          : { transform: 'unknown', validation: 'unknown', observation: null };
      },
      currentDay: calendar,
    },
    { read: async (scope) => (await read(scope))?.record ?? null },
  );
}

export type ReleaseVerificationBinding = FunctionArtifactScope & {
  authorizationGeneration: string;
  authorizationEpoch: number;
  externalInstallationId: string;
};
export interface ReleaseVerificationCollector {
  collect(request: {
    requestId: string;
    binding: ReleaseVerificationBinding;
    expectedActiveAppVersionRef: string;
    deadlineMs: number;
  }): Promise<{
    requestId: string;
    recordId: string | null;
    state: 'COMPLETE' | 'WAITING' | 'STOPPED' | 'UNCERTAIN';
  }>;
}

/** Mutation-only capability. Collector completion is correlated, then independently
 * read through the existing SELECT-only source. No staff credential crosses it. */
export function createDemandDrivenReleaseReader(input: {
  records: DurableCore['trustedReleaseRecords'];
  binding: ReleaseVerificationBinding;
  collector: ReleaseVerificationCollector;
  isCurrent(): Promise<void>;
  deadline(): number;
  now?: () => Date;
  releaseProfile?: RuntimeReleaseProfileName;
  inFlight?: Map<string, Promise<{ requestId: string; recordId: string | null; state: string }>>;
}): DurableCore['trustedReleaseRecords'] {
  const acceptedActiveAppVersionRef = resolveRuntimeReleaseProfile(input.releaseProfile).activeVersionRef;
  const binding = Object.freeze({ ...input.binding });
  const now = input.now ?? (() => new Date());
  const inFlight = input.inFlight ?? new Map();
  const key = JSON.stringify(binding);
  const matches = (scope: FunctionArtifactScope) =>
    scope.shopId === binding.shopId &&
    scope.installationGeneration === binding.installationGeneration &&
    scope.appClientId === binding.appClientId;
  async function current() {
    if (now().getTime() >= input.deadline()) throw new Error('Publication identity expired');
    await input.isCurrent();
    if (now().getTime() >= input.deadline()) throw new Error('Publication identity expired');
  }
  const read = () =>
    input.records.read({
      scope: binding,
      expectedActiveAppVersionRef: acceptedActiveAppVersionRef,
      now: now(),
    });
  return Object.freeze({
    async read(request) {
      if (!matches(request.scope) || request.expectedActiveAppVersionRef !== acceptedActiveAppVersionRef) return null;
      await current();
      const existing = await read();
      if (existing) {
        await current();
        return existing;
      }
      let collection = inFlight.get(key);
      if (!collection) {
        const requestId = randomUUID();
        collection = input.collector
          .collect({
            requestId,
            binding,
            expectedActiveAppVersionRef: acceptedActiveAppVersionRef,
            deadlineMs: input.deadline(),
          })
          .then((result) => {
            if (result.requestId !== requestId) throw new Error('Verification completion mismatch');
            return result;
          });
        inFlight.set(key, collection);
      }
      let completed: Awaited<typeof collection>;
      try {
        completed = await collection;
      } catch {
        return null;
      } finally {
        if (inFlight.get(key) === collection) inFlight.delete(key);
      }
      await current();
      if (completed.state !== 'COMPLETE' || !completed.recordId) return null;
      const evidence = await read();
      await current();
      return evidence?.record.recordId === completed.recordId ? evidence : null;
    },
  });
}
