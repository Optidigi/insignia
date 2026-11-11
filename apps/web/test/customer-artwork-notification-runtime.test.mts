import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadCustomerEmailQualification } from '../src/server/customer-artwork/notification-qualification.ts';
import { createCustomerArtworkNotificationRunner } from '../src/server/customer-artwork/notification-runner.ts';
import { ensureCustomerArtworkNotificationRuntime } from '../src/server/customer-artwork/notification-runtime.ts';

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
