import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createReleaseVerificationClient } from '../../apps/web/src/server/admin/release-verification.ts';
import proxyModules from '../../deployment/m8-journey/app-proxy-module-baseline.json' with { type: 'json' };
import historicalM8Modules from '../../deployment/m8-journey/release-module-baseline.json' with { type: 'json' };
import themeModules from '../../deployment/m8-journey/theme-module-baseline.json' with { type: 'json' };
import { qualifyReleaseAppendInput } from './release-append.mjs';
import { createReleaseVerificationServer } from './release-verification-server.mjs';
import { collectFreshTrustedRelease } from './trusted-release-collector.mjs';
import { fixture } from './trusted-release-collector-fixture.mjs';
import { runManagementReads } from './trusted-release-management-worker.mjs';
import { createOwnerHttps } from './trusted-release-owner-https.mjs';

for (const profile of ['m8-read-orders-617057f', 'm8-app-proxy-3d2a02e', 'm8-theme-c8d8713']) {
  const theme = profile === 'm8-theme-c8d8713';
  const proxy = profile !== 'm8-read-orders-617057f';
  const versionId = theme ? '1166552825857' : proxy ? '1166090010625' : '1165513097217';
  const modules = theme ? themeModules : proxy ? proxyModules : historicalM8Modules;
  const profileTest = (name, fn) => test(`${profile}: ${name}`, fn);
  const prior = (versions) =>
    proxy
      ? [
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
        const input = f.input ?? {
          recordId: f.config.recordId,
          operator: f.config.operator,
          activeObservation: { observedAt: new Date(time).toISOString(), versions: [] },
          moduleObservation: {},
          readiness: {},
        };
        const opening = await f.ports.management.open(async () => ({ durable: true }));
        const binding = await f.ports.readTenant();
        input.activeObservation = {
          observedAt: new Date(time).toISOString(),
          versions: [
            { versionId: `gid://shopify/Version/${versionId}`, versionTag: profile, status: 'active' },
            ...prior(opening.versions).map((v) => ({ ...v, status: 'inactive' })),
          ],
        };
        input.moduleObservation = {
          ...opening.moduleObservation,
          versionId: versionId,
          versionTag: profile,
          observedAt: new Date(time).toISOString(),
          modules: structuredClone(modules),
        };
        input.readiness = {
          version: 'm5-admin-technical-readiness-v1',
          shop: binding.shop,
          tenantShopId: binding.tenantShopId,
          installationGeneration: binding.installationGeneration,
          shopId: binding.shopId,
          externalInstallationId: binding.externalInstallationId,
          functions: await f.ports.readFunctions('synthetic', binding),
        };
        assert.equal(qualifyReleaseAppendInput(input, time, profile).expected.appVersionRef, versionId);
        const inactive = structuredClone(input);
        inactive.activeObservation.versions[0].status = 'inactive';
        inactive.activeObservation.versions[1].status = 'active';
        assert.throws(() => qualifyReleaseAppendInput(inactive, time, profile));
        const drift = structuredClone(input);
        drift.moduleObservation.modules
          .find((m) => m.handle === 'app_access')
          .config.optional_scopes.push('write_orders');
        assert.throws(() => qualifyReleaseAppendInput(drift, time, profile));
        const foreign = structuredClone(input);
        foreign.activeObservation.versions[1].versionId = 'gid://shopify/Version/999';
        assert.throws(() => qualifyReleaseAppendInput(foreign, time, profile));
        if (theme) {
          const missingTheme = structuredClone(input);
          missingTheme.moduleObservation.modules = missingTheme.moduleObservation.modules.filter(
            (m) => m.type !== 'theme_app_extension',
          );
          assert.throws(() => qualifyReleaseAppendInput(missingTheme, time, profile));
          const changedTheme = structuredClone(input);
          changedTheme.moduleObservation.modules.find((m) => m.type === 'theme_app_extension').registrationUuid =
            'foreign';
          assert.throws(() => qualifyReleaseAppendInput(changedTheme, time, profile));
        }
        if (proxy) {
          const changedProxy = structuredClone(input);
          changedProxy.moduleObservation.modules.find((m) => m.handle === 'app_proxy').config.url =
            'https://foreign.invalid';
          assert.throws(() => qualifyReleaseAppendInput(changedProxy, time, profile));
          const missingPrior = structuredClone(input);
          missingPrior.activeObservation.versions.splice(1, 1);
          assert.throws(() => qualifyReleaseAppendInput(missingPrior, time, profile));
          // Historical inventory is deliberately stale after a new inactive version.
          const staleHistorical = structuredClone(input);
          staleHistorical.activeObservation.versions[0].status = 'inactive';
          staleHistorical.activeObservation.versions[1].status = 'active';
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
      for (const state of ['active', 'inactive', 'missing_grant', ...(proxy ? ['missing_proxy_grant'] : [])]) {
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
              appVersions: { nodes: versions, pageInfo: { totalResults: theme ? 10 : proxy ? 9 : 8 } },
            },
          }),
          appVersionByTag: async (_remote, tag) => ({
            uuid: `gid://shopify/Version/${versionId}`,
            versionTag: tag,
            appModuleVersions: modules.map(({ handle, ...m }) => ({ ...m, registrationTitle: handle })),
          }),
        };
        let opening, closing, running, releaseClose, openingReady, currentReserve;
        const opened = new Promise((resolve) => {
          openingReady = resolve;
        });
        const closeSignal = new Promise((resolve) => {
          releaseClose = resolve;
        });
        const originalInstallation = f.ports.readInstallation;
        f.ports.management = {
          authenticate: async () => {},
          open: async (reserve) => {
            currentReserve = reserve;
            running = runManagementReads({
              client: sdk,
              profileName: profile,
              reserve: (op) => currentReserve(op),
              send: async (kind, value) => {
                if (kind === 'OPEN') {
                  opening = value;
                  openingReady();
                } else closing = value;
              },
              waitClose: () => closeSignal,
              now: () => new Date(time).toISOString(),
            });
            await Promise.race([opened, running]);
            return opening;
          },
          close: async (reserve) => {
            currentReserve = reserve;
            releaseClose();
            await running;
            return closing;
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
                  : [...value.grants, 'read_orders', ...(proxy ? ['read_app_proxy', 'write_app_proxy'] : [])],
          };
        };
        f.ports.append = async (input) => {
          qualifyReleaseAppendInput(input, time, profile);
          appended++;
          return {
            classification: 'TRUSTED_RELEASE_APPEND_ACK_RUNTIME_QUALIFIED',
            recordId: input.recordId,
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
          await running?.catch(() => {});
          await f.close();
        }
      }
    },
  );

  profileTest('M8 OAuth readback requires read_orders and refuses scope widening without retry', async () => {
    const granted = proxy ? ',read_orders,read_app_proxy,write_app_proxy' : ',read_orders';
    for (const extra of ['', granted, `${granted},write_orders`, ...(proxy ? [',read_orders'] : [])]) {
      let requests = 0;
      const provider = createOwnerHttps({
        profileName: profile,
        functionQuery: 'query Fixed { shop { id } }',
        now: () => 0,
        deadline: 300000,
        request(_url, _options, callback) {
          requests++;
          const req = new EventEmitter();
          req.destroy = () => {};
          req.end = () =>
            queueMicrotask(() => {
              const res = new EventEmitter();
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
      await new Promise((resolve) => server.listen(socket, resolve));
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
