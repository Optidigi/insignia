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
export type FunctionTargetModule = Readonly<{ moduleId: string; target: string; export: string }>;
type BuildIdentity = FunctionArtifactScope &
  Readonly<{
    sourceCommit: string;
    appVersionRef: string | null;
    devPreviewRef: string | null;
    transform: FunctionArtifactIdentity;
    validation: FunctionArtifactIdentity;
  }>;
/** Independent reviewed build identity, never reconstructed from Admin observations. */
export type ExpectedFunctionBuild = BuildIdentity &
  (
    | Readonly<{ schemaVersion: 1 }>
    | Readonly<{
        schemaVersion: 2;
        targetModules: Readonly<{ transform: FunctionTargetModule; validation: FunctionTargetModule }>;
      }>
  );
/** V2 requires independently authenticated Active target configuration. No Admin Wasm claim. */
export type FunctionArtifactAttestation = (
  | (BuildIdentity &
      Readonly<{ schemaVersion: 1 }> &
      (
        | Readonly<{ evidenceKind: 'SOURCE_ONLY'; appVersionRef: null; devPreviewRef: null }>
        | Readonly<{ evidenceKind: 'DEV_PREVIEW_OBSERVED'; appVersionRef: null; devPreviewRef: string }>
        | Readonly<{ evidenceKind: 'RELEASE_BOUND'; appVersionRef: string; devPreviewRef: null }>
      ))
  | (Extract<ExpectedFunctionBuild, { schemaVersion: 2 }> &
      Readonly<{
        evidenceKind: 'RELEASE_BOUND';
        appVersionRef: string;
        devPreviewRef: null;
        targetObservedAt: string;
      }>)
) &
  Readonly<{ observedAt: string; expiresAt: string }>;
