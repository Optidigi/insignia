export type ProductPolicyMode = 'required' | 'optional';

/** The two Function-visible Product anchors share the same immutable revision identity. */
export function buildProductPolicyProjection(input: {
  authorizationGeneration: string;
  publicationSequence: string;
  mode: ProductPolicyMode;
}): { registrationPending: string; registrationReady: string; policy: string } {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.authorizationGeneration))
    throw new Error('invalid publication authorization generation');
  if (!/^[1-9][0-9]*$/.test(input.publicationSequence) || BigInt(input.publicationSequence) > 0xffff_ffffn)
    throw new Error('publication sequence exceeds Function u32 revision');
  if (input.mode !== 'required' && input.mode !== 'optional') throw new Error('invalid product policy mode');
  const base = `${input.authorizationGeneration.replaceAll('-', '')}:${input.publicationSequence}:`;
  return {
    registrationPending: `${base}pending`,
    registrationReady: `${base}ready`,
    policy: `${base}${input.mode}`,
  };
}
