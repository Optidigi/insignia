import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type CustomerArtworkEmailProfile,
  createCloudflareCustomerArtworkSender,
} from '../src/customer-artwork-email.ts';

const profile: CustomerArtworkEmailProfile = {
  version: 'cloudflare-customer-artwork-email-v1',
  accountId: 'a'.repeat(32),
  apiToken: 'synthetic-email-test-only',
  from: 'noreply@optidigi.nl',
  appOrigin: 'https://insignia.test',
  mode: 'development',
};
const message = {
  idempotencyKey: '4ae66163-79b4-48fa-a8c6-f84b22c30f01',
  recipient: 'admin@optidigi.nl',
  artworkUrl: `https://insignia.test/artwork-upload#capability=${'b'.repeat(64)}`,
  expiresAt: '2026-11-06T12:00:00.000Z',
};
const clock = () => new Date('2026-11-05T12:00:00Z');
test('scoped development sender permits only explicit admin test and parses actual provider acknowledgement', async () => {
  let request: RequestInit | undefined;
  const sender = createCloudflareCustomerArtworkSender({
    profile,
    clock,
    fetchImpl: async (url, init) => {
      assert.equal(
        String(url),
        `https://api.cloudflare.com/client/v4/accounts/${profile.accountId}/email/sending/send`,
      );
      request = init;
      return Response.json({
        success: true,
        result: {
          message_id: '<message-1@optidigi.nl>',
          delivered: ['admin@optidigi.nl'],
          queued: [],
          permanent_bounces: [],
          suppressed_recipients: [],
        },
        errors: [],
        messages: [],
      });
    },
  });
  assert.deepEqual(await sender.send(message), { kind: 'sent', receipt: '<message-1@optidigi.nl>' });
  const body = JSON.parse(String(request?.body));
  assert.equal(body.from, 'noreply@optidigi.nl');
  assert.equal(body.to, 'admin@optidigi.nl');
  assert.match(body.subject, /development/);
  assert.equal(body.headers['X-Insignia-Notification'], message.idempotencyKey);
  request = undefined;
  assert.deepEqual(await sender.send({ ...message, recipient: 'customer@example.test' }), { kind: 'no-effect' });
  assert.equal(request, undefined);
});
test('unknown gateway/transport failures remain uncertain, documented no-effect denial may be retried by durable policy', async () => {
  const failed = createCloudflareCustomerArtworkSender({
    profile,
    clock,
    fetchImpl: async () => {
      throw new Error('timeout after provider may accept');
    },
  });
  assert.deepEqual(await failed.send(message), { kind: 'uncertain' });
  const gateway = createCloudflareCustomerArtworkSender({
    profile,
    clock,
    fetchImpl: async () => new Response('upstream unavailable', { status: 500 }),
  });
  assert.deepEqual(await gateway.send(message), { kind: 'uncertain' });
  const internal = createCloudflareCustomerArtworkSender({
    profile,
    clock,
    fetchImpl: async () =>
      Response.json(
        { success: false, result: null, errors: [{ message: 'email.sending.error.internal_server' }] },
        { status: 500 },
      ),
  });
  assert.deepEqual(await internal.send(message), { kind: 'uncertain' });
  const denied = createCloudflareCustomerArtworkSender({
    profile,
    clock,
    fetchImpl: async () =>
      Response.json(
        {
          success: false,
          result: null,
          errors: [{ message: 'email.sending.error.email.sending_disabled' }],
          messages: [],
        },
        { status: 403 },
      ),
  });
  assert.deepEqual(await denied.send(message), { kind: 'no-effect' });
});
test('customer sending requires a separately supplied qualification port and rejects foreign upload origins', async () => {
  assert.throws(
    () => createCloudflareCustomerArtworkSender({ profile: { ...profile, mode: 'customer' }, clock }),
    /QUALIFICATION_REQUIRED/,
  );
  const sender = createCloudflareCustomerArtworkSender({
    profile,
    clock,
    fetchImpl: async () => {
      throw new Error('must not dispatch');
    },
  });
  assert.deepEqual(
    await sender.send({ ...message, artworkUrl: message.artworkUrl.replace('insignia.test', 'attacker.test') }),
    { kind: 'no-effect' },
  );
});

test('sender profile loader requires private regular custody and actual account/app binding', async (t) => {
  const { mkdtemp, writeFile, chmod, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { loadCustomerArtworkEmailProfile } = await import('../src/customer-artwork-email-profile.ts');
  const directory = await mkdtemp(join(tmpdir(), 'insignia-email-profile-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'sender.json');
  await writeFile(file, JSON.stringify(profile), { mode: 0o600 });
  assert.deepEqual(
    await loadCustomerArtworkEmailProfile(file, { appOrigin: profile.appOrigin, accountId: profile.accountId }),
    profile,
  );
  await assert.rejects(
    loadCustomerArtworkEmailProfile(file, { appOrigin: 'https://another.test' }),
    /PROFILE_UNAVAILABLE/,
  );
  await chmod(file, 0o644);
  await assert.rejects(loadCustomerArtworkEmailProfile(file, { appOrigin: profile.appOrigin }), /PROFILE_UNAVAILABLE/);
});

test('customer dispatch rechecks the exact notice tenant against the current grant immediately before POST', async () => {
  const allowed = new Set(['shop-a:1', 'shop-b:1']);
  let posts = 0;
  const sender = createCloudflareCustomerArtworkSender({
    profile: { ...profile, mode: 'customer' },
    clock,
    assertCustomerSending: async (scope) => {
      if (!allowed.has(`${scope.shopId}:${scope.installationGeneration}`)) throw new Error('Tenant grant revoked');
    },
    fetchImpl: async () => {
      posts++;
      return Response.json({
        success: true,
        result: { message_id: 'provider-scope-proof', delivered: [], queued: ['buyer@example.test'] },
      });
    },
  });
  // The profile remains otherwise valid forB afterA was selected/read earlier.
  allowed.delete('shop-a:1');
  {
    const outcome = await sender.send({
      ...message,
      recipient: 'buyer@example.test',
      tenantScope: { shopId: 'shop-a', installationGeneration: '1' },
    });
    assert.deepEqual(outcome, { kind: 'no-effect' });
  }
  assert.equal(posts, 0);
  assert.deepEqual(
    await sender.send({
      ...message,
      recipient: 'buyer@example.test',
      tenantScope: { shopId: 'shop-b', installationGeneration: '1' },
    }),
    { kind: 'sent', receipt: 'provider-scope-proof' },
  );
  assert.equal(posts, 1);
});
