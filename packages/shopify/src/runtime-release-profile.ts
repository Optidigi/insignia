/** Deployment selects a closed reviewed target, never release authority.
 * Every consumer still independently reads and qualifies trusted release evidence. */
export type RuntimeReleaseProfileName =
  | 'm5-functions-9c2e56b42fbf'
  | 'm8-read-orders-617057f'
  | 'm8-app-proxy-3d2a02e'
  | 'm8-theme-c8d8713'
  | 'm8-cookie-91b35ab'
  | 'm8-preview-28443bd'
  | 'lean-markets-7b17cd9';
const profiles = Object.freeze({
  'lean-markets-7b17cd9': Object.freeze({
    name: 'lean-markets-7b17cd9' as const,
    activeVersionRef: '1169137696769',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
  'm5-functions-9c2e56b42fbf': Object.freeze({
    name: 'm5-functions-9c2e56b42fbf' as const,
    activeVersionRef: '1163229200385',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
  'm8-read-orders-617057f': Object.freeze({
    name: 'm8-read-orders-617057f' as const,
    activeVersionRef: '1165513097217',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
  'm8-preview-28443bd': Object.freeze({
    name: 'm8-preview-28443bd' as const,
    activeVersionRef: '1168157736961',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
  'm8-cookie-91b35ab': Object.freeze({
    name: 'm8-cookie-91b35ab' as const,
    activeVersionRef: '1166710865921',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
  'm8-theme-c8d8713': Object.freeze({
    name: 'm8-theme-c8d8713' as const,
    activeVersionRef: '1166552825857',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
  'm8-app-proxy-3d2a02e': Object.freeze({
    name: 'm8-app-proxy-3d2a02e' as const,
    activeVersionRef: '1166090010625',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
});
export function resolveRuntimeReleaseProfile(name: unknown = 'm5-functions-9c2e56b42fbf') {
  if (typeof name !== 'string' || !Object.hasOwn(profiles, name))
    throw new Error('Reviewed runtime release profile required');
  return profiles[name as RuntimeReleaseProfileName];
}
