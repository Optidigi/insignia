import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  type DurableSigningKey,
  publicKeyFingerprint,
  publicKeyFromSeed,
  SignerUnavailableError,
  type SigningKeyStore,
  sealSigningSeed,
} from '@insignia/application';
import { DOMAIN_V3, issueLineSetV3, verifyLineSetV3 } from '@insignia/cart-authorization';
import { createSignerServer, type SignerAuditEntry } from '../../worker/dist/signer/server.js';
import { createSignerClient } from '../src/server/signer-client.ts';

const scope = {
  shopId: 'synthetic-shop',
  installationGeneration: '1',
  authorizationGeneration: '11111111-1111-4111-8111-111111111111',
  authorizationEpoch: 3,
};
const today = Math.floor(Date.now() / 86_400_000);
const ring = { currentKeyId: 'signing-test', keys: { 'signing-test': randomBytes(32) } };

function memoryStore(): SigningKeyStore & { rows: DurableSigningKey[] } {
  const seed = randomBytes(32);
  const publicKey = publicKeyFromSeed(seed);
  const rows: DurableSigningKey[] = [
    {
      ...scope,
      id: 7,
      keyId: 7,
      state: 'active',
      publicKey,
      publicKeyFingerprint: publicKeyFingerprint(publicKey),
      firstDay: today - 10,
      lastDay: 0x7fffffff,
      privateEnvelope: sealSigningSeed(ring, scope, 7, seed),
      wrappingKeyId: 'signing-test',
    },
  ];
  const unexpected = async () => {
    throw new Error('unexpected');
  };
  return {
    rows,
    async getActiveScope() {
      return scope;
    },
    async list(target) {
      if (JSON.stringify(target) !== JSON.stringify(scope)) throw new Error('Stale authorization identity');
      return rows;
    },
    async createPending(input) {
      rows.push({ ...input, ...input.scope, id: input.keyId, state: 'pending' });
    },
    activate: unexpected,
    scheduleRetirement: unexpected,
    rewrap: unexpected,
    revoke: unexpected,
    destroy: unexpected,
    destroyInactiveInstallationKeys: unexpected,
    incrementEpoch: unexpected,
  };
}

