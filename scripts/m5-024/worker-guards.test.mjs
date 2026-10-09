import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { collectWorkerInventory } from '../../docs/delivery/evidence/m5-023/operators/worker-inventory.mjs';
import { qualifyWorkerCandidate } from './worker-guards.mjs';

// Actual package graph required, supplied only by offline qualification or explicit CI build.
test('candidate guards reject source, Compose, image, endpoint and private parity drift', {
  skip: !process.env.M5_WORKER_PACKAGE_ENTRY,
}, () => {
  const entry = process.env.M5_WORKER_PACKAGE_ENTRY;
  const rendered = {
    services: {
      worker: {
        image: `synthetic@sha256:${'a'.repeat(64)}`,
        read_only: true,
        user: 'node',
        command: ['/usr/local/bin/node', '/srv/insignia/worker/dist/main.js'],
        cap_drop: ['ALL'],
        security_opt: ['no-new-privileges:true'],
        networks: ['private'],
      },
    },
  };
  const composeBytes = Buffer.from('synthetic reviewed worker compose');
  const environment = {
    DATABASE_URL: 'postgres://synthetic_worker@database:5432/synthetic_db?sslmode=disable',
    SHOPIFY_CLIENT_ID: 'synthetic-client',
    SHOPIFY_CLIENT_SECRET: 'synthetic-hmac',
    SHOPIFY_WEBHOOK_SECRET: 'synthetic-hmac',
    INSIGNIA_CREDENTIAL_KEY_ID: 'synthetic-k1',
    INSIGNIA_CREDENTIAL_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
    NODE_ENV: 'production',
  };
  const endpoint = {
    hostname: 'database',
    port: 5432,
    database: 'synthetic_db',
    role: 'synthetic_worker',
    sslmode: 'disable',
    address: '127.0.0.1',
    major: 18,
    schemaVersion: 43,
  };
  const candidate = {
    composeBytes,
    composeSha256: createHash('sha256').update(composeBytes).digest('hex'),
    rendered,
    expectedRendered: rendered,
    environment,
    webEnvironment: {
      ...environment,
      DATABASE_URL: environment.DATABASE_URL.replace('synthetic_worker', 'synthetic_web'),
    },
    endpoint,
    expectedEndpoint: endpoint,
    webEndpoint: { ...endpoint, role: 'synthetic_web' },
    expectedWebEndpoint: { ...endpoint, role: 'synthetic_web' },
    entry,
    inventory: collectWorkerInventory(entry),
    writablePaths: [],
    image: `synthetic@sha256:${'a'.repeat(64)}`,
    expectedImage: `synthetic@sha256:${'a'.repeat(64)}`,
  };
  assert.equal(qualifyWorkerCandidate(candidate), true);
  const tlsCandidate = {
    ...candidate,
    endpoint: { ...endpoint, sslmode: 'verify-full' },
    expectedEndpoint: { ...endpoint, sslmode: 'verify-full' },
    webEndpoint: { ...candidate.webEndpoint, sslmode: 'verify-full' },
    expectedWebEndpoint: { ...candidate.webEndpoint, sslmode: 'verify-full' },
    environment: { ...environment, DATABASE_URL: environment.DATABASE_URL.replace('disable', 'verify-full') },
    webEnvironment: {
      ...candidate.webEnvironment,
      DATABASE_URL: candidate.webEnvironment.DATABASE_URL.replace('disable', 'verify-full'),
    },
  };
  assert.equal(qualifyWorkerCandidate(tlsCandidate), true);
  for (const key of ['environment', 'webEnvironment']) {
    for (const modes of ['verify-full&sslmode=disable', 'disable&sslmode=verify-full']) {
      assert.equal(
        qualifyWorkerCandidate({
          ...tlsCandidate,
          [key]: { ...tlsCandidate[key], DATABASE_URL: tlsCandidate[key].DATABASE_URL.replace('verify-full', modes) },
        }),
        false,
      );
    }
  }
  for (const change of [
    { composeBytes: Buffer.from('drift') },
    { image: `wrong@sha256:${'a'.repeat(64)}` },
    { rendered: { ...rendered, volumes: ['mutable-code:/srv/insignia/worker'] } },
    { rendered: { services: { worker: { ...rendered.services.worker, ports: ['4301:4301'] } } } },
    {
      rendered: {
        services: { worker: { ...rendered.services.worker, networks: ['proxy'], extra_hosts: ['database:evil'] } },
      },
    },
    { endpoint: { ...endpoint, address: '192.0.2.42' } },
    { endpoint: { ...endpoint, schemaVersion: 42 } },
    { environment: { ...environment, PGHOST: 'wrong' } },
    { environment: { ...environment, NODE_OPTIONS: '--import=evil' } },
    { environment: { ...environment, DATABASE_URL: `${environment.DATABASE_URL}&options=evil` } },
    { environment: { ...environment, SHOPIFY_WEBHOOK_SECRET: 'wrong' } },
    { environment: { ...environment, SHOPIFY_WEBHOOK_PREVIOUS_SECRET: 'unmatched-previous' } },
    { environment: { ...environment, INSIGNIA_CREDENTIAL_KEY_BASE64: 'invalid' } },
    { webEnvironment: { ...candidate.webEnvironment, SHOPIFY_CLIENT_SECRET: 'wrong' } },
    { webEnvironment: { ...candidate.webEnvironment, DATABASE_URL: undefined } },
    {
      webEnvironment: {
        ...candidate.webEnvironment,
        DATABASE_URL: 'postgres://synthetic_web@other-db:5432/other_db?sslmode=disable',
      },
    },
    { webEndpoint: undefined },
    { webEndpoint: { ...candidate.webEndpoint, address: '192.0.2.42' } },
    { writablePaths: [entry] },
    { inventory: { ...candidate.inventory, node: 'wrong' } },
  ])
    assert.equal(qualifyWorkerCandidate({ ...candidate, ...change }), false);
});
