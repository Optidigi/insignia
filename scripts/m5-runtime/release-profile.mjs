/** Closed reviewed profiles. Selection changes expected observations, never grants
 * access or attests that the candidate is Active. No caller supplied baseline. */
import assert from 'node:assert/strict';
import historicalModules from '../../deployment/m5-runtime/native-function-module-baseline.json' with { type: 'json' };
import themeModules from '../../deployment/m8-journey/theme-module-baseline.json' with { type: 'json' };
import themeCandidate from '../../deployment/m8-journey/theme-release-binding.json' with { type: 'json' };
import proxyModules from '../../deployment/m8-journey/app-proxy-module-baseline.json' with { type: 'json' };
import proxyCandidate from '../../deployment/m8-journey/app-proxy-release-binding.json' with { type: 'json' };
import candidate from '../../deployment/m8-journey/release-binding.json' with { type: 'json' };
import candidateModules from '../../deployment/m8-journey/release-module-baseline.json' with { type: 'json' };

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
const oldIds = [
  '1163229200385',
  '1162611916801',
  '1158986629121',
  '1158837927937',
  '1153019904001',
  '1152880803841',
  '1146748534785',
];
const profiles = {
  'm5-functions-9c2e56b42fbf': {
    versionId: oldIds[0],
    versionTag: 'm5-functions-9c2e56b42fbf',
    versionIds: oldIds,
    moduleHash: 'b04436bda3faad667ee70d00991572ae60949f5acd2cf0fef6b6075dac8f66d7',
    modules: historicalModules,
    grants,
  },
  'm8-read-orders-617057f': {
    versionId: candidate.versionId,
    versionTag: candidate.versionTag,
    versionIds: candidate.versionIds,
    moduleHash: candidate.moduleHash,
    modules: candidateModules,
    grants: [...grants, 'read_orders'],
  },
  'm8-theme-c8d8713': {
    versionId: themeCandidate.versionId,
    versionTag: themeCandidate.versionTag,
    versionIds: themeCandidate.versionIds,
    moduleHash: themeCandidate.moduleHash,
    modules: themeModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy'],
  },
  'm8-app-proxy-3d2a02e': {
    versionId: proxyCandidate.versionId,
    versionTag: proxyCandidate.versionTag,
    versionIds: proxyCandidate.versionIds,
    moduleHash: proxyCandidate.moduleHash,
    modules: proxyModules,
    grants: [...grants, 'read_orders', 'read_app_proxy', 'write_app_proxy'],
  },
};
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
freeze(profiles);
export function releaseProfile(name = 'm5-functions-9c2e56b42fbf') {
  assert.ok(typeof name === 'string' && Object.hasOwn(profiles, name), 'reviewed_release_profile_required');
  return profiles[name];
}
