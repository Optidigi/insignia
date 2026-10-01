import { describe, expect, it } from 'vitest';
import { createTrustedReleaseEvidencePort } from './trusted-release.js';

const scope = { shopId: 'shop-test', installationGeneration: '1', appClientId: 'test-client' };
const identity = (kind: 'transform' | 'validation') => ({
  functionId: `gid://shopify/ShopifyFunction/${kind === 'transform' ? '1' : '2'}`,
  handle: `test-${kind}`,
  apiType: kind === 'transform' ? 'cart_transform' : 'cart_checkout_validation',
  apiVersion: '2026-07',
  inputQuerySha256: 'a'.repeat(64),
  wasmSha256: 'b'.repeat(64),
});
const attestation = () => ({
  ...scope,
  schemaVersion: 1,
  sourceCommit: 'c'.repeat(40),
  appVersionRef: 'gid://shopify/AppVersion/123',
  devPreviewRef: null,
  transform: identity('transform'),
  validation: identity('validation'),
  evidenceKind: 'RELEASE_BOUND',
  observedAt: '2026-10-01T00:00:00Z',
  expiresAt: '2026-10-01T01:00:00Z',
});
const record = () => ({
  version: 'm5-trusted-release-v1',
  recordId: 'release-123',
  activeAppVersionRef: 'gid://shopify/AppVersion/123',
  attestation: attestation(),
});
describe('server trusted release source', () => {
  it('has no environment or source-only fallback without a trusted source', async () => {
    expect(await createTrustedReleaseEvidencePort().read(scope)).toBeNull();
  });
  it('requires an active release version and exact current installation scope', async () => {
    const port = createTrustedReleaseEvidencePort({ read: async () => record() });
    expect(await port.read(scope)).toMatchObject(attestation());
    expect(await port.readRecord(scope)).toMatchObject({ recordId: 'release-123' });
    await expect(port.read({ ...scope, installationGeneration: '2' })).rejects.toThrow();
  });
  it('rejects dev/unreleased, changed version, malformed and unsigned-env extra fields', async () => {
    for (const changed of [
      { ...record(), activeAppVersionRef: null },
      { ...record(), activeAppVersionRef: 'unreleased' },
      {
        ...record(),
        attestation: {
          ...attestation(),
          evidenceKind: 'DEV_PREVIEW_OBSERVED',
          appVersionRef: null,
          devPreviewRef: 'dev',
        },
      },
      { ...record(), attestation: { ...attestation(), evidenceKind: 'SOURCE_ONLY', appVersionRef: null } },
      { ...record(), environmentAuthority: true },
    ])
      await expect(createTrustedReleaseEvidencePort({ read: async () => changed }).read(scope)).rejects.toThrow();
  });
});
