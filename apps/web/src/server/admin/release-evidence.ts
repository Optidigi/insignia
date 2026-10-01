import type { ActivationReadinessPort } from '@insignia/application';
import { createTrustedReleaseEvidencePort, type TrustedReleaseRecordSource } from '@insignia/application';

/** Server-only composition. A later authenticated release pipeline supplies the
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
