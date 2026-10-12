import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { canonicalAdminAccessScopes } = await import(pathToFileURL(require.resolve('@insignia/shopify')));

const ORIGIN = 'https://insignia-rewrite-dev.myshopify.com';
const ADMIN = `${ORIGIN}/admin/api/2026-07/graphql.json`;
const OAUTH = `${ORIGIN}/admin/oauth/access_token`;
const CLIENT = '1443cf6d03d39edae7c101a943c5c684';
export const INSTALLATION_BOUNDARY = `query M5027InstallationBoundary {
  shop { id myshopifyDomain }
  currentAppInstallation { id app { id apiKey } accessScopes { handle } }
}`;
// Compare capabilities: OAuth omits redundant reads after their write scope is granted.
// The installation connection separately returns the complete effective scope set.
const GRANTS = [
  'write_products',
  'read_publications',
  'read_product_listings',
  'read_cart_transforms',
  'read_validations',
  'write_cart_transforms',
  'write_validations',
];

/** Fixed TLS endpoint/documents; request is the captured original node:https
 * capability. The native entry denies every global fetch/HTTP fallback. */
export function createOwnerHttps({ request, functionQuery, now = Date.now, deadline }) {
  let oauthCalls = 0,
    adminCalls = 0;
  assert.ok(typeof request === 'function' && typeof functionQuery === 'string');
  async function json(endpoint, body, headers, maximum) {
    assert.ok([ADMIN, OAUTH].includes(endpoint));
    const budget = Math.min(30000, deadline - now());
    assert.ok(budget > 0);
    const bytes = Buffer.from(body);
    try {
      return await new Promise((resolve, reject) => {
        let settled = false,
          size = 0,
          timer,
          response;
        const chunks = [];
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const collected = Buffer.concat(chunks);
          for (const chunk of chunks) chunk.fill(0);
          try {
            assert.ok(!error && response.complete && response.statusCode === 200);
            assert.match(response.headers['content-type'] ?? '', /^application\/json(?:\s*;.*)?$/i);
            assert.ok([undefined, 'identity'].includes(response.headers['content-encoding']));
            assert.ok(!response.headers.location);
            resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(collected)));
          } catch {
            reject(new Error('Owner read unavailable'));
          } finally {
            collected.fill(0);
            if (error) {
              response?.destroy();
              req.destroy();
            }
          }
        };
        const req = request(
          endpoint,
          {
            method: 'POST',
            agent: false,
            rejectUnauthorized: true,
            minVersion: 'TLSv1.2',
            maxHeaderSize: 16384,
            headers: { ...headers, 'content-length': bytes.length },
          },
          (res) => {
            response = res;
            if (Number(res.headers['content-length']) > maximum) {
              finish(true);
              return;
            }
            res.on('data', (chunk) => {
              size += chunk.length;
              if (size > maximum) finish(true);
              else chunks.push(Buffer.from(chunk));
            });
            res.once('error', () => finish(true));
            res.once('aborted', () => finish(true));
            res.once('end', () => finish(false));
          },
        );
        req.once('error', () => finish(true));
        timer = setTimeout(() => finish(true), budget);
        req.end(bytes);
      });
    } finally {
      bytes.fill(0);
    }
  }
  async function admin(token, query, variables) {
    assert.ok(typeof token === 'string' && /^[^\s]{1,4096}$/.test(token));
    assert.ok(++adminCalls <= 3 && [INSTALLATION_BOUNDARY, functionQuery].includes(query));
    assert.deepEqual(variables, {});
    return json(
      ADMIN,
      JSON.stringify({ query, variables }),
      { 'content-type': 'application/json', 'x-shopify-access-token': token },
      1048576,
    );
  }
  return {
    async acquireToken(secret) {
      assert.equal(++oauthCalls, 1);
      assert.ok(typeof secret === 'string' && /^[^\r\n\0]{1,4096}$/.test(secret));
      const value = await json(
        OAUTH,
        new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT, client_secret: secret }).toString(),
        { 'content-type': 'application/x-www-form-urlencoded' },
        16384,
      );
      assert.deepEqual(Object.keys(value).sort(), ['access_token', 'expires_in', 'scope']);
      assert.ok(typeof value.access_token === 'string' && /^[^\s]{1,4096}$/.test(value.access_token));
      assert.ok(
        Number.isSafeInteger(value.expires_in) &&
          value.expires_in >= Math.ceil((deadline - now()) / 1000) + 5 &&
          value.expires_in <= 86400,
      );
      assert.equal(typeof value.scope, 'string');
      assert.deepEqual(
        canonicalAdminAccessScopes(value.scope.split(',').map((v) => v.trim())),
        canonicalAdminAccessScopes(GRANTS),
      );
      const token = value.access_token;
      value.access_token = undefined;
      return token;
    },
    async readInstallation(token) {
      const result = await admin(token, INSTALLATION_BOUNDARY, {});
      // Same envelope as the qualified original installation collector. Cost
      // extensions never enter the selected identity or release authority.
      assert.ok(Object.keys(result).every((key) => ['data', 'errors', 'extensions'].includes(key)));
      assert.ok(result.errors === undefined || (Array.isArray(result.errors) && result.errors.length === 0));
      const data = result.data;
      assert.deepEqual(Object.keys(data).sort(), ['currentAppInstallation', 'shop']);
      assert.deepEqual(Object.keys(data.shop).sort(), ['id', 'myshopifyDomain']);
      assert.deepEqual(Object.keys(data.currentAppInstallation).sort(), ['accessScopes', 'app', 'id']);
      const installation = data.currentAppInstallation;
      assert.deepEqual(Object.keys(installation.app).sort(), ['apiKey', 'id']);
      assert.ok(
        Array.isArray(installation.accessScopes) &&
          installation.accessScopes.every((scope) => Object.keys(scope).join(',') === 'handle'),
      );
      return {
        shop: data.shop.myshopifyDomain,
        shopId: data.shop.id,
        installationId: installation.id,
        appId: installation.app.id?.replace(/^gid:\/\/shopify\/App\//, ''),
        appClientId: installation.app.apiKey,
        grants: installation.accessScopes.map((v) => v.handle),
      };
    },
    async functions(token, input) {
      assert.equal(input.operation, 'function_ownership');
      assert.equal(input.query, functionQuery);
      assert.deepEqual(input.variables, {});
      return { status: 200, body: await admin(token, input.query, input.variables) };
    },
  };
}
