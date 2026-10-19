import type { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { array, object, text } from './validation.mts';
export type OwnerResponse = EventEmitter &
  Pick<IncomingMessage, 'headers' | 'complete' | 'statusCode'> & { destroy(): unknown };
export type OwnerRequestHandle = EventEmitter & { end(bytes: Buffer): unknown; destroy(): unknown };
export type OwnerRequest = (
  endpoint: string,
  options: RequestOptions,
  callback: (response: OwnerResponse) => void,
) => OwnerRequestHandle;

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { releaseProfile } from './profiles.mts';

const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { canonicalAdminAccessScopes }: typeof import('../../packages/shopify/dist/index.js') = await import(
  pathToFileURL(require.resolve('@insignia/shopify')).href
);

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
/** Fixed TLS endpoint/documents; request is the captured original node:https
 * capability. The native entry denies every global fetch/HTTP fallback. */
export function createOwnerHttps({
  request,
  functionQuery,
  now = Date.now,
  deadline,
  profileName,
}: {
  request: OwnerRequest;
  functionQuery: string;
  now?: () => number;
  deadline: number;
  profileName?: string;
}) {
  const GRANTS = releaseProfile(profileName).grants;
  let oauthCalls = 0,
    adminCalls = 0;
  assert.ok(typeof request === 'function' && typeof functionQuery === 'string');
  async function json(
    endpoint: string,
    body: string,
    headers: Record<string, string>,
    maximum: number,
  ): Promise<unknown> {
    assert.ok([ADMIN, OAUTH].includes(endpoint));
    const budget = Math.min(30000, deadline - now());
    assert.ok(budget > 0);
    const bytes = Buffer.from(body);
    try {
      return await new Promise<unknown>((resolve, reject) => {
        let settled = false,
          size = 0,
          timer: ReturnType<typeof setTimeout> | undefined,
          response: OwnerResponse | undefined;
        const chunks: Buffer[] = [];
        const finish = (error: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const collected = Buffer.concat(chunks);
          for (const chunk of chunks) chunk.fill(0);
          try {
            assert.ok(!error && response?.complete && response.statusCode === 200);
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
            res.on('data', (chunk: unknown) => {
              assert.ok(Buffer.isBuffer(chunk));
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
  async function admin(token: string, query: string, variables: Record<string, unknown>) {
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
    async acquireToken(secret: string) {
      assert.equal(++oauthCalls, 1);
      assert.ok(typeof secret === 'string' && /^[^\r\n\0]{1,4096}$/.test(secret));
      const value = object(
        await json(
          OAUTH,
          new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: CLIENT,
            client_secret: secret,
          }).toString(),
          { 'content-type': 'application/x-www-form-urlencoded' },
          16384,
        ),
      );
      assert.deepEqual(Object.keys(value).sort(), ['access_token', 'expires_in', 'scope']);
      assert.ok(typeof value.access_token === 'string' && /^[^\s]{1,4096}$/.test(value.access_token));
      assert.ok(
        Number.isSafeInteger(value.expires_in) &&
          typeof value.expires_in === 'number' &&
          value.expires_in >= Math.ceil((deadline - now()) / 1000) + 5 &&
          value.expires_in <= 86400,
      );
      assert.equal(typeof value.scope, 'string');
      assert.deepEqual(
        canonicalAdminAccessScopes(
          text(value.scope)
            .split(',')
            .map((v) => v.trim()),
        ),
        canonicalAdminAccessScopes(GRANTS),
      );
      const token = text(value.access_token);
      value.access_token = undefined;
      return token;
    },
    async readInstallation(token: string) {
      const result = object(await admin(token, INSTALLATION_BOUNDARY, {}));
      // Same envelope as the qualified original installation collector. Cost
      // extensions never enter the selected identity or release authority.
      assert.ok(Object.keys(result).every((key) => ['data', 'errors', 'extensions'].includes(key)));
      assert.ok(result.errors === undefined || (Array.isArray(result.errors) && result.errors.length === 0));
      const data = object(result.data);
      const shop = object(data.shop);
      assert.deepEqual(Object.keys(data).sort(), ['currentAppInstallation', 'shop']);
      assert.deepEqual(Object.keys(shop).sort(), ['id', 'myshopifyDomain']);
      assert.deepEqual(Object.keys(object(data.currentAppInstallation)).sort(), ['accessScopes', 'app', 'id']);
      const installation = object(data.currentAppInstallation);
      const app = object(installation.app);
      assert.deepEqual(Object.keys(app).sort(), ['apiKey', 'id']);
      assert.ok(
        Array.isArray(installation.accessScopes) &&
          array(installation.accessScopes).every((scope) => Object.keys(object(scope)).join(',') === 'handle'),
      );
      return {
        shop: text(shop.myshopifyDomain),
        shopId: text(shop.id),
        installationId: text(installation.id),
        appId: text(app.id).replace(/^gid:\/\/shopify\/App\//, ''),
        appClientId: text(app.apiKey),
        grants: array(installation.accessScopes).map((value) => text(object(value).handle)),
      };
    },
    async functions(token: string, input: { operation: string; query: string; variables: Record<string, unknown> }) {
      assert.equal(input.operation, 'function_ownership');
      assert.equal(input.query, functionQuery);
      assert.deepEqual(input.variables, {});
      return { status: 200, body: await admin(token, input.query, input.variables) };
    },
  };
}
