import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestFn } from 'node:test';
import test from 'node:test';
import { createReleaseVerificationClient } from '../../apps/web/src/server/admin/release-verification.ts';
import behaviorModules from '../../deployment/m5-runtime/native-behavior-module-baseline.json' with { type: 'json' };
import behaviorBinding from '../../deployment/m5-runtime/native-behavior-release-binding.json' with { type: 'json' };
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
import cartBinding from '../../deployment/m5-runtime/native-cart-release-binding.json' with { type: 'json' };
import cartRepairModules from '../../deployment/m5-runtime/native-cart-repair-module-baseline.json' with {
  type: 'json',
};
import cartRepairBinding from '../../deployment/m5-runtime/native-cart-repair-release-binding.json' with {
  type: 'json',
};
import fixedModules from '../../deployment/m5-runtime/native-fixed-module-baseline.json' with { type: 'json' };
import fixedBinding from '../../deployment/m5-runtime/native-fixed-release-binding.json' with { type: 'json' };
import functionsRenewModules from '../../deployment/m5-runtime/native-functions-renew-module-baseline.json' with {
  type: 'json',
};
import functionsRenewBinding from '../../deployment/m5-runtime/native-functions-renew-release-binding.json' with {
  type: 'json',
};
import loadingModules from '../../deployment/m5-runtime/native-loading-module-baseline.json' with { type: 'json' };
import loadingBinding from '../../deployment/m5-runtime/native-loading-release-binding.json' with { type: 'json' };
import parityModules from '../../deployment/m5-runtime/native-parity-module-baseline.json' with { type: 'json' };
import parityBinding from '../../deployment/m5-runtime/native-parity-release-binding.json' with { type: 'json' };
import performanceModules from '../../deployment/m5-runtime/native-performance-module-baseline.json' with {
  type: 'json',
};
import performanceBinding from '../../deployment/m5-runtime/native-performance-release-binding.json' with {
  type: 'json',
};
import recoveryModules from '../../deployment/m5-runtime/native-recovery-module-baseline.json' with { type: 'json' };
import recoveryBinding from '../../deployment/m5-runtime/native-recovery-release-binding.json' with { type: 'json' };
import reviewCartModules from '../../deployment/m5-runtime/native-review-cart-module-baseline.json' with {
  type: 'json',
};
import reviewCartBinding from '../../deployment/m5-runtime/native-review-cart-release-binding.json' with {
  type: 'json',
};
import reviewNavModules from '../../deployment/m5-runtime/native-review-nav-module-baseline.json' with { type: 'json' };
import reviewNavBinding from '../../deployment/m5-runtime/native-review-nav-release-binding.json' with { type: 'json' };
import selectedOnlyModules from '../../deployment/m5-runtime/native-selected-fixed-module-baseline.json' with {
  type: 'json',
};
import selectedOnlyBinding from '../../deployment/m5-runtime/native-selected-fixed-release-binding.json' with {
  type: 'json',
};
import speedModules from '../../deployment/m5-runtime/native-speed-module-baseline.json' with { type: 'json' };
import speedBinding from '../../deployment/m5-runtime/native-speed-release-binding.json' with { type: 'json' };
import startupModules from '../../deployment/m5-runtime/native-startup-module-baseline.json' with { type: 'json' };
import startupBinding from '../../deployment/m5-runtime/native-startup-release-binding.json' with { type: 'json' };
import nativeThemeModules from '../../deployment/m5-runtime/native-theme-module-baseline.json' with { type: 'json' };
import refreshModules from '../../deployment/m5-runtime/selected-refresh-module-baseline.json' with { type: 'json' };
import selectedModules from '../../deployment/m5-runtime/selected-ui-module-baseline.json' with { type: 'json' };
import proxyModules from '../../deployment/m8-journey/app-proxy-module-baseline.json' with { type: 'json' };
import cookieThemeModules from '../../deployment/m8-journey/cookie-theme-module-baseline.json' with { type: 'json' };
import leanMarketsModules from '../../deployment/m8-journey/lean-markets-module-baseline.json' with { type: 'json' };
import privacyModules from '../../deployment/m8-journey/lean-privacy-module-baseline.json' with { type: 'json' };
import previewThemeModules from '../../deployment/m8-journey/preview-theme-module-baseline.json' with { type: 'json' };
import historicalM8Modules from '../../deployment/m8-journey/release-module-baseline.json' with { type: 'json' };
import themeModules from '../../deployment/m8-journey/theme-module-baseline.json' with { type: 'json' };
import { resolveRuntimeReleaseProfile } from '../../packages/shopify/src/runtime-release-profile.ts';
import type { ReleaseAppendInput } from './append.mts';
import { qualifyReleaseAppendInput } from './append.mts';
import { SyntheticOwnerRequest, SyntheticOwnerResponse } from './boundary-fixture.mts';
import type { Reservation } from './collector.mts';
import { collectFreshTrustedRelease } from './collector.mts';
import { fixture } from './collector-fixture.mts';
import type { ManagementObservation, RemoteApp } from './management-worker.mts';
import { runManagementReads } from './management-worker.mts';
import { createOwnerHttps } from './owner-https.mts';
import { releaseProfile } from './profiles.mts';
import { createReleaseVerificationServer } from './server.mts';
import { array, object, required, text } from './validation.mts';

test('selected UI candidate preserves native Function, webhook, proxy and extension identity contracts', () => {
  assert.equal(selectedModules.length, privacyModules.length);
  for (const module of selectedModules) {
    const previous = required(privacyModules.find(({ handle }) => handle === module.handle));
    const { config, ...identity } = module;
    const { config: previousConfig, ...previousIdentity } = previous;
    assert.deepEqual(identity, previousIdentity);
    if (module.handle === 'insignia') continue; // Theme bytes intentionally change; profile digest binds all files.
    if (module.handle === 'app_home') {
      assert.deepEqual(config, { app_url: 'https://insignia-app.optidigi.nl/admin/home', embedded: true });
    } else if (module.handle === 'app_access') {
      const access = object(config),
        previousAccess = object(previousConfig);
      assert.deepEqual(text(access.scopes).split(',').sort(), text(previousAccess.scopes).split(',').sort());
      const { scopes: _scopes, ...settings } = access;
      const { scopes: _previousScopes, ...previousSettings } = previousAccess;
      assert.deepEqual(settings, previousSettings);
    } else assert.deepEqual(config, previousConfig);
  }
});

test('refresh candidate changes only theme bytes and preserves every native module identity', () => {
  assert.equal(refreshModules.length, selectedModules.length);
  for (const module of refreshModules) {
    const previous = required(selectedModules.find(({ handle }) => handle === module.handle));
    const { config, ...identity } = module;
    const { config: previousConfig, ...previousIdentity } = previous;
    assert.deepEqual(identity, previousIdentity);
    if (module.handle !== 'insignia') assert.deepEqual(config, previousConfig);
  }
});

