/** Closed reviewed profiles. Selection changes expected observations, never grants
 * access or attests that the candidate is Active. No caller supplied baseline. */
import assert from 'node:assert/strict';
import behaviorModules from '../../deployment/m5-runtime/native-behavior-module-baseline.json' with { type: 'json' };
import behaviorCandidate from '../../deployment/m5-runtime/native-behavior-release-binding.json' with { type: 'json' };
import buyerFixesModules from '../../deployment/m5-runtime/native-buyer-fixes-module-baseline.json' with {
  type: 'json',
};
import buyerFixesBinding from '../../deployment/m5-runtime/native-buyer-fixes-release-binding.json' with {
  type: 'json',
};
import canonicalHostModules from '../../deployment/m5-runtime/native-canonical-host-module-baseline.json' with {
  type: 'json',
};
import canonicalHostBinding from '../../deployment/m5-runtime/native-canonical-host-release-binding.json' with {
  type: 'json',
};
import canonicalModules from '../../deployment/m5-runtime/native-canonical-module-baseline.json' with { type: 'json' };
import canonicalBinding from '../../deployment/m5-runtime/native-canonical-release-binding.json' with { type: 'json' };
import cartLineV3Modules from '../../deployment/m5-runtime/native-cart-line-v3-module-baseline.json' with {
  type: 'json',
};
import cartLineV3Binding from '../../deployment/m5-runtime/native-cart-line-v3-release-binding.json' with {
  type: 'json',
};
import cartModules from '../../deployment/m5-runtime/native-cart-module-baseline.json' with { type: 'json' };
import cartCandidate from '../../deployment/m5-runtime/native-cart-release-binding.json' with { type: 'json' };
import cartRepairModules from '../../deployment/m5-runtime/native-cart-repair-module-baseline.json' with {
  type: 'json',
};
import cartRepairBinding from '../../deployment/m5-runtime/native-cart-repair-release-binding.json' with {
  type: 'json',
};
import fixedModules from '../../deployment/m5-runtime/native-fixed-module-baseline.json' with { type: 'json' };
import fixedCandidate from '../../deployment/m5-runtime/native-fixed-release-binding.json' with { type: 'json' };
import historicalModules from '../../deployment/m5-runtime/native-function-module-baseline.json' with { type: 'json' };
import functionsRenewModules from '../../deployment/m5-runtime/native-functions-renew-module-baseline.json' with {
  type: 'json',
};
import functionsRenewBinding from '../../deployment/m5-runtime/native-functions-renew-release-binding.json' with {
  type: 'json',
};
import loadingModules from '../../deployment/m5-runtime/native-loading-module-baseline.json' with { type: 'json' };
import loadingCandidate from '../../deployment/m5-runtime/native-loading-release-binding.json' with { type: 'json' };
import parityModules from '../../deployment/m5-runtime/native-parity-module-baseline.json' with { type: 'json' };
import parityCandidate from '../../deployment/m5-runtime/native-parity-release-binding.json' with { type: 'json' };
import performanceModules from '../../deployment/m5-runtime/native-performance-module-baseline.json' with {
  type: 'json',
};
import performanceCandidate from '../../deployment/m5-runtime/native-performance-release-binding.json' with {
  type: 'json',
};
import recoveryModules from '../../deployment/m5-runtime/native-recovery-module-baseline.json' with { type: 'json' };
import recoveryCandidate from '../../deployment/m5-runtime/native-recovery-release-binding.json' with { type: 'json' };
import repairMessagesModules from '../../deployment/m5-runtime/native-repair-messages-module-baseline.json' with {
  type: 'json',
};
import repairMessagesBinding from '../../deployment/m5-runtime/native-repair-messages-release-binding.json' with {
  type: 'json',
};
import reviewCartModules from '../../deployment/m5-runtime/native-review-cart-module-baseline.json' with {
  type: 'json',
};
import reviewCartCandidate from '../../deployment/m5-runtime/native-review-cart-release-binding.json' with {
  type: 'json',
};
import reviewNavModules from '../../deployment/m5-runtime/native-review-nav-module-baseline.json' with { type: 'json' };
import reviewNavBinding from '../../deployment/m5-runtime/native-review-nav-release-binding.json' with { type: 'json' };
import selectedOnlyModules from '../../deployment/m5-runtime/native-selected-fixed-module-baseline.json' with {
  type: 'json',
};
import selectedOnlyCandidate from '../../deployment/m5-runtime/native-selected-fixed-release-binding.json' with {
  type: 'json',
};
import speedModules from '../../deployment/m5-runtime/native-speed-module-baseline.json' with { type: 'json' };
import speedCandidate from '../../deployment/m5-runtime/native-speed-release-binding.json' with { type: 'json' };
import startupModules from '../../deployment/m5-runtime/native-startup-module-baseline.json' with { type: 'json' };
import startupCandidate from '../../deployment/m5-runtime/native-startup-release-binding.json' with { type: 'json' };
import nativeThemeModules from '../../deployment/m5-runtime/native-theme-module-baseline.json' with { type: 'json' };
import nativeThemeCandidate from '../../deployment/m5-runtime/native-theme-release-binding.json' with { type: 'json' };
import refreshModules from '../../deployment/m5-runtime/selected-refresh-module-baseline.json' with { type: 'json' };
import refreshCandidate from '../../deployment/m5-runtime/selected-refresh-release-binding.json' with { type: 'json' };
import selectedModules from '../../deployment/m5-runtime/selected-ui-module-baseline.json' with { type: 'json' };
import selectedCandidate from '../../deployment/m5-runtime/selected-ui-release-binding.json' with { type: 'json' };
import proxyModules from '../../deployment/m8-journey/app-proxy-module-baseline.json' with { type: 'json' };
import proxyCandidate from '../../deployment/m8-journey/app-proxy-release-binding.json' with { type: 'json' };
import cookieThemeModules from '../../deployment/m8-journey/cookie-theme-module-baseline.json' with { type: 'json' };
import cookieThemeCandidate from '../../deployment/m8-journey/cookie-theme-release-binding.json' with { type: 'json' };
import leanMarketsModules from '../../deployment/m8-journey/lean-markets-module-baseline.json' with { type: 'json' };
import leanMarketsCandidate from '../../deployment/m8-journey/lean-markets-release-binding.json' with { type: 'json' };
import privacyModules from '../../deployment/m8-journey/lean-privacy-module-baseline.json' with { type: 'json' };
import privacyCandidate from '../../deployment/m8-journey/lean-privacy-release-binding.json' with { type: 'json' };
import previewThemeModules from '../../deployment/m8-journey/preview-theme-module-baseline.json' with { type: 'json' };
import previewThemeCandidate from '../../deployment/m8-journey/preview-theme-release-binding.json' with {
  type: 'json',
};
import candidate from '../../deployment/m8-journey/release-binding.json' with { type: 'json' };
import candidateModules from '../../deployment/m8-journey/release-module-baseline.json' with { type: 'json' };
import themeModules from '../../deployment/m8-journey/theme-module-baseline.json' with { type: 'json' };
import themeCandidate from '../../deployment/m8-journey/theme-release-binding.json' with { type: 'json' };

