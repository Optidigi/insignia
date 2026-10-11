import assert from 'node:assert/strict';
import test from 'node:test';
import { signingOwnerRequest } from '../../src/shared/signing-owner-request.ts';

const reply = {
  version: 'm5-signing-owner-action-v1',
  state: 'PENDING',
  actionAvailable: false,
  retryAuthorized: false,
  quoteIssuanceAuthorized: false,
};
test('a rejected POST never retries or stores a token; GET recovery obtains a fresh token once', async () => {
  const calls = [];
  let tokens = 0;
  const send = async (path, init) => {
    calls.push({ path, ...init });
    return new Response('{}', { status: 401 });
  };
  await assert.rejects(signingOwnerRequest('POST', async () => `synthetic-${++tokens}`, send));
  assert.equal(calls.length, 1);
  assert.equal(tokens, 1);
  assert.equal(calls[0].body, '{"action":"setup"}');
  assert.equal(calls[0].credentials, 'omit');
  calls.length = 0;
  await assert.rejects(signingOwnerRequest('GET', async () => `synthetic-${++tokens}`, send));
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].headers.Authorization, calls[1].headers.Authorization);
});
test('an uncertain POST transport performs no automatic second dispatch', async () => {
  let calls = 0;
  await assert.rejects(
    signingOwnerRequest(
      'POST',
      async () => 'synthetic',
      async () => {
        calls++;
        throw new Error('SYNTHETIC_PRIVATE_ERROR');
      },
    ),
  );
  assert.equal(calls, 1);
});
test('closed status is accepted but unknown fields and quote authority are refused', async () => {
  assert.deepEqual(
    await signingOwnerRequest(
      'GET',
      async () => 'synthetic',
      async () => Response.json(reply),
    ),
    reply,
  );
  for (const value of [
    { ...reply, token: 'synthetic' },
    { ...reply, quoteIssuanceAuthorized: true },
  ]) {
    await assert.rejects(
      signingOwnerRequest(
        'GET',
        async () => 'synthetic',
        async () => Response.json(value),
      ),
    );
  }
});
