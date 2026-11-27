/** Deployment selects a closed reviewed target, never release authority.
 * Every consumer still independently reads and qualifies trusted release evidence. */
export type RuntimeReleaseProfileName =
  | 'native-qa-guidance-81434785'
  | 'native-pre-review-performance-e73f2a69'
  | 'native-review-readiness-849a38e1'
  | 'native-dependency-refresh-4991bcf9'
  | 'native-designer-intent-8e69c5ef'
  | 'native-escape-once-bcb6cd16'
  | 'native-cart-repair-2ed66ade'
  | 'native-sticky-keyboard-1127c3e2'
  | 'native-market-dialog-fdd262ea'
  | 'native-network-access-f57facc8'
  | 'native-review-market-6967baed'
  | 'native-scope60-9b677033'
  | 'native-noallorders-fc8f9e08'
  | 'native-batch-9b677033'
  | 'native-names-b8616d2a'
  | 'native-reinstall-eb2ce476'
  | 'native-cartfix-3075eac9'
  | 'native-uifix-565679f7'
  | 'native-allorders-c0bb261a'
  | 'native-scopes-e896db0a'
  | 'native-designer-d2002a28'
  | 'native-merchant-batch-a03b41ba'
  | 'native-a11y-quantity-9b5dbdee'
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
  'native-qa-guidance-81434785': Object.freeze({
    name: 'native-qa-guidance-81434785' as const,
    activeVersionRef: '1269561884673',
    functionsSourceCommit: '4991bcf9043764aabf28b0c040d5b71609c7a8c0',
  }),
  'native-pre-review-performance-e73f2a69': Object.freeze({
    name: 'native-pre-review-performance-e73f2a69' as const,
    activeVersionRef: '1269249933313',
    functionsSourceCommit: '4991bcf9043764aabf28b0c040d5b71609c7a8c0',
  }),
  'native-review-readiness-849a38e1': Object.freeze({
    name: 'native-review-readiness-849a38e1' as const,
    activeVersionRef: '1268027162625',
    functionsSourceCommit: '4991bcf9043764aabf28b0c040d5b71609c7a8c0',
  }),
  'native-dependency-refresh-4991bcf9': Object.freeze({
    name: 'native-dependency-refresh-4991bcf9' as const,
    activeVersionRef: '1267604848641',
    functionsSourceCommit: '4991bcf9043764aabf28b0c040d5b71609c7a8c0',
  }),
  'native-designer-intent-8e69c5ef': Object.freeze({
    name: 'native-designer-intent-8e69c5ef' as const,
    activeVersionRef: '1266368151553',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
  'native-escape-once-bcb6cd16': Object.freeze({
    name: 'native-escape-once-bcb6cd16' as const,
    activeVersionRef: '1265289363457',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
  'native-cart-repair-2ed66ade': Object.freeze({
    name: 'native-cart-repair-2ed66ade' as const,
    activeVersionRef: '1265206460417',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
  'native-sticky-keyboard-1127c3e2': Object.freeze({
    name: 'native-sticky-keyboard-1127c3e2' as const,
    activeVersionRef: '1264667197441',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
  'native-market-dialog-fdd262ea': Object.freeze({
    name: 'native-market-dialog-fdd262ea' as const,
    activeVersionRef: '1264361504769',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
  'native-network-access-f57facc8': Object.freeze({
    name: 'native-network-access-f57facc8' as const,
    activeVersionRef: '1263405170689',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
  'native-review-market-6967baed': Object.freeze({
    name: 'native-review-market-6967baed' as const,
    activeVersionRef: '1263125463041',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
  'native-scope60-9b677033': Object.freeze({
    name: 'native-scope60-9b677033' as const,
    activeVersionRef: '1257303638017',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
  'native-noallorders-fc8f9e08': Object.freeze({
    name: 'native-noallorders-fc8f9e08' as const,
    activeVersionRef: '1248762724353',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
  'native-batch-9b677033': Object.freeze({
    name: 'native-batch-9b677033' as const,
    activeVersionRef: '1234668191745',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
  'native-names-b8616d2a': Object.freeze({
    name: 'native-names-b8616d2a' as const,
    activeVersionRef: '1234277105665',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
  'native-reinstall-eb2ce476': Object.freeze({
    name: 'native-reinstall-eb2ce476' as const,
    activeVersionRef: '1232902225921',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
  'native-cartfix-3075eac9': Object.freeze({
    name: 'native-cartfix-3075eac9' as const,
    activeVersionRef: '1227332452353',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
  'native-uifix-565679f7': Object.freeze({
    name: 'native-uifix-565679f7' as const,
    activeVersionRef: '1226879205377',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
  'native-allorders-c0bb261a': Object.freeze({
    name: 'native-allorders-c0bb261a' as const,
    activeVersionRef: '1225110192129',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
  'native-scopes-e896db0a': Object.freeze({
    name: 'native-scopes-e896db0a' as const,
    activeVersionRef: '1222703742977',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
  'native-designer-d2002a28': Object.freeze({
    name: 'native-designer-d2002a28' as const,
    activeVersionRef: '1222232834049',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
  'native-merchant-batch-a03b41ba': Object.freeze({
    name: 'native-merchant-batch-a03b41ba' as const,
    activeVersionRef: '1211378860033',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
  'native-a11y-quantity-9b5dbdee': Object.freeze({
    name: 'native-a11y-quantity-9b5dbdee' as const,
    activeVersionRef: '1207622696961',
    functionsSourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  }),
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