const grants = [
  'write_products',
  'read_products',
  'read_publications',
  'read_product_listings',
  'read_cart_transforms',
  'read_validations',
  'write_cart_transforms',
  'write_validations',
];
/** Function artifacts each profile's Active version runs. Profiles before the
 * functions-renew transition preserve the original 9b94149 build. */
const originalFunctions = {
  sourceCommit: '9b94149272d1b62c34f44dda3bde209e80b4ae22',
  transform: {
    inputQuerySha256: '8d93a08697dd56e4aa3f857c3509e4d828a5f4195cb2e8cd878749c3e5729053',
    wasmSha256: '49248769ae4ce578af7c5e7fa77f8c230c8fd4f45b2d673c22cfed87ff946576',
  },
  validation: {
    inputQuerySha256: 'a0cd5d7262514c134efc8e9ce964b25b877ce56fc10d0cba6bdd1af82f2dc8c5',
    wasmSha256: '3193f60bbb29cdc473ce7ae73e88d1064ca7be2f03da2aade4e17ae1390366c6',
  },
};
/** Built from merge 8fffc9de (Function sources identical to PR293 merge c19069bc)
 * with scripts/functions/build-wasm.mts; owner authorized the byte change. */
const renewedFunctions = {
  sourceCommit: '8fffc9debc2bad4914aaa22dca82d8fdf272de5d',
  transform: {
    inputQuerySha256: '8d93a08697dd56e4aa3f857c3509e4d828a5f4195cb2e8cd878749c3e5729053',
    wasmSha256: 'f5979b61ba46c9ca315324500b1bedf806949ebf8fb8979494e0bdaf68e392f6',
  },
  validation: {
    inputQuerySha256: '5baff05ac4b1967bc7c9b461b7d6a8956344ddd8c9233708534e8814b34ebcc4',
    wasmSha256: '4a3e7495245e8716b976ff3c3816c4e144114883edd317afc38fdf84b369f9ec',
  },
};
/** Built from merge aa3b6166 (cart-line v3 Functions and input queries) with
 * scripts/functions/build-wasm.mts; CI foundation 42932707400 built identical bytes.
 * Owner authorized the byte/behavior change and the single v3 cutover. */
