import assert from 'node:assert/strict';
import { request } from 'node:http';
import test from 'node:test';
import { createAdminOnlineIdentity } from '../../packages/shopify/dist/index.js';
import { createOwnerSessionInput } from './owner-session-input.mjs';

import { nonce, origin, token } from './owner-session-input-fixture.mjs';

const secret = 'SYNTHETIC_OWNER_INPUT_SECRET';
const key = '1443cf6d03d39edae7c101a943c5c684';
test('real HTTP admits one fresh exact-app owner session, never returns it or calls a provider', async () => {
  let providerRequests = 0;
  const identity = createAdminOnlineIdentity({
    apiKey: key,
    apiSecret: secret,
    hostName: new URL(origin).host,
    fetchImpl: async () => {
      providerRequests++;
      throw new Error('provider_forbidden');
    },
  });
  const received = [];
  const server = createOwnerSessionInput({
    nonce,
    identity,
    receive: (value) => {
      received.push(value);
    },
    deadline: Date.now() + 30000,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/__m5/owner-input/${nonce}`;
  const send = (signed = token(), options = {}) =>
    new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'POST',
          ...options,
          headers: { host: new URL(origin).host, origin, authorization: `Bearer ${signed}`, ...options.headers },
        },
        (response) => {
          let text = '';
          response.on('data', (chunk) => {
            text += chunk;
          });
          response.on('end', () => resolve({ status: response.statusCode, json: () => JSON.parse(text) }));
        },
      );
      req.on('error', reject);
      req.end();
    });
  try {
    const otherShop = 'another.myshopify.com';
    for (const [signed, options, expected] of [
      [token(), { headers: { origin: 'https://unrelated.example' } }, 403],
      [token(), { method: 'GET' }, 405],
      [token(), { headers: { 'content-length': '1' } }, 422],
      [token({}, 'SYNTHETIC_WRONG_SECRET'), {}, 401],
      [token({ dest: `https://${otherShop}`, iss: `https://${otherShop}/admin` }), {}, 401],
      [token({ exp: Math.floor(Date.now() / 1000) - 60 }), {}, 401],
    ]) {
      assert.equal((await send(signed, options)).status, expected);
      assert.equal(received.length, 0);
    }
    const responses = await Promise.all([send(), send()]);
    assert.deepEqual(responses.map((value) => value.status).sort(), [202, 409]);
    assert.deepEqual(await responses.find((value) => value.status === 202).json(), {
      result: 'SESSION_RECEIVED_NOT_SETUP_SUCCESS',
    });
    assert.equal(received.length, 1);
    assert.equal((await send()).status, 409);
    assert.equal(received.length, 1);
    assert.equal(providerRequests, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
