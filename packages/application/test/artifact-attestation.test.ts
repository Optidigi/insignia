import { createHash, generateKeyPairSync } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import { createProductionQuoteReadiness } from '../../../apps/web/src/server/production-readiness.js';
import {
  assertDevelopmentFunctionArtifactReady,
  assertProductionFunctionArtifactReady,
  parseFunctionArtifactAttestation,
} from '../src/keys/artifact-attestation.js';
import { publicKeyFingerprint } from '../src/keys/crypto.js';
import { buildPublicConfig } from '../src/keys/public-config.js';
import { assertQuoteIssuanceReady } from '../src/keys/readiness.js';

type ProductionReadinessInput = Parameters<typeof createProductionQuoteReadiness>[0];
type PublicationAdminRequest = Parameters<ProductionReadinessInput['transport']['execute']>[0];
type AcceptedQuote = Parameters<ReturnType<typeof createProductionQuoteReadiness>['assertReady']>[0]['quote'];

const scope = {
  shopId: 'shop-a',
  installationGeneration: '7',
  authorizationGeneration: '11111111-1111-4111-8111-111111111111',
  authorizationEpoch: 0,
};
const publicKey = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const desired = buildPublicConfig({
  scope,
  keys: [{ id: 7, publicKey, state: 'active', firstDay: 100, lastDay: 104 }],
});

const productionComposition = () => {
  const value = release();
  const queries = { transform: 'query Transform { shop { id } }', validation: 'query Validation { shop { id } }' };
  for (const surface of ['transform', 'validation'] as const) {
    const digest = createHash('sha256').update(queries[surface]).digest('hex');
    value.expectedBuild[surface].inputQuerySha256 = digest;
    value.attestation[surface].inputQuerySha256 = digest;
  }
  const shopId = 'gid://shopify/Shop/101';
  const execute = vi.fn(async (request: PublicationAdminRequest) => {
    if (request.operation === 'read_shop')
      return {
        status: 200,
        body: {
          data: {
            shop: {
              id: shopId,
              field: {
                owner: { id: shopId },
                namespace: 'app--12345',
                key: 'insignia_public_config_v2',
                type: 'json',
                value: desired.value,
                compareDigest: 'a'.repeat(64),
              },
            },
          },
        },
      };
    if (request.operation !== 'function_ownership') throw new Error('Mutation forbidden in readiness');
    return {
      status: 200,
      body: {
        data: {
          shop: { id: shopId },
          shopifyFunctions: {
            pageInfo: { hasNextPage: false },
            nodes: (['transform', 'validation'] as const).map((surface) => ({
              id: value.expectedBuild[surface].functionId,
              handle: value.expectedBuild[surface].handle,
              apiType: value.expectedBuild[surface].apiType,
              apiVersion: '2026-07',
              appKey: 'client-a',
              inputQuery: queries[surface],
            })),
          },
          cartTransforms: {
            pageInfo: { hasNextPage: false },
            nodes: [{ functionId: 'function-transform', blockOnFailure: true }],
          },
          validations: {
            pageInfo: { hasNextPage: false },
            nodes: [
              {
                enabled: true,
                blockOnFailure: true,
                shopifyFunction: {
                  id: 'function-validation',
                  handle: 'insignia-experimental-v2-validation',
                  appKey: 'client-a',
                },
              },
            ],
          },
        },
      },
    };
  });
  const revision = {
    productId: 'gid://shopify/Product/202',
    configId: 'config-a',
    operationId: 'operation-a',
    revisionId: 'revision-a',
    contentHash: 'c'.repeat(64),
  };
  const core = {
    tenants: { getActiveAuthorizationScope: async () => ({ ...scope, shopifyShopId: '101' }) },
    signingKeys: {
      getActiveScope: async () => scope,
      list: async () => [
        {
          ...scope,
          id: 7,
          keyId: 7,
          publicKey,
          publicKeyFingerprint: publicKeyFingerprint(publicKey),
          state: 'active',
          firstDay: 100,
          lastDay: 104,
        },
      ],
    },
    acceptedQuotes: {
      getEffective: async () => ({
        configId: 'config-a',
        operationId: 'operation-a',
        config: { revisionId: 'revision-a', revisionContentHash: 'c'.repeat(64) },
      }),
    },
  } as unknown as ProductionReadinessInput['core'];
  const input = {
    core,
    ring: { currentKeyId: 'unused', keys: {} },
    selectedKeyId: 7,
    appId: '12345',
    expectedFunctions: {
      appKey: 'client-a',
      transformInputQuerySha256: value.expectedBuild.transform.inputQuerySha256,
      validationInputQuerySha256: value.expectedBuild.validation.inputQuerySha256,
    },
    transport: { execute },
    maxObservationAgeMs: 30_000,
    clock: () => value.now,
    artifactPorts: {
      expectedBuild: { read: vi.fn(async () => value.expectedBuild) },
      trustedEvidence: { read: vi.fn(async (): Promise<unknown> => value.attestation) },
    },
  };
  const quote = { ...scope, acceptedDay: 102, effectiveRevisions: [revision] } as unknown as AcceptedQuote;
  return { input, quote, value, execute };
};

