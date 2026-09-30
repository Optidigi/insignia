export type FunctionArtifactIdentity = Readonly<{
  functionId: string;
  handle: string;
  apiType: 'cart_transform' | 'cart_checkout_validation';
  apiVersion: string;
  inputQuerySha256: string;
  wasmSha256: string;
}>;
export type FunctionArtifactScope = Readonly<{
  shopId: string;
  installationGeneration: string;
  appClientId: string;
}>;
/** Independently supplied from the expected build, never reconstructed from attestation or Admin data. */
export type ExpectedFunctionBuild = FunctionArtifactScope &
  Readonly<{
    schemaVersion: 1;
    sourceCommit: string;
    appVersionRef: string | null;
    devPreviewRef: string | null;
    transform: FunctionArtifactIdentity;
    validation: FunctionArtifactIdentity;
  }>;
export type FunctionArtifactAttestation = ExpectedFunctionBuild &
  Readonly<{
    observedAt: string;
    expiresAt: string;
  }> &
  (
    | Readonly<{ evidenceKind: 'SOURCE_ONLY'; appVersionRef: null; devPreviewRef: null }>
    | Readonly<{ evidenceKind: 'DEV_PREVIEW_OBSERVED'; appVersionRef: null; devPreviewRef: string }>
    | Readonly<{ evidenceKind: 'RELEASE_BOUND'; appVersionRef: string; devPreviewRef: null }>
  );
export type FunctionObjectIdentity = Readonly<Omit<FunctionArtifactIdentity, 'wasmSha256'>>;
/** Function object observation deliberately contains no deployed Wasm identity. */
export type FunctionObjectObservation = FunctionArtifactScope &
  Readonly<{
    observedAt: string;
    transform: FunctionObjectIdentity | null;
    validation: FunctionObjectIdentity | null;
  }>;
export interface ExpectedFunctionBuildPort {
  read(scope: FunctionArtifactScope): Promise<ExpectedFunctionBuild | null>;
}
/** Trusted server composition only. RELEASE_BOUND must come from a later trusted deployment/app-version port.
 * Runtime parsing establishes shape, not provenance; ShopifyFunction queries cannot implement this port.
 */
export interface TrustedFunctionArtifactEvidencePort {
  read(scope: FunctionArtifactScope): Promise<unknown | null>;
}
export type FunctionArtifactReadinessInput = Readonly<{
  scope: FunctionArtifactScope;
  expectedBuild: unknown;
  attestation: unknown;
  observation: unknown;
  now: Date;
  maxObservationAgeMs: number;
}>;

const buildFields = [
  'schemaVersion',
  'shopId',
  'installationGeneration',
  'appClientId',
  'sourceCommit',
  'appVersionRef',
  'devPreviewRef',
  'transform',
  'validation',
] as const;
const identityFields = ['functionId', 'handle', 'apiType', 'apiVersion', 'inputQuerySha256'] as const;
const invalid = (): never => {
  throw new Error('Function artifact evidence invalid or mismatched');
};
function exactRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  const keys = Reflect.ownKeys(value);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length !== fields.length ||
    !keys.every(
      (key) =>
        typeof key === 'string' &&
        fields.includes(key) &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'),
    )
  )
    return invalid();
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:/._-]{0,255}$/.test(value)) return invalid();
  return value;
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return invalid();
  return value;
}
function instant(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)) return invalid();
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString().replace('.000Z', 'Z') !== value.replace('.000Z', 'Z'))
    return invalid();
  return time;
}
function parseScope(value: Record<string, unknown>): FunctionArtifactScope {
  if (
    typeof value.installationGeneration !== 'string' ||
    !/^[1-9][0-9]{0,19}$/.test(value.installationGeneration) ||
    BigInt(value.installationGeneration) > 0xffffffffffffffffn ||
    typeof value.appClientId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(value.appClientId)
  )
    return invalid();
  return {
    shopId: identifier(value.shopId),
    installationGeneration: value.installationGeneration,
    appClientId: value.appClientId,
  };
}
function parseObjectIdentity(value: unknown, kind: 'transform' | 'validation', wasm: true): FunctionArtifactIdentity;
function parseObjectIdentity(value: unknown, kind: 'transform' | 'validation', wasm: false): FunctionObjectIdentity;
function parseObjectIdentity(value: unknown, kind: 'transform' | 'validation', wasm: boolean): FunctionObjectIdentity {
  const item = exactRecord(value, wasm ? [...identityFields, 'wasmSha256'] : identityFields);
  const apiType = kind === 'transform' ? 'cart_transform' : 'cart_checkout_validation';
  if (
    item.apiType !== apiType ||
    typeof item.apiVersion !== 'string' ||
    !/^20[0-9]{2}-(01|04|07|10)$/.test(item.apiVersion) ||
    typeof item.handle !== 'string' ||
    !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(item.handle)
  )
    return invalid();
  return Object.freeze({
    functionId: identifier(item.functionId),
    handle: item.handle,
    apiType,
    apiVersion: item.apiVersion,
    inputQuerySha256: digest(item.inputQuerySha256),
    ...(wasm ? { wasmSha256: digest(item.wasmSha256) } : {}),
  });
}
function parseBuild(value: Record<string, unknown>): ExpectedFunctionBuild {
  if (value.schemaVersion !== 1 || typeof value.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(value.sourceCommit))
    return invalid();
  const appVersionRef = value.appVersionRef === null ? null : identifier(value.appVersionRef);
  const devPreviewRef = value.devPreviewRef === null ? null : identifier(value.devPreviewRef);
  if (appVersionRef !== null && devPreviewRef !== null) return invalid();
  const transform = parseObjectIdentity(value.transform, 'transform', true);
  const validation = parseObjectIdentity(value.validation, 'validation', true);
  if (transform.functionId === validation.functionId || transform.handle === validation.handle) return invalid();
  return Object.freeze({
    ...parseScope(value),
    schemaVersion: 1,
    sourceCommit: value.sourceCommit,
    appVersionRef,
    devPreviewRef,
    transform,
    validation,
  });
}