test('native theme candidate changes only theme configuration and preserves every existing module identity', () => {
  assert.equal(nativeThemeModules.length, refreshModules.length);
  for (const module of nativeThemeModules) {
    const previous = required(refreshModules.find(({ handle }) => handle === module.handle));
    const { config, ...identity } = module;
    const { config: previousConfig, ...previousIdentity } = previous;
    assert.deepEqual(identity, previousIdentity);
    if (module.handle !== 'insignia') assert.deepEqual(config, previousConfig);
  }
});

test('corrected native candidate preserves every module identity and changes only its complete-element theme files', () => {
  assert.equal(fixedModules.length, nativeThemeModules.length);
  for (const module of fixedModules) {
    const previous = required(nativeThemeModules.find(({ handle }) => handle === module.handle));
    const { config, ...identity } = module;
    const { config: previousConfig, ...previousIdentity } = previous;
    assert.deepEqual(identity, previousIdentity);
    if (module.handle !== 'insignia') assert.deepEqual(config, previousConfig);
  }
});

test('native cart candidate adds exactly one version and preserves all identities and non-theme configurations', () => {
  assert.equal(cartModules.length, 14);
  const handles = cartModules.map(({ handle }) => handle);
  assert.deepEqual(handles, [...handles].sort(), 'Frozen module arrays use canonical handle order');
  assert.deepEqual(new Set(cartBinding.versionIds), new Set([...fixedBinding.versionIds, '1199122513921']));
  for (const module of cartModules) {
    const prior = required(fixedModules.find(({ handle }) => handle === module.handle));
    const { config, ...identity } = module;
    const { config: previousConfig, ...previousIdentity } = prior;
    assert.deepEqual(identity, previousIdentity);
    if (module.handle !== 'insignia') assert.deepEqual(config, previousConfig);
  }
});

test('corrected cleanup candidate preserves all original identities and retains both new inactive-version facts', () => {
  assert.equal(selectedOnlyModules.length, 14);
  const handles = selectedOnlyModules.map(({ handle }) => handle);
  assert.deepEqual(handles, [...handles].sort());
  assert.deepEqual(
    new Set(selectedOnlyBinding.versionIds),
    new Set([...cartBinding.versionIds, '1199165767681', '1199166783489']),
  );
  for (const module of selectedOnlyModules) {
    const prior = required(cartModules.find(({ handle }) => handle === module.handle));
    const { config, ...identity } = module;
    const { config: previousConfig, ...previousIdentity } = prior;
    assert.deepEqual(identity, previousIdentity);
    if (module.handle !== 'insignia') assert.deepEqual(config, previousConfig);
  }
});

test('behavior candidate preserves original identities and extends only its own exact inventory', () => {
  assert.equal(behaviorModules.length, 14);
  const handles = behaviorModules.map(({ handle }) => handle);
  assert.deepEqual(handles, [...handles].sort());
  assert.equal(behaviorBinding.versionIds.length, 22);
  assert.deepEqual(new Set(behaviorBinding.versionIds), new Set([...selectedOnlyBinding.versionIds, '1199244476417']));
  for (const module of behaviorModules) {
    const prior = required(selectedOnlyModules.find(({ handle }) => handle === module.handle));
    const { config, ...identity } = module;
    const { config: previousConfig, ...previousIdentity } = prior;
    assert.deepEqual(identity, previousIdentity);
    if (module.handle !== 'insignia') assert.deepEqual(config, previousConfig);
  }
});

test('parity candidate preserves identities and exactly extends its own inventory', () => {
  assert.equal(parityModules.length, 14);
  const handles = parityModules.map(({ handle }) => handle);
  assert.deepEqual(handles, [...handles].sort());
  assert.equal(parityBinding.versionIds.length, 23);
  assert.deepEqual(new Set(parityBinding.versionIds), new Set([...behaviorBinding.versionIds, '1199503441921']));
  for (const module of parityModules) {
    const prior = required(behaviorModules.find(({ handle }) => handle === module.handle));
    const { config, ...identity } = module;
    const { config: previousConfig, ...previousIdentity } = prior;
    assert.deepEqual(identity, previousIdentity);
    if (module.handle !== 'insignia') assert.deepEqual(config, previousConfig);
  }
});

test('performance candidate preserves identities and exactly extends the prior inventory', () => {
  assert.equal(performanceModules.length, 14);
  const handles = performanceModules.map(({ handle }) => handle);
  assert.deepEqual(handles, [...handles].sort());
  assert.equal(performanceBinding.versionIds.length, 24);
  assert.deepEqual(new Set(performanceBinding.versionIds), new Set([...parityBinding.versionIds, '1199754706945']));
  for (const module of performanceModules) {
    const prior = required(parityModules.find(({ handle }) => handle === module.handle));
    const { config, ...identity } = module;
    const { config: previousConfig, ...previousIdentity } = prior;
    assert.deepEqual(identity, previousIdentity);
    if (module.handle !== 'insignia') assert.deepEqual(config, previousConfig);
  }
});

test('speed candidate preserves identities and exactly extends the prior inventory', () => {
  assert.equal(speedModules.length, 14);
  const handles = speedModules.map(({ handle }) => handle);
  assert.deepEqual(handles, [...handles].sort());
  assert.equal(speedBinding.versionIds.length, 25);
  assert.deepEqual(new Set(speedBinding.versionIds), new Set([...performanceBinding.versionIds, '1199807692801']));
  for (const module of speedModules) {
    const prior = required(performanceModules.find(({ handle }) => handle === module.handle));
    const { config, ...identity } = module;
    const { config: previousConfig, ...previousIdentity } = prior;
    assert.deepEqual(identity, previousIdentity);
    if (module.handle !== 'insignia') assert.deepEqual(config, previousConfig);
  }
});

test('recovery candidate preserves every native identity and the exact complete inventory', () => {
  assert.equal(recoveryModules.length, 14);
  assert.deepEqual(
    recoveryModules.map((m) => m.handle),
    recoveryModules.map((m) => m.handle).sort(),
  );
  assert.deepEqual(new Set(recoveryBinding.versionIds), new Set([...speedBinding.versionIds, '1199953805313']));
  for (const module of recoveryModules) {
    const prior = required(speedModules.find((m) => m.handle === module.handle));
    const { config, ...identity } = module,
      { config: oldConfig, ...oldIdentity } = prior;
    assert.deepEqual(identity, oldIdentity);
    if (module.handle !== 'insignia') assert.deepEqual(config, oldConfig);
  }
});

