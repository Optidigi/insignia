import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  ALL_ACTIVE_INSTALLATIONS,
  inQualifiedScope,
  loadCustomerEmailQualification,
} from '../src/server/customer-artwork/notification-qualification.ts';
import { createCustomerArtworkNotificationRunner } from '../src/server/customer-artwork/notification-runner.ts';
import {
  developmentNoticeEligibility,
  ensureCustomerArtworkNotificationRuntime,
} from '../src/server/customer-artwork/notification-runtime.ts';

test('missing explicit notification profile is disabled without allocating a sender/core or timer', async () => {
  assert.deepEqual(await ensureCustomerArtworkNotificationRuntime({}), { state: 'disabled' });
  assert.deepEqual(await ensureCustomerArtworkNotificationRuntime({ INSIGNIA_CUSTOMER_EMAIL_ENABLED: '1' }), {
    state: 'disabled',
  });
});
test('bounded runOnce coalesces concurrent drains, stops in-flight authority and never starts after stop', async () => {
  let calls = 0,
    closes = 0;
  let release: (() => void) | undefined;
  let signal: AbortSignal | undefined;
  const runner = createCustomerArtworkNotificationRunner({
    deliver: async (active) => {
      calls++;
      signal = active;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { sent: 1 };
    },
    close: async () => {
      closes++;
    },
    intervalMs: 1000,
  });
  const first = runner.runOnce(),
    second = runner.runOnce();
  await Promise.resolve();
  assert.equal(calls, 1);
  const stopping = runner.stop();
  assert.equal(signal?.aborted, true);
  assert(release);
  release();
  await stopping;
  assert.equal((await first).sent, 1);
  assert.equal((await second).sent, 1);
  assert.equal(closes, 1);
  assert.deepEqual(await runner.runOnce(), { state: 'stopped', sent: 0 });
  assert.equal(calls, 1);
});
test('failed delivery stays unavailable and can recover on a new bounded drain without fabricated success', async () => {
  let attempts = 0;
  const runner = createCustomerArtworkNotificationRunner({
    deliver: async () => {
      if (++attempts === 1) throw new Error('recipient access unavailable');
      return { sent: 0 };
    },
  });
  assert.deepEqual(await runner.runOnce(), { state: 'unavailable', sent: 0 });
  assert.deepEqual(await runner.runOnce(), { state: 'ready', sent: 0 });
  await runner.stop();
});
test('customer qualification is a durable reviewed private grant with exact binding and genuine optional expiry', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'customer-email-qualification-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'qualification.json');
  const profile = {
    version: 'customer-artwork-email-qualification-v1',
    accountId: 'a'.repeat(32),
    appOrigin: 'https://insignia.test',
    sender: 'noreply@insigniacustomizer.com',
    arbitraryRecipients: true,
    protectedOrderEmail: true,
    qualifiedAt: '2026-11-05T12:00:00Z',
    expiresAt: '2026-11-05T13:00:00Z',
    providerEvidenceRef: 'owned/provider-proof',
    recipientEvidenceRef: 'owned/recipient-proof',
    tenantScopes: [{ shopId: 'shop', installationGeneration: '1', appClientId: 'app' }],
  };
  await writeFile(file, JSON.stringify(profile), { mode: 0o600 });
  const expected = { accountId: profile.accountId, appOrigin: profile.appOrigin, appClientId: 'app' };
  assert.equal(
    (await loadCustomerEmailQualification(file, expected, () => new Date('2026-11-05T12:30:00Z'))).tenantScopes[0]
      ?.shopId,
    'shop',
  );
  await assert.rejects(
    loadCustomerEmailQualification(
      file,
      { ...expected, accountId: 'b'.repeat(32) },
      () => new Date('2026-11-05T12:30:00Z'),
    ),
    /QUALIFICATION_UNAVAILABLE/,
  );
  await assert.rejects(
    loadCustomerEmailQualification(file, expected, () => new Date('2026-11-05T14:00:00Z')),
    /QUALIFICATION_UNAVAILABLE/,
  );
  const { expiresAt: _expiry, ...durable } = profile;
  await writeFile(file, JSON.stringify(durable), { mode: 0o600 });
  assert.equal(
    (await loadCustomerEmailQualification(file, expected, () => new Date('2026-12-05T12:30:00Z'))).tenantScopes[0]
      ?.shopId,
    'shop',
  );
});

test('known unavailable pending delivery reports an alert without losing known successful send count', async () => {
  let alerts = 0;
  const runner = createCustomerArtworkNotificationRunner({
    deliver: async () => ({ sent: 1, unavailable: true }),
    onUnavailable: () => {
      alerts++;
    },
  });
  assert.deepEqual(await runner.runOnce(), { state: 'unavailable', sent: 1 });
  assert.equal(alerts, 1);
  await runner.stop();
});