export function parseExpectedFunctionBuild(value: unknown): ExpectedFunctionBuild {
  return parseBuild(exactRecord(value, buildFields));
}

/** Strict, secret-free, immutable snapshot. Parsing does not establish trusted deployment provenance. */
export function parseFunctionArtifactAttestation(value: unknown): FunctionArtifactAttestation {
  const item = exactRecord(value, [...buildFields, 'evidenceKind', 'observedAt', 'expiresAt']);
  const build = parseBuild(item);
  const kind = item.evidenceKind;
  if (
    !(
      (kind === 'SOURCE_ONLY' && build.appVersionRef === null && build.devPreviewRef === null) ||
      (kind === 'DEV_PREVIEW_OBSERVED' && build.appVersionRef === null && build.devPreviewRef !== null) ||
      (kind === 'RELEASE_BOUND' && build.appVersionRef !== null && build.devPreviewRef === null)
    ) ||
    instant(item.expiresAt) <= instant(item.observedAt)
  )
    return invalid();
  return Object.freeze({
    ...build,
    evidenceKind: kind,
    observedAt: item.observedAt,
    expiresAt: item.expiresAt,
  }) as FunctionArtifactAttestation;
}

function assertMatchingArtifact(
  input: FunctionArtifactReadinessInput,
  kind: 'DEV_PREVIEW_OBSERVED' | 'RELEASE_BOUND',
): void {
  const attestation = parseFunctionArtifactAttestation(input.attestation);
  if (attestation.evidenceKind !== kind) throw new Error(`Function artifact ${kind} evidence required`);
  const expected = parseExpectedFunctionBuild(input.expectedBuild);
  const observation = exactRecord(input.observation, [
    'shopId',
    'installationGeneration',
    'appClientId',
    'observedAt',
    'transform',
    'validation',
  ]);
  const scope = parseScope(exactRecord(input.scope, ['shopId', 'installationGeneration', 'appClientId']));
  const now = input.now instanceof Date ? input.now.getTime() : Number.NaN;
  if (!Number.isFinite(now) || !Number.isFinite(input.maxObservationAgeMs) || input.maxObservationAgeMs < 0) invalid();
  for (const observedAt of [attestation.observedAt, observation.observedAt]) {
    const time = instant(observedAt);
    if (time > now || now - time > input.maxObservationAgeMs) invalid();
  }
  if (now >= instant(attestation.expiresAt)) invalid();
  const observedScope = parseScope(observation);
  for (const field of ['shopId', 'installationGeneration', 'appClientId'] as const) {
    if (scope[field] !== expected[field] || scope[field] !== observedScope[field]) invalid();
  }
  for (const field of buildFields) {
    if (field !== 'transform' && field !== 'validation' && attestation[field] !== expected[field]) invalid();
  }
  for (const surface of ['transform', 'validation'] as const) {
    const current = parseObjectIdentity(observation[surface], surface, false);
    for (const field of identityFields) {
      if (current[field] !== expected[surface][field] || attestation[surface][field] !== expected[surface][field])
        invalid();
    }
    if (attestation[surface].wasmSha256 !== expected[surface].wasmSha256) invalid();
  }
}

/** Development diagnostics carry no quote-signing or publication-activation authority. */
export function assertDevelopmentFunctionArtifactReady(input: FunctionArtifactReadinessInput): void {
  assertMatchingArtifact(input, 'DEV_PREVIEW_OBSERVED');
}

export function assertProductionFunctionArtifactReady(input: FunctionArtifactReadinessInput): void {
  assertMatchingArtifact(input, 'RELEASE_BOUND');
}