const cartLineV3Functions = {
  sourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
  transform: {
    inputQuerySha256: '02ab5bcee805fba94dff9309a2e55cb1998651ca42fdba8564872ba891fd16ac',
    wasmSha256: '5c8708b578383d54f78b79534a3141515296f7b3864bce9852af0c678dbed677',
  },
  validation: {
    inputQuerySha256: '5867e61f07dbb4d6417df401b5ffbc47f0175eca1d00f7792621150713b18d7e',
    wasmSha256: '6c362b36a5cf3eba77dcf9accc64bf0ae3225d77c97dd01bcc9d3e0e1ea83de4',
  },
};
const oldIds = [
  '1163229200385',
  '1162611916801',
  '1158986629121',
  '1158837927937',
  '1153019904001',
  '1152880803841',
  '1146748534785',
] as const;

const profiles = {
  // Same Functions as cart-line v3 and every non-theme module of buyer-fixes; only theme assets change.
  'native-repair-messages-bf512171': {
    versionId: repairMessagesBinding.versionId,
    versionTag: repairMessagesBinding.versionTag,
    versionIds: repairMessagesBinding.versionIds,
    moduleHash: repairMessagesBinding.moduleHash,
    modules: repairMessagesModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: cartLineV3Functions,
  },
  // Same Functions as cart-line v3 and every non-theme module of canonical-host; only theme assets change.
  'native-buyer-fixes-fb436e16': {
    versionId: buyerFixesBinding.versionId,
    versionTag: buyerFixesBinding.versionTag,
    versionIds: buyerFixesBinding.versionIds,
    moduleHash: buyerFixesBinding.moduleHash,
    modules: buyerFixesModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: cartLineV3Functions,
  },
  // Same Functions and theme as cart-line v3; only app URLs move to app.insigniacustomizer.com.
  'native-canonical-host-aa3b6166': {
    versionId: canonicalHostBinding.versionId,
    versionTag: canonicalHostBinding.versionTag,
    versionIds: canonicalHostBinding.versionIds,
    moduleHash: canonicalHostBinding.moduleHash,
    modules: canonicalHostModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: cartLineV3Functions,
  },
  'native-cart-line-v3-aa3b6166': {
    versionId: cartLineV3Binding.versionId,
    versionTag: cartLineV3Binding.versionTag,
    versionIds: cartLineV3Binding.versionIds,
    moduleHash: cartLineV3Binding.moduleHash,
    modules: cartLineV3Modules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: cartLineV3Functions,
  },
  'native-functions-renew-8fffc9de': {
    versionId: functionsRenewBinding.versionId,
    versionTag: functionsRenewBinding.versionTag,
    versionIds: functionsRenewBinding.versionIds,
    moduleHash: functionsRenewBinding.moduleHash,
    modules: functionsRenewModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: renewedFunctions,
  },
  'native-cart-repair-eb386d22': {
    versionId: cartRepairBinding.versionId,
    versionTag: cartRepairBinding.versionTag,
    versionIds: cartRepairBinding.versionIds,
    moduleHash: cartRepairBinding.moduleHash,
    modules: cartRepairModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: originalFunctions,
  },
  'native-canonical-313b12ad': {
    versionId: canonicalBinding.versionId,
    versionTag: canonicalBinding.versionTag,
    versionIds: canonicalBinding.versionIds,
    moduleHash: canonicalBinding.moduleHash,
    modules: canonicalModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: originalFunctions,
  },
  'native-review-nav-8a7ee446': {
    versionId: reviewNavBinding.versionId,
    versionTag: reviewNavBinding.versionTag,
    versionIds: reviewNavBinding.versionIds,
    moduleHash: reviewNavBinding.moduleHash,
    modules: reviewNavModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: originalFunctions,
  },
  'native-loading-defd05b0': {
    versionId: loadingCandidate.versionId,
    versionTag: loadingCandidate.versionTag,
    versionIds: loadingCandidate.versionIds,
    moduleHash: loadingCandidate.moduleHash,
    modules: loadingModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: originalFunctions,
  },
  'native-review-cart-1f4595f': {
    versionId: reviewCartCandidate.versionId,
    versionTag: reviewCartCandidate.versionTag,
    versionIds: reviewCartCandidate.versionIds,
    moduleHash: reviewCartCandidate.moduleHash,
    modules: reviewCartModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: originalFunctions,
  },
  'native-startup-771bb8f': {
    versionId: startupCandidate.versionId,
    versionTag: startupCandidate.versionTag,
    versionIds: startupCandidate.versionIds,
    moduleHash: startupCandidate.moduleHash,
    modules: startupModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: originalFunctions,
  },
  'native-recovery-e2c3dc5': {
    versionId: recoveryCandidate.versionId,
    versionTag: recoveryCandidate.versionTag,
    versionIds: recoveryCandidate.versionIds,
    moduleHash: recoveryCandidate.moduleHash,
    modules: recoveryModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: originalFunctions,
  },
  'native-speed-e52be93': {
    versionId: speedCandidate.versionId,
    versionTag: speedCandidate.versionTag,
    versionIds: speedCandidate.versionIds,
    moduleHash: speedCandidate.moduleHash,
    modules: speedModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: originalFunctions,
  },
  'native-performance-b2729a6': {
    versionId: performanceCandidate.versionId,
    versionTag: performanceCandidate.versionTag,
    versionIds: performanceCandidate.versionIds,
    moduleHash: performanceCandidate.moduleHash,
    modules: performanceModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: originalFunctions,
  },
  'native-parity-466a687': {
    versionId: parityCandidate.versionId,
    versionTag: parityCandidate.versionTag,
    versionIds: parityCandidate.versionIds,
    moduleHash: parityCandidate.moduleHash,
    modules: parityModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: originalFunctions,
  },
  'native-behavior-6b6c15e': {
    versionId: behaviorCandidate.versionId,
    versionTag: behaviorCandidate.versionTag,
    versionIds: behaviorCandidate.versionIds,
    moduleHash: behaviorCandidate.moduleHash,
    modules: behaviorModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: originalFunctions,
  },
  'native-selected-fixed-81830c6': {
    versionId: selectedOnlyCandidate.versionId,
    versionTag: selectedOnlyCandidate.versionTag,
    versionIds: selectedOnlyCandidate.versionIds,
    moduleHash: selectedOnlyCandidate.moduleHash,
    modules: selectedOnlyModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: originalFunctions,
  },
  'native-cart-fd9cc61': {
    versionId: cartCandidate.versionId,
    versionTag: cartCandidate.versionTag,
    versionIds: cartCandidate.versionIds,
    moduleHash: cartCandidate.moduleHash,
    modules: cartModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: originalFunctions,
  },
  'native-fixed-5c04fa8': {
    versionId: fixedCandidate.versionId,
    versionTag: fixedCandidate.versionTag,
    versionIds: fixedCandidate.versionIds,
    moduleHash: fixedCandidate.moduleHash,
    modules: fixedModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: originalFunctions,
  },
  'native-theme-ced0143': {
    versionId: nativeThemeCandidate.versionId,
    versionTag: nativeThemeCandidate.versionTag,
    versionIds: nativeThemeCandidate.versionIds,
    moduleHash: nativeThemeCandidate.moduleHash,
    modules: nativeThemeModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: originalFunctions,
  },
  'selected-ui-aab4a4b': {
    versionId: refreshCandidate.versionId,
    versionTag: refreshCandidate.versionTag,
    versionIds: refreshCandidate.versionIds,
    moduleHash: refreshCandidate.moduleHash,
    modules: refreshModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: originalFunctions,
  },
  'selected-ui-f48efa2': {
    versionId: selectedCandidate.versionId,
    versionTag: selectedCandidate.versionTag,
    versionIds: selectedCandidate.versionIds,
    moduleHash: selectedCandidate.moduleHash,
    modules: selectedModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: originalFunctions,
  },
  'lean-privacy-theme-23fd116': {
    versionId: privacyCandidate.versionId,
    versionTag: privacyCandidate.versionTag,
    versionIds: privacyCandidate.versionIds,
    moduleHash: privacyCandidate.moduleHash,
    modules: privacyModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: originalFunctions,
  },
  'lean-markets-7b17cd9': {
    versionId: leanMarketsCandidate.versionId,
    versionTag: leanMarketsCandidate.versionTag,
    versionIds: leanMarketsCandidate.versionIds,
    moduleHash: leanMarketsCandidate.moduleHash,
    modules: leanMarketsModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy', 'read_markets'],
    functions: originalFunctions,
  },
  'm5-functions-9c2e56b42fbf': {
    versionId: oldIds[0],
    versionTag: 'm5-functions-9c2e56b42fbf',
    versionIds: oldIds,
    moduleHash: 'b04436bda3faad667ee70d00991572ae60949f5acd2cf0fef6b6075dac8f66d7',
    modules: historicalModules,
    grants,
    functions: originalFunctions,
  },
  'm8-read-orders-617057f': {
    versionId: candidate.versionId,
    versionTag: candidate.versionTag,
    versionIds: candidate.versionIds,
    moduleHash: candidate.moduleHash,
    modules: candidateModules,
    grants: [...grants, 'read_orders'],
    functions: originalFunctions,
  },
  'm8-preview-28443bd': {
    versionId: previewThemeCandidate.versionId,
    versionTag: previewThemeCandidate.versionTag,
    versionIds: previewThemeCandidate.versionIds,
    moduleHash: previewThemeCandidate.moduleHash,
    modules: previewThemeModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy'],
    functions: originalFunctions,
  },
  'm8-cookie-91b35ab': {
    versionId: cookieThemeCandidate.versionId,
    versionTag: cookieThemeCandidate.versionTag,
    versionIds: cookieThemeCandidate.versionIds,
    moduleHash: cookieThemeCandidate.moduleHash,
    modules: cookieThemeModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy'],
    functions: originalFunctions,
  },
  'm8-theme-c8d8713': {
    versionId: themeCandidate.versionId,
    versionTag: themeCandidate.versionTag,
    versionIds: themeCandidate.versionIds,
    moduleHash: themeCandidate.moduleHash,
    modules: themeModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy'],
    functions: originalFunctions,
  },
  'm8-app-proxy-3d2a02e': {
    versionId: proxyCandidate.versionId,
    versionTag: proxyCandidate.versionTag,
    versionIds: proxyCandidate.versionIds,
    moduleHash: proxyCandidate.moduleHash,
    modules: proxyModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy'],
    functions: originalFunctions,
  },
};
function required<T>(value: T | undefined): T {
  assert(value !== undefined);
  return value;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
freeze(profiles);
function isProfileName(value: unknown): value is keyof typeof profiles {
  return typeof value === 'string' && Object.hasOwn(profiles, value);
}
export function releaseProfile(name: unknown = 'm5-functions-9c2e56b42fbf') {
  assert.ok(isProfileName(name), 'reviewed_release_profile_required');
  return required(profiles[name]);
}
