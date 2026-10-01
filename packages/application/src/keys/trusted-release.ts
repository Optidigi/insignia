import {
  type FunctionArtifactAttestation,
  type FunctionArtifactScope,
  parseFunctionArtifactAttestation,
  type TrustedFunctionArtifactEvidencePort,
} from './artifact-attestation.js';

export type TrustedReleaseRecord = Readonly<{
  version: 'm5-trusted-release-v1';
  recordId: string;
  activeAppVersionRef: string;
  attestation: FunctionArtifactAttestation & { evidenceKind: 'RELEASE_BOUND' };
}>;
/** Server capability owned by a later authenticated release pipeline/operator.
 * Implementations must authenticate their source and independently verify the active version.
 * JSON shape, environment values and Admin Function observations do not confer this capability.
 * This slice supplies no production implementation, keys or release record.
 */
export interface TrustedReleaseRecordSource {
  read(scope: FunctionArtifactScope): Promise<unknown | null>;
}

function parseRecord(value: unknown, scope: FunctionArtifactScope): TrustedReleaseRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Trusted release record missing');
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  const fields = ['version', 'recordId', 'activeAppVersionRef', 'attestation'];
  if (
    (Object.getPrototypeOf(record) !== Object.prototype && Object.getPrototypeOf(record) !== null) ||
    keys.length !== fields.length ||
    !keys.every(
      (key) =>
        typeof key === 'string' &&
        fields.includes(key) &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(record, key) ?? {}, 'value'),
    ) ||
    record.version !== 'm5-trusted-release-v1' ||
    typeof record.recordId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9:/._-]{0,255}$/.test(record.recordId)
  )
    throw new Error('Trusted release record malformed');
  const attestation = parseFunctionArtifactAttestation(record.attestation);
  if (
    attestation.evidenceKind !== 'RELEASE_BOUND' ||
    attestation.appVersionRef !== record.activeAppVersionRef ||
    scope.shopId !== attestation.shopId ||
    scope.installationGeneration !== attestation.installationGeneration ||
    scope.appClientId !== attestation.appClientId
  )
    throw new Error('Trusted active release binding mismatch');
  return Object.freeze({
    version: 'm5-trusted-release-v1',
    recordId: record.recordId,
    activeAppVersionRef: attestation.appVersionRef,
    attestation,
  });
}

/** No source is wired by default. Never turns source/dev observations into release authority. */
export function createTrustedReleaseEvidencePort(
  source?: TrustedReleaseRecordSource,
): TrustedFunctionArtifactEvidencePort & {
  readRecord(scope: FunctionArtifactScope): Promise<TrustedReleaseRecord | null>;
} {
  const readRecord = async (scope: FunctionArtifactScope): Promise<TrustedReleaseRecord | null> => {
    const value = await source?.read(scope);
    return value == null ? null : parseRecord(value, scope);
  };
  return Object.freeze({
    readRecord,
    read: async (scope: FunctionArtifactScope) => (await readRecord(scope))?.attestation ?? null,
  });
}