describe('production composition artifact boundary', () => {
  test('default composition fails closed without trusted evidence/build ports', async () => {
    const { input, quote, execute } = productionComposition();
    await expect(
      createProductionQuoteReadiness({ ...input, artifactPorts: undefined }).assertReady({ quote }),
    ).rejects.toThrow('ports missing');
    expect(execute).not.toHaveBeenCalled();
  });
  test('consumes separate scoped build/evidence ports and current read-only owned observations', async () => {
    const { input, quote } = productionComposition();
    await expect(createProductionQuoteReadiness(input).assertReady({ quote })).resolves.toBeUndefined();
    const expectedScope = { shopId: 'shop-a', installationGeneration: '7', appClientId: 'client-a' };
    expect(input.artifactPorts.expectedBuild.read).toHaveBeenCalledWith(expectedScope);
    expect(input.artifactPorts.trustedEvidence.read).toHaveBeenCalledWith(expectedScope);
  });
  test.each(['SOURCE_ONLY', 'DEV_PREVIEW_OBSERVED'])(
    'rejects %s injected evidence in production',
    async (evidenceKind) => {
      const { input, quote, value } = productionComposition();
      input.artifactPorts.trustedEvidence.read.mockResolvedValue({
        ...value.attestation,
        evidenceKind,
        appVersionRef: null,
        devPreviewRef: evidenceKind === 'DEV_PREVIEW_OBSERVED' ? 'preview-a' : null,
      });
      await expect(createProductionQuoteReadiness(input).assertReady({ quote })).rejects.toThrow('RELEASE_BOUND');
    },
  );
  test('an independent expected build mismatch rejects even coherent supplied artifact evidence', async () => {
    const { input, quote, value } = productionComposition();
    value.expectedBuild.sourceCommit = 'f'.repeat(40);
    await expect(createProductionQuoteReadiness(input).assertReady({ quote })).rejects.toThrow('Function artifact');
  });
  test('missing trusted evidence and unavailable expected build reject', async () => {
    const first = productionComposition();
    first.input.artifactPorts.trustedEvidence.read.mockResolvedValue(null);
    await expect(createProductionQuoteReadiness(first.input).assertReady({ quote: first.quote })).rejects.toThrow(
      'Function artifact',
    );
    const second = productionComposition();
    second.input.artifactPorts.expectedBuild.read.mockRejectedValue(new Error('Build source unavailable'));
    await expect(createProductionQuoteReadiness(second.input).assertReady({ quote: second.quote })).rejects.toThrow(
      'Build source unavailable',
    );
  });
});
const ready = () => ({
  scope,
  selectedKeyId: 7,
  acceptedDay: 102,
  desired,
  observed: { value: desired.value, observedAt: new Date('2026-09-30T10:00:00Z') },
  now: new Date('2026-09-30T10:00:01Z'),
  maxObservationAgeMs: 30_000,
  functions: { transform: 'present' as const, validation: 'present' as const, runtimeIdentity: 'verified' as const },
  effectiveRevision: true,
});

