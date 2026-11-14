import { describe, expect, it } from 'vitest';
import { resolveRuntimeReleaseProfile } from '../../src/runtime-release-profile.js';

describe('closed server release targets', () => {
  it('binds the merchant-batch target to the unchanged cart-line v3 Function source', () => {
    const profile = resolveRuntimeReleaseProfile('native-merchant-batch-a03b41ba');
    expect(profile.activeVersionRef).toBe('1211378860033');
    expect(profile.functionsSourceCommit).toBe('aa3b6166eb2b4679f27e1b7f128d914137ba8412');
    expect(Object.isFrozen(profile)).toBe(true);
    expect(resolveRuntimeReleaseProfile('native-a11y-quantity-9b5dbdee').activeVersionRef).toBe('1207622696961');
  });
  it('binds the a11y-quantity target to the unchanged cart-line v3 Function source', () => {
    const profile = resolveRuntimeReleaseProfile('native-a11y-quantity-9b5dbdee');
    expect(profile.activeVersionRef).toBe('1207622696961');
    expect(profile.functionsSourceCommit).toBe('aa3b6166eb2b4679f27e1b7f128d914137ba8412');
    expect(Object.isFrozen(profile)).toBe(true);
    expect(resolveRuntimeReleaseProfile('native-session-drafts-c78a8179').activeVersionRef).toBe('1206211837953');
  });
  it('binds the session-drafts target to the unchanged cart-line v3 Function source', () => {
    const profile = resolveRuntimeReleaseProfile('native-session-drafts-c78a8179');
    expect(profile.activeVersionRef).toBe('1206211837953');
    expect(profile.functionsSourceCommit).toBe('aa3b6166eb2b4679f27e1b7f128d914137ba8412');
    expect(Object.isFrozen(profile)).toBe(true);
    expect(resolveRuntimeReleaseProfile('native-repair-messages-bf512171').activeVersionRef).toBe('1205994881025');
  });
  it('binds the repair-messages target to the unchanged cart-line v3 Function source', () => {
    const profile = resolveRuntimeReleaseProfile('native-repair-messages-bf512171');
    expect(profile.activeVersionRef).toBe('1205994881025');
    expect(profile.functionsSourceCommit).toBe('aa3b6166eb2b4679f27e1b7f128d914137ba8412');
    expect(Object.isFrozen(profile)).toBe(true);
    expect(resolveRuntimeReleaseProfile('native-buyer-fixes-fb436e16').activeVersionRef).toBe('1205760688129');
  });
  it('binds the buyer-fixes target to the unchanged cart-line v3 Function source', () => {
    const profile = resolveRuntimeReleaseProfile('native-buyer-fixes-fb436e16');
    expect(profile.activeVersionRef).toBe('1205760688129');
    expect(profile.functionsSourceCommit).toBe('aa3b6166eb2b4679f27e1b7f128d914137ba8412');
    expect(Object.isFrozen(profile)).toBe(true);
    expect(resolveRuntimeReleaseProfile('native-canonical-host-aa3b6166').activeVersionRef).toBe('1203782746113');
  });
  it('binds the canonical-host target to the unchanged cart-line v3 Function source', () => {
    const profile = resolveRuntimeReleaseProfile('native-canonical-host-aa3b6166');
    expect(profile.activeVersionRef).toBe('1203782746113');
    expect(profile.functionsSourceCommit).toBe('aa3b6166eb2b4679f27e1b7f128d914137ba8412');
    expect(Object.isFrozen(profile)).toBe(true);
    expect(resolveRuntimeReleaseProfile('native-cart-line-v3-aa3b6166').activeVersionRef).toBe('1202999689217');
  });
  it('binds the cart-line v3 target to its v3 Function source without changing the functions renew profile', () => {
    const profile = resolveRuntimeReleaseProfile('native-cart-line-v3-aa3b6166');
    expect(profile.activeVersionRef).toBe('1202999689217');
    expect(profile.functionsSourceCommit).toBe('aa3b6166eb2b4679f27e1b7f128d914137ba8412');
    expect(Object.isFrozen(profile)).toBe(true);
    const prior = resolveRuntimeReleaseProfile('native-functions-renew-8fffc9de');
    expect(prior.activeVersionRef).toBe('1202733449217');
    expect(prior.functionsSourceCommit).toBe('8fffc9debc2bad4914aaa22dca82d8fdf272de5d');
  });
  it('binds the functions renew target to its renewed Function source without changing earlier profiles', () => {
    const profile = resolveRuntimeReleaseProfile('native-functions-renew-8fffc9de');
    expect(profile.activeVersionRef).toBe('1202733449217');
    expect(profile.functionsSourceCommit).toBe('8fffc9debc2bad4914aaa22dca82d8fdf272de5d');
    expect(Object.isFrozen(profile)).toBe(true);
    const prior = resolveRuntimeReleaseProfile('native-cart-repair-eb386d22');
    expect(prior.activeVersionRef).toBe('1202503778305');
    expect(prior.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
  });
  it('binds the cart repair target without changing the canonical or Function authority', () => {
    const profile = resolveRuntimeReleaseProfile('native-cart-repair-eb386d22');
    expect(profile.activeVersionRef).toBe('1202503778305');
    expect(profile.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
    expect(Object.isFrozen(profile)).toBe(true);
    expect(resolveRuntimeReleaseProfile('native-canonical-313b12ad').activeVersionRef).toBe('1201385144321');
  });
  it('binds the canonical combined target without changing historical or Function authority', () => {
    const profile = resolveRuntimeReleaseProfile('native-canonical-313b12ad');
    expect(profile.activeVersionRef).toBe('1201385144321');
    expect(profile.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
    expect(Object.isFrozen(profile)).toBe(true);
    expect(resolveRuntimeReleaseProfile('native-review-nav-8a7ee446').activeVersionRef).toBe('1201192632321');
  });
  it('binds the inactive Review navigation candidate while preserving the loading target', () => {
    const profile = resolveRuntimeReleaseProfile('native-review-nav-8a7ee446');
    expect(profile.activeVersionRef).toBe('1201192632321');
    expect(profile.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
    expect(Object.isFrozen(profile)).toBe(true);
    expect(resolveRuntimeReleaseProfile('native-loading-defd05b0').activeVersionRef).toBe('1201128341505');
  });
  it('binds the inactive loading/handoff candidate without changing prior or Function targets', () => {
    const profile = resolveRuntimeReleaseProfile('native-loading-defd05b0');
    expect(profile.activeVersionRef).toBe('1201128341505');
    expect(profile.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
    expect(Object.isFrozen(profile)).toBe(true);
    expect(resolveRuntimeReleaseProfile('native-review-cart-1f4595f').activeVersionRef).toBe('1200729554945');
  });
  it('binds the inactive Review/cart candidate without changing prior or Function targets', () => {
    const profile = resolveRuntimeReleaseProfile('native-review-cart-1f4595f');
    expect(profile.activeVersionRef).toBe('1200729554945');
    expect(profile.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
    expect(Object.isFrozen(profile)).toBe(true);
    expect(resolveRuntimeReleaseProfile('native-startup-771bb8f').activeVersionRef).toBe('1200333160449');
  });
  it('binds the inactive startup candidate while preserving Function and historical authority', () => {
    const profile = resolveRuntimeReleaseProfile('native-startup-771bb8f');
    expect(profile.activeVersionRef).toBe('1200333160449');
    expect(profile.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
    expect(Object.isFrozen(profile)).toBe(true);
    expect(resolveRuntimeReleaseProfile('native-recovery-e2c3dc5').activeVersionRef).toBe('1199953805313');
  });
  it('selects the observed inactive recovery target while retaining original Function authority', () => {
    const profile = resolveRuntimeReleaseProfile('native-recovery-e2c3dc5');
    expect(profile.activeVersionRef).toBe('1199953805313');
    expect(profile.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
    expect(Object.isFrozen(profile)).toBe(true);
  });
  it('selects the speed candidate while preserving the active performance target', () => {
    const selected = resolveRuntimeReleaseProfile('native-speed-e52be93');
    expect(selected.activeVersionRef).toBe('1199807692801');
    expect(selected.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
    expect(Object.isFrozen(selected)).toBe(true);
    expect(resolveRuntimeReleaseProfile('native-performance-b2729a6').activeVersionRef).toBe('1199754706945');
  });
  it('selects the performance candidate while preserving the prior deployment target', () => {
    const selected = resolveRuntimeReleaseProfile('native-performance-b2729a6');
    expect(selected.activeVersionRef).toBe('1199754706945');
    expect(selected.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
    expect(Object.isFrozen(selected)).toBe(true);
    expect(resolveRuntimeReleaseProfile('native-parity-466a687').activeVersionRef).toBe('1199503441921');
  });
  it('selects the parity candidate while preserving historical targets', () => {
    const selected = resolveRuntimeReleaseProfile('native-parity-466a687');
    expect(selected.activeVersionRef).toBe('1199503441921');
    expect(selected.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
    expect(Object.isFrozen(selected)).toBe(true);
    expect(resolveRuntimeReleaseProfile('native-behavior-6b6c15e').activeVersionRef).toBe('1199244476417');
  });
  it('selects the behavior candidate while preserving all historical targets', () => {
    const selected = resolveRuntimeReleaseProfile('native-behavior-6b6c15e');
    expect(selected.activeVersionRef).toBe('1199244476417');
    expect(selected.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
    expect(Object.isFrozen(selected)).toBe(true);
    expect(resolveRuntimeReleaseProfile('native-selected-fixed-81830c6').activeVersionRef).toBe('1199166783489');
  });
  it('binds only the corrected cleanup version and preserves previous targets', () => {
    const selected = resolveRuntimeReleaseProfile('native-selected-fixed-81830c6');
    expect(selected.activeVersionRef).toBe('1199166783489');
    expect(selected.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
    expect(Object.isFrozen(selected)).toBe(true);
    expect(() => resolveRuntimeReleaseProfile('native-selected-81830c6')).toThrow();
    expect(resolveRuntimeReleaseProfile('native-cart-fd9cc61').activeVersionRef).toBe('1199122513921');
  });
  it('binds the inactive native cart candidate to its exact version and original Function source', () => {
    const selected = resolveRuntimeReleaseProfile('native-cart-fd9cc61');
    expect(selected.activeVersionRef).toBe('1199122513921');
    expect(selected.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
    expect(Object.isFrozen(selected)).toBe(true);
    expect(resolveRuntimeReleaseProfile('native-fixed-5c04fa8').activeVersionRef).toBe('1198986199041');
  });
  it('selects the corrected inactive native candidate without changing Function authority', () => {
    const selected = resolveRuntimeReleaseProfile('native-fixed-5c04fa8');
    expect(selected.activeVersionRef).toBe('1198986199041');
    expect(selected.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
    expect(Object.isFrozen(selected)).toBe(true);
  });
  it('selects the observed inactive native theme candidate without changing Function authority', () => {
    const selected = resolveRuntimeReleaseProfile('native-theme-ced0143');
    expect(selected.activeVersionRef).toBe('1198938357761');
    expect(selected.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
    expect(Object.isFrozen(selected)).toBe(true);
  });
  it('selects the refresh theme candidate without changing Function authority', () => {
    const selected = resolveRuntimeReleaseProfile('selected-ui-aab4a4b');
    expect(selected.activeVersionRef).toBe('1197668466689');
    expect(selected.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
    expect(Object.isFrozen(selected)).toBe(true);
  });
  it('selects the observed selected UI candidate while preserving the original Function authority', () => {
    const selected = resolveRuntimeReleaseProfile('selected-ui-f48efa2');
    expect(selected.activeVersionRef).toBe('1196974997505');
    expect(selected.functionsSourceCommit).toBe('9b94149272d1b62c34f44dda3bde209e80b4ae22');
    expect(Object.isFrozen(selected)).toBe(true);
  });
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
