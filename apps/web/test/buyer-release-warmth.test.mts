import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertProductionFunctionArtifactReady } from '../../../packages/application/src/keys/artifact-attestation.ts';
import { RELEASE_REFRESH_LEAD_MS } from '../src/server/admin/release-verification.ts';
import { createBuyerBootstrap } from '../src/server/buyer/bootstrap.ts';
import { RELEASE_FRESHNESS_MS, RELEASE_REFRESH_AFTER_MS } from '../src/server/buyer/release-refresh.ts';
import { buyerFixture, coreFixture, releaseEvidenceFixture, required } from './http-fixtures.mts';

/**
 * Model of buyer acceptance against the background release refresh (#345). It runs the real buyer
 * bootstrap (refresher, demand-driven reader, single-flight collection and refresh-ahead read) on a
 * simulated clock. Two pieces are modeled from their sources:
 * - stored records follow `trusted_release_records` reads: the newest record is fresh while its
 *   closing Active-version observation is at most 30 s old and before its attestation `expiresAt`
 *   (the earliest of its observations + 30 s);
 * - the verifier receiver (`scripts/release/server.mts`) first answers with a stored
 *   record that is fresh at `now + reuseLeadMs`, and otherwise collects once per binding.
 * Collection timing comes from deployed receipts: the earliest (module) observation comes about 1.7 s
 * before the closing one, and a collection lands about 4.6 s after it starts.
 */
const EARLIEST_MS = 2_600,
  CLOSING_MS = 4_300,
  COLLECTION_MS = 4_600;
const scope = { shopId: 'tenant', installationGeneration: '1', appClientId: 'synthetic-app' };

function environment() {
  return {
    INSIGNIA_M7_BUYER_ENABLED: '1',
    DATABASE_URL: 'postgres://synthetic:synthetic@127.0.0.1:58197/synthetic_m7',
    SHOPIFY_CLIENT_ID: 'synthetic-app',
    SHOPIFY_CLIENT_SECRET: 'synthetic-private-secret',
    APP_URL: 'https://app.invalid',
    ARTWORK_PROXY_PATH_PREFIX: '/apps/insignia',
    INSIGNIA_SHOPIFY_APP_ID: '7',
    INSIGNIA_CREDENTIAL_KEY_ID: 'synthetic',
    INSIGNIA_CREDENTIAL_KEY_BASE64: Buffer.alloc(32, 1).toString('base64'),
    INSIGNIA_PARTNER_ORGANIZATION_ID: '9',
    INSIGNIA_PARTNER_ACCESS_TOKEN: 'synthetic-partner-token',
    INSIGNIA_M5_ENTITLEMENT_POLICY_JSON: JSON.stringify({
      policyVersion: 'synthetic-policy',
      maxAgeMs: 300000,
      plans: [{ planHandle: 'flat', billing: 'recurring-only', policyId: 'policy', features: ['base'] }],
    }),
    INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON: JSON.stringify({ appKey: 'synthetic-app' }),
  };
}