const build = () => ({
  schemaVersion: 1 as const,
  shopId: scope.shopId,
  installationGeneration: scope.installationGeneration,
  appClientId: 'client-a',
  sourceCommit: '28e69864ebb9796504861a541363880cc86a82f8',
  appVersionRef: null,
  devPreviewRef: 'preview-a',
  transform: {
    functionId: 'function-transform',
    handle: 'insignia-experimental-v2-transform',
    apiType: 'cart_transform' as const,
    apiVersion: '2026-07',
    inputQuerySha256: '1'.repeat(64),
    wasmSha256: '2'.repeat(64),
  },
  validation: {
    functionId: 'function-validation',
    handle: 'insignia-experimental-v2-validation',
    apiType: 'cart_checkout_validation' as const,
    apiVersion: '2026-07',
    inputQuerySha256: '3'.repeat(64),
    wasmSha256: '4'.repeat(64),
  },
});
const diagnostic = () => {
  const expectedBuild = build();
  const { wasmSha256: _transformWasm, ...transform } = expectedBuild.transform;
  const { wasmSha256: _validationWasm, ...validation } = expectedBuild.validation;
  return {
    scope: { shopId: scope.shopId, installationGeneration: scope.installationGeneration, appClientId: 'client-a' },
    expectedBuild,
    attestation: {
      ...structuredClone(expectedBuild),
      evidenceKind: 'DEV_PREVIEW_OBSERVED' as const,
      observedAt: '2026-09-30T10:00:00Z',
      expiresAt: '2026-09-30T10:05:00Z',
    },
    observation: {
      shopId: scope.shopId,
      installationGeneration: scope.installationGeneration,
      appClientId: 'client-a',
      observedAt: '2026-09-30T10:00:00Z',
      transform,
      validation,
    },
    now: new Date('2026-09-30T10:00:01Z'),
    maxObservationAgeMs: 30_000,
  };
};
const release = () => {
  const value = diagnostic();
  const expectedBuild = { ...value.expectedBuild, appVersionRef: 'version-a', devPreviewRef: null };
  return {
    ...value,
    expectedBuild,
    attestation: {
      ...value.attestation,
      ...structuredClone(expectedBuild),
      evidenceKind: 'RELEASE_BOUND' as const,
    },
  };
};
const productionReady = () => {
  const value = release();
  return {
    ...ready(),
    functions: {
      transform: 'present' as const,
      validation: 'present' as const,
      runtimeIdentity: 'unverifiable' as const,
      observation: value.observation,
    },
    artifact: { appClientId: 'client-a', expectedBuild: value.expectedBuild, attestation: value.attestation },
  };
};