export type FunctionObjectIdentity = Readonly<Omit<FunctionArtifactIdentity, 'wasmSha256'>>;
type ObjectScope = FunctionArtifactScope & Readonly<{ observedAt: string }>;
/** V1 retains its exact shape and query requirement. V2 records unavailable legacy query honestly. */
export type FunctionObjectObservation = ObjectScope &
  (
    | Readonly<{ transform: FunctionObjectIdentity | null; validation: FunctionObjectIdentity | null }>
    | Readonly<{
        schemaVersion: 2;
        transform: (Omit<FunctionObjectIdentity, 'inputQuerySha256'> & { inputQuerySha256: string | null }) | null;
        validation: (Omit<FunctionObjectIdentity, 'inputQuerySha256'> & { inputQuerySha256: string | null }) | null;
      }>
  );
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
function invalid(): never {
  throw new Error('Function artifact evidence invalid or mismatched');
}
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
function parseObjectIdentity(
  value: unknown,
  kind: 'transform' | 'validation',
  wasm: false,
  nullable: true,
): Omit<FunctionObjectIdentity, 'inputQuerySha256'> & { inputQuerySha256: string | null };
function parseObjectIdentity(
  value: unknown,
  kind: 'transform' | 'validation',
  wasm: boolean,
  nullable = false,
): Omit<FunctionObjectIdentity, 'inputQuerySha256'> & { inputQuerySha256: string | null } {
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
    inputQuerySha256: nullable && item.inputQuerySha256 === null ? null : digest(item.inputQuerySha256),
    ...(wasm ? { wasmSha256: digest(item.wasmSha256) } : {}),
  });
}
function parseBuild(value: Record<string, unknown>): ExpectedFunctionBuild {
  if (
    (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
    typeof value.sourceCommit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(value.sourceCommit)
  )
    return invalid();
  const appVersionRef = value.appVersionRef === null ? null : identifier(value.appVersionRef);
  const devPreviewRef = value.devPreviewRef === null ? null : identifier(value.devPreviewRef);
  if (appVersionRef !== null && devPreviewRef !== null) return invalid();
  const transform = parseObjectIdentity(value.transform, 'transform', true);
  const validation = parseObjectIdentity(value.validation, 'validation', true);
  if (transform.functionId === validation.functionId || transform.handle === validation.handle) return invalid();
  return Object.freeze({
    ...parseScope(value),
    schemaVersion: value.schemaVersion,
    ...(value.schemaVersion === 2 ? { targetModules: parseTargetModules(value.targetModules) } : {}),
    sourceCommit: value.sourceCommit,
    appVersionRef,
    devPreviewRef,
    transform,
    validation,
  }) as ExpectedFunctionBuild;
}

function parseTargetModules(value: unknown): Extract<ExpectedFunctionBuild, { schemaVersion: 2 }>['targetModules'] {
  const pair = exactRecord(value, ['transform', 'validation']);
  const parse = (kind: 'transform' | 'validation'): FunctionTargetModule => {
    const item = exactRecord(pair[kind], ['moduleId', 'target', 'export']);
    const target = kind === 'transform' ? 'cart.transform.run' : 'cart.validations.generate.run';
    const entry = kind === 'transform' ? 'cart_transform_run' : 'cart_validations_generate_run';
    if (item.target !== target || item.export !== entry) return invalid();
    return Object.freeze({ moduleId: identifier(item.moduleId), target, export: entry });
  };
  const result = { transform: parse('transform'), validation: parse('validation') };
  if (result.transform.moduleId === result.validation.moduleId) return invalid();
  return Object.freeze(result);
}
function version(value: unknown): 1 | 2 {
  return value !== null &&
    typeof value === 'object' &&
    Object.getOwnPropertyDescriptor(value, 'schemaVersion')?.value === 2
    ? 2
    : 1;
}
function fields(value: unknown): readonly string[] {
  return version(value) === 2 ? [...buildFields, 'targetModules'] : buildFields;
}

export function parseExpectedFunctionBuild(value: unknown): ExpectedFunctionBuild {
  return parseBuild(exactRecord(value, fields(value)));
}

/** Strict, secret-free, immutable snapshot. Parsing does not establish trusted deployment provenance. */
export function parseFunctionArtifactAttestation(value: unknown): FunctionArtifactAttestation {
  const item = exactRecord(value, [
    ...fields(value),
    'evidenceKind',
    'observedAt',
    'expiresAt',
    ...(version(value) === 2 ? ['targetObservedAt'] : []),
  ]);
  const build = parseBuild(item);
  const kind = item.evidenceKind;
  if (
    !(
      (kind === 'SOURCE_ONLY' && build.appVersionRef === null && build.devPreviewRef === null) ||
      (kind === 'DEV_PREVIEW_OBSERVED' && build.appVersionRef === null && build.devPreviewRef !== null) ||
      (kind === 'RELEASE_BOUND' && build.appVersionRef !== null && build.devPreviewRef === null)
    ) ||
    instant(item.expiresAt) <= instant(item.observedAt) ||
    (build.schemaVersion === 2 &&
      (kind !== 'RELEASE_BOUND' || instant(item.targetObservedAt) >= instant(item.expiresAt)))
  )
    return invalid();
  return Object.freeze({
    ...build,
    evidenceKind: kind,
    ...(build.schemaVersion === 2 ? { targetObservedAt: item.targetObservedAt } : {}),
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
  const modern = expected.schemaVersion === 2;
  const observation = exactRecord(input.observation, [
    ...(modern ? ['schemaVersion'] : []),
    'shopId',
    'installationGeneration',
    'appClientId',
    'observedAt',
    'transform',
    'validation',
  ]);
  if (modern && observation.schemaVersion !== 2) invalid();
  const scope = parseScope(exactRecord(input.scope, ['shopId', 'installationGeneration', 'appClientId']));
  const now = input.now instanceof Date ? input.now.getTime() : Number.NaN;
  if (!Number.isFinite(now) || !Number.isFinite(input.maxObservationAgeMs) || input.maxObservationAgeMs < 0) invalid();
  for (const observedAt of [
    attestation.observedAt,
    observation.observedAt,
    ...(attestation.schemaVersion === 2 ? [attestation.targetObservedAt] : []),
  ]) {
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
  if (modern) {
    if (attestation.schemaVersion !== 2 || kind !== 'RELEASE_BOUND') invalid();
    for (const surface of ['transform', 'validation'] as const) {
      for (const field of ['moduleId', 'target', 'export'] as const) {
        if (attestation.targetModules[surface][field] !== expected.targetModules[surface][field]) invalid();
      }
    }
  }
  for (const surface of ['transform', 'validation'] as const) {
    const current = modern
      ? parseObjectIdentity(observation[surface], surface, false, true)
      : parseObjectIdentity(observation[surface], surface, false);
    for (const field of identityFields) {
      if (
        (!(modern && field === 'inputQuerySha256' && current[field] === null) &&
          current[field] !== expected[surface][field]) ||
        attestation[surface][field] !== expected[surface][field]
      )
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
