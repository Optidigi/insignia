import { randomUUID } from 'node:crypto';
import type { ExpectedFunctionBuild, FunctionArtifactScope, TrustedReleaseRecord } from '@insignia/application';
import { type RuntimeReleaseProfileName, resolveRuntimeReleaseProfile } from './runtime-release-profile.js';

/** Structural SELECT-only evidence port; persistence and append custody stay outside this adapter. */
export type TrustedReleaseEvidenceRecord = Readonly<{
  record: TrustedReleaseRecord;
  expectedBuild: ExpectedFunctionBuild;
  activeVersionEvidenceSha256: string;
  evidenceDigest: string;
}>;
export interface TrustedReleaseEvidenceRecordsPort {
  read(request: {
    scope: FunctionArtifactScope;
    expectedActiveAppVersionRef: string;
    now: Date;
  }): Promise<TrustedReleaseEvidenceRecord | null>;
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

/** Server-bound collection capability. Completion is correlated, then independently
 * read through the existing SELECT-only source. No staff credential crosses it. */
export function createDemandDrivenReleaseReader(input: {
  records: TrustedReleaseEvidenceRecordsPort;
  binding: ReleaseVerificationBinding;
  collector: ReleaseVerificationCollector;
  isCurrent(): Promise<void>;
  deadline(): number;
  now?: () => Date;
  releaseProfile?: RuntimeReleaseProfileName;
  inFlight?: Map<string, Promise<{ requestId: string; recordId: string | null; state: string }>>;
}): TrustedReleaseEvidenceRecordsPort {
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
    async read(request: Parameters<TrustedReleaseEvidenceRecordsPort['read']>[0]) {
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
