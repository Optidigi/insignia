import { createObservability, describeUnexpectedError, type SystemFailureDiagnostic } from '@insignia/observability';

/** One registry per web process, shared by ingress and its protected scrape route. */
export const webObservability = createObservability();

export type SystemFailureRecorder = (failure: SystemFailureDiagnostic) => void;

/** Production recorder for unexpected webhook and operator failures. */
export const logSystemFailure: SystemFailureRecorder = (failure) =>
  webObservability.logger.error('system_request_failed', { systemFailure: failure });

/** An unexpected webhook or operator failure is recorded by route and reduced error only (never the message,
 * shop, topic, HMAC or payload). A throwing recorder is swallowed: the caller returns the same response. */
export function recordSystemFailure(
  record: SystemFailureRecorder | undefined,
  systemRoute: SystemFailureDiagnostic['systemRoute'],
  error: unknown,
): void {
  try {
    record?.({ systemRoute, ...describeUnexpectedError(error) });
  } catch {
    // Observation is best effort.
  }
}
