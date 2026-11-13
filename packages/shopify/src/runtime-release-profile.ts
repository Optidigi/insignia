/** Deployment selects a closed reviewed target, never release authority.
 * Every consumer still independently reads and qualifies trusted release evidence. */
export type RuntimeReleaseProfileName =
  | 'native-session-drafts-c78a8179'
  | 'native-repair-messages-bf512171'
  | 'native-buyer-fixes-fb436e16'
  | 'native-canonical-host-aa3b6166'
  | 'native-cart-line-v3-aa3b6166'
  | 'native-functions-renew-8fffc9de'
  | 'native-cart-repair-eb386d22'
  | 'native-canonical-313b12ad'
  | 'native-review-nav-8a7ee446'
  | 'native-loading-defd05b0'
  | 'native-review-cart-1f4595f'
  | 'native-startup-771bb8f'
  | 'native-recovery-e2c3dc5'
  | 'native-speed-e52be93'
  | 'native-performance-b2729a6'
  | 'native-parity-466a687'
  | 'native-behavior-6b6c15e'
  | 'native-selected-fixed-81830c6'
  | 'native-cart-fd9cc61'
  | 'native-fixed-5c04fa8'
  | 'native-theme-ced0143'
  | 'selected-ui-aab4a4b'
  | 'selected-ui-f48efa2'
  | 'm5-functions-9c2e56b42fbf'
  | 'm8-read-orders-617057f'
  | 'm8-app-proxy-3d2a02e'
  | 'm8-theme-c8d8713'
  | 'm8-cookie-91b35ab'
  | 'm8-preview-28443bd'
  | 'lean-markets-7b17cd9'
  | 'lean-privacy-theme-23fd116';
const profiles = Object.freeze({
  'native-session-drafts-c78a8179': Object.freeze({
    name: 'native-session-drafts-c78a8179' as const,
    activeVersionRef: '1206211837953',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
  'native-repair-messages-bf512171': Object.freeze({
    name: 'native-repair-messages-bf512171' as const,
    activeVersionRef: '1205994881025',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
  'native-buyer-fixes-fb436e16': Object.freeze({
    name: 'native-buyer-fixes-fb436e16' as const,
    activeVersionRef: '1205760688129',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
  'native-canonical-host-aa3b6166': Object.freeze({
    name: 'native-canonical-host-aa3b6166' as const,
    activeVersionRef: '1203782746113',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
  'native-cart-line-v3-aa3b6166': Object.freeze({
    name: 'native-cart-line-v3-aa3b6166' as const,
    activeVersionRef: '1202999689217',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
  'native-functions-renew-8fffc9de': Object.freeze({
    name: 'native-functions-renew-8fffc9de' as const,
    activeVersionRef: '1202733449217',
    functionsSourceCommit: '8fffc9debc2bad4914aaa22dca82d8fdf272de5d',
  }),
  'native-cart-repair-eb386d22': Object.freeze({
    name: 'native-cart-repair-eb386d22' as const,
    activeVersionRef: '1202503778305',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
  'native-canonical-313b12ad': Object.freeze({
    name: 'native-canonical-313b12ad' as const,
    activeVersionRef: '1201385144321',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
  'native-review-nav-8a7ee446': Object.freeze({
    name: 'native-review-nav-8a7ee446' as const,
    activeVersionRef: '1201192632321',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
  'native-loading-defd05b0': Object.freeze({
    name: 'native-loading-defd05b0' as const,
    activeVersionRef: '1201128341505',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
  'native-review-cart-1f4595f': Object.freeze({
    name: 'native-review-cart-1f4595f' as const,
    activeVersionRef: '1200729554945',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
  'native-startup-771bb8f': Object.freeze({
    name: 'native-startup-771bb8f' as const,
    activeVersionRef: '1200333160449',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
  'native-recovery-e2c3dc5': Object.freeze({
    name: 'native-recovery-e2c3dc5' as const,
    activeVersionRef: '1199953805313',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
  'native-speed-e52be93': Object.freeze({
    name: 'native-speed-e52be93' as const,
    activeVersionRef: '1199807692801',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
  'native-performance-b2729a6': Object.freeze({
    name: 'native-performance-b2729a6' as const,
    activeVersionRef: '1199754706945',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
  'native-parity-466a687': Object.freeze({
    name: 'native-parity-466a687' as const,
    activeVersionRef: '1199503441921',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
  'native-behavior-6b6c15e': Object.freeze({
    name: 'native-behavior-6b6c15e' as const,
    activeVersionRef: '1199244476417',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
  'native-selected-fixed-81830c6': Object.freeze({
    name: 'native-selected-fixed-81830c6' as const,
    activeVersionRef: '1199166783489',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
  'native-cart-fd9cc61': Object.freeze({
    name: 'native-cart-fd9cc61' as const,
    activeVersionRef: '1199122513921',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
  'native-fixed-5c04fa8': Object.freeze({
    name: 'native-fixed-5c04fa8' as const,
    activeVersionRef: '1198986199041',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
  'native-theme-ced0143': Object.freeze({
    name: 'native-theme-ced0143' as const,
    activeVersionRef: '1198938357761',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
  'selected-ui-aab4a4b': Object.freeze({
    name: 'selected-ui-aab4a4b' as const,
    activeVersionRef: '1197668466689',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
  'selected-ui-f48efa2': Object.freeze({
    name: 'selected-ui-f48efa2' as const,
    activeVersionRef: '1196974997505',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
  'lean-privacy-theme-23fd116': Object.freeze({
    name: 'lean-privacy-theme-23fd116' as const,
    activeVersionRef: '1171218169857',
    functionsSourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  }),
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
