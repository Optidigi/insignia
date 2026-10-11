/** Dedicated-process capability: fixed exact-store requests, no ambient fallback. */
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';

const ORIGIN = 'https://insignia-rewrite-dev.myshopify.com';
const CLIENT = '1443cf6d03d39edae7c101a943c5c684';
export function installFunctionSetupNetwork({
  journal,
  documents,
  auth,
  deadline,
  nativeTransport = globalThis.fetch.bind(globalThis),
}) {
  assert.deepEqual(Object.keys(documents).sort(), ['installation', 'ownership', 'transform', 'validation']);
  assert.ok(Object.values(documents).every((value) => typeof value === 'string' && value.length > 0));
  assert.ok(typeof auth.idToken === 'string' && auth.idToken.length <= 8192 && typeof auth.clientSecret === 'string');
  let denials = 0,
    oauth = 0,
    installation = 0,
    functionRequest = 0,
    token = null;
  const deny = () => {
    denials++;
    throw new Error('network_escape_denied');
  };
  globalThis.fetch = async () => deny();
  for (const module of [http, https]) {
    module.request = deny;
    module.get = deny;
  }
  syncBuiltinESMExports();
  const sequence = [
    [documents.ownership, 'READ_PRESTATE'],
    [documents.transform, 'CREATE_TRANSFORM'],
    [documents.ownership, 'READ_TRANSFORM'],
    [documents.validation, 'CREATE_VALIDATION'],
    [documents.ownership, 'READ_FINAL'],
  ];
  return Object.freeze({
    bindToken(value) {
      assert.ok(token === null && typeof value === 'string' && /^[^\s]{1,4096}$/.test(value));
      token = value;
    },
    assertNoEscape() {
      assert.equal(denials, 0, 'network_escape_denied');
    },
    async fetch(url, options) {
      assert.equal(denials, 0, 'network_escape_denied');
      assert.ok(typeof url === 'string' && options?.method === 'POST' && typeof options.body === 'string');
      assert.ok(Buffer.byteLength(options.body) <= 16384);
      const body = JSON.parse(options.body);
      let operation;
      if (url === `${ORIGIN}/admin/oauth/access_token`) {
        assert.equal(oauth, 0);
        assert.deepEqual(body, {
          client_id: CLIENT,
          client_secret: auth.clientSecret,
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token: auth.idToken,
          subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          requested_token_type: 'urn:shopify:params:oauth:token-type:online-access-token',
          expiring: '0',
        });
        operation = 'AUTH_ONLINE';
        assert.equal(journal.reserve(operation), true);
        oauth++;
      } else {
        assert.equal(url, `${ORIGIN}/admin/api/2026-07/graphql.json`);
        assert.ok(token && new Headers(options.headers).get('x-shopify-access-token') === token);
        assert.ok(Object.keys(body).every((key) => ['query', 'variables'].includes(key)));
        if (body.variables !== undefined) assert.deepEqual(body.variables, {});
        if (body.query === documents.installation) {
          assert.ok(installation < 6);
          operation = `INSTALLATION_HTTP_${++installation}`;
          assert.equal(journal.reserve(operation), true);
        } else {
          assert.ok(sequence[functionRequest]?.[0] === body.query);
          operation = sequence[functionRequest][1];
          functionRequest++;
        }
      }
      const timeout = Math.min(8000, deadline - Date.now());
      assert.ok(timeout > 0);
      // This durable marker consumes the attempt even if native transport subsequently fails.
      journal.dispatch(operation);
      const timeoutSignal = AbortSignal.timeout(timeout);
      const signal = options.signal ? AbortSignal.any([timeoutSignal, options.signal]) : timeoutSignal;
      const response = await nativeTransport(url, { ...options, redirect: 'error', signal });
      const reader = response.body?.getReader();
      assert.ok(reader);
      const chunks = [];
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          assert.ok(size <= 131072);
          chunks.push(Buffer.from(part.value));
        }
        // Transport receipt only; identity/grant and semantic readback are qualified by the caller.
        if (operation === 'AUTH_ONLINE' || operation.startsWith('INSTALLATION_HTTP_'))
          journal.settle(operation, response.status === 200 ? 'ACK' : 'STOP');
        return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
      } finally {
        for (const chunk of chunks) chunk.fill(0);
        await reader.cancel().catch(() => {});
      }
    },
  });
}
