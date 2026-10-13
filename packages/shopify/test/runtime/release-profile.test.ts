import { describe, expect, it } from 'vitest';
import { resolveRuntimeReleaseProfile } from '../../src/runtime-release-profile.js';

describe('closed server release targets', () => {
  it('preserves the historical default and selects only the reviewed M8 target', () => {
    expect(resolveRuntimeReleaseProfile().activeVersionRef).toBe('1163229200385');
    expect(resolveRuntimeReleaseProfile('m8-read-orders-617057f').activeVersionRef).toBe('1165513097217');
    expect(Object.isFrozen(resolveRuntimeReleaseProfile('m8-read-orders-617057f'))).toBe(true);
  });
  it('rejects arbitrary versions, JSON, inherited names and missing explicit values', () => {
    for (const value of ['1165513097217', '{"version":"1165513097217"}', 'toString', '', null, {}])
      expect(() => resolveRuntimeReleaseProfile(value)).toThrow('Reviewed runtime release profile required');
  });
});