/** Deterministic PRNG so every run samples the same buyer timeline. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

type Acceptance = { at: number; waitMs: number; collected: boolean; signable: (signAt: number) => boolean };

async function simulate(options: { reuseLeadMs: number; flows: number; seed: number }) {
  let now = Date.parse('2026-11-12T01:00:00.000Z');
  const start = now;
  const queue: { at: number; run: () => void }[] = [];
  const setTimer = (run: () => void, delayMs: number) => {
    const timer = { at: now + Math.max(0, delayMs), run };
    queue.push(timer);
    return timer;
  };
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimer(resolve, ms));
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
  };
  async function runUntil(end: number) {
    await settle();
    for (;;) {
      queue.sort((a, b) => a.at - b.at);
      const next = queue[0];
      if (!next || next.at > end) break;
      queue.shift();
      now = Math.max(now, next.at);
      next.run();
      await settle();
    }
    now = end;
  }

  type Stored = { recordId: string; earliest: number; closing: number };
  const records: Stored[] = [];
  const template = releaseEvidenceFixture();
  const evidence = (record: Stored) => ({
    ...template,
    record: {
      ...template.record,
      recordId: record.recordId,
      attestation: {
        ...template.record.attestation,
        observedAt: new Date(record.closing).toISOString(),
        targetObservedAt: new Date(record.earliest).toISOString(),
        expiresAt: new Date(record.earliest + 30_000).toISOString(),
      },
    },
  });
  /** `trusted_release_records` freshness at a given instant (packages/database trusted-release.ts). */
  const readStored = (at: number) => {
    const latest = records.at(-1);
    if (!latest) return null;
    const age = at - latest.closing;
    if (age < 0 || age > 30_000 || at >= latest.earliest + 30_000) return null;
    return evidence(latest);
  };

  let collections = 0,
    sequence = 0;
  const collecting = new Map<string, Promise<string>>();
  const core = coreFixture({
    tenants: {
      getActiveProviderScope: async (target) => ({
        ...target,
        shopDomain: 'owned.myshopify.com',
        shopifyShopId: '11',
      }),
      getActiveAuthorizationScope: async (target) => ({
        ...target,
        shopDomain: 'owned.myshopify.com',
        shopifyShopId: '11',
        authorizationGeneration: '11111111-1111-4111-8111-111111111111',
        authorizationEpoch: 0,
      }),
      getManagedInstallationState: async () => ({
        active: true,
        shopDomain: 'owned.myshopify.com',
        shopifyShopId: '11',
        shopId: 'tenant',
        currentGeneration: '1',
        externalInstallationId: 'gid://shopify/AppInstallation/12',
      }),
    },
    credentials: {
      acquire: async () => ({
        kind: 'usable',
        accessToken: 'synthetic-offline-token',
        accessExpiresAt: new Date(start + 86_400_000),
      }),
      install: async () => 'synthetic-version',
      replaceClaim: async () => 'replaced',
      releaseClaim: async () => true,
      markReauthRequired: async () => true,
    },
    trustedReleaseRecords: { read: async (target) => readStored(+target.now) },
  });
  let composition:
    | Parameters<NonNullable<NonNullable<Parameters<typeof createBuyerBootstrap>[1]>['createServices']>>[0]
    | undefined;
  await createBuyerBootstrap(environment(), {
    clock: () => new Date(now),
    createCore: () => core,
    createServices: (input) => {
      composition = input;
      return buyerFixture({});
    },
    releaseRefreshTimer: setTimer,
    releaseCollector: {
      async collect(request) {
        // Receiver: answer with a stored record that is fresh at the reuse instant, else collect once.
        const existing = readStored(now + options.reuseLeadMs);
        if (existing) return { requestId: request.requestId, recordId: existing.record.recordId, state: 'COMPLETE' };
        const key = JSON.stringify(request.binding);
        let active = collecting.get(key);
        if (!active) {
          active = (async () => {
            collections++;
            const begun = now;
            await sleep(EARLIEST_MS);
            const earliest = now;
            await sleep(CLOSING_MS - EARLIEST_MS);
            const closing = now;
            await sleep(COLLECTION_MS - CLOSING_MS);
            const recordId = `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
            assert.ok(now - begun >= COLLECTION_MS);
            records.push({ recordId, earliest, closing });
            return recordId;
          })();
          collecting.set(key, active);
          void active.finally(() => collecting.delete(key));
        }
        return { requestId: request.requestId, recordId: await active, state: 'COMPLETE' };
      },
    },
  });
  const input = required(composition);
  const acceptances: Acceptance[] = [];
  async function accept() {
    const at = now,
      before = collections;
    const [expectedBuild, attestation] = await Promise.all([
      input.artifactPorts.expectedBuild.read(scope),
      input.artifactPorts.trustedEvidence.read(scope),
    ]);
    acceptances.push({
      at,
      waitMs: now - at,
      collected: collections > before,
      signable: (signAt) => {
        const omitWasm = ({ wasmSha256: _wasm, ...identity }: { wasmSha256: string }) => identity;
        try {
          assertProductionFunctionArtifactReady({
            scope,
            expectedBuild,
            attestation,
            observation: {
              schemaVersion: 2,
              ...scope,
              observedAt: new Date(at).toISOString(),
              transform: omitWasm(required(expectedBuild).transform),
              validation: omitWasm(required(expectedBuild).validation),
            },
            now: new Date(signAt),
            maxObservationAgeMs: 30_000,
          });
          return true;
        } catch {
          return false;
        }
      },
    });
  }

  // QA-like buyers: a proposal (Review), then Add to cart 3–40 s later; the next flow 20–240 s on.
  const next = random(options.seed);
  for (let flow = 0; flow < options.flows; flow++) {
    required(input.releaseRefresh)({ shopId: 'tenant', installationGeneration: '1' }, new Date(now + 300_000));
    await runUntil(now + 3_000 + next() * 37_000);
    const pending = accept();
    // Acceptances are independent requests: time keeps moving while one waits on a collection.
    await runUntil(now + 10_000);
    await pending;
    await runUntil(now + 10_000 + next() * 220_000);
  }
  await input.core.close();
  return { acceptances, collections, minutes: (now - start) / 60_000 };
}

function summary(result: Awaited<ReturnType<typeof simulate>>) {
  const { acceptances } = result;
  const full = acceptances.filter((value) => value.collected).length;
  const waited = acceptances.filter((value) => value.waitMs >= 1_000).length;
  const atSigning = (delayMs: number) =>
    acceptances.filter((value) => !value.signable(value.at + value.waitMs + delayMs)).length;
  return {
    acceptances: acceptances.length,
    ownCollection: full,
    waitedOver1s: waited,
    maxWaitMs: Math.max(...acceptances.map((value) => value.waitMs)),
    expiredAtSigning300ms: atSigning(300),
    expiredAtSigning1500ms: atSigning(1_500),
    collectionsPerMinute: Number((result.collections / result.minutes).toFixed(2)),
  };
}

test('model fidelity: the pre-#345 receiver rule reproduces the stall QA measured', async (t) => {
  // QA on rewrite-dev: 9 of 26 acceptances (35%) spent ~4.9 s in readiness-observe.
  const result = summary(await simulate({ reuseLeadMs: 0, flows: 400, seed: 345 }));
  t.diagnostic(JSON.stringify(result));
  assert.ok(result.ownCollection >= 100, 'about a third of acceptances collect on their own request path');
});

test('refresh-ahead receiver: acceptance never waits for or outlives release evidence (#345)', async (t) => {
  // The receiver's reuse window covers the buyer refresh's look-ahead, so that refresh always collects.
  assert.ok(RELEASE_FRESHNESS_MS - RELEASE_REFRESH_AFTER_MS <= RELEASE_REFRESH_LEAD_MS);
  // The receiver's rule from scripts/release/server.mts (owner-boundaries test).
  const result = summary(await simulate({ reuseLeadMs: RELEASE_REFRESH_LEAD_MS, flows: 400, seed: 345 }));
  t.diagnostic(JSON.stringify(result));
  assert.equal(result.ownCollection, 0);
  assert.equal(result.waitedOver1s, 0, 'every acceptance finds a fresh record');
  assert.equal(result.expiredAtSigning1500ms, 0, 'the record read before the fence is still fresh at signing');
});
