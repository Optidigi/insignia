/** Deployment selects a closed reviewed target, never release authority.
 * Every consumer still independently reads and qualifies trusted release evidence. */
export type RuntimeReleaseProfileName = 'm5-functions-9c2e56b42fbf' | 'm8-read-orders-617057f' | 'm8-app-proxy-3d2a02e';
const profiles = Object.freeze({
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
