import { describe, expect, it } from 'vitest';
import { buildProductPolicyProjection } from './projection.js';

describe('v2 product policy projection', () => {
  it('derives the exact Function values from installation UUID, sequence and locked mode', () => {
    expect(
      buildProductPolicyProjection({
        authorizationGeneration: '11111111-1111-4111-8111-111111111111',
        publicationSequence: '7',
        mode: 'required',
      }),
    ).toEqual({
      registrationPending: '11111111111141118111111111111111:7:pending',
      registrationReady: '11111111111141118111111111111111:7:ready',
      policy: '11111111111141118111111111111111:7:required',
    });
  });

  it('rejects zero, overflow and caller-shaped strings', () => {
    const scope = { authorizationGeneration: '11111111-1111-4111-8111-111111111111', mode: 'optional' as const };
    expect(() => buildProductPolicyProjection({ ...scope, publicationSequence: '0' })).toThrow();
    expect(() => buildProductPolicyProjection({ ...scope, publicationSequence: '4294967296' })).toThrow();
    expect(() => buildProductPolicyProjection({ ...scope, publicationSequence: '07' })).toThrow();
    expect(() => buildProductPolicyProjection({ ...scope, publicationSequence: '7:ready' })).toThrow();
  });
});