async function harness(limits?: Parameters<typeof createSignerServer>[0]['limits']) {
  const directory = await mkdtemp(join(tmpdir(), 'insignia-signer-contract-'));
  const socketPath = join(directory, 'signer.sock');
  const store = memoryStore();
  const audit: SignerAuditEntry[] = [];
  const server = createSignerServer({ store, ring, audit: (entry) => audit.push(entry), limits });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return {
    store,
    audit,
    socketPath,
    client: createSignerClient({ socketPath }),
    raw(path: string, body: string, method = 'POST') {
      return new Promise<{ status: number; body: string }>((resolve, reject) => {
        const call = request(
          { socketPath, path, method, headers: { 'Content-Type': 'application/json' } },
          (response) => {
            let text = '';
            response.on('data', (chunk) => {
              text += chunk;
            });
            response.on('end', () => resolve({ status: response.statusCode ?? 0, body: text }));
          },
        );
        call.on('error', reject);
        call.end(body);
      });
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
function claims(overrides: Record<string, unknown> = {}) {
  return {
    keyId: 7,
    generationHex: scope.authorizationGeneration.replaceAll('-', ''),
    epoch: scope.authorizationEpoch,
    quoteHex: randomUUID().replaceAll('-', ''),
    setHex: randomUUID().replaceAll('-', ''),
    currency: 'USD',
    exponent: 2,
    country: 'US',
    marketId: '1',
    validThroughDay: today + 2,
    ...overrides,
  };
}

test('signer contract: a v3 header for the active key is signed and verifies under its public key', async () => {
  const h = await harness();
  try {
    const issued = await issueLineSetV3(
      claims(),
      [{ index: 0, variantId: '42', unitMinor: '1745' }],
      today,
      h.client.authorizationSigner(scope),
    );
    const key = h.store.rows[0];
    assert.ok(key);
    assert.equal(issued.keyId, 7);
    assert.equal(issued.publicKeyFingerprint, key.publicKeyFingerprint);
    assert.equal(verifyLineSetV3(issued.carriers, key.publicKey).header.keyId, 7);
    assert.deepEqual(
      h.audit.map(({ event, outcome, keyId }) => ({ event, outcome, keyId })),
      [{ event: 'sign', outcome: 'ok', keyId: 7 }],
    );
    for (const entry of h.audit)
      assert.deepEqual(
        Object.keys(entry).filter(
          (k) => !['event', 'outcome', 'shopId', 'installationGeneration', 'keyId', 'ms'].includes(k),
        ),
        [],
      );
  } finally {
    await h.close();
  }
});

test('signer contract: only exact v3 headers matching scope, key and day are signed', async () => {
  const h = await harness();
  try {
    const sign = (message: Buffer, extra: Record<string, unknown> = {}) =>
      h.raw(
        '/v1/sign',
        JSON.stringify({
          version: 1,
          scope,
          keyId: 7,
          issuanceDay: today,
          message: message.toString('base64url'),
          ...extra,
        }),
      );
    // Arbitrary bytes, a v2 domain and a bare header are refused.
    for (const message of [
      randomBytes(147),
      Buffer.concat([Buffer.from('Insignia\0WholeQuote\0v2\0'), randomBytes(113)]),
    ])
      assert.equal((await sign(message)).status, 400);
    // A header for another key, generation, epoch or expiry is refused.
    const signer = h.client.authorizationSigner(scope);
    for (const [override, day] of [
      [{ keyId: 8 }, today],
      [{ epoch: 4 }, today],
      [{ generationHex: '2'.repeat(32) }, today],
      [{ validThroughDay: today + 2 }, today + 5],
    ] as const) {
      let captured: Buffer | undefined;
      await issueLineSetV3(
        claims({ ...override, validThroughDay: day + 2 }),
        [{ index: 0, variantId: '42', unitMinor: '1' }],
        day,
        {
          async signWholeQuote(input) {
            captured = Buffer.from(input.message);
            throw new Error('captured');
          },
        },
      ).catch(() => {});
      if (!captured?.subarray(0, DOMAIN_V3.length).equals(DOMAIN_V3)) throw new Error('header not captured');
      const status = (await sign(captured, { keyId: (override as { keyId?: number }).keyId ?? 7, issuanceDay: day }))
        .status;
      assert.ok([400, 409].includes(status), `refused ${JSON.stringify(override)}: ${status}`);
    }
    // Unknown fields, wrong method/path and non-JSON bodies are refused.
    assert.equal((await h.raw('/v1/sign', '{"version":1}')).status, 400);
    assert.equal((await h.raw('/v1/other', '{}')).status, 404);
    assert.equal((await h.raw('/v1/sign', 'not json')).status, 400);
    assert.equal((await h.raw('/health', '', 'GET')).status, 200);
    // A retired key is never used, even with a valid header.
    const key = h.store.rows[0];
    assert.ok(key);
    key.state = 'retiring';
    await assert.rejects(
      issueLineSetV3(claims(), [{ index: 0, variantId: '42', unitMinor: '1' }], today, signer),
      (error: unknown) => error instanceof SignerUnavailableError && error.code === 'KEY_UNAVAILABLE',
    );
  } finally {
    await h.close();
  }
});

test('signer contract: rate limits refuse with a retryable error and a stopped signer fails closed', async () => {
  const h = await harness({ signBurst: 0, signPerMinute: 2 });
  try {
    const sign = () =>
      issueLineSetV3(
        claims(),
        [{ index: 0, variantId: '42', unitMinor: '1' }],
        today,
        h.client.authorizationSigner(scope),
      );
    await sign();
    await sign();
    await assert.rejects(
      sign(),
      (error: unknown) => error instanceof SignerUnavailableError && error.code === 'RATE_LIMITED' && error.retryable,
    );
    assert.ok(h.audit.some((entry) => entry.outcome === 'rate_limited'));
  } finally {
    await h.close();
  }
  await assert.rejects(
    issueLineSetV3(
      claims(),
      [{ index: 0, variantId: '42', unitMinor: '1' }],
      today,
      h.client.authorizationSigner(scope),
    ),
    (error: unknown) => error instanceof SignerUnavailableError && error.code === 'TRANSPORT',
  );
});

test('signer contract: provisioning returns only the public half', async () => {
  const h = await harness();
  try {
    const created = await h.client.provision({ version: 1, scope, keyId: 9, firstDay: today, lastDay: 0x7fffffff });
    assert.deepEqual(Object.keys(created).sort(), ['keyId', 'publicKeyFingerprint', 'publicKeyHex']);
    const row = h.store.rows.find((candidate) => candidate.id === 9);
    assert.equal(row?.state, 'pending');
    assert.equal(Buffer.from(row?.publicKey ?? []).toString('hex'), created.publicKeyHex);
    assert.equal(row?.wrappingKeyId, 'signing-test');
    await assert.rejects(
      h.client.provision({
        version: 1,
        scope: { ...scope, authorizationEpoch: 4 },
        keyId: 10,
        firstDay: today,
        lastDay: today,
      }),
      SignerUnavailableError,
    );
  } finally {
    await h.close();
  }
});