test('startup candidate preserves native identities and exactly extends the complete recovery inventory', () => {
  assert.equal(startupModules.length, 14);
  assert.deepEqual(
    startupModules.map((m) => m.handle),
    startupModules.map((m) => m.handle).sort(),
  );
  assert.equal(startupBinding.versionIds.length, 27);
  assert.deepEqual(new Set(startupBinding.versionIds), new Set([...recoveryBinding.versionIds, '1200333160449']));
  for (const module of startupModules) {
    const prior = required(recoveryModules.find((m) => m.handle === module.handle));
    const { config, ...identity } = module,
      { config: oldConfig, ...oldIdentity } = prior;
    assert.deepEqual(identity, oldIdentity);
    if (module.handle !== 'insignia') assert.deepEqual(config, oldConfig);
  }
});

test('Review/cart candidate preserves native identities and exactly extends the startup inventory', () => {
  assert.equal(reviewCartModules.length, 14);
  assert.deepEqual(
    reviewCartModules.map((m) => m.handle),
    reviewCartModules.map((m) => m.handle).sort(),
  );
  assert.equal(reviewCartBinding.versionIds.length, 28);
  assert.deepEqual(new Set(reviewCartBinding.versionIds), new Set([...startupBinding.versionIds, '1200729554945']));
  for (const module of reviewCartModules) {
    const prior = required(startupModules.find((m) => m.handle === module.handle));
    const { config, ...identity } = module,
      { config: oldConfig, ...oldIdentity } = prior;
    assert.deepEqual(identity, oldIdentity);
    if (module.handle !== 'insignia') assert.deepEqual(config, oldConfig);
  }
});
test('Loading/handoff candidate preserves native identities and exactly extends the Review/cart inventory', () => {
  assert.equal(loadingModules.length, 14);
  assert.deepEqual(
    loadingModules.map((m) => m.handle),
    loadingModules.map((m) => m.handle).sort(),
  );
  assert.equal(loadingBinding.versionIds.length, 29);
  assert.deepEqual(new Set(loadingBinding.versionIds), new Set([...reviewCartBinding.versionIds, '1201128341505']));
  for (const module of loadingModules) {
    const prior = required(reviewCartModules.find((m) => m.handle === module.handle));
    const { config, ...identity } = module,
      { config: oldConfig, ...oldIdentity } = prior;
    assert.deepEqual(identity, oldIdentity);
    if (module.handle !== 'insignia') assert.deepEqual(config, oldConfig);
  }
});

test('Review navigation candidate preserves identities and exactly extends the loading inventory', () => {
  assert.equal(reviewNavBinding.moduleHash, '0b8452cc5cfbe750f9bb871f03ae6a2474daaec3a30c5158cee4d0dd37e29dab');
  assert.equal(reviewNavModules.length, 14);
  assert.deepEqual(
    reviewNavModules.map((m) => m.handle),
    reviewNavModules.map((m) => m.handle).sort(),
  );
  assert.equal(reviewNavBinding.versionIds.length, 30);
  assert.deepEqual(new Set(reviewNavBinding.versionIds), new Set([...loadingBinding.versionIds, '1201192632321']));
  for (const module of reviewNavModules) {
    const prior = required(loadingModules.find((m) => m.handle === module.handle));
    const { config, ...identity } = module,
      { config: oldConfig, ...oldIdentity } = prior;
    assert.deepEqual(identity, oldIdentity);
    if (module.handle !== 'insignia') assert.deepEqual(config, oldConfig);
  }
});

test('canonical candidate preserves identities and extends the complete inventory by one inactive version', () => {
  assert.equal(canonicalModules.length, 14);
  assert.equal(canonicalBinding.moduleHash, '0f3738b9ac2859f77614006440b78ffa6aacd3e4219c2fecb801758dcc379e25');
  assert.equal(canonicalBinding.versionIds.length, 31);
  assert.deepEqual(new Set(canonicalBinding.versionIds), new Set([...reviewNavBinding.versionIds, '1201385144321']));
  assert.deepEqual(
    canonicalModules.map((m) => m.handle),
    canonicalModules.map((m) => m.handle).sort(),
  );
  for (const module of canonicalModules) {
    const prior = required(reviewNavModules.find((m) => m.handle === module.handle));
    const { config, ...identity } = module,
      { config: oldConfig, ...oldIdentity } = prior;
    assert.deepEqual(identity, oldIdentity);
    if (module.handle !== 'insignia') assert.deepEqual(config, oldConfig);
  }
});
test('cart repair candidate preserves identities and extends the complete inventory by one inactive version', () => {
  assert.equal(cartRepairModules.length, 14);
  assert.equal(cartRepairBinding.moduleHash, 'b90b62c0ebd602c4b20141379feaa9d3c6d33e615103e991da5d04bd13817064');
  assert.equal(cartRepairBinding.versionIds.length, 32);
  assert.deepEqual(new Set(cartRepairBinding.versionIds), new Set([...canonicalBinding.versionIds, '1202503778305']));
  assert.deepEqual(
    cartRepairModules.map((m) => m.handle),
    cartRepairModules.map((m) => m.handle).sort(),
  );
  for (const module of cartRepairModules) {
    const prior = required(canonicalModules.find((m) => m.handle === module.handle));
    const { config, ...identity } = module,
      { config: oldConfig, ...oldIdentity } = prior;
    assert.deepEqual(identity, oldIdentity);
    if (module.handle !== 'insignia') assert.deepEqual(config, oldConfig);
  }
});
test('functions renew candidate preserves identities and changes only theme and Function artifacts', () => {
  assert.equal(functionsRenewModules.length, 14);
  assert.equal(functionsRenewBinding.moduleHash, '6bbac54719093f8ab867fe199e70bddf5b7e40f4b6404c046d4deb74b573cb9a');
  assert.equal(functionsRenewBinding.versionIds.length, 33);
  assert.deepEqual(
    new Set(functionsRenewBinding.versionIds),
    new Set([...cartRepairBinding.versionIds, '1202733449217']),
  );
  assert.deepEqual(
    functionsRenewModules.map((m) => m.handle),
    functionsRenewModules.map((m) => m.handle).sort(),
  );
  const queryHash = (config: unknown) =>
    createHash('sha256')
      .update(String(required(array(object(config).targets)[0] as { input_query?: unknown }).input_query), 'utf8')
      .digest('hex');
  const renewed = {
    'insignia-experimental-v2-transform': {
      query: '8d93a08697dd56e4aa3f857c3509e4d828a5f4195cb2e8cd878749c3e5729053',
      wasmBytes: 181233,
    },
    'insignia-experimental-v2-validation': {
      query: '5baff05ac4b1967bc7c9b461b7d6a8956344ddd8c9233708534e8814b34ebcc4',
      wasmBytes: 183624,
    },
  } as const;
  for (const module of functionsRenewModules) {
    const prior = required(cartRepairModules.find((m) => m.handle === module.handle));
    const { config, ...identity } = module,
      { config: oldConfig, ...oldIdentity } = prior;
    assert.deepEqual(identity, oldIdentity);
    if (module.type === 'function') {
      const expected = renewed[module.handle as keyof typeof renewed];
      assert(expected);
      assert.equal(queryHash(config), expected.query);
      const metadata = object(object(config).module_metadata);
      assert.equal(metadata.module_wasm_size_bytes, expected.wasmBytes);
      assert.notEqual(object(config).module_id, object(oldConfig).module_id);
      const unversioned = (value: unknown) => {
        const { module_id: _id, module_metadata, targets, ...rest } = object(value);
        const { module_wasm_size_bytes: _w, module_compiled_size_bytes: _c, ...meta } = object(module_metadata);
        const [target] = array(targets);
        const { input_query: _q, ...targetRest } = object(target);
        return { ...rest, meta, target: targetRest };
      };
      assert.deepEqual(unversioned(config), unversioned(oldConfig));
    } else if (module.handle !== 'insignia') assert.deepEqual(config, oldConfig);
  }
});
test('canonical-host candidate changes only the app host', () => {
  assert.equal(canonicalHostModules.length, 14);
  assert.equal(canonicalHostBinding.moduleHash, '6599faf690ed74df94e4b99204de391f49990a39021abf8196fe4fbafee27714');
  assert.equal(canonicalHostBinding.versionId, '1203782746113');
  assert.deepEqual(
    new Set(canonicalHostBinding.versionIds),
    new Set([...cartLineV3Binding.versionIds, '1203782746113']),
  );
  assert.deepEqual(
    canonicalHostModules.map((m) => m.handle),
    canonicalHostModules.map((m) => m.handle).sort(),
  );
  const swap = (value: unknown) =>
    JSON.parse(
      JSON.stringify(value).replaceAll('https://insignia-app.optidigi.nl', 'https://app.insigniacustomizer.com'),
    );
  // Webhook subscription registrations are keyed by topic and URI, so only their identities move with the host.
  const key = (m: { type: string; handle: string; registrationId: string }) =>
    m.type === 'webhook_subscription' ? swap(m.registrationId) : m.handle;
  const prior = new Map(cartLineV3Modules.map((m) => [key(m), m]));
  assert.equal(prior.size, 14);
  for (const module of canonicalHostModules) {
    const old = required(prior.get(key(module)));
    assert.deepEqual(module.config, swap(old.config));
    assert.equal(module.type, old.type);
    if (module.type !== 'webhook_subscription') assert.deepEqual(module, swap(old));
    if (module.type === 'function' || module.type === 'theme_app_extension') assert.deepEqual(module, old);
  }
  assert.ok(!JSON.stringify(canonicalHostModules).includes('insignia-app.optidigi.nl'));
});

