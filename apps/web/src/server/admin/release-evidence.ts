import type { ActivationReadinessPort } from '@insignia/application';
import {
  createTrustedReleaseEvidencePort,
  type ExpectedFunctionBuild,
  type FunctionArtifactScope,
  localDay,
  type TrustedReleaseRecordSource,
} from '@insignia/application';
import type { DurableCore } from '@insignia/database';

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

/** This reviewed runtime targets the accepted existing Active version; environment/browser values are not authority. */
const acceptedActiveAppVersionRef = '1162611916801';
export function createBoundProductionActivationReadiness(input: {
  scope: FunctionArtifactScope;
  ianaTimezone: string | null;
  records: DurableCore['trustedReleaseRecords'];
  observeFunctions: (
    scope: FunctionArtifactScope,
    expected: ExpectedFunctionBuild,
  ) => ReturnType<ActivationReadinessPort['observeFunctions']>;
  now?: () => Date;
}): Omit<ActivationReadinessPort, 'observeProjection'> {
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