test('development eligibility is default deny, never backfills before its cut-off and validates input', () => {
  assert.equal(developmentNoticeEligibility({}), undefined);
  assert.equal(developmentNoticeEligibility({ INSIGNIA_CUSTOMER_EMAIL_DEVELOPMENT_NOTICES: '[]' }), undefined);
  const id = '4da55deb-2f17-45ee-b89f-380936d95808';
  const since = '2026-11-11T23:00:00.000Z';
  const eligible = developmentNoticeEligibility({
    INSIGNIA_CUSTOMER_EMAIL_DEVELOPMENT_SINCE: since,
    INSIGNIA_CUSTOMER_EMAIL_DEVELOPMENT_NOTICES: JSON.stringify([id]),
  });
  assert.ok(eligible);
  const other = '11111111-1111-4111-8111-111111111111';
  assert.equal(eligible({ notificationId: other, createdAt: new Date('2026-11-11T22:59:59.999Z') }), false);
  assert.equal(eligible({ notificationId: other, createdAt: new Date(since) }), true);
  assert.equal(eligible({ notificationId: other }), false);
  assert.equal(eligible({ notificationId: id, createdAt: new Date('2026-11-10T00:00:00.000Z') }), true);
  for (const bad of ['2026-11-11', 'yesterday', '2026-11-11T23:00:00Z', ''])
    assert.throws(() => developmentNoticeEligibility({ INSIGNIA_CUSTOMER_EMAIL_DEVELOPMENT_SINCE: bad }));
  assert.throws(() => developmentNoticeEligibility({ INSIGNIA_CUSTOMER_EMAIL_DEVELOPMENT_NOTICES: '["x"]' }));
});

test('a public-app grant may cover all active installations, by that exact value only', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'customer-email-all-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'qualification.json');
  const base = {
    version: 'customer-artwork-email-qualification-v1',
    accountId: 'a'.repeat(32),
    appOrigin: 'https://insignia.test',
    sender: 'noreply@insigniacustomizer.com',
    arbitraryRecipients: true,
    protectedOrderEmail: true,
    qualifiedAt: '2026-11-05T12:00:00Z',
    providerEvidenceRef: 'owned/provider-proof',
    recipientEvidenceRef: 'owned/recipient-proof',
  };
  const expected = { accountId: base.accountId, appOrigin: base.appOrigin, appClientId: 'app' };
  const now = () => new Date('2026-11-16T12:00:00Z');
  await writeFile(file, JSON.stringify({ ...base, tenantScopes: ALL_ACTIVE_INSTALLATIONS }), { mode: 0o600 });
  const all = await loadCustomerEmailQualification(file, expected, now);
  assert.equal(all.allActiveInstallations, true);
  assert.deepEqual(all.tenantScopes, []);
  for (const tenantScopes of ['all', 'ALL-ACTIVE-INSTALLATIONS', ' all-active-installations', '', [], null, {}]) {
    await writeFile(file, JSON.stringify({ ...base, tenantScopes }), { mode: 0o600 });
    await assert.rejects(loadCustomerEmailQualification(file, expected, now), /QUALIFICATION_UNAVAILABLE/);
  }
  // The other required evidence fields stay required in this mode.
  const { providerEvidenceRef: _p, ...withoutEvidence } = base;
  await writeFile(file, JSON.stringify({ ...withoutEvidence, tenantScopes: ALL_ACTIVE_INSTALLATIONS }), {
    mode: 0o600,
  });
  await assert.rejects(loadCustomerEmailQualification(file, expected, now), /QUALIFICATION_UNAVAILABLE/);
  // An explicit list still binds every entry to this app's client id.
  await writeFile(
    file,
    JSON.stringify({ ...base, tenantScopes: [{ shopId: 'shop', installationGeneration: '1', appClientId: 'other' }] }),
    { mode: 0o600 },
  );
  await assert.rejects(loadCustomerEmailQualification(file, expected, now), /QUALIFICATION_UNAVAILABLE/);
});

test('both grant modes send only to the current, active installation generation', async () => {
  const active = new Set(['shop-a:2', 'shop-b:1']);
  const isActive = async (scope: { shopId: string; installationGeneration: string }) =>
    active.has(`${scope.shopId}:${scope.installationGeneration}`);
  const all = { allActiveInstallations: true, tenantScopes: [] };
  assert.equal(await inQualifiedScope(all, { shopId: 'shop-a', installationGeneration: '2' }, isActive), true);
  assert.equal(await inQualifiedScope(all, { shopId: 'shop-b', installationGeneration: '1' }, isActive), true);
  // Reinstalled (old generation) and uninstalled or unknown shops are out of scope.
  assert.equal(await inQualifiedScope(all, { shopId: 'shop-a', installationGeneration: '1' }, isActive), false);
  assert.equal(await inQualifiedScope(all, { shopId: 'shop-c', installationGeneration: '1' }, isActive), false);
  const listed = {
    allActiveInstallations: false,
    tenantScopes: [{ shopId: 'shop-a', installationGeneration: '2', appClientId: 'app' }],
  };
  assert.equal(await inQualifiedScope(listed, { shopId: 'shop-a', installationGeneration: '2' }, isActive), true);
  // Explicit mode: an active but unlisted installation stays out, as before.
  assert.equal(await inQualifiedScope(listed, { shopId: 'shop-b', installationGeneration: '1' }, isActive), false);
  // A listed generation that is no longer active is out too (same fencing as the public mode).
  assert.equal(
    await inQualifiedScope(listed, { shopId: 'shop-a', installationGeneration: '2' }, async () => false),
    false,
  );
});
