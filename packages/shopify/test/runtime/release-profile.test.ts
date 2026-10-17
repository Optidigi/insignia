import { describe, expect, it } from 'vitest';
import { resolveRuntimeReleaseProfile } from '../../src/runtime-release-profile.js';

describe('closed server release targets', () => {
  it('preserves the historical default and selects only the reviewed M8 target', () => {
    expect(resolveRuntimeReleaseProfile().activeVersionRef).toBe('1163229200385');
    expect(resolveRuntimeReleaseProfile('m8-read-orders-617057f').activeVersionRef).toBe('1165513097217');
    expect(Object.isFrozen(resolveRuntimeReleaseProfile('m8-read-orders-617057f'))).toBe(true);
  });
  it('selects the reviewed app-proxy target without changing Function source authority', () => {
    const selected = resolveRuntimeReleaseProfile('m8-app-proxy-3d2a02e');
    expect(selected.activeVersionRef).toBe('1166090010625');
    expect(selected.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
    expect(Object.isFrozen(selected)).toBe(true);
  });
  it('selects the observed theme candidate without granting release authority or changing Function source', () => {
    const selected = resolveRuntimeReleaseProfile('m8-theme-c8d8713');
    expect(selected.activeVersionRef).toBe('1166552825857');
    expect(selected.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
    expect(Object.isFrozen(selected)).toBe(true);
  });
  it('selects the observed cookie correction while preserving Function authority', () => {
    const selected = resolveRuntimeReleaseProfile('m8-cookie-91b35ab');
    expect(selected.activeVersionRef).toBe('1166710865921');
    expect(selected.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
    expect(Object.isFrozen(selected)).toBe(true);
  });
  it('selects the independently observed preview correction and preserves Function authority', () => {
    const selected = resolveRuntimeReleaseProfile('m8-preview-28443bd');
    expect(selected.activeVersionRef).toBe('1168157736961');
    expect(selected.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
    expect(Object.isFrozen(selected)).toBe(true);
  });
  it('selects the observed inactive Lean Markets target without granting Active authority', () => {
    const selected = resolveRuntimeReleaseProfile('lean-markets-7b17cd9');
    expect(selected.activeVersionRef).toBe('1169137696769');
    expect(selected.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
    expect(Object.isFrozen(selected)).toBe(true);
  });
  it('selects the independently read inactive privacy/theme version without changing Function authority', () => {
    const selected = resolveRuntimeReleaseProfile('lean-privacy-theme-23fd116');
    expect(selected.activeVersionRef).toBe('1171218169857');
    expect(selected.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
    expect(Object.isFrozen(selected)).toBe(true);
  });
  it('rejects arbitrary versions, JSON, inherited names and missing explicit values', () => {
    for (const value of ['1166090010625', '1165513097217', '{"version":"1165513097217"}', 'toString', '', null, {}])
      expect(() => resolveRuntimeReleaseProfile(value)).toThrow('Reviewed runtime release profile required');
  });
});
