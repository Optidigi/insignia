import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRequest } from 'astro/app/node';
import config, { allowedDomains } from '../astro.config.ts';
import { mutationOrigin } from '../src/server/admin/http.ts';

const production = /APP_URL: '([^']+)'/.exec(
  readFileSync(new URL('../../../deployment/production/compose.yaml', import.meta.url), 'utf8'),
)?.[1];

function proxied(host: string) {
  // What Traefik hands the Node server: plain HTTP with the public Host and X-Forwarded-Proto.
  return {
    method: 'PUT',
    url: '/api/admin/methods/00000000-0000-4000-8000-000000000000',
    headers: {
      host,
      'x-forwarded-proto': 'https',
      'x-forwarded-host': host,
      'x-forwarded-port': '443',
      origin: `https://${host}`,
      'sec-fetch-site': 'same-origin',
    },
    socket: {},
    on() {},
  } as unknown as Parameters<typeof createRequest>[0];
}

test('the production APP_URL host is an allowed domain', () => {
  assert(production);
  assert.deepEqual(config.security?.allowedDomains, allowedDomains);
  assert(allowedDomains.some((d) => d.hostname === new URL(production).hostname && d.protocol === 'https'));
});

test('behind the proxy an admin mutation keeps its public origin and passes the same-origin check', () => {
  assert(production);
  const request = createRequest(proxied(new URL(production).host), { skipBody: true, allowedDomains });
  assert.equal(new URL(request.url).origin, production);
  assert.equal(mutationOrigin(request, production), true);
});

test('without the allow-list Astro falls back to localhost, which the same-origin check refuses', () => {
  assert(production);
  const request = createRequest(proxied(new URL(production).host), { skipBody: true });
  assert.equal(new URL(request.url).hostname, 'localhost');
  assert.equal(mutationOrigin(request, production), false);
});

test('an unlisted Host does not become the request origin', () => {
  assert(production);
  const request = createRequest(proxied('evil.example'), { skipBody: true, allowedDomains });
  assert.equal(new URL(request.url).hostname, 'localhost');
  assert.equal(mutationOrigin(request, production), false);
});
