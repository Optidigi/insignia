import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestFn } from 'node:test';
import test from 'node:test';
import { createReleaseVerificationClient } from '../../apps/web/src/server/admin/release-verification.ts';
import proxyModules from '../../deployment/m8-journey/app-proxy-module-baseline.json' with { type: 'json' };
import cookieThemeModules from '../../deployment/m8-journey/cookie-theme-module-baseline.json' with { type: 'json' };
import leanMarketsModules from '../../deployment/m8-journey/lean-markets-module-baseline.json' with { type: 'json' };
import privacyModules from '../../deployment/m8-journey/lean-privacy-module-baseline.json' with { type: 'json' };
import previewThemeModules from '../../deployment/m8-journey/preview-theme-module-baseline.json' with { type: 'json' };
import historicalM8Modules from '../../deployment/m8-journey/release-module-baseline.json' with { type: 'json' };
import themeModules from '../../deployment/m8-journey/theme-module-baseline.json' with { type: 'json' };
import type { ReleaseAppendInput } from './append.mts';
import { qualifyReleaseAppendInput } from './append.mts';
import { SyntheticOwnerRequest, SyntheticOwnerResponse } from './boundary-fixture.mts';
import type { Reservation } from './collector.mts';
import { collectFreshTrustedRelease } from './collector.mts';
import { fixture } from './collector-fixture.mts';
import type { ManagementObservation, RemoteApp } from './management-worker.mts';
import { runManagementReads } from './management-worker.mts';
import { createOwnerHttps } from './owner-https.mts';
import { createReleaseVerificationServer } from './server.mts';
import { array, object, required, text } from './validation.mts';

for (const profile of [
  'm8-read-orders-617057f',
  'm8-app-proxy-3d2a02e',
  'm8-theme-c8d8713',
  'm8-cookie-91b35ab',
  'm8-preview-28443bd',
  'lean-markets-7b17cd9',
  'lean-privacy-theme-23fd116',
]) {
  const privacy = profile === 'lean-privacy-theme-23fd116';
  const lean = privacy || profile === 'lean-markets-7b17cd9';
  const preview = lean || profile === 'm8-preview-28443bd';
  const cookie = preview || profile === 'm8-cookie-91b35ab';
  const theme = cookie || profile === 'm8-theme-c8d8713';
  const proxy = profile !== 'm8-read-orders-617057f';
  const versionId = privacy
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
  const modules = privacy
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
      const f = await fixture({ time });
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
        const f = await fixture({ time, recordId: randomUUID() });
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
            },
          }),
          appVersions: async () => ({
            app: {
              id: 'gid://shopify/App/429028933633',
              appVersions: {
                nodes: versions,
                pageInfo: {
                  totalResults: privacy ? 14 : lean ? 13 : preview ? 12 : cookie ? 11 : theme ? 10 : proxy ? 9 : 8,
                },
              },
            },
          }),
          appVersionByTag: async (_remote: RemoteApp, tag: string) => ({
            uuid: `gid://shopify/Version/${versionId}`,
            versionTag: tag,
            appModuleVersions: modules.map(({ handle, ...m }) => ({ ...m, registrationTitle: handle })),
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