describe('Function artifact readiness authority', () => {
  test('a caller-set runtime identity flag cannot replace trusted artifact evidence', () => {
    expect(() => assertQuoteIssuanceReady(ready())).toThrow('Function artifact');
  });
  test('matching dev preview enables diagnostics only', () => {
    expect(() => assertDevelopmentFunctionArtifactReady(diagnostic())).not.toThrow();
    expect(() => assertProductionFunctionArtifactReady(diagnostic())).toThrow('RELEASE_BOUND');
  });
  test('independent release-bound evidence and current owned active pair permit production readiness', () => {
    expect(() => assertQuoteIssuanceReady(productionReady())).not.toThrow();
  });
  test('dev-preview evidence cannot authorize quote signing with an active pair and otherwise valid prerequisites', () => {
    const value = productionReady();
    const preview = diagnostic();
    expect(() =>
      assertQuoteIssuanceReady({
        ...value,
        artifact: { appClientId: 'client-a', expectedBuild: preview.expectedBuild, attestation: preview.attestation },
      }),
    ).toThrow('RELEASE_BOUND');
  });
  test('source-only evidence authorizes neither diagnostics nor production', () => {
    const value = diagnostic();
    const attestation = { ...value.attestation, evidenceKind: 'SOURCE_ONLY', appVersionRef: null, devPreviewRef: null };
    expect(() => assertDevelopmentFunctionArtifactReady({ ...value, attestation })).toThrow('DEV_PREVIEW_OBSERVED');
    expect(() => assertProductionFunctionArtifactReady({ ...value, attestation })).toThrow('RELEASE_BOUND');
  });
  test.each([
    ['sourceCommit', 'f'.repeat(40)],
    ['appClientId', 'other-app'],
    ['appVersionRef', 'other-release'],
    ['shopId', 'shop-b'],
    ['installationGeneration', '6'],
    ['observedAt', '2026-09-30T09:00:00Z'],
    ['expiresAt', '2026-09-30T10:00:01Z'],
  ])('production rejects stale or mismatched attested %s', (field, changed) => {
    const value = productionReady();
    Object.assign(value.artifact.attestation, { [field]: changed });
    expect(() => assertQuoteIssuanceReady(value)).toThrow('Function artifact');
  });
  test.each(['transform', 'validation'] as const)(
    'production rejects changed %s artifact or current observation',
    (surface) => {
      for (const [field, changed] of [
        ['functionId', 'other-function'],
        ['handle', 'other-handle'],
        ['apiVersion', '2026-04'],
        ['inputQuerySha256', 'f'.repeat(64)],
        ['wasmSha256', 'f'.repeat(64)],
      ] as const) {
        const value = productionReady();
        Object.assign(value.artifact.attestation[surface], { [field]: changed });
        expect(() => assertQuoteIssuanceReady(value), `attested ${surface} ${field}`).toThrow('Function artifact');
        if (field !== 'wasmSha256') {
          const current = productionReady();
          Object.assign(current.functions.observation[surface], { [field]: changed });
          expect(() => assertQuoteIssuanceReady(current), `observed ${surface} ${field}`).toThrow('Function artifact');
        }
      }
    },
  );
  test('release-bound evidence does not bypass config, key, revision or deployment prerequisites', () => {
    const value = productionReady();
    expect(() => assertQuoteIssuanceReady({ ...value, observed: { ...value.observed, value: '{}' } })).toThrow(
      'Public Function config',
    );
    expect(() => assertQuoteIssuanceReady({ ...value, now: new Date('2026-09-30T10:01:00Z') })).toThrow(
      'Public Function config',
    );
    expect(() => assertQuoteIssuanceReady({ ...value, scope: { ...scope, authorizationEpoch: 1 } })).toThrow(
      'Signing scope',
    );
    expect(() => assertQuoteIssuanceReady({ ...value, selectedKeyId: 8 })).toThrow('Signing key');
    expect(() => assertQuoteIssuanceReady({ ...value, acceptedDay: 103 })).toThrow('Signing key');
    expect(() => assertQuoteIssuanceReady({ ...value, effectiveRevision: false })).toThrow('revision is not active');
    for (const surface of ['transform', 'validation'] as const) {
      for (const status of ['missing', 'duplicate', 'drift', 'unknown'] as const) {
        expect(() =>
          assertQuoteIssuanceReady({ ...value, functions: { ...value.functions, [surface]: status } }),
        ).toThrow('Function pair');
      }
    }
  });
  test('attestation parsing creates a deeply frozen independent snapshot', () => {
    const source = release().attestation;
    const parsed = parseFunctionArtifactAttestation(source);
    source.transform.functionId = 'changed-after-validation';
    expect(parsed.transform.functionId).toBe('function-transform');
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.transform)).toBe(true);
    expect(Object.isFrozen(parsed.validation)).toBe(true);
    expect(() => Object.assign(parsed.validation, { wasmSha256: 'f'.repeat(64) })).toThrow();
  });
  test.each([
    null,
    {},
    [],
    { ...release().attestation, schemaVersion: 2 },
    { ...release().attestation, secret: 'forbidden-extra-field' },
    { ...release().attestation, sourceCommit: 'short-commit' },
    { ...release().attestation, installationGeneration: '07' },
    { ...release().attestation, devPreviewRef: 'preview-a' },
    { ...release().attestation, appVersionRef: null },
    { ...release().attestation, evidenceKind: 'BEHAVIORALLY_VERIFIED' },
    { ...release().attestation, observedAt: '2026-02-30T10:00:00Z' },
    { ...release().attestation, expiresAt: '2026-09-30T10:00:00Z' },
    { ...release().attestation, transform: { ...build().transform, wasmSha256: 'A'.repeat(64) } },
    { ...release().attestation, validation: { ...build().validation, inputQuerySha256: 123 } },
  ])('rejects malformed/version-confused attestation %#', (attestation) => {
    expect(() => parseFunctionArtifactAttestation(attestation)).toThrow('Function artifact');
  });
  test('missing evidence/build/observation and invalid freshness settings fail closed', () => {
    const value = release();
    for (const field of ['attestation', 'expectedBuild', 'observation'] as const) {
      expect(() => assertProductionFunctionArtifactReady({ ...value, [field]: null })).toThrow('Function artifact');
    }
    expect(() => assertProductionFunctionArtifactReady({ ...value, now: new Date('invalid') })).toThrow(
      'Function artifact',
    );
    for (const maxObservationAgeMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => assertProductionFunctionArtifactReady({ ...value, maxObservationAgeMs })).toThrow(
        'Function artifact',
      );
    }
    expect(() =>
      assertProductionFunctionArtifactReady({ ...value, observation: { ...value.observation, transform: null } }),
    ).toThrow('Function artifact');
    expect(() =>
      assertProductionFunctionArtifactReady({
        ...value,
        observation: {
          ...value.observation,
          validation: { ...value.observation.validation, wasmSha256: '4'.repeat(64) },
        },
      }),
    ).toThrow('Function artifact');
  });
  test.each([
    [
      'source commit',
      (value: ReturnType<typeof diagnostic>) => {
        value.attestation.sourceCommit = 'f'.repeat(40);
      },
    ],
    [
      'transform Wasm',
      (value: ReturnType<typeof diagnostic>) => {
        value.attestation.transform.wasmSha256 = 'f'.repeat(64);
      },
    ],
    [
      'validation query',
      (value: ReturnType<typeof diagnostic>) => {
        value.attestation.validation.inputQuerySha256 = 'f'.repeat(64);
      },
    ],
    [
      'Function ID',
      (value: ReturnType<typeof diagnostic>) => {
        value.attestation.transform.functionId = 'other-function';
      },
    ],
    [
      'handle',
      (value: ReturnType<typeof diagnostic>) => {
        value.attestation.validation.handle = 'other-handle';
      },
    ],
    [
      'app client',
      (value: ReturnType<typeof diagnostic>) => {
        value.attestation.appClientId = 'other-app';
      },
    ],
    [
      'API version',
      (value: ReturnType<typeof diagnostic>) => {
        value.attestation.transform.apiVersion = '2026-04';
      },
    ],
    [
      'API type',
      (value: ReturnType<typeof diagnostic>) => {
        Object.assign(value.attestation.validation, { apiType: 'cart_transform' });
      },
    ],
    [
      'preview version',
      (value: ReturnType<typeof diagnostic>) => {
        value.attestation.devPreviewRef = 'other-preview';
      },
    ],
    [
      'tenant',
      (value: ReturnType<typeof diagnostic>) => {
        value.attestation.shopId = 'shop-b';
      },
    ],
    [
      'prior install',
      (value: ReturnType<typeof diagnostic>) => {
        value.attestation.installationGeneration = '6';
      },
    ],
    [
      'stale evidence',
      (value: ReturnType<typeof diagnostic>) => {
        value.attestation.observedAt = '2026-09-30T09:00:00Z';
      },
    ],
    [
      'expired evidence',
      (value: ReturnType<typeof diagnostic>) => {
        value.attestation.expiresAt = '2026-09-30T10:00:01Z';
      },
    ],
    [
      'future evidence',
      (value: ReturnType<typeof diagnostic>) => {
        value.attestation.observedAt = '2026-09-30T10:00:02Z';
      },
    ],
    [
      'current Function ID',
      (value: ReturnType<typeof diagnostic>) => {
        value.observation.transform.functionId = 'other-function';
      },
    ],
    [
      'current query',
      (value: ReturnType<typeof diagnostic>) => {
        value.observation.validation.inputQuerySha256 = 'f'.repeat(64);
      },
    ],
    [
      'current app',
      (value: ReturnType<typeof diagnostic>) => {
        value.observation.appClientId = 'other-app';
      },
    ],
    [
      'current install',
      (value: ReturnType<typeof diagnostic>) => {
        value.observation.installationGeneration = '6';
      },
    ],
    [
      'stale observation',
      (value: ReturnType<typeof diagnostic>) => {
        value.observation.observedAt = '2026-09-30T09:00:00Z';
      },
    ],
    [
      'independent source',
      (value: ReturnType<typeof diagnostic>) => {
        value.expectedBuild.sourceCommit = 'f'.repeat(40);
      },
    ],
    [
      'independent Wasm',
      (value: ReturnType<typeof diagnostic>) => {
        value.expectedBuild.validation.wasmSha256 = 'f'.repeat(64);
      },
    ],
  ])('rejects mismatched %s', (_name, change) => {
    const value = diagnostic();
    change(value);
    expect(() => assertDevelopmentFunctionArtifactReady(value)).toThrow('Function artifact');
  });
});