test('cart-line v3 candidate preserves identities and changes only theme and Function artifacts', () => {
  assert.equal(cartLineV3Modules.length, 14);
  assert.equal(cartLineV3Binding.moduleHash, 'dd76c50a573e7c6cdb7b42555fdbc36e1edda5189c75b876f4f81d92f66c447f');
  assert.equal(cartLineV3Binding.versionIds.length, 34);
  assert.deepEqual(
    new Set(cartLineV3Binding.versionIds),
    new Set([...functionsRenewBinding.versionIds, '1202999689217']),
  );
  assert.deepEqual(
    cartLineV3Modules.map((m) => m.handle),
    cartLineV3Modules.map((m) => m.handle).sort(),
  );
  const queryHash = (config: unknown) =>
    createHash('sha256')
      .update(String(required(array(object(config).targets)[0] as { input_query?: unknown }).input_query), 'utf8')
      .digest('hex');
  const v3 = {
    'insignia-experimental-v2-transform': {
      query: '02ab5bcee805fba94dff9309a2e55cb1998651ca42fdba8564872ba891fd16ac',
      wasmBytes: 183604,
    },
    'insignia-experimental-v2-validation': {
      query: '5867e61f07dbb4d6417df401b5ffbc47f0175eca1d00f7792621150713b18d7e',
      wasmBytes: 181608,
    },
  } as const;
  for (const module of cartLineV3Modules) {
    const prior = required(functionsRenewModules.find((m) => m.handle === module.handle));
    const { config, ...identity } = module,
      { config: oldConfig, ...oldIdentity } = prior;
    assert.deepEqual(identity, oldIdentity);
    if (module.type === 'function') {
      const expected = v3[module.handle as keyof typeof v3];
      assert(expected);
      assert.equal(queryHash(config), expected.query);
      assert.notEqual(queryHash(config), queryHash(oldConfig));
      const metadata = object(object(config).module_metadata);
      assert.equal(metadata.module_wasm_size_bytes, expected.wasmBytes);
      assert.notEqual(object(config).module_id, object(oldConfig).module_id);
      const unversioned = (value: unknown) => {
        const { module_id: _id, module_metadata, targets, ...rest } = object(value);
        const { module_wasm_size_bytes: _w, module_compiled_size_bytes: _c, ...meta } = object(module_metadata);
        const [target] = array(targets);
        const { input_query: _q, ...targetRest } = object(target);
        return { ...rest, meta, target: targetRest };
      };
      assert.deepEqual(unversioned(config), unversioned(oldConfig));
    } else if (module.handle !== 'insignia') assert.deepEqual(config, oldConfig);
  }
});
const runtimeProfileNames = [
  'native-cart-line-v3-aa3b6166',
  'native-functions-renew-8fffc9de',
  'native-cart-repair-eb386d22',
  'native-canonical-313b12ad',
  'native-review-nav-8a7ee446',
  'native-loading-defd05b0',
  'native-review-cart-1f4595f',
  'native-startup-771bb8f',
  'native-recovery-e2c3dc5',
  'native-speed-e52be93',
  'native-performance-b2729a6',
  'native-parity-466a687',
  'native-behavior-6b6c15e',
  'native-selected-fixed-81830c6',
  'native-cart-fd9cc61',
  'native-fixed-5c04fa8',
  'native-theme-ced0143',
  'selected-ui-aab4a4b',
  'selected-ui-f48efa2',
  'm5-functions-9c2e56b42fbf',
  'm8-read-orders-617057f',
  'm8-app-proxy-3d2a02e',
  'm8-theme-c8d8713',
  'm8-cookie-91b35ab',
  'm8-preview-28443bd',
  'lean-markets-7b17cd9',
  'lean-privacy-theme-23fd116',
] as const;
test('each profile names the Function artifacts its runtime profile admits', () => {
  const original = {
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
  assert.deepEqual(releaseProfile('native-cart-line-v3-aa3b6166').functions, {
    sourceCommit: 'aa3b6166eb2b4679f27e1b7f128d914137ba8412',
    transform: {
      inputQuerySha256: '02ab5bcee805fba94dff9309a2e55cb1998651ca42fdba8564872ba891fd16ac',
      wasmSha256: '5c8708b578383d54f78b79534a3141515296f7b3864bce9852af0c678dbed677',
    },
    validation: {
      inputQuerySha256: '5867e61f07dbb4d6417df401b5ffbc47f0175eca1d00f7792621150713b18d7e',
      wasmSha256: '6c362b36a5cf3eba77dcf9accc64bf0ae3225d77c97dd01bcc9d3e0e1ea83de4',
    },
  });
  assert.deepEqual(releaseProfile('native-functions-renew-8fffc9de').functions, {
    sourceCommit: '8fffc9debc2bad4914aaa22dca82d8fdf272de5d',
    transform: {
      inputQuerySha256: '8d93a08697dd56e4aa3f857c3509e4d828a5f4195cb2e8cd878749c3e5729053',
      wasmSha256: 'f5979b61ba46c9ca315324500b1bedf806949ebf8fb8979494e0bdaf68e392f6',
    },
    validation: {
      inputQuerySha256: '5baff05ac4b1967bc7c9b461b7d6a8956344ddd8c9233708534e8814b34ebcc4',
      wasmSha256: '4a3e7495245e8716b976ff3c3816c4e144114883edd317afc38fdf84b369f9ec',
    },
  });
  for (const name of runtimeProfileNames) {
    const functions = releaseProfile(name).functions;
    if (name !== 'native-functions-renew-8fffc9de' && name !== 'native-cart-line-v3-aa3b6166')
      assert.deepEqual(functions, original);
    assert.equal(functions.sourceCommit, resolveRuntimeReleaseProfile(name).functionsSourceCommit);
    assert.equal(releaseProfile(name).versionId, resolveRuntimeReleaseProfile(name).activeVersionRef);
  }
});
for (const profile of [
  'native-cart-line-v3-aa3b6166',
  'native-functions-renew-8fffc9de',
  'native-cart-repair-eb386d22',
  'native-canonical-313b12ad',
  'native-review-nav-8a7ee446',
  'native-loading-defd05b0',
  'native-review-cart-1f4595f',
  'native-startup-771bb8f',
  'native-recovery-e2c3dc5',
  'native-speed-e52be93',
  'native-performance-b2729a6',
  'native-parity-466a687',
  'native-behavior-6b6c15e',
  'native-selected-fixed-81830c6',
  'native-cart-fd9cc61',
  'native-fixed-5c04fa8',
  'native-theme-ced0143',
  'selected-ui-aab4a4b',
  'selected-ui-f48efa2',
  'm8-read-orders-617057f',
  'm8-app-proxy-3d2a02e',
  'm8-theme-c8d8713',
  'm8-cookie-91b35ab',
  'm8-preview-28443bd',
  'lean-markets-7b17cd9',
  'lean-privacy-theme-23fd116',
]) {
  const v3 = profile === 'native-cart-line-v3-aa3b6166';
  const renew = v3 || profile === 'native-functions-renew-8fffc9de';
  const cartRepair = renew || profile === 'native-cart-repair-eb386d22';
  const inputQueries = v3
    ? {
        transform: '02ab5bcee805fba94dff9309a2e55cb1998651ca42fdba8564872ba891fd16ac',
        validation: '5867e61f07dbb4d6417df401b5ffbc47f0175eca1d00f7792621150713b18d7e',
      }
    : renew
      ? { validation: '5baff05ac4b1967bc7c9b461b7d6a8956344ddd8c9233708534e8814b34ebcc4' }
      : undefined;
  const canonical = cartRepair || profile === 'native-canonical-313b12ad';
  const reviewNav = canonical || profile === 'native-review-nav-8a7ee446';
  const loading = reviewNav || profile === 'native-loading-defd05b0';
  const reviewCart = loading || profile === 'native-review-cart-1f4595f';
  const startup = reviewCart || profile === 'native-startup-771bb8f';
  const recovery = startup || profile === 'native-recovery-e2c3dc5';
  const speed = recovery || profile === 'native-speed-e52be93';
  const performance = speed || profile === 'native-performance-b2729a6';
  const parity = performance || profile === 'native-parity-466a687';
  const behavior = parity || profile === 'native-behavior-6b6c15e';
  const selectedOnly = behavior || profile === 'native-selected-fixed-81830c6';
  const cart = selectedOnly || profile === 'native-cart-fd9cc61';
  const fixed = cart || profile === 'native-fixed-5c04fa8';
  const nativeTheme = fixed || profile === 'native-theme-ced0143';
  const refreshed = nativeTheme || profile === 'selected-ui-aab4a4b';
  const selected = refreshed || profile === 'selected-ui-f48efa2';
  const privacy = selected || profile === 'lean-privacy-theme-23fd116';
  const lean = privacy || profile === 'lean-markets-7b17cd9';
  const preview = lean || profile === 'm8-preview-28443bd';
  const cookie = preview || profile === 'm8-cookie-91b35ab';
  const theme = cookie || profile === 'm8-theme-c8d8713';
  const proxy = profile !== 'm8-read-orders-617057f';
  const versionId = v3
    ? '1202999689217'
    : renew
      ? '1202733449217'
      : cartRepair
        ? '1202503778305'
        : canonical
          ? '1201385144321'
          : reviewNav
            ? '1201192632321'
            : loading
              ? '1201128341505'
              : reviewCart
                ? '1200729554945'
                : startup
                  ? '1200333160449'
                  : recovery
                    ? '1199953805313'
                    : speed
                      ? '1199807692801'
                      : performance
                        ? '1199754706945'
                        : parity
                          ? '1199503441921'
                          : behavior
                            ? '1199244476417'
                            : selectedOnly
                              ? '1199166783489'
                              : cart
                                ? '1199122513921'
                                : fixed
                                  ? '1198986199041'
                                  : nativeTheme
                                    ? '1198938357761'
                                    : refreshed
                                      ? '1197668466689'
                                      : selected
                                        ? '1196974997505'
                                        : privacy
                                          ? '1171218169857'
                                          : lean
                                            ? '1169137696769'
                                            : preview
                                              ? '1168157736961'
                                              : cookie
                                                ? '1166710865921'
                                                : theme
                                                  ? '1166552825857'
                                                  : proxy
                                                    ? '1166090010625'
                                                    : '1165513097217';
  const modules = v3
    ? cartLineV3Modules
    : renew
      ? functionsRenewModules
      : cartRepair
        ? cartRepairModules
        : canonical
          ? canonicalModules
          : reviewNav
            ? reviewNavModules
            : loading
              ? loadingModules
              : reviewCart
                ? reviewCartModules
                : startup
                  ? startupModules
                  : recovery
                    ? recoveryModules
                    : speed
                      ? speedModules
                      : performance
                        ? performanceModules
                        : parity
                          ? parityModules
                          : behavior
                            ? behaviorModules
                            : selectedOnly
                              ? selectedOnlyModules
                              : cart
                                ? cartModules
                                : fixed
                                  ? fixedModules
                                  : nativeTheme
                                    ? nativeThemeModules
                                    : refreshed
                                      ? refreshModules
                                      : selected
                                        ? selectedModules
                                        : privacy
                                          ? privacyModules
                                          : lean
                                            ? leanMarketsModules
                                            : preview
                                              ? previewThemeModules
                                              : cookie
                                                ? cookieThemeModules
                                                : theme
                                                  ? themeModules
                                                  : proxy
                                                    ? proxyModules
                                                    : historicalM8Modules;
  const profileTest = (name: string, fn: TestFn) => test(`${profile}: ${name}`, fn);
  const prior = (versions: ReleaseAppendInput['activeObservation']['versions']) =>
    proxy
      ? [
          ...(v3
            ? [
                {
                  versionId: 'gid://shopify/Version/1202733449217',
                  versionTag: 'native-functions-renew-8fffc9de',
                  status: 'inactive' as const,
                },
              ]
            : []),
          ...(renew
            ? [
                {
                  versionId: 'gid://shopify/Version/1202503778305',
                  versionTag: 'native-cart-repair-eb386d22',
                  status: 'inactive' as const,
                },
              ]
            : []),
          ...(cartRepair
            ? [
                {
                  versionId: 'gid://shopify/Version/1201385144321',
                  versionTag: 'native-canonical-313b12ad',
                  status: 'inactive' as const,
                },
              ]
            : []),
          ...(canonical
            ? [
                {
                  versionId: 'gid://shopify/Version/1201192632321',
                  versionTag: 'native-review-nav-8a7ee446',
                  status: 'inactive' as const,
                },
              ]
            : []),
          ...(reviewNav
            ? [
                {
                  versionId: 'gid://shopify/Version/1201128341505',
                  versionTag: 'native-loading-defd05b0',
                  status: 'inactive' as const,
                },
              ]
            : []),
          ...(loading
            ? [
                {
                  versionId: 'gid://shopify/Version/1200729554945',
                  versionTag: 'native-review-cart-1f4595f',
                  status: 'inactive' as const,
                },
              ]
            : []),
          ...(reviewCart
            ? [
                {
                  versionId: 'gid://shopify/Version/1200333160449',
                  versionTag: 'native-startup-771bb8f',
                  status: 'inactive' as const,
                },
              ]
            : []),
          ...(startup
            ? [
                {
                  versionId: 'gid://shopify/Version/1199953805313',
                  versionTag: 'native-recovery-e2c3dc5',
                  status: 'inactive',
                },
              ]
            : []),
          ...(recovery
            ? [
                {
                  versionId: 'gid://shopify/Version/1199807692801',
                  versionTag: 'native-speed-e52be93',
                  status: 'inactive',
                },
              ]
            : []),
          ...(speed
            ? [
                {
                  versionId: 'gid://shopify/Version/1199754706945',
                  versionTag: 'native-performance-b2729a6',
                  status: 'inactive',
                },
              ]
            : []),
          ...(performance
            ? [
                {
                  versionId: 'gid://shopify/Version/1199503441921',
                  versionTag: 'native-parity-466a687',
                  status: 'inactive',
                },
              ]
            : []),
          ...(parity
            ? [
                {
                  versionId: 'gid://shopify/Version/1199244476417',
                  versionTag: 'native-behavior-6b6c15e',
                  status: 'inactive',
                },
              ]
            : []),
          ...(behavior
            ? [
                {
                  versionId: 'gid://shopify/Version/1199166783489',
                  versionTag: 'native-selected-fixed-81830c6',
                  status: 'inactive',
                },
              ]
            : []),
          ...(selectedOnly
            ? [
                {
                  versionId: 'gid://shopify/Version/1199165767681',
                  versionTag: 'native-selected-81830c6',
                  status: 'inactive',
                },
                {
                  versionId: 'gid://shopify/Version/1199122513921',
                  versionTag: 'native-cart-fd9cc61',
                  status: 'inactive',
                },
              ]
            : []),
          ...(cart
            ? [
                {
                  versionId: 'gid://shopify/Version/1198986199041',
                  versionTag: 'native-fixed-5c04fa8',
                  status: 'inactive',
                },
              ]
            : []),
          ...(fixed
            ? [
                {
                  versionId: 'gid://shopify/Version/1198938357761',
                  versionTag: 'native-theme-ced0143',
                  status: 'inactive',
                },
              ]
            : []),
          ...(nativeTheme
            ? [
                {
                  versionId: 'gid://shopify/Version/1197668466689',
                  versionTag: 'selected-ui-aab4a4b',
                  status: 'inactive',
                },
              ]
            : []),
          ...(refreshed
            ? [
                {
                  versionId: 'gid://shopify/Version/1196974997505',
                  versionTag: 'selected-ui-f48efa2',
                  status: 'inactive',
                },
              ]
            : []),
          ...(selected
            ? [
                {
                  versionId: 'gid://shopify/Version/1171218169857',
                  versionTag: 'lean-privacy-theme-23fd116',
                  status: 'inactive',
                },
              ]
            : []),
          ...(privacy
            ? [
                {
                  versionId: 'gid://shopify/Version/1169137696769',
                  versionTag: 'lean-markets-7b17cd9',
                  status: 'inactive',
                },
              ]
            : []),
          ...(lean
            ? [
                {
                  versionId: 'gid://shopify/Version/1168157736961',
                  versionTag: 'm8-preview-28443bd',
                  status: 'inactive',
                },
              ]
            : []),
          ...(preview
            ? [
                {
                  versionId: 'gid://shopify/Version/1166710865921',
                  versionTag: 'm8-cookie-91b35ab',
                  status: 'inactive',
                },
              ]
            : []),
          ...(cookie
            ? [{ versionId: 'gid://shopify/Version/1166552825857', versionTag: 'm8-theme-c8d8713', status: 'inactive' }]
            : []),
          ...(theme
            ? [
                {
                  versionId: 'gid://shopify/Version/1166090010625',
                  versionTag: 'm8-app-proxy-3d2a02e',
                  status: 'inactive',
                },
              ]
            : []),
          {
            versionId: 'gid://shopify/Version/1165513097217',
            versionTag: 'm8-read-orders-617057f',
            status: 'inactive',
          },
          ...versions,
        ]
      : versions;
  profileTest(
    'M8 scoped candidate requires its exact reviewed Active inventory and preserved module bytes',
    async () => {
      const time = Date.parse('2026-10-11T12:00:00.000Z');
      const f = await fixture({ time, inputQueries });
      try {
        const opening = await f.ports.management.open(async () => ({ durable: true }));
        const binding = await f.ports.readTenant();
        assert.deepEqual(await f.ports.readFunctions('synthetic', binding), f.functions);
        const input: ReleaseAppendInput = {
          recordId: f.config.recordId,
          operator: f.config.operator,
          activeObservation: {
            observedAt: new Date(time).toISOString(),
            versions: [
              { versionId: `gid://shopify/Version/${versionId}`, versionTag: profile, status: 'active' },
              ...prior(opening.versions).map((v) => ({ ...v, status: 'inactive' })),
            ],
          },
          moduleObservation: {
            ...opening.moduleObservation,
            versionId: versionId,
            versionTag: profile,
            observedAt: new Date(time).toISOString(),
            modules: structuredClone(modules),
          },
          readiness: {
            version: 'm5-admin-technical-readiness-v1',
            shop: binding.shop,
            tenantShopId: binding.tenantShopId,
            installationGeneration: binding.installationGeneration,
            shopId: binding.shopId,
            externalInstallationId: binding.externalInstallationId,
            functions: { observation: structuredClone(f.functions.observation) },
          },
        };
        assert.equal(qualifyReleaseAppendInput(input, time, profile).expected.appVersionRef, versionId);
        const otherQuery = structuredClone(input);
        otherQuery.readiness.functions.observation.validation.inputQuerySha256 = v3
          ? '5baff05ac4b1967bc7c9b461b7d6a8956344ddd8c9233708534e8814b34ebcc4'
          : renew
            ? 'a0cd5d7262514c134efc8e9ce964b25b877ce56fc10d0cba6bdd1af82f2dc8c5'
            : '5baff05ac4b1967bc7c9b461b7d6a8956344ddd8c9233708534e8814b34ebcc4';
        assert.throws(() => qualifyReleaseAppendInput(otherQuery, time, profile));
        const inactive = structuredClone(input);
        required(inactive.activeObservation.versions[0]).status = 'inactive';
        required(inactive.activeObservation.versions[1]).status = 'active';
        assert.throws(() => qualifyReleaseAppendInput(inactive, time, profile));
        const drift = structuredClone(input);
        const access = object(required(drift.moduleObservation.modules.find((m) => m.handle === 'app_access')).config);
        access.optional_scopes = [...array(access.optional_scopes), 'write_orders'];
        assert.throws(() => qualifyReleaseAppendInput(drift, time, profile));
        if (privacy) {
          const webhookDrift = structuredClone(input);
          object(
            required(webhookDrift.moduleObservation.modules.find((m) => m.type === 'webhook_subscription')).config,
          ).uri = 'https://foreign.invalid';
          assert.throws(() => qualifyReleaseAppendInput(webhookDrift, time, profile));
          const missingPrivacy = structuredClone(input);
          missingPrivacy.moduleObservation.modules = missingPrivacy.moduleObservation.modules.filter(
            (m) => m.handle !== 'privacy_compliance_webhooks',
          );
          assert.throws(() => qualifyReleaseAppendInput(missingPrivacy, time, profile));
        }
        const foreign = structuredClone(input);
        required(foreign.activeObservation.versions[1]).versionId = 'gid://shopify/Version/999';
        assert.throws(() => qualifyReleaseAppendInput(foreign, time, profile));
        if (theme) {
          const missingTheme = structuredClone(input);
          missingTheme.moduleObservation.modules = missingTheme.moduleObservation.modules.filter(
            (m) => m.type !== 'theme_app_extension',
          );
          assert.throws(() => qualifyReleaseAppendInput(missingTheme, time, profile));
          const changedTheme = structuredClone(input);
          required(
            changedTheme.moduleObservation.modules.find((m) => m.type === 'theme_app_extension'),
          ).registrationUuid = 'foreign';
          assert.throws(() => qualifyReleaseAppendInput(changedTheme, time, profile));
        }
        if (proxy) {
          const changedProxy = structuredClone(input);
          object(required(changedProxy.moduleObservation.modules.find((m) => m.handle === 'app_proxy')).config).url =
            'https://foreign.invalid';
          assert.throws(() => qualifyReleaseAppendInput(changedProxy, time, profile));
          const missingPrior = structuredClone(input);
          missingPrior.activeObservation.versions.splice(1, 1);
          assert.throws(() => qualifyReleaseAppendInput(missingPrior, time, profile));
          // Historical inventory is deliberately stale after a new inactive version.
          const staleHistorical = structuredClone(input);
          required(staleHistorical.activeObservation.versions[0]).status = 'inactive';
          required(staleHistorical.activeObservation.versions[1]).status = 'active';
          staleHistorical.moduleObservation = {
            ...staleHistorical.moduleObservation,
            versionId: '1165513097217',
            versionTag: 'm8-read-orders-617057f',
            modules: structuredClone(historicalM8Modules),
          };
          assert.throws(() => qualifyReleaseAppendInput(staleHistorical, time, 'm8-read-orders-617057f'));
        }
        assert.throws(() => qualifyReleaseAppendInput(input, time));
        assert.throws(() => qualifyReleaseAppendInput(input, time, 'arbitrary'));
      } finally {
        await f.close();
      }
    },
  );

  profileTest(
    'M8 collector verifies real-port selected inventory and order-read grants before its one append',
    async () => {
      for (const state of [
        'active',
        'inactive',
        'missing_grant',
        ...(proxy ? ['missing_proxy_grant'] : []),
        ...(lean ? ['missing_markets_grant'] : []),
      ]) {
        const time = Date.parse('2026-10-11T12:00:00.000Z');
        const f = await fixture({ time, recordId: randomUUID(), inputQueries });
        let appended = 0,
          authenticated = 0;
        const old = await f.ports.management.open(async () => ({ durable: true }));
        const versions = [
          {
            versionId: `gid://shopify/Version/${versionId}`,
            versionTag: profile,
            status: state === 'inactive' ? 'inactive' : 'active',
          },
          ...prior(old.versions).map((v) => ({ ...v, status: state === 'inactive' ? v.status : 'inactive' })),
        ];
        const sdk = {
          activeAppVersionRawResult: async () => ({
            app: {
              id: 'gid://shopify/App/429028933633',
              key: '1443cf6d03d39edae7c101a943c5c684',
              organizationId: 'gid://shopify/Organization/123',
              activeRelease: {
                version: {
                  id: `gid://shopify/Version/${versionId}`,
                  metadata: { versionTag: profile },
                  appModules: modules.map((m) => ({
                    uuid: m.registrationUuid,
                    userIdentifier: m.registrationId || m.registrationUuid,
                    handle: m.handle,
                    config: m.config,
                    target: m.target,
                    specification: m.specification,
                  })),
                },
              },
            },
          }),
          appVersions: async () => ({
            app: {
              id: 'gid://shopify/App/429028933633',
              appVersions: {
                nodes: versions,
                pageInfo: {
                  totalResults: versions.length,
                },
              },
            },
          }),
        };
        const stateHolder: {
          opening?: ManagementObservation;
          closing?: ManagementObservation;
          running?: Promise<void>;
        } = {};
        let releaseClose: () => void = () => {
          throw new Error('Close uninitialized');
        };
        let openingReady: () => void = () => {
          throw new Error('Open uninitialized');
        };
        let currentReserve: Reservation = async () => {
          throw new Error('Reserve uninitialized');
        };
        const opened = new Promise<void>((resolve) => {
          openingReady = resolve;
        });
        const closeSignal = new Promise<void>((resolve) => {
          releaseClose = resolve;
        });
        const originalInstallation = f.ports.readInstallation;
        f.ports.management = {
          authenticate: async () => {},
          open: async (reserve) => {
            currentReserve = reserve;
            stateHolder.running = runManagementReads({
              client: sdk,
              profileName: profile,
              reserve: (op) => currentReserve(op),
              send: async (kind, value) => {
                if (kind === 'OPEN') {
                  stateHolder.opening = value;
                  openingReady();
                } else stateHolder.closing = value;
              },
              waitClose: () => closeSignal,
              now: () => new Date(time).toISOString(),
            });
            await Promise.race([opened, stateHolder.running]);
            const value = required(stateHolder.opening);
            return { ...value, moduleObservation: required(value.moduleObservation) };
          },
          close: async (reserve) => {
            currentReserve = reserve;
            releaseClose();
            await stateHolder.running;
            const value = required(stateHolder.closing);
            return { ...value, observedAt: required(value.observedAt) };
          },
        };
        const acquire = f.ports.acquireToken;
        f.ports.acquireToken = async () => {
          authenticated++;
          return acquire();
        };
        f.ports.readInstallation = async (...args) => {
          const value = await originalInstallation(...args);
          return {
            ...value,
            grants:
              state === 'missing_grant'
                ? value.grants
                : state === 'missing_proxy_grant'
                  ? [...value.grants, 'read_orders']
                  : [
                      ...value.grants,
                      'read_orders',
                      ...(proxy ? ['read_app_proxy', 'write_app_proxy'] : []),
                      ...(lean && state !== 'missing_markets_grant' ? ['read_markets'] : []),
                    ],
          };
        };
        f.ports.append = async (input) => {
          qualifyReleaseAppendInput(input, time, profile);
          appended++;
          return {
            classification: 'TRUSTED_RELEASE_APPEND_ACK_RUNTIME_QUALIFIED',
            recordId: text(object(input).recordId),
            writeAttempted: true,
            writeAcknowledged: true,
          };
        };
        try {
          const result = await collectFreshTrustedRelease(f.config, f.ports, profile);
          assert.equal(
            result.classification,
            state === 'active' ? 'TRUSTED_RELEASE_COLLECT_APPEND_ACK' : 'TRUSTED_RELEASE_COLLECT_STOPPED',
          );
          assert.equal(appended, state === 'active' ? 1 : 0);
          if (state === 'inactive') assert.equal(authenticated, 0);
        } finally {
          releaseClose?.();
          await stateHolder.running?.catch(() => {});
          await f.close();
        }
      }
    },
  );

  profileTest('M8 OAuth readback requires read_orders and refuses scope widening without retry', async () => {
    const granted =
      (proxy ? ',read_orders,read_app_proxy,write_app_proxy' : ',read_orders') + (lean ? ',read_markets' : '');
    for (const extra of ['', granted, `${granted},write_orders`, ...(proxy ? [',read_orders'] : [])]) {
      let requests = 0;
      const provider = createOwnerHttps({
        profileName: profile,
        functionQuery: 'query Fixed { shop { id } }',
        now: () => 0,
        deadline: 300000,
        request(_url, _options, callback) {
          requests++;
          const req = new SyntheticOwnerRequest();
          req.destroy = () => {};
          req.end = () =>
            queueMicrotask(() => {
              const res = new SyntheticOwnerResponse();
              res.statusCode = 200;
              res.headers = { 'content-type': 'application/json' };
              res.complete = true;
              res.destroy = () => {};
              callback(res);
              res.emit(
                'data',
                Buffer.from(
                  JSON.stringify({
                    access_token: 'synthetic',
                    expires_in: 3600,
                    scope:
                      'write_products,read_publications,read_product_listings,write_cart_transforms,write_validations' +
                      extra,
                  }),
                ),
              );
              res.emit('end');
            });
          return req;
        },
      });
      if (extra === granted) assert.equal(await provider.acquireToken('synthetic'), 'synthetic');
      else await assert.rejects(provider.acquireToken('synthetic'));
      await assert.rejects(provider.acquireToken('synthetic'));
      assert.equal(requests, 1);
    }
  });

  profileTest(
    'selected M8 private Unix receiver accepts only its reviewed target and exact current generation',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'm8-private-release-'));
      const socket = join(directory, 'collector.sock');
      const binding = {
        shopId: 'synthetic-tenant',
        installationGeneration: '1',
        appClientId: '1443cf6d03d39edae7c101a943c5c684',
        authorizationGeneration: '22222222-2222-4222-8222-222222222222',
        authorizationEpoch: 0,
        externalInstallationId: 'gid://shopify/AppInstallation/321',
      };
      let calls = 0;
      const server = createReleaseVerificationServer({
        profileName: profile,
        readBinding: async () => binding,
        records: { read: async () => null },
        collect: async (input) => {
          calls++;
          return {
            classification: 'TRUSTED_RELEASE_COLLECT_APPEND_ACK',
            appendAttempted: true,
            appendAcknowledged: true,
            ambiguousWrite: false,
            retryAuthorized: false,
            recordId: input.requestId,
          };
        },
      });
      await new Promise<void>((resolve) => server.listen(socket, resolve));
      const request = {
        requestId: randomUUID(),
        binding,
        expectedActiveAppVersionRef: versionId,
        deadlineMs: Date.now() + 60_000,
      };
      try {
        assert.equal((await createReleaseVerificationClient(socket, versionId).collect(request)).state, 'COMPLETE');
        await assert.rejects(
          createReleaseVerificationClient(socket).collect({ ...request, expectedActiveAppVersionRef: '1163229200385' }),
        );
        await assert.rejects(
          createReleaseVerificationClient(socket, versionId).collect({
            ...request,
            binding: { ...binding, authorizationEpoch: 1 },
          }),
        );
        assert.equal(calls, 1);
      } finally {
        await new Promise((resolve) => server.close(resolve));
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}
